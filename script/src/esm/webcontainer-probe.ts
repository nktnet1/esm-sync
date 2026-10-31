import assert from "node:assert/strict"
import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"

// Shared by the offline VM regression and the real WebContainer verifier.
// The real-host path never replaces vm APIs or restores globals before checking.
export const webcontainerProbe = `
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const config = JSON.parse(process.env.ESM_HOST_CHECK);
const NativeObject = Object;
const NativeString = String;
const descriptors = NativeObject.getOwnPropertyDescriptors(global);
const names = ['Object','Function','Array','Error','Promise','Reflect','Symbol','JSON'];
const native = {createContext:vm.createContext,runInContext:vm.Script.prototype.runInContext,runInNewContext:vm.Script.prototype.runInNewContext,runInThisContext:vm.Script.prototype.runInThisContext};
const report = {...config, issue:917, scope:config.emulate?'shared-realm-vm-regression':'actual-webcontainer', versions:process.versions, sharedRuns:0, globals:[], imports:0, rejections:0, passed:false, errors:[]};
const write = () => fs.writeFileSync(config.result, JSON.stringify(report,null,2));
try {
  if(config.emulate){
    const facade = new Proxy(global,{});
    const contexts = new WeakSet();
    vm.createContext = sandbox => { const context = new Proxy(sandbox,{}); contexts.add(context); return context; };
    vm.Script.prototype.runInNewContext = function(sandbox,options){
      if(sandbox && sandbox.global === global) sandbox.global = facade;
      return Reflect.apply(native.runInNewContext,this,[sandbox,options]);
    };
    vm.Script.prototype.runInContext = function(context,options){
      if(!contexts.has(context)) return Reflect.apply(native.runInContext,this,[context,options]);
      report.sharedRuns++;
      assert.equal(typeof global.Object,'function','VM context preparation deleted the live Object');
      return Reflect.apply(native.runInThisContext,this,[options]);
    };
  }
  report.sharedRealm = config.emulate || new vm.Script('({}).constructor').runInContext(vm.createContext({})) === NativeObject;
  assert.equal(report.sharedRealm,true,'This is an isolated native VM, not a WebContainer. Use pnpm verify:hosts:docker for the emulated regression.');
  const load = require(config.loader)(module,{cjs:true,mode:'auto'});
  assert.equal(fs.realpathSync(require.resolve(config.loader)),config.loader);
  const value = load('./value.js');
  assert.equal(value.answer,42);
  assert.equal(value.default.answer,42);
  assert.equal(load('./value.js'),value,'Repeated ESM load did not retain identity');
  assert.ok(new value.Box() instanceof value.Box);
  report.imports = 2;
  for(const name of names){
    assert.deepEqual(NativeObject.getOwnPropertyDescriptor(global,name),descriptors[name],name+' was changed');
    report.globals.push(name);
  }
  if(config.emulate) assert.ok(report.sharedRuns>0,'Shared VM path was not exercised');
  const reject = load('./reject.js').load;
  function rejected(){return reject().then(()=>{throw new Error('Throwing dynamic import unexpectedly resolved');},error=>{
    assert.equal(error.message,'webcontainer-rejection-marker'); report.rejections++;
  });}
  Promise.all([rejected(),rejected()]).then(rejected).then(()=>{
    for(const name of names) assert.deepEqual(NativeObject.getOwnPropertyDescriptor(global,name),descriptors[name],name+' changed after dynamic import');
    report.passed=true; write();
  }).catch(finish);
} catch(error) { finish(error); }
function finish(error){report.errors.push(NativeString(error.stack||error));write();process.exitCode=1;}
if(config.emulate)process.on('exit',()=>{
  vm.createContext=native.createContext;
  vm.Script.prototype.runInContext=native.runInContext;
  vm.Script.prototype.runInNewContext=native.runInNewContext;
  NativeObject.defineProperties(global,descriptors);
});
`

// Upstream also fails on modern Node for unrelated reasons. Instead disable
// exactly the shared-realm guard in an isolated copy of the current bundle.
export function prepareVmCounterfactual(loader: string, project: string): string {
  const target = path.join(project, "counterfactual/esm")
  mkdirSync(target, { recursive: true })
  const directory = realpathSync(target)
  cpSync(path.dirname(path.dirname(loader)), directory, { recursive: true })
  const file = path.join(directory, "dist/esm/loader.js")
  const source = readFileSync(file, "utf8")
  const guard = /new [\w$.]+\("\(\{\}\)\.constructor"\)\.runInContext\([\w$]+\)/g
  assert.equal(
    [...source.matchAll(guard)].length,
    1,
    "Expected exactly one compiled shared-realm guard"
  )
  writeFileSync(
    file,
    source.replace(guard, (value) => value.replace('"({}).constructor"', '"null"'))
  )
  return realpathSync(path.join(directory, "dist/esm.js"))
}
