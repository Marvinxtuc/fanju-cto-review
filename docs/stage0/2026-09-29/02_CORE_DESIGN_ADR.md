# 02 核心设计与迁移 ADR：评审稿

状态：designed / 待专项批准。2026-09-29，基线 bc25f5b。作者：本次 Codex；独立复核人未指定。本文不授权执行 SQL、改变现有资金状态机或调用微信。所有新增路径、字段与约束为提案。

## 1. 选择与不变量

保留模块化单体、Prisma/PostgreSQL。采用短事务行锁、条件更新、持久事件及至少一次任务执行。Redis、Kafka、微服务及大版本升级不作为前置。

资金事实与 Order 履约分离：成功收款不能因订单关闭、失去席位或第二笔到账被丢弃；旧执行不能覆盖成功收退事实。原成功收款对应的成功退款加未知/处理中退款占款不超过可退额。价格由服务端确定。每个已付款订单在成团前有容量保障及决策时限，决策后有实际履约或可追踪退款/异常义务。

推荐新增逻辑实体（名称最终由 Schema 评审冻结）：

| 实体 | 关键字段/约束 | 作用 |
| --- | --- | --- |
| ChannelReceipt | channel, merchantScope, channelTradeNo, merchantOrderNo, orderId 可空, amountCents, currency, verifiedAt, evidenceHash；前三字段唯一 | 独立保存成功收款事实，允许第二笔流水；未知关联可认领 |
| PaymentAttempt | orderId, receiptId 可空, merchantOrderNo 唯一, active, resultClass, version | 原 Payment 演进；同订单最多一个有效收款意图；未知不等于失败 |
| RefundIntent | receiptId 必填, merchantRefundNo 唯一, amountCents, obligationKey, resultClass, version | 严格关联原收款；同义务幂等；未知占用退款预算 |
| RefundObligation | orderId/receiptId, cause, policyVersion, businessKey 唯一, deadline, owner, state | 成团失败、取消及异常多收款的处理责任 |
| ReceivedEvent | channel, merchantScope, eventId, evidenceHash, receivedAt, verificationMaterialId, normalizedPayload, state | 通知去重，冲突另记；payload 受控、最小化 |
| DurableJob | businessKey 唯一, type, payloadVersion, refId, runAt, attempts, leaseOwner, leaseUntil, generation, state, lastErrorClass | 独立 worker 领取、恢复及人工接管 |
| GroupDraftVersion | activityId, version, candidateHash, decisionDeadline, state | 候选变化作废，重建可审计 |
| ReconciliationBatch/Case | merchantScope, period, fileHash/coverage；caseKey、负责人、截止时间、复核 | 双向对账及账单不可用状态 |

不将真实商户号、密钥、原始敏感通知写入 Git；merchantScope 使用内部受控引用。事件保存规范化必要字段，原始报文确需留存时另定加密/访问/留存策略。

## 2. 事件—资金—订单—席位—补偿矩阵

| 事件/当前前态 | 资金事实 | 订单合法去向 | 席位影响 | 审计/补偿 |
| --- | --- | --- | --- | --- |
| PENDING_PAYMENT 正常确认收款 | 新增/认领收款 | PAID_PENDING_GROUP | 保持容量 | 事务事件及决策截止时间 |
| 同交易重复通知/查询 | 复用同 receipt | 不再次推进 | 不重复占位 | 收集来源，不重复副作用 |
| CLOSED/CANCELED 后真实成功 | 仍保存 receipt | 不自动复活；保留关闭事实 | 不抢占已售席位 | 首发默认创建全额退款义务 |
| 同订单另一个 channelTradeNo 成功 | 独立 receipt | 原履约不重复 | 不增席位 | 第二笔独立异常退款义务 |
| 支付请求超时 | 未知意图保留 | 保守待决 | 暂保留至可靠关单/批准处置 | 同商户号查询，超时升级 |
| 退款已成功，旧请求 catch 到达 | 成功保持 | REFUNDED 不回退 | 按既有释放结果 | 忽略旧状态写，记录诊断 |
| 活动 GROUP_FAILED/CANCELED | 实收保持，新增退款义务 | 展示失败/退款进度 | 不再承诺履约 | 每笔 receipt 有唯一义务 |
| 草案后取消/退款 | 不改收款事实 | 原草案失效 | 重建；不能强行确认旧成员 | 版本条件、候选变化审计 |
| 成团决策前晚到成功 | 记录实收 | 重建候选后待确认 | 检查容量与约束 | 保留截止时限 |
| 成团决策后晚到成功 | 记录实收 | 默认异常退款，不自动补桌 | 不自动解锁地址 | 允许例外须另批 |
| 可信通知无本地关联 | 存 ReceivedEvent；可存孤立 receipt | 不伪造订单 | 无 | 对账认领待办 |

