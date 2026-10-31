// Original #817 JavaScript with a real minimal native addon in place of USB.
export const nativeAddonProbe = `
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const electron = require('electron');
const config = JSON.parse(process.env.ESM_HOST_CHECK);
const report = { ...config, issue:817, scope:'minimal-native-addon', versions:process.versions, errors:[], passed:false,
  stage:'bootstrap', original:[], rejections:[], imports:[], roundTrips:0, detached:false };
let window, finished=false;
const descriptor=Object.getOwnPropertyDescriptor(console,'log');
const originalLog=console.log;
Object.defineProperty(console,'log',{configurable:true,writable:true,value:function(...args){
  if(args.length===1&&(args[0]==='success'||args[0]==='error'))report.original.push(args[0]);
  return Reflect.apply(originalLog,console,args);
}});
function finish(error) {
  if(finished)return;
  finished=true;
  if(error)report.errors.push('Stage: '+report.stage+'\\n'+String(error.stack||error));
  report.passed=!report.errors.length&&report.roundTrips===3;
  Object.defineProperty(console,'log',descriptor);
  fs.writeFileSync(config.result,JSON.stringify(report,null,2));
  const code=report.passed?0:1;
  if(window&&!window.isDestroyed()){
    window.once('closed',()=>setTimeout(()=>electron.app.exit(code),100));
    if(window.webContents.debugger.isAttached())window.webContents.debugger.detach();
    window.close();
  }else electron.app.exit(code);
}
process.on('uncaughtException',finish);
process.on('unhandledRejection',finish);
const created=new Promise(resolve=>electron.app.once('browser-window-created',(_event,value)=>{
  window=value;
  window.webContents.on('crashed',()=>finish(new Error('Renderer crashed')));
  window.webContents.once('did-finish-load',()=>resolve(window));
}));
async function waitOriginal(expected) {
  const end=Date.now()+5000;
  while(report.original.length<expected&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(report.original.length,expected,'Original import did not settle');
}
electron.app.on('ready',async()=>{
  try{
    assert.equal(process.versions.electron,'5.0.6');
    assert.equal(process.versions.modules,'70');
    report.stage='load original window';
    await created;
    const client=window.webContents.debugger;
    client.on('detach',(_event,reason)=>{report.detachReason=reason;if(!finished){report.detached=true;finish(new Error('Debugger disconnected: '+reason));}});
    client.attach('1.3');
    await client.sendCommand('Runtime.enable');
    async function ping(){
      const response=await client.sendCommand('Runtime.evaluate',{expression:'6*7',returnByValue:true});
      assert.equal(response.result.value,42,'Renderer debugger stopped responding');
      report.roundTrips++;
    }
    await ping();
    await waitOriginal(1);
    assert.deepEqual(report.original,['error']);
    report.stage='repeat incompatible dynamic imports';
    const load=require('esm')(module);
    assert.equal(fs.realpathSync(require.resolve('esm')),config.loader);
    const repeat=load('./repeat.js').load;
    async function rejectImport(){
      let error;
      try{await repeat();}catch(value){error=value;}
      assert.ok(error,'Incompatible import unexpectedly succeeded');
      assert.ok(/NODE_MODULE_VERSION 137/.test(error.message));
      assert.ok(/NODE_MODULE_VERSION 70/.test(error.message));
      report.rejections.push({name:error.name,code:error.code||null,message:error.message});
    }
    await rejectImport();await rejectImport();await Promise.all([rejectImport(),rejectImport()]);
    await ping();
    report.stage='load compatible rebuilt control';
    const parent=new Module(path.join(config.project,'compatible','probe.cjs'));
    parent.filename=parent.id;parent.paths=Module._nodeModulePaths(path.dirname(parent.filename));
    const compatible=require('esm')(parent);
    compatible('./crash.js');
    await waitOriginal(2);
    assert.deepEqual(report.original,['error','success']);
    const repeatCompatible=compatible('./repeat.js').load;
    for(const exports of [await repeatCompatible(),await repeatCompatible(),...await Promise.all([repeatCompatible(),repeatCompatible()])]){
      assert.equal(exports.answer,42);assert.equal(exports.abi,70);
      report.imports.push({answer:exports.answer,abi:exports.abi});
    }
    await ping();
    report.stage='complete';
    finish();
  }catch(error){finish(error);}
});
try{
  report.stage='ordinary require controls';
  let mismatch;
  try{require(process.env.ESM_HOST_ADDON);}catch(error){mismatch=error;}
  assert.ok(mismatch,'Ordinary require unexpectedly accepted an incompatible ABI');
  assert.ok(/NODE_MODULE_VERSION 137/.test(mismatch.message));
  assert.ok(/NODE_MODULE_VERSION 70/.test(mismatch.message));
  report.ordinaryMismatch={code:mismatch.code||null,message:mismatch.message};
  const compatible=require(process.env.ESM_HOST_COMPATIBLE_ADDON);
  assert.equal(compatible.answer,42);assert.equal(compatible.abi,70);
  report.ordinaryCompatible={answer:compatible.answer,abi:compatible.abi};
  report.stage='start original main.js';
  require('./main.js');
}catch(error){finish(error);}
setTimeout(()=>finish(new Error('Native-addon verification timed out during '+report.stage)),30000);
`

