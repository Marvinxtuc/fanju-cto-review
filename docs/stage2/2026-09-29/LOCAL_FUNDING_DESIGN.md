# A2 本地资金整改专项评审包

2026-09-29。状态：用户已明确批准本设计的本地实施；不是已执行迁移。承接 R02–R06、R08 和阶段0 ADR，首次请求只覆盖本地 M1/M2/M3，不含真实微信调用、生产迁移、部署、收费，也不取消现有用户/活动绝对唯一约束。

## 1. 可批准的具体范围

保留单体和现有 Payment/Refund/Order。新增资金事实、可信事件、持久任务及责任记录，抽出 API 资金服务供路由、worker、模拟渠道和对账共同调用。改动点：`prisma/schema.prisma`、新增 Prisma migration、`services/api/src/{funding,events,jobs,reconciliation}/*`、`worker.ts`、provider 查询/关单接口、app.ts 资金路由和对应测试；同步 shared 状态 helper、发布构建及 worker 冒烟。

旧业务路由保留。支付创建可以返回同一现存支付意图；退款审批返回已可靠落库的 REFUNDING/处理进度，外发交给 worker，客户端不把审批成功当作退款完成。新增用户支付进度读取和运营异常待办读取仅提供当前身份可访问的数据。接口合同在实施前写入 PRD。

## 2. 持久结构（由单一主责统一迁移）

| 结构 | 必要列和数据库约束 | 旧数据处理 |
| --- | --- | --- |
| Payment 扩展 | 首次渠道调用前固定 channel/providerMode、merchantScope、merchantOrderNo（已有唯一列）、providerConfigId/version；active boolean、resolutionState（NEW/UNKNOWN/CONFIRMED/CLOSED/MANUAL）、version int、nextQueryAt；订单最多一个 active 支付的部分唯一索引 | 保留所有旧记录；同订单多笔未结清/成功先产生冲突报告并阻止约束切换，不能挑一笔删除 |
| ChannelReceipt | id、channel、merchantScope、channelTradeNo、merchantOrderNo、paymentId/orderId nullable、amountCents>0、currency=CNY、evidenceHash、verifiedAt；唯一(channel,merchantScope,channelTradeNo) | 只对有可信证据的交易认领；单靠旧 SUCCEEDED 状态不伪造渠道证据；mock 样本明确标识来源 |
| Refund 扩展 | receiptId/paymentId nullable（expand）、resolutionState（NEW/UNKNOWN/CONFIRMED/REJECTED/MANUAL）、version、channel、merchantScope | 原交易关联不明确的旧退款进入待核验；FAILED 不自动推断渠道未退款；新退款必须显式绑定 receipt |
| RefundObligation | receiptId、orderId nullable、businessKey unique、cause、amountCents>0、state OPEN/PROCESSING/SATISFIED/MANUAL、owner、deadline、policyVersion | 成团失败/取消/晚到/额外到账的责任独立存在；未完成不能删或无期限挂起 |
| ReceivedEvent | source、merchantScope、eventKey、payloadHash、normalizedPayload、verificationMaterialId、verifiedAt、state；唯一(source,merchantScope,eventKey) | 入口验签后保存；旧通知没有保存证据的情况用查询/账单补证，不倒造回调 |
| DurableJob | kind、businessKey unique、payloadVersion、refId、state READY/RUNNING/RETRY/DONE/MANUAL、runAt、attempts、leaseOwner/leaseUntil、generation、errorClass | 支付/退款意图或事件与第一项任务同事务；无效版本转人工，不丢弃 |
| ReconciliationBatch | merchantScope、period、sourceHash、coverageState、createdAt；同scope/period/hash唯一 | 账单未生成/下载失败必须 UNAVAILABLE/INCOMPLETE，不记零差异 |
| FinancialCase | caseKey unique、category、sourceRef、owner、deadline、state OPEN/RESOLVED、resolution、reviewedBy/At | 重复导入不重复待办；负责人未配置时进人工阻塞清单，禁止真实放行 |

业务唯一索引仅用持久列，无 now() 谓词。外键采用限制删除，禁止资金记录 cascade 删除。事件/任务只保存最小关联、金额、币种、规范化状态和证据摘要，不复制手机号、openid、密钥或完整原始通知。

