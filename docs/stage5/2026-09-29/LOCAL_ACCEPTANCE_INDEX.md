# 当前本地验收证据索引

2026-09-30。对照原审计 T01–T28 与审核 AT01–AT10。下列断言从本轮 187 项 CI 机器结果提取，每条均为 passed。它们证明列出的本地条件，不替代真实渠道、目标环境或门禁签收。原台账 not_run 表为历史快照。

## 场景与断言

### T01

- `services/api/src/security.test.ts`：`local demo isolation omits demo routes and rejects even valid signed ops tokens in production`（passed）
- `services/api/src/security.test.ts`：`local demo isolation omits demo routes and rejects even valid signed ops tokens in test`（passed）

### T02

- `services/api/src/auth.test.ts`：`session and controlled admin authentication rejects missing, development and placeholder keys outside demos`（passed）
- `services/api/src/auth.test.ts`：`session and controlled admin authentication rejects old unlimited tokens, expiry, wrong audience and revoked users`（passed）
- `services/api/src/auth.test.ts`：`session and controlled admin authentication takes role only from server config and rechecks role, account version and account existence`（passed）

### T03

- `services/api/src/config.test.ts`：`runtime provider and new payment configuration checks all sixteen provider combinations in local and production environments`（passed）

### T04

- `services/api/src/app.test.ts`：`api mock MVP flow keeps signed callbacks active while new charges are stopped, and hides them for mock providers`（passed）

### T05

- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery reuses one merchant number across twenty payment attempts and rejects a channel switch`（passed）

### T06

- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery recovers lost prepayment persistence using the original number and stops at manual review`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery recovers channel acceptance after a lost response without a second refund`（passed）

### T07

- `services/api/src/funding/prepay-http.test.ts`：`HTTP payment response persistence recovery retains intent after storage failure, reuses the original merchant number, and stops parameters at MANUAL`（passed）

### T08

- `services/api/src/app.test.ts`：`api mock MVP flow rejects illegal payment callbacks without changing protected order states`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow requires ops approval before refund callbacks and blocks refunded regressions`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery records exactly one receipt under twenty concurrent confirmations`（passed）

### T09

- `services/api/src/app.test.ts`：`api mock MVP flow creates an order with server-side service fee and handles payment idempotently`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery commits event and recovery job together and applies after a reconnect`（passed）
- 尚需：已补同一原始报文使用另一合法签名 nonce，事件幂等成功；真实微信入口仍需指定环境复验。

### T10

- `services/api/src/wechat-pay.test.ts`：`WeChat Pay v3 notifications rejects altered bodies and stale timestamps before state can change`（passed）
- `services/api/src/wechat-pay.test.ts`：`WeChat Pay v3 notifications rejects payment currency undefined`（passed）
- `services/api/src/wechat-pay.test.ts`：`WeChat Pay v3 notifications rejects payment currency USD`（passed）
- `services/api/src/wechat-response.test.ts`：`verified bounded channel responses rejects altered bodies, wrong certificate identity and stale signed responses`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery records a trusted successful query with a conflicting amount without fulfilling the order`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery rejects a queried refund for a different original trade even when the amount matches`（passed）
- 尚需：仅离线签名及模拟 HTTP；真实微信协议/证书组合未执行。

### T11

- `services/api/src/app.test.ts`：`api mock MVP flow serializes twenty cancellations and approvals into one refund and one recovery job`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery serializes competing refund reservations and keeps unknown amounts reserved`（passed）

### T12

- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery recovers channel acceptance after a lost response without a second refund`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery keeps one refund effect when paused worker A returns after expired lease takeover B`（passed）

### T13

- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery recovers channel acceptance after a lost response without a second refund`（passed）
- `services/api/src/orders/inventory.test.ts`：`L1 durable inventory and historical registration lets the durable worker close an expired order after a process restart`（passed）
- 运行补充：../../stage2/2026-09-29/evidence/process-recovery.json
- 尚需：另见阶段 2 process-recovery.json；真实渠道进程故障未执行。

### T14

- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery uses verified payment time when inbox consumption happens after the inventory deadline`（passed）
- `services/api/src/orders/inventory.test.ts`：`L1 durable inventory and historical registration settles concurrent channel success and expiry without releasing confirmed money`（passed）

### T15

- `services/api/src/app.test.ts`：`api mock MVP flow rejects expired registration and capacity overflow while reusing the active pending order`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow cancels a pending order, closes its merchant number, and permits a fresh registration`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow allows only one of twenty users to take the last available seat`（passed）

### T16

- `services/api/src/app.test.ts`：`api mock MVP flow accepts a valid first manual four-person grouping after the automatic six-person proposal conflicts`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow keeps the old draft and requires rebuilding after a paid candidate leaves`（passed）

### T17

- `services/api/src/app.test.ts`：`api mock MVP flow rejects confirmation when a pending order pays after the draft`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery keeps late money after CLOSED and creates full refund duty without resurrection`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery retains a second actual collection and its own refund obligation`（passed）

### T18

