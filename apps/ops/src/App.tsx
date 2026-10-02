import { useEffect, useRef, useState } from "react";

import {
  addBlacklistEntry,
  claimFinancialCase,
  adjustTableGroups,
  approveRefund,
  rejectRefund,
  cancelActivity,
  completeActivity,
  confirmTableGroups,
  draftTableGroups,
  loadTableCandidates,
  loadOpsData,
  loginOps,
  loginDemoOps,
  markGroupFailed,
  openActivityRegistration,
  publishActivity,
  resolveReport,
  resolveFinancialCase,
  removeBlacklistEntry,
  startActivity,
  type OpsActivity,
  type OpsBlacklistEntry,
  type OpsData,
  type OpsOrder,
  type OpsRefund,
  type OpsReport,
  type OpsReview,
  type OpsRole,
  type OpsRestaurant,
  type OpsTableCandidate,
  type OpsTableGroup,
} from "./api.js";
import { ActivityForm, RestaurantForm } from "./SupplyForms.js";
import { formatCandidateProfile } from "./candidate-profile.js";

import { SessionTracker } from "./session.js";

import "./app.css";

type OpsTab = "restaurants" | "activities" | "orders" | "reports" | "reviews" | "blacklist" | "audit";

const tabs: Array<{ id: OpsTab; label: string }> = [
  { id: "restaurants", label: "餐厅" },
  { id: "activities", label: "活动" },
  { id: "orders", label: "订单/退款" },
  { id: "reports", label: "反馈处理" },
  { id: "reviews", label: "体验评价" },
  { id: "blacklist", label: "黑名单" },
  { id: "audit", label: "审计" },
];