// These probes execute inside historical Electron/VS Code Node runtimes,
// which cannot execute TypeScript. The orchestrator remains native TypeScript.
export const electronProbe = `
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const electron = require('electron');
const config = JSON.parse(process.env.ESM_HOST_CHECK);
const report = { ...config, issue: 867, loads: [], errors: [], passed: false };
let window, finished = false;
function finish(error) {
  if (finished) return;
  finished = true;
  if (error) report.errors.push(String(error.stack || error));
  report.passed = !report.errors.length && report.loads.length === 4;
  fs.writeFileSync(config.result, JSON.stringify(report, null, 2));
  const code = report.passed ? 0 : 1;
  if (window && !window.isDestroyed()) {
    // Graceful close delivers the renderer exit hooks that persist its cache.
    window.once('closed', () => setTimeout(() => electron.app.exit(code), 100));
    window.close();
  } else electron.app.exit(code);
}
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
electron.app.on('ready', async () => {
  try {
    assert.equal(process.versions.electron, '8.0.0', 'Use Electron 8.0.0 to test #867');
    window = new electron.BrowserWindow({
      show: true, width: 800, height: 600,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    });
    let hello = 0;
    window.webContents.on('console-message', (_event, level, message) => {
      if (message === 'Hello from the renderer process!') hello++;
      if (level >= 3) report.errors.push(message);
    });
    window.webContents.on('crashed', () => finish(new Error('Renderer crashed')));
    for (let index = 0; index < 4; index++) {
      hello = 0;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => done(new Error('Page load timed out')), 10000);
        function done(error) {
          clearTimeout(timer);
          window.webContents.removeListener('did-finish-load', loaded);
          window.webContents.removeListener('did-fail-load', failed);
          error ? reject(error) : resolve();
        }
        function loaded() { done(); }
        function failed(_event, code, description) { done(new Error(code + ': ' + description)); }
        window.webContents.once('did-finish-load', loaded);
        window.webContents.once('did-fail-load', failed);
        if (index) window.webContents.reload();
        else window.loadFile(path.join(config.project, 'index.html')).catch(done);
      });
      const details = await window.webContents.executeJavaScript(
        "({loader:require.resolve('esm'),versions:process.versions,type:process.type})"
      );
      assert.equal(fs.realpathSync(details.loader), config.loader, 'Renderer loaded another esm package');
      assert.equal(details.type, 'renderer');
      assert.equal(details.versions.electron, '8.0.0');
      assert.equal(hello, 1, 'Expected exactly one renderer greeting on load ' + index);
      report.loads.push({ index, hello, versions: details.versions });
    }
    finish();
  } catch (error) { finish(error); }
});
setTimeout(() => finish(new Error('Electron verification timed out')), 45000);
`