M1 不删除现有 `Order(userId,activityId)` 唯一约束。L1 的 registrationActive/capacityHeld、历史重报及其最低兼容 SHA 另一个切换包；不能借本包提前切换。

## 3. 统一事件决策

| 事件与前态 | 资金事实 | 履约/容量 | 后续动作 |
| --- | --- | --- | --- |
| 待付订单首次可信成功 | receipt 按渠道流水幂等写入 | 正常报名状态且有容量保障才进入待成团 | 等待成团截止；不立即要求最终桌位 |
| 同交易从回调/查询重复确认 | 复用 receipt，多来源可追溯 | 无重复改变 | 通知事件去重与业务效果去重分开 |
| CLOSED/CANCELED 后成功 | 仍保存 receipt | 不复活订单、不分配席位 | 对该receipt建立全额异常退款义务 |
| 同订单额外成功流水 | 独立 receipt | 不重复履约或占位 | 每笔额外款独立全额退款义务 |
| 下单/退款网络超时、响应落库失败 | 保留商户单号，UNKNOWN | 未可靠终结前不释放责任/退款预算 | 同业务号主动查；不删记录、不换号重试 |
| 回调先成功，旧执行随后失败 | 成功事实保持 | 不回退已确认状态 | version/前态条件更新失败即忽略旧写入 |
| 可信事件未找到本地记录 | 事件可靠保存，可建立未关联receipt | 不伪造订单 | FinancialCase认领/双向账单核对 |
| 退款成功 | 绑定原receipt记录结果 | 仅正常履约退款完成时更新订单；额外款退款不撤销合法履约 | 结清对应义务，不能顺带结清另一笔收款 |

晚到/额外到账默认全额退款是本包已获用户批准的业务策略。原退款政策函数对正常用户取消的 T-24 前后均要求人工审核；本包不自行扩大自动退款范围。阶段3再把活动失败/取消、草案重建和审核拒绝恢复接入同一机制。

## 4. 锁、幂等与调用顺序

0. 每个Payment意图在首次外发前持久绑定原channel/providerMode、merchantScope、merchantOrderNo及providerConfigId/version。配置标识只引用仓库外渠道材料，不保存Secret。查询、关单、退款及重试始终按原绑定解析渠道；全局provider切换不改变历史交易。原绑定不可用时保持UNKNOWN/MANUAL并待人工恢复，不能fallback、换scope或重新生成业务号。凭证轮换仅允许同一商户scope下经确认的材料版本映射。
1. 创建/复用支付：短事务按 Activity→User→Order 获取锁，重读合法前态，按 active 部分唯一约束获得唯一意图；同事务创建初始任务。API 不先请求渠道再落本地记录。
2. 退款：Activity→Order→receipt→按ID排序的Refund。以 receipt.amount 为预算，成功退款 + UNKNOWN/处理中占款 + 当前申请不得超额；额度检查和新意图必须同事务。绑定 receipt，禁止“最近一笔成功付款”。
3. 回调：限长原始字节→验签、证书标识/时间/商户/金额/币种/原交易关系检查→ReceivedEvent及消费任务事务提交→200/204。落盘失败返回失败；不在持锁事务里调用外部渠道。事件无法关联也保存并进入待办。
4. 异步消费使用同一个资金服务；不同eventKey但相同渠道流水只生效一次。相同eventKey却payloadHash不同，不覆盖原事件，另建冲突case。
5. 业务服务在事务内写 receipt/状态/义务/任务/审计。状态写入必须带 version/合法前态条件并检查影响行数。外部HTTP仅在事务提交后发生。

## 5. 独立 worker 的最低运行协议

