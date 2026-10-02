# WeChat Integration Plan

## 状态

当前状态：M3.1.1-B 真实微信登录与手机号授权手工联调已通过。M3.2 已具备测试商户下单、退款申请与回调安全代码：支付与退款默认仍为 mock，且未发起真实扣款或退款。

## 排期优先级

支付与退款相关工作排在当前 MVP 其余功能之后。保留既有 mock 和本地测试覆盖，但暂停测试商户配置、安全注入、外部回调联调、网络请求和任何资金动作；只有其他已排期工作完成并获得新的明确授权后才恢复。

本文件定义微信能力接入边界。M3.1 已实现真实微信登录与手机号授权 provider 路径。M3.1.1-A 已完成联调准备与门禁固化；M3.1.1-B 已完成真实微信登录和手机号授权网络联调。M3.2 已实现测试商户所需的请求签名、签名验签、报文解密、金额核对和状态机回流；不开启生产支付或生产退款。本 repo 不提交真实 `.env`、secret、token、商户号、证书、APIv3 密钥、openid、session_key、手机号明文或真实用户数据。

## 目标

- 保留 M2-P0 已验证的 mock 登录、mock 手机号、mock 支付和 mock 退款状态机。
- 为 M3 真实微信能力接入预留 provider 边界。
- 确保真实微信支付和退款回调只能调用既有状态机 helper，不能直接写订单、支付或退款状态。
- 生产支付默认关闭，缺少真实商户号、证书或密钥时 real payment provider 必须拒绝启动。

## M3.1 Provider Interface

API 服务内 provider 分为：

- `AuthProvider`
  - `exchangeLoginCode({ code }) -> { provider, openid, unionid? }`
- `PhoneProvider`
  - `resolvePhone({ phone?, code? }) -> { provider, phone, phoneNumber, countryCode?, purePhoneNumber? }`
- `PaymentProvider`
  - `createPayment({ merchantOrderNo, amountCents, openid }) -> { channel, prepayId?, paymentParams? }`
  - `applySuccessCallback({ paymentId }) -> { channelTradeNo, callbackNonce }`
- `RefundProvider`
  - `createRefund({ merchantRefundNo, merchantOrderNo, amountCents }) -> { channel, channelRefundNo? }`
  - `applySuccessCallback({ refundId }) -> { channelRefundNo, callbackNonce }`
  - `applyFailureCallback({ refundId, reason }) -> { failureReason }`

provider 只处理外部通道边界和通道结果，不拥有订单状态机。订单、支付、退款状态写入仍由 API route 在校验 `canApplyPaymentSuccess`、`canApproveRefund`、`canApplyRefundCallback` 等 helper 后执行。

## Provider 边界

后续微信能力按 provider 分层：

- `AuthProvider`
  - mock：使用 `/api/mock/wechat-login`，生成本地测试 openid。
  - real：调用微信登录凭证校验接口，换取 openid/unionid。
- `PhoneProvider`
  - mock：使用 `/api/mock/phone`，写入测试手机号。
  - real：在用户主动授权后调用微信手机号能力，写入脱敏日志和必要字段。
- `PaymentProvider`
  - mock：创建本地 `Payment`，通过 `/api/mock/payments/:paymentId/succeed` 模拟成功回调。
  - real：调用微信支付下单接口，保存支付单和预支付信息。
- `RefundProvider`
  - mock：运营审核后创建退款中状态，通过 `/api/mock/refunds/:refundId/succeed|fail` 模拟回调。
  - real：调用微信退款申请接口，并等待微信退款回调。

mock provider 与 real provider 必须共享同一套订单、支付、退款状态机 helper。real provider 不得拥有绕过 helper 的直接写库路径。

M3.1 real provider 行为：

- `AUTH_PROVIDER=wechat`：需要 `WECHAT_MINIAPP_APP_ID`、`WECHAT_MINIAPP_APP_SECRET`，通过微信 `jscode2session` 换取 openid/unionid，不向业务层或前端返回 session_key。
- `PHONE_PROVIDER=wechat`：需要 `WECHAT_MINIAPP_APP_ID`、`WECHAT_MINIAPP_APP_SECRET`，通过微信 access_token 与手机号授权 code 换取手机号。
- `PAYMENT_PROVIDER=wechat`：需要完整微信支付配置，缺失时拒绝启动；请求时返回明确未实现错误。
- `REFUND_PROVIDER=wechat`：需要完整微信支付配置，缺失时拒绝启动；请求时返回明确未实现错误。
- real provider 不 fallback 到 mock，不 silent success，不直接写业务状态。

M3.1.1 真实身份联调行为：

- 真实 AppID/AppSecret 只能通过 shell 环境变量、部署平台 secret 或仓库外本地 secret 文件注入，不得写入 repo。
- 推荐仓库外本地 secret 文件路径为 `/Users/marvin.x/.config/fanju/wechat-identity.env`，且建议设置为 `chmod 600`。
- 小程序端触发真实 `wx.login` 后，API 使用 `WechatAuthProvider` 换取 openid/unionid。
- 小程序端触发手机号授权后，API 使用 `WechatPhoneProvider` 换取手机号。
- 用户拒绝授权、无效 code、provider 错误必须返回可理解错误。
- provider 失败不得创建脏用户，不得覆盖旧手机号。
- 日志不得输出 AppSecret、登录 code、手机号授权 code、session_key、access_token、手机号明文或完整微信响应。
- 手工联调检查表见 `docs/WECHAT_REAL_IDENTITY_QA.md`。
- M3.1.1-B 完成前，M3.2 微信支付/退款实现保持 blocked。

