# FJ-POLICY-V1.1｜候选工作包与授权边界

日期：2026-10-01；版本束 `FJ-POLICY-V1.1-20261001-REBASE-01`；状态 `REBASED_DRAFT`。本轮仅文档重基线，技术实施 `PROPOSED`、验证 `NOT_RUN`，不启动新的WP。
依据：[冻结输入](sources/FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md)，`FJ-DR01-DR02-DECISIONS-20261001-V1`，`APPROVED_AS_BUSINESS_INPUT`；基线 `FJ-BUSINESS-BASELINE-20261001-V1.1`。15项业务决定已冻结，不等于整个DR01/DR02或WP03/04/05/06获批实施。
实际代码身份、104条差分和现有测试见POLICY_GAP_ANALYSIS.md；OP/RV当前状态见OPEN_DECISION_REVIEW.md；资金/事件/迁移契约见POLICY_TECH_DESIGN.md。

## 1. 依赖和授权

WP编号沿用原十包名称，依赖优先于编号：
WP10的V1.1版本适配设计先行（历史WP10-A仅支持V1.0）；WP03资金/席位技术契约与WP02供给技术契约共同冻结；WP01最小资料方案与QA可同步准备。
WP04/05共同冻结队列/成员/桌事件，不互相等待代码全部完成；资金组件基础后分小批集成。
WP06依赖资金与席位事实，WP07依赖普通/争议分流，WP08依赖变更/送达契约；WP09贯穿资料与未结义务。
最终WP10汇总同范围验收，不能留到最后才绑定政策。

每包唯一真实主责人和独立复核人待团队指派，表内角色不是已经投入的人。一个CTO/Schema负责人统筹共享状态/约束，不允许各线另改同一资金语义。
前端契约冻结后并行，QA故障注入从设计阶段开始。餐厅、商户、域名及部署资料可并行准备，但本轮不外部操作。

## 2. 工作量口径

下面仅为范围估算，非审核通过工期；设计/本地实现/QA人日分别列出。实际可投入人数、可用时间、复核与返工、平台/商户/餐厅等待均未知。
不把人日直接换成日历周数，不将原8—12周视作冻结排期。阶段0/设计批准后由团队拆到可复核小包，再补实际人名、工作量、日历依赖、平台等待和风险缓冲。

本V1.1新增范围的验证均为未来计划，当前全部NOT_RUN；历史WP10-A结果仅按第4节保留，不继承为本版结果。DB测试必须先确认可丢弃隔离schema、完整Mock配置及脚本只清自身前缀；真实身份/支付/退款、生产迁移、部署、收费、Git提交/推送另行授权。

## 3. 十包任务定义

### WP01 用户资料最小化

- 目标：停止新旧画像必填，时间选填；性别/成年方式及最小适配仅按获批方案。保留历史订单快照。
- 实际拟修改入口：services/api/src/app.ts（profileInput/订单/预支付）；prisma/schema.prisma（UserProfile/Order）；apps/miniapp/src/api.ts；apps/miniapp/src/pages/profile/profile-form.ts及index.tsx；apps/ops/src/candidate-profile.ts。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：WP10版本契约；DR-05、OP-10/15、RV-04/05/07；新增字段/持久格式专项实施批准。
- 验收断言：BR-AT-01—08、RB-AT-07；空时间仍报名；旧快照不变；需要专门保障在创建订单/支付/续付前阻断。 本轮NOT_RUN。
- 排除项：不drop历史，不采出生日期/身份证/病史，不凭手机号认成年。
- 隔离验证：隔离Mock身份/价格；纯表单+API真实隔离DB测试待专项授权。
- 回退影响：切换前可回到经实测旧读取；新同意/资料语义写入后不可假定旧版本可写。
- 建议责任/复核：产品/隐私主责；CTO；QA独立复核；实际人员未提供。
- 工作量范围/未知：设计2—4人日；本地实现4—8；QA2—4；成年/性别评审及历史兼容未知。

