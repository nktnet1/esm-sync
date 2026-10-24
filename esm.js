var _a, _b;
const NativeModule = require("module");
NativeModule.Module._extensions[".js"] = function (module, filename) {
    module._compile(require("fs").readFileSync(filename, "utf8"), filename);
};
const globalThis = (function () {
    // Reference `this` before `Function()` to prevent CSP errors for unsafe-eval.
    // Fallback to `Function()` when Node is invoked with `--strict`.
    return this || Function("return this")();
})();
const { apply } = Reflect;
const defineProperty = Reflect.defineProperty;
const { freeze } = Object;
const { hasOwnProperty } = Object.prototype;
const symbolFor = Symbol.for;
const { type, versions } = process;
const { filename, id, parent } = module;
const isElectron = has(versions, "electron");
const isElectronRenderer = isElectron && type === "renderer";
let nativeContent = "";
if (typeof id === "string" && id.startsWith("internal/")) {
    nativeContent = getNativeSource("internal/esm/loader");
}
const Module = NativeModule;
const { Script } = require("vm");
const { createCachedData, runInNewContext, runInThisContext } = Script.prototype;
const { sep } = require("path");
const { readFileSync } = require("fs");
const esmModule = new Module(id);
esmModule.filename = filename;
esmModule.parent = parent;
function getNativeSource(thePath) {
    let result;
    try {
        const { internalBinding } = require("internal/bootstrap/loaders");
        const natives = internalBinding("natives");
        if (has(natives, thePath)) {
            result = natives[thePath];
        }
    }
    catch (_e) { }
    return typeof result === "string" ? result : "";
}
function has(object, name) {
    return object != null && apply(hasOwnProperty, object, [name]);
}
function loadESM() {
    compiledESM(require, esmModule, shared);
    return esmModule.exports;
}
function makeRequireFunction(mod, options) {
    // The private bootstrap exports shared state once, then the public factory.
    return loadESM()(mod, options);
}
function readFile(filename, options) {
    try {
        return options === undefined ? readFileSync(filename) : readFileSync(filename, options);
    }
    catch (_e) { }
    return null;
}
let cachedData;
let scriptOptions;
let cachePath = "";
let content = "";
if (nativeContent !== "") {
    content = nativeContent;
    scriptOptions = {
        __proto__: null,
        filename: "esm.js"
    };
}
else {
    cachePath = __dirname + sep + "node_modules" + sep + ".cache" + sep + "esm";
    cachedData = (_a = readFile(cachePath + sep + ".data.blob")) !== null && _a !== void 0 ? _a : undefined;
    content = (_b = readFile(__dirname + sep + "esm" + sep + "loader.js", "utf8")) !== null && _b !== void 0 ? _b : "";
    scriptOptions = Object.assign(Object.assign({ __proto__: null }, (cachedData === undefined ? {} : { cachedData })), { filename, produceCachedData: typeof createCachedData !== "function" });
}
const script = new Script("const __global__ = this;" + "(function (require, module, __shared__) { " + content + "\n});", scriptOptions);
let compiledESM;
if (isElectronRenderer) {
    compiledESM = apply(runInThisContext, script, [
        {
            __proto__: null,
            filename
        }
    ]);
}
else {
    compiledESM = apply(runInNewContext, script, [
        {
            __proto__: null,
            global: globalThis
        },
        {
            __proto__: null,
            filename
        }
    ]);
}
// Declare `shared` before assignment to avoid the TDZ.
let shared;
shared = loadESM();
if (cachePath !== "") {
    const { dir } = shared.package;
    let cache = dir.get(cachePath);
    if (cache === void 0) {
        const scriptData = cachedData !== null && cachedData !== void 0 ? cachedData : null;
        cache = {
            buffer: cachedData,
            compile: new Map([
                [
                    "esm",
                    {
                        circular: 0,
                        code: null,
                        codeWithTDZ: null,
                        filename: null,
                        firstAwaitOutsideFunction: null,
                        firstReturnOutsideFunction: null,
                        mtime: -1,
                        scriptData,
                        sourceType: 1,
                        transforms: 0,
                        yieldIndex: -1
                    }
                ]
            ]),
            meta: new Map()
        };
        dir.set(cachePath, cache);
    }
    const { pendingScripts } = shared;
    let scripts = pendingScripts.get(cachePath);
    if (scripts === void 0) {
        scripts = new Map();
        pendingScripts.set(cachePath, scripts);
    }
    scripts.set("esm", script);
}
// The legacy symbol used for `esm` export detection.
defineProperty(makeRequireFunction, shared.symbol.package, {
    __proto__: null,
    value: true
});
defineProperty(makeRequireFunction, shared.customInspectKey, {
    __proto__: null,
    value: () => "esm enabled"
});
defineProperty(makeRequireFunction, symbolFor("esm:package"), {
    __proto__: null,
    value: true
});
freeze(makeRequireFunction);
module.exports = makeRequireFunction;
