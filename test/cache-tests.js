const { describe, it, before, beforeEach, after } = globalThis.__esmSyncNativeTest
import assert from "assert"
import execa from "execa"
import fs from "fs-extra"
import path from "path"
import process from "process"

const isAppVeyor = Reflect.has(process.env, "APPVEYOR")

const canTestCache = ! isAppVeyor

const testPath = path.resolve(".")
let sandboxPath
let fixturePath
let mainFilename
let loaderCachePath
let fixtureCachePath

const expectedCacheCount = 5

function countFiles(dirPath) {
  return fs.existsSync(dirPath)
    ? fs.readdirSync(dirPath).length
    : 0
}

function node(args, env) {
  return execa(process.execPath, args, {
    cwd: testPath,
    // Consumer defaults belong to the copied package, not to the native
    // suite runner's own isolated module cache.
    env: { ESM_OPTIONS: "{cjs:false,mode:'auto'}", ...env },
    reject: false
  })
}

function runMain(filename, env) {
  return node([
    "-r", path.join(sandboxPath, "index.js"),
    filename
  ], env)
}

describe("cache tests", { skip: !canTestCache }, () => {
  before(async () => {
    // esm.js writes its own bootstrap cache at a fixed package-relative path,
    // even with options.cache:false or an isolated module cache. Test default
    // paths in a private package copy, rather than moving/removing a directory
    // that other Vitest files' subprocesses may still populate on exit.
    const parent = path.resolve("env/native-cache", process.env.ESM_ENV || "default")
    await fs.ensureDir(parent)
    sandboxPath = await fs.mkdtemp(path.join(parent, "cache-suite-"))
    fixturePath = path.join(sandboxPath, "test/fixture/cache")
    mainFilename = path.join(fixturePath, "main.mjs")
    loaderCachePath = path.join(sandboxPath, "node_modules/.cache/esm")
    fixtureCachePath = path.join(fixturePath, ".cache")
    await Promise.all([
      ...["index.js", "esm.js", "package.json", "esm/loader.js"].map(filename =>
        fs.copy(path.resolve("..", filename), path.join(sandboxPath, filename))),
      ...["index.js", "main.mjs", "a.mjs", "b.mjs"].map(filename =>
        fs.copy(path.resolve("fixture/cache", filename), path.join(fixturePath, filename)))
    ])
  })

  // Cache contents are disposable. Removing them directly avoids Windows
  // Recycle Bin locking/races when child processes immediately rebuild caches.
  beforeEach(() =>
    Promise.all([loaderCachePath, fixtureCachePath].map((dirPath) => fs.remove(dirPath)))
  )

  after(() => sandboxPath ? fs.remove(sandboxPath) : undefined)

  it("should not recreate cache on restart", () =>
    [0, 1]
      .reduce((promise) =>
        promise
          .then(() =>
            runMain(mainFilename, {
              ESM_OPTIONS: JSON.stringify({ cache: fixtureCachePath })
            })
          )
          .then(() => assert.strictEqual(countFiles(fixtureCachePath), expectedCacheCount))
      , Promise.resolve())
  )

  describe("should create cache", () => {
    it("should work from the `esm` bridge", () =>
      node([fixturePath])
        .then(({ stdout }) => assert.ok(stdout.includes("cache:true")))
        .then(() => assert.strictEqual(countFiles(loaderCachePath), expectedCacheCount))
    )

    it("should work from the Node CLI", () =>
      runMain(mainFilename)
        .then(({ stdout }) => assert.ok(stdout.includes("cache:true")))
        .then(() => assert.strictEqual(countFiles(loaderCachePath), expectedCacheCount))
    )

    it("should not insert `yield` into cache files", () =>
      runMain(mainFilename)
        .then(() => {
          const filenames = fs
            .readdirSync(loaderCachePath)
            .filter((filename) => path.extname(filename) === ".js")
            .map((filename) => path.resolve(loaderCachePath, filename))

          for (const filename of filenames) {
            const content = fs.readFileSync(filename, "utf8")

            assert.strictEqual(content.includes("yield"), false)
          }
        })
    )
  })

  describe("should support `options.cache` paths", () => {
    it("should work from the `esm` bridge", () =>
      node([fixturePath], {
        ESM_OPTIONS: JSON.stringify({ cache: fixtureCachePath })
      })
      .then(({ stdout }) => assert.ok(stdout.includes("cache:true")))
      .then(() => assert.strictEqual(countFiles(fixtureCachePath), expectedCacheCount))
    )

    it("should work from the Node CLI", () =>
      runMain(mainFilename, {
        ESM_OPTIONS: JSON.stringify({ cache: fixtureCachePath })
      })
      .then(({ stdout }) => assert.ok(stdout.includes("cache:true")))
      .then(() => assert.strictEqual(countFiles(fixtureCachePath), expectedCacheCount))
    )
  })

  describe("should create cache when enabled", () => {
    it("should work from the `esm` bridge", () =>
      node([fixturePath], {
        ESM_OPTIONS: "{cache:1}"
      })
      .then(({ stdout }) => assert.ok(stdout.includes("cache:true")))
      .then(() => assert.strictEqual(countFiles(loaderCachePath), expectedCacheCount))
    )

    it("should work from the Node CLI", () =>
      runMain(mainFilename, {
        ESM_OPTIONS: "{cache:1}"
      })
      .then(({ stdout }) => assert.ok(stdout.includes("cache:true")))
      .then(() => assert.strictEqual(countFiles(loaderCachePath), expectedCacheCount))
    )
  })

  describe("should not create cache when disabled", () => {
    it("should work from the `esm` bridge", () =>
      node([fixturePath], {
        ESM_OPTIONS: "{cache:0}"
      })
      .then(({ stdout }) => assert.ok(stdout.includes("cache:true")))
      .then(() => assert.strictEqual(countFiles(loaderCachePath), 2))
    )

    it("should work from the Node CLI", () =>
      runMain(mainFilename, {
        ESM_OPTIONS: "{cache:0}"
      })
      .then(({ stdout }) => assert.ok(stdout.includes("cache:true")))
      .then(() => assert.strictEqual(countFiles(loaderCachePath), 2))
    )
  })
})
