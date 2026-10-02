import { useRef, useState } from "react";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import { navigateTo, useRouter, useDidShow, useDidHide } from "@tarojs/taro";

import { getOrderPage, continueOrderPayment, requestOrderCancel, submitOrderReport, submitOrderReview, type InboxNotification, type OrderDetail } from "../../api";

import { orderStatusLabel } from "../../order-status";
import {formalBusinessEnabled} from '../../api';
import {FormalOrderDetail} from '../../FormalOrderDetail';
import {LegacyOrderHistory} from '../../LegacyOrderHistory';

export default function OrderDetailPage():JSX.Element{const history=useRouter().params.history;return formalBusinessEnabled?(history==='legacy'?<LegacyOrderHistory/>:<FormalOrderDetail/>):<LegacyOrderDetailPage/>;}
function LegacyOrderDetailPage(): JSX.Element {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [notificationUnavailable, setNotificationUnavailable] = useState(false);
  const [error, setError] = useState("");
  const [reportType, setReportType] = useState("现场异常");
  const [reportContent, setReportContent] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reviewScore, setReviewScore] = useState("5");
  const [reviewTags, setReviewTags] = useState("");
  const [reviewContent, setReviewContent] = useState("");
  const [reviewMessage, setReviewMessage] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);

  const orderId = useRouter().params.id;
  const generation = useRef(0);
  const loadSequence = useRef(0);
  const actionPending = useRef(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  useDidShow(() => {
    generation.current++; actionPending.current = false;
    setOrder(null); setNotifications([]); setActionBusy(false); setReviewBusy(false); setReportBusy(false);
    setActionMessage(""); setReviewMessage(""); setReportMessage("");
    void load();
  });
  useDidHide(() => { generation.current++; loadSequence.current++; setOrder(null); setNotifications([]); });

  async function load(): Promise<void> {
    const current = generation.current;
    const sequence = ++loadSequence.current;
    try {
      setError("");
      const result = await getOrderPage(orderId);
      if (current !== generation.current || sequence !== loadSequence.current) return;
      setOrder(result.order); setNotifications(result.notifications.filter(notification => notification.orderId === result.order.id));
      setNotificationUnavailable(result.notificationUnavailable);
    } catch (loadError) {
      if (current !== generation.current || sequence !== loadSequence.current) return;
      setOrder(null); setNotifications([]);
      setError(loadError instanceof Error ? loadError.message : "订单详情加载失败");
    }
  }

  async function act(kind: "pay" | "cancel"): Promise<void> {
    if (!order || actionPending.current) return;
    const current = generation.current;
    actionPending.current = true; setActionBusy(true); setError(""); setActionMessage("");
    try {
      const message = kind === "pay" ? await continueOrderPayment(order.id)
        : (await requestOrderCancel(order.id, cancelReason), "取消申请已受理，退款仍需审核与处理，请查看下方进度");
      if (current !== generation.current) return;
      setActionMessage(message);
      await load();
    } catch (cause) {
      if (current !== generation.current) return;
      await load();
      if (current !== generation.current) return;
      setError(kind === "pay" ? "付款未完成或结果待确认，订单已保留，可刷新后继续。" : cause instanceof Error ? cause.message : "取消申请失败");
    } finally {
      if (current === generation.current) { actionPending.current = false; setActionBusy(false); }
    }
  }

  async function submitReview(): Promise<void> {
    if (!order) return;
    const current = generation.current;
    try {
      setError("");
      setReviewMessage("");
      setReviewBusy(true);
      const score = Number(reviewScore);
      const tags = reviewTags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
      const review = await submitOrderReview(order.id, score, tags, reviewContent);
      if (current !== generation.current) return;
      setReviewMessage(`已保存 ${review.score} 分评价，仅供运营改进体验。`);
    } catch (submitError) {
      if (current !== generation.current) return;
      setOrder(null); setNotifications([]);
      setError(submitError instanceof Error ? submitError.message : "提交评价失败");
    } finally {
      if (current === generation.current) setReviewBusy(false);
    }
  }

  async function submitReport(): Promise<void> {
    if (!order) return;
    const current = generation.current;
    try {
      setError("");
      setReportMessage("");
      setReportBusy(true);
      const report = await submitOrderReport(order.id, reportType, reportContent);
      if (current !== generation.current) return;
      setReportContent("");
      setReportMessage(`已提交，编号 ${report.id}，等待运营处理。`);
    } catch (submitError) {
      if (current !== generation.current) return;
      setOrder(null); setNotifications([]);
      setError(submitError instanceof Error ? submitError.message : "提交反馈失败");
    } finally {
      if (current === generation.current) setReportBusy(false);
    }
  }

  const canReport = Boolean(order && Date.now() >= new Date(order.activity.endsAt).getTime());
  const canReview = order?.status === "COMPLETED";

  return (
    <View className="page page-order-detail">
      <View className="detail-header">
        <Text className="eyebrow">到店小票</Text>
        <Text className="title">{order ? "饭局已入票" : "暂无饭票"}</Text>
        <Text className="summary">查看报名、付款与活动安排，餐费到店自理。</Text>
      </View>

      {error ? <Text className="error-text">错误：{error}</Text> : null}

      <Button disabled={actionBusy} onClick={() => void load()}>刷新订单</Button>
      <Button onClick={() => navigateTo({ url: "/pages/order-list/index" })}>全部订单</Button>
      <Button onClick={() => navigateTo({ url: "/pages/mock-auth/index" })}>重新登录与授权</Button>
      {actionMessage ? <Text className="summary">{actionMessage}</Text> : null}
      {order?.paymentState === "REQUIRES_REVIEW" ? <Text>付款状态待核查，请联系运营。</Text> : null}
      {order?.paymentState === "PROCESSING" ? <Text>付款结果处理中，请以刷新后的订单状态为准。</Text> : null}
      {order?.status === "PENDING_PAYMENT" ? <Button disabled={actionBusy || order.paymentState === "REQUIRES_REVIEW"} onClick={() => void act("pay")}>继续付款</Button> : null}
      {order?.canRequestCancel ? <View className="detail-block">
        <Input value={cancelReason} maxlength={200} onInput={event => setCancelReason(event.detail.value)} placeholder="请填写取消原因" />
        <Button disabled={actionBusy || !cancelReason.trim()} onClick={() => void act("cancel")}>
          {order.status === "PENDING_PAYMENT" ? "取消待付报名" : "申请取消与退款"}
        </Button>
      </View> : null}
      {order?.refunds.map(refund => <View key={refund.id} className="detail-block">
        <Text>退款 ¥{(refund.amountCents / 100).toFixed(2)} · {refund.requiresReview ? "待人工核查" : orderStatusLabel(refund.status)}</Text>
        <Text className="muted">{refund.updatedAt}</Text>
      </View>)}

      <View className="ticket-card">
        <View className="ticket-row">
          <View>
            <Text className="ticket-label">ORDER</Text>
            <Text className="meal-card__title">{order?.id ?? "暂无订单"}</Text>
          </View>
          <Text className="stamp stamp--green">{order ? orderStatusLabel(order.status) : "-"}</Text>
        </View>
        <View className="ticket-divider" />
        <Text className="muted">服务费/订位费</Text>
        <Text className="amount">{order ? `¥${order.amountCents / 100}` : "-"}</Text>
        <Text className="muted">餐费到店自理</Text>
      </View>

      <View className="detail-block">
        <Text className="block-title">解锁信息</Text>
        <View className="menu-line">
          <Text>饭局</Text>
          <Text className="muted">{order?.activity.title ?? "-"}</Text>
        </View>
        <View className="menu-line">
          <Text>商户</Text>
          <Text className="muted">{order?.activity.restaurantName ?? "成团后展示"}</Text>
        </View>
        <View className="menu-line">
          <Text>地址</Text>
          <Text className="muted">{order?.activity.address ?? "活动前 24 小时展示"}</Text>
        </View>
      </View>

      <View className="detail-block">
        <Text className="block-title">取消规则</Text>
        <Text className="summary">取消申请需审核；申请受理不代表退款完成，请以订单中的退款进度为准。</Text>
      </View>

      <View className="detail-block">
        <Text className="block-title">活动反馈</Text>
        <Text className="summary">活动结束后 7 天内可提交，内容仅供运营处理，不会公开展示。</Text>
        {canReport ? (
          <>
            <Input className="report-input" value={reportType} maxlength={40} onInput={(event) => setReportType(event.detail.value)} placeholder="反馈类型" />
            <Textarea className="report-textarea" value={reportContent} maxlength={1000} onInput={(event) => setReportContent(event.detail.value)} placeholder="请描述需要运营跟进的情况" />
            {reportMessage ? <Text className="success-text">{reportMessage}</Text> : null}
            <Button className="button-secondary" disabled={!reportType.trim() || !reportContent.trim() || reportBusy} onClick={() => void submitReport()}>
              {reportBusy ? "提交中…" : "提交反馈"}
            </Button>
          </>
        ) : <Text className="muted">活动结束后将开放反馈入口。</Text>}
      </View>

      <View className="detail-block">
        <Text className="block-title">体验评价</Text>
        <Text className="summary">仅已完成的订单可评价；评价不公开展示，可再次提交更新内容。</Text>
        {canReview ? (
          <>
            <Input className="report-input" value={reviewScore} type="number" maxlength={1} onInput={(event) => setReviewScore(event.detail.value)} placeholder="1 至 5 分" />
            <Input className="report-input" value={reviewTags} maxlength={200} onInput={(event) => setReviewTags(event.detail.value)} placeholder="标签用逗号分隔，例如：菜品、氛围" />
            <Textarea className="report-textarea" value={reviewContent} maxlength={1000} onInput={(event) => setReviewContent(event.detail.value)} placeholder="可选：写下体验建议" />
            {reviewMessage ? <Text className="success-text">{reviewMessage}</Text> : null}
            <Button className="button-secondary" disabled={reviewBusy || !/^[1-5]$/.test(reviewScore)} onClick={() => void submitReview()}>
              {reviewBusy ? "保存中…" : "保存评价"}
            </Button>
          </>
        ) : <Text className="muted">活动完成后将开放评价入口。</Text>}
      </View>

      <View className="detail-block">
        <Text className="block-title">站内通知</Text>
        <Button className="button-secondary" onClick={() => navigateTo({ url: "/pages/inbox/index" })}>查看全部通知</Button>
        {notifications.length > 0 ? notifications.map((notification) => (
          <View className="notification-card" key={notification.id}>
            <Text className="notification-card__title">{notification.payload?.title ?? "活动状态更新"}</Text>
            <Text className="muted">{notification.payload?.message ?? "请留意订单状态。"}</Text>
          </View>
        )) : <Text className="muted">{notificationUnavailable ? "通知暂时不可用，可稍后刷新；订单状态不受影响。" : "当前没有新的站内通知。"}</Text>}
      </View>

      <View className="action-bar">
        <Button className="button-primary" onClick={() => void load()}>
          刷新饭票
        </Button>
        <Button className="button-secondary" onClick={() => navigateTo({ url: "/pages/home/index" })}>
          返回饭局列表
        </Button>
      </View>
    </View>
  );
}
