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
const execa_1 = __importDefault(require("execa"));
const fs_extra_1 = __importDefault(require("fs-extra"));
const globby_1 = __importDefault(require("globby"));
const path_1 = __importDefault(require("path"));
const test262_parser_1 = __importDefault(require("test262-parser"));
const YAML_END = "---*/";
const rootPath = path_1.default.resolve(__dirname, "..");
const vendorPath = path_1.default.resolve(rootPath, "test/vendor");
const test262Path = path_1.default.resolve(vendorPath, "test262");
const stagingPath = path_1.default.resolve(vendorPath, ".test262-staging");
const repoPath = path_1.default.resolve(stagingPath, "checkout");
const preparedPath = path_1.default.resolve(stagingPath, "prepared");
const revisionPath = ".prepared-revision";
const test262URL = "https://github.com/tc39/test262.git";
// Update this only as an intentional fixture change: the Test262 corpus is
// not part of the standard Vitest run and must not silently drift with main.
const TEST262_REVISION = "d53ebc8b1931d9f1541e43d59650776e4b766248";
const testDirs = [
    "harness",
    "test/language/export",
    "test/language/expressions/dynamic-import",
    "test/language/expressions/import.meta",
    "test/language/import",
    "test/language/module-code",
    "test/language/statements/using",
    "test/language/statements/await-using"
];
function git(cwd, args) {
    return (0, execa_1.default)("git", args, { cwd });
}
function isPrepared(directory = test262Path) {
    const markerPath = path_1.default.resolve(directory, revisionPath);
    const harnessPath = path_1.default.resolve(directory, "harness/assert.js");
    if (!fs_extra_1.default.existsSync(markerPath) || !fs_extra_1.default.existsSync(harnessPath)) {
        return false;
    }
    if (!testDirs.every((dir) => fs_extra_1.default.existsSync(path_1.default.resolve(directory, dir)))) {
        return false;
    }
    return fs_extra_1.default.readFileSync(markerPath, "utf8").trim() === TEST262_REVISION;
}
function prepareCorpus() {
    return __awaiter(this, void 0, void 0, function* () {
        yield fs_extra_1.default.ensureDir(repoPath);
        yield git(repoPath, ["init", "--quiet"]);
        // A depth-one clone of main cannot reliably check out an older pinned SHA.
        // Fetch the exact revision instead; never fall back to the moving branch.
        yield git(repoPath, [
            "fetch",
            "--quiet",
            "--no-tags",
            "--depth",
            "1",
            test262URL,
            TEST262_REVISION
        ]);
        yield git(repoPath, ["checkout", "--quiet", "--detach", "FETCH_HEAD"]);
        const { stdout: actualRevision } = yield git(repoPath, ["rev-parse", "HEAD"]);
        if (actualRevision !== TEST262_REVISION) {
            throw new Error(`Test262 revision mismatch: expected ${TEST262_REVISION}, got ${actualRevision}`);
        }
        for (const testDir of testDirs) {
            const source = path_1.default.resolve(repoPath, testDir);
            const destination = path_1.default.resolve(preparedPath, testDir);
            if (!(yield fs_extra_1.default.pathExists(source))) {
                throw new Error(`Pinned Test262 revision is missing ${testDir}`);
            }
            yield fs_extra_1.default.ensureDir(path_1.default.dirname(destination));
            yield fs_extra_1.default.move(source, destination);
        }
        const test262Tests = globby_1.default.sync(["test/language/**/*.js", "!**/*_FIXTURE.js"], {
            absolute: true,
            cwd: preparedPath
        });
        for (const filename of test262Tests) {
            let content = fs_extra_1.default.readFileSync(filename, "utf8");
            const { attrs } = test262_parser_1.default.parseFile(content);
            const features = attrs.features || [];
            const { flags } = attrs;
            if (!flags.module && !features.includes("dynamic-import")) {
                fs_extra_1.default.unlinkSync(filename);
                continue;
            }
            // Follow Test262 guidance for strict mode.
            // https://github.com/tc39/test262/blob/main/INTERPRETING.md#strict-mode
            content = (flags.onlyStrict ? '"use strict";\n' : "") + content;
            const pos = content.indexOf(YAML_END);
            const pragma = '"use ' + (flags.module ? "module" : "script") + '";';
            if (pos === -1) {
                content = pragma + "\n" + content;
            }
            else {
                const start = pos + YAML_END.length;
                content = content.slice(0, start) + "\n" + pragma + "\n" + content.slice(start);
            }
            fs_extra_1.default.writeFileSync(filename, content);
        }
        yield fs_extra_1.default.writeFile(path_1.default.resolve(preparedPath, revisionPath), TEST262_REVISION + "\n");
    });
}
function setupTest262() {
    return __awaiter(this, void 0, void 0, function* () {
        if (isPrepared()) {
            console.log(`[test262] revision ${TEST262_REVISION} is already prepared.`);
            return;
        }
        // Never replace a previously prepared corpus until fetching and processing
        // the new revision succeeds. A failed preparation leaves no valid marker.
        yield fs_extra_1.default.remove(stagingPath);
        try {
            yield prepareCorpus();
            yield fs_extra_1.default.remove(test262Path);
            yield fs_extra_1.default.move(preparedPath, test262Path);
            console.log(`[test262] prepared revision ${TEST262_REVISION}.`);
        }
        finally {
            yield fs_extra_1.default.remove(stagingPath);
        }
    });
}
const preparedTest262 = Object.assign(setupTest262, { isPrepared, revision: TEST262_REVISION });
module.exports = preparedTest262;