- PostgreSQL短事务 `FOR UPDATE SKIP LOCKED` 领取到期任务；state=RUNNING、generation+1、leaseOwner、leaseUntil一起提交。只用于队列，不用于金额/容量统计。
- 租约30秒，外部HTTP超时10秒；按业务标识调用/查询，不生成新商户号。完成或重试写入必须匹配 id/generation/owner。租约过期后旧worker不能覆盖新worker的完成状态。
- A调用渠道后暂停，B接管时先查相同商户号，再决定是否重试；A恢复后的可信成功结果可交统一receipt幂等服务，但不得回写失效任务代次或重开履约。
- 自动查询重试最多8次，退避30秒起翻倍，上限30分钟；明确失败可以进入可重试分支，UNKNOWN不得释放资金占款。预算耗尽转MANUAL并生成24小时处理期限的case；无负责人配置则该环境禁止真实放行。
- 启动回收过期租约；SIGTERM停止领取并限时等待在途任务；超时退出由租约恢复。独立 `node dist/worker.js`，不是临时定时器或手工恢复脚本。
- 首版worker在本地使用持久mock渠道记录和故障注入；真实查询协议可编写离线fixture测试，但不得实际发请求。

## 6. 双向对账与恢复

本地意图查渠道 + 经商户scope/账期/摘要校验的账单反查本地；首版支持受控CSV/JSON导入和人工复核。覆盖：渠道有/本地无、金额或关联冲突、重复收款、本地成功渠道未确认、退款未收敛。导入仅产生证据/任务/case，不直接绕过资金服务修改最终订单。

备份恢复演练：仅专用可丢弃库。恢复后保持新收费关闭，重新导入恢复点以后渠道账单和未结清交易证据，验证缺失record/job能够重建，禁止仅重放本地队列后恢复收费。

## 7. 迁移和回退步骤

- Expand：新增可空关联和新表，不删除旧列/资金记录；现有数据只读预检查（重复active、金额负值、重复流水、退款找不到唯一原收款）。存在歧义即中止切换，保留报告。
- Migrate：离线mock样本可确定回填；真实历史一律待渠道证据/人工核验。测试回填重复运行幂等。对FAILED/未知退款保守保留占款。
- Cutover：所有资金写入统一走新服务，旧API/worker停止写入后才启用约束；保留兼容读取。发布真实环境另批，本地练习不能当生产批准。
- Rollback：先关闭新收费和旧不兼容写入者，保留新表/意图/事件；仅回退到经过验证、理解新增结构的兼容构建。bc25f5b含资金删除/未知回退缺陷，禁止作为安全回退基线。
- 本包尚无新提交SHA。实现后须另获Git提交授权，形成兼容提交C，记录源SHA、产物摘要、schema/API/worker/client组合并演练。无法提供C就不得通过G3，不虚构SHA。

## 8. 退出标准

并发20次下单/取消/审批；渠道已受理但响应超时；prepay落库失败；成功回调先于旧catch；应答后立即杀进程；事件落盘失败；未知关联；重复nonce/跨来源；CLOSED晚到、额外收款；worker A/B租约交错；退款预算竞争；渠道账单有而本地无；备份恢复缺任务。全部用专用PG、真实HTTP和持久mock事实证明，禁止删除断言或跳过DB测试换绿灯。

每个子包先新增故障断言，再最小实现；完成后独立codex-review。M1/M2/M3未全部通过前维持真实收费阻塞。原F编号逐条绑定新增测试和证据，不以此设计稿关闭台账。

## 专项确认内容（已获批准，见授权记录）

确认本包的新增结构/事务服务/worker/迁移实验授权，及“关闭后晚到或额外收款默认全额退款”“未知资金保守占款、8次后人工24小时待办”策略。批准仅用于本地模拟与可丢弃数据库；真实环境和收费继续分别审批。

## 专项只读技术复核

本轮独立复核接受一项补充：未知/未成功支付也必须持久绑定原渠道与商户scope，不能等receipt出现才记录；已补入结构表及锁协议第0条。所审租约代次、资金事实/履约分离、原收款退款预算及兼容回退边界未发现额外阻止本地分包实现的问题。复核不替代用户专项批准，迁移SQL/Prisma diff仍须实现前后一致性复核与隔离库测试。

## 用户授权记录

2026-09-29，用户对本文件及明确列出的本地Schema/资金/worker/对账范围回答：“批准按该设计继续本地实施”。A2 在上述范围内有效，后续不重复请求同一审批。真实微信、生产迁移、部署和收费均未因此获批。
