"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const execa_1 = __importDefault(require("execa"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const ignore_paths_js_1 = __importDefault(require("./ignore-paths.js"));
const setup_native_addon_js_1 = __importDefault(require("./setup-native-addon.js"));
const path_1 = __importDefault(require("path"));
const test_cleanup_paths_js_1 = __importDefault(require("./test-cleanup-paths.js"));
const terser_1 = require("terser");
const trash_js_1 = __importDefault(require("./trash.js"));
const commander_1 = require("commander");
commander_1.program.option("--prod");
commander_1.program.parse();
const argv = commander_1.program.opts();
const isWin = process.platform === "win32";
const rootPath = path_1.default.resolve(__dirname, "..");
const testPath = path_1.default.resolve(rootPath, "test");
const envPath = path_1.default.resolve(testPath, "env");
const fixturePath = path_1.default.resolve(testPath, "fixture");
const nodePath = path_1.default.resolve(envPath, "prefix", isWin ? "node.exe" : "bin/node");
const nodeModulesPath = path_1.default.resolve(rootPath, "node_modules");
const sharedCachePath = path_1.default.resolve(nodeModulesPath, ".cache");
const NODE_ENV = argv.prod ? "production" : "development";
const keptPaths = [
    path_1.default.resolve(rootPath, "build"),
    path_1.default.resolve(rootPath, "esm"),
    path_1.default.resolve(rootPath, "native"),
    path_1.default.resolve(rootPath, "script"),
    path_1.default.resolve(rootPath, "esm.js"),
    path_1.default.resolve(rootPath, "index.js"),
    path_1.default.resolve(rootPath, "debug/debug.js"),
    nodeModulesPath,
    path_1.default.resolve(rootPath, "src/vendor"),
    path_1.default.resolve(rootPath, "test/vendor"),
    path_1.default.resolve(rootPath, "test/native-suite.cjs"),
    path_1.default.resolve(rootPath, "test/native-test-bootstrap.cjs"),
    path_1.default.resolve(rootPath, "test/native-test-reporter.cjs"),
    path_1.default.resolve(rootPath, "test/test262.mjs"),
    path_1.default.resolve(rootPath, "test/test262")
];
const jsPaths = [path_1.default.resolve(rootPath, "esm.js"), path_1.default.resolve(rootPath, "index.js")];
const trashPaths = ignore_paths_js_1.default.filter((0, test_cleanup_paths_js_1.default)({ keptPaths, nodeModulesPath, sharedCachePath }));
const terserOptions = fs_extra_1.default.readJSONSync(path_1.default.resolve(rootPath, ".terserrc"));
function assertFixturesReady() {
    if (!fs_extra_1.default.existsSync(path_1.default.resolve(rootPath, "build/compiler.js")) ||
        !fs_extra_1.default.existsSync(path_1.default.resolve(rootPath, "esm/loader.js"))) {
        throw new Error("Test bundles are missing. Run `pnpm build --test` before testing.");
    }
}
function dispose(paths) {
    return __awaiter(this, void 0, void 0, function* () {
        // CI workspaces are disposable; the Windows Recycle Bin helper can fail
        // when no interactive desktop is available on GitHub-hosted runners.
        if (isWin && process.env.CI === "true") {
            for (const thePath of paths) {
                yield fs_extra_1.default.remove(thePath);
            }
            return;
        }
        yield (0, trash_js_1.default)(paths);
    });
}
function cleanJS() {
    return __awaiter(this, void 0, void 0, function* () {
        for (const filename of jsPaths) {
            const content = fs_extra_1.default.readFileSync(filename, "utf8");
            const { code } = yield (0, terser_1.minify)(content, terserOptions);
            if (typeof code !== "string") {
                throw new Error("Terser did not produce JavaScript output");
            }
            // Production runs exercise minified public entry points without altering git files.
            process.once("exit", () => fs_extra_1.default.outputFileSync(filename, content));
            fs_extra_1.default.outputFileSync(filename, code);
        }
    });
}
function setupRepo() {
    return __awaiter(this, void 0, void 0, function* () {
        // Preserve recoverable cleanup for ignored files while clearing caches.
        yield dispose(trashPaths.filter((thePath) => !thePath.endsWith(".cache")));
        for (const cachePath of trashPaths.filter((thePath) => thePath.endsWith(".cache"))) {
            yield fs_extra_1.default.remove(cachePath);
        }
        if (!isWin) {
            const safePath = path_1.default.resolve(fixturePath, "safe-characters[#%&;=].mjs");
            const unsafePath = path_1.default.resolve(fixturePath, "unsafe-characters[\b\t\n\r:?].mjs");
            if (!fs_extra_1.default.existsSync(unsafePath)) {
                fs_extra_1.default.copySync(safePath, unsafePath);
            }
        }
    });
}
function setupNode() {
    return __awaiter(this, void 0, void 0, function* () {
        const basePath = path_1.default.resolve(nodePath, isWin ? "" : "..");
        yield dispose([basePath]);
        // Keep the fixture executable independent of the selected runtime. Copying
        // also works when pnpm's runtime and the checkout are on different volumes.
        yield fs_extra_1.default.ensureDir(path_1.default.dirname(nodePath));
        yield fs_extra_1.default.copyFile(process.execPath, nodePath);
    });
}
function runTests() {
    const vitest = path_1.default.resolve(rootPath, "node_modules/vitest/vitest.mjs");
    return (0, execa_1.default)(process.execPath, [vitest, "run", ...(argv.prod ? ["--mode", "production"] : [])], {
        cwd: rootPath,
        env: { NODE_ENV },
        stdio: "inherit"
    });
}
Promise.resolve()
    .then(assertFixturesReady)
    .then(() => Promise.all([argv.prod && cleanJS(), setupRepo()]))
    .then(setupNode)
    .then(setup_native_addon_js_1.default)
    .then(runTests)
    .catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
