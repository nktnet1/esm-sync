// Browser-native ESM: the SDK package is served from its verified local copy.
export function webContainerBrowserPage(nonce: string): string {
  return `
const nonce=${JSON.stringify(nonce)};
let stage='load-sdk', booted=false, wc, started=false, code=null, output='';
const events=[], artifacts={}, command=['node','script/src/esm/verify-webcontainer.js','application'];
function errorDetails(value,seen=new WeakSet(),depth=0){
  if(value===null||['string','number','boolean'].includes(typeof value))return value;
  if(typeof value!=='object')return String(value);
  if(depth>6)return '[Max depth]';
  if(seen.has(value))return '[Circular]';seen.add(value);
  if(Array.isArray(value))return value.slice(0,100).map(item=>errorDetails(item,seen,depth+1));
  const details={};
  for(const key of Object.getOwnPropertyNames(value).slice(0,100)){
    try{Object.defineProperty(details,key,{value:errorDetails(value[key],seen,depth+1),enumerable:true});}
    catch{Object.defineProperty(details,key,{value:'[Unreadable]',enumerable:true});}
  }
  try{if(typeof value.name==='string'&&!Object.hasOwn(details,'name'))details.name=value.name;}catch{}
  return details;
}
function errorText(details){return typeof details==='string'?details:JSON.stringify(details,null,2);}
async function event(type,message,details){
  const entry={nonce,type,message,stage,...(details===undefined?{}:{details})};
  events.push(entry);
  await fetch('/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(entry)});
}
async function result(value){
  await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce,crossOriginIsolated:self.crossOriginIsolated,booted,userAgent:navigator.userAgent,stage,command,workdir:wc?.workdir,sdkPath:wc?.path,code,output,artifacts,...value})});
}
async function collectArtifacts(){
  const names=await wc.fs.readdir('.cache/host-verification');
  const directories=names.filter(name=>name.startsWith('webcontainer-'));
  if(directories.length!==1)throw new Error('Expected one real-host report directory; worker exit '+code);
  const directory='.cache/host-verification/'+directories[0];
  for(const name of await wc.fs.readdir(directory)){
    if(!name.includes('/')&&!name.includes('\\\\')&&/\\.(json|log)$/.test(name))artifacts[name]=await wc.fs.readFile(directory+'/'+name,'utf8');
  }
}
try {
  if(!self.crossOriginIsolated)throw new Error('The harness is not cross-origin isolated');
  await event('stage','Load pinned WebContainer SDK');
  const {WebContainer}=await import('/sdk/dist/index.js');
  stage='boot';await event('stage','Boot real WebContainer');
  wc=await WebContainer.boot({coep:'credentialless',workdirName:'esm-sync-917'});
  booted=true;
  wc.on('error',error=>{const details=errorDetails(error);void event('runtime-error',errorText(details),details);});
  stage='mount';await event('stage','Mount Docker-built loader and reconstructed consumer');
  const files=await (await fetch('/files.json')).json();
  await wc.mount(files);
  stage='spawn';await event('stage','Start real WebContainer Node worker');
  // SpawnOptions.cwd is relative to workdir. Omitting it selects the SDK default.
  const child=await wc.spawn(command[0],command.slice(1),{
    env:{PATH:wc.path,NODE_ENV:'production',ESM_ENV:'production',NODE_OPTIONS:'',FORCE_COLOR:'0'}
  });
  started=true;
  stage='run';await event('stage','Run disabled, cold and warm checks plus consumer builds');
  const stream=child.output.pipeTo(new WritableStream({write(chunk){output=(output+chunk).slice(-1000000);return event('output',chunk);}}));
  [code]=await Promise.all([child.exit,stream]);
  stage='collect';await event('stage','Collect VM reports and build evidence');
  await collectArtifacts();
  if(typeof artifacts['report.json']!=='string')throw new Error('Worker exit '+code+' did not produce report.json');
  const worker=JSON.parse(artifacts['report.json']);
  const passed=code===0&&worker.passed===true&&!events.some(value=>value.type==='runtime-error');
  const failure=code!==0?'Worker exited with '+code:events.find(value=>value.type==='runtime-error')?.message||worker.samples?.find(value=>value.passed!==true)?.error||'Worker evidence did not pass';
  stage='complete';
  await result({passed,blocked:false,worker,...(passed?{}:{error:failure}),reproduction:'reconstructed-consumer'});
}catch(error){
  const details=errorDetails(error);
  let collectionError;
  if(started&&stage!=='collect')try{await collectArtifacts();}catch(error){collectionError=errorDetails(error);}
  await result({passed:false,blocked:!booted,error:errorText(details),errorDetails:details,collectionError,reproduction:'reconstructed-consumer'});
}finally{if(wc)wc.teardown();}
`
}
