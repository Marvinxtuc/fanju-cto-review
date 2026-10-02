import {useRef,useState} from 'react';
import {Button,Text,View,ScrollView} from '@tarojs/components';
import Taro,{useDidShow,useDidHide} from '@tarojs/taro';
import {openMoneySession,listMoneyRegistrations,getFormalFunds,submitFormalRefund,getFormalRefund,isCurrentUserSession,type FormalFunds,type MoneyRegistration} from '../../api';
import {formatClientError} from '../mock-auth/client-error';

type Session=Awaited<ReturnType<typeof openMoneySession>>;
const money=(cents:number)=>(cents/100).toFixed(2)+' 元';
export default function MoneyRecordsPage(){
 const [session,setSession]=useState<Session|null>(null),[rows,setRows]=useState<MoneyRegistration[]>([]),[cursor,setCursor]=useState<string|null>(null);
 const [funds,setFunds]=useState<Record<string,FormalFunds>>({}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),working=useRef(false);
 const valid=(s:Session,g:number)=>g===generation.current&&isCurrentUserSession(s.token);
 async function reload(){
  const g=++generation.current;working.current=true;setBusy(true);setError('');setRows([]);setFunds({});setSession(null);setCursor(null);
  try{const s=await openMoneySession();const page=await listMoneyRegistrations(s.token);if(valid(s,g)){setSession(s);setRows(page.registrations);setCursor(page.nextCursor);}}
  catch(e){if(g===generation.current)setError(formatClientError(e,'记录加载失败'));}
  finally{if(g===generation.current){working.current=false;setBusy(false);}}
 }
 useDidShow(()=>{void reload();});
 useDidHide(()=>{generation.current++;working.current=false;setSession(null);setRows([]);setFunds({});setCursor(null);setError('');});
 async function action(run:(s:Session,g:number)=>Promise<void>){
  if(working.current||!session)return;const s=session,g=generation.current;
  if(!valid(s,g)){void reload();return;}working.current=true;setBusy(true);setError('');
  try{await run(s,g);}catch(e){if(g===generation.current){if(!isCurrentUserSession(s.token)){setRows([]);setFunds({});setSession(null);}setError(formatClientError(e,'操作失败，请重试'));}}
  finally{if(g===generation.current){if(!isCurrentUserSession(s.token)){setRows([]);setFunds({});setSession(null);setCursor(null);setError('登录状态已改变，请重新加载');}working.current=false;setBusy(false);}}
 }
 async function apply(s:Session,g:number,row:MoneyRegistration){
  const id=row.registrationId;
  if(row.refundRequests.length){const request=await getFormalRefund(s.token,row.refundRequests[0]!.requestId);if(valid(s,g))setRows(old=>old.map(x=>x.registrationId===id?{...x,refundRequests:[request]}:x));return;}
  const storageKey='fanju_refund_request_v1:'+s.userId+':'+id;
  let key=Taro.getStorageSync<string>(storageKey);
  if(!key){key='request-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);Taro.setStorageSync(storageKey,key);}
  const request=await submitFormalRefund(s.token,id,key);
  if(valid(s,g))setRows(previous=>previous.map(row=>row.registrationId===id?{...row,refundRequests:[request,...row.refundRequests.filter(x=>x.requestId!==request.requestId)]}:row));
 }
 return <ScrollView className="page" scrollY>
  <View className="detail-header"><Text className="title">收款与退款记录</Text><Text className="summary">查看已记录的收款、退款及申请进度。记录可能仍在更新。</Text></View>
  {error?<Text className="error-text">{error}</Text>:null}
  <Button disabled={busy} onClick={()=>void reload()}>刷新记录</Button>
  {busy?<Text>正在处理…</Text>:null}
  {session&&rows.length===0&&!busy?<Text>暂无报名记录</Text>:null}
  {rows.map((row,index)=><View className="detail-block" key={row.registrationId}>
   <Text className="block-title">{row.activityTitle || `报名记录 ${index+1}`}</Text><Text>{row.startsAt}</Text>
   {session?.financialRecordsEnabled?<Button disabled={busy} onClick={()=>void action(async(s,g)=>{const data=await getFormalFunds(s.token,row.registrationId);if(valid(s,g))setFunds(old=>({...old,[row.registrationId]:data}));})}>查看收款与退款</Button>:null}
   {funds[row.registrationId]?<View><Text>已记录收款：{money(funds[row.registrationId]!.paidCents)}</Text><Text>已确认退款：{money(funds[row.registrationId]!.confirmedRefundCents)}</Text>
    {funds[row.registrationId]!.receipts.map(receipt=><View key={receipt.receiptId}><Text>收款 {money(receipt.amountCents)} · {receipt.paidAt}</Text>{receipt.classification==='UNALLOCATED'?<Text>收款已记录，归属核对中</Text>:null}</View>)}
    {funds[row.registrationId]!.refunds.map(refund=><Text key={refund.refundId}>退款 {money(refund.amountCents)} · {refund.state==='CONFIRMED'?'已确认':'处理中，等待渠道确认'}</Text>)}
    {(funds[row.registrationId]!.refundObligations??[]).map(obligation=><View key={'obligation:'+obligation.receiptId}><Text>已登记应退：{money(obligation.amountCents)}</Text><Text>该笔渠道已确认退款：{money(obligation.confirmedCents)}，剩余应退：{money(obligation.remainingCents)}</Text><Text>{obligation.state==='CONFIRMED'?'渠道退款已确认':obligation.state==='EXECUTION_RECORDED'?'退款执行记录已建立，等待渠道确认':'应退已登记，等待执行安排'}</Text></View>)}
    {(funds[row.registrationId]!.obligationEvidenceConflicts??0)>0?<Text>部分应退记录仍在核对；已记录收款与渠道确认退款保留。</Text>:null}
   </View>:null}
   {row.refundRequests.map(request=><View key={request.requestId}><Text>申请受理时间：{request.acceptedAt}</Text><Text>{request.state==='BLOCKED_POLICY'?'已受理，等待处理':'申请进度待核对'}</Text></View>)}
   {session?.refundIntakeEnabled?<Button disabled={busy} onClick={()=>void action((s,g)=>apply(s,g,row))}>{row.refundRequests.length?'查看申请进度':'申请退款'}</Button>:null}
   <Text className="summary">申请受理不代表退款已完成；处理进度将在此更新。</Text>
  </View>)}
  {cursor?<Button disabled={busy} onClick={()=>void action(async(s,g)=>{const page=await listMoneyRegistrations(s.token,cursor);if(valid(s,g)){setRows(old=>[...old,...page.registrations]);setCursor(page.nextCursor);}})}>加载更多</Button>:null}
 </ScrollView>;
}
