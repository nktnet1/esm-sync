import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, realpathSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { type HostInput, hostRuntimeCache } from "./host-runtimes.ts"
import { safeTarget } from "./verify-hosts-container.ts"

export function extractHostPackage(input: HostInput, strip = 1): string {
  const archive = realpathSync(path.join(hostRuntimeCache, input.file))
  assert.equal(createHash("sha256").update(readFileSync(archive)).digest("hex"), input.sha256)
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-host-package-")))
  const names = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" })
  assert.equal(names.status, 0, names.error?.message ?? names.stderr)
  for (const name of names.stdout.split("\n").filter(Boolean)) safeTarget(directory, name)
  const kinds = spawnSync("tar", ["-tvzf", archive], { encoding: "utf8" })
  assert.equal(kinds.status, 0, kinds.error?.message ?? kinds.stderr)
  assert.ok(
    kinds.stdout
      .split("\n")
      .filter(Boolean)
      .every((line) => line[0] === "-" || line[0] === "d"),
    "Package archive contains a link or special file"
  )
  const result = spawnSync(
    "tar",
    ["-xzf", archive, "--no-same-owner", `--strip-components=${strip}`, "-C", directory],
    { encoding: "utf8" }
  )
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  return directory
}
