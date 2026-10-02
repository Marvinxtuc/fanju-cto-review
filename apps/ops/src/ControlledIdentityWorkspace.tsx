import type {ObligationPage} from './controlled-obligations.js';
import { useEffect, useRef, useState } from "react";
import { browserControlledIdentityClient, type ControlledPrincipal } from "./controlled-identity-api.js";
import {FormalBusinessWorkspace} from './FormalBusinessWorkspace.js';

export function ControlledIdentityWorkspace(): JSX.Element {
  const client = useRef<ReturnType<typeof browserControlledIdentityClient> | null>(null);
  const epoch = useRef(0);
  const [identity, setIdentity] = useState<ControlledPrincipal | null>(null);
  const [records,setRecords]=useState<ObligationPage|null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(()=>{const hide=()=>{if(document.visibilityState!=='visible')logout();};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);epoch.current++;client.current?.logout();};},[]);
  async function run(login: boolean) {
    const generation = ++epoch.current; setBusy(true); setError(""); setRecords(null);
    try {
      client.current ??= browserControlledIdentityClient();
      const task = login ? client.current.login(username, password) : client.current.refresh();
      setPassword("");
      const next = await task;
      if (epoch.current === generation) setIdentity(next);
    } catch (e) {
      if (epoch.current === generation) { setIdentity(null); setError(e instanceof Error ? e.message : "身份核验失败"); }
    } finally { if (epoch.current === generation) { setBusy(false); setPassword(""); } }
  }
  function logout() { epoch.current++; client.current?.logout(); setIdentity(null); setRecords(null); setBusy(false); setPassword(""); setError(""); }
  async function load(cursor?:string){const generation=++epoch.current;setBusy(true);setError('');setRecords(null);
    try{const page=await client.current!.obligations(cursor);if(epoch.current===generation)setRecords(page);}
    catch(e){if(epoch.current===generation){setRecords(null);if(!client.current?.current())setIdentity(null);setError(e instanceof Error?e.message:'查询失败');}}
    finally{if(epoch.current===generation)setBusy(false);}
  }
  return <main><h1>受控工作台</h1>
    {identity ? <section aria-label="当前身份"><p>角色：{identity.role === "OPS" ? "运营" : identity.role === "REVIEWER" ? "复核" : "餐厅"}</p>
      {identity.restaurantId && <p>授权餐厅：{identity.restaurantId}</p>}
      {identity.role!=='RESTAURANT'&&<button disabled={busy} onClick={()=>void load()}>查看应退进度</button>}<button disabled={busy} onClick={() => void run(false)}>重新核验身份</button>
      {client.current&&<FormalBusinessWorkspace key={identity.id+':'+identity.version} client={client.current} identity={identity} onSessionLost={logout}/>}</section>
      : <form onSubmit={e => { e.preventDefault(); void run(true); }}>
        <label>账号<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required maxLength={80} disabled={busy}/></label>
        <label>密码<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required maxLength={256} disabled={busy}/></label>
        <button disabled={busy}>登录</button></form>}
    {records&&<section aria-label="应退进度"><h2>已记录应退进度</h2>{records.items.length===0&&<p>本页暂无已归属记录。</p>}{records.items.map(row=><article key={row.caseId}><p>核对项：{row.caseId}</p>{row.evidenceConflict?<p role="alert">证据冲突，金额待核对。</p>:row.obligation&&<><p>原应退：¥{(row.obligation.amountCents/100).toFixed(2)}；已确认退回：¥{(row.obligation.confirmedCents/100).toFixed(2)}；剩余：¥{(row.obligation.remainingCents/100).toFixed(2)}</p><p>{row.obligation.state==='CONFIRMED'?'已确认全退':row.obligation.state==='EXECUTION_RECORDED'?'已记录退款指令，待渠道确认':'尚无退款执行记录'}</p></>}</article>)}{records.nextCursor&&<button disabled={busy} onClick={()=>void load(records.nextCursor!)}>下一页</button>}</section>}
    <button onClick={logout}>退出登录</button>{error && <p role="alert">{error}</p>}
  </main>;
}
