# 上海本地餐厅兴趣体验工具 MVP

本项目是一个面向上海本地用户的微信小程序 MVP。核心入口是微信小程序，配套 API 服务、运营后台和后台任务，用于完成活动浏览、报名、测试支付、排桌、信息解锁、取消退款、评价举报、黑名单和审计管理。

默认产品不得被实现或表达为交友、相亲、约会、脱单、匹配对象或陌生人社交工具。若后续要改变定位，必须先完成 `PRD.md` 和 `docs/PROJECT_CONTEXT.md` 中定义的高风险变更审批。当前用户可见表达仍围绕餐厅体验、约饭局、同城活动、兴趣餐桌和周末两小时体验。

## 当前阶段

当前优先推进 M3 的非支付闭环：结构化问卷、排桌、成团、信息解锁与通知。M3.2 测试商户接入准备已完成代码基础，但按当前排期延后到其他 MVP 工作完成后；支付和退款仍默认 mock，不发起真实扣款或退款。

阶段状态：

```text
M3.1.1-A passed
M3.1.1-B passed
M3.2 test-merchant preparation (deferred)
```

已完成：

- 任务文档已导入 repo。
- 技术选型已确认：TypeScript monorepo，Taro + React Admin + Fastify + PostgreSQL。
- 环境变量模板见 `.env.example`。
- 第一批共享纯业务规则和测试已建立在 `packages/shared`。
- 小程序、运营后台、API、Prisma/PostgreSQL 初始脚手架已建立。
- Docker/PostgreSQL、Prisma migration、真实 PostgreSQL API DB 集成测试已跑通。
- API 层已阻断报名截止、容量满、重复报名、未审批退款回调、已退款再次审批、受保护订单被支付回调改回已支付等非法路径。
- 运营后台根路径 `/` 可服务，小程序和运营后台已接最小 API 调用。
- 微信能力 provider interface 已建立，默认 mock provider。
- `AuthProvider` 已支持微信 `jscode2session` 登录路径。
- `PhoneProvider` 已支持微信手机号授权 code 换手机号路径。
- `docs/WECHAT_REAL_IDENTITY_QA.md` 已新增真实微信登录与手机号授权手工联调检查表。
- M3.1.1-A 已通过：真实身份联调准备与门禁固化完成。
- M3.1.1-B 已通过：真实微信登录和手机号授权网络联调完成。
- M3.2 本地回调安全闭环已实现：签名验签、报文解密、金额核对、幂等和状态机回流均受测试覆盖。
- 排桌后端闭环已实现：运营可预览已支付候选人、生成幂等的规则草案，并人工确认 `LOCKING -> GROUPED`；候选返回不含手机号、openid 和问卷备注。
- 运营后台活动页已接入排桌操作区：候选预览、规则草案和人工确认均调用既有运营端 API。
- 订单详情的信息解锁规则已由真实 HTTP 测试覆盖：成团前仅基础活动信息，成团后展示商户，T-24 内才展示详细地址。
- 举报最小闭环已完成：订单归属、活动结束后至 7 天内的提交窗口、运营查看/处理、处理审计，以及小程序和运营后台入口均已接通；举报原文不进入审计记录。
- 成团失败人工处置已完成：报名截止、无待支付订单且人数不足时，运营可填写原因并将活动/订单标记为 `GROUP_FAILED`；该操作不自动创建退款，也不调用退款渠道。
- 站内通知最小闭环已完成：成团确认与成团失败后为订单所属用户创建站内收件箱消息，小程序订单页可读取本人消息；未接入微信订阅消息或任何外部发送渠道。
- 黑名单最小闭环已完成：运营可按已核验的内部用户 ID 添加并查看脱敏记录，黑名单用户不能新报名；仅超级管理员可解除，添加与解除均写审计。既有订单不会因拉黑而改变。
- 体验评价最小闭环已完成：仅订单本人可对 `COMPLETED` 订单创建或更新 1–5 分评价、标签和可选建议；运营后台只读查看，评价不公开展示也不自动触发处置。
- 活动履约完成入口已完成：运营可在活动开始后标记开始、在结束后标记完成；已成团有效订单同步进入 `COMPLETED`，全程写审计并开放既有评价规则。

尚未完成：

