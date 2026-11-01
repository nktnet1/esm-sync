import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Script, createContext } from "node:vm"
import { hostCaseLine, hostLabel } from "./host-output.ts"
import { prepareProject, runCommand, runHostCase } from "./verify-hosts-container.ts"
import { webcontainerProbe } from "./webcontainer-probe.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

// Only the child build process sees this resolution hook; no dependency files
// or lockfiles in the application are changed. Every Node child records its
// own PID so npm's unused preload cannot overwrite the actual build evidence.
export const webcontainerApplicationPreload = `
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert');
const config=JSON.parse(process.env.ESM_WEB_APPLICATION);
const NativeObject=Object,names=['Object','Function','Array','Error','Promise','Reflect','Symbol','JSON'];
const before=NativeObject.getOwnPropertyDescriptors(global);
const report={phase:config.phase,nonce:config.nonce,pid:process.pid,loader:config.loader,requests:0,factories:0,globalsPreserved:false};
const original=Module._load;
let factory;
Module._load=function(request,parent,isMain){
 if(request==='esm'){
  report.requests++;
  if(!factory){
    const value=Reflect.apply(original,Module,[config.loader,parent,false]);
    factory=new Proxy(value,{apply(target,receiver,args){report.factories++;return Reflect.apply(target,receiver,args);}});
  }
  return factory;
 }
 return Reflect.apply(original,Module,[request,parent,isMain]);
};
process.on('exit',code=>{
 try{for(const name of names)assert.deepEqual(NativeObject.getOwnPropertyDescriptor(global,name),before[name],name);report.globalsPreserved=true;}catch(error){report.error=String(error);}
 report.exitCode=code;
 fs.writeFileSync(path.join(config.reports,'application-'+config.phase+'-'+process.pid+'.json'),JSON.stringify(report,null,2));
 if(!report.globalsPreserved)process.exitCode=1;
});
`

