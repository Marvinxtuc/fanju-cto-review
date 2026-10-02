// @vitest-environment jsdom
import React from '../../apps/ops/node_modules/react/index.js';
import {createRoot} from '../../apps/ops/node_modules/react-dom/client.js';
import {act} from '../../apps/ops/node_modules/react-dom/test-utils.js';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({show:()=>{},hide:()=>{},scan:vi.fn(),requests:vi.fn()}));
vi.mock('../../apps/miniapp/node_modules/@tarojs/taro/index.js',async()=>{const react=await import('../../apps/ops/node_modules/react/index.js');return{default:{scanCode:state.scan},useDidShow:(fn:()=>void)=>{state.show=fn;react.useEffect(fn,[]);},useDidHide:(fn:()=>void)=>{state.hide=fn;}};});
vi.mock('../../apps/miniapp/node_modules/@tarojs/components/dist/index.js',async()=>{const react=await import('../../apps/ops/node_modules/react/index.js');const wrap=(tag:string)=>(props:any)=>react.createElement(tag,props,props.children);return{View:wrap('div'),Text:wrap('span'),Button:wrap('button')};});
vi.mock('../../apps/miniapp/src/api',()=>({formalRequest:state.requests}));
import {FormalCheckin} from '../../apps/miniapp/src/FormalCheckin.js';
it('resumes scanning after hide/show while ignoring a stale camera result',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 state.requests.mockResolvedValue({registrationId:'owned',checkinAt:null,enabled:true,fulfillmentConfirmed:false,scope:'FORMAL_CHECKIN'});
 let finish!:(value:{result:string})=>void;state.scan.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockRejectedValueOnce(Error('user cancelled'));
 const box=document.createElement('div');document.body.append(box);const root=createRoot(box);
 try{
  await act(async()=>root.render(React.createElement(FormalCheckin,{registrationId:'owned'})));
  const button=()=>box.querySelector('button')!;
  await act(async()=>button().click());expect(button().disabled).toBe(true);
  await act(async()=>{state.hide();state.show();});expect(button().disabled).toBe(false);
  await act(async()=>finish({result:'FJCI1.payload.'+'a'.repeat(86)}));
  expect(state.requests.mock.calls.every(call=>!call[1])).toBe(true);expect(button().disabled).toBe(false);
  await act(async()=>button().click());expect(state.scan).toHaveBeenCalledTimes(2);expect(box.textContent).toContain('user cancelled');expect(button().disabled).toBe(false);
 }finally{await act(async()=>root.unmount());box.remove();vi.unstubAllGlobals();}
});
