import { useRef, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import { navigateTo, useDidShow, useDidHide, useRouter } from "@tarojs/taro";
import { listOrders, type OrderSummary } from "../../api";
import { orderStatusLabel } from "../../order-status";
import {formalBusinessEnabled} from '../../api';
import {FormalOrderList} from '../../FormalOrderDetail';
import {LegacyOrderHistory} from '../../LegacyOrderHistory';

export default function OrderListPage():JSX.Element{const history=useRouter().params.history;return formalBusinessEnabled?(history==='legacy'?<LegacyOrderHistory/>:<FormalOrderList/>):<LegacyOrderListPage/>;}
function LegacyOrderListPage(): JSX.Element {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  useDidShow(() => { generation.current++; pending.current = false; setOrders([]); setCursor(null); void load(); });
  useDidHide(() => { generation.current++; pending.current = false; setOrders([]); setCursor(null); });
  async function load(next?: string): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    const current = generation.current;
    setBusy(true); setError("");
    try {
      const result = await listOrders(next);
      if (generation.current !== current) return;
      setOrders(previous => next ? [...previous, ...result.orders] : result.orders);
      setCursor(result.nextCursor);
    } catch (cause) {
      if (generation.current !== current) return;
      setOrders([]); setCursor(null);
      setError(cause instanceof Error ? cause.message : "订单加载失败");
    } finally {
      if (generation.current === current) { pending.current = false; setBusy(false); }
    }
  }
  return <View className="page">
    <Text className="title">我的订单</Text>
    <Text className="summary">登录后可找回历史报名和退款进度。</Text>
    {error ? <Text className="error-text">{error}</Text> : null}
    <Button disabled={busy} onClick={() => void load()}>刷新订单</Button>
    <Button onClick={() => navigateTo({ url: "/pages/mock-auth/index" })}>登录与授权</Button>
    <Button onClick={() => navigateTo({ url: "/pages/inbox/index" })}>站内通知</Button>
    {!busy && !error && !orders.length ? <Text>暂无订单</Text> : null}
    {orders.map(order => <View className="ticket-card" key={order.id}>
      <Text className="block-title">{order.activity.title}</Text>
      <Text>{orderStatusLabel(order.status)} · 服务费 ¥{(order.amountCents / 100).toFixed(2)}</Text>
      <Text className="muted">{order.activity.startsAt}</Text>
      <Button onClick={() => navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(order.id)}` })}>查看订单</Button>
    </View>)}
    {cursor ? <Button disabled={busy} onClick={() => void load(cursor)}>加载更多</Button> : null}
  </View>;
}
