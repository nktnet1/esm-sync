"use strict";
const protocol = require("./protocol.cjs");
const tracking = require("./import-promise-tracking.cjs");
const { loadOwnProtocol } = protocol;
const { instrumentNativeImports } = tracking;
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = process.getBuiltinModule("node:vm");
const { Parser } = require("acorn");
let compiler;
function getCompiler() {
    if (compiler)
        return compiler;
    // Load the already-built compiler as CommonJS even when the Test262 case
    // itself forces esm-sync's global `mode:all` module setting.
    const { Module } = require("node:module");
    const filename = path.resolve(__dirname, "../../build/compiler.js");
    const bundle = readFileSync(filename, "utf8");
    const nativeModule = new Module(filename, module);
    nativeModule.filename = filename;
    nativeModule.paths = Module._nodeModulePaths(path.dirname(filename));
    globalThis.__global__ ??= globalThis;
    const run = new vm.Script(Module.wrap(bundle), { filename }).runInThisContext();
    run(nativeModule.exports, nativeModule.require.bind(nativeModule), nativeModule, filename, path.dirname(filename));
    const result = nativeModule.exports;
    if (!result ||
        typeof result !== "object" ||
        !("compile" in result) ||
        typeof result.compile !== "function") {
        throw new Error("Test262: esm-sync compiler is unavailable");
    }
    compiler = result;
    return compiler;
}
function parseTest(filename, isModule) {
    const source = readFileSync(filename, "utf8");
    // esm-sync's compiler deliberately tolerates some early errors (including
    // duplicate lexical declarations, invalid labels and private names). Check
    // the compiled text against the engine grammar without evaluating it.
    // Validate *after* esm-sync transforms import/export syntax: the host parser
    // may not support valid `import defer` or `import.source()` source text.
    const sourceType = isModule ? 2 : 1;
    const compiled = getCompiler().compile(source, {
        hint: sourceType,
        pragmas: false,
        sourceType,
        // The engine validates native await syntax; generator yields are only
        // valid in the loader's execution wrapper, not in a SourceTextModule.
        transformTopLevelAwait: false
    });
    if (isModule) {
        // Construction parses a module, but does not link or evaluate it. In
        // particular, it cannot turn a resolution or runtime error into a parse
        // error by loading a dependency or running a module body.
        new vm.SourceTextModule(resourceValidationCode(compiled.code, true), { identifier: filename });
    }
    else {
        new vm.Script(resourceValidationCode(compiled.code, false), { filename });
    }
}
// Node 22 cannot parse using declarations, even though esm-sync lowers them
// at module scope. First validate their full grammar with strict Acorn (not
// the loader's tolerant parser), then retain their lexical bindings as const
// for the engine's remaining early-error checks. Never execute this text.
function resourceValidationCode(code, isModule) {
    if (!/\busing\b/.test(code))
        return code;
    const ast = Parser.parse(code, {
        ecmaVersion: "latest",
        sourceType: isModule ? "module" : "script"
    });
    const edits = [];
    function visit(node) {
        if (node === null || typeof node !== "object")
            return;
        const current = node;
        if (current.type === "VariableDeclaration" &&
            (current.kind === "using" || current.kind === "await using")) {
            const declaration = node;
            edits.push([declaration.start, declaration.declarations[0].id.start]);
        }
        for (const value of Object.values(current)) {
            if (Array.isArray(value))
                value.forEach(visit);
            else if (value !== null && typeof value === "object" && "type" in value)
                visit(value);
        }
    }
    visit(ast);
    for (const [start, end] of edits.sort((left, right) => right[0] - left[0])) {
        code = code.slice(0, start) + "const " + code.slice(end);
    }
    return code;
}
// Keep script-goal execution in vm.Script, while imports use the loader being
// tested. This also avoids native Node/V8 module-evaluation bugs and permits
// import.defer() on hosts whose own parser does not yet support it.
// Each Test262 case gets its own subprocess, so this temporary runtime binding
// cannot leak between cases or change another case's global environment.
const SCRIPT_RUNTIME_NAME = "__esmSyncTest262ScriptRuntime__";
const importCallPattern = /\bimport\b/;
function getScriptRuntime(filename) {
    const { Module } = require("node:module");
    // Reuse esm-sync's private, existing internal-protocol objects rather than
    // reimplementing deferred import or adding an application-facing API.
    const { ownRequire, shared } = loadOwnProtocol();
    const Entry = ownRequire(shared.symbol.entry);
    const Runtime = ownRequire(shared.symbol.runtime);
    if (typeof Entry?.get !== "function" || typeof Runtime?.enable !== "function") {
        throw new Error("Test262: esm-sync script runtime is unavailable");
    }
    const scriptModule = new Module(filename, module);
    scriptModule.filename = filename;
    scriptModule.paths = Module._nodeModulePaths(path.dirname(filename));
    return Runtime.enable(Entry.get(scriptModule), Object.create(null));
}
function runScript(filename, trackNativeImports = false) {
    const source = readFileSync(filename, "utf8");
    let code = source;
    if (importCallPattern.test(source)) {
        const compiled = getCompiler().compile(source, {
            hint: 1,
            pragmas: false,
            runtimeName: SCRIPT_RUNTIME_NAME,
            sourceType: 1
        });
        // A string or comment mentioning import must not change the
        // execution path: only the compiler's actual dynamic-import transform
        // opts into esm-sync's runtime.
        if (["i", "p", "q"].some((method) => compiled.code.includes(`${SCRIPT_RUNTIME_NAME}.${method}(`))) {
            if (Object.hasOwn(globalThis, SCRIPT_RUNTIME_NAME)) {
                throw new Error("Test262: script runtime binding already exists");
            }
            Object.defineProperty(globalThis, SCRIPT_RUNTIME_NAME, {
                configurable: true,
                value: getScriptRuntime(filename)
            });
            code = compiled.code;
        }
    }
    const options = {
        filename,
        importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
    };
    // Always validate the original grammar before instrumenting a runtime test.
    // An import Promise observer must never turn invalid Test262 syntax into valid code.
    const original = new vm.Script(code, options);
    if (!trackNativeImports)
        return original.runInThisContext();
    const observerName = `__test262_native_import_${require("node:crypto").randomUUID().replaceAll("-", "_")}`;
    let instrumented;
    try {
        instrumented = instrumentNativeImports(code, observerName, SCRIPT_RUNTIME_NAME);
    }
    catch (failure) {
        // Acorn may not recognize a newer host grammar production. In that case,
        // keep the original VM execution instead of changing its parse result.
        if (!(failure instanceof SyntaxError))
            throw failure;
        return original.runInThisContext();
    }
    if (instrumented === null)
        return original.runInThisContext();
    const importPromises = new WeakSet();
    Object.defineProperty(globalThis, observerName, {
        configurable: true,
        value(promise) {
            importPromises.add(promise);
            return promise;
        }
    });
    process.on("unhandledRejection", (reason, promise) => {
        if (!importPromises.has(promise))
            throw reason;
    });
    return new vm.Script(instrumented, options).runInThisContext();
}
let moduleLoader;
function getModuleLoader() {
    if (moduleLoader)
        return moduleLoader;
    // The loader's internal require(symbol) protocol already exposes its
    // shared state to esm-sync's own modules. It is not a public application API.
    const { shared } = loadOwnProtocol();
    const load = shared?.module?.test262Load;
    if (typeof load !== "function") {
        throw new Error("Test262: esm-sync test-only module loader is unavailable");
    }
    moduleLoader = (filename, linkOnly) => load(filename, module, linkOnly);
    return moduleLoader;
}
function runModule(filename) {
    // Instantiate and evaluate via the same esm-sync loader used for the
    // resolution check. Requiring a syntax-free .js file can instead run Node's
    // CommonJS loader, which does not respect Test262's module flag.
    return getModuleLoader()(filename, false);
}
function checkModuleLink(filename) {
    const link = getModuleLoader();
    try {
        link(filename, true);
        return { linked: true };
    }
    catch (error) {
        // The root is parsed before instantiation. Syntax errors discovered while
        // loading dependencies belong to the resolution phase of the root test.
        return { linked: false, phase: "resolution", error };
    }
}
module.exports = { checkModuleLink, getCompiler, getModuleLoader, parseTest, runModule, runScript };
