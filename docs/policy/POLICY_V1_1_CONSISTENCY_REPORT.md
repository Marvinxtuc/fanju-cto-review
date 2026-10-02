# Policy Rebase V1.1 一致性报告

## 1. 结论和执行边界

**15项已确认业务决定已合入六份主文档、OP/RV、技术设计、工作包和追溯索引。文档一致性检查通过；整版仍为REBASED_DRAFT，等待人工审核。** 本报告不代表业务实现、专业评审、政策启用或收费放行。

| 项目 | 实际事实 |
| :--- | :--- |
| 任务 / 日期 | FJ-POLICY-REBASE-V1.1 / 2026-10-01 |
| bundle | FJ-POLICY-V1.1-20261001-REBASE-01 |
| 状态 / 启用资格 | REBASED_DRAFT / NOT_ACTIVATABLE；无生效日 |
| 工作区 | /Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局 |
| 分支 | codex/fanju-stage0-baseline |
| 起始和结束HEAD | 003200820922d11b374b84a9e756d4d763bea3f2 |
| 初始状态 | 干净；未切换历史提交、清理或覆盖用户改动 |
| 上游文件 | sources/FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md |
| 上游ID / 状态 | FJ-DR01-DR02-DECISIONS-20261001-V1 / APPROVED_AS_BUSINESS_INPUT |
| 上游SHA-256 | 0268f125663f3a31f9ebb0c8c49870bb2f3df9d47776e2c54439f162b1508743 |
| 本轮范围 | 仅docs/policy；无业务源码、Schema、migration、API、worker、前端、依赖或运行配置变更 |
| 测试 / 外部 / Git | 未运行源码测试、DB、migration、构建、真实微信/资金、部署、提交或推送 |

APPROVED_AS_BUSINESS_INPUT只批准15项业务选择；七项RV、政策版本签收、技术实施、运行验收及真实收费是独立证据，不自动通过。

## 2. 15项决定逐项核对

“对齐”指上游→基线→派生政策→候选设计/依赖→验收目标的文字和索引已经核对；实测仍NOT_RUN。完整文件、条款及行号见TRACEABILITY_INDEX.json。

| 决定 | 采用内容 | 基线规则 | 验收目标 | 文档 / 执行 |
| :--- | :--- | :--- | :--- | :--- |
| DR01-01 | 一笔F+D支付，支持独立退款/归属，D已退后全退只补F；M直付餐厅 | FEE-01, FEE-02, REF-06, REF-07, REF-08 | DR-AT-01 | 对齐 / NOT_RUN |
| DR01-02 | 未付/失败/UNKNOWN不计正式成员/min；完整可信成功后按容量及候补开放取得资格 | FORM-01, WL-01, WL-02, WL-05 | DR-AT-02 | 对齐 / NOT_RUN |
| DR01-03 | 需要正式席位的待付订单临时锁位10分钟，非正式成员 | FEE-01, FORM-01 | DR-AT-03 | 对齐 / NOT_RUN |
| DR01-04 | 绝对10分钟释放；未知继续查询；随后成功保存实收、F+D原路全退，不抢席位、不超售 | FORM-01, REF-07 | DR-AT-04 | 对齐 / NOT_RUN |
| DR01-05 | 活动覆盖优先、付前显示、成功报名价格快照不追溯；默认金额TBD | FEE-03, USR-05 | DR-AT-05 | 对齐 / NOT_RUN |
| DR01-06 | 有效提议/确认及平台审核是收费前置；餐厅不能直接改价，版本不追溯 | FEE-04, VEN-01, VEN-05 | DR-AT-06 | 对齐 / NOT_RUN |
| DR01-07 | D_MIN≤D≤D_MAX，普通配置不可绕过，特殊审批另行设计授权 | FEE-04 | DR-AT-07 | 对齐 / NOT_RUN |
| DR01-08 | D_MIN和D_MAX均TBD，正式配置与签收前不得真实保证金收费 | FEE-04 | DR-AT-08 | 对齐 / NOT_RUN |
| DR01-09 | 普通有效成团Δ>24h自退F/D不退，D业务平台保留、不进本场餐厅补偿；RV01/06继续复核 | REF-02, REF-08 | DR-AT-09 | 对齐 / NOT_RUN |
| DR02-01 | T24已成团后失效桌记历史直接补招至T8，不候补；达min恢复；T8不足转既有餐厅流程 | FORM-07, FORM-08, FORM-10, FORM-12, FORM-14, INFO-01 | DR-AT-10 | 对齐 / NOT_RUN |
| DR02-02 | 曾成团当前失效者按当前未成团阶梯；保留历史，不永久以曾成团扣留 | REF-03, FORM-06 | DR-AT-11 | 对齐 / NOT_RUN |
| DR02-03 | 普通未成团Δ≥24h全退，8≤Δ<24只退D，0<Δ<8全不退；晚报名Δ≥8只退D；acceptedAt不重算 | REF-01, REF-02, REF-03, FORM-11, FORM-12 | DR-AT-12 | 对齐 / NOT_RUN |
| DR02-04 | 退出先全退且不转正；转正先正式类别处理取消；同一权益仅一个结果 | WL-06, WL-10, FORM-04, FORM-05 | DR-AT-13 | 对齐 / NOT_RUN |
| DR02-05 | 有限标准策略餐厅逐场签收revision；硬容量/FIFO/有效顺序优先；不能优化拆桌 | VEN-04, VEN-05, VEN-06, FORM-01, FORM-02, FORM-08, USR-08, USR-09 | DR-AT-14 | 对齐 / NOT_RUN |
| DR02-06 | 有效人数<WAITLIST_MAX可开放，≥即不建新支付；主动退出合法重入新FIFO末尾，默认数字TBD | WL-01, WL-03, WL-05, WL-06, FORM-04 | DR-AT-15 | 对齐 / NOT_RUN |

