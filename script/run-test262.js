"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const node_child_process_1 = require("node:child_process");
const node_path_1 = __importDefault(require("node:path"));
const node_util_1 = require("node:util");
const commander_1 = require("commander");
function positiveInteger(value) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
        throw new commander_1.InvalidArgumentError("must be a positive integer");
    }
    return parsed;
}
const program = new commander_1.Command();
program
    .name("test262")
    .description("Run the prepared Test262 corpus against esm-sync")
    .option("--filter <path>", "include paths containing this text (case-insensitive)")
    .option("--exclude-feature <feature>", "exclude Test262 cases tagged with this feature (repeatable)", (feature, features) => [...features, feature], [])
    .option("--limit <count>", "run at most this many matching cases", positiveInteger)
    .option("--report <file>", "write a machine-readable JSON result report")
    .option("--reporter <name>", "Node test reporter: spec, dot, or tap", "spec")
    .parse(process.argv);
const options = program.opts();
if (!["spec", "dot", "tap"].includes(options.reporter)) {
    program.error("--reporter must be spec, dot, or tap");
}
if (options.filter !== undefined && options.filter.trim() === "") {
    program.error("--filter must not be empty");
}
if (options.excludeFeature.some((feature) => feature.trim() === "")) {
    program.error("--exclude-feature must not be empty");
}
const rootPath = node_path_1.default.resolve(__dirname, "..");
const testPath = node_path_1.default.join(rootPath, "test/test262.mjs");
const env = Object.assign(Object.assign({}, process.env), { TEST262_FILTER: (_a = options.filter) !== null && _a !== void 0 ? _a : "", TEST262_EXCLUDE_FEATURES: JSON.stringify(options.excludeFeature), TEST262_LIMIT: options.limit === undefined ? "" : String(options.limit), TEST262_REPORT: options.report === undefined ? "" : node_path_1.default.resolve(options.report) });
if (options.filter)
    console.info(`Test262 path filter: ${(0, node_util_1.styleText)("cyan", options.filter)}`);
if (options.excludeFeature.length > 0) {
    console.info(`Test262 excluding features: ${(0, node_util_1.styleText)("cyan", options.excludeFeature.join(", "))}`);
}
if (options.limit)
    console.info(`Test262 case limit: ${(0, node_util_1.styleText)("cyan", String(options.limit))}`);
if (options.report)
    console.info(`Test262 JSON report: ${(0, node_util_1.styleText)("cyan", env.TEST262_REPORT)}`);
const child = (0, node_child_process_1.spawn)(process.execPath, ["--test", `--test-reporter=${options.reporter}`, testPath], {
    cwd: rootPath,
    env,
    stdio: "inherit"
});
child.once("error", (error) => {
    console.error(error);
    process.exitCode = 1;
});
child.once("close", (code, signal) => {
    if (signal)
        console.error(`Test262 runner terminated by signal ${signal}`);
    process.exitCode = code !== null && code !== void 0 ? code : 1;
});
