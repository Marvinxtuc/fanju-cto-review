// @vitest-environment jsdom
import React from '../../apps/ops/node_modules/react/index.js';
import {createRoot,type Root} from '../../apps/ops/node_modules/react-dom/client.js';
import {act} from '../../apps/ops/node_modules/react-dom/test-utils.js';
import {it,expect,vi} from 'vitest';
import {createControlledIdentityClient} from '../../apps/ops/src/controlled-identity-api.js';
import {FormalBusinessWorkspace} from '../../apps/ops/src/FormalBusinessWorkspace.js';
it('actual controlled restaurant and OPS workspace records responsibility cancellation via guarded loopback HTTP',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const paths:string[]=[],client=createControlledIdentityClient(async(path,options)=>{paths.push(path);const res=await fetch(process.env.RESPONSIBILITY_ORIGIN+path,options);return {status:res.status,data:await res.json()};});
 let box:HTMLDivElement,root:Root;
 async function mount(identity:Awaited<ReturnType<typeof client.login>>){box=document.createElement('div');document.body.append(box);root=createRoot(box);await act(async()=>root.render(React.createElement(FormalBusinessWorkspace,{client,identity,onSessionLost:()=>{throw Error('Unexpected session loss');}})));}
 async function unmount(){await act(async()=>root.unmount());box.remove();}
 async function wait(predicate:()=>boolean){const end=Date.now()+10000;while(Date.now()<end){await act(async()=>{await new Promise(r=>setTimeout(r,30));});if(predicate())return;}throw Error('Responsibility DOM timeout: '+box.textContent);}
 const button=(label:string)=>[...box.querySelectorAll('button')].find(b=>b.textContent===label);
 async function click(label:string){await wait(()=>!!button(label)&&!button(label)!.disabled);await act(async()=>button(label)!.click());}
 async function activity(){const input=box.querySelector('[aria-label="责任取消活动编号"]') as HTMLInputElement;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,process.env.RESPONSIBILITY_ACTIVITY_ID!);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});}
 const restaurant=await client.login(process.env.RESPONSIBILITY_RESTAURANT_USERNAME!,process.env.RESPONSIBILITY_PASSWORD!);await mount(restaurant);
 try{await activity();expect(button('确认平台责任取消')).toBeUndefined();await click('提出餐厅责任取消申请');await wait(()=>box.textContent!.includes('等待平台确认；尚未移除成员'));}finally{await unmount();}
 const ops=await client.login(process.env.RESPONSIBILITY_OPS_USERNAME!,process.env.RESPONSIBILITY_PASSWORD!);await mount(ops);
 try{
  await click('读取责任取消记录');
  for(let i=0;i<50;i++){await wait(()=>!button('读取责任取消记录')!.disabled);const candidate=[...box.querySelectorAll('article')].find(a=>a.textContent?.includes(process.env.RESPONSIBILITY_ACTIVITY_ID!)&&a.querySelector('button')?.textContent==='接受餐厅责任取消');if(candidate){await act(async()=>candidate.querySelector('button')!.click());break;}if(!button('加载下一页责任取消记录'))throw Error('Owned restaurant proposal not found');await click('加载下一页责任取消记录');}
  if(process.env.RESPONSIBILITY_NORMAL_INTERSECTION==='true'){await wait(()=>box.textContent!.includes('责任取消请求已转入独立履约权益审核'));expect(box.textContent).toContain('尚未接受取消，成员与席位保留，原资金处置不变');expect(box.textContent).not.toContain('责任取消已接受，原成员权益已保存并释放席位');}else{await wait(()=>box.textContent!.includes('责任取消已接受，原成员权益已保存并释放席位'));expect(box.textContent).toContain('补偿金额仍待专业签收，不代表退款到账');}
  expect(paths.some(p=>p.includes('/restaurant/formal/activities/')&&p.endsWith('/responsibility-cancellations'))).toBe(true);
  expect(paths.some(p=>p.includes('/ops/formal/activities/')&&p.endsWith('/responsibility-cancellations'))).toBe(true);
 }finally{await unmount();}
});
it('does not report responsibility cancellation accepted when API omits explicit outcome fields',async()=>{
 const {FormalResponsibilityCancellation}=await import('../../apps/ops/src/FormalResponsibilityCancellation.js');
 const identity={id:'synthetic-ops',personId:'synthetic-person',role:'OPS' as const,userId:null,restaurantId:null,version:0},client={current:()=>identity,business:async(_path:string,method:string)=>method==='POST'?{state:'CANCELLATION_ACCEPTED_REFUND_PENDING'}:{requests:[],nextCursor:null}};
 const box=document.createElement('div');document.body.append(box);const root=createRoot(box);await act(async()=>root.render(React.createElement(FormalResponsibilityCancellation,{client:client as any,identity,onSessionLost:()=>{}})));
 try{const input=box.querySelector('input')!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'synthetic-activity');input.dispatchEvent(new Event('input',{bubbles:true}));});await act(async()=>[...box.querySelectorAll('button')].find(b=>b.textContent==='确认平台责任取消')!.click());expect(box.textContent).toContain('责任取消结果尚未明确');expect(box.textContent).not.toContain('责任取消已接受，原成员权益已保存并释放席位');}finally{await act(async()=>root.unmount());box.remove();}
});
