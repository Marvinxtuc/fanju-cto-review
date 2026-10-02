# Codex下一轮任务｜导入政策包、读取实际代码、交回差分与最小实施设计

任务ID：FJ-POLICY-GAP-01。输入包：FJ-POLICY-V1.0-20260930-REBASE-01。状态：**任务待在用户本地启动，本文件不是已启动/已完成证明**。

## 0. 本轮目标和允许范围

用户已要求推进Policy Rebase及后续对接。本轮仅：核对正确工作区，安全导入已交付政策文档，读取本地当前代码，并形成四份文档。**不要直接实施WP01—WP10。**包内候选工作包、字段和枚举不是最终技术授权。

允许写入：确认无未合并人工改动后，`docs/policy/`内本包文档及下述四份输出。禁止更改应用源码、Schema、migration、运行配置、依赖、已批准安全规则；禁止执行数据库写入脚本、真实微信/支付/退款、部署、Git提交/推送或自动连续开发。新表/API/状态机只可提设计。

## 1. 找到真实输入，先不要复制覆盖

由用户提供本包实际解压路径，记作PACKAGE_ROOT；不要猜`/Downloads`内路径或虚构已经下载。包中必须有`docs/policy/BUSINESS_RULES_BASELINE.md`及五份派生MD。核验SHA256SUMS中的文件，原基线哈希必须为：

```text
48357a92e9d84e816f84948149363834746c3cfd9d1936df228c7ae280f0c187
```

读取当前工作区的AGENTS.md、PRD.md、docs/PROJECT_CONTEXT.md。明确项目是否饭局，不在其他项目写文档。记录实际root、branch、HEAD、未提交修改范围和差异摘要。普通本地终端可用：

```bash
git status --short
git branch --show-current
git rev-parse HEAD
```

若通过CodexPro，则用其open_current_workspace/show_changes等指定读工具，不绕其bash安全限制。不能checkout/reset/clean/stash覆盖不干净目录。

清单曾报告路径`/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局`、HEAD`7dfae5db3e6d882b6fb3154065f57327e4a08fe3`；这些只用于比对，不要求回到该旧HEAD。本地若已前进，读取新diff并记录；若只见远端bc25f5b，不足以代表本地整改，停止冒充最新分析。

检查现有`docs/policy/`：不存在时可创建；同名相同内容复用；同名不同内容先生成差异说明，不覆盖人工改动；若无法确认版本权威，停止导入该文件。不得把旧策略示例当批准决定补进新包。保留原始输入和既有历史记录。

## 2. 导入与全文阅读

安全导入本包`docs/policy/`（含README、映射、参考、OP/RV及校验说明），但SHA256SUMS是外层包输入核验，不作为后续分析输出哈希。六主文件是：

```text
docs/policy/BUSINESS_RULES_BASELINE.md
docs/policy/USER_AGREEMENT.md
docs/policy/PRIVACY_NOTICE.md
docs/policy/RESTAURANT_SERVICE_STANDARD.md
docs/policy/REFUND_POLICY.md
docs/policy/POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md
```

原基线逐字节保留。候选正文含待定/复核信息，不得启用AgreementPolicy或当正式用户条款。源码不同于业务目标时写CONFLICT；AGENTS/PRD与本轮目标有矛盾时提出文档和契约变更清单，不自行提高权限。

## 3. 读取实际代码并逐项对照

优先核对清单指定的本地文件：

```text
docs/stage3/2026-09-29/L3_PROFILE_CONSENT_DESIGN.md
docs/stage5/2026-09-29/FROZEN_VERSION_MATRIX.md
services/api/src/orders/agreement.ts
services/api/src/orders/formation.ts
packages/shared/src/rules/refund.ts
```

文件不存在就记真实缺失，并在当前树定位替代，不能编造函数/行号。然后读取实际的登录授权、profile、订单、分项支付退款、候补/桌位、持久任务、餐厅确认/二维码、客服申诉、材料与注销、前端和测试。不要读取真实.env、私钥、用户材料、手机号/流水导出。

以104显式规则、全部时间/金额表、OP/RV和业务证据要求共同为范围；不只读104个标题就结束。当前实现标签：IMPLEMENTED/PARTIAL/MISSING/CONFLICT/NEEDS_LOCAL_VERIFY。规则需要人工流程或审批时另标MANUAL_OPERATION_REQUIRED/POLICY_DECISION_REQUIRED/COMPLIANCE_REVIEW_REQUIRED。代码存在不等于测试通过；本轮测试未执行就写NOT_RUN。

必须特别验证：F/D/M区分、正常只退D、原支付映射、已退D后再全额例外、候补退出和转正竞争、晚报名例外、逐桌自动成团及失效、T-24/T-8、餐厅参数不可单方覆盖、扫码不是履约完成、送达与两次48h、餐厅补偿未到结算的资金保留、换店/核心变更、餐厅低人数专门例外、最小资料/适配、注销和完整政策证据。不能删饮食旧字段顺带删收费前拦截，也不能把平台业务去向直接实现成会计收入。

## 4. 只交回以下四份输出

### 4.1 POLICY_GAP_ANALYSIS.md

首段记录实际代码身份、dirty影响、输入包/基线哈希、读取范围、执行与未执行动作。每条含Rule/表格位置、对应政策、真实文件/函数/API/行号、模型、测试位置、实现状态、证据状态、缺口、Schema/API/状态机/权限/任务影响、OP/RV、候选WP及验收断言。统计未知项，不拿REPORTED当本次证实。

### 4.2 POLICY_DECISION_PROPOSALS.md

逐项复述OP-01—15和RV-01—07，不改ID或自动关闭。按OPEN_DECISION_REVIEW中的6组给少量候选方案，比较同一场景F/D/席位/时限/用户权利的结果，说明推荐但保留人工审批。RV给复核资料和角色，不代法务/资金/餐厅签收。

### 4.3 POLICY_TECH_DESIGN.md

只设计：资金组件/原支付、独立资金事实、在途与退款义务、席位/成团事件和锁顺序、队列/时钟、过期/晚到/崩溃恢复、完整文本版本、材料权限/留存、餐厅最小确认载体。对单笔合并收F+D与分笔候选说明取舍，不能自选成已批准方案。不为本项目擅建托管/分账或商户完整后台。

Schema/API需要最小兼容迁移提案、历史回填/有效唯一约束、应用与worker版本组合、最低可回退提交及资金保留。只列拟修改文件与预期，不创建migration。

### 4.4 POLICY_WORK_PACKAGES.md

对齐WP01—10名称但按实际依赖组织。WP10的版本/门禁设计应先行；F/D资金设计、餐厅容量、时间规则在相关功能前冻结；不能默认先大规模删字段。每包写目标、排除项、真实文件、前置批准、检查断言、隔离计划、回退影响、建议责任角色、预计工作量与未知因素。最后仅推荐一个最小首批可批准包，不启动代码。

## 5. 本轮出口

本地真实文件阅读完成，104规则及无ID规范表都能定位；15OP/7RV未伪造批准；四输出完成；所有文档改动可审查；没有禁止动作。返回root/branch/HEAD/dirty、导入与跳过文件、输出路径、关键阻塞和建议第一包，然后停止等待人工审核。

如果连接或文件不足，返回BLOCKED_REPOSITORY_ACCESS或对应缺失，并说明所需文件；不要用猜测写已完成报告。若没有两个实际审核人员，不得用两个AI角色冒充“异人复核”运营能力。
