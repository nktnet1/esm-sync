import { createHash, randomUUID } from "node:crypto"
import { pathToFileURL } from "node:url"
import { exportWebContainerKit } from "../../script/src/esm/webcontainer-kit.ts"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { extractHostPackage } from "../../script/src/esm/host-archives.ts"
import { hostRuntimeCache } from "../../script/src/esm/host-runtimes.ts"
import { fullUsbProbe, usbVerdict, type UsbRun } from "../../script/src/esm/verify-host-usb.ts"
import {
  prepareProject,
  runCommand,
  runHostCase
} from "../../script/src/esm/verify-hosts-container.ts"
import {
  webcontainerApplicationPreload,
  verifyWebContainer
} from "../../script/src/esm/verify-webcontainer.ts"
import {
  prepareVmCounterfactual,
  webcontainerProbe
} from "../../script/src/esm/webcontainer-probe.ts"

async function temporary(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "esm-host-extended ü -")))
  try {
    await action(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function runs(): UsbRun[] {
  return (["require", "import"] as const).flatMap((mode) =>
    (["mismatch", "compatible"] as const).map((binary) => ({
      mode,
      binary,
      passed: true,
      code: 0,
      signal: null,
      timedOut: false,
      result: "test.json",
      log: "test.log",
      report: {}
    }))
  )
}
const abiMessage = "NODE_MODULE_VERSION 64; this version requires NODE_MODULE_VERSION 70"

describe("full USB verification verdicts", () => {
  it("requires all four healthy full-package controls before calling the failure resolved", () => {
    expect(usbVerdict(runs(), "cold").status).toBe("resolved")
    expect(() => usbVerdict(runs().slice(1), "cold")).toThrow(/Missing/)
    const duplicate = runs()
    duplicate[0] = duplicate[1]!
    expect(() => usbVerdict(duplicate, "cold")).toThrow(/Duplicate|missing/)
  })
  it("does not turn a caught ABI error followed by a native crash into a pass", () => {
    const values = runs()
    Object.assign(values[0]!, {
      passed: false,
      code: null,
      signal: "SIGSEGV",
      report: { rejections: [abiMessage] }
    })
    expect(usbVerdict(values, "cold")).toMatchObject({
      status: "blocked",
      reason: expect.stringContaining("without esm")
    })
  })
  it("does not blame native code for an unrelated startup failure", () => {
    const values = runs()
    Object.assign(values[0]!, {
      passed: false,
      code: null,
      signal: "SIGSEGV",
      report: { errors: ["Missing library"] }
    })
    expect(usbVerdict(values, "cold").status).toBe("failed")
  })
  it("does not hide a broken rebuilt control behind the native mismatch blocker", () => {
    const values = runs()
    Object.assign(values[0]!, {
      passed: false,
      code: null,
      signal: "SIGSEGV",
      report: { rejections: [abiMessage] }
    })
    values[3]!.passed = false
    expect(usbVerdict(values, "cold").status).toBe("failed")
  })
  it("fails the loader when ordinary require survives but dynamic import fails", () => {
    const values = runs()
    values[2]!.passed = false
    expect(usbVerdict(values, "warm")).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("fork's dynamic import")
    })
  })
  it("does not accept an early process exit as a demonstrated native crash", () => {
    const values = runs()
    Object.assign(values[0]!, { passed: false, report: { rejections: [abiMessage] } })
    expect(usbVerdict(values, "cold").status).toBe("failed")
  })
  it("parses both new probes in the host's script grammar", async () => {
    const acorn = await import("acorn")
    for (const source of [fullUsbProbe, webcontainerProbe, webcontainerApplicationPreload])
      expect(() => acorn.parse(source, { ecmaVersion: 2019, sourceType: "script" })).not.toThrow()
  })
})

