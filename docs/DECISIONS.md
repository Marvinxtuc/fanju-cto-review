# Decisions

## 2026-06-24：M0 技术选型

### 状态

已确认：采用方案 A。

当前 repo 已导入任务文档，并建立 pnpm TypeScript monorepo 的最小骨架。第一批业务代码限定在 `packages/shared` 的纯业务规则，不接微信、支付、数据库或页面。

### 决策背景

项目需要同时支持：

- 微信小程序用户端。
- API 服务。
- 运营后台。
- 后台任务。
- 测试支付和退款回调 mock。
- 状态机、权限、审计、禁用词和敏感日志测试。

MVP 默认不引入生产真实支付、商户后台、自动分账、LLM/Agent 排桌、强实名、身份证、实时定位、通讯录、私信或交友/相亲/约会定位。生产支付、敏感个人信息采集和产品定位变更已进入高风险待审批范围，必须先完成 `docs/PAYMENT_PRODUCTION_REVIEW.md` 或 `docs/COMPLIANCE_REVIEW.md`。

### 方案 A：TypeScript Monorepo，Taro + React Admin + Fastify + PostgreSQL

状态：已选。

组成：

- 包管理：pnpm workspace。
- 用户端：Taro + React + TypeScript，编译到微信小程序。
- 运营后台：React + Vite + TypeScript。
- API 服务：Fastify + TypeScript。
- 数据库：PostgreSQL。
- ORM / 迁移：Prisma。
- 后台任务：先用 API 服务内的可控 job runner，后续可升级 Redis/BullMQ。
- 测试：Vitest + Supertest 或 Fastify inject，后续补 Playwright。

优点：

- 单语言覆盖小程序、后台、API 和共享业务规则。
- 共享 `packages/shared` 中的类型、状态机、禁用词和校验规则。
- MVP 速度快，测试和重构成本较低。
- PostgreSQL 更适合订单、支付、退款、审计等强一致数据。

代价：

- Taro 抽象层需要遵守小程序能力边界。
- 后续若小程序页面高度依赖微信原生组件，需要额外适配。
- Prisma 与迁移策略需要从一开始严格管理。

适用条件：

- 优先做可测试、可维护、可持续迭代的 MVP。
- 团队能接受 TypeScript 全栈。
- 当前更重视工程闭环而不是极致原生小程序体验。

### 方案 B：微信原生小程序 + TypeScript API + React 运营后台

建议程度：稳妥但开发效率略低。

组成：

- 用户端：微信原生小程序 + TypeScript。
- 运营后台：React + Vite + TypeScript。
- API 服务：Fastify 或 NestJS + TypeScript。
- 数据库：PostgreSQL。
- ORM / 迁移：Prisma 或 Drizzle。
- 测试：Vitest + API 集成测试，小程序端以手动 QA 和最小自动化为主。

优点：

- 小程序侧最贴近微信生态，审核和能力适配风险低。
- 对登录、手机号、支付、地图等微信能力的表达更直接。
- API 和后台仍可保持 TypeScript 统一。

代价：

- 小程序端与后台/API 的组件和状态管理难共享。
- 用户端自动化测试成本更高。
- 业务规则需要强制沉到 `packages/shared` 或 API，避免前端重复实现。

适用条件：

- 优先降低微信小程序平台适配风险。
- 用户端交互以微信原生能力为主。
- 可以接受前端工程效率低于 Taro。

### 方案 C：微信云开发 CloudBase 优先

建议程度：最快验证，但长期审计和可迁移性风险较高。

组成：

- 用户端：微信原生小程序。
- 服务端：微信云函数 / CloudBase。
- 数据库：云开发数据库。
- 运营后台：CloudBase CMS 或轻量自建后台。
- 支付/通知：微信生态内能力。

优点：

- 微信生态集成速度最快。
- 早期部署和运维成本低。
- 适合非常轻量的原型验证。

代价：

- 长期 vendor lock-in 明显。
- 复杂订单、退款、审计、权限、迁移、回滚和集成测试较难标准化。
- 运营后台和后台任务能力容易受平台约束。
- 后续迁移到标准 API + PostgreSQL 成本较高。

适用条件：

- 目标是极快做微信内可点 demo。
- 可以接受后续重构或迁移。
- 暂不追求完整工程审计链路。

### 决策结论

选择方案 A。

理由：

