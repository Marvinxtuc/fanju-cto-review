// @vitest-environment jsdom
import React from '../../apps/ops/node_modules/react/index.js';
import {createRoot,type Root} from '../../apps/ops/node_modules/react-dom/client.js';
import {act} from '../../apps/ops/node_modules/react-dom/test-utils.js';
import {it,expect,vi} from 'vitest';
const camera=vi.hoisted(()=>({token:'',calls:[] as unknown[]}));
vi.mock('../../apps/miniapp/node_modules/@tarojs/taro/index.js',async()=>{const r=await import('../../apps/ops/node_modules/react/index.js');return{default:{scanCode:async(o:unknown)=>{camera.calls.push(o);return{result:camera.token};}},useRouter:()=>({params:{id:process.env.CHECKIN_REGISTRATION_ID}}),useDidShow:(f:()=>void)=>r.useEffect(f,[]),useDidHide:()=>{},navigateTo:async()=>{}};});
vi.mock('../../apps/miniapp/node_modules/@tarojs/components/dist/index.js',async()=>{const r=await import('../../apps/ops/node_modules/react/index.js');const wrap=(tag:string)=>(p:any)=>r.createElement(tag,p,p.children);return{View:wrap('div'),Text:wrap('span'),Button:wrap('button')};});
vi.mock('../../apps/miniapp/src/api',()=>({formalRefundRequestKey:vi.fn(),beginNewFormalAttempt:vi.fn(),prepareFormalPayment:vi.fn(),formalRequest:async(path:string,options:any={})=>{const res=await fetch(process.env.CHECKIN_ORIGIN+path,{method:options.method??'GET',headers:{authorization:process.env.CHECKIN_USER_AUTHORIZATION!,'content-type':'application/json'},...(options.data?{body:JSON.stringify(options.data)}:{})});if(!res.ok)throw Error('Synthetic HTTP operation failed '+res.status);return res.json();}}));
import {createControlledIdentityClient} from '../../apps/ops/src/controlled-identity-api.js';
import {FormalBusinessWorkspace} from '../../apps/ops/src/FormalBusinessWorkspace.js';
import {FormalOrderDetail} from '../../apps/miniapp/src/FormalOrderDetail.js';
it('restaurant actual main QR UI and user actual order detail scan over owned HTTP preserve one attendance fact',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const client=createControlledIdentityClient(async(path,options)=>{const res=await fetch(process.env.CHECKIN_ORIGIN+path,options),data=await res.json();if(path.endsWith('/checkin-token'))camera.token=data.token;return{status:res.status,data};});
 let box:HTMLDivElement,root:Root;
 async function mount(node:React.ReactElement){box=document.createElement('div');document.body.append(box);root=createRoot(box);await act(async()=>root.render(node));}
 async function unmount(){await act(async()=>root.unmount());box.remove();}
 async function wait(predicate:()=>boolean){const end=Date.now()+10000;while(Date.now()<end){await act(async()=>{await new Promise(r=>setTimeout(r,30));});if(predicate())return;}throw Error('Checkin DOM timeout');}
 const button=(label:string)=>[...box.querySelectorAll('button')].find(b=>b.textContent===label);
 async function click(label:string){await wait(()=>!!button(label)&&!button(label)!.disabled);await act(async()=>button(label)!.click());}
 async function input(label:string,value:string){const el=box.querySelector('[aria-label="'+label+'"]') as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
 const identity=await client.login(process.env.CHECKIN_RESTAURANT_USERNAME!,process.env.CHECKIN_PASSWORD!);await mount(React.createElement(FormalBusinessWorkspace,{client,identity,onSessionLost:()=>{throw Error('Session lost');}}));
 try{await input('签到活动编号',process.env.CHECKIN_ACTIVITY_ID!);await input('签到供应编号',process.env.CHECKIN_SUPPLY_ID!);await click('生成或刷新现场签到码');await wait(()=>!!box.querySelector('img[alt="正式现场签到二维码"]'));expect(box.querySelector('img')!.src.startsWith('data:image/gif;base64,')).toBe(true);expect(box.textContent).not.toContain(camera.token);expect(camera.token.startsWith('FJCI1.')).toBe(true);}finally{await unmount();}
 await mount(React.createElement(FormalOrderDetail));
 try{await click('扫描本场正式签到码');await wait(()=>box.textContent!.includes('首次扫码记录：'));const text=[...box.querySelectorAll('span')].find(s=>s.textContent?.startsWith('首次扫码记录：'))!.textContent;
 await click('扫描本场正式签到码');await wait(()=>!button('扫描本场正式签到码')!.disabled);expect([...box.querySelectorAll('span')].find(s=>s.textContent?.startsWith('首次扫码记录：'))!.textContent).toEqual(text);
 expect(camera.calls).toEqual([{onlyFromCamera:true,scanType:['qrCode']},{onlyFromCamera:true,scanType:['qrCode']}]);expect(box.textContent).toContain('扫码记录与餐厅履约确认分别处理');
 }finally{await unmount();camera.token='';}
});