### 2.1 时间、资金与状态关系

- F+D合并一笔，F/D分别快照、退款和处置。已退D后合法全退仅补尚未退F；累计已退、在途及UNKNOWN预留不重复占预算。M由用户直付餐厅。
- 正式待付锁位绝对10分钟，不计正式成员/min。UNKNOWN到期释放，继续资金查询恢复；晚到可信成功保存实收、两项原路全退，不恢复席位或超售。
- 仅T-24时已有效成团、随后T-8前失效的桌继续直接补招，保留FORMED/INVALIDATED/RESTORED历史、不恢复候补、不复活T-24失败桌。T-8仍不足转餐厅流程，OP07/RV03细则仍待。
- 按可信acceptedAt时当前实际成团状态和已确定类别判取消。普通未成团Δ≥24h全退；8h≤Δ<24h仅退D；0<Δ<8h两项不退。适用晚报名Δ≥8h仅退D、0<Δ<8h两项不退。已到开始时刻/No-show沿用独立规则。
- 普通当前有效成团Δ>24h主动取消两项不退，D=PLATFORM_RETAINED；不进本场餐厅补偿，不确认为会计收入。既有普通成团Δ≤24h、晚报名不足8h等D归餐厅口径未被本轮改变。
- 候补退出/转正按服务端有效事务顺序唯一生效；到限/上限未配置不新建候补支付；合法主动退出重入为新FIFO尾位。

复核已收紧FORM-11及TECH的晚报名指代：直接加入有效已成团桌且已确定晚报名类别者才适用该例外。失效桌新加入类别、恰好T-24新加入、报名截止后但未满10分钟成功，以及FIFO时钟/同刻排序、取消退款受理成员移除时点，仍保留OP04/05。取消等号冻结不解决报名分类。

## 3. OP/RV变化

| OP | 原状态 | 当前状态 | 依据 | 保留的剩余问题 |
| :--- | :--- | :--- | :--- | :--- |
| OP-01 | OPEN | CLOSED | DR02-01 | 主体选择无剩余；T-8h后接待细则仍在OP-07/RV-03，技术实现待验证 |
| OP-02 | OPEN | CLOSED | DR02-02 | 主体选择无剩余；历史事件保留，原请求权益不能因审核延迟重算 |
| OP-03 | OPEN | PARTIALLY_CLOSED | DR01-05/06/07/08 | F默认具体金额、D_MIN/D_MAX数值、实际收款主体/凭证/开票/账户待定或待核 |
| OP-04 | OPEN | PARTIALLY_CLOSED | DR01-01/02/03/04 | 取消/退款受理何时移除正式成员等交集尚未确定；不能沿用旧退款状态集合猜测 |
| OP-05 | OPEN | PARTIALLY_CLOSED | DR02-03/04；DR01-02/04 | FIFO生效时钟及同刻稳定排序、恰好T-24h新加入类别、未满10分钟但报名截止后收款、失效桌新加入者类别等未覆盖交集 |
| OP-06 | OPEN | CLOSED | DR02-05 | 主体选择无剩余；具体策略枚举/分配实现为技术设计，真实逐场确认与验收另行完成 |
| OP-07 | OPEN | OPEN | 未被本轮关闭 | 最低可继续人数、答复期限/失联、连续退人再确认、与一般核心变更边界仍待定 |
| OP-08 | OPEN | PARTIALLY_CLOSED | DR02-06 | 统一默认数字、每场实际值及资金敞口上限、单人重复报名、到期退款后重新买晚报名席位交集未覆盖 |
| OP-09 | OPEN | OPEN | 未被本轮关闭 | 原/新T对退款的影响；其他变更确认期限；补偿对象/金额/承担关系；未回应收口 |
| OP-10 | OPEN | OPEN | 未被本轮关闭 | 最小适配/文案、材料类型/脱敏/渠道/授权/留存；不扩健康档案 |
| OP-11 | OPEN | OPEN | 未被本轮关闭 | 争议完成/特殊申诉/补证时限、自动退款是否审批、每日批次及漏批升级 |
| OP-12 | OPEN | OPEN | 未被本轮关闭 | 午餐/跨午夜当晚、最长处理期限、失联/未扫码实际到场、违约事实标准 |
| OP-13 | OPEN | OPEN | 未被本轮关闭 | 送达证据/失败重试、证据不足沉默交集、Q84字段、客服留言正式受理 |
| OP-14 | OPEN | OPEN | DR01-09仅澄清业务保留非收入 | 实际渠道/账户/结算日/凭证/失败恢复、非争议D结算时点、已结算翻案、会计/税务确认 |
| OP-15 | OPEN | OPEN | 未被本轮关闭 | 注销期间新报名/消息/撤回、完成期限、终态名称地址、导出/更正/留存/实际共享 |