- 本项目的核心风险在订单、支付、退款、排桌、权限和审计，不在页面复杂度。
- TypeScript monorepo 能最大化复用状态机、类型和测试。
- PostgreSQL 更适合承载支付、退款、审计和状态流转。
- Fastify 足够轻，适合 MVP；后续如需要更强模块约束，可迁移或升级到 NestJS。

### 第一批业务代码边界

第一批业务代码只实现 `packages/shared` 中的纯业务规则，不接外部服务：

- 禁用词检测。
- 活动状态枚举与合法流转。
- 订单状态枚举与合法流转。
- 退款规则判断。
- 地址解锁规则。
- 排桌人数规则。

这些代码不需要真实微信、真实支付、数据库或后台页面，便于先建立测试基线。

### 已确认补充决策

1. ORM 暂按 Prisma 推进，后续如改 Drizzle 需补 ADR。
2. T-24 以前用户取消进入运营快速审核，不自动退款。
3. 票价仅为服务费/订位费，不包含全部餐费。
4. 生产支付、身份证、实时定位、通讯录、私信、交友/相亲/约会定位只进入待审批范围，不可直接实现。

## 2026-06-24：M2-P0 状态机门禁固化

### 状态

已确认并进入 M2.1 回归门禁。

M2-P0 验收结论：真实 PostgreSQL、Prisma migration、API DB 集成测试、ops 根路径和最小三端 API 联调已阶段性通过。非法订单、支付、退款写入路径已由 API 层阻断。本次无 schema/migration 变更。

### 决策背景

后续 M3 可能接入真实微信登录、手机号授权、微信支付和微信退款。真实微信能力会带来外部回调、重复通知、晚到通知、金额篡改和退款重试等风险，因此必须先把 M2-P0 的 mock 状态机成果固化为长期回归门禁。

### 订单创建规则

- 活动必须存在。
- 活动状态必须为 `PUBLISHED` 或 `REGISTRATION_OPEN`。
- 当前时间必须早于 `registrationEndsAt`。
- 活动不得取消或完成。
- 同一用户同一活动不得重复报名。
- 订单金额必须由服务端根据服务费/订位费规则计算，不能信任客户端传入金额。
- 容量计算必须基于数据库真实订单，并在事务内执行。

### 容量占位口径

计入容量：

- `PENDING_PAYMENT`
- `PAID_PENDING_GROUP`
- `GROUPED`
- `REFUND_REVIEWING`
- `REFUNDING`
- `COMPLETED`

不计入容量：

- `CANCELED`
- `REFUNDED`
- 支付失败、支付过期或关闭类订单状态，如后续 enum 增加这些状态。

退款审核和退款中阶段先保守占位，避免退款未完成时座位被提前售出。

### 支付回调规则

- 只允许 `PENDING_PAYMENT -> PAID_PENDING_GROUP`。
- 已成功支付的同一支付回调必须幂等 no-op。
- `CANCELED`、`REFUNDING`、`REFUNDED` 订单收到支付成功回调时不得改回已支付。
- 非法支付回调不得修改订单金额、订单状态或退款信息，必须有 audit log。

### 退款审批和 callback 规则

- 用户取消后进入运营审核，不得直接退款成功。
- 运营批准退款只允许审核中或失败重试的退款进入 `REFUNDING`。
- 已 `REFUNDED` 的订单不得再次审批回退到 `REFUNDING`。
- refund callback 必须以 `refundId` 为主，先查退款单，再由退款单关联订单。
- refund callback 只有在退款单和订单均处于 `REFUNDING` 时才能成功。
- 同一个已成功退款单的重复成功 callback 允许幂等 no-op。
- 新 refundId 打到已 `REFUNDED` 订单必须拒绝。
- 退款失败原因写入 audit metadata/reason，不新增 schema。

### 回归门禁

M3 前和后续真实微信能力接入前必须继续执行：

```bash
pnpm test:api:db
pnpm probe:api:state-machine
```

真实微信支付、退款申请和微信支付/退款回调只能调用既有状态机 helper，不得直接写 `Order.status`、`Payment.status` 或 `Refund.status`。

### 影响

- 不新增 Redis、不新增 PostGIS、不新增生产微信支付依赖。
- 不改变当前 Prisma schema。
- 状态机 helper 保持在 API 写路径内集中收敛，后续如抽包到 shared 必须保持 DB 集成测试和黑盒探针通过。