退款拒绝时重读当前事实：仍待成团且有容量可恢复待成团；实际有效桌位仍在可恢复 GROUPED；活动取消/失败保留系统退款义务；重排失位先合法重分配或退款；实际已完成才归 COMPLETED；已退款/渠道不可撤销处理中不接受旧审核结果覆盖。

政策待签项：决策截止后的默认退款、未知结果升级期限、审核拒绝后的例外、饮食/人数偏好硬约束。这些是建议，不冒充已有业务批准。

## 3. 三个集合与订单唯一性

推荐使用持久 registrationActive 表示同活动重报占位，独立 capacityHeld 表示容量，资金责任通过 receipt/intent/obligation 判断。新增字段必须由统一事务服务维护，并补约束与一致性探针，不能只靠客户端。

| 当前状态/情形 | registrationActive | capacityHeld | 资金责任 |
| --- | --- | --- | --- |
| PENDING_PAYMENT（含未知） | true | true | 意图/未知需查明 |
| PAID_PENDING_GROUP / GROUPED | true | true | 正常待履约；异常另记 |
| REFUND_REQUESTED / REFUND_REVIEWING / REFUNDING | true | true（保守默认） | 直到资金及政策明确 |
| GROUP_FAILED | true（活动亦禁新单） | false | 对所有未退清实收负责 |
| COMPLETED | true | 保留历史占位，不重售 | 正常结清为无；异常另记 |
| CLOSED / CANCELED / PAYMENT_FAILED | 仅可靠确认未收款且无未决事项后 false | 可靠退出后 false | 晚到资金另记并补偿 |
| REFUNDED | 全部关联退款结清且无未决事项后 false | false | 结清后无 |

重报仍要求活动状态可报名、未截止、容量及问卷/协议满足条件。退款成功不能自动解除所有其他 receipt 的未决责任。未知支付不能无限拖延：人工待办有截止时刻，活动到决策期限要进入获批延期/取消流程。

### 分阶段 SQL 草案（不是已提交迁移）

```sql
-- Expand：保留旧 Order_userId_activityId_key，旧写入者停用前不开新语义。
ALTER TABLE "Order" ADD COLUMN "registrationActive" boolean;
ALTER TABLE "Order" ADD COLUMN "capacityHeld" boolean;
ALTER TABLE "Order" ADD COLUMN "version" integer NOT NULL DEFAULT 0;

-- 预检查：先产出人工复核样本，不能仅凭 CLOSED/FAILED 推定没收钱。
SELECT o.id, o.status, count(p.id) AS payment_count
FROM "Order" o LEFT JOIN "Payment" p ON p."orderId" = o.id
GROUP BY o.id, o.status;

-- 保守回填：非终态占位；终态也先阻止重报，待可靠资金核验逐单释放。
UPDATE "Order" SET "registrationActive" = true,
  "capacityHeld" = status IN
  ('PENDING_PAYMENT','PAID_PENDING_GROUP','GROUPED','REFUND_REQUESTED',
   'REFUND_REVIEWING','REFUNDING','COMPLETED');
ALTER TABLE "Order" ALTER COLUMN "registrationActive" SET NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "capacityHeld" SET NOT NULL;
CREATE UNIQUE INDEX "Order_one_active_registration"
  ON "Order" ("userId", "activityId") WHERE "registrationActive";
-- 不设置默认值：逼迫所有写入者显式提供新语义；先关闭旧写入进程。
-- 在兼容 C 部署、回填验证、新索引存在、旧 worker 排空后，单独窗口：
-- DROP INDEX "Order_userId_activityId_key";
```

