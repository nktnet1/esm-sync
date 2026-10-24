"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const rootPath = node_path_1.default.resolve(__dirname, "..");
const fixturePath = node_path_1.default.join(rootPath, "test/fixture/scenario/native");
const sourcePath = node_path_1.default.join(fixturePath, "addon.c");
const outputPath = node_path_1.default.join(fixturePath, "addon.node");
const nodeDir = node_path_1.default.dirname(node_fs_1.default.realpathSync(process.execPath));
const includePath = process.env.ESM_SYNC_NODE_HEADERS ||
    node_path_1.default.resolve(nodeDir, process.platform === "win32" ? "include/node" : "../include/node");
const libraryPath = process.env.ESM_SYNC_NODE_LIB || nodeDir;
function compile() {
    if (!node_fs_1.default.existsSync(node_path_1.default.join(includePath, "node_api.h"))) {
        throw new Error(`Node-API headers not found in ${includePath}`);
    }
    const win = process.platform === "win32";
    const mac = process.platform === "darwin";
    const compiler = process.env.CC || (win ? "cl.exe" : "cc");
    const args = win
        ? [
            "/nologo",
            "/LD",
            `/I${includePath}`,
            `/Fe:${outputPath}`,
            sourcePath,
            "/link",
            `/LIBPATH:${libraryPath}`,
            "node.lib"
        ]
        : [
            ...(mac ? ["-bundle", "-undefined", "dynamic_lookup"] : ["-shared", "-fPIC"]),
            `-I${includePath}`,
            "-o",
            outputPath,
            sourcePath
        ];
    return new Promise((resolve, reject) => {
        const child = (0, node_child_process_1.spawn)(compiler, args, { cwd: fixturePath, stdio: "inherit" });
        child.once("error", reject);
        child.once("close", (code, signal) => {
            if (code === 0) {
                console.log("[native] Node-API fixture compiled.");
                resolve();
            }
            else {
                reject(new Error(`Native fixture compilation failed (${signal || code})`));
            }
        });
    });
}
module.exports = compile;
