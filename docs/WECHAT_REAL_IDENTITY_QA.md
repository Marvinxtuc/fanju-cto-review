# WeChat Real Identity QA

## 状态

当前文档用于 M3.1.1-B：本机安全注入配置后的真实微信登录与手机号授权手工联调。

M3.1.1-A 已通过：真实身份联调准备与门禁固化完成。M3.1.1-B 才执行真实微信网络调用。本轮只验证真实微信身份链路，不接真实微信支付，不接真实退款，不改变订单、支付、退款状态机，不新增 schema/migration。

## 测试前环境准备

前置条件：

- PostgreSQL 已启动并完成迁移。
- API 服务可以本地启动。
- 小程序端可以在微信开发者工具或真机环境触发 `wx.login` 和手机号授权。
- 使用合法小程序 AppID 和 AppSecret。
- 微信公众平台的《小程序用户隐私保护指引》已声明收集和使用手机号；路径为「设置 → 服务内容声明 → 用户隐私保护指引」。未声明时，微信会直接禁用 `getPhoneNumber` 组件。
- 手机号快速验证没有单独的后台开关；它仅对非个人主体且已完成认证的小程序开放。该能力的成功调用可能产生微信平台费用，费用与资质确认不得写入 repo。
- 不把真实 AppSecret、openid、session_key、手机号明文或授权 code 写入 repo、文档、测试 fixture、截图说明或日志摘录。

隐私指引核对：

1. 在上述平台页面编辑并发布当前版本的指引，不停留在草稿。
2. 在“收集的个人信息”中选择或新增“手机号”，用途与实际行为一致，例如登录、账号身份验证或报名联络。
3. 保存发布后，在开发者工具执行「清缓存 → 清除全部缓存」并重新编译；平台配置若尚未同步，稍后重试。
4. 若页面仍显示 `api scope is not declared in the privacy agreement`，说明平台已生效的指引未声明手机号；这不是 API、局域网或 `app.json` 配置问题。

推荐基础命令：

```bash
docker compose -p timeleft_shanghai up -d postgres
pnpm db:migrate
pnpm test:providers
pnpm test:api:db
pnpm probe:api:state-machine
```

## 配置方式

本地开发默认仍使用 mock：

```bash
AUTH_PROVIDER=mock
PHONE_PROVIDER=mock
PAYMENT_PROVIDER=mock
REFUND_PROVIDER=mock
WECHAT_PAY_ENABLED=false
```

真实身份联调时，仅启用身份 provider：

```bash
AUTH_PROVIDER=wechat
PHONE_PROVIDER=wechat
PAYMENT_PROVIDER=mock
REFUND_PROVIDER=mock
WECHAT_PAY_ENABLED=false
```

还需要提供：

```bash
WECHAT_MINIAPP_APP_ID=<local-secret>
WECHAT_MINIAPP_APP_SECRET=<local-secret>
```

不要把上述真实值写入 `.env.example`、README、测试文件或任意 repo 文件。

当前 `pnpm check:secrets` 会拒绝 repo 根目录中的真实 `.env` 文件。真实联调时应使用以下方式之一：

- 通过当前 shell 的环境变量注入。
- 使用仓库外的本地 secret 文件并在 shell 中加载，文件路径不要放进 repo。
- 使用部署平台 secret 或本机 secret 管理工具注入。

推荐仓库外本地 secret 文件：

```bash
/Users/marvin.x/.config/fanju/wechat-identity.env
```

创建与权限设置：

```bash
mkdir -p /Users/marvin.x/.config/fanju
chmod 700 /Users/marvin.x/.config/fanju
nano /Users/marvin.x/.config/fanju/wechat-identity.env
chmod 600 /Users/marvin.x/.config/fanju/wechat-identity.env
```

配置文件内容格式只应存在于 repo 外：

```bash
export AUTH_PROVIDER=wechat
export PHONE_PROVIDER=wechat
export WECHAT_MINIAPP_APP_ID="真实 AppID"
export WECHAT_MINIAPP_APP_SECRET="真实 AppSecret"
```

使用方式：

```bash
cd /Users/marvin.x/Documents/饭局
source /Users/marvin.x/.config/fanju/wechat-identity.env
pnpm dev:api
```

不要把 `/Users/marvin.x/.config/fanju/wechat-identity.env` 复制进 repo，也不要把真实值粘贴到聊天、文档或测试代码里。

## 启动门禁验收

缺配置场景：

- 设置 `AUTH_PROVIDER=wechat` 且不提供 `WECHAT_MINIAPP_APP_ID` 或 `WECHAT_MINIAPP_APP_SECRET`。
- API 应明确失败，不得 fallback 到 mock。
- 错误信息不得包含 AppSecret、登录 code、session_key、access credential 或手机号明文。

配置正确场景：

- 设置 `AUTH_PROVIDER=wechat`、`PHONE_PROVIDER=wechat`。
- 提供合法 AppID/AppSecret。
- API 启动后仍保持 `PAYMENT_PROVIDER=mock`、`REFUND_PROVIDER=mock`、`WECHAT_PAY_ENABLED=false`。

## 登录成功验收

步骤：

