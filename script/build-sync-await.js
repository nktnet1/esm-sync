"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
// The ordinary loader and its microtask-only fallback remain usable on the
// historical runtime range. The optional bridge targets the tested Node versions.
function buildSyncAwait(options = {}) {
    if (Number(process.versions.node.split(".")[0]) < 22)
        return null;
    const { styleText } = require("util");
    const root = path_1.default.resolve(__dirname, "..");
    const name = `${process.platform}-${process.arch}-${process.versions.modules}.node`;
    const output = path_1.default.join(root, "native", name);
    const source = path_1.default.join(root, "native/sync-await.cc");
    const executableDirectory = path_1.default.dirname(fs_1.default.realpathSync(process.execPath));
    const candidates = [
        process.env.ESM_SYNC_NODE_HEADERS,
        path_1.default.resolve(executableDirectory, "../include/node"),
        path_1.default.join(executableDirectory, "include/node"),
        "/usr/include/node",
        "/usr/local/include/node"
    ];
    const headers = candidates.find((directory) => {
        if (!directory)
            return false;
        try {
            const version = fs_1.default.readFileSync(path_1.default.join(directory, "node_version.h"), "utf8");
            return version.includes(`#define NODE_MODULE_VERSION ${process.versions.modules}`);
        }
        catch (_error) {
            return false;
        }
    });
    let failure;
    if (headers) {
        const windows = process.platform === "win32";
        const compiler = process.env.CXX || (windows ? "cl.exe" : "c++");
        const args = windows
            ? [
                "/nologo",
                "/LD",
                "/EHsc",
                "/MD",
                "/std:c++20",
                "/Zc:__cplusplus",
                "/DBUILDING_NODE_EXTENSION",
                "/DNODE_GYP_MODULE_NAME=esm_sync_await",
                `/I${headers}`,
                `/Fe:${output}`,
                `/Fo:${path_1.default.join(root, "native/sync-await.obj")}`,
                source,
                "/link",
                `/LIBPATH:${process.env.ESM_SYNC_NODE_LIB || executableDirectory}`,
                "node.lib"
            ]
            : [
                "-std=c++20",
                "-DBUILDING_NODE_EXTENSION",
                "-DNODE_GYP_MODULE_NAME=esm_sync_await",
                ...(process.platform === "darwin"
                    ? ["-bundle", "-undefined", "dynamic_lookup"]
                    : ["-shared", "-fPIC"]),
                `-I${headers}`,
                "-o",
                output,
                source
            ];
        const result = (0, child_process_1.spawnSync)(compiler, args, { cwd: root, encoding: "utf8" });
        if (result.status === 0) {
            console.log(`[esm-sync] Native await bridge ${styleText("green", "ready")}.`);
            return output;
        }
        failure = result.error || new Error(result.stderr || result.stdout || "Compiler failed");
    }
    else {
        failure = new Error("Matching Node headers are missing; set ESM_SYNC_NODE_HEADERS");
    }
    // Installation must not remove the existing pure-JavaScript functionality
    // when a consumer has no compiler/headers or disables lifecycle scripts.
    if (options.required)
        throw failure;
    console.warn(`[esm-sync] Native await bridge ${styleText("yellow", "unavailable")}; ` +
        "microtask-only loading remains enabled. " +
        failure.message);
    return null;
}
if (require.main === module) {
    try {
        buildSyncAwait({ required: process.argv.indexOf("--required") !== -1 });
    }
    catch (error) {
        console.error(error);
        process.exitCode = 1;
    }
}
module.exports = buildSyncAwait;
