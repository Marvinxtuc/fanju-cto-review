import React,{act} from '../../apps/ops/node_modules/react/index.js';
import {createRoot,type Root} from '../../apps/ops/node_modules/react-dom/client.js';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({storage:new Map<string,string>(),session:'session-a',open:vi.fn(),list:vi.fn(),funds:vi.fn(),submit:vi.fn(),read:vi.fn(),hide:undefined as undefined|(()=>void)}));
vi.mock('../../apps/miniapp/node_modules/@tarojs/taro/index.js',async()=>{const react=await import('../../apps/ops/node_modules/react/index.js');return{default:{getStorageSync:(k:string)=>mock.storage.get(k),setStorageSync:(k:string,v:string)=>mock.storage.set(k,v)},useDidShow:(f:()=>void)=>react.useEffect(f,[]),useDidHide:(f:()=>void)=>{mock.hide=f;}};});
vi.mock('../../apps/miniapp/node_modules/@tarojs/components/dist/index.js',async()=>{const react=await import('../../apps/ops/node_modules/react/index.js');const wrap=(tag:string)=>(props:Record<string,unknown>)=>{const {children,scrollY,...rest}=props;return react.createElement(tag,rest,children as React.ReactNode);};return{Button:wrap('button'),Text:wrap('span'),View:wrap('div'),ScrollView:wrap('div')};});
vi.mock('../../apps/miniapp/src/api',()=>({openMoneySession:mock.open,listMoneyRegistrations:mock.list,getFormalFunds:mock.funds,submitFormalRefund:mock.submit,getFormalRefund:mock.read,isCurrentUserSession:(token:string)=>token===mock.session}));
import Page from '../../apps/miniapp/src/pages/money-records/index';
let root:Root,container:HTMLDivElement;
const request={requestId:'request-a',registrationId:'registration-a',acceptedAt:'2026-10-01T04:00:00Z',state:'BLOCKED_POLICY',refundApproved:false};
async function click(label:string){const button=[...container.querySelectorAll('button')].find(x=>x.textContent===label);expect(button).toBeTruthy();await act(async()=>button!.click());}
beforeEach(async()=>{vi.clearAllMocks();mock.storage.clear();mock.session='session-a';Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});mock.open.mockResolvedValue({token:'session-a',userId:'user-a',financialRecordsEnabled:true,refundIntakeEnabled:true});mock.list.mockResolvedValue({registrations:[{registrationId:'registration-a',refundRequests:[]}],nextCursor:null});mock.funds.mockResolvedValue({paidCents:100,confirmedRefundCents:40,receipts:[{receiptId:'receipt-a',amountCents:100,paidAt:'2026-10-01T03:00:00Z',classification:'UNALLOCATED'}],refunds:[{refundId:'refund-a',amountCents:40,state:'CONFIRMED'}]});mock.submit.mockResolvedValue(request);mock.read.mockResolvedValue(request);container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(React.createElement(Page)));});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
it('shows recorded money, accepted application and recovers status without another application',async()=>{
 await click('查看收款与退款');expect(container.textContent).toContain('已记录收款：1.00 元');expect(container.textContent).toContain('已确认退款：0.40 元');expect(container.textContent).toContain('归属核对中');
 await click('申请退款');expect(container.textContent).toContain('已受理，等待处理');expect(container.textContent).toContain(request.acceptedAt);
 await click('查看申请进度');expect(mock.submit).toHaveBeenCalledOnce();expect(mock.read).toHaveBeenCalledWith('session-a','request-a');
});
it('reuses persisted key after ambiguous submission failure and remount',async()=>{
 mock.submit.mockRejectedValueOnce(Error('网络中断'));await click('申请退款');const key=mock.submit.mock.calls[0]![2];expect(container.textContent).toContain('网络中断');
 await act(async()=>root.unmount());root=createRoot(container);await act(async()=>root.render(React.createElement(Page)));await click('申请退款');expect(mock.submit.mock.calls[1]![2]).toBe(key);
});
it('clears old account records and does not render a late financial response',async()=>{
 let finish!:(value:unknown)=>void;mock.funds.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const button=[...container.querySelectorAll('button')].find(x=>x.textContent==='查看收款与退款')!;
 await act(async()=>button.click());mock.session='session-b';await act(async()=>{finish({paidCents:99999,confirmedRefundCents:0,receipts:[],refunds:[]});});expect(container.textContent).not.toContain('999.99');
 expect(mock.submit).not.toHaveBeenCalled();expect(container.textContent).not.toContain('报名记录 1');expect(container.textContent).toContain('登录状态已改变');
});
it('hiding the page clears financial and request data',async()=>{await click('查看收款与退款');await click('申请退款');await act(async()=>mock.hide!());expect(container.textContent).not.toContain('已记录收款：');expect(container.textContent).not.toContain(request.acceptedAt);});
it('shows obligation remainder and distinguishes recorded execution from confirmed refund',async()=>{
 const funds={paidCents:100,confirmedRefundCents:40,receipts:[],refunds:[],refundObligations:[{receiptId:'receipt-a',amountCents:100,confirmedCents:40,remainingCents:60,state:'AWAITING_EXECUTION'}]};
 mock.funds.mockResolvedValue(funds);await click('查看收款与退款');expect(container.textContent).toContain('已登记应退：1.00 元');expect(container.textContent).toContain('剩余应退：0.60 元');expect(container.textContent).toContain('等待执行安排');expect(container.textContent).not.toContain('渠道退款已确认');
 mock.funds.mockResolvedValue({...funds,refundObligations:[{...funds.refundObligations[0],state:'EXECUTION_RECORDED'}]});await click('查看收款与退款');expect(container.textContent).toContain('执行记录已建立，等待渠道确认');expect(container.textContent).not.toContain('渠道退款已确认');
 mock.funds.mockResolvedValue({...funds,confirmedRefundCents:100,refundObligations:[{...funds.refundObligations[0],confirmedCents:100,remainingCents:0,state:'CONFIRMED'}]});await click('查看收款与退款');expect(container.textContent).toContain('剩余应退：0.00 元');expect(container.textContent).toContain('渠道退款已确认');
});
it('a conflicted obligation keeps recorded receipts visible without a false zero promise',async()=>{
 mock.funds.mockResolvedValue({paidCents:100,confirmedRefundCents:40,receipts:[],refunds:[],refundObligations:[],obligationEvidenceConflicts:1});await click('查看收款与退款');expect(container.textContent).toContain('已记录收款：1.00 元');expect(container.textContent).toContain('已确认退款：0.40 元');expect(container.textContent).toContain('部分应退记录仍在核对');expect(container.textContent).not.toContain('剩余应退：0.00 元');
});
