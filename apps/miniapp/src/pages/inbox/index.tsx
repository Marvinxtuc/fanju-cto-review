import { useRef, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import { navigateTo, useDidHide, useDidShow } from "@tarojs/taro";
import { getNotificationPage, getOrder, markNotificationRead, type InboxNotification } from "../../api";

export default function InboxPage(): JSX.Element {
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const pending = useRef(false);
  useDidShow(() => { generation.current++; pending.current = false; setItems([]); setCursor(null); void load(); });
  useDidHide(() => { generation.current++; pending.current = false; setItems([]); setCursor(null); });

  async function load(next?: string): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    const current = generation.current;
    setBusy(true); setError("");
    try {
      const page = await getNotificationPage(next);
      if (current !== generation.current) return;
      setItems(previous => next ? [...previous, ...page.notifications] : page.notifications);
      setCursor(page.nextCursor);
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "通知加载失败");
    } finally {
      if (current === generation.current) { pending.current = false; setBusy(false); }
    }
  }

  async function open(item: InboxNotification): Promise<void> {
    const current = generation.current;
    setError("");
    try {
      if (item.orderId) await getOrder(item.orderId);
      await markNotificationRead(item.id);
      if (current !== generation.current) return;
      setItems(previous => previous.map(row => row.id === item.id ? { ...row, readAt: row.readAt ?? new Date().toISOString() } : row));
      if (item.orderId) await navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(item.orderId)}` });
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "通知打开失败");
    }
  }

  return <View className="page">
    <Text className="title">站内通知</Text>
    <Text className="summary">通知仅提示进度，订单详情以实时查询为准。</Text>
    {error ? <Text className="error-text">{error}</Text> : null}
    <Button disabled={busy} onClick={() => void load()}>刷新通知</Button>
    {!busy && !items.length && !error ? <Text>暂无通知</Text> : null}
    {items.map(item => <View className="notification-card" key={item.id}>
      <Text className="notification-card__title">{item.readAt ? "" : "未读 · "}{item.payload?.title ?? "活动状态更新"}</Text>
      <Text className="muted">{item.payload?.message ?? "请查看订单状态。"}</Text>
      <Button onClick={() => void open(item)}>{item.orderId ? "查看订单" : item.readAt ? "已读" : "标为已读"}</Button>
    </View>)}
    {cursor ? <Button disabled={busy} onClick={() => void load(cursor)}>加载更多</Button> : null}
  </View>;
}
