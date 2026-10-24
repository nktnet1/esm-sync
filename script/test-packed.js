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
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const execa_1 = __importDefault(require("execa"));
const rootPath = node_path_1.default.resolve(__dirname, "..");
const loaderPath = node_path_1.default.resolve(rootPath, "esm/loader.js");
const fixturePath = node_path_1.default.resolve(rootPath, "test/packed");
function testPackedPackage() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield promises_1.default.access(loaderPath);
        }
        catch (_a) {
            throw new Error("Loader bundle is missing. Run `pnpm build --test` before `pnpm test:packed`.");
        }
        const tempPath = yield promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "esm-sync-packed-"));
        const tarballPath = node_path_1.default.join(tempPath, "esm-sync.tgz");
        const consumerPath = node_path_1.default.join(tempPath, "consumer");
        try {
            yield promises_1.default.cp(fixturePath, consumerPath, { recursive: true });
            yield promises_1.default.writeFile(node_path_1.default.join(consumerPath, "package.json"), '{"name":"esm-sync-packed-smoke","private":true,"type":"commonjs"}\n');
            yield (0, execa_1.default)("pnpm", ["pack", "--ignore-scripts", "--out", tarballPath], {
                cwd: rootPath,
                stdio: "inherit"
            });
            yield promises_1.default.access(tarballPath);
            yield (0, execa_1.default)("pnpm", ["add", "--ignore-scripts", tarballPath], {
                cwd: consumerPath,
                stdio: "inherit"
            });
            const installedPath = node_path_1.default.join(consumerPath, "node_modules/esm-sync");
            for (const filename of [
                "index.js",
                "index.d.ts",
                "esm.js",
                "esm/loader.js",
                "native/sync-await.cc",
                `native/${process.platform}-${process.arch}-${process.versions.modules}.node`,
                "script/build-sync-await.js"
            ]) {
                yield promises_1.default.access(node_path_1.default.join(installedPath, filename));
            }
            yield (0, execa_1.default)(process.execPath, ["consumer.cjs"], {
                cwd: consumerPath,
                stdio: "inherit"
            });
            yield (0, execa_1.default)(process.execPath, ["--require", "esm-sync", "cli.js"], {
                cwd: consumerPath,
                stdio: "inherit"
            });
        }
        finally {
            yield promises_1.default.rm(tempPath, { force: true, recursive: true });
        }
    });
}
testPackedPackage().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
