import { execFileSync, spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { changedFiles, classifyChanges, fullPlan } from "../../script/src/esm/ci-changes.ts"
import { runtimeTests } from "../../config/test-suites.ts"

const none = { library: false, tooling: false, production: false, audit: false }
const tooling = { ...none, tooling: true }
const library = { ...tooling, library: true, production: true }
const root = realpathSync(fileURLToPath(new URL("../../", import.meta.url)))

describe("CI change selection", () => {
  it("skips execution for documentation-only and empty changes", () => {
    expect(classifyChanges([])).toStrictEqual(none)
    expect(
      classifyChanges(["README.md", "docs/host-integrations.md", "script/RELEASING.md"])
    ).toStrictEqual(none)
  })

  it("uses the same runtime classification as Vitest, with tooling as the default for new tests", () => {
    for (const filename of runtimeTests)
      expect(classifyChanges([filename]), filename).toStrictEqual(library)
    expect(classifyChanges(["test/vitest/new-tool.test.ts"])).toStrictEqual(tooling)
    expect(classifyChanges(["test/vitest/ci-changes.test.ts", "biome.json"])).toStrictEqual(tooling)
    expect(classifyChanges(["script/src/esm/ci-changes.ts"])).toStrictEqual(tooling)
    expect(classifyChanges(["script/src/benchmark-startup.ts"])).toStrictEqual(tooling)
  })

  it.each([
    "src/index.ts",
    "native/sync-await.cc",
    "tsdown.config.mts",
    "vitest.config.ts",
    "config/test-suites.ts",
    "script/src/build.ts",
    "script/src/test.ts",
    "test/fixture/value.mjs",
    "test/vitest/helpers/run-node.ts",
    "test/vitest/setup.ts",
    "test/vitest/native-cases.ts",
    ".github/actions/prepare-fixtures/action.yaml",
    ".github/workflows/pipeline.yaml",
    ".github/scripts/run-library.ts",
    ".github/workflows/new.yaml",
    "index.d.ts",
    "unknown-input"
  ])("keeps the matrix for shared or unknown input %s", (filename) => {
    expect(classifyChanges([filename])).toStrictEqual(library)
  })

  it("runs registry verification for release inputs without repeating the platform matrix", () => {
    for (const filename of [
      "script/src/esm/prepare-release-package.ts",
      "script/src/esm/release-policy.ts",
      "script/src/package-manifest.ts",
      "script/src/test-packed.ts",
      ".github/workflows/release.yaml",
      ".github/workflows/publish.yaml"
    ])
      expect(classifyChanges([filename]), filename).toStrictEqual({ ...tooling, production: true })
    expect(classifyChanges([".github/workflows/codeql.yaml"])).toStrictEqual(tooling)
    expect(classifyChanges(["docs/readme.md", "src/runtime.ts", "biome.json"])).toStrictEqual(
      library
    )
  })

  it.each(["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])(
    "audits dependency input %s",
    (filename) => {
      expect(classifyChanges([filename])).toStrictEqual(fullPlan)
    }
  )

  it("compares complete pushes and PR merge bases, including more than 300 paths and renamed/deleted files", () => {
    const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-sync-ci-diff-")))
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" }
      }).trim()
    const write = (name: string, source = name) => {
      mkdirSync(path.dirname(path.join(directory, name)), { recursive: true })
      writeFileSync(path.join(directory, name), source)
    }
    const commit = () => {
      git("add", ".")
      git("commit", "--quiet", "-m", "fixture")
      return git("rev-parse", "HEAD")
    }
    try {
      git("init", "--quiet", "-b", "main")
      git("config", "user.name", "CI fixture")
      git("config", "user.email", "ci@example.invalid")
      git("config", "commit.gpgsign", "false")
      write("test/vitest/upstream-regressions.test.ts")
      const base = commit()
      git("checkout", "--quiet", "-b", "topic")
      for (let index = 0; index < 305; index++) write(`docs/${index}.md`)
      write("test/vitest/new-tool.test.ts")
      const first = commit()
      write("docs/second.md")
      const head = commit()
      git("checkout", "--quiet", "main")
      write("src/unrelated-base-change.ts")
      const updatedBase = commit()

      const files = changedFiles(
        "pull_request",
        { pull_request: { base: { sha: updatedBase }, head: { sha: head } } },
        "refs/pull/1/merge",
        directory
      )!
      expect(files).toHaveLength(307)
      expect(files).toContain("test/vitest/new-tool.test.ts")
      expect(files).not.toContain("src/unrelated-base-change.ts")
      expect(classifyChanges(files)).toStrictEqual(tooling)
      expect(
        changedFiles("push", { before: base, after: head }, "refs/heads/main", directory)
      ).toStrictEqual(files)
      expect(
        classifyChanges(
          changedFiles("push", { before: first, after: head }, "refs/heads/main", directory)!
        )
      ).toStrictEqual(none)

      git("checkout", "--quiet", "topic")
      const moved = "docs/moved file\nwith newline.md"
      renameSync(
        path.join(directory, "test/vitest/upstream-regressions.test.ts"),
        path.join(directory, moved)
      )
      const renamed = commit()
      const renameFiles = changedFiles(
        "push",
        { before: head, after: renamed },
        "refs/heads/main",
        directory
      )!
      expect(renameFiles.sort()).toStrictEqual(
        [moved, "test/vitest/upstream-regressions.test.ts"].sort()
      )
      expect(classifyChanges(renameFiles)).toStrictEqual(library)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it("forces full checks for manual/reusable releases and rejects missing or unsafe comparison commits", () => {
    for (const event of ["workflow_dispatch", "workflow_call"])
      expect(changedFiles(event, {}, "refs/heads/main", root)).toBeNull()
    expect(changedFiles("push", {}, "refs/tags/v3.4.0", root)).toBeNull()
    expect(changedFiles("pull_request", {}, "refs/pull/1/merge", root, true)).toBeNull()
    for (const before of [undefined, "0".repeat(40), "--output=some-file", "not-a-sha"]) {
      expect(() =>
        changedFiles(
          "push",
          { ...(before === undefined ? {} : { before }), after: "a".repeat(40) },
          "refs/heads/main",
          root
        )
      ).toThrow("comparison commit")
    }
    expect(() => changedFiles("schedule", {}, "refs/heads/main", root)).toThrow(
      "Unrecognised CI event"
    )
    expect(() =>
      changedFiles(
        "push",
        { before: "a".repeat(40), after: "b".repeat(40) },
        "refs/heads/main",
        root
      )
    ).toThrow()
  })

  it("emits full job outputs on malformed payloads or unavailable history instead of silently skipping", () => {
    const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-sync-ci-output-")))
    try {
      const event = path.join(directory, "event.json")
      const output = path.join(directory, "outputs")
      for (const payload of [
        "{invalid",
        JSON.stringify({ before: "a".repeat(40), after: "b".repeat(40) })
      ]) {
        writeFileSync(event, payload)
        writeFileSync(output, "")
        const result = spawnSync(
          process.execPath,
          [path.join(root, "script/src/esm/ci-changes.ts")],
          {
            cwd: root,
            encoding: "utf8",
            timeout: 10_000,
            env: {
              ...process.env,
              GITHUB_EVENT_PATH: event,
              GITHUB_OUTPUT: output,
              GITHUB_EVENT_NAME: "push",
              GITHUB_REF: "refs/heads/main",
              ESM_CI_FULL: "false"
            }
          }
        )
        expect(result.status, result.stderr).toBe(0)
        expect(result.stderr).toContain("Fallback")
        expect(readFileSync(output, "utf8")).toBe(
          "library=true\ntooling=true\nproduction=true\naudit=true\n"
        )
      }
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})
