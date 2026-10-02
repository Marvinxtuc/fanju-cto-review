# 饭局政策包 V1.1｜阅读与授权边界

| 项目 | 本轮事实 |
| :--- | :--- |
| 任务 | FJ-POLICY-REBASE-V1.1；仅政策、设计、追溯文档 |
| 当前政策束 | FJ-POLICY-V1.1-20261001-REBASE-01 |
| 当前基线 | FJ-BUSINESS-BASELINE-20261001-V1.1；在V1.0上准确合入15项业务决定 |
| 上游新增输入 | FJ-DR01-DR02-DECISIONS-20261001-V1；APPROVED_AS_BUSINESS_INPUT |
| 文档状态 | REBASED_DRAFT；未批准启用、未设生效日 |
| 业务未闭合 | 3项OP CLOSED、4项PARTIALLY_CLOSED、8项OPEN；7项RV REVIEW_REQUIRED |
| 实际工作区 | /Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局 |
| 分支 / 起始HEAD | codex/fanju-stage0-baseline / 003200820922d11b374b84a9e756d4d763bea3f2 |
| 本轮测试 | 91项业务验收目标均NOT_RUN；未运行源码测试、DB、migration、构建或外部调用 |
| 实施与启用 | 未修改业务源码及运行配置；未激活政策；未提交、推送或部署 |

## 1. 当前六份主文档

| 层级 | 文件 | 用途 |
| :--- | :--- | :--- |
| 业务事实 | [BUSINESS_RULES_BASELINE.md](BUSINESS_RULES_BASELINE.md) | 保留104 Rule ID、Q01—100历史，合入15项上游决定与当前OP/RV |
| 用户协议 | [USER_AGREEMENT.md](USER_AGREEMENT.md) | 准入、费用、报名/候补、成团、取消与履约条款草案 |
| 隐私 | [PRIVACY_NOTICE.md](PRIVACY_NOTICE.md) | 最小字段、价格/履约历史、实际共享、材料及权利边界 |
| 餐厅履约 | [RESTAURANT_SERVICE_STANDARD.md](RESTAURANT_SERVICE_STANDARD.md) | 逐场D提议与审核、标准排桌策略revision、确认与结算前置 |
| 退款政策 | [REFUND_POLICY.md](REFUND_POLICY.md) | 一笔F+D分项、当前状态与时间矩阵、原路退款、申诉/结算 |
| 实施验收 | [POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md](POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md) | 104规则目录、64 BR + 12 RB + 15 DR目标及候选工作包 |

建议先读新增[决策输入](sources/FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md)、基线第4/6/7/8/10/17节，再阅读派生政策和设计。上游文件以原始字节复制，SHA-256为 `0268f125663f3a31f9ebb0c8c49870bb2f3df9d47776e2c54439f162b1508743`。批准业务输入不等于整版政策批准、专项审查通过、实现验收或收费许可。

## 2. 本轮追溯与设计

- [POLICY_REBASE_V1_1_CHANGELOG.md](POLICY_REBASE_V1_1_CHANGELOG.md)：15项前后变化、OP/RV变化、保留待定值与范围。
- [OPEN_DECISION_REVIEW.md](OPEN_DECISION_REVIEW.md)：当前15 OP / 7 RV，区分已闭合内容和残余交集。
- [TRACEABILITY_INDEX.json](TRACEABILITY_INDEX.json)：104规则、三组验收目标、上游决定、文档身份/摘要的机器索引；不是运行配置。
- [POLICY_TECH_DESIGN.md](POLICY_TECH_DESIGN.md)、[POLICY_WORK_PACKAGES.md](POLICY_WORK_PACKAGES.md)：同步业务输入后的候选技术设计与包依赖；不形成代码实施授权。
- [POLICY_V1_1_CONSISTENCY_REPORT.md](POLICY_V1_1_CONSISTENCY_REPORT.md)：文档检查结果、未运行项和剩余阻塞。
- [POLICY_V1_1_BUNDLE_MANIFEST.json](POLICY_V1_1_BUNDLE_MANIFEST.json)、[SHA256SUMS_V1_1.txt](SHA256SUMS_V1_1.txt)：本版全文摘要与可重算bundle摘要。