**3 CLOSED、4 PARTIALLY_CLOSED、8 OPEN。** CLOSED只关闭主体选择，技术/真实逐场签收仍待验证。OP08的上限机制与主动退出新队尾已定；原OP还含默认/实际值、资金敞口、重复报名及到期重报，因此整项PARTIALLY_CLOSED，不撤销已批准重入规则。

| RV | 原状态 | 当前状态 | 本轮专项签收 |
| :--- | :--- | :--- | :--- |
| RV-01 | REVIEW_REQUIRED | REVIEW_REQUIRED | 未执行，不因业务决定自动通过 |
| RV-02 | REVIEW_REQUIRED | REVIEW_REQUIRED | 未执行，不因业务决定自动通过 |
| RV-03 | REVIEW_REQUIRED | REVIEW_REQUIRED | 未执行，不因业务决定自动通过 |
| RV-04 | REVIEW_REQUIRED | REVIEW_REQUIRED | 未执行，不因业务决定自动通过 |
| RV-05 | REVIEW_REQUIRED | REVIEW_REQUIRED | 未执行，不因业务决定自动通过 |
| RV-06 | REVIEW_REQUIRED | REVIEW_REQUIRED | 未执行，不因业务决定自动通过 |
| RV-07 | REVIEW_REQUIRED | REVIEW_REQUIRED | 未执行，不因业务决定自动通过 |

## 4. 实际静态检查

DOCUMENT_CHECK_PASS仅表示文档/字节检查通过。

| 检查 | 结果 | 证据 |
| :--- | :--- | :--- |
| 规则集合 | DOCUMENT_CHECK_PASS | 104显式ID与Git V1.0集合相同，无缺失、重复或未知ID |
| 决定集合 | DOCUMENT_CHECK_PASS | DR01九项、DR02六项，未增加业务答案 |
| 上游原件 | DOCUMENT_CHECK_PASS | 仓库副本与Downloads原件字节SHA一致，原件未改 |
| 六主文档 | DOCUMENT_CHECK_PASS | 控制ID/bundle/版本一致，trace记录的6个全文SHA匹配 |
| OP三处登记 | DOCUMENT_CHECK_PASS | baseline、独立登记和trace逐行相同，3/4/8分类正确 |
| RV三处登记 | DOCUMENT_CHECK_PASS | 7 RV逐行相同，全部REVIEW_REQUIRED |
| 规则/条款/来源定位 | DOCUMENT_CHECK_PASS | 104规则行号、展开政策条款、15输入段落和DR目标可解析 |
| 验收目标 | DOCUMENT_CHECK_PASS | 64 BR + 12 RB + 15 DR = 91，所有执行NOT_RUN |
| 政策阻塞 | DOCUMENT_CHECK_PASS | BR42/64仍BLOCKED_POLICY；BR60—63冻结目标改为NOT_RUN |
| 范围外文件 | DOCUMENT_CHECK_PASS | 241个政策目录外已跟踪文件与起始HEAD SHA相同 |
| WP10-A字节 | DOCUMENT_CHECK_PASS | validator、原测试及WP10_A_REVIEW.md与起始HEAD摘要相同 |
| 历史材料 | DOCUMENT_CHECK_PASS | V1.0 GAP/PROPOSALS/旧报告/旧任务等未修订文件保持字节 |
| 启用边界 | DOCUMENT_CHECK_PASS | draft、无生效日、NOT_ACTIVATABLE、runtime_configuration=false |
| 写入范围 | DOCUMENT_CHECK_PASS | 所有实际修改与新增均在docs/policy |
| diff格式 | DOCUMENT_CHECK_PASS | git diff --check无错误 |

