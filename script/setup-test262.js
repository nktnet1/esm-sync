"use strict"

const execa = require("execa")
const fs = require("fs-extra")
const globby = require("globby")
const path = require("path")
const test262Parser = require("test262-parser")

const YAML_END = "---*/"

const rootPath = path.resolve(__dirname, "..")
const vendorPath = path.resolve(rootPath, "test/vendor")
const test262Path = path.resolve(vendorPath, "test262")
const stagingPath = path.resolve(vendorPath, ".test262-staging")
const repoPath = path.resolve(stagingPath, "checkout")
const preparedPath = path.resolve(stagingPath, "prepared")
const revisionPath = ".prepared-revision"
const test262URL = "https://github.com/tc39/test262.git"

// Update this only as an intentional fixture change: the Test262 corpus is
// not part of the standard Vitest run and must not silently drift with main.
const TEST262_REVISION = "d53ebc8b1931d9f1541e43d59650776e4b766248"

const testDirs = [
  "harness",
  "test/language/export",
  "test/language/expressions/dynamic-import",
  "test/language/expressions/import.meta",
  "test/language/import",
  "test/language/module-code",
  "test/language/statements/using",
  "test/language/statements/await-using"
]

function git(cwd, args) {
  return execa("git", args, { cwd })
}

function isPrepared(directory = test262Path) {
  const markerPath = path.resolve(directory, revisionPath)
  const harnessPath = path.resolve(directory, "harness/assert.js")

  if (!fs.existsSync(markerPath) || !fs.existsSync(harnessPath)) {
    return false
  }

  if (!testDirs.every((dir) => fs.existsSync(path.resolve(directory, dir)))) {
    return false
  }

  return fs.readFileSync(markerPath, "utf8").trim() === TEST262_REVISION
}

async function prepareCorpus() {
  await fs.ensureDir(repoPath)
  await git(repoPath, ["init", "--quiet"])
  // A depth-one clone of main cannot reliably check out an older pinned SHA.
  // Fetch the exact revision instead; never fall back to the moving branch.
  await git(repoPath, [
    "fetch",
    "--quiet",
    "--no-tags",
    "--depth",
    "1",
    test262URL,
    TEST262_REVISION
  ])
  await git(repoPath, ["checkout", "--quiet", "--detach", "FETCH_HEAD"])

  const { stdout: actualRevision } = await git(repoPath, ["rev-parse", "HEAD"])
  if (actualRevision !== TEST262_REVISION) {
    throw new Error(
      `Test262 revision mismatch: expected ${TEST262_REVISION}, got ${actualRevision}`
    )
  }

  for (const testDir of testDirs) {
    const source = path.resolve(repoPath, testDir)
    const destination = path.resolve(preparedPath, testDir)

    if (!(await fs.pathExists(source))) {
      throw new Error(`Pinned Test262 revision is missing ${testDir}`)
    }

    await fs.ensureDir(path.dirname(destination))
    await fs.move(source, destination)
  }

  const test262Tests = globby.sync(["test/language/**/*.js", "!**/*_FIXTURE.js"], {
    absolute: true,
    cwd: preparedPath
  })

  for (const filename of test262Tests) {
    let content = fs.readFileSync(filename, "utf8")
    const { attrs } = test262Parser.parseFile(content)
    const features = attrs.features || []
    const { flags } = attrs

    if (!flags.module && !features.includes("dynamic-import")) {
      fs.unlinkSync(filename)
      continue
    }

    // Follow Test262 guidance for strict mode.
    // https://github.com/tc39/test262/blob/main/INTERPRETING.md#strict-mode
    content = (flags.onlyStrict ? '"use strict";\n' : "") + content

    const pos = content.indexOf(YAML_END)
    const pragma = '"use ' + (flags.module ? "module" : "script") + '";'

    if (pos === -1) {
      content = pragma + "\n" + content
    } else {
      const start = pos + YAML_END.length
      content = content.slice(0, start) + "\n" + pragma + "\n" + content.slice(start)
    }

    fs.writeFileSync(filename, content)
  }

  await fs.writeFile(path.resolve(preparedPath, revisionPath), TEST262_REVISION + "\n")
}

async function setupTest262() {
  if (isPrepared()) {
    console.log(`[test262] revision ${TEST262_REVISION} is already prepared.`)
    return
  }

  // Never replace a previously prepared corpus until fetching and processing
  // the new revision succeeds. A failed preparation leaves no valid marker.
  await fs.remove(stagingPath)
  try {
    await prepareCorpus()
    await fs.remove(test262Path)
    await fs.move(preparedPath, test262Path)
    console.log(`[test262] prepared revision ${TEST262_REVISION}.`)
  } finally {
    await fs.remove(stagingPath)
  }
}

module.exports = setupTest262
module.exports.isPrepared = isPrepared
module.exports.revision = TEST262_REVISION
