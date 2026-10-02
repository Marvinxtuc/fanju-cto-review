import {FormalCoreChanges} from './FormalCoreChanges';
import {FormalCheckin} from './FormalCheckin';
import {useEffect,useRef,useState} from 'react';
import {View,Text,Button} from '@tarojs/components';
import {useDidShow,useDidHide,useRouter,navigateTo} from '@tarojs/taro';
import {formalRequest,formalRefundRequestKey,beginNewFormalAttempt,prepareFormalPayment,type FormalRegistrationDetail,type FormalCancellationResult,type FormalRefundRequestCategory} from './api';
export function FormalOrderDetail():JSX.Element{
 const id=useRouter().params.id??'';const [record,setRecord]=useState<FormalRegistrationDetail|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[parentRequestId,setParentRequestId]=useState<string|null>(null);
 const generation=useRef(0),pending=useRef(false);
 useEffect(()=>()=>{generation.current++;pending.current=false;},[]);
 useDidShow(()=>{generation.current++;setRecord(null);setParentRequestId(null);setError('');pending.current=false;void run(load);});
 useDidHide(()=>{generation.current++;setRecord(null);setMessage('');setError('');});
 async function load(){if(!id)throw Error('请选择报名记录');const epoch=generation.current;const result=await formalRequest<{registration:FormalRegistrationDetail}>('/api/v11/formal/registrations/'+encodeURIComponent(id));if(generation.current===epoch)setRecord(result.registration);}
 async function run(action:()=>Promise<void>){if(pending.current)return;pending.current=true;const epoch=generation.current;setBusy(true);setError('');try{await action();}catch(e){if(generation.current===epoch)setError(e instanceof Error?e.message:'处理未完成，请刷新记录');}finally{if(generation.current===epoch){pending.current=false;setBusy(false);}}}
 async function pay(){await prepareFormalPayment(id);await load();}
 async function query(){const results=await Promise.allSettled(['/payment/query','/refunds/query'].map(suffix=>formalRequest('/api/v11/formal/registrations/'+encodeURIComponent(id)+suffix,{method:'POST'})));await load();if(results.some(result=>result.status==='rejected'))throw Error('部分渠道查询暂未完成，已保存记录仍可查看，请稍后重试');}
 async function applyRefund(category:FormalRefundRequestCategory='ORDINARY_CANCEL'){const epoch=generation.current;const request=await formalRequest<FormalCancellationResult>('/api/v11/formal/registrations/'+encodeURIComponent(id)+'/refund-requests',{method:'POST',data:{businessKey:await formalRefundRequestKey(id,category,category==='ORDINARY_CANCEL'?undefined:parentRequestId??undefined),requestCategory:category,...(category!=='ORDINARY_CANCEL'&&parentRequestId?{parentRequestId}:{})}});
  if(generation.current===epoch)setMessage(category!=='ORDINARY_CANCEL'?(request.linkageState==='UNLINKED'?'请求已保存，尚未关联原申请，请选择本人原申请后提交关联受理，不代表已补到某案或已使用复审额度。':request.linkageState==='LINKED'?'已关联原申请：'+request.originalRequestId+'；原受理时间：'+request.originalAcceptedAt+'。本次受理：'+request.acceptedAt+'。不自动取消、核定退款或扣保证金。':'请求已受理，受理时间：'+request.acceptedAt+'。不自动取消报名或释放席位，待人工处理。'):request.cancellationAccepted===true?'取消已接受，正式成员资格已结束、席位已释放。受理时间：'+request.acceptedAt+'。退款金额核定、执行及到账分别处理，请查看退款进度。':'申请已保存，取消尚待核实，不能据此视为已退出或席位已释放。受理时间：'+request.acceptedAt+'。请查看申请处理进度。');await load();}
 return <View className="page"><Text className="title">{record?.title??'我的报名'}</Text>{error&&<Text className="error-text">{error}</Text>}{message&&<Text>{message}</Text>}
  {record&&<><Text>报名状态：{record.state}</Text><Text>F 服务费：¥{(record.F/100).toFixed(2)}；D 保证金：¥{(record.D/100).toFixed(2)}；合计：¥{(record.total/100).toFixed(2)}</Text>
   <Text>履约确认：{record.fulfillment?.restaurantResult==='NORMAL'?'餐厅已确认正常履约，保证金退款义务与渠道到账分别处理':record.fulfillment?.restaurantResult==='ABNORMAL'?'餐厅已提交异常事实，等待人工复核；不自动认定违约':'餐厅尚未确认；不自动认定违约'}</Text>
   {record.fulfillment?.confirmedAt&&<Text>餐厅确认时间：{record.fulfillment.confirmedAt}</Text>}
   {record.tableState&&<Text>桌态：{({UNFORMED:'待成团',WAITING:'待成团',FORMED:'已成团',INVALIDATED:'当前成团失效',FAILED:'成团失败'} as const)[record.tableState]}</Text>}
   {record.cancelAcceptedAt&&<Text>原取消受理时间：{record.cancelAcceptedAt}</Text>}
   {record.queueOrdinal&&<Text>候补受理序号：{record.queueOrdinal}（不代表当前排名）</Text>}
   {(record.notices??[]).map(n=><View key={n.id}><Text>消息记录：{n.kind}；{n.state==='CREATED'?'已创建，待投递':n.state==='SENT'?'已发送，送达待核实':'状态 '+n.state}</Text>{n.receivedAt&&<Text>系统接收记录时间：{n.receivedAt}</Text>}<Text>消息记录不代表可靠送达，不据此启动不利处理时限。</Text></View>)}
   <Text>受理时间：{record.acceptedAt}</Text>{record.holdExpiresAt&&record.state==='PENDING_PAYMENT'&&<Text>占位截止：{record.holdExpiresAt}</Text>}
   <Text>餐厅：{record.restaurantName??'按成团规则解锁'}</Text><Text>地址：{record.address??'在有效成团及规定时间后解锁'}</Text>
   {record.refunds.map(r=><View key={r.id}><Text>退款：¥{(r.total/100).toFixed(2)}；{r.state==='CONFIRMED'?'渠道已确认退回':'尚待渠道确认'}</Text></View>)}
   {record.responsibilityReviews?.map(r=><View key={r.id}><Text>责任取消请求待独立履约权益审核：{r.state}；原请求受理：{r.originalRequestAcceptedAt}；审核负责人：{r.reviewOwner??'待分配'}。尚未接受取消，成员与席位保留，原资金处置不变。</Text></View>)}
   {record.requests.filter(r=>r.kind.includes('REFUND')||r.kind==='CORE_CHANGE_REJECTION_REVIEW').map(r=><View key={r.id}><Text>申请{r.requestCategory?'（'+({ORDINARY_CANCEL:'普通取消',CONSULTATION:'咨询',EVIDENCE:'补证',DISPUTE:'履约争议',APPEAL:'申诉',SPECIAL_REFUND:'特殊退款'} as const)[r.requestCategory]+'）':''}：{r.state}；原受理：{r.acceptedAt}</Text>{r.originalRequestId&&<Text>原申请：{r.originalRequestId}；原受理：{r.originalAcceptedAt}</Text>}{r.linkageState==='UNLINKED'&&['EVIDENCE','APPEAL'].includes(r.requestCategory??'')&&<Text>尚未关联原申请，待核实。</Text>}<Button disabled={busy||['EVIDENCE','APPEAL'].includes(r.requestCategory??'')&&r.linkageState!=='LINKED'} onClick={()=>setParentRequestId(r.id)}>选择原申请 {r.id}</Button>{r.blockerIds.length>0&&<Text>相关规则尚待明确，原申请已保留。</Text>}</View>)}
   {['ENDED','EXPIRED'].includes(record.state)&&<Button disabled={busy} onClick={()=>void run(async()=>{const activityId=await beginNewFormalAttempt(record);await navigateTo({url:'/pages/activity-detail/index?id='+encodeURIComponent(activityId)});})}>重新阅读规则并申请报名</Button>}
   <Button disabled={busy||record.state!=='PENDING_PAYMENT'} onClick={()=>void run(pay)}>继续支付</Button><Button disabled={busy||!!record.fulfillment?.restaurantResult} onClick={()=>void run(()=>applyRefund())}>申请取消及退款</Button>{record.fulfillment?.restaurantResult&&<Text>已有履约确认事实，请通过咨询或履约争议入口处理，不自动取消或释放席位。</Text>}<Text>以下请求只受理，不自动取消报名或释放席位；当前入口不接收敏感证明附件。</Text><Text>{parentRequestId?'当前原申请：'+parentRequestId:'补证或复审请先选择本人原申请；未选择时仅保存待核请求。'}</Text>{parentRequestId&&<Button disabled={busy} onClick={()=>setParentRequestId(null)}>清除原申请选择</Button>}{([['SPECIAL_REFUND','提交特殊退款受理'],['CONSULTATION','提交咨询请求'],['EVIDENCE','提交补证受理请求'],['DISPUTE','提交履约争议'],['APPEAL','提交申诉']] as const).map(([category,label])=><Button key={category} disabled={busy} onClick={()=>void run(()=>applyRefund(category))}>{label}</Button>)}</>}
  {record&&<FormalCheckin registrationId={id}/>}
  {record&&<FormalCoreChanges registrationId={id}/>}
  <Button disabled={busy||!id} onClick={()=>void run(load)}>刷新报名</Button><Button disabled={busy||!record} onClick={()=>void run(query)}>核对收款与退款进度</Button>
  <Button onClick={()=>navigateTo({url:'/pages/rights/index'})}>资料与账号权利请求</Button>
  <Button onClick={()=>navigateTo({url:'/pages/mock-auth/index'})}>登录与授权</Button><Button onClick={()=>navigateTo({url:'/pages/order-list/index?history=legacy'})}>旧版本订单记录</Button><Button onClick={()=>navigateTo({url:'/pages/money-records/index'})}>历史资金记录</Button>
 </View>;
}
export function FormalOrderList():JSX.Element{
 const [rows,setRows]=useState<FormalRegistrationDetail[]>([]),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const generation=useRef(0),pending=useRef(false);useDidShow(()=>{generation.current++;pending.current=false;setRows([]);setCursor(null);void load();});useDidHide(()=>{generation.current++;setRows([]);setCursor(null);});
 async function load(next?:string){if(pending.current)return;pending.current=true;const epoch=generation.current;setBusy(true);setError('');try{const data=await formalRequest<{registrations:FormalRegistrationDetail[];nextCursor:string|null}>('/api/v11/formal/registrations'+(next?'?cursor='+encodeURIComponent(next):''));if(epoch===generation.current){setRows(previous=>next?[...previous,...data.registrations]:data.registrations);setCursor(data.nextCursor);}}catch(e){if(epoch===generation.current){setRows([]);setCursor(null);setError(e instanceof Error?e.message:'报名查询未完成');}}finally{if(epoch===generation.current){pending.current=false;setBusy(false);}}}
 return <View className="page"><Text className="title">我的报名</Text>{error&&<Text className="error-text">{error}</Text>}<Button disabled={busy} onClick={()=>void load()}>刷新报名记录</Button>
  {rows.map(r=><View key={r.id}><Text>{r.title} · {r.state}</Text><Text>F ¥{(r.F/100).toFixed(2)}；D ¥{(r.D/100).toFixed(2)}；合计 ¥{(r.total/100).toFixed(2)}</Text><Button onClick={()=>navigateTo({url:'/pages/order-detail/index?id='+encodeURIComponent(r.id)})}>查看报名及退款</Button></View>)}
  {cursor&&<Button disabled={busy} onClick={()=>void load(cursor)}>下一页</Button>}<Button onClick={()=>navigateTo({url:'/pages/order-list/index?history=legacy'})}>旧版本订单记录</Button><Button onClick={()=>navigateTo({url:'/pages/money-records/index'})}>历史资金记录</Button>
 </View>;
}
