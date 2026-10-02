# AGENTS.md

## Project Summary

本项目是“上海本地餐厅兴趣体验工具”的微信小程序 MVP。核心目标是让用户完成约饭活动浏览、报名、测试支付、成团信息解锁、取消退款、评价举报，并让运营完成餐厅、活动、排桌、退款、举报、黑名单和审计管理。

产品不得被实现或表达为交友、相亲、约会、脱单、匹配对象或陌生人社交工具。

## Repo Layout

当前技术栈已确认：TypeScript monorepo，Taro + React Admin + Fastify + PostgreSQL。

建议默认结构：

```text
.
├── README.md
├── AGENTS.md
├── PRD.md
├── Codex_Brief.md
├── .env.example
├── docs/
│   ├── PROJECT_CONTEXT.md
│   ├── ARCHITECTURE.md
│   ├── DECISIONS.md
│   ├── TESTING.md
│   └── RELEASE.md
├── apps/
│   ├── miniapp/          # Taro + React 微信小程序用户端，后续里程碑补齐
│   └── ops/              # React + Vite 运营后台，后续里程碑补齐
├── services/
│   └── api/              # Fastify API 服务，后续里程碑补齐
├── packages/
│   └── shared/           # 共享类型、状态机、校验规则
├── migrations/           # PostgreSQL 数据库迁移，后续里程碑补齐
└── tests/                # 集成测试、E2E、mock、QA 脚本
```

如后续选型或结构变更，必须在 `docs/DECISIONS.md` 中说明原因和影响。

## How To Run

当前可用命令：

- 安装命令：`pnpm install`
- 当前共享包测试：`pnpm test`
- 当前共享包类型检查：`pnpm typecheck`
- 当前共享包构建：`pnpm build`
- API DB 集成测试：`pnpm test:api:db`
- API 状态机黑盒探针：`pnpm probe:api:state-machine`
- 禁用词扫描：`pnpm check:copy`
- secret/PII 扫描：`pnpm check:secrets`
- Provider 单测：`pnpm test:providers`

后续里程碑必须补齐：

- 生产部署启动命令。
- 后台任务启动命令。
- 真实微信登录、手机号、支付和退款的上线前配置说明。

所有真实密钥必须通过本地 `.env` 配置，不得提交到 repo。只允许提交 `.env.example`。

## How To Test

当前可用测试命令：

- `pnpm test`
- `pnpm test:providers`
- `pnpm test:api:db`
- `pnpm probe:api:state-machine`
- `pnpm check:copy`
- `pnpm check:secrets`
- `pnpm typecheck`
- `pnpm build`

后续里程碑必须补齐：

- E2E 或手动 QA 命令/路径。
- lint 命令。
- 禁用词扫描和 secret/PII 扫描命令。

最低测试覆盖范围：

- 登录、手机号、协议确认报名前置校验。
- 问卷必填校验。
- 活动状态机。
- 订单状态机。
- 支付回调幂等。
- 退款规则。
- 排桌规则。
- 地址解锁规则。
- 禁用词检测。
- 权限和审计。
- 敏感日志检查。

M2.1 回归门禁：

- `pnpm test:api:db` 必须继续覆盖真实 PostgreSQL 写入路径。
- `pnpm probe:api:state-machine` 必须通过真实 HTTP 验证非法状态无法写入。
- 测试和探针只能清理自己创建的前缀数据，不得删除用户手工数据。
- 后续真实微信登录、手机号、支付或退款接入不得绕过既有状态机 helper。
- 真实密钥、商户号、证书、token 和真实用户数据不得进入 Git。

M3.1 provider 门禁：

- `AUTH_PROVIDER`、`PHONE_PROVIDER`、`PAYMENT_PROVIDER`、`REFUND_PROVIDER` 只允许 `mock` 或 `wechat`。
- 默认 provider 为 mock。
- 生产环境默认禁止 mock payment，除非显式配置 `ALLOW_MOCK_PAYMENT_IN_PRODUCTION=true`。
- real auth/phone provider 缺少 `WECHAT_MINIAPP_APP_ID`、`WECHAT_MINIAPP_APP_SECRET` 时必须拒绝启动或拒绝处理请求。
- real auth/phone provider 不得打印登录 code、手机号授权 code、session_key、AppSecret、access_token 或手机号明文。
- real payment/refund provider 仍不得接入生产微信支付或真实退款。
- real provider 缺少微信支付必需配置时必须拒绝启动或拒绝处理请求。
- real provider 不得 fallback 到 mock，不得 silent success。
- provider 不得直接写订单状态；真实支付/退款回调必须回到 API 状态机 helper。
- M3.2 才能开始真实微信支付或退款实现。

M3.1.1 真实身份联调门禁：

- 真实微信登录与手机号授权手工联调检查表见 `docs/WECHAT_REAL_IDENTITY_QA.md`。
- M3.1.1-A 已通过：联调准备与门禁固化完成。
- M3.1.1-B 待执行：本机安全注入配置后的真实微信身份网络联调。
- M3.1.1-B 完成前，M3.2 微信支付/退款实现保持 blocked。
- 真实 AppID/AppSecret 只能通过 shell 环境变量、部署平台 secret 或仓库外本地 secret 文件注入，不得写入 repo。
- 推荐仓库外本地 secret 文件路径为 `/Users/marvin.x/.config/fanju/wechat-identity.env`，且建议设置为 `chmod 600`。
- 不得提交真实 `.env`、AppSecret、openid、session_key、手机号样本或授权 code。
- 用户拒绝授权、无效 code、provider 错误必须明确失败，不得 fallback 到 mock。
- provider 失败不得创建脏用户，不得覆盖旧手机号。
- 联调前后必须继续通过 `pnpm test:providers`、`pnpm test:api:db`、`pnpm probe:api:state-machine`、`pnpm typecheck`、`pnpm build`、`pnpm check:copy`、`pnpm check:secrets`。

