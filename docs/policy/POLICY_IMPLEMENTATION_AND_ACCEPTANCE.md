# 饭局政策实施与验收矩阵｜V1.1 基线、规则与Codex交付

| 文档控制项 | 内容 |
| :--- | :--- |
| 文档 ID | FJ-IA-V1.1-20261001-REBASE-01 |
| 统一修订包 | FJ-POLICY-V1.1-20261001-REBASE-01 |
| 上游基线 | [FJ-BUSINESS-BASELINE-20261001-V1.1](BUSINESS_RULES_BASELINE.md)；按15项获批业务输入修订，V1.0历史保留 |
| 文本状态 | **REBASED_DRAFT：已按业务基线修订；未批准发布；未设生效日** |
| 业务状态 | DR01-01—09、DR02-01—06已冻结为业务输入；OP部分闭合，7项RV仍REVIEW_REQUIRED；未批准发布 |
| 编制日期 | 2026-10-01 |
| 运营主体 / 范围 | 上海闻演信息技术服务有限公司；上海首发，未来扩城不等于首发建设多城市体系 |
| 主责 / 复核 | CTO、交付负责人 / QA、产品、运营、资金、法务、隐私；具体人员及签收证据待填 |
| 阅读对象 | Codex实施团队及全部验收责任人 |
| 本次代码核验 | 本轮仅做V1.1文档Rebase，未重新核验业务实现；V1.0差分见POLICY_GAP_ANALYSIS.md，业务测试均NOT_RUN |
| 历史版本 | 本文件修订 FJ-IA-V1.0-20260930-REBASE-01；历史全文与结果保留，不继承旧启用权限 |