// Recreated from #691's invalid-await example. The deleted original branch
// was not recovered; this uses the already-pinned Electron 8 runtime.
export const rendererErrorProbe = `
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const electron = require('electron');
const config = JSON.parse(process.env.ESM_HOST_CHECK);
const report = { ...config, issue: 691, cases: [], errors: [], passed: false,
  stage: 'waiting for Electron ready', console: [], navigationErrors: [], exceptions: [] };
let window, finished = false;
async function stage(name, action, timeout = 10000) {
  report.stage = name;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out after ' + timeout + 'ms during ' + name)), timeout);
      })
    ]);
  } finally { clearTimeout(timer); }
}
function finish(error) {
  if (finished) return;
  finished = true;
  if (error) report.errors.push('Stage: ' + report.stage + '\\n' + String(error.stack || error));
  report.passed = !report.errors.length && report.cases.length === 2;
  fs.writeFileSync(config.result, JSON.stringify(report, null, 2));
  const code = report.passed ? 0 : 1;
  process.exitCode = code;
  if (window && !window.isDestroyed()) {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    electron.app.quit();
  } else electron.app.exit(code);
}
process.on('uncaughtException', finish);
process.on('unhandledRejection', finish);
electron.app.on('ready', async () => {
  try {
    assert.equal(process.versions.electron, '8.0.0');
    report.version = process.versions.electron;
    window = new electron.BrowserWindow({
      show: true, width: 800, height: 600,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
    });
    const exceptions = report.exceptions;
    const debuggerClient = window.webContents.debugger;
    window.webContents.on('console-message', (_event, level, message, line, source) => {
      report.console.push({ level, message, line, source });
      if (report.console.length > 50) report.console.shift();
    });
    window.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
      report.navigationErrors.push({ code, description, url, mainFrame });
    });
    window.webContents.on('crashed', () => finish(new Error('Renderer crashed')));
    // A debugger command can remain pending until the first navigation in
    // Electron 8. Navigate before awaiting CDP, rather than deadlocking startup.
    await stage('load renderer page', () => window.loadFile(path.join(config.project, 'index.html')));
    const details = await stage('inspect renderer bootstrap', () => window.webContents.executeJavaScript(
      "({loader:require.resolve('esm'),healthy:window.__esmHealthy,versions:process.versions,type:process.type})"
    ), 5000);
    assert.equal(fs.realpathSync(details.loader), config.loader);
    assert.equal(details.type, 'renderer');
    assert.equal(details.healthy, true);
    report.versions = details.versions;
    report.stage = 'attach renderer debugger';
    debuggerClient.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') exceptions.push(params.exceptionDetails);
    });
    debuggerClient.on('detach', (_event, reason) => {
      report.detachReason = reason;
      if (!finished) finish(new Error('Renderer debugger detached: ' + reason));
    });
    debuggerClient.attach('1.3');
    await stage('enable debugger Runtime.enable', () => debuggerClient.sendCommand('Runtime.enable'), 5000);
    if (finished) return;
    await stage('enable debugger Debugger.enable', () => debuggerClient.sendCommand('Debugger.enable'), 5000);
    if (finished) return;
    for (const kind of ['syntax', 'runtime']) {
      const before = exceptions.length;
      await stage('trigger ' + kind + ' error', () => window.webContents.executeJavaScript(
        'window.__esmTriggerError(' + JSON.stringify(kind) + ')'
      ), 5000);
      const events = await stage('collect ' + kind + ' window and debugger errors', async () => {
        while (!finished) {
          const observed = await window.webContents.executeJavaScript('window.__esmErrorReports');
          if (observed.length === report.cases.length + 1 && exceptions.length === before + 1) return observed;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        return [];
      });
      if (finished) return;
      report.stage = 'validate ' + kind + ' error location';
      const item = { kind, windowEvent: events[report.cases.length], exception: exceptions[before] };
      report.cases.push(item);
      assert.equal(events.length, report.cases.length, 'Missing or extra window error events');
      assert.equal(exceptions.length, before + 1, 'Missing or extra DevTools exceptions');
      const expected = fs.realpathSync(path.join(config.project, kind + '.js'));
      const canonical = name => fs.realpathSync(name.startsWith('file:') ? fileURLToPath(name) : name);
      assert.equal(canonical(item.windowEvent.filename), expected, 'window error points at the loader');
      assert.equal(item.windowEvent.line, 2);
      assert.ok(item.windowEvent.column > 0);
      assert.equal(item.windowEvent.defaultPrevented, false, 'Error reporting was suppressed');
      assert.ok(item.windowEvent.stack.includes(kind + '.js'));
      assert.ok(!item.windowEvent.stack.includes(config.loader + ':'));
      assert.equal(canonical(item.exception.url), expected, 'DevTools exception location points at the loader');
      assert.equal(item.exception.lineNumber, 1);
      assert.equal(item.exception.columnNumber, item.windowEvent.column - 1);
      const consoleError=report.console.filter(item=>item.level>=3).slice(-1)[0];
      assert.ok(consoleError,'Missing renderer console error');
      assert.equal(canonical(consoleError.source),expected,'Console points at the loader');
      assert.equal(consoleError.line,2);
      const frame = item.exception.stackTrace.callFrames[0];
      assert.equal(canonical(frame.url), expected, 'DevTools points at the loader');
      assert.equal(frame.lineNumber, 1);
    }
    // Recovery navigation delivers the previous renderer's cache exit hooks.
    await stage('reload healthy renderer after errors', () => new Promise(resolve => {
      window.webContents.once('did-finish-load', resolve);
      window.webContents.reload();
    }));
    const recovered = await stage('inspect renderer recovery', () => window.webContents.executeJavaScript(
      "({loader:require.resolve('esm'),healthy:window.__esmHealthy,versions:process.versions,type:process.type})"
    ), 5000);
    assert.equal(fs.realpathSync(recovered.loader), config.loader);
    assert.equal(recovered.healthy, true);
    report.reloaded = true;
    report.stage = 'complete';
    finish();
  } catch (error) { finish(error); }
});
setTimeout(() => finish(new Error('Renderer verification exceeded 45s during ' + report.stage)), 45000);
`

