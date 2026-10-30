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
