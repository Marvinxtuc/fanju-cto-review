import {useEffect,useRef,useState} from 'react';
import type {createControlledIdentityClient,ControlledPrincipal} from './controlled-identity-api.js';
import {createFormalCheckinQr} from './formal-checkin-qr.js';
export function FormalCheckin({client,identity,onSessionLost}:{client:ReturnType<typeof createControlledIdentityClient>;identity:ControlledPrincipal;onSessionLost:()=>void}):JSX.Element{
 const [activity,setActivity]=useState(''),[supply,setSupply]=useState(''),[image,setImage]=useState(''),[expires,setExpires]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const mounted=useRef(true),pending=useRef(false),epoch=useRef(0);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
 useEffect(()=>{if(!expires)return;const timer=setTimeout(()=>{setImage('');setExpires(0);},Math.max(0,expires-Date.now()));return()=>clearTimeout(timer);},[expires]);
 const invalidate=()=>{epoch.current++;setImage('');setExpires(0);};
 async function issue(){if(pending.current)return;pending.current=true;setBusy(true);setError('');setImage('');const version=epoch.current;
 try{const result=await client.business<{token:string;expiresAt:string}>('/api/v11/restaurant/formal/activities/'+encodeURIComponent(activity)+'/checkin-token','POST',{supplyId:supply});
 const end=Date.parse(result.expiresAt);if(!Number.isFinite(end)||end<=Date.now())throw Error('签到码已过期，请刷新');
 const graphic=createFormalCheckinQr(result.token);if(mounted.current&&version===epoch.current&&client.current()?.id===identity.id){setImage(graphic);setExpires(end);}
 }catch(e){if(mounted.current&&version===epoch.current)setError(e instanceof Error?e.message:'签到码未生成');if(!client.current()&&mounted.current)onSessionLost();}
 finally{pending.current=false;if(mounted.current)setBusy(false);}}
 return <section aria-label="正式签到工作区"><h3>正式现场签到</h3><p>签到仅保存首次到场事实，不代表履约确认，不设定迟到或处罚规则。</p>
 {identity.role==='RESTAURANT'&&<><label>活动编号<input aria-label="签到活动编号" value={activity} onChange={e=>{invalidate();setActivity(e.target.value);}}/></label><label>正式供应编号<input aria-label="签到供应编号" value={supply} onChange={e=>{invalidate();setSupply(e.target.value);}}/></label><button disabled={busy||!activity||!supply} onClick={()=>void issue()}>生成或刷新现场签到码</button></>}
 {image&&<><img src={image} alt="正式现场签到二维码"/><p role="status">技术有效期至 {new Date(expires).toLocaleTimeString()}，过期后由餐厅刷新。</p></>}{error&&<p role="alert">{error}</p>}
 </section>;
}