### WP02 餐厅逐场供给

- 目标：供给/费用/容量签收驱动本场收费资格；餐厅逐活动从有限可审计标准策略选择，确认min/target/max/maxTables/策略revision（DR02-05）。D由餐厅提出、平台审核生效；D_MIN/D_MAX机制已定、数值TBD，真实收费前正式配置签收（DR01-06—08）。
- 实际拟修改入口：services/api/src/app.ts（餐厅/活动/发布/输入）；prisma/schema.prisma（Restaurant/Activity/TableGroup）；apps/ops/src/SupplyForms.tsx；apps/miniapp/src/pages/activity-detail/index.tsx。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：WP10报价/政策契约；OP-03剩余数值/收款主体与OP-09，DR-03/RV-07（OP-06业务决定已关闭，技术实现仍待审），真实餐厅授权/签收路径；供给结构实施批准。
- 验收断言：BR-AT-10—16/51；无签收不收费；4≤min≤target≤max≤8；maxTables封顶；固定费变更需同意；未批准D revision/范围数值不得收费、普通配置不可越界，策略不可由运营静默改写；DR-AT-06—08/14。 本轮NOT_RUN。
- 排除项：不建设完整商户后台，不代签餐厅，不增自动分账。
- 隔离验证：全用合成餐厅；权限跨餐厅/场次；正式供给签收只由实际餐厅完成。
- 回退影响：保留revision历史；回退不能覆盖旧承诺或继续无有效签收收款。
- 建议责任/复核：餐厅合作/运营主责；CTO；产品/QA复核；实际人员未提供。
- 工作量范围/未知：设计3—5；实现5—10；QA3—5人日；餐厅等待、签收载体和费用资料未知。

### WP03 F/D资金与处置基础

- 目标：一笔合并F+D、组件独立原支付映射与处置；D退款/预留/待结/实付、未知恢复/双向对账。完整可信实收才形成正式/付费候补资格，待付不计min；正式待付占位绝对10分钟，UNKNOWN不续占，到期后成功全额原路退、不追回席位。F默认/活动覆盖、D批准revision和价格快照不追溯。
- 实际拟修改入口：prisma/schema.prisma；services/api/src/funding/intents.ts、receipts.ts、refunds.ts、prepay.ts、recovery.ts；services/api/src/orders/inventory.ts；services/api/src/events/inbox.ts；services/api/src/jobs/queue.ts；services/api/src/reconciliation/service.ts、cases.ts；services/api/src/worker.ts。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：WP10版本；DR01-01—09已冻结部分；OP-03剩余数值/主体、OP-04成员移除时点、OP-14及RV-01/06；原渠道能力、事务/迁移/回退专项批准。合并支付无需再次作为待选业务方案，但不能据此开工资金改造。
- 验收断言：BR-AT-09/55/57/58，RB-AT-01—04/12；退D后全退只补F；未知占预算；旧worker恢复不能覆写；争议D禁结算；库存可合法释放但义务不消失；DR-AT-01—09逐项覆盖完整实收、10分钟UNKNOWN释放及迟到原路全退、价格审批/范围和业务保留。 本轮NOT_RUN。
- 排除项：不切真实支付/退款、不默认账户或金额、不创造托管/钱包；真实结算单独授权。
- 隔离验证：可丢弃PostgreSQL+持久Mock渠道、杀进程/租约/回调失败/双向账单合成数据；本轮未执行。
- 回退影响：扩展→回填→切换；最低新语义兼容SHA待产生。新金额事实后只能兼容回退/前向修复，不能删记录。
- 建议责任/复核：资金/CTO共同主责，单一Schema统筹；QA/财务独立复核；实际人员未提供。
- 工作量范围/未知：设计4—8；实现12—22；QA/故障恢复6—10人日；渠道/财务/翻案方案等待另计。

### WP04 付费候补

