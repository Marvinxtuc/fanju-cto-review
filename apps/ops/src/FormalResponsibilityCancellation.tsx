import { useState, useRef, useEffect } from 'react';
import type { createControlledIdentityClient, ControlledPrincipal } from './controlled-identity-api.js';
type Request={id:string;kind:string;state:string;activityId:string;reason:string;compensationRequired:boolean;reviewRequired?:boolean;reviewOwner?:string|null;originalRequestAcceptedAt?:string;membershipEnded?:boolean};
export function FormalResponsibilityCancellation({client,identity,onSessionLost}:{client:ReturnType<typeof createControlledIdentityClient>;identity:ControlledPrincipal;onSessionLost:()=>void}):JSX.Element{
 const [activityId,setActivityId]=useState(''),[rows,setRows]=useState<Request[]>([]),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [cursor,setCursor]=useState<string|null>(null);const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const live=()=>mounted.current&&client.current()?.id===identity.id;
 const key=useRef('responsibility_'+Date.now()+'_'+Math.random().toString(36).slice(2)),pending=useRef(false);
 async function run(action:()=>Promise<void>){if(pending.current)return;pending.current=true;setBusy(true);setError('');setMessage('');try{await action();}catch(e){if(live())setError(e instanceof Error?e.message:'操作未完成');if(!client.current()&&mounted.current)onSessionLost();}finally{pending.current=false;if(live())setBusy(false);}}
 async function load(next=false){const result=await client.business<{requests:Request[];nextCursor:string|null}>('/api/v11/formal/responsibility-cancellations'+(next?'?cursor='+encodeURIComponent(cursor!):''));if(live()){setRows(old=>next?[...old,...result.requests.filter(r=>!old.some(x=>x.id===r.id))]:result.requests);setCursor(result.nextCursor);}}
 async function propose(){await client.business('/api/v11/restaurant/formal/activities/'+encodeURIComponent(activityId)+'/responsibility-cancellations','POST',{businessKey:key.current});if(live())setMessage('餐厅责任取消申请已记录，等待平台确认；尚未移除成员。');await load();}
 async function accept(activity:string,reason:'PLATFORM_CANCEL'|'RESTAURANT_CANCEL',proposalId?:string){
  const result=await client.business<{state:string;membershipEnded?:boolean;cancellationAccepted?:boolean;reviewRequired?:boolean}>('/api/v11/ops/formal/activities/'+encodeURIComponent(activity)+'/responsibility-cancellations','POST',{businessKey:key.current+'_'+activity,reason,...(proposalId?{proposalId}:{})});
  if(live()){if(result.membershipEnded===true&&result.cancellationAccepted===true&&result.state==='CANCELLATION_ACCEPTED_REFUND_PENDING')setMessage('责任取消已接受，原成员权益已保存并释放席位；原 F+D 退款义务等待独立核定与原渠道执行。补偿金额仍待专业签收，不代表退款到账。');else if(result.reviewRequired===true&&result.membershipEnded===false&&result.cancellationAccepted===false&&result.state==='AWAITING_FULFILLMENT_RIGHTS_REVIEW')setMessage('责任取消请求已转入独立履约权益审核；尚未接受取消，成员与席位保留，原资金处置不变，等待专业核定。');else throw Error('责任取消结果尚未明确，请核对原请求；不能确认退出或退款义务。');}await load();
 }
 return <section aria-label="责任取消工作区"><h3>平台与餐厅责任取消</h3><p>责任取消按原权益记录 F+D 退款义务；补偿核定、退款执行与到账独立。</p>
  <label>活动编号<input aria-label="责任取消活动编号" value={activityId} onChange={e=>{setActivityId(e.target.value);key.current='responsibility_'+Date.now()+'_'+Math.random().toString(36).slice(2);}}/></label>
  <button disabled={busy} onClick={()=>void run(()=>load())}>读取责任取消记录</button>
  {cursor&&<button disabled={busy} onClick={()=>void run(()=>load(true))}>加载下一页责任取消记录</button>}
  {identity.role==='RESTAURANT'&&<button disabled={busy||!activityId} onClick={()=>void run(propose)}>提出餐厅责任取消申请</button>}
  {identity.role==='OPS'&&<button disabled={busy||!activityId} onClick={()=>void run(()=>accept(activityId,'PLATFORM_CANCEL'))}>确认平台责任取消</button>}
  {rows.map(row=><article key={row.id}><p>活动 {row.activityId} · {row.state}</p>{row.reviewRequired&&<p>独立权益审核负责人：{row.reviewOwner??'待分配'}；原请求受理：{row.originalRequestAcceptedAt}；{row.membershipEnded===false?'成员与席位保留':'退出结果待核'}。</p>}{identity.role==='OPS'&&row.kind==='FORMAL_RESPONSIBILITY_CANCELLATION_PROPOSAL'&&row.state==='PENDING_PLATFORM_APPROVAL'&&<button disabled={busy} onClick={()=>void run(()=>accept(row.activityId,'RESTAURANT_CANCEL',row.id))}>接受餐厅责任取消</button>}</article>)}
  {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
