"use strict";
// Error.cause is deliberately unknown in Node's public event types.
function errorDetail(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    const detail = value;
    return detail.stack || detail.message;
}
async function* reporter(source) {
    for await (const { type, data } of source) {
        let record;
        if (type === "test:summary") {
            record = { kind: "summary", counts: data.counts, success: data.success };
        }
        else if (type === "test:pass" || type === "test:fail") {
            const { details } = data;
            const error = ("error" in details ? details.error : undefined);
            if (details.type === "test") {
                const cause = error?.cause;
                record = {
                    kind: "test",
                    name: data.name,
                    line: data.line,
                    column: data.column,
                    status: data.skip ? "skip" : type === "test:pass" ? "pass" : "fail",
                    error: errorDetail(cause) || error?.message || error?.cause || null
                };
            }
            else if (type === "test:pass" && data.skip) {
                // node:test does not emit child results for an entirely skipped suite.
                record = { kind: "skipped-suite", line: data.line, column: data.column };
            }
            else if (type === "test:fail" && error?.failureType !== "subtestsFailed") {
                record = {
                    kind: "suite-failure",
                    name: data.name,
                    error: errorDetail(error?.cause) || "Suite failed"
                };
            }
        }
        if (record) {
            yield `ESM_SYNC_TEST_EVENT ${JSON.stringify(record)}\n`;
        }
    }
}
module.exports = reporter;