describe("shared VM host verification", () => {
  it("exports a kit whose probe and reconstructed build run without installed dependencies or build tooling", async () =>
    temporary(async (directory) => {
      const kit = exportWebContainerKit(directory)
      expect((await readFile(kit.archive)).subarray(0, 2).toString()).toBe("PK")
      expect(existsSync(path.join(kit.directory, "node_modules"))).toBe(false)
      const manifest = JSON.parse(
        await readFile(path.join(kit.directory, "package.json"), "utf8")
      ) as Record<string, unknown>
      expect(manifest.hostVerificationKit).toBe(true)
      expect(manifest.dependencies).toBeUndefined()
      expect(manifest.devDependencies).toBeUndefined()
      const entry = pathToFileURL(
        path.join(kit.directory, "script/src/esm/verify-hosts-container.js")
      ).href
      const probeModule = pathToFileURL(
        path.join(kit.directory, "script/src/esm/webcontainer-probe.js")
      ).href
      const work = path.join(directory, "work")
      await mkdir(work)
      const source = `import {writeFileSync,realpathSync} from 'node:fs';import path from 'node:path';import {prepareProject,runHostCase} from ${JSON.stringify(entry)};import {webcontainerProbe} from ${JSON.stringify(probeModule)};
const project=await prepareProject(917,process.argv[1]);const loader=realpathSync(path.join(project,'node_modules/esm/dist/esm.js'));const probe=path.join(project,'probe.cjs');writeFileSync(probe,webcontainerProbe);const files={result:path.join(project,'result.json'),log:path.join(project,'result.log')};const identity={issue:917,phase:'disabled',nonce:'portable-kit',loader};await runHostCase(process.execPath,[probe],project,{...process.env,ESM_HOST_CHECK:JSON.stringify({...identity,result:files.result,emulate:true}),ESM_DISABLE_CACHE:'true',ESM_OPTIONS:'{"cache":false}'},identity,files,{processGroups:false});console.log('portable-kit:pass')`
      const result = await runCommand(
        process.execPath,
        ["--input-type=module", "-e", source, await realpath(work)],
        kit.directory,
        { ...process.env, NODE_OPTIONS: "", NODE_ENV: "production", ESM_ENV: "production" }
      )
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout.trim()).toBe("portable-kit:pass")
      const preload = path.join(directory, "application-preload.cjs")
      await writeFile(preload, webcontainerApplicationPreload)
      const loader = await realpath(path.join(kit.directory, "dist/esm.js"))
      const application = await runCommand(
        process.execPath,
        ["build.cjs"],
        path.join(kit.directory, "application"),
        {
          ...process.env,
          NODE_ENV: "production",
          ESM_ENV: "production",
          ESM_DISABLE_CACHE: "true",
          NODE_OPTIONS: "--require " + JSON.stringify(preload),
          ESM_WEB_APPLICATION: JSON.stringify({
            phase: "disabled",
            nonce: "portable-consumer",
            loader,
            reports: directory
          })
        }
      )
      expect(application.code, application.stderr).toBe(0)
      expect(application.stdout.trim()).toBe("webcontainer-consumer-build:pass")
      const evidence = (await readdir(directory)).find((name) =>
        /^application-disabled-\d+\.json$/.test(name)
      )!
      expect(JSON.parse(await readFile(path.join(directory, evidence), "utf8"))).toMatchObject({
        nonce: "portable-consumer",
        loader,
        factories: 1,
        globalsPreserved: true,
        exitCode: 0
      })
    }))
  it("bounds real-host subprocesses without assuming POSIX process groups", async () => {
    await expect(
      runCommand(
        process.execPath,
        ["-e", "setInterval(()=>{},1000)"],
        process.cwd(),
        process.env,
        300,
        false
      )
    ).rejects.toMatchObject({ result: { timedOut: true, signal: "SIGTERM" } })
  })
  it("runs the Docker probe through disabled, cold and genuinely warm caches", async () =>
    temporary(async (directory) => {
      const project = await prepareProject(917, directory)
      const loader = await realpath(path.join(project, "node_modules/esm/dist/esm.js"))
      const probe = path.join(project, "probe.cjs")
      await writeFile(probe, webcontainerProbe)
      const counterfactual = prepareVmCounterfactual(loader, project)
      for (const phase of ["disabled", "cold", "warm"] as const) {
        const files = {
          log: path.join(directory, phase + ".log"),
          result: path.join(directory, phase + ".json")
        }
        const identity = { issue: 917 as const, phase, nonce: randomUUID(), loader }
        const cache = path.join(project, "cache")
        const brokenResult = path.join(directory, phase + "-counterfactual.json")
        const broken = await runCommand(process.execPath, [probe], project, {
          ...process.env,
          NODE_OPTIONS: "",
          NODE_ENV: "production",
          ESM_ENV: "production",
          ESM_DISABLE_CACHE: "true",
          ESM_OPTIONS: '{"cache":false}',
          ESM_HOST_CHECK: JSON.stringify({
            ...identity,
            loader: counterfactual,
            result: brokenResult,
            emulate: true
          })
        })
        expect(broken.code, broken.stderr).not.toBe(0)
        expect(await readFile(brokenResult, "utf8")).toContain(
          "VM context preparation deleted the live Object"
        )
        expect(existsSync(path.join(cache, ".data.json"))).toBe(phase === "warm")
        const result = await runHostCase(
          process.execPath,
          [probe],
          project,
          {
            ...process.env,
            NODE_OPTIONS: "",
            ESM_ENV: "production",
            NODE_ENV: "production",
            ESM_DISABLE_CACHE: String(phase === "disabled"),
            ESM_OPTIONS: JSON.stringify({ cache: phase === "disabled" ? false : cache }),
            ESM_HOST_CHECK: JSON.stringify({ ...identity, emulate: true, result: files.result })
          },
          identity,
          files
        )
        expect(result.hostResult).toMatchObject({
          passed: true,
          sharedRealm: true,
          imports: 2,
          rejections: 3
        })
      }
    }))
  it("refuses to label a native Docker/Node VM as a real WebContainer", async () => {
    await expect(verifyWebContainer()).rejects.toThrow(/inside the affected StackBlitz/)
  })
  for (const example of ["load", "unused", "corrupt"] as const) {
    it(`records actual application use and global preservation for ${example}`, async () =>
      temporary(async (directory) => {
        const loader = await realpath(path.resolve("dist/esm.js"))
        const preload = path.join(directory, "preload.cjs")
        await writeFile(preload, webcontainerApplicationPreload)
        await writeFile(path.join(directory, "value.js"), "export const answer = 42")
        const source =
          example === "load"
            ? "const assert=require('node:assert/strict');const load=require('esm')(module);assert.equal(load('./value.js').answer,42)"
            : example === "corrupt"
              ? "global.Object=undefined"
              : "console.log('no loader used')"
        const nonce = randomUUID()
        const result = await runCommand(process.execPath, ["-e", source], directory, {
          ...process.env,
          NODE_ENV: "production",
          ESM_ENV: "production",
          ESM_DISABLE_CACHE: "true",
          NODE_OPTIONS: "--require " + JSON.stringify(preload),
          ESM_WEB_APPLICATION: JSON.stringify({
            phase: "disabled",
            nonce,
            loader,
            reports: directory
          })
        })
        const files = (await readdir(directory)).filter(
          (name) => name.startsWith("application-") && name.endsWith(".json")
        )
        expect(files).toHaveLength(1)
        const report: unknown = JSON.parse(await readFile(path.join(directory, files[0]!), "utf8"))
        expect(report).toMatchObject({
          nonce,
          loader,
          factories: example === "load" ? 1 : 0,
          globalsPreserved: example !== "corrupt"
        })
        expect(result.code, result.stderr).toBe(example === "corrupt" ? 1 : 0)
      }))
  }
})