- `packages/shared/src/rules/shared.test.ts`：`activity info visibility does not show info to refunded users`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow unlocks order information in stages without exposing the address early`（passed）

### T19

- `services/api/src/app.test.ts`：`api mock MVP flow records durable refund duties when an undersized activity fails`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow recovers a group-failure refund from its original receipt`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow requires super admin cancellation and records a refund duty before responding`（passed）

### T20

- `services/api/src/app.test.ts`：`api mock MVP flow rechecks current facts before rejecting a user's refund review`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow does not open a new user refund review after the activity starts`（passed）

### T21

- `services/api/src/app.test.ts`：`api mock MVP flow requires the order owner to confirm the current agreement before creating an order`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow rejects invented and old agreement versions after a policy switch while preserving the old order`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow keeps the order questionnaire immutable and exposes it only to operations`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow blocks automatic confirmation when a dietary limit lacks verified restaurant capability`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow stores a complete profile for its owner and rejects incomplete submissions`（passed）

### T22

- `services/api/src/app.test.ts`：`api mock MVP flow recovers only the current user's orders with stable pagination and private details`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow does not allow a user to read another user's order`（passed）
- `apps/miniapp/src/api.test.ts`：`order recovery finds a server order after local order cache is cleared and honors an explicit ID`（passed）
- `apps/miniapp/src/api.test.ts`：`order recovery preserves the pending order when the cashier is canceled and can retry that order`（passed）

### T23

- `services/api/src/app.test.ts`：`api mock MVP flow replays a durable inbox job after grouping without duplicate messages`（passed）
- `apps/miniapp/src/api.test.ts`：`keeps order details available during a notification outage`（passed）

### T24

- `services/api/src/app.test.ts`：`api mock MVP flow allows the operations console to preflight manual table-group adjustments`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow limits cross-origin management requests and permits the approved DELETE preflight`（passed）
- 运行补充：受控账号浏览器 PUT/POST 已验证，见 `evidence/controlled-ui.json`；DELETE 原生提示后最终解除已确认，未授权源由 API 回归证明。

### T25

- `services/api/src/app.test.ts`：`api mock MVP flow recovers only the current user's orders with stable pagination and private details`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow paginates more than one hundred mixed-state orders and activities without truncating seat totals`（passed）

### T26

- `services/api/src/app.test.ts`：`api mock MVP flow blocks forbidden user-visible activity copy`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow creates audited supply, validates activity bounds, and publishes a draft once`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow serializes restaurant capacity edits with draft publication`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow serializes restaurant capacity edits with direct open activity creation`（passed）

### T27

- `services/api/src/app.test.ts`：`api mock MVP flow requires fresh configured worker heartbeats before readiness succeeds`（passed）
- `services/api/src/shutdown.test.ts`：`shutdown cleanup disconnects the database after an HTTP close failure and reports failure`（passed）
- `services/api/src/shutdown.test.ts`：`shutdown cleanup reports a database disconnect failure after closing HTTP`（passed）
- `services/api/src/wechat-response.test.ts`：`verified bounded channel responses rejects altered bodies, wrong certificate identity and stale signed responses`（passed）
- 尚需：本地 readiness/断库/停机与强退有证据；实际告警送达及目标环境轮换未验证。

### T28

- `services/api/src/funding/legacy.test.ts`：`legacy mock evidence rehearsal claims verified evidence idempotently without changing fulfillment or losing unknown refund budget`（passed）
- `services/api/src/funding/legacy.test.ts`：`legacy mock evidence rehearsal verifies a historical successful refund only when its channel evidence arrives`（passed）
- `services/api/src/funding/legacy.test.ts`：`legacy mock evidence rehearsal refuses mismatched evidence or over-reserved legacy refunds atomically`（passed）
- 运行补充：../../stage2/2026-09-29/evidence/migration-guard.json；../../stage2/2026-09-29/evidence/restore-reconcile.json
- 尚需：13 项空库迁移、隔离历史迁移及恢复通过；指定旧新版本交错和提交回退仍缺 SHA。

### AT01

- 运行补充：UI_ACTION_IMPLEMENTATION_REPORT.md：空 dist Taro 打包、模拟器导入/运行、Vite 页面加载、verify:release 独立 API 和 worker 通过；源码未提交，候选 SHA 仍未冻结。

### AT02

- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery keeps one refund effect when paused worker A returns after expired lease takeover B`（passed）
- `services/api/src/jobs/queue.test.ts`：`persistent queue on PostgreSQL fences expired A after B has completed, including A's retry write`（passed）
- `services/api/src/jobs/queue.test.ts`：`persistent queue on PostgreSQL never invokes a ninth channel attempt after repeated worker death`（passed）

### AT03

- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery does not acknowledge persistence when the recovery job cannot commit`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery commits event and recovery job together and applies after a reconnect`（passed）

### AT04

- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery keeps late money after CLOSED and creates full refund duty without resurrection`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery retains a second actual collection and its own refund obligation`（passed）

### AT05