- 目标：完整可信付款后的候补独立身份、有效资格FIFO、自动转正、退出/T-24全退；逐活动WAITLIST_MAX，满额禁止新增候补支付；合资格主动退出重入排新队尾。金额敞口上限与默认人数数值仍待决。
- 实际拟修改入口：services/api/src/app.ts（订单/取消/详情）；services/api/src/orders/inventory.ts、formation.ts；services/api/src/jobs/queue.ts、worker.ts；prisma/schema.prisma；apps/miniapp/src/api.ts及activity-detail/order-detail。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：WP02供给、WP03组件资金；WP05成员/桌契约共同冻结；OP-04剩余成员移除、OP-05其他资格时钟/排序、OP-08剩余数值/交叉资格、OP-11；DR02-04/06冻结部分。支付在途与满额竞争不得自行补结论。
- 验收断言：BR-AT-22—26/63，RB-AT-10；同刻退出/晋升唯一结果；队首不利软目标仍FIFO；资格结束与到账分开；DR-AT-13/15：服务端权威事务退出先则全退且不晋升，晋升先按正式类别取消；满额拒绝新候补支付，重入生成队尾新序号。 本轮NOT_RUN。
- 排除项：不恢复T-24后旧队列，不任意定默认数值/剩余交叉资格，不将静态候补文字当实现。
- 隔离验证：合成满桌/多人队列、DB时钟和同步屏障并发；无真实候补收费。
- 回退影响：历史候补/序号及义务不可丢；旧版本不理解新角色时禁止业务写。
- 建议责任/复核：产品/CTO主责；资金/QA复核；实际人员未提供。
- 工作量范围/未知：设计2—4；实现6—10；QA4—6人日；其他资格时钟/同刻排序、默认上限数值、在途支付竞争未知；取消等号和退出晋升顺序已定。

### WP05 自动可逆成团与地址

- 目标：逐桌达min自动形成/补至max/失效恢复；T-24终局、晚报名/T-8低人数；本人本桌地址即时授权。
- 实际拟修改入口：services/api/src/orders/formation.ts、inventory.ts；services/api/src/app.ts（group/订单/visibility）；packages/shared/src/rules/table.ts、order.ts、activity.ts、addressUnlock.ts；prisma/schema.prisma；apps/ops/src/App.tsx；apps/miniapp/src/pages/order-detail/index.tsx。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：WP02/03，WP04队列契约；OP-04/05剩余问题、OP-07、RV-03/07；OP-01/02/06业务决定已关闭；自动/可逆状态契约专项批准。
- 验收断言：BR-AT-13—21/27/28/35/36/60/61；形成/失效/恢复历史；T-24未成团失败不复活；当时有效成团后在T-8前失效可直接补招、达min恢复、不恢复候补；当前失效取消按未成团；DR-AT-10/11/14；多桌地址隔离；T-8关窗，任务延迟不制造扣费。 本轮NOT_RUN。
- 排除项：不重写旧成团事实，不用LLM排桌，不为性别跳队；不得把T-24已失败桌套入失效补招规则；T-8不足仍受OP-07/RV-03约束，失效桌新加入者类别仍OP-05。
- 隔离验证：合成多桌/不同revision与受控时钟，成员变化并发；保留原越权测试。
- 回退影响：新事件和类别旧API不可安全写；回退最低SHA与成员检查实测。
- 建议责任/复核：产品/CTO主责；餐厅合作/QA复核；实际人员未提供。
- 工作量范围/未知：设计3—6；实现9—16；QA5—9人日；T-24恰好加入/失效桌新加入类别和低人数后期例外仍未知，已冻结补招/当前状态规则不再列待决。

### WP06 取消退款与批次

