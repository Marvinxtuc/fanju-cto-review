import { useEffect, useState } from "react";
import { Button, Switch, Text, View } from "@tarojs/components";
import Taro, { navigateTo } from "@tarojs/taro";
import {FormalActivityDetail} from '../../FormalActivityDetail';
import {formalBusinessEnabled} from '../../api';

import {
  confirmAgreement,
  createAndPayOrder,
  getActivity,
  getCurrentAgreement,
  hasAuthenticatedSession,
  type ActivitySummary,
  type CurrentAgreement,
} from "../../api";

const checklist = ["确认活动时间", "阅读取消规则", "费用为服务费/订位费"];
const menuLines: Array<[string, string]> = [
  ["招牌菜单", "到店确认"],
  ["时令小食", "按餐厅供应"],
  ["结算方式", "餐费到店自理"],
];

export default function ActivityDetailPage():JSX.Element{return formalBusinessEnabled?<FormalActivityDetail/>:<LegacyActivityDetailPage/>;}
function LegacyActivityDetailPage(): JSX.Element {
  const activityId = Taro.getCurrentInstance().router?.params.id ?? "";
  const [activity, setActivity] = useState<ActivitySummary | null>(null);
  const [agreement, setAgreement] = useState<CurrentAgreement | null>(null);
  const [error, setError] = useState("");
  const [agreementAccepted, setAgreementAccepted] = useState(false);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        setError("");
        setAgreement(null);
        setAgreementAccepted(false);
        setActivity(await getActivity(activityId));
        setAgreement(await getCurrentAgreement());
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "活动详情加载失败");
      }
    }
    void load();
  }, [activityId]);

  async function handleCreateOrder(): Promise<void> {
    if (!agreement || !agreementAccepted) {
      setError("请先确认活动规则、退款规则、用户协议和隐私说明");
      return;
    }
    if (!hasAuthenticatedSession()) {
      setError("请先完成登录和手机号授权");
      await navigateTo({ url: "/pages/mock-auth/index" });
      return;
    }
    try {
      setError("");
      await confirmAgreement(agreement.version);
      const orderId = await createAndPayOrder(activityId, agreement.version);
      await navigateTo({ url: `/pages/order-detail/index?id=${encodeURIComponent(orderId)}` });
    } catch (orderError) {
      const message = orderError instanceof Error ? orderError.message : "报名或测试支付失败";
      if (message === "Phone binding required") {
        setError("请先完成手机号授权");
        await navigateTo({ url: "/pages/mock-auth/index" });
        return;
      }
      setError(message);
    }
  }

  return (
    <View className="page page-activity-detail">
      <View className="detail-header">
        <Text className="eyebrow">入局饭票</Text>
        <Text className="title">{activity?.title ?? "加载中"}</Text>
        <Text className="summary">饭局优先，安全优先。成团后按规则解锁商户与地址信息。</Text>
        <View className="detail-status">
          <Text className="muted">
            {activity?.district ?? "-"} · {activity?.businessArea ?? ""}
          </Text>
          <Text className="stamp">{activity?.status ?? "加载"}</Text>
        </View>
      </View>

      {error ? <Text className="error-text">错误：{error}</Text> : null}

      <View className="detail-block">
        <Text className="block-title">饭局信息</Text>
        <View className="info-grid">
          <View className="info-item">
            <Text className="info-item__label">时间</Text>
            <Text className="info-item__value">{activity?.startsAt ?? "-"}</Text>
          </View>
          <View className="info-item">
            <Text className="info-item__label">区域</Text>
            <Text className="info-item__value">
              {activity?.district ?? "-"} {activity?.businessArea ?? ""}
            </Text>
          </View>
          <View className="info-item">
            <Text className="info-item__label">服务费/订位费</Text>
            <Text className="info-item__value">{activity ? `${activity.serviceFeeCents / 100} 元` : "-"}</Text>
          </View>
          <View className="info-item">
            <Text className="info-item__label">餐费</Text>
            <Text className="info-item__value">到店自理</Text>
          </View>
        </View>
      </View>

      <View className="detail-block">
        <Text className="block-title">今晚菜单</Text>
        {menuLines.map(([name, note]) => (
          <View className="menu-line" key={name}>
            <Text>{name}</Text>
            <Text className="muted">{note}</Text>
          </View>
        ))}
      </View>

      <View className="detail-block">
        <Text className="block-title">报名前置确认</Text>
        {checklist.map((item) => (
          <Text className="check-row" key={item}>
            {item}
          </Text>
        ))}
        <View className="agreement-row">
          <Switch checked={agreementAccepted} disabled={!agreement} color="#ff6b2c" onChange={(event) => setAgreementAccepted(event.detail.value)} />
          <Text>我已阅读并同意当前协议（{agreement?.version ?? "未配置"}）</Text>
        </View>
        {agreement ? <Text className="summary">{agreement.text}</Text> : <Text className="error-text">协议暂不可用，无法报名</Text>}
      </View>

      <View className="safe-card">
        <Text className="safe-card__title">安全用餐说明</Text>
        <Text className="summary">所有饭局发生在公共餐厅；身份、订单和取消规则由平台流程约束。</Text>
      </View>

      <View className="action-bar">
        <Button className="button-secondary" onClick={() => navigateTo({ url: "/pages/mock-auth/index" })}>
          登录与手机号授权
        </Button>
        <Button className="button-secondary" onClick={() => navigateTo({ url: "/pages/profile/index" })}>
          填写饭局偏好问卷
        </Button>
        <Button className="button-primary" onClick={() => void handleCreateOrder()}>
          支付服务费，加入饭局
        </Button>
        <Button className="button-quiet" onClick={() => navigateTo({ url: "/pages/order-list/index" })}>
          查看饭票
        </Button>
      </View>
    </View>
  );
}