实际旧索引名/类型须用迁移及 catalog 核验，不能照抄 DROP。此草案尚未应用，资金/事件/任务表 DDL 与 Prisma 同步仍需独立复核；不宣称全 Schema 迁移已可执行。索引谓词只依赖持久值，禁止 `expiresAt > now()`。

回填必须提供零值/NULL 检查、重复有效报名检查、资金关联冲突清单、catalog 约束存在性检查。只在授权专用迁移实验库先验证；样本包含多历史单、未决支付、额外到账、退款中及旧事件。

## 4. 锁协议及幂等

业务锁顺序：Activity → user/account 状态（涉及报名/拉黑时）→ 按 ID 排序的 Order → receipt/Payment/Refund → TableGroup/Member。任何路径不反向获取；查询到关联后入事务重新确认。未知关联的接收事件先独立持久化，不抢未找到的订单锁。

实际写入重读前态和 version，更新 WHERE id/version/合法状态并核对 affected count；资金/订单/审计/义务和初始任务一起提交。网络不放在持锁事务。超时、死锁重试只复用同业务键。

事件幂等键与资金幂等键分离：同 eventId 内容摘要不同要隔离；不同 eventId 或主动查询指向同渠道流水只生效一次。退款占款在 receipt 锁下计算，包含未知及处理中，未知不能释放额度。多收款分别关联 receipt，不能挑“最近成功支付”随意退款。

## 5. Worker 协议与回调

短事务 SKIP LOCKED 领取到期任务，generation+1，记录 leaseOwner/leaseUntil；它只用于任务队列，不用于完整资金或容量统计。提交后外发，完成/重试 WHERE id/generation/owner/合法状态。A 租约过期、B 成功后，A 不能回写任务状态；A 的可信结果可按统一资金幂等服务复核，但不能恢复旧履约。

同业务标识允许至少一次请求；未知先查单，有限退避，达到重试预算进入人工待办，不能删任务。初始任务与义务原子提交，补扫任务仅作为双保险。版本化 payload；不支持的版本停止该任务并告警，不盲目解释。

回调：原始字节/限长/格式 → 接收时验签与时效 → 解密规范化 → ReceivedEvent+任务可靠提交 → 渠道应答 → 异步业务应用。落盘失败不能成功应答；无法关联持久隔离；无效签名不进入可信队列。积压消费依据入口验签时间，不重新将当前消费时刻当网络时间。回调请求不调用慢外部接口。实际商户成功应答与时限在 X1 前再次确认。

## 6. 双向对账及灾难恢复

本地意图查询渠道，另以账单全量反查本地；区分 receipt 金额、实付、优惠、手续费和结算净额。账单批次记录 merchantScope、账期、摘要及覆盖状态；未生成/下载失败不能记零差异。导入只生成证据/待办，不能直接绕过状态机改最终订单。

Case 必填：发现时间、类型、证据、主责、截止时刻、处置方式、复核者、关闭结论。首发可人工受控导入并逐笔复核。恢复库后先停新收费与无约束外发，接收存量可信回调，查补恢复点后及此前未结清资金，验证旧任务，不仅重放恢复后的队列。

## 7. 版本矩阵与阻塞

| 组合 | 结论 |
| --- | --- |
| DB0 + bc25f5b | 仅基线；安全缺陷未修 |
| DB1 + 兼容 C | 关闭重报，所有写入者理解新增语义 |
| DB2 + C/N | 新有效索引生效；获批后允许重报 |
| DB2 + bc25f5b | 禁止回退，多历史假设不兼容 |
| DB2 回退 C | C SHA、产物摘要、配置/worker/客户端矩阵实测后才允许 |
| 跨事件协议版本 worker 混跑 | 默认禁止；迁移时暂停领取、排空、兼容测试后允许 |

最低兼容回退 SHA：未产生。D0 可评审实验设计；G3 必须阻塞直到实际产出并演练。不可通过删除资金记录或切 Mock 回退。

需独立批准：上述新实体/Schema、状态与索引集合、晚到付款政策、退款拒绝政策、任务重试/接管时限、协议新接口。阶段 2 尚未放行。
