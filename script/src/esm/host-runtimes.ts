import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { createReadStream, existsSync, realpathSync } from "node:fs"
import { mkdir, open, realpath, rename, rm, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { styleText } from "node:util"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
export const hostRuntimeCache = path.join(root, ".cache/host-runtimes")

export type HostRuntime = {
  issue: 867 | 915
  file: string
  url: string
  sha256: string
  maxBytes: number
}

// Digests are from the supplied, previously verified historical runtime archives.
// Source reproductions and get-port are checked-in fixtures, not downloads.
export const hostRuntimes: readonly HostRuntime[] = [
  {
    issue: 867,
    file: "electron-v8.0.0-linux-x64.zip",
    url: "https://github.com/electron/electron/releases/download/v8.0.0/electron-v8.0.0-linux-x64.zip",
    sha256: "b457a2ece83bb8a2efea42e75403740cbba051a64e325288760046b8999dd1c9",
    maxBytes: 100 * 1024 * 1024
  },
  {
    issue: 915,
    file: "vscode-1.66.2-linux-x64.tar.gz",
    url: "https://update.code.visualstudio.com/1.66.2/linux-x64/stable",
    sha256: "df8aea83c49b44aa5708f7126539b57dbbe9ed9817f0bf87f5a316ce2dca20ea",
    maxBytes: 160 * 1024 * 1024
  }
]

async function checksum(file: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file) as AsyncIterable<Buffer>) hash.update(chunk)
  return hash.digest("hex")
}

export async function downloadHostRuntime(
  input: HostRuntime,
  destination: string,
  request: typeof fetch = fetch
): Promise<"cached" | "downloaded"> {
  assert.equal(path.basename(input.file), input.file, "Runtime filename must be a basename")
  assert.ok(!/[\\:]/.test(input.file) && input.file !== "." && input.file !== "..")
  assert.match(input.sha256, /^[a-f0-9]{64}$/)
  await mkdir(destination, { recursive: true })
  const directory = await realpath(destination)
  const target = path.join(directory, input.file)
  if (existsSync(target) && (await checksum(target)) === input.sha256) return "cached"

  let failure: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const temporary = path.join(directory, `.${input.file}.${randomUUID()}.part`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error("Download timed out")), 120_000)
    timer.unref()
    try {
      const response = await request(input.url, { signal: controller.signal })
      assert.ok(response.ok, `HTTP ${response.status} downloading ${input.url}`)
      assert.ok(response.body, `No response body for ${input.file}`)
      const length = response.headers.get("content-length")
      if (length !== null) {
        assert.match(length, /^\d+$/, "Invalid download Content-Length")
        assert.ok(Number(length) <= input.maxBytes, `Download exceeds size limit: ${input.file}`)
      }
      const handle = await open(temporary, "wx")
      const reader = response.body.getReader()
      const hash = createHash("sha256")
      let bytes = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          assert.ok(bytes <= input.maxBytes, `Download exceeds size limit: ${input.file}`)
          hash.update(value)
          await handle.writeFile(value)
        }
        if (length !== null) assert.equal(bytes, Number(length), "Incomplete runtime download")
        assert.equal(hash.digest("hex"), input.sha256, `Runtime checksum mismatch: ${input.file}`)
      } finally {
        reader.releaseLock()
        await handle.close()
      }
      await rename(temporary, target)
      return "downloaded"
    } catch (error) {
      failure = error
    } finally {
      clearTimeout(timer)
      controller.abort()
      await rm(temporary, { force: true })
    }
  }
  throw new Error(`Cannot download ${input.file} after 3 attempts: ${String(failure)}`)
}

export async function downloadHostRuntimes(destination = hostRuntimeCache): Promise<void> {
  // Await every independent download before emitting the complete provenance file.
  const results = await Promise.allSettled(
    hostRuntimes.map(async (input) => {
      console.log(`${styleText("cyan", "RUNTIME")} ${input.file}`)
      const result = await downloadHostRuntime(input, destination)
      console.log(`${styleText("green", result.toUpperCase())} ${input.file}`)
    })
  )
  const failures = results.filter((result) => result.status === "rejected")
  assert.equal(failures.length, 0, failures.map((result) => String(result.reason)).join("\n"))
  const directory = await realpath(destination)
  const inputs = await Promise.all(
    hostRuntimes.map(async (input) => ({
      ...input,
      bytes: (await stat(path.join(directory, input.file))).size
    }))
  )
  const file = await open(path.join(directory, "inputs.json"), "w")
  try {
    await file.writeFile(JSON.stringify({ platform: "linux/amd64", runtimes: inputs }, null, 2))
  } finally {
    await file.close()
  }
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  downloadHostRuntimes().catch((error: unknown) => {
    console.error(`${styleText("red", "FAIL")} ${String(error)}`)
    process.exitCode = 1
  })
}