> **使用边界：**本文件是业务基线的下游修订稿，不是已经生效的合同、餐厅签收、法律/财税结论或收费许可。`【待定】`、`【承接口径待签收】`、`【发布阻塞】` 必须保留到获批，不能通过删除提示把未决条款发布。OP-01—OP-15、RV-01—RV-07 的完整原义统一见[业务基线第17节](BUSINESS_RULES_BASELINE.md#sec-17)。明确规则可以进入差分分析；未决交集不得由 Codex 自行选退款、扣费、同意或结算结果。

> **V1.1上游：**[FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md](sources/FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md)的15项决定优先于被覆盖的V1.0候选/TBD；未覆盖事项继续保留。OP-01/02/06=CLOSED；OP-03/04/05/08=PARTIALLY_CLOSED；其余8项OP=OPEN；7项RV均REVIEW_REQUIRED。正文与技术要求仍为REBASED_DRAFT，未设生效日，不继承WP10-A或旧Gate的启用/收费权限。

## 1. 当前可以推进什么

本轮获批范围为FJ-POLICY-REBASE-V1.1文档修订：同步DR01-01—09和DR02-01—06、更新OP/RV与目标断言、保留104个显式Rule ID。V1.0政策与差分已入Git b47c0fe，WP10-A实现记录在0032008；它们是历史证据，不代表V1.1实现或新政策可启用。

本轮未修改业务代码、Schema、migration、API、worker、前端或原V1.0 validator；未运行业务测试、DB、构建、真实网络或资金。旧文件中404/旧远端查询为过去编制条件，不继续作为本轮仓库不可访问的事实。V1.1新增目标的当前实现保持NEEDS_LOCAL_VERIFY，业务测试执行状态全部NOT_RUN。

### 1.1 文件层级

业务基线是本轮经营意图来源；四份政策是派生表述；本矩阵是实施证据要求。**安全、法律、支付及既有工程授权边界不被文件层级覆盖。**代码是当前实现事实，不是目标业务政策；二者冲突写入Gap，不改事实也不静默改规则。

V1.0基线与五派生正文保留在历史Git提交。本轮按明确授权修订为V1.1，并原样导入15项决策冻结输入；仅被该输入明确覆盖的业务选择升版，未覆盖OP/RV继续保留，不改写历史已执行结果。

### 1.2 分开保存状态

| 维度 | 状态使用规则 |
| :--- | :--- |
| 文档 | REBASED_DRAFT；批准和生效另有明确签收，不自动升版上线 |
| 业务 | 按基线已明确/承接口径/待定/未闭合/RV处理；不可一律标Approved |
| 当前实现 | V1.1新增目标NEEDS_LOCAL_VERIFY；既有实现证据见V1.0差分，未重新核验，不当V1.1通过 |
| 代码差分 | 本地读到后用IMPLEMENTED/PARTIAL/MISSING/CONFLICT，必须附真实定位 |
| 人工流程 | MANUAL_OPERATION_REQUIRED并附真实责任、工具、时限、操作证据 |
| 测试 | 本轮执行全部NOT_RUN；来源政策状态BLOCKED_POLICY单列，冻结目标也不升级为PASS |
| 发布 | 未批准；文本、技术、资金、餐厅和运营分别签收 |

## 2. 后续实施核验定位（本轮不重复代码审计）

后续实施仍读取AGENTS.md、PRD.md、docs/PROJECT_CONTEXT.md，并使用POLICY_GAP_ANALYSIS.md已有真实源码定位核实最新版本；本轮这里只保留阅读入口，不新增代码已读/已测结论：

| 入口 | 核对目的 |
| :--- | :--- |
| docs/stage3/2026-09-29/L3_PROFILE_CONSENT_DESIGN.md | 问卷去留、历史快照和文本确认 |
| docs/stage5/2026-09-29/FROZEN_VERSION_MATRIX.md | 实际SHA、兼容版本和现有Gate证据 |
| services/api/src/orders/agreement.ts | 当前AgreementPolicy及完整正文可追溯 |
| services/api/src/orders/formation.ts | 成团、候选、人数/饮食限制与席位授权 |
| packages/shared/src/rules/refund.ts | 当前退款规则与新F/D、晚报名等差异 |
| 由本地树和搜索定位的资金、任务、认证、餐厅操作、前端与测试 | 不猜当前路径；记录实际函数/API/行号及相关Schema |

清单报告独立资金事实、退款义务、未知恢复与8次后人工待办已具备；不把它们一律列MISSING。旧“单一服务费/全额”能力也不能直接标为新F/D模型可用。若发现AGENTS/PRD与新政策冲突，先提出最小文档/契约变更审批，不强制覆盖安全规则。

## 3. 三十个实施核对域

下表每一项当前代码状态均为 **NEEDS_LOCAL_VERIFY**，不是缺陷已复现。路径列表示应查找的能力，不是新文件名或当前接口契约。该表用于组织104个显式规则ID；没有ID的时间表、退款表、资料清单、OP/RV也必须一起读取。

| ID | 上游规则 | 政策落点 | 应核查能力 | 业务测试 | 运营证据 | 候选工作包 | 未闭合/专项依赖 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| IA-V1-01 | BAS-01、BAS-02、BAS-03 | UA-V1-01/02；PN-V1-01/02 | 主体与准入、地域配置；核对PRD/PROJECT_CONTEXT，不假设代码已支持 | BR-AT-01/02/52 | 实际主体/客服与18+资格方案 | WP01/WP10 | OP-03/15；RV-04 |
| IA-V1-02 | USR-01、USR-02、USR-03、USR-04 | UA-V1-02；PN-V1-02/03 | 登录、手机号、性别、资格校验入口；前后端都查 | BR-AT-01—03 | 字段必要性、告知和准入方案 | WP01 | RV-04 |
| IA-V1-03 | USR-05 | UA-V1-16；PN-V1-10 | 核对orders/agreement.ts及L3_PROFILE_CONSENT_DESIGN；全文/确认历史 | BR-AT-59 | 实际文本版本与确认记录，不止hash | WP10 | OP-03；公开发布签收 |
| IA-V1-04 | USR-06、USR-07 | UA-V1-02；PN-V1-03/04 | 选填时间的API/表单/推荐与统计；移除旧必填关联 | BR-AT-04/05 | 时间推荐和汇总用途的实际说明 | WP01 | OP-15 |
| IA-V1-05 | USR-08、USR-09、USR-10 | UA-V1-02；PN-V1-04 | 性别软目标与FIFO优先；移除同桌性别偏好 | BR-AT-06/07 | 内部目标与不保证比例的页面说明 | WP01/WP04/WP05 | RV-04 |
| IA-V1-06 | FEE-01、FEE-02、FEE-03、FEE-04 | UA-V1-03；RF-V1-01；RS-V1-04 | F/D分项、M不代收、活动价格快照及收款角色；Schema待核验；F+D一笔、F默认+活动覆盖、D提议/平台批准版本与D_MIN/MAX Gate | BR-AT-09/58 | F价格、D边界、实际收款账户/凭证 | WP03 | OP-03/04/14；RV-01/06 |
| IA-V1-07 | VEN-01、VEN-02、VEN-03 | RS-V1-01/04/12；UA-V1-03 | 逐场签收、预计消费与额外费用、收费前有效性入口 | BR-AT-10/11 | 餐厅真实资质/费用/容量签收 | WP02 | OP-03/09 |
| IA-V1-08 | VEN-04、VEN-05、VEN-06 | RS-V1-02/03；UA-V1-04 | min/target/max/maxTables与餐厅逐场选择有限标准策略、revision及修改权限 | BR-AT-12/15/16 | 签收参数与授权餐厅人员 | WP02/WP05 | OP-06 CLOSED；策略技术设计/逐场签收 |
| IA-V1-09 | VEN-07、VEN-08 | UA-V1-04；PN-V1-05；RS-V1-04 | 核对formation.ts及报名/创建支付/续付；最小适配替代旧口味表单 | BR-AT-05/08 | 收费前适配方案、不收完整健康档案 | WP01/WP02 | OP-10；RV-05/07 |
| IA-V1-10 | FORM-01、FORM-02、FORM-03 | UA-V1-05；RS-V1-03 | 逐桌有效成员达到min自动成团，可补至max；不再人工按钮前置 | BR-AT-13/14/17/18 | F+D完整可信成功才生效；待付10分钟且UNKNOWN不延长，不计min | WP05 | OP-04剩余交集；策略技术设计 |
| IA-V1-11 | FORM-04、FORM-05 | UA-V1-06；RS-V1-05 | 候补优先自动递补，正式席位与已成团分开 | BR-AT-07/23 | FIFO资格时间和通知 | WP04/WP05 | OP-04/05/08 |
| IA-V1-12 | FORM-06、FORM-07、FORM-08、FORM-09 | UA-V1-05/07；RS-V1-03 | T-24前失效/恢复、截止退款及名称地址；T-24已成团后失效继续直接补招至T-8，不复活失败桌 | BR-AT-19—21/61 | 失效通知、历史事件和按取消时实际状态退款 | WP05/WP06 | OP-04剩余；OP-01/02已闭合 |
| IA-V1-13 | FORM-10、FORM-11、FORM-12 | UA-V1-05/08；RF-V1-03 | 晚报名窗口、资格快照、T-8h新报名截止；失效桌新加入者类别不自定 | BR-AT-27/28/32/33/60 | 报名类别告知与冻结取消等号、未覆盖资格边界 | WP05/WP06 | OP-05剩余 |
| IA-V1-14 | FORM-13、FORM-14、FORM-15、FORM-16 | UA-V1-10；RS-V1-06；RF-V1-04 | T-8h后餐厅低人数决定、责任用户与剩余者区别 | BR-AT-35/36 | 餐厅实际决定、通知与补偿 | WP02/WP05/WP06 | OP-07；RV-03 |
| IA-V1-15 | WL-01、WL-02、WL-03、WL-04、WL-05 | UA-V1-06；RS-V1-05；RF-V1-02 | 付费候补完整支付生效、FIFO、自动转正、服务端有效事务顺序竞争与每场WAITLIST_MAX | BR-AT-22/23/63 | 候补付款前告知、上限方案 | WP04 | OP-04/05/08 |
| IA-V1-16 | WL-06、WL-07、WL-08、WL-09、WL-10 | UA-V1-06；RF-V1-02/07 | 主动退出全退、T-24到期、无后延、退出重入新队尾与退款批次/竞争 | BR-AT-24—26/63 | 资格结束与退款义务不同步到账说明 | WP04/WP06 | OP-05/08/11 |
| IA-V1-17 | INFO-01、INFO-02、INFO-03 | UA-V1-07/13；RS-V1-05 | 按本人本桌信息授权、成团历史、换店确认 | BR-AT-18/19/20/49 | 名称/地址披露与终态方案 | WP05/WP08 | OP-15；RV-07 |
| IA-V1-18 | REF-01、REF-02、REF-03 | UA-V1-08；RF-M02—04 | 核对共享refund.ts与所有取消入口；取消时实际成团状态、历史审计、晚报名类别/可信acceptedAt与已冻结等号 | BR-AT-29—33/47/60—63 | 三类退款矩阵与政策适用 | WP06 | OP-05剩余；RV-01 |
| IA-V1-19 | REF-04、REF-05 | UA-V1-09；RF-V1-04 | 责任归因、两项全退及补偿不能当可有可无 | BR-AT-34/35/49/50 | 补偿方案、承担人、用户通知 | WP06/WP08 | OP-09/14 |
| IA-V1-20 | REF-06、REF-07、REF-08 | RF-V1-01/08；RF-M08/09 | 原路、额外实收、F/D已退/在途/应结守恒；复用已有资金恢复 | BR-AT-54/55/57/58 | 渠道匹配、双向对账、结算凭证 | WP03/WP06 | OP-04/14；RV-06 |
| IA-V1-21 | FUL-01、FUL-02、FUL-03、FUL-04、FUL-05 | UA-V1-11；RS-V1-07；PN-V1-03 | 本场扫码、正常/异常确认、当晚截止、无固定迟到自动扣款 | BR-AT-37/40 | 餐厅真实确认角色与证据 | WP07 | OP-12/15 |
| IA-V1-22 | FUL-06、FUL-07、FUL-08、FUL-09 | UA-V1-11/14；RF-V1-05/07；RS-V1-07 | 次日退D不退F、漏确认待办及渠道进度 | BR-AT-38/39/54/55 | 次日批次、漏确认值班 | WP03/WP06/WP07 | OP-11/12 |
| IA-V1-23 | DISP-01、DISP-02、DISP-03、DISP-04、DISP-05 | UA-V1-12；RF-V1-05；RS-V1-08 | 餐厅标签非扣款；用户收到后48h；材料和通知权限 | BR-AT-40/41/64 | 送达证据、首次说明、调查 | WP07 | OP-11/12/13；RV-02 |
| IA-V1-24 | DISP-06、DISP-07、DISP-08、DISP-09 | UA-V1-12；RF-V1-05；PN-V1-09 | 无回复默认首次违约的待审门槛、结果通知和资金待处置 | BR-AT-42/64 | 足够事实与送达、具体展示字段签收 | WP07 | OP-13；RV-02，不能默认启用 |
| IA-V1-25 | DISP-10、DISP-11、DISP-12、DISP-13、DISP-14、DISP-15 | UA-V1-12；RF-V1-05；RS-V1-08/09 | 一次异人复核、48h申请期、争议暂停结算、期满进入结算 | BR-AT-43—45 | 两位真实审核人员、结算准入与复核结论 | WP07/WP03 | OP-11/13/14；RV-06 |
| IA-V1-26 | EXC-01、EXC-02、EXC-03、EXC-04 | UA-V1-09；RF-V1-06；PN-V1-05 | 特殊证明、仅D/F+D两种批准、原时间与不同申诉类别 | BR-AT-46—48 | 证明最小范围、运营授权与原取消事实 | WP06/WP07 | OP-10/11/14；RV-05 |
| IA-V1-27 | CHG-01、CHG-02、CHG-03、CHG-04 | UA-V1-13；RS-V1-10；RF-V1-04 | 换店提出、动态期限、显式同意、超时拒绝及原店补偿 | BR-AT-49 | 原新安排、用户选择与原餐厅合同 | WP08 | OP-09/13 |
| IA-V1-28 | CHG-05、CHG-06、CHG-07 | UA-V1-13；RS-V1-10；RF-V1-04 | 其他核心变更、价格参考与新增费用区别、低人数例外 | BR-AT-11/36/50/51 | 明确变更证据、低人数专项披露 | WP08 | OP-07/09；RV-03 |
| IA-V1-29 | OPS-01、OPS-02、OPS-03 | UA-V1-14；RF-V1-07；PN-V1-09 | 系统受理与客服阅读分开；24h审核、次日批次、48h分流 | BR-AT-52—55/64 | 客服10:00—22:00实际可用、审核/批次责任 | WP06/WP07/WP10 | OP-11/13 |
| IA-V1-30 | PRI-01、PRI-02、PRI-03、PRI-04 | UA-V1-15；PN-V1-06—10 | 随时申请注销、未结事项继续、分项留存、真实权利流程 | BR-AT-56/59 | 字段/接收方/留存核验，人工或自助演练 | WP09 | OP-10/15；RV-04/05 |

## 4. 逐规则目录与可回填标准

这里保留104个显式规则一对一映射；Q01—Q100追溯和完整表格仍以基线为准。机器索引见[TRACEABILITY_INDEX.json](TRACEABILITY_INDEX.json)，索引不是产品Schema，不准直接接成运行配置。

| Rule ID | 基线标题 | 核对域 | 当前实现核验 |
| :--- | :--- | :--- | :--- |
| BAS-01 | 产品定位。 | IA-V1-01 | NEEDS_LOCAL_VERIFY |
| BAS-02 | 地域。 | IA-V1-01 | NEEDS_LOCAL_VERIFY |
| BAS-03 | 用户资格。 | IA-V1-01 | NEEDS_LOCAL_VERIFY |
| USR-01 | 浏览。 | IA-V1-02 | NEEDS_LOCAL_VERIFY |
| USR-02 | 报名付款。 | IA-V1-02 | NEEDS_LOCAL_VERIFY |
| USR-03 | 性别。 | IA-V1-02 | NEEDS_LOCAL_VERIFY |
| USR-04 | 成年资格。 | IA-V1-02 | NEEDS_LOCAL_VERIFY |
| USR-05 | 政策告知。 | IA-V1-03 | NEEDS_LOCAL_VERIFY |
| USR-06 | 用途。 | IA-V1-04 | NEEDS_LOCAL_VERIFY |
| USR-07 | 选填。 | IA-V1-04 | NEEDS_LOCAL_VERIFY |
| USR-08 | 软目标。 | IA-V1-05 | NEEDS_LOCAL_VERIFY |
| USR-09 | 不得覆盖其他条件。 | IA-V1-05 | NEEDS_LOCAL_VERIFY |
| USR-10 | 对外表达。 | IA-V1-05 | NEEDS_LOCAL_VERIFY |
| FEE-01 | 平台收费组成。 | IA-V1-06 | NEEDS_LOCAL_VERIFY |
| FEE-02 | 餐费边界。 | IA-V1-06 | NEEDS_LOCAL_VERIFY |
| FEE-03 | 默认价与活动覆盖。 | IA-V1-06 | NEEDS_LOCAL_VERIFY |
| FEE-04 | 保证金审核及上下限。 | IA-V1-06 | NEEDS_LOCAL_VERIFY |
| VEN-01 | 真实供给。 | IA-V1-07 | NEEDS_LOCAL_VERIFY |
| VEN-02 | 预计消费。 | IA-V1-07 | NEEDS_LOCAL_VERIFY |
| VEN-03 | 额外收费。 | IA-V1-07 | NEEDS_LOCAL_VERIFY |
| VEN-04 | 逐场由餐厅确认四项容量： | IA-V1-08 | NEEDS_LOCAL_VERIFY |
| VEN-05 | 修改权限。 | IA-V1-08 | NEEDS_LOCAL_VERIFY |
| VEN-06 | 多桌标准策略。 | IA-V1-08 | NEEDS_LOCAL_VERIFY |
| VEN-07 | 首发不提供特殊饮食保障。 | IA-V1-09 | NEEDS_LOCAL_VERIFY |
| VEN-08 | 普通口味不采集。 | IA-V1-09 | NEEDS_LOCAL_VERIFY |
| FORM-01 | 自动成团。 | IA-V1-10 | NEEDS_LOCAL_VERIFY |
| FORM-02 | 继续加人。 | IA-V1-10 | NEEDS_LOCAL_VERIFY |
| FORM-03 | 最低已达即可。 | IA-V1-10 | NEEDS_LOCAL_VERIFY |
| FORM-04 | 先候补后新报名。 | IA-V1-11 | NEEDS_LOCAL_VERIFY |
| FORM-05 | 自动转正不等于整桌必已成团。 | IA-V1-11 | NEEDS_LOCAL_VERIFY |
| FORM-06 | 可逆。 | IA-V1-12 | NEEDS_LOCAL_VERIFY |
| FORM-07 | 先补人。 | IA-V1-12 | NEEDS_LOCAL_VERIFY |
| FORM-08 | 恢复。 | IA-V1-12 | NEEDS_LOCAL_VERIFY |
| FORM-09 | 最终失败。 | IA-V1-12 | NEEDS_LOCAL_VERIFY |
| FORM-10 | 中间窗口直接补招。 | IA-V1-13 | NEEDS_LOCAL_VERIFY |
| FORM-11 | 晚报名用户退款例外。 | IA-V1-13 | NEEDS_LOCAL_VERIFY |
| FORM-12 | 停止补招。 | IA-V1-13 | NEEDS_LOCAL_VERIFY |
| FORM-13 | 人数仍达最低。 | IA-V1-14 | NEEDS_LOCAL_VERIFY |
| FORM-14 | 低于最低则由餐厅决定。 | IA-V1-14 | NEEDS_LOCAL_VERIFY |
| FORM-15 | 责任分别处理。 | IA-V1-14 | NEEDS_LOCAL_VERIFY |
| FORM-16 | 例外边界。 | IA-V1-14 | NEEDS_LOCAL_VERIFY |
| WL-01 | 付费候补及上限。 | IA-V1-15 | NEEDS_LOCAL_VERIFY |
| WL-02 | 付款前明确说明。 | IA-V1-15 | NEEDS_LOCAL_VERIFY |
| WL-03 | FIFO。 | IA-V1-15 | NEEDS_LOCAL_VERIFY |
| WL-04 | 自动转正。 | IA-V1-15 | NEEDS_LOCAL_VERIFY |
| WL-05 | 排序定义仍须落地。 | IA-V1-15 | NEEDS_LOCAL_VERIFY |
| WL-06 | 主动退出全退。 | IA-V1-16 | NEEDS_LOCAL_VERIFY |
| WL-07 | T-24h 到期。 | IA-V1-16 | NEEDS_LOCAL_VERIFY |
| WL-08 | 不向后续窗口延续。 | IA-V1-16 | NEEDS_LOCAL_VERIFY |
| WL-09 | 与退款时效区分。 | IA-V1-16 | NEEDS_LOCAL_VERIFY |
| WL-10 | 退出与转正竞争。 | IA-V1-16 | NEEDS_LOCAL_VERIFY |
| INFO-01 | 桌与用户归属。 | IA-V1-17 | NEEDS_LOCAL_VERIFY |
| INFO-02 | 已知信息不可消除。 | IA-V1-17 | NEEDS_LOCAL_VERIFY |
| INFO-03 | 核心替换。 | IA-V1-17 | NEEDS_LOCAL_VERIFY |
| REF-01 | 不拿异常任务延迟制造扣费。 | IA-V1-18 | NEEDS_LOCAL_VERIFY |
| REF-02 | 成团状态而非付款多少小时。 | IA-V1-18 | NEEDS_LOCAL_VERIFY |
| REF-03 | 取消时当前状态。 | IA-V1-18 | NEEDS_LOCAL_VERIFY |
| REF-04 | 原因优先。 | IA-V1-19 | NEEDS_LOCAL_VERIFY |
| REF-05 | 不把补偿变成运营可不给。 | IA-V1-19 | NEEDS_LOCAL_VERIFY |
| REF-06 | 原路优先。 | IA-V1-20 | NEEDS_LOCAL_VERIFY |
| REF-07 | 真实收款及超时晚到。 | IA-V1-20 | NEEDS_LOCAL_VERIFY |
| REF-08 | 不重复使用同一保证金。 | IA-V1-20 | NEEDS_LOCAL_VERIFY |
| FUL-01 | 用户扫码。 | IA-V1-21 | NEEDS_LOCAL_VERIFY |
| FUL-02 | 扫码不是完整履约结果。 | IA-V1-21 | NEEDS_LOCAL_VERIFY |
| FUL-03 | 判断结果分两类。 | IA-V1-21 | NEEDS_LOCAL_VERIFY |
| FUL-04 | 当晚完成。 | IA-V1-21 | NEEDS_LOCAL_VERIFY |
| FUL-05 | 不采用自动迟到扣款。 | IA-V1-21 | NEEDS_LOCAL_VERIFY |
| FUL-06 | 次日批量。 | IA-V1-22 | NEEDS_LOCAL_VERIFY |
| FUL-07 | 不把发起等同到账。 | IA-V1-22 | NEEDS_LOCAL_VERIFY |
| FUL-08 | 暂行规则 B。 | IA-V1-22 | NEEDS_LOCAL_VERIFY |
| FUL-09 | 不是用户违约。 | IA-V1-22 | NEEDS_LOCAL_VERIFY |
| DISP-01 | 异常入口。 | IA-V1-23 | NEEDS_LOCAL_VERIFY |
| DISP-02 | 保证金暂缓。 | IA-V1-23 | NEEDS_LOCAL_VERIFY |
| DISP-03 | 平台决定。 | IA-V1-23 | NEEDS_LOCAL_VERIFY |
| DISP-04 | 须听取用户说明。 | IA-V1-23 | NEEDS_LOCAL_VERIFY |
| DISP-05 | 48 小时。 | IA-V1-23 | NEEDS_LOCAL_VERIFY |
| DISP-06 | 用户已选择的业务规则。 | IA-V1-24 | NEEDS_LOCAL_VERIFY |
| DISP-07 | 同时保留冲突提示。 | IA-V1-24 | NEEDS_LOCAL_VERIFY |
| DISP-08 | 结果。 | IA-V1-24 | NEEDS_LOCAL_VERIFY |
| DISP-09 | 通知是后续复核的起点。 | IA-V1-24 | NEEDS_LOCAL_VERIFY |
| DISP-10 | 一次。 | IA-V1-25 | NEEDS_LOCAL_VERIFY |
| DISP-11 | 异人处理。 | IA-V1-25 | NEEDS_LOCAL_VERIFY |
| DISP-12 | 48 小时申请期。 | IA-V1-25 | NEEDS_LOCAL_VERIFY |
| DISP-13 | 暂停结算。 | IA-V1-25 | NEEDS_LOCAL_VERIFY |
| DISP-14 | 复核结果。 | IA-V1-25 | NEEDS_LOCAL_VERIFY |
| DISP-15 | 自动进入餐厅补偿结算流程。 | IA-V1-25 | NEEDS_LOCAL_VERIFY |
| EXC-01 | 允许申诉。 | IA-V1-26 | NEEDS_LOCAL_VERIFY |
| EXC-02 | 合理证明。 | IA-V1-26 | NEEDS_LOCAL_VERIFY |
| EXC-03 | 时间不重算。 | IA-V1-26 | NEEDS_LOCAL_VERIFY |
| EXC-04 | 例外审核可裁量的是批准范围。 | IA-V1-26 | NEEDS_LOCAL_VERIFY |
| CHG-01 | 先征求同意。 | IA-V1-27 | NEEDS_LOCAL_VERIFY |
| CHG-02 | 明确同意。 | IA-V1-27 | NEEDS_LOCAL_VERIFY |
| CHG-03 | 动态确认期限。 | IA-V1-27 | NEEDS_LOCAL_VERIFY |
| CHG-04 | 原餐厅补偿。 | IA-V1-27 | NEEDS_LOCAL_VERIFY |
| CHG-05 | 仍须同意。 | IA-V1-28 | NEEDS_LOCAL_VERIFY |
| CHG-06 | 预算仅参考与变更不混同。 | IA-V1-28 | NEEDS_LOCAL_VERIFY |
| CHG-07 | 没有回复不是同意。 | IA-V1-28 | NEEDS_LOCAL_VERIFY |
| OPS-01 | 客服响应不是业务时钟。 | IA-V1-29 | NEEDS_LOCAL_VERIFY |
| OPS-02 | 语义区分。 | IA-V1-29 | NEEDS_LOCAL_VERIFY |
| OPS-03 | 24h 与 48h 的冲突。 | IA-V1-29 | NEEDS_LOCAL_VERIFY |
| PRI-01 | 可随时申请。 | IA-V1-30 | NEEDS_LOCAL_VERIFY |
| PRI-02 | 先处理未结责任。 | IA-V1-30 | NEEDS_LOCAL_VERIFY |
| PRI-03 | 不删除资金事实。 | IA-V1-30 | NEEDS_LOCAL_VERIFY |
| PRI-04 | 未选择的操作。 | IA-V1-30 | NEEDS_LOCAL_VERIFY |

本地Codex每条至少填：Rule ID、基线精确段落、政策条款、当前文件/函数/API和行号、Schema与测试、真实差异、实现状态、证据状态、需改范围、是否需迁移/状态机/API授权、OP/RV、建议WP、验收断言、责任角色。只有代码存在但测试未跑时，必须分开“实现存在”和“已验证”。

## 5. 业务验收表：沿用64项，不覆盖历史结果

下表保留BR-AT-01—64身份，更新获批冻结目标。来源状态与执行状态分开：60—63旧BLOCKED_POLICY因主体决定已定转为NOT_RUN；42/64的政策阻塞保留。本轮全部执行NOT_RUN，BLOCKED_POLICY不能靠改预期为“随便一种结果”消除。任何原审计T01—T28及旧QA-P测试均保留历史身份，按变更映射复用或替换，不能覆盖旧结果。

| 编号 | 领域 | 场景 | 预期/阻塞条件 | 来源 | 来源状态 | 本轮执行 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| BR-AT-01 | 准入 | 仅确认成年资格，不填具体年龄 | 保留18+准入；不新增出生日期、年龄段或身份证必填。 | Q35、Q41 | NOT_RUN | NOT_RUN |
| BR-AT-02 | 准入 | 用户浏览后尝试未授权手机号报名 | 允许浏览；报名/付款要求微信登录与手机号授权。 | Q89 | NOT_RUN | NOT_RUN |
| BR-AT-03 | 准入 | 报名未填性别 | 按业务选择不能报名；仅男/女，字段启用还须专项复核。 | Q38、Q90；RV-04 | NOT_RUN | NOT_RUN |
| BR-AT-04 | 准入 | 时间偏好空白或与所选活动时间不同 | 不阻止报名/付款；填写后仅推荐和开局统计使用。 | Q47—Q48 | NOT_RUN | NOT_RUN |
| BR-AT-05 | 准入 | 旧问卷的行业、口味、预算、氛围等未填 | 不能继续因为旧必填规则拒绝报名，不新增这些画像。 | Q41—Q50 | NOT_RUN | NOT_RUN |
| BR-AT-06 | 准入 | 用户寻找同桌性别期待选项 | 首发没有此选项；内部均衡不对外保证比例。 | Q39—Q40 | NOT_RUN | NOT_RUN |
| BR-AT-07 | 排序 | 候补队首不利于性别均衡 | 仍FIFO优先，不跳过有效队首。 | Q40、Q59 | NOT_RUN | NOT_RUN |
| BR-AT-08 | 饮食 | 用户明确需要本场不支持的专门饮食保障 | 在收费前阻止该安排，不先收款后排桌拒绝。 | Q19；OP-10 | NOT_RUN | NOT_RUN |
| BR-AT-09 | 收费 | 用户准备付费 | 分别展示实际F、D及总计，一笔F+D支付、后台分项；价格快照不追溯；M直付餐厅不混入平台收款。 | Q02、Q15；DR01-01/05 | NOT_RUN | NOT_RUN |
| BR-AT-10 | 餐费 | 现场主动点单超过预计人均上限 | 预计区间只作参考，不把它实现成硬上限。 | Q16—Q17 | NOT_RUN | NOT_RUN |
| BR-AT-11 | 餐费 | 餐厅临时增加固定包间费 | 不能单方强加；核心变更需明确同意，不接受者两项全退。 | Q18、Q94 | NOT_RUN | NOT_RUN |
| BR-AT-12 | 桌型 | 餐厅参数不满足正常4≤min≤target≤max≤8 | 不按正常桌型放行；后期特例不得伪装成初始非法参数。 | Q54、Q72 | NOT_RUN | NOT_RUN |
| BR-AT-13 | 成团 | min=4/target=6/max=6，第4位完整可信成功且获正式席位成员加入 | 自动成团/地址解锁；UNKNOWN及待付10分钟锁位不计min。 | Q25、Q63；DR01-02/03 | NOT_RUN | NOT_RUN |
| BR-AT-14 | 成团 | 已4人成团，继续出现第5/6/7位用户 | 第5/6位可合法加入；第7位不能超单桌最大值。 | Q64 | NOT_RUN | NOT_RUN |
| BR-AT-15 | 容量 | 餐厅最大6人、最多2桌，正式席位已12个 | 不能加第3桌或正式超售；可按候补规则受理候补。 | Q55、Q57 | NOT_RUN | NOT_RUN |
| BR-AT-16 | 排桌 | 餐厅逐场选择有限标准多桌策略 | 收费前有效确认revision；运营不能静默改、不能优化拆已成团事实；FIFO及容量优先。 | Q53、Q56；DR02-05 | NOT_RUN | NOT_RUN |
| BR-AT-17 | 成团 | T-24h时min4/target6/max6，实际5人 | 照常举行，不因未到目标人数失败。 | Q69 | NOT_RUN | NOT_RUN |
| BR-AT-18 | 多桌 | 同活动一桌成团、另一桌未成团 | 按具体桌/席位判定结果与地址，不让所有订单共享一个粗糙结果。 | Q63、Q25 | NOT_RUN | NOT_RUN |
| BR-AT-19 | 成团失效 | T-24h前4人成团后退1人，min4 | 回到待成团并补人；名称保留，地址隐藏。 | Q65—Q67 | NOT_RUN | NOT_RUN |
| BR-AT-20 | 恢复 | 上一场景补足至4人 | 再次成团并恢复详细地址。 | Q66—Q67 | NOT_RUN | NOT_RUN |
| BR-AT-21 | 最终失败 | 到T-24h仍未补足最低人数 | 剩余有效用户F+D全退，不套他们的主动取消扣费。 | Q66 | NOT_RUN | NOT_RUN |
| BR-AT-22 | 候补 | 容量满且候补开放、未达本场上限，完整可信付F+D | 取得付费候补不正式席位；UNKNOWN不生效；达上限不创建新候补支付。 | Q57；DR01-02、DR02-06 | NOT_RUN | NOT_RUN |
| BR-AT-23 | 候补 | T-24h前释放席位且有有效队列 | FIFO自动转正并通知，不需二次同意，不让新用户插队。 | Q59—Q60、Q68 | NOT_RUN | NOT_RUN |
| BR-AT-24 | 候补 | 仍未转正的用户主动退出 | F+D全退，不按时间阶梯扣费。 | Q62 | NOT_RUN | NOT_RUN |
| BR-AT-25 | 候补 | 到T-24h仍未转正 | 自动结束候补，产生两项全退处理，不无限等待。 | Q58、Q62 | NOT_RUN | NOT_RUN |
| BR-AT-26 | 候补 | T-24h后有临时空位 | 不恢复已结束候补；按已成团桌直接报名规则处理。 | Q70 | NOT_RUN | NOT_RUN |
| BR-AT-27 | 晚报名 | T-20h有效已成团桌有空位 | 可直接报名，受最大人数/桌数限制，不新建候补。 | Q70 | NOT_RUN | NOT_RUN |
| BR-AT-28 | 截止 | T-8h有人想报名或T-5h有空位；待付后晚到款 | 关闭新报名/候补；10分钟到期晚到款F+D全退不抢位，其他截止交集仍OP-05。 | Q70、Q72；DR01-04；OP-05 | NOT_RUN | NOT_RUN |
| BR-AT-29 | 退款 | 尚未成团、距开始25h主动取消 | F全退、D全退。 | Q03、Q26 | NOT_RUN | NOT_RUN |
| BR-AT-30 | 退款 | 普通当前有效成团、Δ=25h自退 | F/D不退，D=PLATFORM_RETAINED不进本场餐厅补偿，不直接确认会计收入。 | Q26—Q27；DR01-09 | NOT_RUN | NOT_RUN |
| BR-AT-31 | 退款 | 普通成团用户恰好提前24h取消 | F不退、D不退；D补偿餐厅，不能归平台。 | Q28 | NOT_RUN | NOT_RUN |
| BR-AT-32 | 晚报名退款 | T-20h加入已成团桌，T-10h主动取消 | F不退、D全退；不能仅以已成团全部扣留。 | Q71 | NOT_RUN | NOT_RUN |
| BR-AT-33 | 晚报名退款 | T-20h加入已成团桌，T-7h主动取消 | F不退、D不退，D补偿餐厅。 | Q71、Q12 | NOT_RUN | NOT_RUN |
| BR-AT-34 | 取消责任 | 已成团后平台或餐厅取消 | 受影响用户F+D全退，另有运营决定的补偿。 | Q29—Q30 | NOT_RUN | NOT_RUN |
| BR-AT-35 | 后期不足 | T-5h有人退出使人数低于min，餐厅不接待 | 剩余愿参加者两项全退加补偿；主动退出者按本人规则。 | Q72—Q73 | NOT_RUN | NOT_RUN |
| BR-AT-36 | 后期不足 | 同上但餐厅愿意继续，另一用户因人数少退出 | 通知实际人数，无须再次确认；退出者按本人主动取消规则。 | Q74—Q75；RV-03 | NOT_RUN | NOT_RUN |
| BR-AT-37 | 签到 | 用户扫码成功但餐厅尚未确认 | 只形成到店记录，不立即视为正常履约并退D。 | Q09—Q10、Q79 | NOT_RUN | NOT_RUN |
| BR-AT-38 | 正常履约 | 餐厅当晚确认正常履约 | F保留；次日统一核对并原路发起D退款。 | Q76—Q77 | NOT_RUN | NOT_RUN |
| BR-AT-39 | 漏确认 | 餐厅当晚未操作、次日有签到记录 | 暂不自动退款；进入运营待办；不直接认定用户违约。 | Q78 | NOT_RUN | NOT_RUN |
| BR-AT-40 | 异常上报 | 餐厅先标异常没有当场完整证据 | 允许形成待审核，平台后续了解；不能商家一键实扣/结算。 | Q80 | NOT_RUN | NOT_RUN |
| BR-AT-41 | 首次申诉 | 用户已收到异常通知且仍在48h内 | 保留说明机会，D暂缓处理，不提前直接最终扣除。 | Q81—Q82 | NOT_RUN | NOT_RUN |
| BR-AT-42 | 默认违约 | 已通知48h无回复，但餐厅证据缺失 | Q83选择默认违约；举证前提与送达冲突未闭合，不得将此例标已验收。 | Q80、Q83；OP-13、RV-02 | BLOCKED_POLICY | NOT_RUN |
| BR-AT-43 | 最终复核 | 首次违约后用户在48h内要求复核 | 由不同审核人处理，D继续暂缓结算。 | Q85—Q87 | NOT_RUN | NOT_RUN |
| BR-AT-44 | 期满结算 | 首次违约通知后48h无最终复核申请 | 自动进入餐厅补偿结算流程；实际付款路径须已批准。 | Q88；OP-14 | NOT_RUN | NOT_RUN |
| BR-AT-45 | 复核翻案 | 最终复核认为应退保证金 | 按结论原路退D并通知；不把复核前暂缓款当已结算。 | Q85、Q87、Q100 | NOT_RUN | NOT_RUN |
| BR-AT-46 | 特殊申请 | 证明审核通过，运营选择退款方案 | 只能按获授权方案退D或退F+D，不擅自任意比例退款。 | Q32—Q33 | NOT_RUN | NOT_RUN |
| BR-AT-47 | 特殊拒绝 | 原普通成团取消发生在T-25h，审核在T-20h拒绝 | 回到原取消事实档，不能按审核时刻将D归餐厅。 | Q34、Q97—Q98 | NOT_RUN | NOT_RUN |
| BR-AT-48 | 隐私材料 | 特殊申诉要求证明 | 按批准最小范围收取，不默认要完整病历/身份证；保管方案未完成前不启用真实收集。 | Q33；OP-10、RV-05 | NOT_RUN | NOT_RUN |
| BR-AT-49 | 换店 | 用户拒绝替换或动态期限届满未回复 | 不视为接受；两项全退，保留原餐厅补偿责任。 | Q92—Q93 | NOT_RUN | NOT_RUN |
| BR-AT-50 | 核心变更 | 新增最低消费/明显改时间/包间改大厅 | 明确告知并征求同意；不同意可两项全退。 | Q94 | NOT_RUN | NOT_RUN |
| BR-AT-51 | 口径一致 | 现场自主点菜超预算与餐厅新增固定费两种场景 | 前者按参考消费，后者走核心变更，不能混同。 | Q17、Q18、Q94 | NOT_RUN | NOT_RUN |
| BR-AT-52 | 客服 | 首发用户寻找渠道与首次响应承诺 | 只承诺小程序客服10:00—22:00，无固定首次响应时长；不显示未启用电话/企微。 | Q95—Q97 | NOT_RUN | NOT_RUN |
| BR-AT-53 | 一般退款时效 | 普通退款申请收到后获批 | 24h内审核；获批次日批量发起，不用客服工作小时改时限。 | Q98—Q99 | NOT_RUN | NOT_RUN |
| BR-AT-54 | 退款展示 | 退款仅审核通过或请求已发出 | 不显示已到账；到账以渠道实际结果为准。 | Q99—Q100 | NOT_RUN | NOT_RUN |
| BR-AT-55 | 退款渠道 | 正常应退现金或原路不可用 | 默认原路退；客观不可用走人工异常，不以券/余额强行替代。 | Q100 | NOT_RUN | NOT_RUN |
| BR-AT-56 | 注销 | 申请时还有D、退款或申诉未结 | 先处理未结义务，再完成注销；不抹除资金事实。 | Q91 | NOT_RUN | NOT_RUN |
| BR-AT-57 | 异常实收 | 待付10分钟到期释放后确认成功或关闭后额外款 | 保存每笔实收；已到期晚到成功F+D原路全退，不重抢席位、不超售。 | S1第108—115行；DR01-04 | NOT_RUN | NOT_RUN |
| BR-AT-58 | 金额范围 | 平台承诺该订单两项全退 | 退F+D，餐费M不混入；重复处理不得重复退款。 | Q15、Q100 | NOT_RUN | NOT_RUN |
| BR-AT-59 | 历史政策 | 新政策上线或餐厅条件更新 | 保留历史适用版本，不回写旧订单同意或追溯增加扣费。 | S1第48—54行 | NOT_RUN | NOT_RUN |
| BR-AT-60 | 中间窗口 | T-24h有效成团桌在T-15h退出后低于min | 记失效、直接补招至T-8h不恢复候补；达min恢复；T-8h不足转餐厅流程；不可复活T-24h失败桌。 | DR02-01；OP-07/RV-03仍待 | NOT_RUN | NOT_RUN |
| BR-AT-61 | 失效退款 | 曾成团、可信取消受理时当前已失效/重新待成团 | 按当前未成团阶梯；保留历史，禁止曾成团永久扣留。 | DR02-02 | NOT_RUN | NOT_RUN |
| BR-AT-62 | 等号 | 普通未成团恰好Δ=24h/=8h；适用晚报名Δ=8h取消 | 普通24h全退、8h保F退D；晚报名8h保F退D；按可信acceptedAt不重算。 | DR02-03 | NOT_RUN | NOT_RUN |
| BR-AT-63 | 队列竞争 | 候补退出与转正并发 | 服务端有效事务顺序唯一；退出先全退且不得转正，转正先后续按正式类别取消。 | DR02-04 | NOT_RUN | NOT_RUN |
| BR-AT-64 | 申诉时钟 | 仅写入站内消息、用户是否收到未知 | 不可把技术写入直接当已收到并运行扣除倒计时；先明确送达规则。 | Q82、Q86；OP-13 | BLOCKED_POLICY | NOT_RUN |

### 5.1 本次新增的跨模块测试需求（全部未执行）

下表是技术/质量建议，非新增业务决定。涉及OP/RV的断言须按批准方案细化。

| 编号 | 场景 | 预期 | 工作包 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| RB-AT-01 | 新客报名金额为F+D，正常履约只退D | 保留F；对应原支付累计退款和在途金额不超实收；不误退整笔 | WP03/WP06/WP07 | NOT_RUN |
| RB-AT-02 | 同一退D任务重复或并发，先退D后又批准F+D | D只退一次，后续仅退未退F；真实渠道及本地金额分别一致 | WP03/WP06 | NOT_RUN |
| RB-AT-03 | F+D一笔合并支付后分项退款与处置 | 用户一笔支付，F/D分项关联同原渠道；完整成功才生效，不保留两笔候选替代冻结方案 | WP03；DR01-01/02、RV-06 | NOT_RUN |
| RB-AT-04 | 复核申请与48h期满结算任务同刻 | 按获批生效顺序唯一处理；不能已受理复核却把D转餐厅 | WP03/WP07；OP-05/13/14 | NOT_RUN |
| RB-AT-05 | 餐厅A人员尝试确认B餐厅/他场/无权限用户 | 拒绝越权；正常确认与异常标签不能绕平台变成直接资金命令 | WP07；OP-15 | NOT_RUN |
| RB-AT-06 | 扫码重复、跨场、二维码外传或网络失败 | 按获批最小防护及补录方案处理，不新增GPS/人脸默认采集 | WP07；OP-12 | NOT_RUN |
| RB-AT-07 | 只删旧问卷UI但后端仍要求budgetRange等 | 测试应暴露不一致；兼容历史不恢复新必填，不破坏旧快照 | WP01/WP09 | NOT_RUN |
| RB-AT-08 | 工作区只有旧单一服务费的Gate绿灯 | 新增F/D、候补、自动成团及争议范围保持未验收，不能继承PASS | WP10 | NOT_RUN |
| RB-AT-09 | 三份用户正文hash与订单记录不匹配、草案被启用 | 拒绝生效/确认；保留历史全文；不能只删TBD标识 | WP10 | NOT_RUN |
| RB-AT-10 | 已冻结OP-01/02后仍存在OP-04/05/07等未覆盖交集，尝试默认扣款 | 采用已冻结主体规则；未批报名类别/成员移除/后期履约分支继续阻断；不无限挂款 | WP05/WP06 | NOT_RUN |
| RB-AT-11 | 上午饭局/跨午夜结束/退款在午夜前获批 | 按OP-11/12获批日历定义及批次测试；不能擅定23:59或再推迟一天 | WP06/WP07 | NOT_RUN |
| RB-AT-12 | 恢复备份后存在先前隐私处置、渠道新增款和D已结算 | 重放有效隐私处置并双向对账，不能为了删除画像抹D义务 | WP03/WP09 | NOT_RUN |

并发测试使用可控时钟与同步屏障，重启/未知请求/回调顺序要真实构造；不以顺序两次成功当并发证明。测试前先审查脚本副作用、隔离数据库和完整Mock配置，独立测试授权后执行。当前文档差分任务不触发真实网络或资金，也不运行会写数据库的脚本。


### 5.2 V1.1冻结决定的15项验收目标（全部NOT_RUN）

下列目标与上游15项决定一一对应，保留BR-AT-01—64和RB-AT-01—12。冻结业务预期不构成技术通过；涉及OP-07/RV-03等分支仍需其前置签收。

| 编号 | 冻结输入 | 场景 | 目标断言 | 本轮执行 |
| :--- | :--- | :--- | :--- | :--- |
| DR-AT-01 | DR01-01 | F+D一笔支付及先退D后全退 | 用户一笔F+D，后台分项；D只退一次，后续合法全退仅补尚未退F，累计已退/在途不超实收 | NOT_RUN |
| DR-AT-02 | DR01-02 | 未付、失败、UNKNOWN、待付锁位与完整可信成功 | 前四者不计正式成员/min；只有F+D整笔完整可信成功后，按合法正式容量或开放候补生效 | NOT_RUN |
| DR-AT-03 | DR01-03 | 创建需正式席位的待付订单 | 临时锁位10分钟，不能沿用15分钟或无期限锁位 | NOT_RUN |
| DR-AT-04 | DR01-04 | 10分钟到期仍UNKNOWN，释放后确认成功 | 到期释放、不计成员；继续查询恢复；保存晚到实收并建立F+D原路全退义务，不抢席位、不超售 | NOT_RUN |
| DR-AT-05 | DR01-05 | 平台默认F与活动覆盖、后续改价 | 活动级优先，付款前展示F/D/合计，生效留价格快照；改价不追溯，默认实际金额仍TBD | NOT_RUN |
| DR-AT-06 | DR01-06 | 餐厅D提议未经批准或改价 | 只有餐厅逐场提议/确认与平台审核批准形成有效D版本才可收费；改价新版本，不追溯已付订单 | NOT_RUN |
| DR-AT-07 | DR01-07 | 正常活动D超统一区间 | 要求D_MIN≤D≤D_MAX；普通活动配置不得越界，特殊例外未经另批不放行 | NOT_RUN |
| DR-AT-08 | DR01-08 | D_MIN/D_MAX尚无有权配置或签收 | 不启用真实保证金收费，不以示例金额当默认值；数值继续TBD | NOT_RUN |
| DR-AT-09 | DR01-09 | 普通当前有效成团Δ>24h主动取消 | F/D不退，D=PLATFORM_RETAINED，不退用户、不进该场餐厅补偿；不等同ACCOUNTING_REVENUE，RV-01/06保留 | NOT_RUN |
| DR-AT-10 | DR02-01 | T-24时已成团桌在中间窗口失效 | 失效后继续合法直接补招至T-8，不恢复候补；达min恢复、可补max；T-8不足进入OP-07/RV-03流程，不复活T-24应失败桌 | NOT_RUN |
| DR-AT-11 | DR02-02 | 历史曾成团、取消时实际失效/重新待成团 | 按可信取消受理时实际未成团阶梯，保留FORMED/INVALIDATED/RESTORED历史，不永久按曾成团扣费 | NOT_RUN |
| DR-AT-12 | DR02-03 | 普通未成团Δ=24h/8h与已确定晚报名Δ=8h | 未成团≥24h退F+D、8h≤Δ<24h仅退D、0<Δ<8h均不退；晚报名≥8h仅退D、0<Δ<8h均不退；使用可信acceptedAt | NOT_RUN |
| DR-AT-13 | DR02-04 | 候补退出与转正并发 | 服务端有效事务顺序唯一结果：退出先则全退且转正失败；转正先则按正式类别后续取消；不信客户端时间 | NOT_RUN |
| DR-AT-14 | DR02-05 | 多桌标准策略与未经餐厅确认的修改 | 平台有限可审计策略逐场由餐厅选择成revision；满足min/target/max/maxTables、FIFO及有效顺序；不得为优化拆团 | NOT_RUN |
| DR-AT-15 | DR02-06 | WAITLIST_MAX未配置、达限、主动退出后重入 | 未配置/达限不创建新候补支付；有效人数<上限才开放；合法重入是新申请/新FIFO序号/队尾；不填统一默认值或关闭剩余OP-08 | NOT_RUN |

## 6. 候选WP01—WP10：不是已授权开发单

下表保留十包组织方式，但实施依赖优先于编号。不要理解成简单从WP01到WP10串行，也不要一次性批准所有迁移。

| 工作包 | 范围 | 先决条件 | 完成定义 |
| :--- | :--- | :--- | :--- |
| WP01 用户资料最小化 | 性别、手机号、选填时间；旧画像不再采集/必填；最小适配协同 | 当前字段差分、RV-04、OP-10，WP10版本策略 | 前端/API/历史兼容一致，相关BR-AT通过；不直接drop历史 |
| WP02 餐厅逐场供给 | min/target/max/桌数/分配规则、费用/签收与收费资格 | OP-03剩余、策略技术设计、实际餐厅逐场签收、已核验权限 | 本场有效签收驱动收费；运营不能自行改人数承诺 |
| WP03 F/D资金与处置基础 | 分项、原支付映射、未知恢复、D待退/待结/实结、对账 | OP-03/04剩余与OP-14、RV-01/06；F+D一笔冻结、事务/迁移设计 | 金额守恒、重启可恢复、不可提前结算，不替用户选支付分账产品 |
| WP04 付费候补 | 明确身份、FIFO、自动转正、退出/到期全退 | WP02/03；OP-05/08/11 | 不超售、不跳队、不延长候补；转正竞争可追溯 |
| WP05 自动可逆成团与地址 | 按桌达min自动成团、失效恢复、晚报名和T-8h例外 | WP02/03与候补契约；OP-04/05剩余、OP-07；OP-01/02/06已闭合，策略技术设计另审 | 不共用活动粗状态；准确窗口和信息权限 |
| WP06 取消退款与批次 | 全部F/D场景、晚报名、责任/例外、24h与次日批次 | WP03及WP04/05事件；OP-05剩余、OP-09/11/14；已冻结时间与当前状态判定 | 单一批准决策表驱动所有入口，金额与时钟一致 |
| WP07 扫码、履约及两轮争议 | 餐厅受控确认、漏确认、48h/异人复核与结算准入 | WP03/06；OP-11/12/13/14/15、RV-02/05 | 有真实权限、送达、两人复核、结算阻断及恢复证据 |
| WP08 换店与核心变更 | 动态期限、明确同意、补偿、历史条件 | WP05/06及通知；OP-07/09/13 | 不默认同意、不覆写历史、不忽略人数专门例外 |
| WP09 隐私权利与最小化 | 字段/共享/留存、敏感材料、注销处理中及恢复 | OP-10/15、RV-04/05；实际服务商和权限 | 真实受控人工或自助流程可演练；不抹资金事实 |
| WP10 政策版本、文案与验收总控 | 六文档、三用户正文、金额/活动快照、历史适用、证据 | 先行设计；贯穿所有工作包 | 开始时冻结版本契约，最后汇总同范围产物/Gate；不等到最后才做 |

V1.0文档导入与Gap已完成；WP10-A仍固定V1.0输入。本轮只同步V1.1业务目标与候选设计，后续具体工作包依POLICY_WORK_PACKAGES.md另行审批，由单一责任人统筹跨包Schema/状态/事件。WP01可提最小变更设计，但涉及新必填性别或材料的上线须相应专项通过。未经批准的独立Schema迁移不能因为包号靠前而先做。

## 7. 对接既有G0—G4，不重置历史门禁

| 放行层 | 新范围需要补的证据 | 当前判断 |
| :--- | :--- | :--- |
| 安全隔离内测（通常G0） | 受控身份/配置、真实构建产物、Mock与实渠道隔离 | 待核对FROZEN_VERSION_MATRIX；不推定PASS |
| 业务和资金可恢复（通常G1） | F/D、候补、可逆成团、退款/争议、恢复与跨包回归 | 本轮新范围NOT_RUN |
| 外部真实能力联调（通常G2） | 商户/限额/参与人独立批准、回调/查单/退款与双向对账 | 未授权 |
| 发布候选（通常G3） | 文本批准、迁移兼容、产物摘要、备份恢复、真实运营/餐厅签收 | 未授权 |
| 白名单收费（通常G4） | 前置通过、人数金额限额、值班与停止新收费方案 | 未授权 |

以上是对接建议，正式编号和已有结果以本地冻结版本矩阵为准。新范围不得沿用旧单一服务费验收冒充通过。缺口不因“白名单人少”降低要求。

## 8. 分析交付与开发授权分离

本轮只获准V1.1政策文档Rebase、哈希/追溯/一致性更新和候选设计；来源业务批准不是代码开发许可。后续每包另行提交具体范围，不自动进入WP10-B、WP03/04/05/06或其他WP。不得更改运行代码、Schema、migration、依赖或部署，不读取/打印Secret，不调用真实微信/资金，不提交/推送或开自动执行链。

V1.0分析任务与其实际结果保留；V1.1允许修订的文件以本轮用户指令及冻结输入为准，不把旧CODEX_NEXT_TASK.md扩大成新的业务实现授权。旧材料已入Git；不覆盖历史结果，不用旧远端或旧Gate替代新范围核验。

每个后续开发包另需：目标、范围、排除项、允许文件、Schema/API/状态机影响、前置OP/RV、测试断言及隔离计划、迁移回退和停止条件。实施完成后提供实际SHA或未提交diff及其摘要，未提交时不能冒称已有实现提交；测试数据不得清理用户真实数据。

## 9. V1.0分析四交付件的历史与V1.1关联

| 交回件 | 必須有的内容 |
| :--- | :--- |
| POLICY_GAP_ANALYSIS.md | 实际HEAD/dirty边界；104规则与无ID表格的当前实现、真实文件/函数/API/测试、差异与证据 |
| POLICY_DECISION_PROPOSALS.md | OP-01—15候选及推荐、RV-01—07资料需求；全部拟议，不由Codex批准 |
| POLICY_TECH_DESIGN.md | 跨包资金/席位/时间/同意/材料/任务、兼容迁移和回退最低版本；只设计 |
| POLICY_WORK_PACKAGES.md | 最小可批准包、依赖、负责人、验收、第一包范围；不得一次授权所有包 |

上述V1.0分析历史保留，技术设计/工作包同步V1.1冻结输入；POLICY_GAP_ANALYSIS.md与POLICY_DECISION_PROPOSALS.md不作为本轮重新代码审计结论。资料缺失OP不以运行默认值替代，法务/税务/商户结论不能由代码正确推出。

## 10. V1.1剩余阻塞与旧validator证据边界

- OP-01/02/06=CLOSED；OP-03/04/05/08=PARTIALLY_CLOSED；OP-07/09/10/11/12/13/14/15=OPEN；7项RV均REVIEW_REQUIRED，详见OPEN_DECISION_REVIEW.md。
- 默认F、D_MIN/D_MAX的数值、WAITLIST_MAX统一默认人数、补偿金额、真实账户未填写。每场候补上限未配置不收费；D上下限未获有权配置/签收不启用真实保证金收费。PLATFORM_RETAINED是业务处置，不是已确认会计收入。
- 原policyBundle.ts继续固定V1.0完整输入，源码与原测试本轮不改不运行。其测试fixture读取当前docs/policy正文；正文升为V1.1后可能与V1.0固定hash不匹配，因此历史52项通过不能沿用为本版通过。V1.0/V1.1测试fixture与版本隔离需后续单独设计/审批，本轮不修代码来让新草案通过。
- 文档内容、业务决定、专项审查、实现测试与发布收费是独立证据；本轮不激活AgreementPolicy、不赋予V1.1任何运行权限。完成交付后停止等待人工审核。
