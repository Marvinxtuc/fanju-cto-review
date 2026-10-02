import {FormalCoreChanges} from './FormalCoreChanges.js';
import {useEffect,useRef,useState} from 'react';
import {FormalCheckin} from './FormalCheckin.js';
import {FormalRightsInbox} from './FormalRightsInbox.js';
import {FormalResponsibilityCancellation} from './FormalResponsibilityCancellation.js';
import type {createControlledIdentityClient,ControlledPrincipal} from './controlled-identity-api.js';
type Client=ReturnType<typeof createControlledIdentityClient>;
type Proposal={id:string;activityId:string;state:string;supplyId:string|null;proposal:{policyId:string;depositCents:number;min:number;target:number;max:number}};
type FulfillmentRecord={id:string;title:string;activityId:string;state:string;active:boolean;endsAt:string;D:number;restaurantResult:'NORMAL'|'ABNORMAL'|null;confirmedAt:string|null};
type RefundRequest={id:string;kind:string;requestCategory?:'ORDINARY_CANCEL'|'CONSULTATION'|'EVIDENCE'|'DISPUTE'|'APPEAL';caseOwner:string|null;registrationId:string;title:string;F:number;D:number;acceptedAt:string;state:string;blockerIds:string[]};
export function FormalBusinessWorkspace({client,identity,onSessionLost}:{client:Client;identity:ControlledPrincipal;onSessionLost:()=>void}):JSX.Element{
 const [activityId,setActivityId]=useState(''),[policyId,setPolicyId]=useState(''),[deposit,setDeposit]=useState(''),[fee,setFee]=useState(''),[minimum,setMinimum]=useState('4'),[target,setTarget]=useState('6'),[maximum,setMaximum]=useState('8'),[tables,setTables]=useState('1'),[waitlist,setWaitlist]=useState('');
 const [proposalCursor,setProposalCursor]=useState<string|null>(null),[refundCursor,setRefundCursor]=useState<string|null>(null);
 const [proposals,setProposals]=useState<Proposal[]>([]),[requests,setRequests]=useState<RefundRequest[]>([]),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [fulfillments,setFulfillments]=useState<FulfillmentRecord[]>([]),[fulfillmentCursor,setFulfillmentCursor]=useState<string|null>(null);
 const [scopeRaw,setScopeRaw]=useState(''),[scopeDigest,setScopeDigest]=useState(''),[runIds,setRunIds]=useState(''),[caseId,setCaseId]=useState(''),[originalRun,setOriginalRun]=useState(''),[verifiedRun,setVerifiedRun]=useState('');
 const mounted=useRef(true),epoch=useRef(0),pending=useRef(false),key=useRef('supply_'+Date.now()+'_'+Math.random().toString(36).slice(2));
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
 function report(message:string){if(mounted.current&&client.current()?.id===identity.id)setMessage(message);}
 async function run(action:()=>Promise<void>){if(pending.current)return;pending.current=true;const generation=epoch.current;setBusy(true);setError('');setMessage('');try{await action();}catch(e){if(epoch.current===generation){setError(e instanceof Error?e.message:'操作未完成');if(!client.current())onSessionLost();}}finally{if(epoch.current===generation){pending.current=false;setBusy(false);}}}
 const number=(text:string)=>{if(!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text)))throw Error('金额及数量必须填写非负整数');return Number(text);};
 async function load(next=false){const generation=epoch.current;
  if(!next||proposalCursor){const p=await client.business<{proposals:Proposal[];nextCursor:string|null}>('/api/v11/formal/supply-proposals'+(next?'?cursor='+encodeURIComponent(proposalCursor!):''));if(epoch.current!==generation)return;setProposals(old=>next?[...old,...p.proposals.filter(row=>!old.some(x=>x.id===row.id))]:p.proposals);setProposalCursor(p.nextCursor);}
  if(identity.role!=='RESTAURANT'&&(!next||refundCursor)){const r=await client.business<{requests:RefundRequest[];nextCursor:string|null}>('/api/v11/ops/formal/refund-requests'+(next?'?cursor='+encodeURIComponent(refundCursor!):''));if(epoch.current===generation){setRequests(old=>next?[...old,...r.requests.filter(row=>!old.some(x=>x.id===row.id))]:r.requests);setRefundCursor(r.nextCursor);}}}
 async function loadFulfillment(next=false){const generation=epoch.current;const data=await client.business<{registrations:FulfillmentRecord[];nextCursor:string|null}>('/api/v11/formal/fulfillment-registrations'+(next?'?cursor='+encodeURIComponent(fulfillmentCursor!):''));if(generation===epoch.current){setFulfillments(old=>next?[...old,...data.registrations.filter(row=>!old.some(x=>x.id===row.id))]:data.registrations);setFulfillmentCursor(data.nextCursor);}}
 async function confirmFulfillment(r:FulfillmentRecord,result:'NORMAL'|'ABNORMAL'){const data=await client.business<{state:string;restaurantResult:string}>('/api/v11/restaurant/formal/registrations/'+encodeURIComponent(r.id)+'/fulfillment','POST',{result});report('履约事实已保存：'+data.restaurantResult+'；处理状态：'+data.state+'。不代表渠道退款到账。');await loadFulfillment();}
 async function propose(){const result=await client.business<{state:string}>('/api/v11/restaurant/activities/'+encodeURIComponent(activityId)+'/supply-proposals','POST',{
  policyId,businessKey:key.current,min:number(minimum),target:number(target),max:number(maximum),maxTables:number(tables),strategy:'FILL_TO_TARGET',depositCents:number(deposit),waitlistMax:waitlist===''?null:number(waitlist)});
  report('供给申请：'+result.state);await load();}
 async function approve(p:Proposal){const result=await client.business<{state:string;blockerIds?:string[]}>('/api/v11/ops/supply-proposals/'+encodeURIComponent(p.id)+'/approve','POST',{activityFeeCents:fee===''?null:number(fee)});report('供给处理：'+result.state+(result.blockerIds?.length?'；待决规则：'+result.blockerIds.join('、'):''));await load();}
 async function publish(p:Proposal){if(!p.supplyId)throw Error('供给尚未批准');await client.business('/api/v11/ops/formal/activities/'+encodeURIComponent(p.activityId)+'/publish','POST',{supplyId:p.supplyId});report('活动已按此供给发布');await load();}
 async function decide(r:RefundRequest){const result=await client.business<{state:string;blockerIds?:string[];batchAt?:string}>('/api/v11/ops/formal/refund-requests/'+encodeURIComponent(r.id)+'/decide','POST');report('退款处理：'+result.state+(result.batchAt?'；批次：'+result.batchAt:'')+(result.blockerIds?.length?'；待决规则：'+result.blockerIds.join('、'):''));await load();}
 async function assess(){const result=await client.business<{state:string;blockerIds:string[]}>('/api/v11/ops/formal/reconciliation/assess','POST',{policyId,scopeRaw,scopeDigest,runIds:runIds.split(/\s+/).filter(Boolean)});report('对账覆盖：'+result.state+'；剩余依赖：'+(result.blockerIds.join('、')||'当前声明范围内无阻塞'));}
 async function closeDifference(){const result=await client.business<{state:string}>('/api/v11/ops/formal/reconciliation/differences/'+encodeURIComponent(caseId)+'/close','POST',{policyId,originalRunId:originalRun,verifiedRunId:verifiedRun});report('差异处置：'+result.state);}
 return <section aria-label="正式业务工作区"><h2>正式供给与退款</h2><button disabled={busy} onClick={()=>void run(()=>load())}>刷新正式业务记录</button>
  {(proposalCursor||refundCursor)&&<button disabled={busy} onClick={()=>void run(()=>load(true))}>加载下一页正式业务记录</button>}
  {identity.role==='RESTAURANT'&&<form onSubmit={e=>{e.preventDefault();void run(propose);}}>
   <label>活动编号<input value={activityId} onChange={e=>setActivityId(e.target.value)} required disabled={busy}/></label><label>政策版本编号<input value={policyId} onChange={e=>setPolicyId(e.target.value)} required disabled={busy}/></label>
   <label>D 保证金（分）<input value={deposit} onChange={e=>setDeposit(e.target.value)} required disabled={busy}/></label>
   <label>最少人数<input value={minimum} onChange={e=>setMinimum(e.target.value)} disabled={busy}/></label><label>目标人数<input value={target} onChange={e=>setTarget(e.target.value)} disabled={busy}/></label><label>最多人数<input value={maximum} onChange={e=>setMaximum(e.target.value)} disabled={busy}/></label>
   <label>最多桌数<input value={tables} onChange={e=>setTables(e.target.value)} disabled={busy}/></label><label>候补上限（空值使用政策参数）<input value={waitlist} onChange={e=>setWaitlist(e.target.value)} disabled={busy}/></label><button disabled={busy}>提交餐厅供给</button></form>}
  {identity.role==='OPS'&&<label>本场 F 服务费（分；空值使用政策参数）<input value={fee} onChange={e=>setFee(e.target.value)} disabled={busy}/></label>}
  {proposals.map(p=><article key={p.id}><p>供给申请 {p.id}；活动 {p.activityId}；{p.state}；D ¥{(p.proposal.depositCents/100).toFixed(2)}</p>
   {identity.role==='OPS'&&<><button disabled={busy||p.state==='RESOLVED'} onClick={()=>void run(()=>approve(p))}>批准此供给及报价</button><button disabled={busy||!p.supplyId} onClick={()=>void run(()=>publish(p))}>发布此活动供给</button></>}</article>)}
  {requests.map(r=><article key={r.id}><p>{r.title}；原申请受理：{r.acceptedAt}；{r.state}</p>{r.requestCategory&&<p>请求类别：{({ORDINARY_CANCEL:'普通取消',CONSULTATION:'咨询',EVIDENCE:'补证',DISPUTE:'履约争议',APPEAL:'申诉'} as const)[r.requestCategory]}</p>}{r.kind==='FORMAL_REFUND_INQUIRY'&&<p>只受理待人工处理，不自动取消或核定退款；责任人：{r.caseOwner??'责任人待核对'}</p>}<p>原报价 F ¥{(r.F/100).toFixed(2)}；D ¥{(r.D/100).toFixed(2)}</p>{r.blockerIds.length>0&&<p>待决规则：{r.blockerIds.join('、')}</p>}{identity.role==='OPS'&&r.kind!=='FORMAL_REFUND_INQUIRY'&&<button disabled={busy} onClick={()=>void run(()=>decide(r))}>按原申请时刻核定退款</button>}</article>)}
  {identity.role!=='RESTAURANT'&&<section aria-label="正式对账处置"><h3>正式对账处置</h3>
   <label>历史政策编号<input value={policyId} onChange={e=>setPolicyId(e.target.value)} disabled={busy}/></label>
   <label>已签发对账范围材料<textarea value={scopeRaw} onChange={e=>setScopeRaw(e.target.value)} disabled={busy}/></label><label>范围材料摘要<input value={scopeDigest} onChange={e=>setScopeDigest(e.target.value)} disabled={busy}/></label>
   <label>每日核验记录编号（空白分隔）<textarea value={runIds} onChange={e=>setRunIds(e.target.value)} disabled={busy}/></label><button disabled={busy} onClick={()=>void run(assess)}>核验声明范围的对账覆盖</button>
   {identity.role==='OPS'&&<><label>差异编号<input value={caseId} onChange={e=>setCaseId(e.target.value)} disabled={busy}/></label><label>原核验记录编号<input value={originalRun} onChange={e=>setOriginalRun(e.target.value)} disabled={busy}/></label><label>同账单重新核验编号<input value={verifiedRun} onChange={e=>setVerifiedRun(e.target.value)} disabled={busy}/></label><button disabled={busy} onClick={()=>void run(closeDifference)}>凭重新核验结果关闭差异</button></>}
  </section>}
  <section aria-label="正式履约确认"><h3>正式履约确认</h3><button disabled={busy} onClick={()=>void run(()=>loadFulfillment())}>刷新正式履约记录</button>{fulfillmentCursor&&<button disabled={busy} onClick={()=>void run(()=>loadFulfillment(true))}>加载下一页履约记录</button>}<p>未确认只待办；异常事实需人工复核，不自动认定违约。正常履约建立原保证金退款义务，最早于上海时间下一自然日，按已批准批次安排。</p>{fulfillments.map(r=><article key={r.id}><p>{r.title}；报名 {r.id}；{r.state}；D ¥{(r.D/100).toFixed(2)}；履约 {r.restaurantResult??'尚未确认'}</p>{r.confirmedAt&&<p>确认时间：{r.confirmedAt}</p>}{identity.role==='RESTAURANT'&&<><button disabled={busy||!r.active||r.state!=='FORMAL'||!!r.restaurantResult} onClick={()=>void run(()=>confirmFulfillment(r,'NORMAL'))}>确认正常履约并登记退保证金义务</button><button disabled={busy||!r.active||r.state!=='FORMAL'||!!r.restaurantResult} onClick={()=>void run(()=>confirmFulfillment(r,'ABNORMAL'))}>提交异常履约待复核</button></>}</article>)}</section>
  {identity.role!=='RESTAURANT'&&<FormalRightsInbox client={client} identity={identity} onSessionLost={onSessionLost}/>}
  <FormalCheckin client={client} identity={identity} onSessionLost={onSessionLost}/>
  <FormalCoreChanges client={client} identity={identity} onSessionLost={onSessionLost}/><FormalResponsibilityCancellation client={client} identity={identity} onSessionLost={onSessionLost}/>
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
