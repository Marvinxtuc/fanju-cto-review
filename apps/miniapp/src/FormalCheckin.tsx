import {useRef,useState} from 'react';
import Taro,{useDidShow,useDidHide} from '@tarojs/taro';
import {View,Text,Button} from '@tarojs/components';
import {formalRequest} from './api';
type Fact={registrationId:string;checkinAt:string|null;enabled:boolean;fulfillmentConfirmed:false;scope:'FORMAL_CHECKIN'};
export function FormalCheckin({registrationId}:{registrationId:string}):JSX.Element{
 const [fact,setFact]=useState<Fact|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const epoch=useRef(0),pending=useRef(false);
 async function load(){const generation=epoch.current;try{const value=await formalRequest<Fact>('/api/v11/formal/registrations/'+encodeURIComponent(registrationId)+'/checkin');if(generation===epoch.current)setFact(value);}catch(e){if(generation===epoch.current)setError(e instanceof Error?e.message:'扫码事实查询未完成');}}
 useDidShow(()=>{epoch.current++;pending.current=false;setBusy(false);setFact(null);setError('');void load();});useDidHide(()=>{epoch.current++;setFact(null);});
 async function scan(){if(pending.current)return;pending.current=true;const generation=epoch.current;setBusy(true);setError('');try{
  const result=await Taro.scanCode({onlyFromCamera:true,scanType:['qrCode']});
  if(generation!==epoch.current)return;
  if(!/^FJCI1\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]{86}$/.test(result.result)||result.result.length>5000)throw Error('请扫描餐厅提供的本场正式签到码');
  await formalRequest('/api/v11/formal/registrations/'+encodeURIComponent(registrationId)+'/checkin',{method:'POST',data:{token:result.result}});
  if(generation===epoch.current)await load();
 }catch(e){if(generation===epoch.current)setError(e instanceof Error?e.message:'扫码未完成，请重试或请餐厅刷新签到码');}finally{if(generation===epoch.current){pending.current=false;setBusy(false);}}}
 return <View><Text>到场扫码记录</Text>{error&&<Text>{error}</Text>}
  {fact?.checkinAt?<Text>首次扫码记录：{fact.checkinAt}</Text>:<Text>尚无已核验的正式扫码记录</Text>}
  <Text>扫码记录与餐厅履约确认分别处理，不自动认定正常履约、迟到或违约。</Text>
  {fact?.enabled&&<Button disabled={busy} onClick={()=>void scan()}>扫描本场正式签到码</Button>}
  {fact&&!fact.enabled&&<Text>正式扫码入口尚未启用</Text>}
 </View>;
}
