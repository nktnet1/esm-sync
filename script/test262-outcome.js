"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const strict_1 = __importDefault(require("node:assert/strict"));
const phases = new Set(["parse", "resolution", "runtime"]);
function assertTest262Outcome(filename, stdout, expectedError, expectedPhase) {
    if (!stdout.trim()) {
        strict_1.default.equal(expectedError, undefined, `${filename}: expected ${expectedError}, but no error occurred`);
        return;
    }
    let result;
    try {
        result = JSON.parse(stdout.trim());
    }
    catch (_a) {
        throw new Error(`${filename}: invalid Test262 error report`);
    }
    strict_1.default.ok(result !== null && typeof result === "object", `${filename}: invalid Test262 error report`);
    strict_1.default.ok(typeof result.name === "string" &&
        result.name.length > 0, `${filename}: invalid error name`);
    strict_1.default.ok(phases.has(result.phase), `${filename}: unknown error phase: ${result.phase}`);
    const detail = result.message
        ? `: ${result.message}`
        : "";
    strict_1.default.equal(result.name, expectedError, `${filename}: unexpected error type${detail}`);
    strict_1.default.equal(result.phase, expectedPhase, `${filename}: unexpected error phase${detail}`);
}
module.exports = { assertTest262Outcome };
