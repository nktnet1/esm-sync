import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { hostUsbNativePatch } from "./host-runtimes.ts"

export function patchHostUsb(directory: string): void {
  const project = realpathSync(directory)
  const patch = fileURLToPath(new URL("../../patches/" + hostUsbNativePatch.file, import.meta.url))
  const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
  assert.equal(digest(patch), hostUsbNativePatch.sha256, "USB patch checksum mismatch")
  const targets = hostUsbNativePatch.files.map((entry) => {
    const file = realpathSync(path.join(project, entry.path))
    const relative = path.relative(project, file)
    assert.ok(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
      "USB source escapes package"
    )
    assert.equal(digest(file), entry.before, "Unexpected USB source: " + entry.path)
    return { ...entry, file }
  })
  const result = spawnSync(
    "patch",
    ["--batch", "--fuzz=0", "--no-backup-if-mismatch", "-p1", "-i", patch],
    {
      cwd: project,
      encoding: "utf8"
    }
  )
  assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  for (const entry of targets)
    assert.equal(
      digest(entry.file),
      entry.after,
      "Patched USB source checksum mismatch: " + entry.path
    )
}