function archive(name: string, kind = "0", data = Buffer.from("verified")): Buffer {
  if (kind !== "0") data = Buffer.alloc(0)
  const header = Buffer.alloc(512)
  header.write(name, 0, 100)
  for (const [offset, value] of [
    [100, "0000644"],
    [108, "0000000"],
    [116, "0000000"],
    [124, data.length.toString(8).padStart(11, "0")],
    [136, "00000000000"]
  ] as const)
    header.write(value + "\0", offset)
  header.fill(32, 148, 156)
  header.write(kind, 156)
  header.write("ustar\0", 257)
  header.write("00", 263)
  if (kind !== "0") header.write("/tmp/outside", 157)
  header.write(
    [...header]
      .reduce((a, b) => a + b, 0)
      .toString(8)
      .padStart(6, "0") + "\0 ",
    148
  )
  return gzipSync(
    Buffer.concat([
      header,
      data,
      Buffer.alloc((512 - (data.length % 512)) % 512),
      Buffer.alloc(1024)
    ])
  )
}

describe.skipIf(process.platform !== "linux")("verified host package extraction", () => {
  for (const [name, kind] of [
    ["package/value.txt", "0"],
    ["../escape", "0"],
    ["/tmp/escape", "0"],
    ["C:/escape", "0"],
    ["package/link", "2"],
    ["package/link", "1"],
    ["package/fifo", "6"]
  ]) {
    it(`checks the path and type of ${name} (${kind}) before extraction`, async () => {
      await mkdir(hostRuntimeCache, { recursive: true })
      const file = "archive-test-" + randomUUID() + ".tgz"
      const payload = archive(name!, kind!)
      const input = {
        file,
        url: "https://example.invalid/unused",
        sha256: createHash("sha256").update(payload).digest("hex"),
        maxBytes: payload.length
      }
      const target = path.join(await realpath(hostRuntimeCache), file)
      await writeFile(target, payload)
      try {
        if (name === "package/value.txt") {
          const directory = extractHostPackage(input)
          try {
            expect(await readFile(path.join(directory, "value.txt"), "utf8")).toBe("verified")
          } finally {
            await rm(directory, { recursive: true, force: true })
          }
        } else
          expect(() => extractHostPackage(input)).toThrow(/Invalid archive path|link or special/)
      } finally {
        await rm(target, { force: true })
      }
    })
  }
})