- M3.2 测试商户外部回调联调；需要单独批准并使用仓库外 secret。
- 生产微信支付和真实退款。
- 生产微信支付上线评审、真实商户号、证书和密钥管理。
- 成团失败后的退款处置、微信订阅消息、评价等完整业务闭环。

M3.1 已验证微信登录与手机号 provider 路径，M3.1.1-B 已完成真实身份网络联调。M3.2 仅面向测试商户的回调联调准备；生产支付仍须通过 `docs/PAYMENT_PRODUCTION_REVIEW.md` 的独立审批。

## 关键文档

- `PRD.md`：产品需求与验收标准。
- `Codex_Brief.md`：Codex 实施边界、任务拆分、质量门槛。
- `docs/PROJECT_CONTEXT.md`：项目上下文、不可变更契约、暂停条件。
- `AGENTS.md`：本 repo 的 Codex 工程规则。
- `docs/DECISIONS.md`：M0 技术选型方案与待确认决策。
- `docs/COMPLIANCE_REVIEW.md`：敏感个人信息和高风险产品能力准入条件。
- `docs/PAYMENT_PRODUCTION_REVIEW.md`：生产微信支付上线评审条件。
- `docs/WECHAT_REAL_IDENTITY_QA.md`：真实微信登录与手机号授权联调检查表。

## 预期目录结构

当前采用 pnpm workspace，先建立共享业务规则包。其余应用和服务会按里程碑补齐：

```text
.
├── apps/
│   ├── miniapp/        # 微信小程序用户端
│   └── ops/            # 运营后台
├── services/
│   └── api/            # API 服务和后台任务入口
├── packages/
│   └── shared/         # 共享类型、状态机、校验规则
├── migrations/         # 数据库迁移
├── tests/              # 集成测试、E2E、QA 脚本
└── docs/               # 架构、决策、测试、发布文档
```

## 本地运行

安装依赖：

```bash
pnpm install
```

启动本地 PostgreSQL：

```bash
docker compose -p timeleft_shanghai up -d postgres
```

由于当前目录名包含中文，Docker Compose 需要显式 `-p timeleft_shanghai`，避免 project name 推导失败。

校验和生成 Prisma Client：

```bash
pnpm db:validate
pnpm db:generate
```

执行数据库迁移：

```bash
pnpm db:migrate
```

启动 API：

```bash
pnpm dev:api
```

启动小程序开发构建：

```bash
pnpm --filter @timeleft-shanghai/miniapp dev
```

启动运营后台：

```bash
pnpm --filter @timeleft-shanghai/ops dev
```

## 测试

运行当前全部测试：

```bash
pnpm test
```

只跑 provider 单测：

```bash
pnpm test:providers
```

默认测试不会连接真实数据库；API 的 PostgreSQL 集成测试需要先启动 PostgreSQL 并显式打开：

```bash
docker compose -p timeleft_shanghai up -d postgres
pnpm db:migrate
pnpm test:api:db
```

运行 M2.1 黑盒非法状态探针：

```bash
pnpm probe:api:state-machine
```

该探针会启动本地 API 到随机端口，通过真实 HTTP 请求验证报名截止、容量满、重复报名、未审批退款 callback、已退款再次审批、受保护订单支付 callback 和 audit log。探针使用 `probe_` 前缀数据，结束后只清理自己创建的数据。

类型检查：

```bash
pnpm typecheck
```

构建：

```bash
pnpm build
```

禁用词和 secret/PII 扫描：

```bash
pnpm check:copy
pnpm check:secrets
```

最低测试范围：

- 登录、手机号、协议确认报名前置校验。
- 问卷必填校验。
- 活动、订单、支付、退款、桌位状态机。
- 支付和退款回调幂等。
- 退款规则。
- 排桌规则。
- 信息解锁规则。
- 禁用词检测。
- 权限和审计。
- 敏感日志检查。

M3 前必须持续执行：

```bash
pnpm test:api:db
pnpm probe:api:state-machine
pnpm check:copy
pnpm check:secrets
```

真实微信支付、真实微信退款和真实微信回调不得直接写订单或退款状态，必须复用现有 API 状态机规则。

## 环境变量

按 `.env.example` 的占位配置准备本地环境。不要提交真实 `.env`、secret、token、生产凭证、商户号密钥或真实用户数据。

Provider mode 默认配置：

