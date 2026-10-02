import { useRef, useState } from "react";
import { Button, Input, ScrollView, Text, View } from "@tarojs/components";
import Taro, { useDidHide, useDidShow } from "@tarojs/taro";
import { fundingLabel, prelaunchShanghaiDate, type PrelaunchPolicy, type PrelaunchRegistrationView } from "@timeleft-shanghai/shared/prelaunch-client";
import { prelaunchClient as api, prelaunchEnabled } from "../../prelaunch-api";

interface Activity { preferenceMatched?: boolean; id: string; supplyId: string; title: string; startsAt: string; district: string; F?: number; D?: number; estimatedMealMinCents?: number; estimatedMealMaxCents?: number; fixedFees?: Array<{label:string; amountCents:number}>; capacity?: number; }
interface RequestView { id: string; kind: string; state: string; blockerIds?: string[]; registrationId?: string; acceptedAt?: string; allowedActions?: string[]; }
interface Notice { id: string; kind?: string; state?: string; }
const key = () => `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function PrelaunchPage(): JSX.Element {
  return prelaunchEnabled ? <Workspace /> : <View className="page"><Text>当前未开启本地验收工作区。</Text></View>;
}
function Workspace(): JSX.Element {
  const [actorId, setActorId] = useState(""); const [password, setPassword] = useState("");
  const [session, setSession] = useState(api.session()); const [error, setError] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const active = useRef(false);
  const generation = useRef(0);
  const [policy, setPolicy] = useState<PrelaunchPolicy | null>(null); const [confirmed, setConfirmed] = useState(false);
  const [consentId, setConsentId] = useState<string | null>(null);
  const [gender, setGender] = useState<"MALE" | "FEMALE" | null>(null); const [adult, setAdult] = useState(false);
  const [compatible, setCompatible] = useState(false); const [times, setTimes] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]); const [orders, setOrders] = useState<PrelaunchRegistrationView[]>([]);
  const [selected, setSelected] = useState<PrelaunchRegistrationView | null>(null); const [cursor, setCursor] = useState<string | null>(null);
  const [requests, setRequests] = useState<RequestView[]>([]); const [notices, setNotices] = useState<Notice[]>([]);
  const [queueInfo,setQueueInfo] = useState<{position:number|null;total:number;rankingClock:string;officialClockBlockers:string[]}|null>(null);const [queueActivity,setQueueActivity] = useState("");
  const [statement, setStatement] = useState("");
  const [syntheticCode, setSyntheticCode] = useState("");
  const [changes, setChanges] = useState<Array<{id:string; state:string; reason?:string; allowedActions?:string[]}>>([]);
  const [rights, setRights] = useState<RequestView[]>([]);
  const [noticeFailed, setNoticeFailed] = useState(false);
  useDidShow(() => { generation.current++; void load(); });
  useDidHide(() => { generation.current++; setSelected(null); setOrders([]); setRequests([]); setNotices([]); });
  async function act(operation: () => Promise<void>) {
    if (active.current) return; const before = generation.current; active.current = true; setBusy(true); setError(""); setMessage("");
    try { await operation(); } catch (cause) { if (before === generation.current) setError(cause instanceof Error ? cause.message : "操作未完成，请刷新查看进度"); }
    finally { if (!api.session()) { setOrders([]); setSelected(null); setRequests([]); setNotices([]); setRights([]); setChanges([]); setConsentId(null); } active.current = false; if (before === generation.current) { setBusy(false); setSession(api.session()); } }
  }
  async function load() {
    // Previous addresses are not a fresh authorization decision. Refresh clears the detail before any network I/O.
    setSelected(null);
    const before = generation.current;
    const results = await Promise.allSettled([
      api.call<PrelaunchPolicy>("GET", "/policy/current?scope=SIMULATION_ONLY", undefined, false),
      api.list<Activity>("/activities", "activities", !!api.session()).then(rows => ({activities:rows.map((activity,index)=>({activity,index})).sort((a,b)=>Number(!!b.activity.preferenceMatched)-Number(!!a.activity.preferenceMatched)||a.index-b.index).map(item=>item.activity)})),
      ...(api.session() ? [api.call<{ registrations: PrelaunchRegistrationView[]; nextCursor: string | null }>("GET", "/registrations"), api.list<RequestView>("/requests", "requests").then(rows => ({requests:rows})), api.list<Notice>("/notices", "notices").then(rows => ({notices:rows})), api.call<{ changes: Array<{id:string; state:string; reason?:string; allowedActions?:string[]}> }>("GET", "/changes"), api.list<RequestView>("/rights", "rights").then(rights=>({rights}))] : []),
    ]);
    if (before !== generation.current) return;
    const p = results[0], a = results[1], o = results[2], r = results[3], n = results[4];
    if (p?.status === "fulfilled") setPolicy(p.value as PrelaunchPolicy);
    if (a?.status === "fulfilled") setActivities((a.value as { activities: Activity[] }).activities);
    if (o?.status === "fulfilled") { const data = o.value as { registrations: PrelaunchRegistrationView[]; nextCursor: string | null }; setOrders(data.registrations); setCursor(data.nextCursor); }
    if (r?.status === "fulfilled") setRequests((r.value as { requests: RequestView[] }).requests);
    if (n?.status === "fulfilled") setNotices((n.value as { notices: Notice[] }).notices);
    if (results[5]?.status === "fulfilled") setChanges((results[5].value as {changes: typeof changes}).changes);
    if (results[6]?.status === "fulfilled") setRights((results[6].value as {rights: RequestView[]}).rights);
    if (!api.session()) { setOrders([]); setSelected(null); setRequests([]); setNotices([]); setRights([]); setChanges([]); setConsentId(null); }
    setNoticeFailed(n?.status === "rejected"); setSession(api.session());
    const failure = [p, a, o, r].find(result => result?.status === "rejected");
    if (failure?.status === "rejected") setError(failure.reason instanceof Error ? failure.reason.message : "部分信息暂时无法加载");
  }
  async function readOrder(id: string) { setSelected(null); const before = generation.current; const result = await api.call<{ registration: PrelaunchRegistrationView }>("GET", `/registrations/${encodeURIComponent(id)}`); if (before === generation.current) setSelected(result.registration); }
  async function join(activity: Activity, membership: "FORMAL" | "WAITLIST") {
    if (!policy || !consentId || !confirmed) throw Error("请先阅读并确认三份文本，保存最小资料");
    const before = generation.current; const result = await api.call<PrelaunchRegistrationView | {state:"BLOCKED_POLICY";request:RequestView;blockerIds:string[]}>("POST", "/registrations", { activityId: activity.id, supplyId: activity.supplyId, policyId: policy.policyId, consentId, membership, businessKey: key() });
    if (before !== generation.current) return; if (!("id" in result)) { setMessage(`申请已受理：${result.request.id}；${result.blockerIds.join("、")}；未创建收费报名`);await load();return; } setSelected(result); setMessage("报名记录已保存。请查看锁位时限及付款状态，尚未形成成功收款事实。"); await load();
  }
  async function pay(id: string) { await api.call("POST", `/registrations/${encodeURIComponent(id)}/pay`, {}); setMessage("已提交本地模拟付款，是否成功以服务端查得的收款事实为准。"); await load(); await readOrder(id); }
  async function cancel(id: string) { await api.call("POST", `/registrations/${encodeURIComponent(id)}/cancel`, { businessKey: key() }); setMessage("取消申请已受理，退款和席位影响请分别查看处理进度。"); await load(); await readOrder(id); }
  function logout() { generation.current++; api.logout(); setSession(null); setConsentId(null); setConfirmed(false); setOrders([]); setSelected(null); setRequests([]); setNotices([]); setPassword(""); setRights([]); setChanges([]); setQueueInfo(null); }
  return <ScrollView className="page" scrollY>
    <Text className="title">饭局 · 本地验收</Text>
    <Text className="summary">仅限合成账号、合成资料与模拟资金。当前政策为草案，尚未正式启用；请勿填写真实个人材料。</Text>
    {error ? <Text className="error-text">{error}</Text> : null}{message ? <Text>{message}</Text> : null}
    {!session ? <View className="section"><Text>受控测试账号</Text><Input placeholder="测试账号 ID" value={actorId} onInput={e => setActorId(e.detail.value)} /><Input password placeholder="测试密码" value={password} onInput={e => setPassword(e.detail.value)} /><Button disabled={busy || !actorId || !password} onClick={() => void act(async () => { const loggedIn = await api.login(actorId.trim(), password); setPassword(""); setSession(loggedIn); await load(); })}>登录</Button></View> : <View><Text>当前测试账号：{session.actor.id}</Text><Button onClick={logout}>退出登录</Button></View>}
    <Button disabled={busy} onClick={() => void act(load)}>刷新</Button>
    <View className="section"><Text className="section-heading">客服说明</Text><Text>首发客服渠道为微信小程序内在线客服，服务时间每日10:00—22:00（Asia/Shanghai），暂不承诺固定首次人工响应时长。</Text><Text>当前本地验收未接通真实客服。客服回复时间不改变系统受理取消、退款等请求的业务时间；请通过对应申请入口提交并查看受理进度。</Text></View>
    <View className="section"><Text className="section-heading">报名资料</Text><Text>时间偏好选填。此处仅验证模拟资料准入，不收集病史或证明材料。</Text>
      <Button disabled={busy} onClick={() => setGender("MALE")}>测试性别：男{gender === "MALE" ? "（已选）" : ""}</Button><Button disabled={busy} onClick={() => setGender("FEMALE")}>测试性别：女{gender === "FEMALE" ? "（已选）" : ""}</Button>
      <Button onClick={() => setAdult(!adult)}>{adult ? "已确认" : "确认"}测试账号成年资格</Button><Button onClick={() => setCompatible(!compatible)}>{compatible ? "已确认" : "确认"}服务适配</Button>
      <Text>选填时间偏好仅用于活动优先展示与内部开局需求统计，不限制报名、付款或排桌。上海时间：午餐11:00—15:00，晚餐17:00—22:00；边界结束时刻不计入。</Text>{([["WEEKDAY_LUNCH","工作日午餐"],["WEEKDAY_DINNER","工作日晚餐"],["WEEKEND_LUNCH","周末午餐"],["WEEKEND_DINNER","周末晚餐"]] as const).map(([code,label])=><Button key={code} onClick={()=>setTimes(previous=>{const values=previous.split(/[,，]/).map(t=>t.trim()).filter(Boolean);return (values.includes(code)?values.filter(v=>v!==code):[...values,code]).join(",");})}>{label}{times.split(/[,，]/).map(t=>t.trim()).includes(code)?"（已选）":""}</Button>)}<Input value={times} placeholder="选填时段代码，逗号分隔" onInput={e => setTimes(e.detail.value)} />
      <Button disabled={busy || !session || !gender || !adult || !compatible} onClick={() => void act(async () => { await api.call("PUT", "/profile", { gender, timePreferences: times.split(/[,，]/).map(t => t.trim()).filter(Boolean), adultDeclaration: true, serviceCompatible: true }); setMessage("最小测试资料已保存"); await load(); })}>保存资料</Button>
    </View>
    <View className="section"><Text className="section-heading">本次文本</Text>{policy ? <><Text>{policy.bundleVersion} · {policy.status} · 尚不可正式启用</Text>{policy.documents.map(doc => <View key={doc.documentId}><Text className="section-heading">{doc.documentId} / {doc.version}</Text><Text selectable>{doc.publicText}</Text></View>)}
      <Button onClick={() => setConfirmed(!confirmed)}>{confirmed ? "已勾选" : "确认"}已阅读三份测试文本</Button><Button disabled={busy || !session || !confirmed} onClick={() => void act(async () => { const result = await api.call<{ consentId: string }>("POST", "/consents", { policyId: policy.policyId, documentHashes: Object.fromEntries(policy.documents.map(d => [d.documentId, d.fullHash])), publicHashes: Object.fromEntries(policy.documents.map(d => [d.documentId, d.publicHash])), confirm: true }); setConsentId(result.consentId); setMessage("测试确认记录已保存，不代表正式政策批准"); })}>保存本次确认</Button></> : <Text>文本暂时不可用，不能报名。</Text>}</View>
    <View className="section"><Text className="section-heading">活动</Text>{activities.length ? activities.map(a => <View className="meal-card" key={a.id}><Text>{a.preferenceMatched ? "符合已保存时间偏好 · " : ""}{a.title} · {a.district} · {prelaunchShanghaiDate(a.startsAt)}</Text><Text>{Number.isSafeInteger(a.F) && Number.isSafeInteger(a.D) ? fundingLabel(a.F!, a.D!) : "报价尚未完成"}</Text><Text>预计到店餐费：{a.estimatedMealMinCents == null || a.estimatedMealMaxCents == null ? "尚未确认" : `¥${(a.estimatedMealMinCents / 100).toFixed(2)}—¥${(a.estimatedMealMaxCents / 100).toFixed(2)}`}；容量 {a.capacity ?? "待确认"}</Text>{a.fixedFees?.map(f => <Text key={f.label}>{f.label} ¥{(f.amountCents / 100).toFixed(2)}</Text>)}<Text>付费候补不占正式席位；转正条件、截止和退款以本次政策与服务端状态为准。</Text><Button disabled={busy || !session || !consentId} onClick={() => void act(() => join(a, "FORMAL"))}>申请正式席位</Button><Button disabled={busy || !session || !consentId} onClick={() => void act(() => join(a, "WAITLIST"))}>申请付费候补</Button></View>) : <Text>暂无可报名活动。</Text>}</View>
    <View className="section"><Text className="section-heading">本人候补进度</Text><Input value={queueActivity} placeholder="已有效付费候补的活动 ID" onInput={e=>setQueueActivity(e.detail.value)}/><Button disabled={busy || !session || !queueActivity} onClick={()=>void act(async()=>{const result=await api.call<{queue:typeof queueInfo}>("GET",`/waitlist?activityId=${encodeURIComponent(queueActivity)}`);setQueueInfo(result.queue);})}>查询本人候补顺序</Button>{queueInfo?<Text>合成队列位置 {queueInfo.position??"待定"} / {queueInfo.total}；正式时钟待确认 {queueInfo.officialClockBlockers.join("、")}；付款/退出/转正状态以服务端事实为准。</Text>:null}</View>
    <View className="section"><Text className="section-heading">我的报名</Text>{orders.map(o => <View className="meal-card" key={o.id}><Text>{o.id} · {o.state}</Text><Text>{fundingLabel(o.F, o.D)}</Text><Button disabled={busy} onClick={() => void act(() => readOrder(o.id))}>查看详情</Button></View>)}
      {cursor ? <Button disabled={busy} onClick={() => void act(async () => { const result = await api.call<{ registrations: PrelaunchRegistrationView[]; nextCursor: string | null }>("GET", `/registrations?cursor=${encodeURIComponent(cursor)}`); setOrders(previous => [...previous, ...result.registrations]); setCursor(result.nextCursor); })}>加载更多</Button> : null}
      {selected ? <View className="meal-card"><Text>{selected.id} · {selected.state}</Text><Text>{fundingLabel(selected.F, selected.D)}</Text><Text>锁位截止：{selected.holdExpiresAt ? prelaunchShanghaiDate(selected.holdExpiresAt) : "无待付锁位"}</Text><Text>本桌：{selected.table?.state ?? "等待成团"}</Text><Text>餐厅：{selected.table?.restaurantName ?? "尚未解锁"}</Text><Text>地址：{selected.table?.state === "FORMED" ? selected.table.address ?? "尚未解锁" : "尚未解锁"}</Text><Text>退款状态 WAITING_BATCH 表示等待发起批次，UNKNOWN 表示结果待查询；均不代表退款已到账。</Text><Text>报名类型：{selected.category ?? "请刷新"}；阻塞：{selected.blockerIds?.join("、") || "无"}</Text>{selected.refunds?.map(f => <View key={f.id}><Text>退款 {f.id} · {f.state} · {fundingLabel(f.F ?? 0, f.D ?? 0)}</Text></View>)}<Button disabled={busy} onClick={() => void act(() => readOrder(selected.id))}>查询付款与退款进度</Button><Button disabled={busy} onClick={() => void act(() => pay(selected.id))}>继续模拟付款</Button><Button disabled={busy} onClick={() => void act(() => cancel(selected.id))}>提交取消申请</Button><Input value={statement} maxlength={1000} placeholder="合成特殊情形说明，禁止真实材料" onInput={e=>setStatement(e.detail.value)}/><Button disabled={busy} onClick={()=>void act(async()=>{await api.call("POST", `/registrations/${encodeURIComponent(selected.id)}/special-refund`, {businessKey:key(),reasonCode:"OTHER_EXCEPTION",...(statement.trim()?{syntheticEvidence:statement.trim()}: {})});setMessage("特殊退款申请和原取消事实均已保存，等待受控审核");await load();await readOrder(selected.id);})}>提交合成特殊退款申请</Button><Input value={syntheticCode} placeholder="本场合成码文本（本地验收）" onInput={e => setSyntheticCode(e.detail.value)}/><Button disabled={busy || !syntheticCode} onClick={() => void act(async () => {await api.call("POST", `/registrations/${encodeURIComponent(selected.id)}/checkin`, {qrToken:syntheticCode});setMessage("合成签到事实已记录，不代表正常履约");await readOrder(selected.id);})}>提交合成码文本</Button><Button disabled={busy} onClick={() => void act(async () => { const scan = await Taro.scanCode({ onlyFromCamera: true }); await api.call("POST", `/registrations/${encodeURIComponent(selected.id)}/checkin`, { qrToken: scan.result }); setMessage("签到证据已提交，餐厅确认与保证金处置分别处理"); await readOrder(selected.id); })}>扫描本场测试签到码</Button></View> : null}
    </View>
    <View className="section"><Text className="section-heading">申请与复核进度</Text><Input value={statement} maxlength={1000} placeholder="合成事实说明（不填真实证明材料）" onInput={e => setStatement(e.detail.value)}/><Text>申请窗口和决定以服务端证据为准；未决分支也会保留申请时刻。</Text>{requests.map(r => <View key={r.id}><Text>{r.kind} · {r.state} · {r.blockerIds?.join("、")}</Text><Button disabled={busy || !r.allowedActions?.includes("EXPLANATION")} onClick={() => void act(async () => { await api.call("POST", `/requests/${encodeURIComponent(r.id)}/explanation`, {businessKey:key(), ...(statement.trim() ? {statement:statement.trim()} : {})}); setMessage("说明已受理"); await load(); })}>提交事实异议</Button><Button disabled={busy || !r.allowedActions?.includes("REVIEW")} onClick={() => void act(async () => { await api.call("POST", `/requests/${encodeURIComponent(r.id)}/review`, { businessKey: key(), ...(statement.trim() ? {statement:statement.trim()} : {}) }); setMessage("复核申请已受理"); await load(); })}>申请最终复核</Button></View>)}</View>
    <View className="section"><Text className="section-heading">站内消息</Text>{noticeFailed ? <Text>消息暂时不可用，报名和申请进度仍可查询。</Text> : notices.map(n => <View key={n.id}><Text>{n.kind ?? "活动通知"} · {n.state ?? "待查看"}</Text><Button disabled={busy} onClick={() => void act(async () => { await api.call("POST", `/notices/${encodeURIComponent(n.id)}/receive`, {}); setMessage("已记录模拟接收；正式送达机制仍待专项确认"); await load(); })}>确认收到测试通知</Button></View>)}</View>
    <View className="section"><Text className="section-heading">安排变更</Text>{changes.map(c => <View key={c.id}><Text>{c.id} · {c.state} · {c.reason}</Text>{(["ACCEPT", "REJECT"] as const).map(decision => <Button key={decision} disabled={busy} onClick={() => void act(async () => { await api.call("POST", `/changes/${encodeURIComponent(c.id)}/respond`, {choice:decision}); setMessage("变更答复已保存，请分别查看报名与退款进度"); await load(); })}>{decision === "ACCEPT" ? "明确接受新安排" : "拒绝新安排并申请全退"}</Button>)}</View>)}</View>
    <View className="section"><Text className="section-heading">隐私权利</Text>{rights.map(r => <View key={r.id}><Text>{r.kind} · {r.state} · {r.blockerIds?.join("、")}</Text><Button disabled={busy} onClick={() => void act(async () => { const detail = await api.call<{right:RequestView; export?:unknown; dispositions?:Array<{state:string}>}>("GET", `/rights/${encodeURIComponent(r.id)}`); setMessage(`${detail.right.kind}：${detail.right.state}；${detail.right.blockerIds?.join("、") || "正在处理"}${detail.export ? `；本人合成导出：${JSON.stringify(detail.export)}` : ""}`); })}>查询申请详情</Button></View>)}{([['ACCESS', '查询'], ['EXPORT', '导出申请'], ['CORRECTION', '按已填最小资料更正'], ['CLOSURE', '注销申请'], ['WITHDRAWAL', '撤回申请']] as const).map(([kind, label]) => <Button key={kind} disabled={busy || !session} onClick={() => void act(async () => { await api.call("POST", "/rights", { kind, businessKey: key(), ...(kind === "CORRECTION" ? {correction:{gender, timePreferences:times.split(/[,，]/).map(t=>t.trim()).filter(Boolean),adultDeclaration:adult,serviceCompatible:compatible}} : {}) }); setMessage("申请已受理，已有履约和资金责任会保留"); await load(); })}>{label}</Button>)}</View>
  </ScrollView>;
}
