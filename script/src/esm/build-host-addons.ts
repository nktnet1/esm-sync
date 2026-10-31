import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { hostAddonHeaders, hostRuntimeCache } from "./host-runtimes.ts"
import { safeTarget } from "./verify-hosts-container.ts"

const root = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."))
const hostAddonCache = path.join(root, ".cache/host-addons")

function buildHostAddons(): void {
  const archive = realpathSync(path.join(hostRuntimeCache, hostAddonHeaders.file))
  assert.equal(
    createHash("sha256").update(readFileSync(archive)).digest("hex"),
    hostAddonHeaders.sha256,
    "Electron header checksum mismatch"
  )
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-host-headers-")))
  const listing = spawnSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  })
  assert.equal(listing.status, 0, listing.error?.message ?? listing.stderr)
  for (const name of listing.stdout.split("\n").filter(Boolean)) safeTarget(directory, name)
  const kinds = spawnSync("tar", ["-tvzf", archive], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024
  })
  assert.equal(kinds.status, 0, kinds.error?.message ?? kinds.stderr)
  assert.ok(
    kinds.stdout
      .split("\n")
      .filter(Boolean)
      .every((line) => line[0] === "-" || line[0] === "d"),
    "Header archive contains a link or special file"
  )
  const extract = spawnSync(
    "tar",
    ["-xzf", archive, "--no-same-owner", "--strip-components=1", "-C", directory],
    { encoding: "utf8" }
  )
  assert.equal(extract.status, 0, extract.error?.message ?? extract.stderr)
  mkdirSync(hostAddonCache, { recursive: true })
  const target = realpathSync(hostAddonCache)
  const source = realpathSync(path.join(root, "test/fixture/hosts/issue-817/addon.cc"))
  const builds = [
    {
      name: "mismatch",
      headers: path.resolve(path.dirname(realpathSync(process.execPath)), "../include/node"),
      abi: 137
    },
    { name: "compatible", headers: path.join(directory, "include/node"), abi: 70 }
  ]
  const outputs: { name: string; abi: number; sha256: string; command: string[] }[] = []
  for (const build of builds) {
    assert.ok(existsSync(path.join(build.headers, "node.h")), "Missing native addon headers")
    assert.match(
      readFileSync(path.join(build.headers, "node_version.h"), "utf8"),
      new RegExp("#define NODE_MODULE_VERSION\\s+" + build.abi + "\\b"),
      "Unexpected native addon ABI"
    )
    const file = path.join(target, build.name + ".node")
    const command = ["-shared", "-fPIC", "-std=c++20", "-I", build.headers, source, "-o", file]
    const result = spawnSync("g++", command, { encoding: "utf8" })
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
    outputs.push({
      name: build.name,
      abi: build.abi,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
      command: ["g++", ...command]
    })
    console.log("ADDON", build.name, "ABI", build.abi)
  }
  writeFileSync(
    path.join(target, "builds.json"),
    JSON.stringify(
      { compiler: spawnSync("g++", ["--version"], { encoding: "utf8" }).stdout, outputs },
      null,
      2
    )
  )
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
)
  buildHostAddons()
