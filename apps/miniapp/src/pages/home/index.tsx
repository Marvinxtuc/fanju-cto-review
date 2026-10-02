import { useEffect, useRef, useState } from "react";
import { Button, ScrollView, Text, View } from "@tarojs/components";
import { navigateTo } from "@tarojs/taro";

import { listActivityPage, type ActivitySummary, formalBusinessEnabled, type FormalOffer } from "../../api";
import { prelaunchEnabled } from "../../prelaunch-api";

const filters = ["今晚", "明天", "周末", "新店", "火锅", "日料", "Brunch", "低预算"];

export default function HomePage(): JSX.Element {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [error, setError] = useState("");const [unavailable,setUnavailable]=useState(0);const [cursor,setCursor]=useState<string|null>(null),[busy,setBusy]=useState(false);const epoch=useRef(0),pending=useRef(false);

  useEffect(() => {
    void load();return()=>{epoch.current++;};
  }, []);

  async function load(next?:string): Promise<void> {
    if(pending.current)return;pending.current=true;const generation=epoch.current;setBusy(true);
    try {setError('');const result=await listActivityPage(next);if(generation===epoch.current){setActivities(old=>next?[...old,...result.activities]:result.activities);setCursor(result.nextCursor);setUnavailable(old=>next?old+result.unavailableCount:result.unavailableCount);}}
    catch(loadError){if(generation===epoch.current)setError(loadError instanceof Error?loadError.message:'活动列表加载失败');}
    finally{if(generation===epoch.current){pending.current=false;setBusy(false);}}
  }

  function openFirstActivity(): void {
    const firstActivity = activities[0];
    if (!firstActivity) {
      setError("暂无可报名活动");
      return;
    }

    void navigateTo({ url: `/pages/activity-detail/index?id=${firstActivity.id}` });
  }

  return (
    <ScrollView className="page page-home" scrollY>
      <View className="brand-hero">
        <View className="brand-row">
          <View>
            <Text className="eyebrow">上海 · 城市菜单实验室</Text>
            <Text className="title">饭局</Text>
            <Text className="summary">把菜单滚一遍呀</Text>
          </View>
          <Text className="logo-mark">局</Text>
        </View>

        <View className="hero-actions">
          {formalBusinessEnabled&&<Button onClick={()=>navigateTo({url:"/pages/rights/index"})}>资料与账号权利请求</Button>}
          {prelaunchEnabled ? <Button onClick={() => navigateTo({ url: "/pages/prelaunch/index" })}>本地验收工作区</Button> : null}
          <Button className="button-secondary" onClick={() => navigateTo({ url: "/pages/order-list/index" })}>我的订单</Button>
          <Button className="button-secondary" onClick={() => navigateTo({ url: "/pages/money-records/index" })}>收款与退款记录</Button>
          <Button className="button-primary" onClick={openFirstActivity}>
            加入饭局
          </Button>
          <Button className="button-secondary" onClick={() => navigateTo({ url: "/pages/profile/index" })}>
            填写偏好
          </Button>
        </View>

        <View className="chip-row">
          {filters.map((filter, index) => (
            <Text className={index === 0 ? "chip chip--active" : "chip"} key={filter}>
              {filter}
            </Text>
          ))}
        </View>
      </View>

      <Button disabled={busy} onClick={()=>void load()}>刷新活动</Button>
      {unavailable>0&&<Text>有 {unavailable} 项活动暂不可报名，请稍后刷新。</Text>}
      {cursor&&<Button disabled={busy} onClick={()=>void load(cursor)}>下一页活动</Button>}
      {error ? <Text className="error-text">错误：{error}</Text> : null}

      <View className="section">
        <Text className="section-heading">活动列表</Text>
        {activities.map((activity) => (
          <View className="meal-card" key={activity.id}>
            <View className="meal-card__top">
              <View>
                <Text className="meal-card__time">{activity.startsAt}</Text>
                <Text className="meal-card__title">{activity.title}</Text>
              </View>
            </View>
            <Text className="meal-card__meta">
              {activity.district} · {activity.businessArea}
            </Text>
            <Text className="meal-card__menu">招牌菜 / 时令小食 / 到店菜单体验</Text>
            <View className="ticket-divider" />
            <View className="tag-row">
              <Text className="tag">公共餐厅</Text>
              <Text className="tag">服务费 F {activity.serviceFeeCents / 100} 元</Text>
              {formalBusinessEnabled&&<Text className="tag">保证金 D {(activity as FormalOffer).depositCents/100} 元；合计 {(activity as FormalOffer).totalCents/100} 元</Text>}
              <Text className="tag tag--red">{activity.status}</Text>
            </View>
            <Button
              className="button-primary activity-card__action"
              onClick={() => navigateTo({ url: `/pages/activity-detail/index?id=${activity.id}` })}
            >
              加入这一桌
            </Button>
          </View>
        ))}
      </View>

      <View className="section">
        <Text className="section-heading">本周新菜单</Text>
        <View className="meal-card">
          <Text className="ticket-label">MENU DROP</Text>
          <Text className="meal-card__title">上海小马路新店清单</Text>
          <Text className="meal-card__menu">把一桌饭当作一次城市菜单探索，成团后按规则解锁商户与地址。</Text>
        </View>
      </View>
    </ScrollView>
  );
}
