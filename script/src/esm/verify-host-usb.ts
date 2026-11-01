import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { cpSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { hostUsbNativePatch } from "./host-runtimes.ts"
import { hostLabel } from "./host-output.ts"
import { HostProcessError, hostLaunchCommand, runCommand } from "./verify-hosts-container.ts"

// Separate processes are essential: an incompatible native library can damage
// libuv even after require throws. A written rejection alone is not a pass.
export const fullUsbProbe = `
const assert=require('assert'), fs=require('fs'), path=require('path'), Module=require('module');
const config=JSON.parse(process.env.ESM_HOST_CHECK);
const report={...config,scope:'full-usb',versions:process.versions,errors:[],passed:false,settled:false,survived:false,rejections:[],roundTrips:0,original:[]};
const nativeExtension=Module._extensions['.node'];
const binaryFile=fs.realpathSync(path.join(config.graph,'node_modules/usb/build/Release/usb_bindings.node'));
Module._extensions['.node']=function(mod,file){
 const value=Reflect.apply(nativeExtension,this,arguments);
 if(fs.realpathSync(file)===binaryFile)report.nativeLoaded=true;
 return value;
};
let window,finished=false;
function write(){fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
function stage(name){report.stage=name;write();}
function finish(error){
 if(finished)return;finished=true;
 if(error)report.errors.push(String(error.stack||error));
 report.passed=!report.errors.length&&report.settled&&report.survived;
 write();process.exitCode=report.passed?0:1;
 if(window){const electron=require('electron');if(window.webContents.debugger.isAttached())window.webContents.debugger.detach();electron.app.quit();}
}
function api(value){
 const result={Device:typeof value.Device,Transfer:typeof value.Transfer,getDeviceList:typeof value.getDeviceList};
 assert.deepEqual(result,{Device:'function',Transfer:'function',getDeviceList:'function'});
 report.exports=result;
 report.initError=value.INIT_ERROR||0;
 assert.equal(report.nativeLoaded,true,'The full native USB binary was not loaded');
 if(!report.initError){
   const listener=()=>{};
   value.on('attach',listener);value.removeListener('attach',listener);
   value.on('detach',listener);value.removeListener('detach',listener);
   report.hotplugToggled=true;
 }
}
function mismatch(error){
 assert.ok(error,'Incompatible full USB binary was accepted');
 assert.ok(/NODE_MODULE_VERSION 64/.test(error.message),error.message);
 assert.ok(/NODE_MODULE_VERSION 70/.test(error.message),error.message);
 report.rejections.push(error.message);
}
async function check(){
 stage('load full usb@1.6.0');
 const nativeRequire=Module.createRequire?Module.createRequire(path.join(config.graph,'check.cjs')):Module.createRequireFromPath(path.join(config.graph,'check.cjs'));
 if(config.mode==='require'){
   let value,error;try{value=nativeRequire('usb');}catch(caught){error=caught;}
   if(config.binary==='mismatch')mismatch(error);else{if(error)throw error;api(value);}
 }else{
   const parent=new Module(path.join(config.graph,'check.cjs'));
   parent.filename=parent.id;parent.paths=Module._nodeModulePaths(config.graph);
   const load=require(config.loader)(parent);
   const repeat=load('./repeat.js').load;
   const previous=console.log;
   console.log=function(...args){if(args.length===1&&(args[0]==='error'||args[0]==='success'))report.original.push(args[0]);return Reflect.apply(previous,console,args);};
   load('./crash.js');
   async function imported(){let value,error;try{value=await repeat();}catch(caught){error=caught;}
     if(config.binary==='mismatch')mismatch(error);else{if(error)throw error;api(value);}}
   await imported();await Promise.all([imported(),imported()]);
   await new Promise(resolve=>setTimeout(resolve,100));
   console.log=previous;
   assert.deepEqual(report.original,[config.binary==='mismatch'?'error':'success']);
 }
 report.settled=true;stage('wait for healthy event loop after native load');
 await new Promise(resolve=>setTimeout(resolve,500));
 if(window){
  for(let i=0;i<3;i++){
   const response=await window.webContents.debugger.sendCommand('Runtime.evaluate',{expression:'6*7',returnByValue:true});
   assert.equal(response.result.value,42);report.roundTrips++;
  }
 }
 report.survived=true;stage('complete');finish();
}
if(config.mode==='require'){check().catch(finish);}else{
 const electron=require('electron');
 electron.app.on('ready',async()=>{try{
  assert.equal(process.versions.electron,'5.0.6');assert.equal(process.versions.modules,'70');
  window=new electron.BrowserWindow({show:true,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false}});
  window.webContents.on('crashed',()=>finish(new Error('Full USB renderer crashed')));
  await window.loadFile(path.join(config.project,'index.html'));
  window.webContents.debugger.on('detach',(_event,reason)=>{if(!finished)finish(new Error('Debugger disconnected: '+reason));});
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Runtime.enable');
  await check();
 }catch(error){finish(error);}});
}
process.on('uncaughtException',finish);process.on('unhandledRejection',finish);
setTimeout(()=>finish(new Error('Full USB verification timed out')),15000).unref();
`

export type UsbRun = {
  mode: "require" | "import"
  binary: "mismatch" | "compatible"
  passed: boolean
  code: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  result: string
  log: string
  report: unknown
}
export type UsbVerdict = {
  phase: string
  status: "resolved" | "blocked" | "failed"
  reason: string
  runs: UsbRun[]
  nativeFix?: {
    scope: "patched-usb-1.6.0"
    patchSHA256: string
    queue: unknown
    baselines: (UsbRun & {
      source: "published" | "unpatched"
      verified: boolean
      traceCaptured: boolean
    })[]
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function abiRejected(value: unknown): boolean {
  return (
    object(value) &&
    Array.isArray(value.rejections) &&
    value.rejections.some(
      (error: unknown) =>
        typeof error === "string" &&
        /NODE_MODULE_VERSION 64/.test(error) &&
        /NODE_MODULE_VERSION 70/.test(error)
    )
  )
}

export function validateUsbNativeEvidence(value: unknown): void {
  assert.ok(object(value) && object(value.nativeFix), "Missing native USB fix evidence")
  const native = value.nativeFix
  assert.equal(native.scope, "patched-usb-1.6.0")
  assert.equal(native.patchSHA256, hostUsbNativePatch.sha256, "Wrong USB native patch")
  const queue = native.queue
  assert.ok(object(queue) && object(queue.versions), "Missing native queue control")
  assert.equal(queue.phase, value.phase)
  assert.equal(queue.passed, true)
  assert.equal(queue.survived, true)
  assert.equal(queue.callbacks, 16)
  assert.equal(queue.code, 0)
  assert.equal(queue.error, undefined)
  assert.equal(queue.versions.modules, "70")
  assert.ok(
    Array.isArray(native.baselines) && native.baselines.length === 2,
    "Missing original USB baselines"
  )
  const sources = new Set<string>()
  for (const baseline of native.baselines as unknown[]) {
    assert.ok(object(baseline) && object(baseline.report) && object(baseline.report.versions))
    assert.ok(baseline.source === "published" || baseline.source === "unpatched")
    sources.add(baseline.source)
    assert.equal(baseline.mode, "require")
    assert.equal(baseline.binary, "mismatch")
    assert.equal(baseline.verified, true)
    assert.equal(baseline.report.phase, value.phase)
    assert.equal(baseline.report.versions.modules, "70")
    assert.ok(abiRejected(baseline.report), "Original baseline lacks the matching ABI error")
    if (baseline.passed === true) {
      assert.equal(baseline.code, 0)
      assert.ok(!baseline.signal && !baseline.timedOut)
      assert.equal(baseline.report.passed, true)
      assert.equal(baseline.report.survived, true)
    } else
      assert.ok(
        baseline.signal === "SIGSEGV" || baseline.code === 139 || baseline.timedOut === true,
        "Unrelated original USB failure"
      )
  }
  assert.equal(sources.size, 2, "Duplicate original USB baseline")
}

export const usbQueueProbe = `
const assert=require('assert'),fs=require('fs');
const config=JSON.parse(process.env.ESM_USB_QUEUE);
const report={...config,versions:process.versions,callbacks:0,survived:false,passed:false};
function write(){fs.writeFileSync(config.result,JSON.stringify(report,null,2));}
function fail(error){report.error=String(error.stack||error);write();process.exitCode=1;}
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);
write();
try {
 const addon=require(config.addon);
 const callback=value=>{
  assert.equal(value,42);report.callbacks++;write();
  if(report.callbacks===16)setTimeout(()=>{report.survived=true;report.passed=true;write();},500);
 };
 for(let i=0;i<16;i++)addon.exercise(callback);
} catch(error){fail(error);}
setTimeout(()=>fail(new Error('Native USB queue timed out')),5000).unref();
`

export function usbVerdict(runs: UsbRun[], phase: string): UsbVerdict {
  const find = (mode: UsbRun["mode"], binary: UsbRun["binary"]) =>
    runs.find((run) => run.mode === mode && run.binary === binary)
  assert.equal(runs.length, 4, "Missing full USB controls")
  for (const mode of ["require", "import"] as const)
    for (const binary of ["mismatch", "compatible"] as const)
      assert.ok(find(mode, binary), "Duplicate or missing USB case")
  if (!find("require", "compatible")!.passed || !find("import", "compatible")!.passed)
    return {
      phase,
      status: "failed",
      reason: "Rebuilt full USB control failed; inspect its log before diagnosing the ABI failure",
      runs
    }
  const ordinary = find("require", "mismatch")!
  if (!ordinary.passed) {
    const rejected =
      object(ordinary.report) &&
      Array.isArray(ordinary.report.rejections) &&
      ordinary.report.rejections.some(
        (error: unknown) =>
          typeof error === "string" &&
          /NODE_MODULE_VERSION 64/.test(error) &&
          /NODE_MODULE_VERSION 70/.test(error)
      )
    if (rejected && (ordinary.signal || ordinary.timedOut || ordinary.code !== 0))
      return {
        phase,
        status: "blocked",
        reason:
          "The native-patched ABI-64 USB binary still crashes or hangs without esm after its mismatch; safe rejection failed",
        runs
      }
    return {
      phase,
      status: "failed",
      reason: "Ordinary require did not demonstrate a healthy ABI rejection",
      runs
    }
  }
  if (!find("import", "mismatch")!.passed)
    return {
      phase,
      status: "failed",
      reason: "Ordinary require survives the ABI rejection, but the fork's dynamic import does not",
      runs
    }
  return {
    phase,
    status: "resolved",
    reason:
      "Native USB queue fix: safe ABI rejection, caught dynamic imports, rebuilt exports and a responsive debugger pass",
    runs
  }
}

export async function verifyHostUsb(
  executable: string,
  loader: string,
  project: string,
  phase: string,
  reports: string,
  env: NodeJS.ProcessEnv
): Promise<UsbVerdict> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
  const cache = realpathSync(path.join(root, ".cache/host-packages"))
  const builds = JSON.parse(readFileSync(path.join(cache, "builds.json"), "utf8")) as {
    schema: number
    nativePatch: { sha256: string }
    queueProbe: { file: string; sha256: string }
    crashTrace: { file: string; sha256: string }
    outputs: { name: string; abi: number; patched: boolean; file: string; sha256: string }[]
  }
  assert.equal(builds.schema, 2)
  assert.equal(builds.nativePatch.sha256, hostUsbNativePatch.sha256)
  assert.equal(builds.outputs.length, 4)
  for (const [name, abi, patched] of [
    ["usb-published", 64, false],
    ["usb-unpatched", 64, false],
    ["usb-mismatch", 64, true],
    ["usb-compatible", 70, true]
  ] as const) {
    const info = builds.outputs.find((item) => item.name === name)
    assert.ok(
      info && info.abi === abi && info.patched === patched,
      "Missing full USB build provenance"
    )
    assert.equal(
      createHash("sha256").update(readFileSync(info.file)).digest("hex"),
      info.sha256,
      "Full USB binary checksum mismatch"
    )
  }
  cpSync(path.join(cache, "builds.json"), path.join(reports, "usb-builds.json"))
  for (const item of [builds.queueProbe, builds.crashTrace])
    assert.equal(
      createHash("sha256").update(readFileSync(item.file)).digest("hex"),
      item.sha256,
      "USB diagnostic checksum mismatch"
    )
  cpSync(
    path.join(root, "script/patches", hostUsbNativePatch.file),
    path.join(reports, "usb-native-fix.patch")
  )
  const queueScript = path.join(project, "usb-queue-probe.cjs")
  const queueFile = path.join(reports, `817-usb-queue-${phase}.json`)
  const queueConfig = {
    phase,
    nonce: randomUUID(),
    addon: builds.queueProbe.file,
    result: queueFile
  }
  writeFileSync(queueScript, usbQueueProbe)
  const queueResult = await runCommand(
    executable,
    [queueScript],
    project,
    {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      ESM_USB_QUEUE: JSON.stringify(queueConfig)
    },
    10_000
  )
  writeFileSync(
    path.join(reports, `817-usb-queue-${phase}.log`),
    JSON.stringify(queueResult, null, 2)
  )
  const queue = JSON.parse(readFileSync(queueFile, "utf8")) as Record<string, unknown>
  assert.equal(queue.nonce, queueConfig.nonce)
  queue.code = queueResult.code
  writeFileSync(queueFile, JSON.stringify(queue, null, 2))
  const baselines: NonNullable<UsbVerdict["nativeFix"]>["baselines"] = []
  const probe = path.join(project, "full-usb-probe.cjs")
  writeFileSync(probe, fullUsbProbe)
  const runs: UsbRun[] = []
  for (const [index, [mode, binary, source]] of (
    [
      ["require", "mismatch", "published"],
      ["require", "mismatch", "unpatched"],
      ["require", "mismatch", "patched"],
      ["import", "mismatch", "patched"],
      ["require", "compatible", "patched"],
      ["import", "compatible", "patched"]
    ] as const
  ).entries()) {
    console.log(
      `    [USB ${index + 1}/6] ${hostLabel("cyan", "RUN")}  #817 ${phase} ${source} ${mode} ${binary}`
    )
    const graph = realpathSync(
      path.join(cache, source === "patched" ? `usb-${binary}` : `usb-${source}`)
    )
    for (const name of ["repeat.js", "crash.js"])
      cpSync(path.join(project, name), path.join(graph, name))
    const file = path.join(reports, `817-usb-${phase}-${source}-${mode}-${binary}`)
    const config = {
      issue: 817,
      phase,
      nonce: randomUUID(),
      loader,
      project,
      graph,
      mode,
      binary,
      source,
      result: file + ".json"
    }
    const command =
      mode === "require"
        ? { executable, args: [probe] }
        : hostLaunchCommand(executable, ["--no-sandbox", probe])
    let result: HostProcessError["result"]
    try {
      result = await runCommand(
        command.executable,
        command.args,
        project,
        {
          ...env,
          ...(source !== "patched"
            ? { LD_PRELOAD: [builds.crashTrace.file, env.LD_PRELOAD].filter(Boolean).join(":") }
            : {}),
          ...(mode === "require" ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          ESM_HOST_CHECK: JSON.stringify(config)
        },
        20_000
      )
    } catch (error) {
      if (!(error instanceof HostProcessError)) throw error
      result = error.result
    }
    writeFileSync(file + ".log", JSON.stringify({ command, ...result }, null, 2))
    let report: unknown = null
    if (existsSync(config.result)) {
      try {
        report = JSON.parse(readFileSync(config.result, "utf8")) as unknown
      } catch {}
    }
    const matching =
      object(report) &&
      report.nonce === config.nonce &&
      report.loader === loader &&
      report.phase === phase &&
      report.mode === mode &&
      report.binary === binary &&
      report.source === source &&
      report.scope === "full-usb"
    const evidence =
      object(report) &&
      matching &&
      report.passed === true &&
      report.survived === true &&
      report.settled === true &&
      Array.isArray(report.errors) &&
      report.errors.length === 0 &&
      object(report.versions) &&
      report.versions.modules === "70" &&
      (mode === "require" || report.roundTrips === 3)
    const content =
      object(report) &&
      (binary === "compatible"
        ? report.nativeLoaded === true &&
          object(report.exports) &&
          ["Device", "Transfer", "getDeviceList"].every(
            (name) => object(report.exports) && report.exports[name] === "function"
          )
        : Array.isArray(report.rejections) &&
          report.rejections.length === (mode === "require" ? 1 : 3) &&
          report.rejections.every(
            (error: unknown) =>
              typeof error === "string" &&
              /NODE_MODULE_VERSION 64/.test(error) &&
              /NODE_MODULE_VERSION 70/.test(error)
          ))
    const passed = Boolean(
      evidence && content && result.code === 0 && !result.signal && !result.timedOut
    )
    const run: UsbRun = {
      mode,
      binary,
      passed,
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      result: config.result,
      log: file + ".log",
      report
    }
    const verified = Boolean(
      matching &&
        object(report) &&
        object(report.versions) &&
        report.versions.modules === "70" &&
        abiRejected(report) &&
        (passed || result.signal === "SIGSEGV" || result.code === 139 || result.timedOut)
    )
    if (source === "patched") runs.push(run)
    else
      baselines.push({
        ...run,
        source,
        verified,
        traceCaptured: result.stderr.includes("NATIVE USB CRASH")
      })
    const detail = passed
      ? ""
      : result.timedOut
        ? " — timed out after 20s"
        : result.signal
          ? " — " + result.signal
          : result.code !== 0
            ? " — exit " + result.code
            : " — incomplete probe evidence; see JSON"
    console.log(
      `    [USB ${index + 1}/6] ${hostLabel(source !== "patched" && verified ? "yellow" : passed ? "green" : "red", source !== "patched" && verified ? "BASELINE" : passed ? "PASS" : "FAIL")} #817 ${phase} ${source} ${mode} ${binary}${detail}`
    )
  }
  const verdict = usbVerdict(runs, phase)
  verdict.nativeFix = {
    scope: "patched-usb-1.6.0",
    patchSHA256: hostUsbNativePatch.sha256,
    queue,
    baselines
  }
  try {
    validateUsbNativeEvidence(verdict)
  } catch (error) {
    verdict.status = "failed"
    verdict.reason = "Invalid native USB fix evidence: " + String(error)
  }
  writeFileSync(path.join(reports, `817-usb-${phase}.json`), JSON.stringify(verdict, null, 2))
  console.log(
    `\n    ${hostLabel(verdict.status === "resolved" ? "green" : "red", verdict.status === "resolved" ? "PASS" : "FAIL")} #817 native USB patch: ABI-64 rejection + ABI-70 require/import + 16 queue callbacks; original binaries retained as negative controls`
  )
  console.log(
    `\n    ${hostLabel(verdict.status === "resolved" ? "green" : verdict.status === "blocked" ? "yellow" : "red", verdict.status.toUpperCase())} #817 full USB: ${verdict.reason}\n`
  )
  return verdict
}