1. 在小程序端触发微信登录按钮。
2. 小程序通过 `wx.login` 获取一次性 code。
3. 小程序调用 API 登录接口。
4. API 通过 `WechatAuthProvider` 调用微信登录凭证校验接口。
5. API 创建或返回本地用户。

通过标准：

- API 返回本地 token 和用户信息。
- API 响应不包含 session_key。
- 同一微信身份重复登录返回同一 `userId`。
- 不同微信身份不得复用同一 `userId`。
- DB 中只出现必要用户记录，不出现 session_key 字段或原始微信响应。
- 日志不打印登录 code、AppSecret、session_key 或完整微信响应。

## 登录失败验收

场景：

- 空 code。
- 过期 code。
- 被微信拒绝的无效 code。
- provider 网络或微信错误。

通过标准：

- API 返回可理解错误。
- 不创建脏用户。
- 不 fallback 到 mock。
- 不把 code、AppSecret、session_key 或完整微信响应写入日志。

## 手机号授权成功验收

步骤：

1. 用户已完成登录。
2. 在小程序端触发手机号授权按钮，并在微信官方隐私弹窗中同意《小程序用户隐私保护指引》。
3. 用户同意授权。
4. 小程序把手机号授权 code 提交给 API。
5. API 通过 `WechatPhoneProvider` 换取手机号并更新用户手机号。

通过标准：

- 绑定成功后，API 返回脱敏手机号。
- 重复绑定同一手机号幂等。
- provider 失败时不得覆盖旧手机号。
- DB 只保存业务必需手机号字段。
- API 日志不打印手机号明文、手机号授权 code 或 access credential。
- 不采集身份证，不做强实名。

## 手机号拒绝授权验收

步骤：

1. 用户已完成登录。
2. 触发手机号授权按钮。
3. 用户拒绝授权或微信未返回授权 code。

通过标准：

- 小程序展示可理解错误。
- API 不应收到可用手机号授权 code。
- DB 中旧手机号不被清空或覆盖。
- 不创建额外用户。
- 不写入手机号明文日志。

## 日志脱敏检查

检查范围：

- API dev console。
- 本地测试输出。
- 浏览器或小程序开发者工具 console。
- 运营后台页面和网络响应。

不得出现：

- AppSecret。
- 登录 code。
- 手机号授权 code。
- session_key。
- access credential。
- 手机号明文。
- 完整微信原始响应。

允许出现：

- 本地 `userId`。
- provider mode。
- 脱敏手机号。
- 不含敏感值的明确错误信息。

## DB 检查项

只做只读检查，不删除手工数据。

登录成功后：

- 同一微信身份重复登录只对应同一用户。
- provider 失败不会新增用户。
- `User` 中不保存 session_key。

手机号绑定后：

- 同一用户手机号更新为授权结果。
- 重复绑定同一手机号不产生额外用户。
- provider 失败不覆盖旧手机号。

订单状态机回归：

- 联调前后都运行 `pnpm probe:api:state-machine`。
- 确认真实身份 provider 没有改变订单、支付、退款非法状态拦截。

## 回滚方式

配置回滚：

```bash
AUTH_PROVIDER=mock
PHONE_PROVIDER=mock
PAYMENT_PROVIDER=mock
REFUND_PROVIDER=mock
WECHAT_PAY_ENABLED=false
```

代码回滚：

- M3.1.1 不应包含 schema/migration 变更。
- 如本轮只更新文档，直接回滚文档改动即可。
- 如联调中产生测试用户，应只清理自己创建且可确认的测试数据，不做批量删除，不删除用户手工数据。

## 验收记录模板

```text
阶段：M3.1.1-B
联调日期：
联调人：
小程序环境：开发版 / 体验版 / 其他
API 环境：本地 / 测试环境
AUTH_PROVIDER：
PHONE_PROVIDER：
PAYMENT_PROVIDER：
REFUND_PROVIDER：
WECHAT_PAY_ENABLED：

登录成功：通过 / 不通过 / 未执行
重复登录幂等：通过 / 不通过 / 未执行
无效 code 失败：通过 / 不通过 / 未执行
手机号授权成功：通过 / 不通过 / 未执行
手机号拒绝授权：通过 / 不通过 / 未执行
provider 失败不污染 DB：通过 / 不通过 / 未执行
日志脱敏：通过 / 不通过 / 未执行
状态机探针：通过 / 不通过 / 未执行
secret/PII 扫描：通过 / 不通过 / 未执行

是否允许进入 M3.2：允许 / 不允许
剩余风险：
回滚动作：
```

## M3.1.1-B 完成报告

完成 M3.1.1-B 后必须报告：

```text
1. 是否发生真实微信网络调用。
2. 登录成功路径结果。
3. 登录失败/无效 code 路径结果。
4. 手机号授权成功路径结果。
5. 用户拒绝手机号授权路径结果。
6. 是否创建或更新用户记录。
7. 是否发现 session_key 泄露。
8. 是否发现手机号明文日志。
9. 是否有 schema/migration 变更。
10. 是否有真实配置进入 repo。
11. pnpm check:secrets 结果。
12. pnpm probe:api:state-machine 结果。
13. 是否允许进入 M3.2。
```
