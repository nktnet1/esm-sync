// Browser-native ESM: the SDK package is served from its verified local copy.
export function webContainerBrowserPage(nonce: string): string {
  return `
const nonce=${JSON.stringify(nonce)};
let stage='load-sdk', booted=false, wc;
const events=[];
async function event(type,message){
  events.push({type,message,stage});
  await fetch('/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce,type,message,stage})});
}
async function result(value){
  await fetch('/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nonce,crossOriginIsolated:self.crossOriginIsolated,booted,userAgent:navigator.userAgent,stage,...value})});
}
try {
  if(!self.crossOriginIsolated)throw new Error('The harness is not cross-origin isolated');
  await event('stage','Load pinned WebContainer SDK');
  const {WebContainer}=await import('/sdk/dist/index.js');
  stage='boot';await event('stage','Boot real WebContainer');
  wc=await WebContainer.boot({coep:'credentialless',workdirName:'esm-sync-917'});
  booted=true;
  wc.on('error',error=>{void event('runtime-error',String(error.message));});
  stage='mount';await event('stage','Mount Docker-built loader and reconstructed consumer');
  const files=await (await fetch('/files.json')).json();
  await wc.mount(files);
  stage='run';await event('stage','Run disabled, cold and warm checks plus consumer builds');
  const child=await wc.spawn('node',['script/src/esm/verify-webcontainer.js','application'],{
    cwd:wc.workdir,env:{NODE_ENV:'production',ESM_ENV:'production',NODE_OPTIONS:'',FORCE_COLOR:'0'}
  });
  let output='';
  const stream=child.output.pipeTo(new WritableStream({write(chunk){output=(output+chunk).slice(-1000000);return event('output',chunk);}}));
  const code=await child.exit;await stream;
  stage='collect';await event('stage','Collect VM reports and build evidence');
  const names=await wc.fs.readdir('.cache/host-verification');
  const directories=names.filter(name=>name.startsWith('webcontainer-'));
  if(directories.length!==1)throw new Error('Expected one real-host report directory');
  const directory='.cache/host-verification/'+directories[0];
  const artifacts={};
  for(const name of await wc.fs.readdir(directory)){
    if(!name.includes('/')&&/\\.(json|log)$/.test(name))artifacts[name]=await wc.fs.readFile(directory+'/'+name,'utf8');
  }
  const worker=JSON.parse(artifacts['report.json']);
  const passed=code===0&&worker.passed===true&&!events.some(value=>value.type==='runtime-error');
  stage='complete';
  await result({passed,blocked:false,code,worker,artifacts,output,reproduction:'reconstructed-consumer'});
}catch(error){
  await result({passed:false,blocked:!booted,error:String(error.stack||error),reproduction:'reconstructed-consumer'});
}finally{if(wc)wc.teardown();}
`
}