`UA-V1-*`、`PN-V1-*`等条款锚点为稳定定位标识，V1.1继续保留；正文控制ID、版本、bundle及全文摘要统一升版，不把锚点名称当作错误版本。

## 3. 历史证据与版本隔离

V1.0原基线全文及18份政策/分析文档保存在Git提交 `b47c0fefb3c4392a742696fc8f14004c011313e1`。原基线SHA-256为 `48357a92e9d84e816f84948149363834746c3cfd9d1936df228c7ae280f0c187`。当前基线是有授权的V1.1修订，不能继续声称当前文件逐字节未变。

下列文件保留V1.0历史内容：POLICY_GAP_ANALYSIS.md、POLICY_DECISION_PROPOSALS.md、POLICY_REBASE_CHANGELOG.md、CONSISTENCY_REPORT.md、CODEX_NEXT_TASK.md及sources/REFERENCE_NOTES.md。原输入SHA256SUMS位于原ZIP外层，未导入仓库。旧报告的404、远端版本和当时待定项只描述当时，不代表本轮实际工作区或当前决定；以本轮变更记录/索引为准。原ZIP中的SHA256SUMS用于V1.0原包，不能在修订后的当前目录当作V1.1校验清单运行。

WP10-A源码、测试和WP10_A_REVIEW.md保持Git `003200820922d11b374b84a9e756d4d763bea3f2` 的原字节。本地V1.0范围已由用户授权固化；没有V1.1实现或启用权限继承。validator固定V1.0输入；其原测试fixture读取当前政策路径，V1.1正文与固定摘要不同，历史52项通过不能代表当前通过。后续版本化fixture/validator兼容需单独设计与授权；本轮不改源码、不重跑该测试来宣称新版本通过。

## 4. 仍需人工闭合的参数与交集

- OP-01/02/06=CLOSED；OP-03/04/05/08=PARTIALLY_CLOSED；其余8项OPEN。CLOSED仅关闭主体业务选择，实际实现、逐场确认和专项审查仍须证据。
- F默认金额、D_MIN、D_MAX、WAITLIST_MAX统一默认数字继续TBD；不填写未确认补偿金额和结算账户。逐场上限未配置不开放候补收费；D范围数值未有权配置/签收不启用真实保证金收费。
- 取消/退款受理的成员移除时点，FIFO时钟与同刻排序，恰好T-24新加入类别，报名截止后但10分钟内收款，以及失效桌新加入类别，继续按OP-04/05保留。
- PLATFORM_RETAINED仅是D的业务处置；不自动认定ACCOUNTING_REVENUE。实际资金/会计/税务/结算及七项RV仍需独立评审。

三份用户文本的PUBLIC_DRAFT只划定候选正文，不是上线内容。不得删除待定/阻塞标识直接发布；应保存对应政策束的全文、文档ID与摘要，并分别落实告知和必要同意。

## 5. 摘要口径与复核

1. 所有document SHA-256均对文件当前UTF-8原始字节计算，不做空白/换行归一化；包括源输入及政策正文以外的控制信息。
2. manifest的bundle_payload含bundle_id、bundle_version、document_status及按path排序的14个document记录（path、document_id、document_version、sha256）。将payload以Python `json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')`序列化后求SHA-256。
3. manifest自身与SHA256SUMS_V1_1.txt不进入bundle_payload，避免循环引用。清单另包含manifest本身，合计15文件。摘要只是完整性证据，不是可信审批。
4. 在仓库根目录执行 `shasum -a 256 -c docs/policy/SHA256SUMS_V1_1.txt` 可复核清单。manifest复核按上述同一序列化规则重算bundle_payload即可。

本轮交付后停止等待人工审核，不进入WP10-B、WP03/WP04/WP05/WP06或其他实施包；禁止把业务决定或文档摘要当作部署/收费批准。