## Engineering Rules

- Git repo 是项目事实来源，聊天记录不是长期事实来源。
- `main` 分支应保持可运行。
- 每个业务任务使用 feature branch 或 PR。
- 每次只推进一个里程碑。
- 不要按“前端 / 后端”机械拆分；按身份、活动、订单、支付、退款、排桌、解锁、通知、安全审计等责任边界拆分。
- 所有核心状态机必须有测试。
- 支付金额必须由服务端计算。
- 支付和退款回调必须幂等。
- 订单创建规则：活动必须处于 `PUBLISHED` 或 `REGISTRATION_OPEN`，未过报名截止，未满容量，且用户没有该活动有效订单。
- 容量占位口径：`PENDING_PAYMENT`、`PAID_PENDING_GROUP`、`GROUPED`、`REFUND_REVIEWING`、`REFUNDING`、`COMPLETED` 计入容量；`CANCELED`、`REFUNDED`、失败或关闭订单不计入容量。
- 支付回调规则：只允许 `PENDING_PAYMENT -> PAID_PENDING_GROUP`；已成功支付回调幂等；`CANCELED`、`REFUNDING`、`REFUNDED` 不得被支付回调改回已支付。
- 退款审批规则：只允许审核中或失败重试的退款进入 `REFUNDING`；已 `REFUNDED`、已完成、已到场等状态不得回退。
- 退款 callback 必须以 `refundId` 为主，先找到有效退款单，再校验退款单和订单均处于 `REFUNDING`。
- 用户可见活动文案必须通过禁用词校验。
- 普通用户只能访问自己的数据。
- 后台接口必须鉴权并按角色授权。
- 高风险操作必须写入审计日志。
- 日志不得包含完整手机号、openid、secret、支付敏感字段或生产凭证。
- 数据库 schema 变更必须通过迁移，并说明回滚方式。
- 新增依赖必须说明原因、影响、替代方案和许可证/供应链风险。
- 生产支付、敏感个人信息采集、私信/通讯录、交友/相亲/约会定位都属于高风险待审批范围，实施前必须先完成对应评审文档和人工审批。
- 真实 `.env`、secret、token、商户号密钥、证书和真实用户数据永远不得提交到 Git；只能使用本地未提交 `.env`、密钥管理服务或部署平台 secret。
- `.env.example` 只能保存占位配置，不得保存真实 openid、手机号、商户号、APIv3 密钥、证书路径或 token。

## Do Not

- 不要提交 secrets、真实 `.env`、token、生产凭证、商户号密钥或真实用户数据。
- 不要新增生产依赖，除非任务明确允许或人工确认。
- 不要改公开 API，除非 PRD 明确要求。
- 不要改数据结构或持久化格式，除非明确要求并提供迁移方案。
- 不要做无关重构。
- 不要把产品改成 Web 项目。
- 不要把产品改成泛社交、交友、相亲、约会、脱单或匹配对象定位，除非 PRD、PROJECT_CONTEXT、文案策略和审核风险说明均已更新并通过人工审批。
- 不要加入交友、相亲、约会、脱单、匹配对象、陌生人交友、CP、找对象等用户可见文案，除非已完成产品定位高风险变更审批。
- 不要实现私信、好友关系、通讯录导入或用户关系链，除非已完成合规评审和产品审批。
- 不要采集身份证、精确住址、实时定位、通讯录或强实名信息，除非已完成 `docs/COMPLIANCE_REVIEW.md` 要求的评审和人工审批。
- 不要实现性别比例承诺或基于性别的用户可见卖点，除非 PRD 更新确认。
- 不要接入生产真实支付，除非完成 `docs/PAYMENT_PRODUCTION_REVIEW.md` 并人工确认；即使确认，也不得提交真实密钥或凭证。
- 不要开放商户后台或自动分账，除非 PRD 更新确认。
- 不要使用 LLM/Agent 进行自动排桌决策，除非 PRD 更新并补充 AI Eval。

## Definition Of Done

一个任务完成必须满足：

- 功能满足 `PRD.md` 对应需求。
- 验收标准可被人工或自动测试验证。
- 必要测试通过。
- lint/typecheck/build 通过，如适用。
- 数据库迁移可执行并有回滚说明，如适用。
- 权限、错误处理、幂等和边界状态已检查。
- 用户可见文案无禁用词。
- 日志无敏感数据泄露。
- diff 已审查。
- 无无关重构。
- README / PROJECT_CONTEXT / AGENTS / 测试文档按需更新。
- 未完成项和剩余风险已报告。

## Review Guidelines

Review 时重点检查：

- 是否偏离“上海本地餐厅兴趣体验工具”定位。
- 是否出现禁用词或泛社交、相亲、约会导向。
- 普通用户是否可能访问他人订单、手机号、问卷、退款或地址。
- 运营后台是否存在越权。
- 支付金额是否只由服务端计算。
- 支付和退款回调是否幂等。
- 订单、活动、退款、桌位状态机是否存在非法状态跳转。
- 地址是否只对已支付、有效、已成团且到 T-24 的用户展示。
- 退款是否可能重复发起。
- 黑名单是否能阻止报名。
- 高风险操作是否写入审计。
- 日志是否泄露手机号、openid、secret 或支付敏感字段。
- 是否新增了无关依赖或无关重构。
- 测试是否覆盖正常路径、错误路径、权限路径和边界路径。
