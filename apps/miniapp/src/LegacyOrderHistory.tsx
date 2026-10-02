import {useEffect,useRef,useState} from 'react';
import {View,Text,Button} from '@tarojs/components';
import {useRouter,useDidShow,useDidHide,navigateTo} from '@tarojs/taro';
import {getOrder,listOrders,isCurrentUserSession,ensureAuthenticatedUser,type OrderDetail,type OrderSummary} from './api';
import {orderStatusLabel} from './order-status';
/** Read original orders without reinterpreting them as V1.1 registration terms. */
export function LegacyOrderHistory():JSX.Element{
 const id=useRouter().params.id;
 const [rows,setRows]=useState<OrderSummary[]>([]),[detail,setDetail]=useState<OrderDetail|null>(null),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const epoch=useRef(0),pending=useRef(false);
 useEffect(()=>()=>{epoch.current++;},[]);
 useDidShow(()=>{epoch.current++;pending.current=false;setRows([]);setDetail(null);setCursor(null);void load();});
 useDidHide(()=>{epoch.current++;pending.current=false;setRows([]);setDetail(null);setCursor(null);setError('');});
 async function load(next?:string){if(pending.current)return;pending.current=true;const generation=epoch.current;setBusy(true);setError('');try{
  const token=await ensureAuthenticatedUser();
  if(id){const row=await getOrder(id);if(!isCurrentUserSession(token))throw Error('登录状态已改变，请重新加载');if(epoch.current===generation)setDetail(row);}
  else{const result=await listOrders(next);if(!isCurrentUserSession(token))throw Error('登录状态已改变，请重新加载');if(epoch.current===generation){setRows(old=>next?[...old,...result.orders]:result.orders);setCursor(result.nextCursor);}}
 }catch(e){if(epoch.current===generation){setDetail(null);setError(e instanceof Error?e.message:'旧订单记录查询未完成');}}finally{if(epoch.current===generation){pending.current=false;setBusy(false);}}}
 return <View className="page"><Text className="title">旧版本订单记录</Text><Text>以下按原订单记录展示，原金额、退款记录及未结义务继续保留。</Text>
  {error&&<Text className="error-text">{error}</Text>}<Button disabled={busy} onClick={()=>void load()}>刷新旧订单记录</Button>
  {detail&&<View><Text>{detail.activity.title}</Text><Text>原订单状态：{orderStatusLabel(detail.status)}</Text><Text>原订单金额：¥{(detail.amountCents/100).toFixed(2)}</Text><Text>收款处理记录：{detail.paymentState}</Text>
   {detail.refunds.map(r=><View key={r.id}><Text>退款记录：¥{(r.amountCents/100).toFixed(2)}；{r.status}{r.requiresReview?'；待核对':''}</Text><Text>记录更新：{r.updatedAt}</Text></View>)}
   <Text>餐厅：{detail.activity.restaurantName??'按原权限规则展示'}</Text><Text>地址：{detail.activity.address??'当前不可查看'}</Text></View>}
  {rows.map(r=><View key={r.id}><Text>{r.activity.title}；{orderStatusLabel(r.status)}</Text><Text>原订单金额：¥{(r.amountCents/100).toFixed(2)}</Text><Button onClick={()=>navigateTo({url:'/pages/order-detail/index?id='+encodeURIComponent(r.id)+'&history=legacy'})}>查看旧订单记录</Button></View>)}
  {!id&&cursor&&<Button disabled={busy} onClick={()=>void load(cursor)}>下一页旧订单</Button>}
  <Button onClick={()=>navigateTo({url:'/pages/order-list/index'})}>查看当前报名</Button><Button onClick={()=>navigateTo({url:'/pages/money-records/index'})}>查看收款与退款记录</Button>
 </View>;
}