export async function verifyWebContainer(application?: string): Promise<string> {
  assert.equal(
    new Script("({}).constructor").runInContext(createContext({})),
    Object,
    "Run this command inside the affected StackBlitz/WebContainer. The Docker wrapper supplies this runtime automatically."
  )
  if (application) {
    application = realpathSync(application)
    const manifest = JSON.parse(readFileSync(path.join(application, "package.json"), "utf8")) as {
      scripts?: { build?: string }
    }
    assert.ok(
      manifest.scripts?.build,
      "Application must have a build script and installed dependencies"
    )
  }
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    hostVerificationKit?: unknown
  }
  if (manifest.hostVerificationKit === true) {
    assert.ok(existsSync(path.join(root, "dist/esm/loader.js")), "Verification kit is incomplete")
    console.log(`${hostLabel("cyan", "LOADER")} production build from the Docker verification kit`)
  } else {
    console.log(`${hostLabel("cyan", "BUILD")} current production loader`)
    const build = await runCommand(
      process.execPath,
      ["script/src/esm/cli.ts", "build", "--prod"],
      root,
      { ...process.env, NODE_OPTIONS: "" },
      180_000,
      false
    )
    assert.equal(build.code, 0, build.stdout + build.stderr)
  }
  const base = path.join(root, ".cache/host-verification")
  mkdirSync(base, { recursive: true })
  const reports = realpathSync(mkdtempSync(path.join(realpathSync(base), "webcontainer-")))
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "esm-webcontainer-")))
  const project = await prepareProject(917, directory)
  const loader = realpathSync(path.join(project, "node_modules/esm/dist/esm.js"))
  const probe = path.join(project, "host-probe.cjs")
  writeFileSync(probe, webcontainerProbe)
  const preload = path.join(directory, "application-preload.cjs")
  writeFileSync(preload, webcontainerApplicationPreload)
  const samples: Record<string, unknown>[] = []
  const output = path.join(reports, "report.json")
  const digest = createHash("sha256")
    .update(readFileSync(path.join(root, "dist/esm/loader.js")))
    .digest("hex")
  function save(passed: boolean): void {
    writeFileSync(
      output,
      JSON.stringify(
        {
          issue: 917,
          passed,
          scope: application ? "actual-webcontainer-application" : "actual-webcontainer",
          application: application ?? null,
          loaderSHA256: digest,
          samples
        },
        null,
        2
      )
    )
  }
  save(false)
  console.log(`${hostLabel("cyan", "REPORT")} ${output}`)
  for (const [index, phase] of (["disabled", "cold", "warm"] as const).entries()) {
    hostCaseLine(
      index + 1,
      3,
      "RUN",
      917,
      phase,
      application ? "real VM + application build" : "real VM + module graph"
    )
    const identity = {
      issue: 917 as const,
      phase,
      nonce: randomUUID(),
      loader,
      scope: "actual-webcontainer" as const
    }
    const files = {
      log: path.join(reports, `${phase}.log`),
      result: path.join(reports, `${phase}.json`)
    }
    const cache = path.join(project, "compiler-cache")
    assert.equal(
      existsSync(path.join(cache, ".data.json")),
      phase === "warm",
      "Unexpected compiler cache before real-host check"
    )
    const env = {
      ...process.env,
      NODE_ENV: "production",
      ESM_ENV: "production",
      NODE_OPTIONS: "",
      ESM_DISABLE_CACHE: String(phase === "disabled"),
      ESM_OPTIONS: JSON.stringify({ cache: phase === "disabled" ? false : cache })
    }
    try {
      await runHostCase(
        process.execPath,
        [probe],
        project,
        { ...env, ESM_HOST_CHECK: JSON.stringify({ ...identity, project, result: files.result }) },
        identity,
        files,
        { timeout: 30_000, processGroups: false }
      )
      let applicationEvidence: unknown[] = []
      if (application) {
        const result = await runCommand(
          process.platform === "win32" ? "npm.cmd" : "npm",
          ["run", "build"],
          application,
          {
            ...env,
            NODE_OPTIONS: "--require " + JSON.stringify(preload),
            ESM_WEB_APPLICATION: JSON.stringify({ phase, nonce: identity.nonce, loader, reports })
          },
          180_000,
          false
        )
        writeFileSync(
          path.join(reports, `application-${phase}.log`),
          JSON.stringify(result, null, 2)
        )
        assert.equal(result.code, 0, "Application build failed; see application-" + phase + ".log")
        applicationEvidence = readdirSync(reports)
          .filter((name) => name.startsWith(`application-${phase}-`) && name.endsWith(".json"))
          .map((name) => JSON.parse(readFileSync(path.join(reports, name), "utf8")) as unknown)
        const evidence = applicationEvidence as {
          nonce: string
          loader: string
          factories: number
          globalsPreserved: boolean
          exitCode: number
        }[]
        assert.ok(
          evidence.length > 0 &&
            evidence.every(
              (item) =>
                item.nonce === identity.nonce && item.loader === loader && item.globalsPreserved
            ),
          "Missing or invalid application global-preservation evidence"
        )
        assert.ok(
          evidence.some((item) => item.factories > 0),
          "Application build did not invoke esm; it cannot verify the historical failing path"
        )
        assert.ok(
          evidence.filter((item) => item.factories > 0).every((item) => item.exitCode === 0),
          "An application process using the fork failed"
        )
      }
      samples.push({ ...identity, passed: true, ...files, applicationEvidence })
      save(false)
      hostCaseLine(
        index + 1,
        3,
        "PASS",
        917,
        phase,
        application
          ? "fork used by build + globals preserved"
          : "real shared VM + globals + imports"
      )
    } catch (error) {
      samples.push({
        ...identity,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        ...files
      })
      save(false)
      throw new Error(`#917 verification failed; report: ${output}`, { cause: error })
    }
  }
  save(true)
  console.log(
    `${hostLabel("green", "PASS")} #917 ${application ? "application verification" : "real-host module regression"}. REPORT ${output}`
  )
  return output
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  assert.ok(process.argv.length <= 3, "Internal WebContainer worker: [application-directory]")
  verifyWebContainer(process.argv[2]).catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
