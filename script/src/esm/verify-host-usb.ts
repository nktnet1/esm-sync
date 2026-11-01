import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { cpSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
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
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

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
          "Ordinary require catches the USB ABI mismatch, then crashes or hangs without esm; loader resolution cannot be established",
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
      "Full USB: ordinary ABI rejection, caught dynamic imports, rebuilt exports and a responsive debugger all pass",
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
    outputs: { name: string; abi: number; file: string; sha256: string }[]
  }
  assert.equal(builds.outputs.length, 2)
  for (const [name, abi] of [
    ["usb-mismatch", 64],
    ["usb-compatible", 70]
  ] as const) {
    const info = builds.outputs.find((item) => item.name === name)
    assert.ok(info && info.abi === abi, "Missing full USB build provenance")
    assert.equal(
      createHash("sha256").update(readFileSync(info.file)).digest("hex"),
      info.sha256,
      "Full USB binary checksum mismatch"
    )
  }
  cpSync(path.join(cache, "builds.json"), path.join(reports, "usb-builds.json"))
  const probe = path.join(project, "full-usb-probe.cjs")
  writeFileSync(probe, fullUsbProbe)
  const runs: UsbRun[] = []
  for (const [index, [mode, binary]] of (
    [
      ["require", "mismatch"],
      ["import", "mismatch"],
      ["require", "compatible"],
      ["import", "compatible"]
    ] as const
  ).entries()) {
    console.log(
      `    [USB ${index + 1}/4] ${hostLabel("cyan", "RUN")}  #817 ${phase} ${mode} ${binary}`
    )
    const graph = realpathSync(path.join(cache, `usb-${binary}`))
    for (const name of ["repeat.js", "crash.js"])
      cpSync(path.join(project, name), path.join(graph, name))
    const file = path.join(reports, `817-usb-${phase}-${mode}-${binary}`)
    const config = {
      issue: 817,
      phase,
      nonce: randomUUID(),
      loader,
      project,
      graph,
      mode,
      binary,
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
    runs.push({
      mode,
      binary,
      passed,
      code: result.code,
      signal: result.signal,
      timedOut: result.timedOut,
      result: config.result,
      log: file + ".log",
      report
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
      `    [USB ${index + 1}/4] ${hostLabel(passed ? "green" : "yellow", passed ? "PASS" : "CHECK")} #817 ${phase} ${mode} ${binary}${detail}`
    )
  }
  const verdict = usbVerdict(runs, phase)
  writeFileSync(path.join(reports, `817-usb-${phase}.json`), JSON.stringify(verdict, null, 2))
  console.log(
    `\n    ${hostLabel(verdict.status === "resolved" ? "green" : verdict.status === "blocked" ? "yellow" : "red", verdict.status.toUpperCase())} #817 full USB: ${verdict.reason}\n`
  )
  return verdict
}