export const vscodeProbe = `
const assert = require('assert');
const fs = require('fs');
const path = require('path');
exports.run = async function () {
  const config = JSON.parse(process.env.ESM_HOST_CHECK);
  const report = { ...config, issue: 915, ports: [], errors: [], passed: false };
  const originalLogDescriptor = Object.getOwnPropertyDescriptor(console, 'log');
  const originalLog = console.log;
  const rejection = error => report.errors.push(String(error && error.stack || error));
  const captureLog = function (...args) {
    if (args.length === 1 && Number.isInteger(args[0]) && args[0] > 0 && args[0] <= 65535)
      report.ports.push(args[0]);
    return originalLog.apply(this, args);
  };
  let logPatched = false;
  process.on('unhandledRejection', rejection);
  try {
    // VS Code 1.66.2 uses a console.log accessor with an assignment-ignoring
    // setter. Replace its configurable descriptor, then restore it exactly.
    assert.ok(originalLogDescriptor, 'Host console.log has no own descriptor');
    Object.defineProperty(console, 'log', {
      configurable: true, enumerable: originalLogDescriptor.enumerable,
      writable: true, value: captureLog
    });
    logPatched = true;
    assert.equal(console.log, captureLog, 'Could not capture the host console');
    const vscode = require('vscode');
    assert.equal(vscode.version, '1.66.2', 'Use VS Code 1.66.2 to test #915');
    const projectRequire = require('module').createRequire(path.join(config.project, 'package.json'));
    assert.equal(fs.realpathSync(projectRequire.resolve('esm')), config.loader);
    assert.equal(JSON.parse(fs.readFileSync(path.join(config.project, 'node_modules/get-port/package.json'), 'utf8')).version, '6.1.2');
    const manifest = projectRequire('./package.json');
    const extension = vscode.extensions.getExtension((manifest.publisher || 'undefined_publisher') + '.' + manifest.name);
    assert.ok(extension, 'Original extension was not registered');
    assert.equal(fs.realpathSync(extension.extensionPath), fs.realpathSync(config.project));
    await extension.activate();
    assert.ok(extension.isActive, 'Extension did not activate');
    await vscode.commands.executeCommand('vscode-test-getport.showPort');
    report.commandExecuted = true;
    const deadline = Date.now() + 15000;
    while (!report.ports.length && !report.errors.length && Date.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(report.errors, []);
    assert.ok(report.ports.length, 'Activation never reported an allocated port');
    report.version = vscode.version;
    report.versions = process.versions;
    report.passed = true;
  } catch (error) {
    rejection(error);
    throw error;
  } finally {
    if (logPatched) Object.defineProperty(console, 'log', originalLogDescriptor);
    process.removeListener('unhandledRejection', rejection);
    fs.writeFileSync(config.result, JSON.stringify(report, null, 2));
  }
};
`