## 接入点

### 微信登录

- 接入点：用户端提交微信登录 code 到 API。
- API 职责：通过 `AuthProvider` 换取身份，创建或更新本地 `User`。
- 禁止：记录完整微信响应、登录 code、session_key、token、secret；不得把真实 openid 写入测试 fixture 或文档。

### 手机号授权

- 接入点：用户端提交手机号授权凭证到 API。
- API 职责：通过 `PhoneProvider` 解密或换取手机号，只保存报名前置所需字段。
- 日志：只允许脱敏手机号；不得打印手机号授权 code、access_token 或手机号明文。
- 禁止：采集通讯录、实时定位、身份证或其他本阶段未审批信息。

### 微信支付下单

- 接入点：用户创建订单后，API 根据服务端订单金额发起支付。
- API 职责：
  - 订单金额只从服务端订单读取。
  - real provider 返回预支付参数给小程序。
  - `Payment` 初始状态保持 pending。
- 禁止：使用客户端传入金额作为支付金额。

### 微信支付回调验签

- 接入点：微信支付通知回调。
- API 职责：
  - 验证签名、时间戳、nonce、证书序列号。
  - 校验商户号、订单号、金额和支付状态。
  - 通过既有 helper 执行 `PENDING_PAYMENT -> PAID_PENDING_GROUP`。
  - 重复成功回调必须幂等。
  - 非法状态必须拒绝或 no-op，并写 audit log。
- 禁止：回调 handler 直接写 `Order.status` 或修改订单金额。

### 微信退款申请

- 接入点：运营批准退款后，API 调用 `RefundProvider` 发起退款。
- API 职责：
  - 只允许符合状态机规则的退款进入 `REFUNDING`。
  - 退款金额从服务端订单/退款单读取。
  - 保存微信退款单号或等效 channel id。
- 禁止：无退款申请、无运营审核或已退款订单直接发起新退款。

### 微信退款回调验签

- 接入点：微信退款通知回调。
- API 职责：
  - 验证签名、时间戳、nonce、证书序列号。
  - 以 `refundId` 或本地退款单映射为主查找 `Refund`。
  - 校验退款单与订单均处于 `REFUNDING`。
  - 成功时执行 `REFUNDING -> REFUNDED`。
  - 失败时保留失败原因并回到可人工复核状态。
  - 同一退款单重复成功 callback 幂等 no-op。
- 禁止：只凭 `orderId` 把订单改成已退款；禁止新 refundId 打到已退款订单。

## 生产支付关闭策略

默认配置：

```text
AUTH_PROVIDER=mock
PHONE_PROVIDER=mock
PAYMENT_PROVIDER=mock
REFUND_PROVIDER=mock
WECHAT_PAY_ENABLED=false
ALLOW_MOCK_PAYMENT_IN_PRODUCTION=false
```

启用真实微信登录或手机号 provider 的最低条件：

- `AUTH_PROVIDER=wechat` 或 `PHONE_PROVIDER=wechat`
- `WECHAT_MINIAPP_APP_ID`
- `WECHAT_MINIAPP_APP_SECRET`

缺少任一条件时，系统必须明确失败。真实登录和手机号 provider 不得 fallback 到 mock，不得把登录 code、手机号授权 code、session_key、AppSecret、access_token 或手机号明文写入日志。

启用 real provider 的最低条件：

- `PAYMENT_PROVIDER=wechat` 或 `REFUND_PROVIDER=wechat`
- `WECHAT_PAY_ENABLED=true`
- 商户号存在。
- APIv3 密钥存在。
- 商户私钥或证书配置存在。
- 回调验签配置存在。
- secret 来源为本地未提交 `.env`、密钥管理服务或部署平台 secret。

缺少任一条件时，系统必须拒绝启动 real payment provider，并输出明确错误。错误不得打印 secret 原文。

## 回归门禁

M3 前和 M3 实施过程中必须持续执行：

```bash
pnpm test:api:db
pnpm probe:api:state-machine
pnpm test:providers
```

真实微信能力接入后还必须新增：

- 支付回调验签失败测试。
- 金额不一致测试。
- 重复支付回调测试。
- 晚到支付回调打到取消/退款状态测试。
- 退款回调验签失败测试。
- 同一 refundId 重复成功回调测试。
- 新 refundId 打到已退款订单测试。
- 日志脱敏和 secret 扫描。

M3.1 的通过线是微信登录/手机号 provider、mock 回归和状态机探针继续通过。M3.1.1-A 的通过线是联调准备与门禁固化完成。M3.1.1-B 的通过线是合法小程序配置下的真实身份联调检查表完成，且自动化门禁继续通过。M3.1.1-B 完成前不得进入 M3.2 微信支付或退款实现。

## 不在本计划内

- 不接生产微信支付。
- 不提交真实商户号、证书、密钥或 token。
- 不新增 Redis/PostGIS。
- 不新增商户后台。
- 不新增推荐算法或 LLM。
- 不扩大个人信息采集范围。
