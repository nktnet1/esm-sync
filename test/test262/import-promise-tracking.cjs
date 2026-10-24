"use strict";
const { Parser, tokenizer } = require("acorn");
// The native script loader returns the exact Promise that import() exposes.
// Test262 synchronous scripts can inspect that Promise without awaiting it;
// only that Promise's unobserved rejection is outside their completion signal.
// Annotate those expressions without replacing their values or import loader.
function instrumentNativeImports(source, observerName, runtimeName) {
    const tokens = [];
    const reader = tokenizer(source, { ecmaVersion: "latest", sourceType: "script" });
    let token;
    do {
        token = reader.getToken();
        tokens.push(token);
    } while (token.type.label !== "eof");
    // Acorn does not yet parse the source-phase import call supported by Node.
    // Replace *only in the analysis copy*, keeping all AST source offsets intact.
    const sourceCalls = new Set();
    const shadowEdits = [];
    for (let i = 0; i < tokens.length - 3; i++) {
        const head = tokens[i];
        const dot = tokens[i + 1];
        const property = tokens[i + 2];
        const paren = tokens[i + 3];
        const previous = tokens[i - 1];
        if (head.type.label === "import" &&
            previous?.type.label !== "." &&
            previous?.type.label !== "?." &&
            dot.type.label === "." &&
            property.type.label === "name" &&
            source.slice(property.start, property.end) === "source" &&
            paren.type.label === "(") {
            sourceCalls.add(head.start);
            shadowEdits.push({ start: head.start, end: head.end, text: "global" });
            shadowEdits.push({ start: property.start, end: property.end, text: "__src_" });
        }
    }
    let shadow = source;
    for (const edit of shadowEdits.sort((a, b) => b.start - a.start)) {
        shadow = shadow.slice(0, edit.start) + edit.text + shadow.slice(edit.end);
    }
    const ast = Parser.parse(shadow, { ecmaVersion: "latest", sourceType: "script" });
    const bounds = [];
    function visit(value) {
        if (!value || typeof value !== "object")
            return;
        const node = value;
        if (node.type === "ImportExpression" ||
            (node.type === "CallExpression" &&
                (sourceCalls.has(node.start) ||
                    (runtimeName !== undefined &&
                        node.callee.type === "MemberExpression" &&
                        !node.callee.computed &&
                        node.callee.object.type === "Identifier" &&
                        node.callee.object.name === runtimeName &&
                        node.callee.property.type === "Identifier" &&
                        ["i", "p", "q"].includes(node.callee.property.name))))) {
            bounds.push([node.start, node.end]);
        }
        for (const [key, value] of Object.entries(node)) {
            if (key === "start" || key === "end")
                continue;
            if (Array.isArray(value)) {
                for (const child of value)
                    visit(child);
            }
            else if (value && typeof value === "object" && "type" in value) {
                visit(value);
            }
        }
    }
    visit(ast);
    if (bounds.length === 0)
        return null;
    const prefix = `${observerName}(`;
    const edits = [];
    for (const [start, end] of bounds) {
        edits.push({ at: start, text: prefix });
        edits.push({ at: end, text: ")" });
    }
    let output = source;
    for (const edit of edits.sort((a, b) => b.at - a.at)) {
        output = output.slice(0, edit.at) + edit.text + output.slice(edit.at);
    }
    return output;
}
module.exports = { instrumentNativeImports };