```bash
AUTH_PROVIDER=mock
PHONE_PROVIDER=mock
PAYMENT_PROVIDER=mock
REFUND_PROVIDER=mock
WECHAT_PAY_ENABLED=false
ALLOW_MOCK_PAYMENT_IN_PRODUCTION=false
```

`AUTH_PROVIDER` / `PHONE_PROVIDER` / `PAYMENT_PROVIDER` / `REFUND_PROVIDER` 只允许 `mock` 或 `wechat`。本地开发默认使用 mock。M3.1 中，`AUTH_PROVIDER=wechat` 会调用微信登录凭证校验接口，`PHONE_PROVIDER=wechat` 会调用微信接口调用凭证与手机号换取接口；缺少 `WECHAT_MINIAPP_APP_ID` 或 `WECHAT_MINIAPP_APP_SECRET` 时必须失败，不会 fallback 到 mock，也不会 silent success。

启用真实微信登录或手机号 provider 前必须提供：

- `AUTH_PROVIDER=wechat` 或 `PHONE_PROVIDER=wechat`
- `WECHAT_MINIAPP_APP_ID`
- `WECHAT_MINIAPP_APP_SECRET`

日志和文档不得记录登录 code、手机号授权 code、session_key、AppSecret、access_token 或手机号明文。`session_key` 不返回给业务层或小程序。

M3.1.1-B 真实身份联调请使用 shell 环境变量、部署平台 secret 或仓库外的本地 secret 文件注入真实值。当前 `pnpm check:secrets` 会拒绝 repo 根目录中的真实 `.env` 文件；联调检查表见 `docs/WECHAT_REAL_IDENTITY_QA.md`。

推荐的仓库外本地 secret 文件路径：

```bash
/Users/marvin.x/.config/fanju/wechat-identity.env
```

该文件不得放入 `/Users/marvin.x/Documents/饭局` repo 内，且建议设置为 `chmod 600`。

启用 `PAYMENT_PROVIDER=wechat` 或 `REFUND_PROVIDER=wechat` 前必须提供：

- `WECHAT_PAY_ENABLED=true`
- `WECHAT_PAY_MCH_ID`
- `WECHAT_PAY_API_V3_KEY`
- `WECHAT_PAY_PRIVATE_KEY_PATH`
- `WECHAT_PAY_CERT_SERIAL_NO`
- `WECHAT_PAY_CALLBACK_URL`
- `WECHAT_REFUND_CALLBACK_URL`

生产环境默认禁止 mock payment。兼容开关 `ALLOW_MOCK_PAYMENT_IN_PRODUCTION` 不会开放演示登录、模拟回调或运营权限，也不代表收费放行；运营端现支持经服务端配置的受控账号；未配置时保持关闭。

真实支付回调和退款回调不得直接写订单、支付或退款状态，必须复用 API 层既有状态机 helper。

## 不可变更契约

未经确认不得改变：

- 产品定位。
- 禁用词策略。
- 数据采集范围。
- 订单、支付、退款状态机。
- 活动、桌位、地址解锁规则。
- 用户和后台权限模型。
- 支付和退款回调幂等逻辑。
- 数据库 schema 或持久化格式。
- 公共 API 路径、参数和响应格式。
- 配置文件格式。
- 生产依赖。
- 部署拓扑。


## 阶段 1：本地隔离与真实构建（2026-09-29）

- 演示管理员登录与支付/退款 succeed/fail 路由默认不存在。仅 `NODE_ENV=development|test`、`APP_ENV=local`、`LOCAL_DEMO_ENABLED=true`、全部 provider 为 mock 且真实支付开关关闭时注册。
- 演示环境必须使用隔离测试库并绑定 `API_HOST=127.0.0.1`；不能暴露到公网。显式演示仍可按请求选择角色，只适用于可丢弃测试数据。
- 非演示环境仅接受受控管理员账号；未配置账号时全部运营 API 拒绝访问。旧无限期或已撤销 token 不再有效。真实身份、手机号、支付创建及渠道通知原路径保留。
- `pnpm test` / `pnpm test:api:db` / provider 测试 / HTTP 探针现在先生成 Prisma 并构建 shared。数据库测试必须显式提供隔离 `DATABASE_URL`。
- `pnpm build` 生成真实运营端和微信端产物；`pnpm typecheck` 独立保留。小程序生产构建必须显式设置 `TARO_APP_API_BASE_URL`。运营端生产包默认同源 `/api`，跨域部署需构建时设置 `VITE_API_BASE_URL`。
- 配置通过进程环境注入；`.env.example` 是说明模板，不代表每个命令会自动加载根目录 `.env`。
- CI 使用 `RUN_DB_TESTS=1 pnpm test:ci`，保存各包 JSON 结果并拒绝跳过数据库用例；`pnpm verify:release <API发布包目录>` 验证无 API 源码依赖的 Node 启动及 HTTP。
- 工作记录及限制见 [阶段 1 实施报告](docs/stage1/2026-09-29/README.md)。此变更不代表 G0 放行或真实支付已获批准。