- 目标：单一决策表承接普通/晚报名/候补/失败/责任/特殊例外，可信服务端原acceptedAt锁定取消档位和次日批次。DR02-03普通未成团Δ≥24全退、8≤Δ<24保F退D、0<Δ<8保F/D；晚报名适用者Δ≥8保F退D、0<Δ<8保F/D，后两类既有餐厅D处置不改。当前失效按未成团；普通当前已成团Δ>24保F/D且D=PLATFORM_RETAINED，不直接确认会计收入。
- 实际拟修改入口：packages/shared/src/rules/refund.ts、pricing.ts；services/api/src/app.ts（cancel/approve/reject）；services/api/src/funding/refunds.ts；services/api/src/jobs/queue.ts、worker.ts；apps/miniapp/src/pages/order-detail/index.tsx；prisma/schema.prisma。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：WP03组件预算，WP04/05事件；OP-04成员移除、OP-05剩余资格边界、OP-09/11/14，RV-01/06；取消等号及acceptedAt已冻结，特殊/争议时钟尚需各自决定。
- 验收断言：BR-AT-29—35/46/47/53—55/58/62；RB-AT-01/02/11；T-25取消T-20拒绝仍原档；退款批准≠到账；因平台原因点退出仍全退。 本轮NOT_RUN。
- 排除项：不任意比例退款、不过早侵蚀48h，不改变原异常实收保障；不真实退款。
- 隔离验证：完整F/D矩阵与已冻结等号/原acceptedAt断言（DR-AT-09/11/12）、午夜批次/任务重跑/未知结果；隔离DB。
- 回退影响：保护既有退款和未结预算；旧整笔退款路径不能处理新D订单；先停新收费再兼容修复。
- 建议责任/复核：产品/资金/CTO主责；运营/QA复核；实际人员未提供。
- 工作量范围/未知：设计3—5；实现7—12；QA4—7人日；批次时刻/特殊时限/自动义务审批未知。

### WP07 扫码、履约及两轮争议

- 目标：受控餐厅确认、扫码到店事实、漏确认待办、可靠送达/两次48h、一次真实异人复核和D结算准入。
- 实际拟修改入口：services/api/src/auth.ts、admin-auth.ts、app.ts；services/api/src/orders/formation.ts（通知基础）；services/api/src/jobs/queue.ts、worker.ts；services/api/src/reconciliation/cases.ts（仅参考真实异人基础）；prisma/schema.prisma；apps/miniapp/src/pages/inbox/index.tsx及order-detail；apps/ops/src/App.tsx。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：WP03/06，WP02实际确认载体；OP-11/12/13/14/15、RV-02/05；真实不同审核人和权限/送达审批。
- 验收断言：BR-AT-37—45/64、RB-AT-04—06/11；扫码非正常完成；无送达不开不利时钟；申请复核和期满结算互斥；餐厅跨场拒绝。 本轮NOT_RUN。
- 排除项：不默认GPS/人脸，不让商家直接扣D，不把两个AI身份当两个实际人，不自动默认违约。
- 隔离验证：合成二维码/案件/离线通知；Mock结算；真实两人演练后申请运营签收，无真实敏感材料。
- 回退影响：争议/说明/收到/决定事实保留；回退不能提前放D，未兼容则停止不利自动任务并保合法申请。
- 建议责任/复核：运营/CTO主责；法务/隐私/资金/QA复核；实际人员未提供。
- 工作量范围/未知：设计4—7；实现12—20；QA7—12人日；送达证据、材料、当晚/止挂、人力SLA未知。

### WP08 换店与核心变更

