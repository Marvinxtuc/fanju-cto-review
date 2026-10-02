import {useEffect,useRef,useState} from 'react';
import {View,Text,Button,Switch} from '@tarojs/components';
import Taro,{navigateTo,useDidHide,useDidShow} from '@tarojs/taro';
import {getFormalOffer,deliverFormalTerms,submitFormalSignup,type FormalOffer,type FormalPolicyDelivery,type FormalRegistrationDetail} from './api';
export function FormalActivityDetail():JSX.Element{
 const id=Taro.getCurrentInstance().router?.params.id??'';
 const [offer,setOffer]=useState<FormalOffer|null>(null),[terms,setTerms]=useState<FormalPolicyDelivery|null>(null);
 const [consent,setConsent]=useState(false),[adult,setAdult]=useState(false),[compatible,setCompatible]=useState(false),[gender,setGender]=useState<'MALE'|'FEMALE'|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const generation=useRef(0),pending=useRef(false);
 useEffect(()=>()=>{generation.current++;pending.current=false;},[]);
 useDidShow(()=>{const epoch=++generation.current;pending.current=false;setBusy(false);setOffer(null);setTerms(null);setConsent(false);setError('');void getFormalOffer(id).then(v=>{if(generation.current===epoch)setOffer(v);}).catch(e=>{if(generation.current===epoch)setError(e instanceof Error?e.message:'活动暂不可用');});});
 useDidHide(()=>{generation.current++;pending.current=false;setOffer(null);setTerms(null);setConsent(false);setAdult(false);setCompatible(false);setGender(null);});
 async function run(action:()=>Promise<void>){if(pending.current)return;pending.current=true;const epoch=generation.current;setBusy(true);setError('');try{await action();}catch(e){if(generation.current===epoch)setError(e instanceof Error?e.message:'报名未完成');}finally{if(generation.current===epoch){pending.current=false;setBusy(false);}}}
 async function read(){if(!offer)return;const epoch=generation.current;const v=await deliverFormalTerms(offer.policyId);if(generation.current===epoch){setTerms(v);setConsent(false);}}
 async function signup(membership:'FORMAL'|'WAITLIST'){
  if(!offer||!terms||!consent||!adult||!compatible||!gender)throw Error('请阅读全部规则并完成报名资料确认');
  const epoch=generation.current;
  const result=await submitFormalSignup(offer,terms,membership,gender);
  if(generation.current!==epoch)return;
  if(!result.registration){setError('申请已受理，相关规则尚待明确；当前未发起支付。受理时间：'+(result.request?.acceptedAt??''));return;}
  await navigateTo({url:'/pages/order-detail/index?id='+encodeURIComponent(result.registration.id)});
 }
 return <View className="page page-activity-detail"><Text className="title">{offer?.title??'活动详情'}</Text>
  {error&&<Text className="error-text">{error}</Text>}
  {offer&&<><Text>{offer.district} · {offer.businessArea} · {offer.startsAt}</Text>
   <Text>平台服务费 F：¥{(offer.serviceFeeCents/100).toFixed(2)}</Text><Text>履约保证金 D：¥{(offer.depositCents/100).toFixed(2)}</Text>
   <Text>本次合计：¥{(offer.totalCents/100).toFixed(2)}；餐费到店直接付给餐厅。</Text><Text>报名占位保留 10 分钟，资格以服务端可信收款确认结果为准。</Text></>}
  <Button onClick={()=>navigateTo({url:'/pages/mock-auth/index'})}>登录与手机号授权</Button>
  <Button disabled={busy||!offer} onClick={()=>void run(read)}>阅读报名协议与退款规则</Button>
  {terms&&<View>{terms.documents.map(d=><View key={d.kind}><Text>{d.kind==='USER_AGREEMENT'?'用户协议':d.kind==='PRIVACY_NOTICE'?'隐私说明':'退款规则'}</Text><Text>{d.publicText}</Text></View>)}
   <Text>已阅读并同意以上完整规则</Text><Switch checked={consent} disabled={busy} onChange={e=>setConsent(e.detail.value)}/></View>}
  <Text>报名资料</Text><Button disabled={busy} onClick={()=>setGender('MALE')}>男性{gender==='MALE'?'（已选）':''}</Button><Button disabled={busy} onClick={()=>setGender('FEMALE')}>女性{gender==='FEMALE'?'（已选）':''}</Button>
  <Text>本人已满 18 周岁</Text><Switch checked={adult} disabled={busy} onChange={e=>setAdult(e.detail.value)}/>
  <Text>本人已了解服务安排，可参与本次餐厅体验</Text><Switch checked={compatible} disabled={busy} onChange={e=>setCompatible(e.detail.value)}/>
  <Button disabled={busy||!offer||!terms||!consent||!adult||!compatible||!gender} onClick={()=>void run(()=>signup('FORMAL'))}>提交报名并锁定报价</Button>
  <Button disabled={busy||!offer?.waitlistMax||!terms||!consent||!adult||!compatible||!gender} onClick={()=>void run(()=>signup('WAITLIST'))}>申请候补</Button>
 </View>;
}