### S1b / S2 后续实施

受控管理员的配置、scrypt 摘要生成、会话期限与撤销步骤见 [账号设计](docs/stage1/2026-09-29/auth/DESIGN.md)。运行环境、Provider 矩阵、新收费停止开关及剩余资金门禁见 [配置说明](docs/stage1/2026-09-29/auth/CONFIGURATION.md)。新配置必须通过进程环境或仓库外 Secret 注入；不要复制真实账号清单到仓库。


### 本地资金恢复（A2 实施中）

支付意图、回调事件和恢复任务均持久保存。启动API前在专用可丢弃数据库执行迁移；运行worker需要显式 `DATABASE_URL`，不会使用本机默认5432。

- 编译API：先 `pnpm prepare:test` 生成Prisma并构建shared，再 `pnpm --filter @timeleft-shanghai/api build`。当前A2包含两项新增迁移（共6项），更新API/worker前先在专用测试库应用迁移。
- 本地模拟恢复：`APP_ENV=local NODE_ENV=development PAYMENT_PROVIDER=mock REFUND_PROVIDER=mock pnpm --filter @timeleft-shanghai/api worker`
- 仅消费可信事件：`WORKER_MODE=events-only FINANCIAL_CASE_OWNER=<负责人> pnpm --filter @timeleft-shanghai/api worker`。此模式不能领取渠道请求任务，可在关闭新收费时持续应用已验签通知。
- 仅投递站内通知：`WORKER_MODE=inbox-only pnpm --filter @timeleft-shanghai/api worker`。此模式只领取 `DELIVER_INBOX`，不加载资金渠道处理器。`SENT` 表示站内可读，不表示微信消息送达。
- `/health` 是进程存活检查；`/ready` 检查数据库、最新迁移及所需 worker 最近 30 秒的心跳。`REQUIRED_WORKER_MODES` 可明确配置；生产默认要求 `events-only,inbox-only`。API 收到 SIGTERM 后排空连接，最多等待 15 秒。
- 恢复新收费前须配置 `REQUIRED_BILL_SCOPE` 与 `REQUIRED_BILL_PERIOD`，导入该范围的完整账单；启动时要求 scope 等于当前支付商户绑定，`/ready` 和新支付入口也只用该绑定查询最新覆盖判定。后导入的完整账单可替代旧的不完整状态，历史批次仍保留；最新判定缺失或不完整时拒绝新支付。账单检查不代替逐笔异常结案。
- `APP_ENV=local NODE_ENV=test pnpm --filter @timeleft-shanghai/api inbox:audit` 只读列出站内通知缺任务等差异；显式追加 `--repair` 仅补建有可靠业务键与订单关联的 `PENDING` 任务。运营诊断接口 `/api/ops/diagnostics/orders/:id`、`/api/ops/diagnostics/jobs/:id` 与 `/api/ops/diagnostics/queue` 需要运营身份，可用待办关联的任务 ID 追查站内通知，响应不含渠道流水和用户联系方式。
- 受控账单导入：在显式local/ci与mock配置下，使用 `pnpm --filter @timeleft-shanghai/api reconcile:import <账单JSON路径> <已核验SHA256>`；必须设置 `FINANCIAL_CASE_OWNER`。导入完成不代表待办已经处理完毕。

真实渠道worker外发、生产迁移及收费仍须独立放行。当前实现和未验收项见 [A2实施记录](docs/stage2/2026-09-29/IMPLEMENTATION_STATUS.md)。

历史模拟收款认领、责任人/独立复核及有限待办结案步骤见 [本地资金操作手册](docs/stage2/2026-09-29/LOCAL_FUNDING_RUNBOOK.md)。CLI不会将缺少证据的资金事项强制结案，也不替代生产管理员认证。