- 目标：不可变原新安排、动态deadline、明确同意/静默拒绝、全退/原餐厅补偿；低人数专门例外明确隔离。
- 实际拟修改入口：services/api/src/app.ts（restaurant/activity/cancel）；services/api/src/orders/formation.ts；services/api/src/funding/refunds.ts；prisma/schema.prisma；apps/miniapp/src/pages/activity-detail/index.tsx、order-detail/index.tsx、inbox/index.tsx；apps/ops/src/App.tsx。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：WP05/06及WP07送达/通知；OP-07/09/13、RV-03；原新T/补偿对象与范围冻结。
- 验收断言：BR-AT-49—51；不回应不accepted；不覆写已接受价格/T；自主点菜超预算与固定费改变分开。 本轮NOT_RUN。
- 排除项：不把所有未成团都加补偿，不单方改用户已接受供给。
- 隔离验证：合成替代场景、期限/双击/过期回复、并发取消/变更；Mock资金。
- 回退影响：保留原安排和每人结果；回退不可改回用户未接受的安排，合法退款义务继续。
- 建议责任/复核：产品/餐厅合作/CTO主责；运营/QA复核；实际人员未提供。
- 工作量范围/未知：设计2—4；实现6—10；QA3—5人日；动态期限/责任补偿/改期权益未知。

### WP09 隐私权利与最小化

- 目标：实际资料/共享/留存、受控例外材料、注销处理中和恢复重放，资金/历史证据保留。
- 实际拟修改入口：services/api/src/app.ts（profile/consent/订单）；services/api/src/auth.ts；prisma/schema.prisma；services/api/src/reconciliation/service.ts；services/api/src/worker.ts；apps/miniapp/src/pages/profile/index.tsx、order-detail/index.tsx。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：OP-10/15、RV-04/05，真实服务商/材料渠道/留存期限；WP01及WP03/07未结义务契约；隐私处置实施批准。
- 验收断言：BR-AT-48/56；RB-AT-07/12；未结D仍受理注销；资料处置不删实收；恢复备份不复活已删除材料。 本轮NOT_RUN。
- 排除项：不自动删除历史/资金，不读真实用户资料，不新增未批材料/共享对象。
- 隔离验证：合成资料/案件+可丢弃备份；权利访问、撤销/恢复与最小化日志演练。
- 回退影响：隐私删除不能简单回退复活；不可变处置指令备份重放；保留资金义务可查询。
- 建议责任/复核：隐私/产品/CTO主责；法务/安全/QA复核；实际人员未提供。
- 工作量范围/未知：设计3—5；实现7—12；QA4—7人日；实际服务商/期限/终态访问未知。

### WP10 政策版本、文案与验收总控

- 目标：先冻结政策束/报价/供给/正文全文契约，贯穿各包；最后汇总新范围同产物门禁。
- 实际拟修改入口：services/api/src/orders/agreement.ts；services/api/src/app.ts（current agreement/consents/订单）；prisma/schema.prisma（AgreementPolicy/ConsentRecord/Order）；apps/miniapp/src/api.ts、activity-detail/index.tsx；docs/policy/六主文件；docs/stage5/2026-09-29/FROZEN_VERSION_MATRIX.md；AGENTS.md/PRD.md/docs/PROJECT_CONTEXT.md后续批准同步。函数/API/model/test定位参照差分E域；新增结构/API见技术设计，均PROPOSED。
- 前置批准/依赖：DR-06；每项必要OP/RV/文本整版签收；正式启用另批。首批纯本地子包可在其明确批准后做，不需先通过真实支付上线评审。
- 验收断言：BR-AT-59、RB-AT-08/09；完整三正文hash/历史同意不覆写；草案不能生效；旧Gate不能继承；真实构建与产物/迁移/worker/小程序/政策版本一致。 本轮NOT_RUN。
- 排除项：不代法务/餐厅签收，不自动启用政策，不为全绿降低测试，不一次性授权全计划。
- 隔离验证：纯离线校验先行；随后版本持久化DB演练和真实Vite/Taro产物须对应任务授权。
- 回退影响：历史全文/hash/确认原样；政策切换与代码回退分开，最低兼容新政策SHA待实测。
- 建议责任/复核：项目负责人/CTO主责；QA/产品/法务/资金/隐私签收各自范围；实际人员未提供。
- 工作量范围/未知：首批设计/实现/单测2—4人日；完整版本整合设计3—5、实现5—9、QA3—6；发布/平台等待另计。

