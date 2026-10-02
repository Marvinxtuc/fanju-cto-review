// @vitest-environment jsdom
import React from "../../apps/ops/node_modules/react/index.js";
import {createRoot,type Root} from "../../apps/ops/node_modules/react-dom/client.js";
import {act} from "../../apps/ops/node_modules/react-dom/test-utils.js";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({call:vi.fn(),list:vi.fn()}));
vi.mock("../../apps/miniapp/src/prelaunch-api",()=>({prelaunchEnabled:true,prelaunchClient:{session:()=>({token:"test",actor:{id:"user-test",role:"USER"}}),call:mock.call,list:mock.list,logout:vi.fn()}}));
vi.mock("../../apps/miniapp/node_modules/@tarojs/taro/index.js",async()=>{const react=await import("../../apps/ops/node_modules/react/index.js");return {default:{scanCode:vi.fn()},useDidShow:(f:()=>void)=>react.useEffect(f,[]),useDidHide:()=>{}};});
vi.mock("../../apps/miniapp/node_modules/@tarojs/components/dist/index.js",async()=>{const react=await import("../../apps/ops/node_modules/react/index.js");const wrap=(tag:string)=>(props:Record<string,unknown>)=>{const {children,scrollY,selectable,...rest}=props;return react.createElement(tag,rest,children as React.ReactNode);};return {Button:wrap("button"),Input:wrap("input"),ScrollView:wrap("div"),Text:wrap("span"),View:wrap("div")};});
import Page from "../../apps/miniapp/src/pages/prelaunch/index.js";
let container:HTMLDivElement;let root:Root;
beforeEach(async()=>{mock.call.mockReset();mock.list.mockReset();mock.call.mockImplementation(async(method:string,path:string)=>{
 if(path==="/policy/current?scope=SIMULATION_ONLY")return {policyId:"policy-test",bundleVersion:"V1.1",status:"SIMULATION_ONLY",activation:"NOT_ACTIVATABLE",documents:[]};
 if(path==="/consents")return {consentId:"consent-test"};
 if(path==="/changes")return {changes:[{id:"change-test",state:"PROPOSED",reason:"合成换店"}]};
 if(path==="/registrations")return {registrations:[{id:"reg-test",state:"FORMAL",F:100,D:200,total:300}],nextCursor:null};
 if(path==="/registrations/reg-test" && method==="GET")return {registration:{id:"reg-test",state:"FORMAL",F:100,D:200,total:300,refunds:[{id:"refund-test",state:"UNKNOWN",F:0,D:200}]}};
 return {};});mock.list.mockImplementation(async(path:string)=>{if(path==="/activities")return [{id:"activity-test",supplyId:"supply-test",title:"合成活动",startsAt:"2026-10-05T10:00:00Z",district:"合成区域",F:100,D:200}];if(path==="/requests")return [];if(path==="/notices")throw Error("局部消息不可用");return [];});container=document.createElement("div");document.body.append(container);root=createRoot(container);await act(async()=>root.render(React.createElement(Page)));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
async function click(label:string){await act(async()=>[...container.querySelectorAll("button")].find(b=>b.textContent===label)!.click());}
describe("synthetic native component user journeys",()=>{
 it("keeps orders usable when the independent inbox fails",()=>{expect(container.textContent).toContain("reg-test");expect(container.textContent).toContain("消息暂时不可用");});
 it("sends strict change rejection without substituting ordinary cancellation",async()=>{await click("拒绝新安排并申请全退");expect(mock.call).toHaveBeenCalledWith("POST","/changes/change-test/respond",{choice:"REJECT"});});
 it("shows component refund UNKNOWN instead of claiming arrival",async()=>{await click("查看详情");expect(container.textContent).toContain("refund-test");expect(container.textContent).toContain("UNKNOWN");expect(container.textContent).toContain("保证金 ¥2.00");});
 it("retains blocked applications without fabricating a payable registration",async()=>{const fallback=mock.call.getMockImplementation()!;mock.call.mockImplementation(async(method:string,path:string,...rest:unknown[])=>path==="/registrations"&&method==="POST"?{state:"BLOCKED_POLICY",request:{id:"blocked-application",kind:"REGISTRATION",state:"BLOCKED_POLICY"},blockerIds:["OP-08"]}:fallback(method,path,...rest));await click("确认已阅读三份测试文本");await click("保存本次确认");await click("申请付费候补");expect(container.textContent).toContain("blocked-application");expect(container.textContent).toContain("未创建收费报名");expect([...container.querySelectorAll("button")].some(b=>b.textContent==="继续模拟付款")).toBe(false);});
 it("accepts closure while preserving uncompleted obligations",async()=>{await click("注销申请");expect(mock.call).toHaveBeenCalledWith("POST","/rights",expect.objectContaining({kind:"CLOSURE",businessKey:expect.stringMatching(/^ui-/)}));expect(container.textContent).toContain("已有履约和资金责任会保留");});
});

describe("address cache requires a current server authorization",()=>{
 async function showAddress(){const fallback=mock.call.getMockImplementation()!;mock.call.mockImplementation(async(method:string,path:string,...rest:unknown[])=>path==="/registrations/reg-test"?{registration:{id:"reg-test",state:"FORMAL",F:100,D:200,total:300,table:{state:"FORMED",restaurantName:"合成餐厅",address:"合成地址缓存证据"}}}:fallback(method,path,...rest));await click("查看详情");expect(container.textContent).toContain("合成地址缓存证据");return fallback;}
 it("hides the old address before a failed detail reload",async()=>{await showAddress();const fallback=mock.call.getMockImplementation()!;mock.call.mockImplementation(async(method:string,path:string,...rest:unknown[])=>{if(path==="/registrations/reg-test")throw Error("读取失败");return fallback(method,path,...rest);});await click("查询付款与退款进度");expect(container.textContent).not.toContain("合成地址缓存证据");expect(container.textContent).toContain("读取失败");});
 it("manual refresh clears prior authorization even when subsequent requests fail",async()=>{await showAddress();mock.call.mockRejectedValue(Error("离线"));mock.list.mockRejectedValue(Error("离线"));await click("刷新");expect(container.textContent).not.toContain("合成地址缓存证据");expect(container.textContent).toContain("reg-test");});
 it("never displays an invalidated table address even if an old payload carries it",async()=>{await showAddress();mock.call.mockResolvedValue({registration:{id:"reg-test",state:"FORMAL",F:100,D:200,total:300,table:{state:"INVALIDATED",restaurantName:"合成餐厅",address:"合成地址缓存证据"}}});await click("查询付款与退款进度");expect(container.textContent).not.toContain("合成地址缓存证据");expect(container.textContent).toContain("INVALIDATED");expect(container.textContent).toContain("合成餐厅");expect(container.textContent).toContain("尚未解锁");});
});

describe("USR06 presentation priority retains all activities",()=>{
 it("places preferred activities first across collected pages, preserving equal-priority order and every other activity",async()=>{
 const rows=[{id:"other-first",title:"其他活动第一",preferenceMatched:false},{id:"match-first",title:"偏好活动第一",preferenceMatched:true},{id:"other-second",title:"其他活动第二",preferenceMatched:false},{id:"match-second",title:"偏好活动第二",preferenceMatched:true}].map(r=>({...r,supplyId:"s",startsAt:"2026-10-05T10:00:00Z",F:100,D:200}));mock.list.mockImplementation(async(path:string)=>path==="/activities"?rows:[]);await click("刷新");const content=container.textContent!;expect(content.indexOf("偏好活动第一")).toBeLessThan(content.indexOf("偏好活动第二"));expect(content.indexOf("偏好活动第二")).toBeLessThan(content.indexOf("其他活动第一"));expect(content.indexOf("其他活动第一")).toBeLessThan(content.indexOf("其他活动第二"));expect(mock.list).toHaveBeenCalledWith("/activities","activities",true);expect([...container.querySelectorAll("button")].filter(b=>b.textContent==="申请正式席位")).toHaveLength(4);
 });
 it("empty preferences retain server ordering and do not remove or disable activities",async()=>{
 mock.list.mockImplementation(async(path:string)=>path==="/activities"?[{id:"b",title:"原序第一",startsAt:"2026-10-05T10:00:00Z",preferenceMatched:false},{id:"a",title:"原序第二",startsAt:"2026-10-05T10:00:00Z",preferenceMatched:false}]:[]);await click("刷新");expect(container.textContent!.indexOf("原序第一")).toBeLessThan(container.textContent!.indexOf("原序第二"));expect(container.textContent).toContain("不限制报名、付款或排桌");
 });
});

describe("BR09/54 amount presentation and pending refund semantics",()=>{
 it("shows total F+D excluding estimated restaurant meal cost",async()=>{mock.list.mockImplementation(async(path:string)=>path==="/activities"?[{id:"money-display",title:"合成餐费展示",supplyId:"s",startsAt:"2026-10-05T10:00:00Z",F:120,D:340,estimatedMealMinCents:5000,estimatedMealMaxCents:7000}]:[]);await click("刷新");expect(container.textContent).toContain("服务费 ¥1.20 · 保证金 ¥3.40 · 合计 ¥4.60，餐费到店自理");expect(container.textContent).toContain("预计到店餐费：¥50.00—¥70.00");expect(container.textContent).not.toContain("合计 ¥54.60");});
 it("WAITING_BATCH and UNKNOWN remain distinct from refunded or money-arrived facts",async()=>{const fallback=mock.call.getMockImplementation()!;mock.call.mockImplementation(async(method:string,path:string,...rest:unknown[])=>path==="/registrations/reg-test"?{registration:{id:"reg-test",state:"FORMAL",F:100,D:200,total:300,refunds:[{id:"batch-pending",state:"WAITING_BATCH",F:0,D:200},{id:"query-pending",state:"UNKNOWN",F:0,D:200}]}}:fallback(method,path,...rest));await click("查看详情");expect(container.textContent).toContain("WAITING_BATCH");expect(container.textContent).toContain("UNKNOWN");expect(container.textContent).toContain("均不代表退款已到账");expect(container.textContent).not.toContain("REFUNDED");expect(container.textContent).not.toContain("退款成功");});
});
