# S2 配置与客户端隔离增补

本地整改范围：拒绝危险 Provider 混用，关闭小程序隐式演示回退，分开新收费和既有回调。没有调用真实微信，也没有批准真实收费。

## 运行矩阵

- 全 mock：仅 APP_ENV=local 且 NODE_ENV=development/test，或 APP_ENV=ci 且 NODE_ENV=test；演示管理员/模拟收退款状态入口还需 LOCAL_DEMO_ENABLED=true（仅 local）。
- 真实身份开发：上述隔离环境中 auth/phone 同为 wechat，payment/refund 同为 mock；不得启用演示写入口。
- 真实资金模式：四个 Provider 均为 wechat。NODE_ENV=production 或 APP_ENV=production 时一律要求全真实；旧 ALLOW_MOCK_PAYMENT_IN_PRODUCTION 不能绕过 API 组合校验。
- 所有非演示服务均需显式 SESSION_SECRET。没有匹配环境声明的 mock 配置拒绝启动。

## 收费停止的方向

NEW_PAYMENTS_ENABLED 默认 false，仅拦截新支付创建，不删除旧支付记录，不影响既有回调及退款路径。开启需同时提供 FEATURE_REAL_WECHAT_PAY=true、REAL_PAYMENT_APPROVAL_ID（批准引用）、REAL_PAYMENT_ALLOWED_USER_IDS（逗号分隔内部 ID）、REAL_PAYMENT_MAX_AMOUNT_CENTS（单笔上限）。测试覆盖白名单、单笔金额和缺配置拒绝。

回调入口仅依赖真实 provider 及验签材料，不再依赖 FEATURE_REAL_WECHAT_PAY。关闭新收费时必须保留真实 provider、WECHAT_PAY_ENABLED 和验证材料；不能通过切 mock 来“停收费”。数据库回归实际验证：新建支付返回403且无新记录时，签名成功回调仍可正常处理。

**限制：以上是准入开关，不是资金安全验收。** 本包尚未解决交易绑定原渠道、未知结果恢复、全局累计收费额度、G1/P0 完成及账单对账。真实联调/收费仍被项目放行流程阻塞，不能仅凭填写配置开启。F04/AT10 保持部分完成，待阶段2资金服务补齐后联测。现有资金缺陷没有被这份文档关闭。

## 客户端

小程序只有显式开发 TARO_APP_DEMO_MODE=true 才可演示，生产构建拒绝 true。冷启动通过 Taro.login 获取真实 code，不自动绑定假手机号。真实支付缺少参数时报错，绝不调用模拟 succeed。订单创建后立即保存恢复线索，支付取消/失败也保留；服务端订单列表与续付后续 U1 补齐。

运营后台生产包显示账号密码登录表单，token 保存在内存；开发演示按钮还需 VITE_DEMO_MODE=true。小程序401清除会话，运营401返回登录，两端均不自动重放写操作。

## A2补充门禁

启用NEW_PAYMENTS_ENABLED还必须显式配置FINANCIAL_CASE_OWNER。空值、local-review-required、placeholder或<负责人>等占位值不能启用真实新收费；启动和请求路径同时检查。此项仅加固配置边界，不代表真实收费已经批准。