- `services/api/src/app.test.ts`：`api mock MVP flow rechecks current facts before rejecting a user's refund review`（passed）

### AT06

- `services/api/src/app.test.ts`：`api mock MVP flow cancels a pending order, closes its merchant number, and permits a fresh registration`（passed）
- `services/api/src/app.test.ts`：`api mock MVP flow keeps a legacy draft with no candidate digest and requires rebuilding it`（passed）
- `services/api/src/orders/inventory.test.ts`：`L1 durable inventory and historical registration closes an expired order without a payment intent and retains a historical row`（passed）
- 尚需：历史订单及约束本地验证；最低兼容回退 SHA、指定旧新 API/worker 组合仍未验证。

### AT07

- `services/api/src/reconciliation/service.test.ts`：`controlled bilateral reconciliation finds channel-only money and recovers it when no local intent or job exists`（passed）
- `services/api/src/reconciliation/service.test.ts`：`controlled bilateral reconciliation does not record an unavailable statement as a zero-difference completed reconciliation`（passed）
- `services/api/src/reconciliation/service.test.ts`：`controlled bilateral reconciliation rejects mixed merchant scopes before persisting any import`（passed）
- `services/api/src/reconciliation/service.test.ts`：`controlled bilateral reconciliation reports local records that channels cannot confirm and separately reports query outage`（passed）

### AT08

- `services/api/src/funding/legacy.test.ts`：`legacy mock evidence rehearsal claims verified evidence idempotently without changing fulfillment or losing unknown refund budget`（passed）
- `services/api/src/funding/legacy.test.ts`：`legacy mock evidence rehearsal verifies a historical successful refund only when its channel evidence arrives`（passed）
- `services/api/src/funding/legacy.test.ts`：`legacy mock evidence rehearsal refuses mismatched evidence or over-reserved legacy refunds atomically`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery recovers channel acceptance after a lost response without a second refund`（passed）
- `services/api/src/reconciliation/service.test.ts`：`controlled bilateral reconciliation finds channel-only money and recovers it when no local intent or job exists`（passed）
- 运行补充：../../stage2/2026-09-29/evidence/restore-reconcile.json

### AT09

- `services/api/src/wechat-response.test.ts`：`verified bounded channel responses verifies exact response bytes before parsing and refuses unsigned success`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery uses verified payment time when inbox consumption happens after the inventory deadline`（passed）
- `services/api/src/funding/receipts.test.ts`：`independent monetary facts and event recovery commits event and recovery job together and applies after a reconnect`（passed）
- 运行补充：`evidence/callback-backlog-http.json` 证明当前编译 API 的真实 loopback 原始报文验签、过期网络报文拒绝及独立 worker 积压消费。积压通过测试时钟和测试 verifiedAt 模拟；未知关联收款进入人工待办。生产入口代理尚未验证。

### AT10

- `services/api/src/app.test.ts`：`api mock MVP flow keeps signed callbacks active while new charges are stopped, and hides them for mock providers`（passed）
- `services/api/src/config.test.ts`：`runtime provider and new payment configuration defaults new real payments closed and enforces allowlist and per-payment amount cap`（passed）
- 尚需：配置默认关闭已证明；具名放行与正式运行组合尚未签收。

## 本轮浏览器与模拟器补充

- `evidence/controlled-ui.json`：四笔履约完成、一笔退款成功、反馈结案、异人资金待办结案及黑名单恢复。详见 O1 实施报告。
- 通知分页直接创建 25 个测试夹具和持久任务，独立 worker 投递；首批 20，加载后 26（含原成团通知），无重复，已读持久化。

- `evidence/miniapp-forms-ui.json`：模拟器反馈提交、评价提交与更新、偏好保存；数据库逐项核验。履约状态由 API 夹具准备。

## 放行边界

本地实施和证据可提交复核；G0–G4 未具名签收。正式协议、餐厅能力、平台/商户/域名与真实联调、固定候选及最低回退提交、目标环境恢复和收费审批仍是明确缺项。没有进行 Git 提交、推送、生产迁移、部署或收费。

## 2026-09-30 Git 专项批准与固定版本增量

用户已明确回复“批准，继续”，批准本地 Git 冻结与隔离兼容演练。整改实现现固定为 `2e7e012e1f58e093f5913cdaeaa400b4bb7e30a7`；该 SHA 干净副本完整 CI 187 项通过、零失败跳过，13 项空库迁移、带历史行升级、真实构建、独立 API/两种 worker 及重新部署后的历史/资金保留通过。最低已验证兼容版本为此 SHA，不回退到 `bc25f5b`。此前“Git 待批”“全部源码未提交”“没有最低兼容 SHA”是审批前快照，现已由本段取代。

[版本矩阵与证据范围](FROZEN_VERSION_MATRIX.md)明确：固定基线重新部署通过；两个不同业务版本交错或跨版本回退仍未证明，不把同版本重启称为跨版本回退。固定包尚未另做 IDE/设备验收，正式配置/协议/餐厅能力、真实渠道/账单/生产恢复及 G0–G4 具名签收仍未形成。没有推送、生产部署或收费。