## 4. 历史WP10-A与V1.1适配边界

WP10-A已在历史V1.0中实现纯离线完整性/阻断校验，详见[WP10-A审核材料](WP10_A_REVIEW.md)。其固定束为 `FJ-POLICY-V1.0-20260930-REBASE-01`，固定当时基线/UA/PN/RF摘要、104规则ID、15项OP均OPEN和7项RV均REVIEW_REQUIRED。历史材料记录52项单测与共享类型检查通过；用户已授权将当时已验收的V1.0本地范围固化归档为 `0032008`。V1.1支持未实施、未验收，不能继承历史启用资格；没有DB、迁移、真实构建或外部调用证明，不能启用政策。

已存在的 `packages/shared/src/rules/policyBundle.ts` 与 `policyBundle.test.ts` 本轮不改。它们不支持V1.1；旧测试fixture仍读取当前docs路径，文档重基线后不得把旧52项通过结果沿用为新版本通过。本轮不运行或改写旧测试以追求全绿，也不重定向旧常量。历史报告保留原适用版本。

### 下一份可评审的最小技术任务（尚未授权）

设计V1.0历史输入隔离及V1.1版本适配，再列精确源码/测试清单申请实施。适配须验证：新束及基线ID、正文集合和UTF-8摘要、规则索引、15项冻结决定的来源映射、当前OP/RV状态；版本混用或未知来源审批要拒绝。`REBASED_DRAFT`即使完整仍不能activate。hash仅证明完整性，不能代替业务、法务、技术或收费授权。

当前登记：OP-01/02/06=CLOSED；OP-03/04/05/08=PARTIALLY_CLOSED；OP-07/09/10/11/12/13/14/15=OPEN；RV-01—07全部REVIEW_REQUIRED。关闭的是指定业务问题，不是实现验收。DR-AT-01—15分别覆盖DR01-01—09、DR02-01—06，全部NOT_RUN；原BR-AT-60—63更新冻结目标也仍NOT_RUN。

V1.1适配未实施、未验证、不可启用。后续纯校验子包如获明确批准，可仅运行其离线测试/共享类型检查；DB/API/持久版本/生产生效、资金/席位改造均另按具体实施范围批准。不能将本次文档重基线扩大为WP03/04/05/06开工。

主责人/独立复核人及适配工作量待指定；历史估算不能自动成为本版排期。回退需保留两版输入、原报告和历史实现，不删除资金/同意记录；V1.1最低兼容回退SHA为NOT_AVAILABLE。

## 5. 后续放行证据清单

| 门禁 | 新范围最低证据 | 当前 |
| --- | --- | --- |
| G0 | 安全身份/配置隔离、真实Vite/Taro打包及干净产物运行/导入、API/worker独立产物启动 | 本轮NOT_RUN，旧证据需查同版本 |
| G1 | 新P0：F/D、候补、合法桌位、退款/争议、订单找回、崩溃恢复全部通过 | 未通过本轮验收 |
| G2 | G1+实际商户/协议加固+人员/环境/金额专项批准+逐笔真实支付退款/查询/对账 | 未授权 |
| G3 | 必需P1、实际运营全流程、文本/餐厅/资金/隐私签收、迁移兼容与恢复、候选产物 | 未授权 |
| G4 | G3+白名单收费批准+人数金额限制/值班/停止条件；无未关P0 | 未授权 |
| 公开放量 | 完整履约/退款观察、对账和异常收口 | 未授权 |

政策批准不是代码实施/部署/收付批准；本地代码通过不是正式政策或餐厅签收。最低可回退新政策SHA仍NOT_AVAILABLE，必须产生真实提交及实测结果，不拿bc25f5b或旧兼容SHA冒充。

本轮文档重基线完成后提交人工审核。任何开发、迁移/测试扩大或真实渠道操作，均按下一份具体授权范围执行。
