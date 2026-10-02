# A2 本地资金实施记录

2026-09-29。状态：本地实现与验证已更新，最终独立复核已完成且无待修复发现；A2尚待负责人签收，G1未通过。主责：本次Codex；独立复核：codex-review / review_s1。

授权：用户明确批准LOCAL_FUNDING_DESIGN.md。仅隔离工作副本、模拟渠道与可丢弃PostgreSQL；无真实微信请求、生产迁移、部署、收费或Git提交推送。HEAD仍bc25f5b，未提交代码按源码清单摘要识别，不将旧HEAD当作当前产物版本。

## 已实施

- 两项expand迁移（funding_recovery_expand、receipt_paid_at）：独立收款事实、退款义务、可信事件、持久任务、双向对账批次、异常待办与持久mock渠道；金额/状态/租约/active支付约束；资金FK限制删除；收款核心事实及可信付款时间不可修改。旧用户/活动绝对唯一约束保留。
- 支付在外发前持久保存原渠道、商户号、配置版本及任务。失败不删除；缺prepayId可查询原号再恢复；只有验签后的404/ORDER_NOT_EXIST视为明确不存在，普通404或网络异常仍UNKNOWN。已有参数与迟到结果均按版本、订单及MANUAL任务门禁重新检查。
- 成功收款独立于履约；CLOSED/CANCELED等晚到收款和第二笔到账各自全额退款义务，不复活订单。回调/主动查询保留可信success_time，及时付款但延迟消费仍可在当前合法占位下履约，缺时间的历史证据不伪造时刻。
- 退款审批只持久预留原receipt预算及任务。成功、处理中、未知结果均占款；使用同一商户退款号恢复。旧失败结果不能覆盖新成功；已审批退款失败后确认成功可以收敛。历史MANUAL退款禁止普通审批，避免漏算未关联历史退款。
- 回调验签及协议检查后，事件+任务同事务提交才ACK；worker统一应用资金状态。无法关联与冲突保留证据和待办。通知ID去重与渠道流水业务幂等分离。
- worker独立编译入口、SKIP LOCKED短事务领取、数据库时钟/30秒租约/generation、退避和8次预算、24小时人工待办。local-recovery仅显式local/ci+mock；events-only可在真实provider配置下消费已可信事件，不领取渠道外发任务。真实渠道自动查询/外发worker尚未启用。
- 受控JSON账单摘要校验导入与本地逐笔查询服务。失败保留INCOMPLETE，账单不可用不记零差异；发现渠道有本地无、冲突、重复收款及退款未收敛。编译CLI支持导入。
- 本地历史mock证据认领及有限待办结案CLI。认领匹配商户号/金额/渠道，保留原履约，全部未知历史退款继续占款；幂等、冲突原子失败。结案需要责任人+不同复核者及可验证终态，不自由改资金。详见LOCAL_FUNDING_RUNBOOK.md。

## A2阶段快照证据（127项；最终合并验证见文末）

| 检查 | 结果与证据 |
| --- | --- |
| 完整CI | **127 passed / 0 failed / 0 skipped**；evidence/tests-funding-clock.json逐条列出文件和断言 |
| 类型检查 | funding-clock-types退出0 |
| 构建 | 干净安装无旧dist完成Vite、weapp、shared、API构建；paidAt及队列时钟改动后移出旧API dist、重新生成Prisma并构建；未升级依赖 |
| 发布包 | pnpm deploy --prod，纯Node API/事件worker启动通过，无src/tsx；221产物摘要：artifacts-funding-clock.json；本地资金CLI能运行且拒绝production配置 |
| HTTP故障 | 真实loopback请求：prepay写入失败500→原单UNKNOWN+job保留→原号恢复200→MANUAL不返回参数 |
| 并发 | 20支付意图仅1商户号；20确认仅1receipt；20取消/20审批各只受理1；20退款预算竞争仅1成功 |
| 租约/资金副作用 | A请求渠道后暂停，B租约接管确认成功，A恢复不覆盖B；同一退款副作用1笔；超过预算无第9次渠道调用 |
| 付款时间 | 及时成功入站、超期消费仍可合法待成团；当前已关闭不复活；真正迟到进入处置；paidAt不可改 |
| 进程恢复 | 新6迁移库HTTP ACK后SIGKILL，独立编译events-only worker恢复receipt及待办；process-paidat.json；合成证书，无微信网络 |
| 备份恢复 | 实际pg_dump/pg_restore恢复前快照，record/job缺失，受控账单找回收款且重复导入幂等；restore-reconcile.json为首个expand版本演练；6迁移版实际备份恢复保留paidAt且仍拒绝改写，见restore-paidat.json |
| 迁移拒绝 | 历史重复支付/非正金额使迁移原子失败，原数据保留；migration-guard.json |
| 文案/敏感信息 | check:copy和check:secrets通过；最终diff空白检查通过 |

阶段源码快照：funding-clock-source-manifest.json。关键命令结果：commands-funding-clock.json。112/115/120/127项结果及对应旧产物是阶段历史快照；当前合并源码、141项测试与224项产物见stage4/2026-09-29/evidence，不以旧快照替代。发布包安装存在既有可选tsc bin与React peer告警；纯Node启动实际通过，不将告警当成全环境部署验证。

## 复核记录

