// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({login:vi.fn(),refresh:vi.fn(),logout:vi.fn(),obligations:vi.fn(),current:vi.fn()}));
vi.mock("./controlled-identity-api.js",()=>({browserControlledIdentityClient:()=>mock}));
import { ControlledIdentityWorkspace } from "./ControlledIdentityWorkspace.js";
let container: HTMLDivElement; let root: Root;
beforeEach(async()=>{
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});mock.obligations.mockReset();mock.current.mockReset();mock.current.mockReturnValue({role:'OPS'});
  mock.login.mockReset();mock.refresh.mockReset();mock.logout.mockReset();
  mock.login.mockResolvedValue({id:"restaurant-actor",personId:"person-test",role:"RESTAURANT",userId:null,restaurantId:"restaurant-test",version:1});
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(<ControlledIdentityWorkspace/>));
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function submit() {
  await act(async()=>{
    const fields=container.querySelectorAll("input");const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;
    ["restaurant-account","synthetic-password"].forEach((v,i)=>{setter.call(fields[i],v);fields[i]!.dispatchEvent(new Event("input",{bubbles:true}));});
  });
  await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
}
it("renders only the verified restaurant identity and clears login fields",async()=>{
  await submit();expect(mock.login).toHaveBeenCalledWith("restaurant-account","synthetic-password");
  expect(container.textContent).toContain("角色：餐厅");expect(container.textContent).toContain("授权餐厅：restaurant-test");
  expect(container.textContent).toContain("提交餐厅供给");expect(container.textContent).not.toContain("批准此供给及报价");expect(container.querySelector('input[type="password"]')).toBeNull();
});
it("returns to login on failed identity revalidation",async()=>{
  await submit();mock.refresh.mockRejectedValue(Error("登录已失效"));
  await act(async()=>[...container.querySelectorAll("button")].find(x=>x.textContent==="重新核验身份")!.click());
  expect(container.querySelector("form")).not.toBeNull();expect(container.querySelector('[role="alert"]')!.textContent).toContain("失效");
});
it("logout wins over a pending successful login",async()=>{
  let resolve!:(value:unknown)=>void;mock.login.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await submit();
  expect(container.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
  await act(async()=>[...container.querySelectorAll("button")].find(x=>x.textContent==="退出登录")!.click());
  await act(async()=>resolve({id:"ops-test",personId:"person-test",role:"OPS",userId:null,restaurantId:null,version:1}));
  expect(container.querySelector("form")).not.toBeNull();expect(container.textContent).not.toContain("角色：运营");expect(mock.logout).toHaveBeenCalled();
});

const due={caseId:'case-test',evidenceConflict:false,obligation:{amountCents:100,confirmedCents:40,remainingCents:60,state:'EXECUTION_RECORDED'}};
it('shows original due and confirmed remainder without declaring channel acceptance',async()=>{
 mock.login.mockResolvedValue({id:'ops-test',personId:'person-test',role:'OPS',userId:null,restaurantId:null,version:1});mock.obligations.mockResolvedValue({items:[due,{caseId:'conflict-test',evidenceConflict:true,obligation:null}],nextCursor:null});await submit();
 await act(async()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='查看应退进度')!.click());
 expect(container.textContent).toContain('原应退：¥1.00');expect(container.textContent).toContain('剩余：¥0.60');expect(container.textContent).toContain('待渠道确认');expect(container.textContent).toContain('证据冲突，金额待核对');expect(container.textContent).toContain('正式供给与退款');expect(container.textContent).not.toContain('已确认全退');
});
it('discards a pending funds response after logout and hides records on visibility loss',async()=>{
 mock.login.mockResolvedValue({id:'ops-test',personId:'person-test',role:'OPS',userId:null,restaurantId:null,version:1});let resolve!:(v:unknown)=>void;mock.obligations.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));await submit();
 await act(async()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='查看应退进度')!.click());await act(async()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='退出登录')!.click());await act(async()=>resolve({items:[due],nextCursor:null}));expect(container.textContent).not.toContain('case-test');
 mock.obligations.mockResolvedValue({items:[due],nextCursor:null});await submit();await act(async()=>[...container.querySelectorAll('button')].find(x=>x.textContent==='查看应退进度')!.click());expect(container.textContent).toContain('case-test');
 await act(async()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));});expect(container.textContent).not.toContain('case-test');expect(container.querySelector('form')).not.toBeNull();
});
