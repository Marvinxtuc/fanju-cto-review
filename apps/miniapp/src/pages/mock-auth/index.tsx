import { useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import { navigateBack } from "@tarojs/taro";

import {
  bindPhoneWithWechatCode,
  ensureMockUser,
  demoModeEnabled,
  loginWithWechatProvider,
  initializeAvailableV11Identity,
} from "../../api";
import { formatClientError } from "./client-error";

export default function MockAuthPage(): JSX.Element {
  const [message, setMessage] = useState("未登录");

  async function handleLogin(): Promise<void> {
    try {
      await ensureMockUser();
      setMessage("Mock 登录和手机号已完成");
    } catch (error) {
      setMessage(formatClientError(error, "Mock 登录失败"));
    }
  }

  async function handleWechatLogin(): Promise<void> {
    try {
      const authToken = await loginWithWechatProvider();
      await initializeAvailableV11Identity(authToken);
      setMessage("微信登录已完成");
    } catch (error) {
      setMessage(formatClientError(error, "微信登录失败"));
    }
  }

  async function handlePhoneAuth(event: unknown): Promise<void> {
    const detail = (event as { detail?: { code?: string; errMsg?: string } }).detail;
    if (!detail?.code) {
      setMessage(detail?.errMsg ? `手机号授权失败：${detail.errMsg}` : "手机号授权失败");
      return;
    }
    try {
      await bindPhoneWithWechatCode(detail.code);
      setMessage("手机号授权已完成");
    } catch (error) {
      setMessage(formatClientError(error, "手机号授权失败"));
    }
  }

  return (
    <View className="page page-mock-auth">
      <View className="detail-header">
        <Text className="eyebrow">账号授权</Text>
        <Text className="title">身份小票</Text>
        <Text className="summary">登录并授权手机号后，可继续填写报名资料。</Text>
      </View>

      <View className="detail-block">
        <Text className="block-title">授权状态</Text>
        <Text className="stamp stamp--green">{message}</Text>
      </View>

      <View className="action-bar">
        {demoModeEnabled ? <Button className="button-primary" onClick={() => void handleLogin()}>
          本地演示登录
        </Button> : null}
        <Button className="button-secondary" onClick={() => void handleWechatLogin()}>
          微信登录
        </Button>
        <Button
          className="button-secondary"
          openType="getPhoneNumber|agreePrivacyAuthorization"
          onGetPhoneNumber={(event) => void handlePhoneAuth(event)}
        >
          手机号授权
        </Button>
        <Button className="button-quiet" onClick={() => navigateBack()}>
          返回报名页
        </Button>
      </View>
    </View>
  );
}