最终全文SHA及bundle摘要以manifest/清单为准；README说明原字节、canonical JSON和排除自引用的口径。最终交回包含清单及bundle重算结果。本报告不嵌入自身或manifest摘要，避免循环。

复核还修正TECH/WP历史WP10-A已验收归档表述和RF报告链接。没有借此修改业务实现或扩大决定。

## 5. 验收及未执行项

| 范围 | 数量 | 本轮执行 |
| :--- | :--- | :--- |
| BR-AT-01—64 | 64 | 全部NOT_RUN；42/64来源仍阻塞；60—63主体预期已冻结 |
| RB-AT-01—12 | 12 | 全部NOT_RUN；RB03采用一笔方案，RB10保留剩余OP交集 |
| DR-AT-01—15 | 15 | 全部NOT_RUN，逐项对应上游决定 |
| policyBundle单测 / shared typecheck | 0次 | NOT_RUN |
| DB / migration / 真实构建 | 0次 | NOT_RUN |
| 微信/支付/退款/餐厅结算/部署 | 0次 | NOT_RUN且本轮禁止 |

91目标中89项已列业务预期、2项仍来源阻塞；有预期不代表前置专项、实现、环境和实际结果已通过。

## 6. 剩余问题

1. F默认金额、D_MIN、D_MAX、WAITLIST_MAX统一默认数字继续TBD；补偿金额及实际结算账户未填写。真实收费前要有权配置、有效revision及签收；候补上限未配置不新建支付。
2. OP03/04/05/08残余和OP07/09—15、全部7 RV仍待人工闭合。PLATFORM_RETAINED业务处置与资金/会计/税务/结算分开，不以此推定会计收入。
3. V1.0 validator仍固定旧输入并拒绝V1.1；原测试fixture读取当前目录的V1.1字节，与固定V1.0摘要不匹配。历史52通过不能代表当前通过；版本化fixture和V1.1支持需另行设计/审批，本轮不改不运行源码测试。
4. 本轮不重复源码审计或实施；V1.0 GAP为历史代码差分。新业务实现差分和PRD/工程规则调整需后续受控核实，不能宣称已实现。
5. 六文档仍需整版人工审核、专业签收、实现验证及独立发布/收费门禁，摘要正确不赋予启用资格。

## 7. 实际修改文件与差分

11个已跟踪修改：

- `docs/policy/BUSINESS_RULES_BASELINE.md`
- `docs/policy/USER_AGREEMENT.md`
- `docs/policy/PRIVACY_NOTICE.md`
- `docs/policy/RESTAURANT_SERVICE_STANDARD.md`
- `docs/policy/REFUND_POLICY.md`
- `docs/policy/POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md`
- `docs/policy/OPEN_DECISION_REVIEW.md`
- `docs/policy/TRACEABILITY_INDEX.json`
- `docs/policy/POLICY_TECH_DESIGN.md`
- `docs/policy/POLICY_WORK_PACKAGES.md`
- `docs/policy/README.md`

5个新增文档/完整性文件：

- `docs/policy/sources/FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md`
- `docs/policy/POLICY_REBASE_V1_1_CHANGELOG.md`
- `docs/policy/POLICY_V1_1_CONSISTENCY_REPORT.md`
- `docs/policy/POLICY_V1_1_BUNDLE_MANIFEST.json`
- `docs/policy/SHA256SUMS_V1_1.txt`

合计16个文件。标准git diff --stat只包含已跟踪修改；新增另列，未使用git add改变索引。

~~~text
 docs/policy/BUSINESS_RULES_BASELINE.md             |  273 +-
 docs/policy/OPEN_DECISION_REVIEW.md                |  126 +-
 .../policy/POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md |  250 +-
 docs/policy/POLICY_TECH_DESIGN.md                  |   58 +-
 docs/policy/POLICY_WORK_PACKAGES.md                |   86 +-
 docs/policy/PRIVACY_NOTICE.md                      |   28 +-
 docs/policy/README.md                              |   85 +-
 docs/policy/REFUND_POLICY.md                       |   63 +-
 docs/policy/RESTAURANT_SERVICE_STANDARD.md         |   53 +-
 docs/policy/TRACEABILITY_INDEX.json                | 7001 +++++++++++++++++++-
 docs/policy/USER_AGREEMENT.md                      |   56 +-
 11 files changed, 7290 insertions(+), 789 deletions(-)
~~~

下载原件及源码/测试/Schema/迁移/配置均未修改，未触及授权范围外文件。Git历史保存V1.0原基线和WP10-A；当前V1.1是有授权的文档修订，不继续声称当前基线字节不变。

## 8. 审核出口

请审核变更记录、六主文档、OP/RV、trace、TECH/WP及本报告。**完成交付后停止，不进入WP10-B、WP03/WP04/WP05/WP06或其他实施包，等待人工审核。**
