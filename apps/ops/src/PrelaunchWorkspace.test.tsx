// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ role:"OPS", call:vi.fn() }));
vi.mock("./prelaunch-api.js",()=>({prelaunchClient:{session:()=>({token:"synthetic",actor:{id:"ops-test",role:mock.role}}),call:mock.call,list:async(path:string,key:string)=>(await mock.call("GET",path))[key],logout:vi.fn()},prelaunchEnabled:true}));
import { PrelaunchWorkspace } from "./PrelaunchWorkspace.js";
let container:HTMLDivElement;let root:Root;
beforeEach(async()=>{ mock.role="OPS";mock.call.mockReset();mock.call.mockImplementation(async (_method:string,path:string)=> {
 if(path==="/policy/current") return {policyId:"policy-test",bundleVersion:"V1.1",status:"SIMULATION_ONLY",activation:"NOT_ACTIVATABLE",documents:[]};
 if(path==="/ops/supplies/old-supply")return {supply:{id:"old-supply",snapshot:{min:4,target:6,max:8,maxTables:2,capacity:16,F:100,D:200,WAITLIST_MAX:5,strategy:"FILL_TO_TARGET",estimatedMealMinCents:1000,estimatedMealMaxCents:2000,fixedFees:[{label:"原茶位费",amountCents:100},{label:"原包间费",amountCents:200}]}}};
 if(path==="/ops/supplies/old-supply/history")return {history:[]};
 if(path==="/ops/supplies/old-supply/revision")return {supply:{id:"new-supply"}};
 if(path==="/ops/funding-summary")return {components:{F:{original:100,refunded:10,reserved:20,undisposed:70},D:{original:200,refunded:0,reserved:0,undisposed:200}}};
 if(path==="/ops/financial-cases")return {cases:[{id:"case-test",kind:"UNKNOWN",state:"OPEN",allowedActions:["CLAIM"]}]};
 if(path==="/ops/requests") return {requests:[{id:"dispute-test",kind:"DISPUTE",state:"EXPLANATION_SUBMITTED",allowedActions:["REFUND_D","BREACH"]}]};
 if(path==="/ops/rights")return {rights:[{id:"right-test",kind:"RIGHT_EXPORT",state:"RECEIVED"}]};
 return {supplies:[],registrations:[],jobs:[],cases:[],summary:{receiptCents:100},changes:[]}; });
 container=document.createElement("div");document.body.append(container);root=createRoot(container);await act(async()=>root.render(<PrelaunchWorkspace/>)); });
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
function input(label:string,value:string){const el=container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!;setter.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));}
async function submit(label:string){await act(async()=>container.querySelector<HTMLFormElement>(`form[aria-label="${label}"]`)!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
describe("controlled prelaunch ops DOM",()=>{
 it("allows scoped restaurant binding without client role escalation",async()=>{await act(async()=>{input("绑定餐厅测试人员 已有餐厅测试账号 ID","restaurant-person");input("绑定餐厅测试人员 授权餐厅 ID","restaurant-new");});await submit("绑定餐厅测试人员");expect(mock.call).toHaveBeenCalledWith("POST","/ops/actors/restaurant-person/restaurant",{restaurantId:"restaurant-new"});});
 it("accepts activity cancellation with a persistent business key",async()=>{await act(async()=>input("取消活动 活动 ID","activity-test"));await submit("取消活动");expect(mock.call).toHaveBeenCalledWith("POST","/ops/activities/activity-test/cancel",expect.objectContaining({businessKey:expect.stringMatching(/^ops-ui-/)}));});
 it("exposes real rights processing rather than a static privacy notice",async()=>{const b=[...container.querySelectorAll("button")].find(b=>b.textContent==="处理本人权利请求")!;await act(async()=>b.click());expect(mock.call).toHaveBeenCalledWith("POST","/ops/rights/right-test/process",{});});
 it("preserves all disclosed fixed fees when creating a new revision",async()=>{await act(async()=>input("供给历史 供给 ID","old-supply"));await submit("供给历史");await submit("新供给修订");expect(mock.call).toHaveBeenCalledWith("POST","/ops/supplies/old-supply/revision",expect.objectContaining({fixedFees:[{label:"原茶位费",amountCents:100},{label:"原包间费",amountCents:200}]}));});
 it("renders server component buckets independently of first-page counts",()=>{expect(container.textContent).toContain("undisposed：70");expect(container.textContent).toContain("original：200");});
 it("claims a server-authorized financial case with no invented channel result",async()=>{const b=[...container.querySelectorAll("button")].find(b=>b.textContent==="认领资金待办")!;await act(async()=>b.click());expect(mock.call).toHaveBeenCalledWith("POST","/ops/financial-cases/case-test/claim",{});});
 it("does not blanket approve requests without a reason",()=>{const b=[...container.querySelectorAll("button")].find(b=>b.textContent==="正常退D")!;expect(b.disabled).toBe(true);});
});
