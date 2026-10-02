import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
export function validateFormalClientOrigin(raw){
 let url;try{url=new URL(raw);}catch{throw Error('Explicit HTTPS API origin required');}
 if(url.protocol!=='https:'||url.origin!==raw||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.port
  ||!url.hostname.includes('.')||/^(?:\d+\.){3}\d+$/.test(url.hostname)||url.hostname.startsWith('[')||['localhost','127.0.0.1'].includes(url.hostname)||/\.(?:localhost|local|invalid|test|example)$/.test(url.hostname))throw Error('Explicit public HTTPS API origin required');
 return url.origin;
}
export async function assertFormalClientArtifacts(buildRoot,origin){
 validateFormalClientOrigin(origin);
 const ops=resolve(buildRoot,'apps/ops/dist'),html=readFileSync(resolve(ops,'index.html'),'utf8');
 const requireRoot=createRequire(resolve(buildRoot,'package.json'));
 const {JSDOM,VirtualConsole}=createRequire(requireRoot.resolve('vitest/package.json'))('jsdom');
 const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'https://synthetic-ops.fanju.cn/?workspace=prelaunch',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
 try{
  const scripts=[...dom.window.document.querySelectorAll('script[type="module"][src]')];assert.equal(scripts.length,1);
  const entry=resolve(ops,scripts[0].getAttribute('src').replace(/^\.?\//,''));assert.ok(entry.startsWith(ops+'/assets/')&&!lstatSync(entry).isSymbolicLink());
  const js=readFileSync(entry,'utf8');assert.ok(js.includes(origin),'Formal ops must embed selected API origin');
  const deny=()=>{throw Error('FORMAL_ARTIFACT_NETWORK_FORBIDDEN');};dom.window.fetch=deny;dom.window.XMLHttpRequest.prototype.open=deny;dom.window.WebSocket=deny;
  for(const el of [...dom.window.document.querySelectorAll('link[rel="modulepreload"],script')])el.remove();
  dom.window.eval(js);await new Promise(done=>setTimeout(done,300));
  assert.ok(dom.window.document.querySelector('#root')?.textContent.includes('登录'),'Formal generated ops must render authentication entry');
  assert.ok(!dom.window.document.querySelector('#root')?.textContent.includes('本地验收工作区'),'Preview query cannot activate formal artifact');assert.equal(errors.length,0);
 }finally{dom.window.close();}
 const weapp=resolve(buildRoot,'apps/miniapp/dist'),app=JSON.parse(readFileSync(resolve(weapp,'app.json'),'utf8'));
 assert.ok(!app.pages.includes('pages/prelaunch/index'));assert.ok(!existsSync(resolve(weapp,'pages/prelaunch/index.js')));
 let originFound=false;function walk(dir){for(const name of readdirSync(dir)){const path=resolve(dir,name),stat=lstatSync(path);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())walk(path);else if(name.endsWith('.js')&&readFileSync(path,'utf8').includes(origin))originFound=true;}}
 walk(weapp);assert.ok(originFound,'Formal weapp must embed selected API origin');
 return {scope:'FORMAL_CLIENT_ARTIFACTS_ENGINEERING_ONLY',opsPreviewDisabled:true,weappPreviewRouteExcluded:true,apiOrigin:origin,realDomainVerified:false,realDeviceVerified:false,releaseAuthorized:false};
}
