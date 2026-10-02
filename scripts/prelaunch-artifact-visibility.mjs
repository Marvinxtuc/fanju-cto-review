// Check generated local acceptance artifacts. jsdom proves the generated ops branch renders,
// not a real browser/API E2E or WeChat device launch. No network is used.
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
export async function assertAcceptanceArtifacts(buildRoot){
 const ops=resolve(buildRoot,'apps/ops/dist'),html=readFileSync(resolve(ops,'index.html'),'utf8');
 const requireRoot=createRequire(resolve(buildRoot,'package.json'));
 // Resolve the already locked Vitest peer, matching the native DOM test runtime.
 const {JSDOM,VirtualConsole}=createRequire(requireRoot.resolve('vitest/package.json'))('jsdom');
 const errors=[],console=new VirtualConsole();console.on('jsdomError',e=>errors.push(e.message));
 const dom=new JSDOM(html,{url:'http://127.0.0.1:4173/?workspace=prelaunch',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:console});
 try{
  const scripts=[...dom.window.document.querySelectorAll('script[type="module"][src]')];assert.equal(scripts.length,1,'Expected one generated ops entry');
  const relative=scripts[0].getAttribute('src').replace(/^\.?\//,'');const entry=resolve(ops,relative);
  assert.ok(entry.startsWith(ops+'/assets/')&&!lstatSync(entry).isSymbolicLink(),'Generated entry must remain in ops assets');
  const js=readFileSync(entry,'utf8');assert.ok(js.includes('http://127.0.0.1:3000'),'Compiled ops transport must use explicit local API origin');
  const deny=()=>{throw Error('ARTIFACT_VISIBILITY_NETWORK_FORBIDDEN');};dom.window.fetch=deny;dom.window.XMLHttpRequest.prototype.open=deny;dom.window.WebSocket=deny;
  // Avoid modulepreload fetches; eval the existing native Vite entry rather than source components.
  for(const el of [...dom.window.document.querySelectorAll('link[rel="modulepreload"],script')])el.remove();
  dom.window.eval(js);
  await new Promise(done=>setTimeout(done,300));
  assert.ok(dom.window.document.querySelector('#root h1')?.textContent.includes('本地验收工作区'),'Generated ?workspace=prelaunch must render the actual acceptance workspace; disabled flag is a failure');
  assert.equal(errors.length,0,'Generated ops artifact runtime errors: '+errors.join(';'));
 }finally{dom.window.close();}
 const weapp=resolve(buildRoot,'apps/miniapp/dist');const app=JSON.parse(readFileSync(resolve(weapp,'app.json'),'utf8'));
 assert.ok(app.pages.includes('pages/prelaunch/index'),'Native weapp route must include local acceptance workspace');
 assert.ok(existsSync(resolve(weapp,'pages/prelaunch/index.js')),'Native weapp workspace JS must exist');
 // Taro may emit the loopback literal into a shared runtime chunk; source/config flag is separately explicit.
 return {ops:{generated_entry_render:'PASS',workspace_query:'?workspace=prelaunch',rendered_title:'饭局 · 本地验收工作区',api_origin:'http://127.0.0.1:3000',environment_flag:'VITE_FANJU_PRELAUNCH_ENABLED=true',scope:'Native Vite generated entry evaluated in jsdom without network; not real browser/API E2E'},weapp:{route:'pages/prelaunch/index',generated_route_present:true,environment_flag:'TARO_APP_PRELAUNCH_ENABLED=true',scope:'Taro route/artifact only; not WeChat device launch'}};
}