1. 首轮接受并修复：可信回调无可运行消费者、失败后成功退款不收敛、耗尽任务重新审批假受理；补events-only worker和状态/待办门禁。
2. 后续接受并修复：缺prepayId永久processing、首次意图落盘尚未出站时无恢复、旧失败覆盖成功、退款对账漏原流水关联。HTTP及资金/协议定向回归通过。
3. review-prepay.log退出1：接受消费时间误判及时付款，新增paidAt迁移/协议/回归；重复库存到期缺口明确移交L1。review-paidat.log又提出可信查询金额冲突和真实收费负责人门禁两项意见；均已修复，review-last-fixes.log随后完成并发现退款任务耗尽展示问题，已在U1修复。
4. 人工复核历史成功退款仍MANUAL不能结案：仅SUCCEEDED+CONFIRMED幂等早返；可信证据可升级历史成功记录，测试通过。

测试中出现过ORM空update upsert并发唯一冲突、void advisory lock反序列化、新资金FK影响旧清理；均已按真实故障修复。新增paidAt初次测试旧精确返回断言遗漏该字段，补精确期望及非法时间断言后通过，未删断言或跳过DB。

## 留给后续包与放行门禁

- **L1 / F12–F13仍open**：到期关单、释放容量、有效订单约束与历史重报；设计已形成，等待专项确认。不能在A2删除旧唯一约束或释放未知资金来绕过门禁。
- **L2仍open，U1本地自动化已补齐**：成团失败/取消、排桌恢复、退款拒绝后合法去向及用户订单找回/操作入口；G1不能提前通过。
- **生产能力未验收**：真实恢复worker的渠道解析/外发、证书轮换、微信网络/身份/支付退款、商户模式账单逐笔核对、真实历史认领、小程序IDE与设备QA。
- **一般运营待办未闭环**：完整处理UI、人工重新授权重试预算、复杂资金/履约冲突复核属于后续工作；本地CLI只处理已有可验证终态。
- **兼容回退SHA尚缺**：未获Git提交授权，不虚构版本。G3受兼容提交、产物/迁移/客户端组合和实际回退演练约束。

## 回退与隔离

专用容器fanju-stage2-20260929，loopback 32771/tmpfs；未访问或清理本机5432。各测试只清理自己的schema/前缀，进程演练使用专用数据库。

回退停止新增资金写入，保留事件/任务/receipt/退款预算；bc25f5b不是资金安全回退版本。只撤销本包hunks，保留阶段0/1及用户未提交工作；不reset/clean，不drop资金表，不恢复不兼容旧写入者。生产操作另批。

## 最新复核修复与验证

- 可信查询确认成功但金额不符：仍保存实际receipt及AMOUNT_CONFLICT，Payment进入MANUAL，不履约、不生成新支付；返回requiresReview。
- 退款恢复按渠道返回originalTradeNo核对原receipt，不再用本地原交易号替代渠道结果。错关联保留UNKNOWN及预算，生成REFUND_FACT_CONFLICT，不结清义务。
- NEW_PAYMENTS_ENABLED=true同时要求非空且非占位的FINANCIAL_CASE_OWNER；启动校验和逐请求门禁均执行。缺负责人仍可保留停止新收费下的合法回调恢复，但不准开启新收费。
- 最新20项定向测试与全仓类型检查通过。A/B测试出现一次barrier超时，fixture改为明确已到期任务并对A提前退出报错，未降低业务断言或延长测试超时。
- review_s1代理触及使用额度限制。已用同一codex-review命令/同一模型直接重新执行，不切换模型，不将未完成复核记为clean。

- 完整CI曾有5项队列失败，首个任务默认使用应用时钟而领取使用数据库时钟，任务短暂不可领取并污染后续测试。默认runAt改为数据库clock_timestamp，显式调度时间保持不变。新增应用时钟快一小时的回归；8项队列测试和127项完整CI全部通过，保留原断言。全仓类型检查、真实HTTP状态探针、文案/敏感扫描、diff检查通过。
- 最新编译API发布包api-funding-final纯Node API/事件worker启动通过，221个产物摘要已保存；独立复核尚未返回最终结论。

- 队列时钟回归做了反证：仅在独立构建副本临时恢复旧enqueue实现，应用时钟快一小时的新增断言失败（clock-regression-before退出1）；finally已恢复修复版。正常完整CI仍零跳过。此次反证的-t筛选未执行其余7项，不用于全量通过统计。

## 退款通知协议最终增量

国内退款通知无currency字段；公共解密已拆分支付/退款币种校验，支付必须CNY，退款允许省略且拒绝显式非CNY，原收款币种与商户/原交易号/金额/预算校验保留。官方四字段样例通过真实PG持久事件及退款状态应用。37项定向、141项全量CI（零失败/跳过）、全仓类型、文案和敏感扫描通过。新干净API编译及api-refund-protocol纯Node API/事件worker启动通过，224项产物摘要见stage4证据。最终独立复核仍进行中。

履约展示补充：已确认收款仍可有未结案FULFILLMENT_REQUIRES_REVIEW；U1按订单receipt查待办并显示待核查，禁用续付。31项API数据库测试、142项完整CI、全仓类型/扫描通过，新api-fulfillment-display发布包纯Node启动通过。最终证据以stage4为准，review-fulfillment-display进行中。

最终结论：review-fulfillment-display.log退出0，无仍需修复发现；此前“进行中”字样为阶段过程记录。最新142项全量CI、源码/224项产物和复核证据统一见stage4/2026-09-29/evidence。A2本地交付完成复核，不代表真实渠道能力已验收或G1通过。
