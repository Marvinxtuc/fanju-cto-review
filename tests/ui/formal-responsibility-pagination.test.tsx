// @vitest-environment jsdom
import React from '../../apps/ops/node_modules/react/index.js';
import {createRoot} from '../../apps/ops/node_modules/react-dom/client.js';
import {act} from '../../apps/ops/node_modules/react-dom/test-utils.js';
import {it,expect,vi} from 'vitest';
import {createControlledIdentityClient} from '../../apps/ops/src/controlled-identity-api.js';
import {FormalResponsibilityCancellation} from '../../apps/ops/src/FormalResponsibilityCancellation.js';
it('loads a restaurant proposal beyond page one through the real controlled client',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const principal={id:'ops',personId:'person',role:'OPS',userId:null,restaurantId:null,version:1};
 const send=vi.fn(async(path:string)=>({status:200,data:path.endsWith('/login')?{version:'v11-identity-1',principal,token:'synthetic'}:path.endsWith('/identity')?{version:'v11-identity-1',principal}:path.includes('?cursor=')?{requests:[{id:'last-proposal',activityId:'final-activity',kind:'FORMAL_RESPONSIBILITY_CANCELLATION_PROPOSAL',state:'PENDING_PLATFORM_APPROVAL'}],nextCursor:null}:{requests:Array.from({length:100},(_,n)=>({id:'record-'+n,activityId:'activity-'+n,kind:'FORMAL_RESPONSIBILITY_CANCELLATION',state:'ACCEPTED'})),nextCursor:'record:99'} }));
 const client=createControlledIdentityClient(send),identity=await client.login('ops','synthetic');
 const box=document.createElement('div');document.body.append(box);const root=createRoot(box);
 try{
  await act(async()=>root.render(React.createElement(FormalResponsibilityCancellation,{client,identity,onSessionLost:()=>{throw Error('session lost');}})));
  const button=(text:string)=>[...box.querySelectorAll('button')].find(b=>b.textContent===text)!;
  await act(async()=>button('读取责任取消记录').click());expect(box.querySelectorAll('article')).toHaveLength(100);
  await act(async()=>button('加载下一页责任取消记录').click());
  expect(send.mock.calls.at(-1)?.[0]).toBe('/api/v11/formal/responsibility-cancellations?cursor=record%3A99');
  expect(box.querySelectorAll('article')).toHaveLength(101);expect(button('接受餐厅责任取消')).toBeDefined();expect(box.querySelector('[role="alert"]')).toBeNull();
 }finally{await act(async()=>root.unmount());box.remove();vi.unstubAllGlobals();}
});