export function App(): JSX.Element {
  const sessions = useRef(new SessionTracker()).current;
  const session = sessions.capture();
  const [activeTab, setActiveTab] = useState<OpsTab>("restaurants");
  const [token, setToken] = useState("");
  const [role, setRole] = useState<OpsRole | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [data, setData] = useState<OpsData | null>(null);
  const [error, setError] = useState("");
  const [groupingActivityId, setGroupingActivityId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<OpsTableCandidate[] | null>(null);
  const [tableGroups, setTableGroups] = useState<OpsTableGroup[]>([]);
  const [groupingBusy, setGroupingBusy] = useState(false);
  const [activityLifecycleBusy, setActivityLifecycleBusy] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      if (!token) return;
      const nextData = await loadOpsData(token);
      if (sessions.isCurrent(session)) setData(nextData);
    } catch (loadError) {
      if (!sessions.isCurrent(session)) return;
      setError(loadError instanceof Error ? loadError.message : "后台数据加载失败");
    }
  }

  useEffect(() => {
    function expire(event: Event) {
      const authorization = (event as CustomEvent<{ authorization?: string }>).detail?.authorization;
      const current = sessions.capture();
      if (!current.token || authorization !== `Bearer ${current.token}`) return;
      sessions.invalidate(); setToken(""); setRole(null); setData(null); setCandidates(null); setTableGroups([]); setGroupingBusy(false); setActivityLifecycleBusy(null); setError("登录已失效，请重新登录后继续"); }
    window.addEventListener("fanju-session-expired", expire);
    return () => window.removeEventListener("fanju-session-expired", expire);
  }, []);

  async function handleLogin(demo = false): Promise<void> {
    const epoch = sessions.invalidate();
    setLoginBusy(true);
    setError("");
    try {
      const login = demo ? await loginDemoOps() : await loginOps(username, password);
      setPassword("");
      const nextData = await loadOpsData(login.token);
      if (sessions.isGeneration(epoch)) { sessions.activate(login.token); setToken(login.token); setRole(login.admin.role); setData(nextData); }
    } catch (error) {
      if (!sessions.isGeneration(epoch)) return;
      setError(error instanceof Error ? error.message : "登录失败");
    } finally { setPassword(""); setLoginBusy(false); }
  }


  async function handleApproveRefund(refundId: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      await approveRefund(token, refundId);
      if (!sessions.isCurrent(session)) return;
      await refresh();
      if (!sessions.isCurrent(session)) return;
    } catch (approveError) {
      if (!sessions.isCurrent(session)) return;
      setError(approveError instanceof Error ? approveError.message : "退款审批失败");
    }
  }

  async function handleRejectRefund(refundId: string): Promise<void> {
    const reason = window.prompt("请输入退款审核拒绝原因");
    if (!reason?.trim() || !sessions.isCurrent(session)) return;
    try {
      setError("");
      await rejectRefund(token, refundId, reason.trim());
      if (sessions.isCurrent(session)) await refresh();
    } catch (error) {
      if (sessions.isCurrent(session)) setError(error instanceof Error ? error.message : "退款审核拒绝失败");
    }
  }

  async function handleFinancialCase(id: string, action: "claim" | "resolve"): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      if (action === "claim") await claimFinancialCase(token, id);
      else await resolveFinancialCase(token, id);
      if (sessions.isCurrent(session)) await refresh();
    } catch (error) {
      if (sessions.isCurrent(session)) setError(error instanceof Error ? error.message : "异常待办处理失败");
    }
  }

  async function handleCancelActivity(activityId: string): Promise<void> {
    const reason = window.prompt("取消活动将建立逐笔退款责任。请输入取消原因（仅超级管理员可执行）");
    if (!reason?.trim() || !sessions.isCurrent(session)) return;
    try {
      setError(""); setActivityLifecycleBusy(activityId);
      await cancelActivity(token, activityId, reason.trim());
      if (sessions.isCurrent(session)) await refresh();
    } catch (error) {
      if (sessions.isCurrent(session)) setError(error instanceof Error ? error.message : "活动取消失败");
    } finally {
      if (sessions.isCurrent(session)) setActivityLifecycleBusy(null);
    }
  }

  async function handlePublishActivity(activityId: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError(""); setActivityLifecycleBusy(activityId);
      await publishActivity(token, activityId);
      if (sessions.isCurrent(session)) await refresh();
    } catch (error) {
      if (sessions.isCurrent(session)) setError(error instanceof Error ? error.message : "活动发布失败");
    } finally { if (sessions.isCurrent(session)) setActivityLifecycleBusy(null); }
  }

  async function handleOpenRegistration(activityId: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError(""); setActivityLifecycleBusy(activityId);
      await openActivityRegistration(token, activityId);
      if (sessions.isCurrent(session)) await refresh();
    } catch (error) {
      if (sessions.isCurrent(session)) setError(error instanceof Error ? error.message : "开放报名失败");
    } finally { if (sessions.isCurrent(session)) setActivityLifecycleBusy(null); }
  }

  async function handleResolveReport(reportId: string, status: "RESOLVED" | "REJECTED", reason: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      await resolveReport(token, reportId, status, reason);
      if (!sessions.isCurrent(session)) return;
      await refresh();
      if (!sessions.isCurrent(session)) return;
    } catch (resolveError) {
      if (!sessions.isCurrent(session)) return;
      setError(resolveError instanceof Error ? resolveError.message : "反馈处理失败");
    }
  }

  async function handleAddBlacklistEntry(userId: string, reason: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      await addBlacklistEntry(token, userId, reason);
      if (!sessions.isCurrent(session)) return;
      await refresh();
      if (!sessions.isCurrent(session)) return;
    } catch (blacklistError) {
      if (!sessions.isCurrent(session)) return;
      setError(blacklistError instanceof Error ? blacklistError.message : "黑名单添加失败");
    }
  }

  async function handleRemoveBlacklistEntry(userId: string): Promise<void> {
    const reason = window.prompt("解除黑名单原因（仅超级管理员可执行）");
    if (!reason?.trim() || !sessions.isCurrent(session)) return;
    try {
      setError(""); await removeBlacklistEntry(token, userId, reason.trim());
      if (sessions.isCurrent(session)) await refresh();
    } catch (error) {
      if (sessions.isCurrent(session)) setError(error instanceof Error ? error.message : "解除黑名单失败");
    }
  }

  async function handleOpenGrouping(activityId: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      setGroupingBusy(true);
      setGroupingActivityId(activityId);
      const grouping = await loadTableCandidates(token, activityId);
      if (!sessions.isCurrent(session)) return;
      setCandidates(grouping.candidates);
      setTableGroups(grouping.tableGroups);
    } catch (groupingError) {
      if (!sessions.isCurrent(session)) return;
      setError(groupingError instanceof Error ? groupingError.message : "候选人加载失败");
    } finally {
      if (sessions.isCurrent(session)) setGroupingBusy(false);
    }
  }

  async function handleDraftGrouping(activityId: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      setGroupingBusy(true);
      const draft = await draftTableGroups(token, activityId);
      if (!sessions.isCurrent(session)) return;
      setTableGroups(draft.tableGroups);
      await refresh();
      if (!sessions.isCurrent(session)) return;
    } catch (groupingError) {
      if (!sessions.isCurrent(session)) return;
      setError(groupingError instanceof Error ? groupingError.message : "排桌草案生成失败");
    } finally {
      if (sessions.isCurrent(session)) setGroupingBusy(false);
    }
  }

  async function handleConfirmGrouping(activityId: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      setGroupingBusy(true);
      await confirmTableGroups(token, activityId);
      if (!sessions.isCurrent(session)) return;
      await refresh();
      if (!sessions.isCurrent(session)) return;
    } catch (groupingError) {
      if (!sessions.isCurrent(session)) return;
      setError(groupingError instanceof Error ? groupingError.message : "成团确认失败");
    } finally {
      if (sessions.isCurrent(session)) setGroupingBusy(false);
    }
  }

  async function handleAdjustGrouping(activityId: string, tableGroups: Array<{ orderIds: string[] }>): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      setGroupingBusy(true);
      const adjusted = await adjustTableGroups(token, activityId, tableGroups);
      if (!sessions.isCurrent(session)) return;
      setTableGroups(adjusted.tableGroups);
    } catch (groupingError) {
      if (!sessions.isCurrent(session)) return;
      setError(groupingError instanceof Error ? groupingError.message : "人工调整保存失败");
    } finally {
      if (sessions.isCurrent(session)) setGroupingBusy(false);
    }
  }

  async function handleMarkGroupFailed(activityId: string, reason: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      setGroupingBusy(true);
      await markGroupFailed(token, activityId, reason);
      if (!sessions.isCurrent(session)) return;
      setTableGroups([]);
      await refresh();
      if (!sessions.isCurrent(session)) return;
    } catch (groupingError) {
      if (!sessions.isCurrent(session)) return;
      setError(groupingError instanceof Error ? groupingError.message : "成团失败标记失败");
    } finally {
      if (sessions.isCurrent(session)) setGroupingBusy(false);
    }
  }

  async function handleStartActivity(activityId: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      setActivityLifecycleBusy(activityId);
      await startActivity(token, activityId);
      if (!sessions.isCurrent(session)) return;
      await refresh();
      if (!sessions.isCurrent(session)) return;
    } catch (activityError) {
      if (!sessions.isCurrent(session)) return;
      setError(activityError instanceof Error ? activityError.message : "活动开始标记失败");
    } finally {
      if (sessions.isCurrent(session)) setActivityLifecycleBusy(null);
    }
  }

  async function handleCompleteActivity(activityId: string): Promise<void> {
    if (!sessions.isCurrent(session)) return;
    try {
      setError("");
      setActivityLifecycleBusy(activityId);
      await completeActivity(token, activityId);
      if (!sessions.isCurrent(session)) return;
      await refresh();
      if (!sessions.isCurrent(session)) return;
    } catch (activityError) {
      if (!sessions.isCurrent(session)) return;
      setError(activityError instanceof Error ? activityError.message : "活动完成标记失败");
    } finally {
      if (sessions.isCurrent(session)) setActivityLifecycleBusy(null);
    }
  }

  return (
    <main className="ops-shell">
      <header className="ops-header">
        <div className="ops-header__copy">
          <p className="eyebrow">CITY MENU LAB OPS</p>
          <h1>饭局运营台</h1>
          <p>用菜单、饭票和审计小票管理上海本地餐厅兴趣体验。</p>
        </div>
        <div className="ops-logo" aria-hidden="true">
          局
        </div>
        <button className="ops-button ops-button--secondary" type="button" onClick={() => void refresh()}>
          刷新
        </button>
      </header>

      {!token ? <form className="ops-panel" onSubmit={event => { event.preventDefault(); void handleLogin(); }}>
        <h2>管理员登录</h2>
        <label>账号<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
        <label>密码<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button type="submit" disabled={loginBusy || !username || !password}>{loginBusy ? "登录中…" : "登录"}</button>
        {import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === "true" ? <button type="button" disabled={loginBusy} onClick={() => void handleLogin(true)}>本地演示登录</button> : null}
      </form> : <button type="button" onClick={() => { sessions.invalidate(); setToken(""); setRole(null); setData(null); setCandidates(null); setTableGroups([]); setGroupingBusy(false); setActivityLifecycleBusy(null); }}>退出登录</button>}

      {data ? <Dashboard data={data} /> : null}

      <nav className="ops-tabs" aria-label="后台模块">
        {tabs.map((tab) => (
          <button
            aria-current={activeTab === tab.id ? "page" : undefined}
            className={activeTab === tab.id ? "ops-tabs__item ops-tabs__item--active" : "ops-tabs__item"}
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {error ? (
        <p className="ops-alert" role="alert">
          错误：{error}
        </p>
      ) : null}
      {!data ? null : renderTab(activeTab, data, {
        token, role, onSupplySaved: refresh, onPublishActivity: handlePublishActivity, onOpenRegistration: handleOpenRegistration,
        onApproveRefund: handleApproveRefund,
        onRejectRefund: handleRejectRefund,
        onFinancialCase: handleFinancialCase,
        onCancelActivity: handleCancelActivity,
        onOpenGrouping: handleOpenGrouping,
        onDraftGrouping: handleDraftGrouping,
        onConfirmGrouping: handleConfirmGrouping,
        onAdjustGrouping: handleAdjustGrouping,
        onMarkGroupFailed: handleMarkGroupFailed,
        onResolveReport: handleResolveReport,
        onAddBlacklistEntry: handleAddBlacklistEntry,
        onRemoveBlacklistEntry: handleRemoveBlacklistEntry,
        onStartActivity: handleStartActivity,
        onCompleteActivity: handleCompleteActivity,
        groupingActivityId,
        candidates,
        tableGroups,
        groupingBusy,
        activityLifecycleBusy,
      })}
    </main>
  );
}

function Dashboard({ data }: { data: OpsData }): JSX.Element {
  const reviewingRefunds = data.refunds.filter((refund) => refund.status === "REVIEWING" || refund.status === "FAILED").length;
  const openReports = data.reports.filter((report) => report.status === "OPEN").length;
  const heldOrders = data.orders.filter((order) => order.capacityHeld).length;

  return (
    <section className="ops-dashboard" aria-label="运营概览">
      <MetricCard label="餐厅库" value={String(data.restaurants.length)} note="可排期资源" />
      <MetricCard label="饭局排期" value={String(data.activities.length)} note="活动状态跟踪" />
      <MetricCard label="占位订单" value={String(heldOrders)} note="当前容量口径" tone="blue" />
      <MetricCard label="待审退款" value={String(reviewingRefunds)} note="需人工确认" tone="red" />
      <MetricCard label="待处理反馈" value={String(openReports)} note="仅运营可见" tone="blue" />
      <MetricCard label="体验评价" value={String(data.reviews.length)} note="仅运营查看" tone="blue" />
      <MetricCard label="黑名单" value={String(data.blacklist.length)} note="限制新报名" tone="red" />
    </section>
  );
}

function MetricCard({ label, value, note, tone = "orange" }: { label: string; value: string; note: string; tone?: "orange" | "blue" | "red" }): JSX.Element {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function renderTab(
  activeTab: OpsTab,
  data: OpsData,
  actions: {
    token: string;
    role: OpsRole | null;
    onSupplySaved: () => Promise<void>;
    onPublishActivity: (activityId: string) => Promise<void>;
    onOpenRegistration: (activityId: string) => Promise<void>;
    onApproveRefund: (refundId: string) => Promise<void>;
    onRejectRefund: (refundId: string) => Promise<void>;
    onFinancialCase: (id: string, action: "claim" | "resolve") => Promise<void>;
    onCancelActivity: (activityId: string) => Promise<void>;
    onOpenGrouping: (activityId: string) => Promise<void>;
    onDraftGrouping: (activityId: string) => Promise<void>;
    onConfirmGrouping: (activityId: string) => Promise<void>;
    onAdjustGrouping: (activityId: string, tableGroups: Array<{ orderIds: string[] }>) => Promise<void>;
    onMarkGroupFailed: (activityId: string, reason: string) => Promise<void>;
    onResolveReport: (reportId: string, status: "RESOLVED" | "REJECTED", reason: string) => Promise<void>;
    onAddBlacklistEntry: (userId: string, reason: string) => Promise<void>;
    onRemoveBlacklistEntry: (userId: string) => Promise<void>;
    onStartActivity: (activityId: string) => Promise<void>;
    onCompleteActivity: (activityId: string) => Promise<void>;
    groupingActivityId: string | null;
    candidates: OpsTableCandidate[] | null;
    tableGroups: OpsTableGroup[];
    groupingBusy: boolean;
    activityLifecycleBusy: string | null;
  },
): JSX.Element {
  if (activeTab === "restaurants") {
    return (
      <section className="ops-content">
        <SectionHeader title="餐厅菜单库" subtitle="维护可开桌餐厅、区域和容量，页面仅展示运营必要信息。" stamp="MENU" />
        <RestaurantManager token={actions.token} restaurants={data.restaurants} onSaved={actions.onSupplySaved} />
        <div className="ticket-grid">
          {data.restaurants.map((restaurant) => (
            <RestaurantTicket key={restaurant.id} restaurant={restaurant} />
          ))}
        </div>
      </section>
    );
  }

  if (activeTab === "activities") {
    return (
      <section className="ops-content">
        <SectionHeader title="饭局排期" subtitle="跟踪活动状态、服务费和开桌时间，保持饭局优先的表达。" stamp="OPEN" />
        <ActivityForm token={actions.token} restaurants={data.restaurants} onSaved={actions.onSupplySaved} />
        <div className="ticket-list">
          {data.activities.map((activity) => (
            <ActivityTicket activity={activity} key={activity.id} onOpenGrouping={actions.onOpenGrouping} onStartActivity={actions.onStartActivity} onCompleteActivity={actions.onCompleteActivity} onCancelActivity={actions.onCancelActivity} onPublishActivity={actions.onPublishActivity} onOpenRegistration={actions.onOpenRegistration} canCancel={actions.role === "SUPER_ADMIN"} lifecycleBusy={actions.activityLifecycleBusy === activity.id} />
          ))}
        </div>
        {actions.groupingActivityId ? (
          <GroupingPanel
            activity={data.activities.find((activity) => activity.id === actions.groupingActivityId) ?? null}
            busy={actions.groupingBusy}
            candidates={actions.candidates}
            tableGroups={actions.tableGroups}
            onDraft={actions.onDraftGrouping}
            onConfirm={actions.onConfirmGrouping}
            onAdjust={actions.onAdjustGrouping}
            onMarkGroupFailed={actions.onMarkGroupFailed}
          />
        ) : null}
      </section>
    );
  }

  if (activeTab === "orders") {
    return (
      <section className="ops-content">
        <SectionHeader title="订单与退款小票" subtitle="保留服务端计价和退款状态机入口，待审项以小票方式突出。" stamp="RECEIPT" />
        <div className="ticket-list">
          {data.orders.map((order) => (
            <OrderTicket key={order.id} order={order} />
          ))}
        </div>
        <h3 className="subheading">退款审核</h3>
        <div className="ticket-list">
          {data.refunds.map((refund) => (
            <RefundTicket key={refund.id} onApproveRefund={actions.onApproveRefund} onRejectRefund={actions.onRejectRefund} refund={refund} />
          ))}
        </div>
        <h3 className="subheading">资金异常待办</h3>
        <p>结案只在渠道事实已收敛、且复核人与处理人不同时生效；结案不会改写资金记录。</p>
        <div className="ticket-list">
          {data.financialCases.length === 0 ? <p className="ops-loading">当前没有开放的资金异常待办。</p> : data.financialCases.map(issue => <article className="ops-ticket ops-ticket--review" key={issue.id}>
            <div className="ticket-top"><span className="ticket-label">截止 {formatDateTime(issue.deadline)}</span><span className="tag tag--red">{issue.state}</span></div>
            <h3>{issue.category}</h3><p>关联记录：{issue.sourceRef}</p><p>处理人：{issue.owner}</p>
            <div className="report-actions"><button className="ops-button ops-button--secondary" type="button" onClick={() => void actions.onFinancialCase(issue.id, "claim")}>认领</button>
              {actions.role === "SUPER_ADMIN" ? <button className="ops-button ops-button--primary" type="button" onClick={() => void actions.onFinancialCase(issue.id, "resolve")}>证据复核结案</button> : null}</div>
          </article>)}
        </div>
      </section>
    );
  }

  if (activeTab === "reports") {
    return (
      <section className="ops-content">
        <SectionHeader title="活动反馈处理" subtitle="仅运营查看原文；处理结果会写入审计小票。" stamp="CARE" />
        <div className="ticket-list">
          {data.reports.map((report) => <ReportTicket key={report.id} report={report} onResolveReport={actions.onResolveReport} />)}
        </div>
      </section>
    );
  }

  if (activeTab === "blacklist") {
    return (
      <section className="ops-content">
        <SectionHeader title="黑名单管理" subtitle="限制后续报名；既有订单保持不变，解除仅限超级管理员通过受控接口处理。" stamp="GUARD" />
        <BlacklistPanel entries={data.blacklist} onAddBlacklistEntry={actions.onAddBlacklistEntry} onRemoveBlacklistEntry={actions.onRemoveBlacklistEntry} canRemove={actions.role === "SUPER_ADMIN"} />
      </section>
    );
  }

  if (activeTab === "reviews") {
    return (
      <section className="ops-content">
        <SectionHeader title="体验评价" subtitle="仅用于运营复盘，不对外公开展示，也不会自动触发处罚。" stamp="REVIEW" />
        <div className="ticket-list">
          {data.reviews.length === 0 ? <p className="ops-loading">当前没有体验评价。</p> : data.reviews.map((review) => <ReviewTicket key={review.id} review={review} />)}
        </div>
      </section>
    );
  }

  return (
    <section className="ops-content">
      <SectionHeader title="审计小票" subtitle="高风险操作以时间线记录，方便外部总控复核。" stamp="AUDIT" />
      <ol className="audit-timeline">
        {data.auditLogs.map((item) => (
          <li className="audit-ticket" key={item.id}>
            <span className="ticket-label">{formatDateTime(item.createdAt)}</span>
            <strong>{item.action}</strong>
            <span>
              {item.targetType} / {item.reason ?? "无原因"}
            </span>
            <small>{item.targetId}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReviewTicket({ review }: { review: OpsReview }): JSX.Element {
  return (
    <article className="ops-ticket">
      <div className="ticket-top">
        <span className="ticket-label">{formatDateTime(review.updatedAt)}</span>
        <span className="tag tag--orange">{review.score} / 5</span>
      </div>
      <h3>{review.order.activityTitle}</h3>
      <p>订单 {review.order.id}</p>
      {review.tags.length > 0 ? <p>{review.tags.join(" · ")}</p> : null}
      {review.content ? <div className="report-content">{review.content}</div> : <p className="muted">未填写文字建议</p>}
    </article>
  );
}

function BlacklistPanel({
  entries,
  onAddBlacklistEntry,
  onRemoveBlacklistEntry,
  canRemove,
}: {
  entries: OpsBlacklistEntry[];
  onAddBlacklistEntry: (userId: string, reason: string) => Promise<void>;
  onRemoveBlacklistEntry: (userId: string) => Promise<void>;
  canRemove: boolean;
}): JSX.Element {
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    try {
      setBusy(true);
      await onAddBlacklistEntry(userId.trim(), reason.trim());
      setUserId("");
      setReason("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="blacklist-panel">
      <div className="blacklist-form">
        <p>仅输入已核验的内部用户 ID；列表仅展示脱敏手机号。</p>
        <div className="report-actions">
          <input aria-label="内部用户 ID" className="report-reason" value={userId} maxLength={80} onChange={(event) => setUserId(event.target.value)} placeholder="内部用户 ID" />
          <input aria-label="拉黑原因" className="report-reason" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="填写运营处理原因" />
          <button className="ops-button ops-button--primary" disabled={busy || !userId.trim() || !reason.trim()} type="button" onClick={() => void submit()}>
            {busy ? "处理中…" : "添加黑名单"}
          </button>
        </div>
      </div>
      <div className="ticket-list">
        {entries.length === 0 ? <p className="ops-loading">当前没有黑名单记录。</p> : entries.map((entry) => (
          <article className="ops-ticket ops-ticket--review" key={entry.id}>
            <div className="ticket-top">
              <span className="ticket-label">{formatDateTime(entry.createdAt)}</span>
              <span className="tag tag--red">{entry.user.status}</span>
            </div>
            <h3>{entry.user.phone ?? "未绑定手机号"}</h3>
            <p>{entry.reason}</p>
            <div className="ticket-divider" />
            <small>内部用户 ID：{entry.userId}</small>
            {canRemove ? <button className="ops-button ops-button--secondary" type="button" onClick={() => void onRemoveBlacklistEntry(entry.userId)}>解除黑名单</button> : null}
          </article>
        ))}
      </div>
    </div>
  );
}

function ReportTicket({ report, onResolveReport }: { report: OpsReport; onResolveReport: (reportId: string, status: "RESOLVED" | "REJECTED", reason: string) => Promise<void> }): JSX.Element {
  const [reason, setReason] = useState("");
  const isOpen = report.status === "OPEN";

  return (
    <article className={isOpen ? "ops-ticket ops-ticket--review" : "ops-ticket"}>
      <div className="ticket-top">
        <span className="ticket-label">{formatDateTime(report.createdAt)}</span>
        <span className={isOpen ? "tag tag--red" : "tag"}>{report.status}</span>
      </div>
      <h3>{report.type}</h3>
      <p>{report.order.activityTitle} · 订单 {report.order.id}</p>
      <div className="report-content">{report.content}</div>
      {isOpen ? (
        <div className="report-actions">
          <input aria-label="处理说明" className="report-reason" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="填写处理说明" />
          <button className="ops-button ops-button--primary" disabled={!reason.trim()} type="button" onClick={() => void onResolveReport(report.id, "RESOLVED", reason)}>标记已处理</button>
          <button className="ops-button ops-button--secondary" disabled={!reason.trim()} type="button" onClick={() => void onResolveReport(report.id, "REJECTED", reason)}>不予受理</button>
        </div>
      ) : null}
    </article>
  );
}

function SectionHeader({ title, subtitle, stamp }: { title: string; subtitle: string; stamp: string }): JSX.Element {
  return (
    <header className="section-header">
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <span className="stamp">{stamp}</span>
    </header>
  );
}

function RestaurantTicket({ restaurant }: { restaurant: OpsRestaurant }): JSX.Element {
  return (
    <article className="ops-ticket">
      <div className="ticket-top">
        <span className="ticket-label">RESTAURANT</span>
        <span className="tag tag--green">可排期</span>
      </div>
      <h3>{restaurant.name}</h3>
      <p>
        {restaurant.district} · {restaurant.businessArea}
      </p>
      <div className="ticket-divider" />
      <div className="ticket-facts">
        <span>容量</span>
        <strong>{restaurant.capacity} 人</strong>
      </div>
    </article>
  );
}

function RestaurantManager({ token, restaurants, onSaved }: { token: string; restaurants: OpsRestaurant[]; onSaved: () => Promise<void> }): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const selected = restaurants.find(r => r.id === editingId);
  return <div>
    <div className="report-actions"><button type="button" className="ops-button ops-button--secondary" onClick={() => setEditingId(null)}>新增餐厅</button>
      {restaurants.map(r => <button type="button" className="ops-button ops-button--secondary" key={r.id} onClick={() => setEditingId(r.id)}>编辑 {r.name}</button>)}
    </div>
    <RestaurantForm token={token} restaurant={selected} onSaved={onSaved} />
  </div>;
}

function ActivityTicket({
  activity,
  onOpenGrouping,
  onStartActivity,
  onCompleteActivity,
  onCancelActivity,
  canCancel,
  onPublishActivity,
  onOpenRegistration,
  lifecycleBusy,
}: {
  activity: OpsActivity;
  onOpenGrouping: (activityId: string) => Promise<void>;
  onStartActivity: (activityId: string) => Promise<void>;
  onCompleteActivity: (activityId: string) => Promise<void>;
  onCancelActivity: (activityId: string) => Promise<void>;
  canCancel: boolean;
  onPublishActivity: (activityId: string) => Promise<void>;
  onOpenRegistration: (activityId: string) => Promise<void>;
  lifecycleBusy: boolean;
}): JSX.Element {
  const now = Date.now();
  const canStart = (activity.status === "GROUPED" || activity.status === "ADDRESS_UNLOCKED") && now >= new Date(activity.startsAt).getTime();
  const canComplete = activity.status === "IN_PROGRESS" && now >= new Date(activity.endsAt).getTime();
  return (
    <article className="ops-ticket ops-ticket--wide">
      <div className="ticket-top">
        <span className="ticket-label">{formatDateTime(activity.startsAt)}</span>
        <span className="tag tag--orange">{activity.status}</span>
      </div>
      <h3>{activity.title}</h3>
      <p>菜单体验 / 公共餐厅 / 服务费 {formatMoney(activity.serviceFeeCents)}</p>
      <p>已占 {activity.heldSeats} / {activity.capacity} 席</p>
      <div className="ticket-divider" />
      <div className="ticket-facts">
        <span>服务费/订位费</span>
        <strong>{formatMoney(activity.serviceFeeCents)}</strong>
        <button className="ops-button ops-button--secondary" type="button" onClick={() => void onOpenGrouping(activity.id)}>
          排桌候选
        </button>
        {activity.status === "DRAFT" ? <button className="ops-button ops-button--primary" disabled={lifecycleBusy} type="button" onClick={() => void onPublishActivity(activity.id)}>发布活动</button> : null}
        {activity.status === "PUBLISHED" ? <button className="ops-button ops-button--primary" disabled={lifecycleBusy} type="button" onClick={() => void onOpenRegistration(activity.id)}>开放报名</button> : null}
        {canStart ? <button className="ops-button ops-button--primary" disabled={lifecycleBusy} type="button" onClick={() => void onStartActivity(activity.id)}>{lifecycleBusy ? "处理中…" : "标记已开始"}</button> : null}
        {canComplete ? <button className="ops-button ops-button--primary" disabled={lifecycleBusy} type="button" onClick={() => void onCompleteActivity(activity.id)}>{lifecycleBusy ? "处理中…" : "标记已完成"}</button> : null}
        {canCancel && now < new Date(activity.startsAt).getTime() && !["CANCELED", "COMPLETED", "IN_PROGRESS"].includes(activity.status)
          ? <button className="ops-button ops-button--secondary" disabled={lifecycleBusy} type="button" onClick={() => void onCancelActivity(activity.id)}>取消活动</button> : null}
      </div>
    </article>
  );
}

function GroupingPanel({
  activity,
  candidates,
  tableGroups,
  busy,
  onDraft,
  onConfirm,
  onAdjust,
  onMarkGroupFailed,
}: {
  activity: OpsActivity | null;
  candidates: OpsTableCandidate[] | null;
  tableGroups: OpsTableGroup[];
  busy: boolean;
  onDraft: (activityId: string) => Promise<void>;
  onConfirm: (activityId: string) => Promise<void>;
  onAdjust: (activityId: string, tableGroups: Array<{ orderIds: string[] }>) => Promise<void>;
  onMarkGroupFailed: (activityId: string, reason: string) => Promise<void>;
}): JSX.Element {
  const [failureReason, setFailureReason] = useState("");
  const [adjustmentText, setAdjustmentText] = useState("");
  useEffect(() => {
    setAdjustmentText(tableGroups.map((group) => group.orderIds.join(", ")).join("\n"));
  }, [tableGroups]);
  if (!activity) {
    return <p className="ops-alert">活动状态已刷新，请重新选择排桌候选。</p>;
  }
  const canDraft = activity.status === "REGISTRATION_OPEN" || activity.status === "LOCKING";
  const canConfirm = activity.status === "LOCKING" && tableGroups.length > 0;
  const canMarkGroupFailed = (activity.status === "REGISTRATION_OPEN" || activity.status === "LOCKING")
    && candidates !== null
    && candidates.length < activity.minSize
    && Date.now() >= new Date(activity.registrationEndsAt).getTime();

  return (
    <section className="grouping-panel" aria-label="规则排桌操作区">
      <SectionHeader title="规则排桌" subtitle="先预览已支付候选人，再生成草案；最终仍需运营人工确认。" stamp="TABLE" />
      <div className="grouping-summary">
        <span>候选人数</span>
        <strong>{candidates?.length ?? "加载中"}</strong>
        <span>活动状态：{activity.status}</span>
      </div>
      <div className="candidate-list">
        {candidates?.map((candidate) => (
          <article className="candidate-card" key={candidate.order.id}>
            <strong>{candidate.order.id}</strong>
            {candidate.profile ? (
              <span>{formatCandidateProfile(candidate.profile)}</span>
            ) : (
              <span>未填写问卷</span>
            )}
          </article>
        ))}
      </div>
      {tableGroups.length > 0 ? (
        <div className="grouping-draft">
          <strong>草案已生成：{tableGroups.map((group) => `${group.orderIds.length} 人`).join(" + ")}</strong>
          <span>待人工确认后才会更新成团状态。</span>
          <label className="group-adjustment-label" htmlFor="table-group-adjustment">人工调整（每行一桌，以逗号分隔订单号）</label>
          <textarea
            aria-label="人工调整桌位"
            className="group-adjustment-input"
            id="table-group-adjustment"
            value={adjustmentText}
            onChange={(event) => setAdjustmentText(event.target.value)}
          />
          <button
            className="ops-button ops-button--secondary"
            disabled={busy}
            type="button"
            onClick={() => {
              const adjustedGroups = adjustmentText
                .split("\n")
                .map((line) => ({ orderIds: line.split(",").map((orderId) => orderId.trim()).filter(Boolean) }))
                .filter((group) => group.orderIds.length > 0);
              void onAdjust(activity.id, adjustedGroups);
            }}
          >
            保存人工调整
          </button>
        </div>
      ) : null}
      <div className="grouping-actions">
        <button className="ops-button ops-button--secondary" disabled={!canDraft || busy} type="button" onClick={() => void onDraft(activity.id)}>
          {busy ? "处理中…" : "生成规则草案"}
        </button>
        <button className="ops-button ops-button--primary" disabled={!canConfirm || busy} type="button" onClick={() => void onConfirm(activity.id)}>
          人工确认成团
        </button>
      </div>
      {canMarkGroupFailed ? (
        <div className="group-failure-panel">
          <strong>报名已截止，当前人数不足 {activity.minSize} 人</strong>
          <span>标记后按每笔实收建立退款责任，由后台任务恢复处理。</span>
          <div className="report-actions">
            <input aria-label="成团失败原因" className="report-reason" value={failureReason} maxLength={200} onChange={(event) => setFailureReason(event.target.value)} placeholder="填写人工处置原因" />
            <button className="ops-button ops-button--secondary" disabled={!failureReason.trim() || busy} type="button" onClick={() => void onMarkGroupFailed(activity.id, failureReason)}>
              标记成团失败
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OrderTicket({ order }: { order: OpsOrder }): JSX.Element {
  return (
    <article className="ops-ticket ops-ticket--wide">
      <div className="ticket-top">
        <span className="ticket-label">{order.id}</span>
        <span className="tag">{order.status}</span>
      </div>
      <h3>{order.activity.title}</h3>
      <p>用户手机号：{order.user.phone ?? "未展示"}</p>
      <p>渠道实收：{formatMoney(order.receivedCents)} · 收款流水 {order.receiptCount} 笔 · 未结异常 {order.openCaseCount} 项</p>
      <div className="ticket-divider" />
      <div className="ticket-facts">
        <span>订单金额</span>
        <strong>{formatMoney(order.amountCents)}</strong>
      </div>
    </article>
  );
}

function RefundTicket({
  refund,
  onApproveRefund,
  onRejectRefund,
}: {
  refund: OpsRefund;
  onApproveRefund: (refundId: string) => Promise<void>;
  onRejectRefund: (refundId: string) => Promise<void>;
}): JSX.Element {
  const canApprove = refund.status === "REVIEWING" || refund.status === "FAILED";

  return (
    <article className={canApprove ? "ops-ticket ops-ticket--review" : "ops-ticket"}>
      <div className="ticket-top">
        <span className="ticket-label">{refund.id}</span>
        <span className={canApprove ? "tag tag--red" : "tag"}>{refund.status}</span>
      </div>
      <h3>{refund.order.activityTitle}</h3>
      <p>{refund.reason}</p>
      <div className="ticket-divider" />
      <div className="ticket-facts">
        <span>{formatMoney(refund.amountCents)}</span>
        {canApprove ? (
          <><button className="ops-button ops-button--primary" type="button" onClick={() => void onApproveRefund(refund.id)}>审批通过</button>
          {refund.status === "REVIEWING" ? <button className="ops-button ops-button--secondary" type="button" onClick={() => void onRejectRefund(refund.id)}>审核拒绝</button> : null}</>
        ) : (
          <strong>{refund.order.status}</strong>
        )}
      </div>
    </article>
  );
}

function formatMoney(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
