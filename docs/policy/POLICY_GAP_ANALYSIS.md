# FJ-POLICY-GAP-01｜实际代码差分

日期：2026-09-30。状态：候选分析，等待人工审核；本轮不实施。

## 1. 工作区、输入和动作

- 实际工作区：/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局；分支 codex/fanju-stage0-baseline；HEAD 7dfae5db3e6d882b6fb3154065f57327e4a08fe3。
- 已读AGENTS.md、PRD.md、docs/PROJECT_CONTEXT.md，核对为饭局餐厅体验项目。导入前干净；目前仅新增docs/policy/，未切换提交或清理改动。
- 默认目录/Users/marvin.x/Documents/饭局为旧bc25f5b，其未跟踪apps/miniapp/.swc/保留不动。
- 用户随后授权自行解压并选位置，替代任务单原先用户提供解压路径的约定。实际PACKAGE_ROOT为本worktree；只提取docs/policy/文件。
- ZIP为/Users/marvin.x/Downloads/fanju_policy_v1.0_rebase_2026-09-30.zip；SHA256 c672b8609777387f482328f4e1effacdac53dc529794ff9503a15113739045e8。SHA256SUMS 15项校验全部通过。
- 原基线SHA256 48357a92e9d84e816f84948149363834746c3cfd9d1936df228c7ae280f0c187，逐字节保留。14份目录内文件全部导入，冲突0、复用0、目录内跳过0。外层START_HERE及SHA256SUMS只核验未导入。
- 已读六主文件、任务/追溯/OP/RV/一致性/变更/来源，相关实际源码、model、迁移、前端与测试。大文件读取相关路由与处理片段，不声称全仓全文核验。
- 本轮仅文档写入和只读Git/hash/文件检查；测试、构建、迁移、业务演练全部NOT_RUN。未运行DB写入脚本，未读取真实密钥/用户材料，未真实微信/收退款/部署/提交/推送。

## 2. 结论与状态

已有资金基础：原渠道绑定、独立实收、总额退款预算、回调可靠落盘、持久任务租约/重试及双向对账。新F/D组件、候补、逐桌自动可逆成团、争议复核及餐厅D结算需扩展。

旧库存要求全部实收退完才释放，新政策允许保F/处置D，必须拆席位和资金责任；旧问卷必填、人工成团、T-24地址、审批即发起退款同样冲突。

IMPLEMENTED仅为源码支持有限规则，不是运行/发布通过；PARTIAL已有基础仍缺路径；MISSING相关源码/model无能力；CONFLICT现有行为不同；NEEDS_LOCAL_VERIFY真实配置或人工事实未知。所有源码证据READ，测试NOT_RUN。15 OP OPEN、7 RV REVIEW_REQUIRED，未代签。

## 3. 三十个实际证据域

<a id="e01"></a>
### E01 产品范围与资格

- 实际函数/API/前端入口：[AGENTS.md:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/AGENTS.md:1)；[PRD.md:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/PRD.md:1)；[services/api/src/app.ts:154](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:154)。
- 模型：[prisma/schema.prisma:86](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:86)。
- 已有测试定位：[services/api/src/app.test.ts:257](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:257)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：餐厅体验定位明确；地区有district/businessArea，无18+资格及主体运营核验证据。拟改资格准入及发布配置，实际主体人工核验。

<a id="e02"></a>
### E02 浏览与身份

- 实际函数/API/前端入口：[services/api/src/app.ts:283](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:283)；[services/api/src/app.ts:1007](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1007)；[services/api/src/auth.ts:68](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/auth.ts:68)。
- 模型：[prisma/schema.prisma:86](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:86)；[prisma/schema.prisma:103](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:103)。
- 已有测试定位：[services/api/src/app.test.ts:257](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:257)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：公开浏览已有；订单校验登录/手机号，缺性别和成年。统一报名/续付准入，真实身份联调待核验。

<a id="e03"></a>
### E03 政策全文与同意

- 实际函数/API/前端入口：[services/api/src/orders/agreement.ts:8](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/agreement.ts:8)；[services/api/src/app.ts:197](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:197)；[apps/miniapp/src/pages/activity-detail/index.tsx:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/apps/miniapp/src/pages/activity-detail/index.tsx:1)。
- 模型：[prisma/schema.prisma:119](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:119)；[prisma/schema.prisma:131](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:131)；[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)。
- 已有测试定位：[services/api/src/app.test.ts:296](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:296)；[services/api/src/app.test.ts:339](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:339)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：currentAgreement有全文/hash/source及ConsentRecord历史；缺三正文束/审批启用/完整订单政策映射。拟扩展版本束、同意和启用门禁。

<a id="e04"></a>
### E04 资料与时间偏好

- 实际函数/API/前端入口：[services/api/src/app.ts:1783](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1783)；[apps/miniapp/src/pages/profile/profile-form.ts:30](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/apps/miniapp/src/pages/profile/profile-form.ts:30)；[apps/ops/src/candidate-profile.ts:4](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/apps/ops/src/candidate-profile.ts:4)。
- 模型：[prisma/schema.prisma:103](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:103)；[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)。
- 已有测试定位：[services/api/src/app.test.ts:357](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:357)；[services/api/src/app.test.ts:478](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:478)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：区域/时间/预算/氛围/桌型旧必填，无推荐/统计能力证据。拟改新profile契约和前端，时间选填；历史快照不drop。

<a id="e05"></a>
### E05 性别软目标

- 实际函数/API/前端入口：[packages/shared/src/rules/table.ts:26](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/table.ts:26)；[services/api/src/orders/formation.ts:31](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:31)。
- 模型：[prisma/schema.prisma:103](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:103)；[prisma/schema.prisma:282](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:282)。
- 已有测试定位：[packages/shared/src/rules/shared.test.ts:55](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/shared.test.ts:55)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：没有性别字段或软均衡/FIFO；旧桌型偏好影响成团。拟定硬资格/容量/FIFO先于性别软目标，无比例承诺。

<a id="e06"></a>
### E06 F/D/M

- 实际函数/API/前端入口：[packages/shared/src/rules/pricing.ts:5](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/pricing.ts:5)；[services/api/src/app.ts:1007](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1007)；[services/api/src/funding/refunds.ts:7](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:7)。
- 模型：[prisma/schema.prisma:167](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:167)；[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)；[prisma/schema.prisma:390](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:390)。
- 已有测试定位：[services/api/src/app.test.ts:106](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:106)；[services/api/src/funding/receipts.test.ts:175](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.test.ts:175)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：仅serviceFeeCents，mealFeeIncluded=false已有；缺D。拟增组件快照、原收款分配、退款/处置预算及对账，不建钱包托管。

<a id="e07"></a>
### E07 餐厅费用供给

- 实际函数/API/前端入口：[services/api/src/app.ts:306](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:306)；[services/api/src/app.ts:1740](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1740)；[apps/ops/src/SupplyForms.tsx:7](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/apps/ops/src/SupplyForms.tsx:7)。
- 模型：[prisma/schema.prisma:150](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:150)；[prisma/schema.prisma:167](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:167)。
- 已有测试定位：[services/api/src/app.test.ts:1009](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1009)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：录入/状态已有，budget单值，消费区间/固定费/逐场真实签收缺失。拟增签收revision及收费前资格/费用披露，需人工真实证据。

<a id="e08"></a>
### E08 容量与权限

- 实际函数/API/前端入口：[services/api/src/app.ts:350](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:350)；[services/api/src/app.ts:1762](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1762)；[apps/ops/src/SupplyForms.tsx:44](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/apps/ops/src/SupplyForms.tsx:44)。
- 模型：[prisma/schema.prisma:167](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:167)；[prisma/schema.prisma:282](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:282)。
- 已有测试定位：[services/api/src/app.test.ts:1009](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1009)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：4—8/min≤target≤max存在，运营配置；缺maxTables和餐厅分配签收。拟改供给revision、确认权限及改参重新确认。

<a id="e09"></a>
### E09 最小适配

- 实际函数/API/前端入口：[services/api/src/orders/formation.ts:31](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:31)；[services/api/src/app.ts:1007](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1007)；[services/api/src/app.ts:1286](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1286)。
- 模型：[prisma/schema.prisma:103](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:103)。
- 已有测试定位：[services/api/src/app.test.ts:398](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:398)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：特殊饮食在付款后排桌阻断；普通口味仍采集。拟统一创建订单/预支付/续付前最小适配，不采完整健康资料。

<a id="e10"></a>
### E10 逐桌自动成团

- 实际函数/API/前端入口：[services/api/src/orders/formation.ts:92](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:92)；[services/api/src/orders/formation.ts:134](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:134)；[services/api/src/app.ts:851](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:851)。
- 模型：[prisma/schema.prisma:167](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:167)；[prisma/schema.prisma:282](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:282)；[prisma/schema.prisma:297](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:297)。
- 已有测试定位：[services/api/src/app.test.ts:1425](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1425)；[packages/shared/src/rules/shared.test.ts:63](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/shared.test.ts:63)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：draftFormation/confirmFormation由运营确认活动整体GROUPED。拟改成员事件/逐桌计数、达min自动形成、可加至max和锁协议。

<a id="e11"></a>
### E11 候补优先递补

- 实际函数/API/前端入口：[services/api/src/app.ts:1007](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1007)；[services/api/src/orders/formation.ts:12](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:12)；[apps/ops/src/views/ActivitiesView.tsx:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/apps/ops/src/views/ActivitiesView.tsx:1)。
- 模型：[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)；[prisma/schema.prisma:297](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:297)。
- 已有测试定位：[services/api/src/app.test.ts:1221](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1221)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：满额拒绝订单；视图候补开放是静态演示数组。拟增资格/FIFO队列/自动递补，转正与成团分开。

<a id="e12"></a>
### E12 成团失效恢复

- 实际函数/API/前端入口：[services/api/src/orders/formation.ts:134](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:134)；[services/api/src/orders/formation.ts:193](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:193)；[packages/shared/src/rules/order.ts:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/order.ts:1)；[packages/shared/src/rules/activity.ts:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/activity.ts:1)。
- 模型：[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)；[prisma/schema.prisma:282](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:282)。
- 已有测试定位：[services/api/src/app.test.ts:1565](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1565)；[services/api/src/app.test.ts:1744](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1744)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：草案代次已有，正式成团不可逆；缺失效恢复历史/T-24逐桌任务。拟增事件/通知/义务，OP-01/02不能默认处理。

<a id="e13"></a>
### E13 晚报名与关窗

- 实际函数/API/前端入口：[services/api/src/app.ts:1007](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1007)；[services/api/src/app.ts:1841](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1841)；[services/api/src/orders/inventory.ts:59](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.ts:59)。
- 模型：[prisma/schema.prisma:167](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:167)；[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)。
- 已有测试定位：[services/api/src/app.test.ts:1163](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1163)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：只PUBLISHED/REGISTRATION_OPEN到配置截止，无T-24..T-8类别。拟增报名类别/T快照/持久关窗任务/晚到补偿。

<a id="e14"></a>
### E14 后期低人数

- 实际函数/API/前端入口：[services/api/src/app.ts:890](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:890)；[services/api/src/app.ts:965](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:965)；[services/api/src/orders/formation.ts:193](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:193)。
- 模型：[prisma/schema.prisma:282](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:282)；[prisma/schema.prisma:413](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:413)。
- 已有测试定位：[services/api/src/app.test.ts:1744](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1744)；[services/api/src/app.test.ts:1839](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1839)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：整体失败/运营取消有基础，无餐厅低人数决策及责任者区分。拟增受限确认/失联待办/补偿；RV-03待审。

<a id="e15"></a>
### E15 付费候补

- 实际函数/API/前端入口：[services/api/src/app.ts:1007](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1007)；[services/api/src/orders/inventory.ts:35](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.ts:35)。
- 模型：[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)；[prisma/schema.prisma:446](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:446)。
- 已有测试定位：[services/api/src/app.test.ts:1221](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1221)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：无候补角色/序号；capacityHeld=false不能代表付费候补。拟增队列/有效资格时间/固定序号/人数和资金上限。

<a id="e16"></a>
### E16 候补退出到期

- 实际函数/API/前端入口：[services/api/src/orders/inventory.ts:55](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.ts:55)；[services/api/src/funding/receipts.ts:24](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.ts:24)；[services/api/src/jobs/queue.ts:28](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/jobs/queue.ts:28)。
- 模型：[prisma/schema.prisma:413](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:413)；[prisma/schema.prisma:446](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:446)。
- 已有测试定位：[services/api/src/orders/inventory.test.ts:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.test.ts:1)；[services/api/src/jobs/queue.test.ts:57](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/jobs/queue.test.ts:57)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：待付到期/任务基础有，非候补退出/到期/转正协议。拟同锁唯一决策和退款批次，资格终止与到账分开。

<a id="e17"></a>
### E17 信息权限

- 实际函数/API/前端入口：[services/api/src/app.ts:1121](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1121)；[services/api/src/app.ts:1825](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1825)；[packages/shared/src/rules/addressUnlock.ts:22](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/addressUnlock.ts:22)。
- 模型：[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)；[prisma/schema.prisma:297](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:297)。
- 已有测试定位：[services/api/src/app.test.ts:896](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:896)；[packages/shared/src/rules/shared.test.ts:105](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/shared.test.ts:105)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：本人确认席位基础有，地址仍T-24解锁。拟改按本人本桌即时成团授权/失效保店名/换店同意，终态待OP-15。

<a id="e18"></a>
### E18 取消决策

- 实际函数/API/前端入口：[packages/shared/src/rules/refund.ts:39](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/refund.ts:39)；[services/api/src/app.ts:1225](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1225)；[services/api/src/app.ts:1530](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1530)；[services/api/src/orders/inventory.ts:11](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.ts:11)。
- 模型：[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)；[prisma/schema.prisma:253](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:253)。
- 已有测试定位：[services/api/src/app.test.ts:1903](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1903)；[packages/shared/src/rules/shared.test.ts:143](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/shared.test.ts:143)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：普通取消全人工审核，无F/D/8h/晚报名/原取消政策快照。旧库存全款退完才释放与保F/D冲突；拟拆席位和资金义务并改CHECK约束。

<a id="e19"></a>
### E19 原因及补偿

- 实际函数/API/前端入口：[services/api/src/app.ts:965](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:965)；[services/api/src/orders/formation.ts:193](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:193)；[services/api/src/funding/refunds.ts:43](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:43)。
- 模型：[prisma/schema.prisma:413](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:413)；[prisma/schema.prisma:477](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:477)。
- 已有测试定位：[services/api/src/app.test.ts:1839](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1839)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：运营取消原收款剩余退款义务有，额外补偿责任/凭证缺失。拟原因优先和独立补偿义务，不用补偿替应退现金。

<a id="e20"></a>
### E20 资金事实与恢复

- 实际函数/API/前端入口：[services/api/src/funding/intents.ts:16](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/intents.ts:16)；[services/api/src/funding/receipts.ts:24](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.ts:24)；[services/api/src/funding/refunds.ts:7](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:7)；[services/api/src/events/inbox.ts:28](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/events/inbox.ts:28)；[services/api/src/reconciliation/service.ts:17](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/reconciliation/service.ts:17)。
- 模型：[prisma/schema.prisma:227](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:227)；[prisma/schema.prisma:390](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:390)；[prisma/schema.prisma:413](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:413)；[prisma/schema.prisma:431](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:431)；[prisma/schema.prisma:446](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:446)；[prisma/schema.prisma:465](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:465)；[prisma/schema.prisma:477](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:477)。
- 已有测试定位：[services/api/src/funding/receipts.test.ts:114](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.test.ts:114)；[services/api/src/funding/receipts.test.ts:175](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.test.ts:175)；[services/api/src/funding/receipts.test.ts:298](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.test.ts:298)；[services/api/src/reconciliation/service.test.ts:13](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/reconciliation/service.test.ts:13)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：原绑定、独立收款、晚到/额外义务、总额未知预算、可靠落盘、双向对账有；资金恢复worker仍mock路径。拟扩展D组件/结算在途/翻案，不称整套资金缺失。

<a id="e21"></a>
### E21 扫码与履约

- 实际函数/API/前端入口：[services/api/src/app.ts:438](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:438)；[services/api/src/app.ts:467](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:467)；[services/api/src/auth.ts:6](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/auth.ts:6)。
- 模型：[prisma/schema.prisma:141](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:141)；[prisma/schema.prisma:196](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:196)。
- 已有测试定位：[services/api/src/app.test.ts:2016](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:2016)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：运营结束活动批量COMPLETED，无签到/餐厅身份/逐人正常异常。拟分到店事实和履约结论，scope权限/补录/当晚deadline。

<a id="e22"></a>
### E22 正常退D及漏确认

- 实际函数/API/前端入口：[services/api/src/app.ts:467](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:467)；[services/api/src/funding/refunds.ts:7](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:7)；[services/api/src/worker.ts:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/worker.ts:1)。
- 模型：[prisma/schema.prisma:253](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:253)；[prisma/schema.prisma:446](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:446)。
- 已有测试定位：[services/api/src/app.test.ts:2016](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:2016)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：无正常次日D批次/漏确认待办。拟履约核对义务/自然日批次/止挂期限；漏操作不判违约。

<a id="e23"></a>
### E23 首次争议

- 实际函数/API/前端入口：[services/api/src/app.ts:605](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:605)；[services/api/src/app.ts:632](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:632)；[services/api/src/orders/formation.ts:171](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:171)。
- 模型：[prisma/schema.prisma:308](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:308)；[prisma/schema.prisma:359](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:359)。
- 已有测试定位：[services/api/src/app.test.ts:1660](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1660)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：Report举报非履约争议；deliverInbox的SENT/已读非已批送达证明。拟争议/送达/首轮48h及D暂缓。

<a id="e24"></a>
### E24 默认首次违约

- 实际函数/API/前端入口：[services/api/src/app.ts:632](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:632)；[services/api/src/orders/formation.ts:171](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:171)。
- 模型：[prisma/schema.prisma:359](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:359)；[prisma/schema.prisma:477](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:477)。
- 已有测试定位：[services/api/src/app.test.ts:1660](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1660)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：无默认违约；送达未知不能用SENT计时。OP-13/RV-02未通过不得启用自动不利分支。

<a id="e25"></a>
### E25 异人复核与结算

- 实际函数/API/前端入口：[services/api/src/reconciliation/cases.ts:4](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/reconciliation/cases.ts:4)；[services/api/src/app.ts:1406](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1406)；[services/api/src/funding/refunds.ts:7](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:7)。
- 模型：[prisma/schema.prisma:253](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:253)；[prisma/schema.prisma:477](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:477)。
- 已有测试定位：[services/api/src/jobs/queue.test.ts:57](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/jobs/queue.test.ts:57)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：财务异常owner/reviewer存在，不是用户一次最终复核。拟第二48h/真实不同人/期满与申请互斥/D结算准入和翻案。

<a id="e26"></a>
### E26 特殊例外

- 实际函数/API/前端入口：[services/api/src/app.ts:1225](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1225)；[services/api/src/app.ts:1469](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1469)；[services/api/src/app.ts:1530](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1530)。
- 模型：[prisma/schema.prisma:253](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:253)；[prisma/schema.prisma:344](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:344)。
- 已有测试定位：[services/api/src/app.test.ts:1903](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1903)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：普通人工退款有，缺D_ONLY/F_AND_D、受控证明和原取消档位。拟例外方案授权/材料最小访问/留存，普通与履约争议分流。

<a id="e27"></a>
### E27 换店

- 实际函数/API/前端入口：[services/api/src/app.ts:318](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:318)；[services/api/src/app.ts:965](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:965)。
- 模型：[prisma/schema.prisma:150](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:150)；[prisma/schema.prisma:167](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:167)。
- 已有测试定位：[services/api/src/app.test.ts:1009](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1009)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：安排中餐厅编辑锁有，无逐人proposal/接受/动态deadline/补偿。拟原新条件版本和超时拒绝全退。

<a id="e28"></a>
### E28 核心变更

- 实际函数/API/前端入口：[services/api/src/app.ts:318](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:318)；[services/api/src/app.ts:1762](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1762)。
- 模型：[prisma/schema.prisma:167](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:167)。
- 已有测试定位：[services/api/src/app.test.ts:1009](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:1009)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：无核心时间/费用/场地变更同意及历史；编辑锁不能当已实现。拟proposal/逐人结果；低人数专门例外保留待RV-03。

<a id="e29"></a>
### E29 客服与批次

- 实际函数/API/前端入口：[services/api/src/app.ts:1225](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1225)；[services/api/src/app.ts:1469](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1469)；[apps/miniapp/src/pages/order-detail/index.tsx:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/apps/miniapp/src/pages/order-detail/index.tsx:1)；[services/api/src/worker.ts:1](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/worker.ts:1)。
- 模型：[prisma/schema.prisma:253](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:253)；[prisma/schema.prisma:446](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:446)。
- 已有测试定位：[services/api/src/funding/receipts.test.ts:188](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.test.ts:188)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：审批立即reserveRefund/enqueue，无24h审核/次日批次或客服真实证据。拟受理/时钟分流/自然日漏批升级/状态展示。

<a id="e30"></a>
### E30 注销与隐私

- 实际函数/API/前端入口：[services/api/src/app.ts:229](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:229)；[services/api/src/app.ts:237](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:237)；[services/api/src/auth.ts:68](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/auth.ts:68)。
- 模型：[prisma/schema.prisma:86](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:86)；[prisma/schema.prisma:103](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:103)；[prisma/schema.prisma:390](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/schema.prisma:390)。
- 已有测试定位：[services/api/src/app.test.ts:357](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.test.ts:357)；本轮NOT_RUN，旧测试不是新目标通过证据。
- 已读结论及拟改Schema/API/状态/权限/任务边界：profile历史快照保留，无注销/材料权利/删除恢复日志。拟申请/未结义务/会话最小化与备份重放，资金事实不删。


## 4. 104条独立差分及验收目标

源码统计：IMPLEMENTED 4；PARTIAL 19；MISSING 63；CONFLICT 17；NEEDS_LOCAL_VERIFY 1；总计104。另有真实主体/客服/餐厅签收、身份/资金联调和新迁移兼容待核验。

每行与E域共同构成完整证据：E定位实际函数/API、模型、测试及拟改Schema/API/状态/权限/任务；各行给独立差分及验收。验收目标是对应原规则全文和紧随的展开条件，需按批准OP转成测试断言，不能只测函数存在。

依赖OP/整版签收为POLICY_DECISION_REQUIRED；依赖RV为COMPLIANCE_REVIEW_REQUIRED；E01/06/07/08/14/19/21/22/24/25/26/29/30另需MANUAL_OPERATION_REQUIRED，真实人员、工具、时限和证据未提供。所有运行状态NOT_RUN。

| Rule / 原基线 | 派生政策 | E / 源码状态 | 具体差分 | OP/RV | 候选WP | 验收断言目标（NOT_RUN） |
| --- | --- | --- | --- | --- | --- | --- |
| BAS-01 [L133](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:133) | UA-V1-01/02；PN-V1-01/02 | [E01](#e01) / IMPLEMENTED / READ | 项目定位约束已有 | OP-03/15；RV-04 | WP01/WP10 | 饭局延续“上海本地餐厅兴趣体验工具”的定位，以活动组织、报名、餐厅安排、排桌、到场履约和售后处理为主。不因内部参考性别而改成同桌性别承诺或关系匹配产品。（含展开条件）；NOT_RUN |
| BAS-02 [L135](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:135) | UA-V1-01/02；PN-V1-01/02 | [E01](#e01) / PARTIAL / READ | 地区字段存在，首发上海执行待核验 | OP-03/15；RV-04 | WP01/WP10 | 首发运营上海；允许未来逐步扩展其他城市。允许扩城不等于首发必须实现完整多城市组织、清结算或运营体系。（含展开条件）；NOT_RUN |
| BAS-03 [L137](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:137) | UA-V1-01/02；PN-V1-01/02 | [E01](#e01) / MISSING / READ | 无18+资格机制 | OP-03/15；RV-04 | WP01/WP10 | 仅接受年满 18 周岁的成年人。没有确定年龄核验具体产品方式；不以此自动新增身份证、出生日期或强实名认证。（含展开条件）；NOT_RUN |
| USR-01 [L163](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:163) | UA-V1-02；PN-V1-02/03 | [E02](#e02) / IMPLEMENTED / READ | 公开活动浏览已有 | RV-04 | WP01 | 未完成微信登录和手机号授权的用户可先浏览活动。（含展开条件）；NOT_RUN |
| USR-02 [L165](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:165) | UA-V1-02；PN-V1-02/03 | [E02](#e02) / PARTIAL / READ | 登录手机号校验有，真实身份/续付全前置未验 | RV-04 | WP01 | 报名和付款前必须完成微信登录并授权手机号。（含展开条件）；NOT_RUN |
| USR-03 [L167](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:167) | UA-V1-02；PN-V1-02/03 | [E02](#e02) / MISSING / READ | 无男女性别必填字段 | RV-04 | WP01 | 男/女为报名必填项。不填写不能报名；内部排桌仅将性别均衡作为软参考，不承诺固定比例。（含展开条件）；NOT_RUN |
| USR-04 [L169](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:169) | UA-V1-02；PN-V1-02/03 | [E02](#e02) / MISSING / READ | 无成年声明/核验记录 | RV-04 | WP01 | 必须年满 18 周岁，但不采集具体年龄、出生年份/日期或年龄段；成年资格声明/核验怎么做，留给下游方案评审。（含展开条件）；NOT_RUN |
| USR-05 [L171](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:171) | UA-V1-16；PN-V1-10 | [E03](#e03) / PARTIAL / READ | 单正文同意有，新收费/候补三正文未绑定 | OP-03；公开发布签收 | WP10 | 收费、保证金退扣、候补自动转正、关键时间和重要变更条件，应在付款前可阅读，并与订单适用版本关联。现有单一 AgreementPolicy 如何承接新内容，应核实后设计，不直接假定存在三套同意记录。（含展开条件）；NOT_RUN |
| USR-06 [L198](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:198) | UA-V1-02；PN-V1-03/04 | [E04](#e04) / CONFLICT / READ | 时间必填且无推荐统计 | OP-15 | WP01 | 仅用于优先展示符合时间偏好的活动，以及让运营了解开局需求；不作为报名、付款或排桌硬门槛。（含展开条件）；NOT_RUN |
| USR-07 [L200](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:200) | UA-V1-02；PN-V1-03/04 | [E04](#e04) / CONFLICT / READ | availableTimes最少1项 | OP-15 | WP01 | 未填写仍可浏览、报名、付款和成团。用户主动报名与偏好不一致的时间，视为主动选择该具体活动，不因长期偏好而拒绝报名。（含展开条件）；NOT_RUN |
| USR-08 [L206](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:206) | UA-V1-02；PN-V1-04 | [E05](#e05) / MISSING / READ | 无内部性别软均衡 | RV-04 | WP01/WP04/WP05 | 尽量男女相对均衡，但不要求 1:1；不能因此阻止本已符合硬条件的桌子成团。（含展开条件）；NOT_RUN |
| USR-09 [L208](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:208) | UA-V1-02；PN-V1-04 | [E05](#e05) / MISSING / READ | 无硬条件/FIFO/软目标优先级契约 | RV-04 | WP01/WP04/WP05 | 餐厅人数/容量、报名有效性和付费候补 FIFO 优先；不得为了性别均衡跳过候补队首。（含展开条件）；NOT_RUN |
| USR-10 [L210](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:210) | UA-V1-02；PN-V1-04 | [E05](#e05) / PARTIAL / READ | 定位约束有，新用途告知缺失 | RV-04 | WP01/WP04/WP05 | 不提供同桌性别期待，不承诺具体男女比例。此项只是经营与产品选择，不能据此写成排除任何用户法定救济的总括条款。（含展开条件）；NOT_RUN |
| FEE-01 [L223](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:223) | UA-V1-03；RF-V1-01；RS-V1-04 | [E06](#e06) / CONFLICT / READ | 仅F无D | OP-03/04/14；RV-01/06 | WP03 | 用户向平台支付的业务金额为 `F + D`。费用展示、退还和不退决定必须分别说明 F 与 D，不能笼统写“票价不退”。（含展开条件）；NOT_RUN |
| FEE-02 [L225](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:225) | UA-V1-03；RF-V1-01；RS-V1-04 | [E06](#e06) / IMPLEMENTED / READ | mealFeeIncluded=false及现场自付说明已有 | OP-03/04/14；RV-01/06 | WP03 | M 由用户直接向餐厅支付；平台不代收餐费，不参与餐费分账。这不排除本轮新确认的“违约保证金补偿餐厅”。两者不是同一结算事项。（含展开条件）；NOT_RUN |
| FEE-03 [L227](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:227) | UA-V1-03；RF-V1-01；RS-V1-04 | [E06](#e06) / NEEDS_LOCAL_VERIFY / READ | 正式F/主体/定价策略无签收 | OP-03/04/14；RV-01/06 | WP03 | 活动服务费标准金额尚未确定；不得把对话中的 ¥29、¥49 等例子设为默认上线价格。统一价还是按活动定价，用户没有单独作出选择；“活动级配置”属于此前承接建议，仍需在定价时确认。（含展开条件）；NOT_RUN |
| FEE-04 [L229](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:229) | UA-V1-03；RF-V1-01；RS-V1-04 | [E06](#e06) / MISSING / READ | 无餐厅提出D的逐场签收 | OP-03/04/14；RV-01/06 | WP03 | 由合作餐厅根据该场履约要求提出，平台在对应活动中配置并在付款前展示。平台允许的最高/最低额度、餐厅改价审批和生效范围尚未确定。（含展开条件）；NOT_RUN |
| VEN-01 [L275](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:275) | RS-V1-01/04/12；UA-V1-03 | [E07](#e07) / PARTIAL / READ | 录入状态有，真实供给证据未核验 | OP-03/09 | WP02 | 餐厅应针对具体活动确认预约时间、桌型、容量、可接待条件、费用、联系人与异常处置。空白模板不构成真实签收。（含展开条件）；NOT_RUN |
| VEN-02 [L277](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:277) | RS-V1-01/04/12；UA-V1-03 | [E07](#e07) / CONFLICT / READ | budget单值不是预计消费区间 | OP-03/09 | WP02 | 报名付款前必须展示由餐厅确认的预计人均消费区间；仅为参考，不是最终收费上限。实际餐费依现场点单和结算，由用户直接支付餐厅。（含展开条件）；NOT_RUN |
| VEN-03 [L279](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:279) | RS-V1-01/04/12；UA-V1-03 | [E07](#e07) / MISSING / READ | 无固定费快照/变更告知 | OP-03/09 | WP02 | 最低消费、包间费、服务费、茶位费等可预先确定的固定收费必须在付款前展示；不能到店后未经告知直接增加。（含展开条件）；NOT_RUN |
| VEN-04 [L287](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:287) | RS-V1-02/03；UA-V1-04 | [E08](#e08) / PARTIAL / READ | 三人数校验有，maxTables缺失 | OP-06 | WP02/WP05 | （含展开条件）；NOT_RUN |
| VEN-05 [L298](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:298) | RS-V1-02/03；UA-V1-04 | [E08](#e08) / CONFLICT / READ | 运营配置人数，无餐厅确认限制 | OP-06 | WP02/WP05 | 运营无权为方便排桌自行修改这些参数。需要修改时，先重新取得餐厅确认并留存新记录；涉及已售核心条件，还需按第 14 节处理。（含展开条件）；NOT_RUN |
| VEN-06 [L300](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:300) | RS-V1-02/03；UA-V1-04 | [E08](#e08) / MISSING / READ | 无签收分配策略 | OP-06 | WP02/WP05 | 由餐厅针对该场确认。例如允许 6+4，还是优先 5+5，不能由平台在未确认规则下自由选择。（含展开条件）；NOT_RUN |
| VEN-07 [L318](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:318) | UA-V1-04；PN-V1-05；RS-V1-04 | [E09](#e09) / CONFLICT / READ | 付款后排桌才拦截特殊饮食 | OP-10；RV-05/07 | WP01/WP02 | 明确需要餐厅专门保障、但本场不提供保障的安排，应在报名/付款前阻止收费；不能等收款后排桌失败，也不能靠用户勾选自行承担风险绕过。（含展开条件）；NOT_RUN |
| VEN-08 [L320](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:320) | UA-V1-04；PN-V1-05；RS-V1-04 | [E09](#e09) / CONFLICT / READ | 普通口味等旧画像仍采集 | OP-10；RV-05/07 | WP01/WP02 | Q44 已撤掉普通口味偏好，不继续要求填写旧口味问卷。（含展开条件）；NOT_RUN |
| FORM-01 [L371](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:371) | UA-V1-05；RS-V1-03 | [E10](#e10) / CONFLICT / READ | 人工confirmFormation前置 | OP-04/06 | WP05 | 某一桌的有效正式成员达到餐厅确认的最低人数，立即正式成团，不等运营再次点击、不必凑到目标人数。（含展开条件）；NOT_RUN |
| FORM-02 [L375](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:375) | UA-V1-05；RS-V1-03 | [E10](#e10) / CONFLICT / READ | 确认后无补至max的报名协议 | OP-04/06 | WP05 | 成团后仍可补至餐厅最大人数。目标人数不是禁止新增成员的上限；真正硬上限是单桌最大人数及本场最大桌数。（含展开条件）；NOT_RUN |
| FORM-03 [L377](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:377) | UA-V1-05；RS-V1-03 | [E10](#e10) / PARTIAL / READ | 算法min有，新逐桌自动结果无 | OP-04/06 | WP05 | T-24h 时“最低 4、目标 6、最大 6”的桌有 5 人，照常举行；不得仅因为未到目标人数判成团失败。（含展开条件）；NOT_RUN |
| FORM-04 [L381](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:381) | UA-V1-06；RS-V1-05 | [E11](#e11) / MISSING / READ | 无候补先于新报名 | OP-04/05/08 | WP04/WP05 | 释放席位时，先依付费候补 FIFO 处理有效候补；队列为空后新报名才可直接拿到空位。（含展开条件）；NOT_RUN |
| FORM-05 [L383](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:383) | UA-V1-06；RS-V1-05 | [E11](#e11) / MISSING / READ | 无转正/整桌成团独立事实 | OP-04/05/08 | WP04/WP05 | 候补转正取得正式席位后，仍看该桌实际有效人数是否达到最低值；若已经达到，则用户进入已成团桌；否则处于待成团。（含展开条件）；NOT_RUN |
| FORM-06 [L385](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:385) | UA-V1-05/07；RS-V1-03 | [E12](#e12) / CONFLICT / READ | 正式GROUPED不可逆 | OP-01/02/04 | WP05/WP06 | 成团后成员取消导致该桌人数低于最低值，该桌可以失去成团状态，不能继续沿用“首次成团永久不可逆”。（含展开条件）；NOT_RUN |
| FORM-07 [L389](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:389) | UA-V1-05/07；RS-V1-03 | [E12](#e12) / MISSING / READ | 无失效后补招到T-24 | OP-01/02/04 | WP05/WP06 | 成团失效后不立即取消全部订单，重新待成团并继续接受合法新报名/候补递补。（含展开条件）；NOT_RUN |
| FORM-08 [L391](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:391) | UA-V1-05/07；RS-V1-03 | [E12](#e12) / MISSING / READ | 无再次成团事件 | OP-01/02/04 | WP05/WP06 | 再次达到最低人数则再次成团，并重新开放详细地址。（含展开条件）；NOT_RUN |
| FORM-09 [L393](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:393) | UA-V1-05/07；RS-V1-03 | [E12](#e12) / PARTIAL / READ | 整体失败义务有，缺T-24逐桌决策 | OP-01/02/04 | WP05/WP06 | 到 T-24h 仍未达到最低人数，该桌失败，剩余仍愿意参加的用户 F+D 全退。无须按这些用户的主动取消档扣费。（含展开条件）；NOT_RUN |
| FORM-10 [L399](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:399) | UA-V1-05/08；RF-V1-03 | [E13](#e13) / CONFLICT / READ | GROUPED无晚窗口直接报名 | OP-01/05 | WP05/WP06 | 该窗口可向有效已成团、仍有空位的桌直接报名，不再处理任何候补。（含展开条件）；NOT_RUN |
| FORM-11 [L401](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:401) | UA-V1-05/08；RF-V1-03 | [E13](#e13) / CONFLICT / READ | 无晚报名类别及仅退D | OP-01/05 | WP05/WP06 | 这些新用户即使加入时已经成团，主动取消仍看普通时间阶梯，不因加入已成团桌立即失去可退保证金资格。（含展开条件）；NOT_RUN |
| FORM-12 [L407](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:407) | UA-V1-05/08；RF-V1-03 | [E13](#e13) / MISSING / READ | 配置截止不等于T-8关窗 | OP-01/05 | WP05/WP06 | 到 T-8h 关闭本场所有新报名，之后不因临时空位重新招募或恢复候补。（含展开条件）；NOT_RUN |
| FORM-13 [L409](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:409) | UA-V1-10；RS-V1-06；RF-V1-04 | [E14](#e14) / MISSING / READ | 无后期退出仍达min维护协议 | OP-07；RV-03 | WP02/WP05/WP06 | 正常履约，无须等目标人数。（含展开条件）；NOT_RUN |
| FORM-14 [L411](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:411) | UA-V1-10；RS-V1-06；RF-V1-04 | [E14](#e14) / MISSING / READ | 无餐厅低人数决定 | OP-07；RV-03 | WP02/WP05/WP06 | 因成员退出跌破最低值，餐厅决定是否仍按实际人数接待。（含展开条件）；NOT_RUN |
| FORM-15 [L420](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:420) | UA-V1-10；RS-V1-06；RF-V1-04 | [E14](#e14) / MISSING / READ | 无责任退出者/剩余者分流 | OP-07；RV-03 | WP02/WP05/WP06 | Q73 的导致人数下降的主动取消者仍按自身取消规则处理，不能因其后整桌取消自动获得全额退款；其他被动受影响者全退加补偿。这个明确决定来自 T-8h 后场景，不把它无条件扩张到所有其他责任争议。（含展开条件）；NOT_RUN |
| FORM-16 [L422](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:422) | UA-V1-10；RS-V1-06；RF-V1-04 | [E14](#e14) / MISSING / READ | 无低人数专门例外边界 | OP-07；RV-03 | WP02/WP05/WP06 | 餐厅同意低于最低人数接待后，如果又有人退出，是否需要再次确认、最低能否低至 1—2 人、以及与用户原付款告知如何一致，均未确定。保留餐厅可继续接待的业务选择，不虚构最低底线。（含展开条件）；NOT_RUN |
| WL-01 [L449](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:449) | UA-V1-06；RS-V1-05；RF-V1-02 | [E15](#e15) / MISSING / READ | 无付费候补身份 | OP-04/05/08 | WP04 | 餐厅正式容量已满后，用户可支付 F+D 进入候补，而不是立即获得正式席位。（含展开条件）；NOT_RUN |
| WL-02 [L451](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:451) | UA-V1-06；RS-V1-05；RF-V1-02 | [E15](#e15) / MISSING / READ | 无付款前候补告知 | OP-04/05/08 | WP04 | 候补身份、自动递补、截止时间与未转正退款，应与正式席位报名有清晰区分。付款成功本身不能显示成“已成团/已安排桌位”。（含展开条件）；NOT_RUN |
| WL-03 [L455](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:455) | UA-V1-06；RS-V1-05；RF-V1-02 | [E15](#e15) / MISSING / READ | 无FIFO队列 | OP-04/05/08 | WP04 | 严格先到先得；运营不能因性别、偏好或餐厅指定跳过仍有效的前序用户。（含展开条件）；NOT_RUN |
| WL-04 [L457](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:457) | UA-V1-06；RS-V1-05；RF-V1-02 | [E15](#e15) / MISSING / READ | 无自动递补通知 | OP-04/05/08 | WP04 | 在 T-24h 前有合法席位，按 FIFO 自动转正，无须再次确认；转正后应通知用户。用户在付费候补时应已知该机制。（含展开条件）；NOT_RUN |
| WL-05 [L459](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:459) | UA-V1-06；RS-V1-05；RF-V1-02 | [E15](#e15) / MISSING / READ | 无资格时刻及同刻排序 | OP-04/05/08 | WP04 | “进入候补先后”已经明确，但到底按有效支付完成、渠道成功时间、平台确认时间还是候补资格生成时间排序，以及同一时刻的稳定排序键，并没有逐项确定。技术方案须保持先到先得且留证，不能悄悄改成性别优先。（含展开条件）；NOT_RUN |
| WL-06 [L463](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:463) | UA-V1-06；RF-V1-02/07 | [E16](#e16) / MISSING / READ | 无候补退出全退 | OP-05/08/11 | WP04/WP06 | 只要仍处候补，用户主动退出一律 F+D 全退，不适用 24h/8h 扣费。该选择覆盖 Q61 的旧回答。（含展开条件）；NOT_RUN |
| WL-07 [L465](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:465) | UA-V1-06；RF-V1-02/07 | [E16](#e16) / MISSING / READ | 无T-24候补到期 | OP-05/08/11 | WP04/WP06 | 未获得正式席位的候补自动结束，F+D 全退；不继续占用资格等候更晚空位，不将该情况标为用户主动取消。（含展开条件）；NOT_RUN |
| WL-08 [L467](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:467) | UA-V1-06；RF-V1-02/07 | [E16](#e16) / MISSING / READ | 无候补不后延规则 | OP-05/08/11 | WP04/WP06 | T-24h 至 T-8h 仅有正式空位的直接报名，不再恢复原队列。（含展开条件）；NOT_RUN |
| WL-09 [L469](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:469) | UA-V1-06；RF-V1-02/07 | [E16](#e16) / MISSING / READ | 无资格结束与退款进度区分 | OP-05/08/11 | WP04/WP06 | “自动结束并全退”确定的是资格结束和退款义务，不表示微信资金在该瞬间必定到账；实际发起与到账应遵守第 15 节。系统生成退款是否需要一层人工审核，Q58 与 Q99 没有逐项闭合，见 OP-11。（含展开条件）；NOT_RUN |
| WL-10 [L471](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:471) | UA-V1-06；RF-V1-02/07 | [E16](#e16) / MISSING / READ | 无退出/转正互斥权益 | OP-05/08/11 | WP04/WP06 | 同一用户在点击退出时恰遇自动转正，应有唯一可追溯结果。具体业务生效顺序待方案确定；不得同时当成“候补已退出”又按正式成团扣保证金。（含展开条件）；NOT_RUN |
| INFO-01 [L489](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:489) | UA-V1-07/13；RS-V1-05 | [E17](#e17) / CONFLICT / READ | 本人席位基础有，地址仍等T-24 | OP-15；RV-07 | WP05/WP08 | 某活动的一桌成团，不意味着其他未成团桌或所有候补都拥有同样的地址访问权限。（含展开条件）；NOT_RUN |
| INFO-02 [L491](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:491) | UA-V1-07/13；RS-V1-05 | [E17](#e17) / MISSING / READ | 无失效保名称藏地址历史 | OP-15；RV-07 | WP05/WP08 | 重新隐藏只指后续系统展示/接口访问，不声称能收回用户已经看到、记住或截图的地址。不得在协议中承诺物理意义的“撤回已知地址”。（含展开条件）；NOT_RUN |
| INFO-03 [L493](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:493) | UA-V1-07/13；RS-V1-05 | [E17](#e17) / MISSING / READ | 无核心替换同意 | OP-15；RV-07 | WP05/WP08 | 餐厅更换后不是在原订单里静默换地址；需按第 14 节取得明确接受并保留变更记录。（含展开条件）；NOT_RUN |
| REF-01 [L530](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:530) | UA-V1-08；RF-M02—04 | [E18](#e18) / MISSING / READ | 无政策义务有效时刻，迟任务不能重算扣费 | OP-01/02/05；RV-01 | WP06 | T-24h 本应失败或结束的候补/待成团订单，不能仅因后台未及时处理，就被改算作 T-8h 以内的普通取消。属于哪个事实、义务何时形成，应由事件规则说明，不能把运行延迟转成新扣费理由。（含展开条件）；NOT_RUN |
| REF-02 [L542](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:542) | UA-V1-08；RF-M02—04 | [E18](#e18) / CONFLICT / READ | 仅人工审核无成团/晚报名矩阵 | OP-01/02/05；RV-01 | WP06 | 普通早期报名用户在一桌提前成团后，即使距离活动仍超过 24h，主动取消仍两项不退。这是用户明确选择，不能被旧草案“开始前取消都全退”覆盖。（含展开条件）；NOT_RUN |
| REF-03 [L544](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:544) | UA-V1-08；RF-M02—04 | [E18](#e18) / MISSING / READ | 曾成团现等待待OP-02 | OP-01/02/05；RV-01 | WP06 | 如果曾成团后又重新待成团，适用第 10.2 还是 10.3，尚未确定；不能为达到任意结果只选当前状态或首次成团记录。（含展开条件）；NOT_RUN |
| REF-04 [L581](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:581) | UA-V1-09；RF-V1-04 | [E19](#e19) / PARTIAL / READ | 运营取消有，原因分流不足 | OP-09/14 | WP06/WP08 | 平台/餐厅原因无法履约，不能因用户操作了“退出/退款”按钮就变成普通用户主动取消。（含展开条件）；NOT_RUN |
| REF-05 [L583](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:583) | UA-V1-09；RF-V1-04 | [E19](#e19) / MISSING / READ | 无必备额外补偿义务 | OP-09/14 | WP06/WP08 | 运营可以决定补偿形式和程度；对于已明确“需要补偿”的场景，不能把 Q30 解读成“可自行决定完全不补偿”。（含展开条件）；NOT_RUN |
| REF-06 [L599](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:599) | RF-V1-01/08；RF-M08/09 | [E20](#e20) / PARTIAL / READ | 原渠道绑定有，客观不可用人工流程无 | OP-04/14；RV-06 | WP03/WP06 | 正常保证金退还、主动取消退款、失败退款、例外退款均原则上原支付渠道原路退回。原渠道客观不能完成时才进入人工异常处理；不默认转余额、不用优惠券替代应退现金。（含展开条件）；NOT_RUN |
| REF-07 [L601](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:601) | RF-V1-01/08；RF-M08/09 | [E20](#e20) / IMPLEMENTED / READ | 晚到/额外收款事实及义务已有 | OP-04/14；RV-06 | WP03/WP06 | 订单关闭后的晚到收款、额外重复收款与未知退款，须保留事实并追踪处理。旧清单报告已有相应独立资金事实/退款义务，但本轮未复验，且新保证金业务需要重新映射。（含展开条件）；NOT_RUN |
| REF-08 [L603](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:603) | RF-V1-01/08；RF-M08/09 | [E20](#e20) / PARTIAL / READ | 总额未知预算有，D处置/结算预算无 | OP-04/14；RV-06 | WP03/WP06 | 处于待退款、申诉/复核或补偿归属尚未确定的 D，不能同时作为可结算餐厅补偿和已确认平台收入。业务账务细分与回退规则属于技术/资金设计，不在本文指定实现。（含展开条件）；NOT_RUN |
| FUL-01 [L610](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:610) | UA-V1-11；RS-V1-07；PN-V1-03 | [E21](#e21) / MISSING / READ | 无扫码签到 | OP-12/15 | WP07 | 由餐厅提供该场饭局签到二维码，用户使用小程序扫码形成到店记录。（含展开条件）；NOT_RUN |
| FUL-02 [L612](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:612) | UA-V1-11；RS-V1-07；PN-V1-03 | [E21](#e21) / CONFLICT / READ | 批量COMPLETED替代逐人履约事实 | OP-12/15 | WP07 | 用户已扫码并不自动等于正常履约，也不直接触发保证金退款；餐厅仍须确认正常/异常。（含展开条件）；NOT_RUN |
| FUL-03 [L618](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:618) | UA-V1-11；RS-V1-07；PN-V1-03 | [E21](#e21) / MISSING / READ | 无餐厅正常/异常两类确认 | OP-12/15 | WP07 | 餐厅在饭局结束后确认“正常履约”或“履约异常”。“尚未确认”是待办进度，不是第三种违约结论。（含展开条件）；NOT_RUN |
| FUL-04 [L620](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:620) | UA-V1-11；RS-V1-07；PN-V1-03 | [E21](#e21) / MISSING / READ | 无当晚确认时钟 | OP-12/15 | WP07 | 餐厅须在饭局结束当晚完成确认/异常标记。（含展开条件）；NOT_RUN |
| FUL-05 [L622](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:622) | UA-V1-11；RS-V1-07；PN-V1-03 | [E21](#e21) / PARTIAL / READ | 未见自动迟到扣款，但新履约流程无 | OP-12/15 | WP07 | 没有选择固定迟到分钟数或一过开始时刻即违约。实际到场和履约由餐厅确认，争议由平台审核；平台尚需确定可对外解释的行为与证据标准。（含展开条件）；NOT_RUN |
| FUL-06 [L628](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:628) | UA-V1-11/14；RF-V1-05/07；RS-V1-07 | [E22](#e22) / MISSING / READ | 无次日正常退D批次 | OP-11/12 | WP03/WP06/WP07 | 正常履约者 D 全额原路退，F 正常收取；平台在饭局结束后的次日统一核对并发起退款。（含展开条件）；NOT_RUN |
| FUL-07 [L630](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:630) | UA-V1-11/14；RF-V1-05/07；RS-V1-07 | [E22](#e22) / PARTIAL / READ | 以渠道结果为准已有，D批次展示无 | OP-11/12 | WP03/WP06/WP07 | 用户端应区分确认完成、待批量退款、已向渠道发起和实际退款成功；不能在商家点了“正常”时直接显示到账。（含展开条件）；NOT_RUN |
| FUL-08 [L634](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:634) | UA-V1-11/14；RF-V1-05/07；RS-V1-07 | [E22](#e22) / MISSING / READ | 无漏确认运营待办 | OP-11/12 | WP03/WP06/WP07 | 餐厅当晚未完成确认，次日不自动退款，进入运营异常待办，由平台联系餐厅补确认。（含展开条件）；NOT_RUN |
| FUL-09 [L636](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:636) | UA-V1-11/14；RF-V1-05/07；RS-V1-07 | [E22](#e22) / MISSING / READ | 无漏确认非违约区分 | OP-11/12 | WP03/WP06/WP07 | 漏确认不等于用户未到场或履约失败，不据此直接把保证金划给餐厅。（含展开条件）；NOT_RUN |
| DISP-01 [L658](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:658) | UA-V1-12；RF-V1-05；RS-V1-08 | [E23](#e23) / MISSING / READ | 举报不是餐厅履约异常入口 | OP-11/12/13；RV-02 | WP07 | 餐厅可先直接标记异常，不要求当场上传完整证据；平台后续联系餐厅了解原因、事实与必要证明。（含展开条件）；NOT_RUN |
| DISP-02 [L660](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:660) | UA-V1-12；RF-V1-05；RS-V1-08 | [E23](#e23) / MISSING / READ | 无D争议暂缓 | OP-11/12/13；RV-02 | WP07 | 异常标记只使 D 进入待审核/暂缓退还，不等于已扣除、已确认为餐厅收入或已经转账。（含展开条件）；NOT_RUN |
| DISP-03 [L662](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:662) | UA-V1-12；RF-V1-05；RS-V1-08 | [E23](#e23) / MISSING / READ | 无平台履约争议结论 | OP-11/12/13；RV-02 | WP07 | 餐厅提供事实，平台决定是否违约、是否退 D；餐厅无单方扣款权。（含展开条件）；NOT_RUN |
| DISP-04 [L666](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:666) | UA-V1-12；RF-V1-05；RS-V1-08 | [E23](#e23) / MISSING / READ | 无用户说明流程 | OP-11/12/13；RV-02 | WP07 | 在作出履约违约与保证金扣除结论前，平台需通知用户并给予说明/申诉机会。（含展开条件）；NOT_RUN |
| DISP-05 [L668](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:668) | UA-V1-12；RF-V1-05；RS-V1-08 | [E23](#e23) / MISSING / READ | 无收到通知起48h时钟 | OP-11/12/13；RV-02 | WP07 | 从用户收到履约异常通知起，给予 48 小时提交说明/申诉；期间 D 保持待审核，不在期限未结束前直接产生最终扣除结论。（含展开条件）；NOT_RUN |
| DISP-06 [L674](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:674) | UA-V1-12；RF-V1-05；PN-V1-09 | [E24](#e24) / MISSING / READ | 默认首轮违约未实现且未获专项启用 | OP-13；RV-02，不能默认启用 | WP07 | 48 小时内完全不回应，按 Q83 的 C 处理：。不能把它改写成用户只放弃申诉、平台仍必须另作实体裁决的 A 选项。（含展开条件）；NOT_RUN |
| DISP-07 [L676](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:676) | UA-V1-12；RF-V1-05；PN-V1-09 | [E24](#e24) / MISSING / READ | 证据不足与沉默冲突待审 | OP-13；RV-02，不能默认启用 | WP07 | Q80 的承接解释曾写“餐厅不能仅凭异常标签、没有足够事实就没收保证金”；而 Q83 并未明确“默认违约是否仍要求餐厅证据达标”。二者交集尚未闭合。需要审定餐厅举证前提和送达条件后，才能把超时写成自动扣保证金触发器。（含展开条件）；NOT_RUN |
| DISP-08 [L682](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:682) | UA-V1-12；RF-V1-05；PN-V1-09 | [E24](#e24) / MISSING / READ | 无首轮原因金额去向结果通知 | OP-13；RV-02，不能默认启用 | WP07 | 用户提交材料时，平台综合餐厅、用户、签到和相关记录作出首次结论。最终是否违约由平台决定。（含展开条件）；NOT_RUN |
| DISP-09 [L684](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:684) | UA-V1-12；RF-V1-05；PN-V1-09 | [E24](#e24) / MISSING / READ | 无首轮结果送达/复核时钟关联 | OP-13；RV-02，不能默认启用 | WP07 | 用户收到首次处理结果后可申请最终复核，必须有对应结果通知和时间证据。（含展开条件）；NOT_RUN |
| DISP-10 [L690](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:690) | UA-V1-12；RF-V1-05；RS-V1-08/09 | [E25](#e25) / MISSING / READ | 无一次最终复核受理 | OP-11/13/14；RV-06 | WP07/WP03 | 用户对首次结果不服，可以申请一次最终复核。（含展开条件）；NOT_RUN |
| DISP-11 [L692](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:692) | UA-V1-12；RF-V1-05；RS-V1-08/09 | [E25](#e25) / PARTIAL / READ | 财务异常有异人检查，非用户履约复核 | OP-11/13/14；RV-06 | WP07/WP03 | 最终复核必须由不同于首次审核人员的人处理；需要实际人员安排，不能仅在系统里换一个角色名。（含展开条件）；NOT_RUN |
| DISP-12 [L694](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:694) | UA-V1-12；RF-V1-05；RS-V1-08/09 | [E25](#e25) / MISSING / READ | 无第二48h申请期 | OP-11/13/14；RV-06 | WP07/WP03 | 从用户收到首次处理结果起 48 小时内提出。（含展开条件）；NOT_RUN |
| DISP-13 [L696](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:696) | UA-V1-12；RF-V1-05；RS-V1-08/09 | [E25](#e25) / MISSING / READ | 无复核D结算禁令/竞争协议 | OP-11/13/14；RV-06 | WP07/WP03 | 首次违约结果后的复核申请窗口内，暂不将争议 D 结算给餐厅；若用户按期申请，继续保持待处理，直到最终复核结束。（含展开条件）；NOT_RUN |
| DISP-14 [L698](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:698) | UA-V1-12；RF-V1-05；RS-V1-08/09 | [E25](#e25) / MISSING / READ | 无最终结果到D退款/补偿 | OP-11/13/14；RV-06 | WP07/WP03 | 翻案应按结果原路退 D；维持违约则按既定归属处理，并再次通知用户。这里的“最终”是平台内部处理结论，不写成排除其他救济渠道的表述。（含展开条件）；NOT_RUN |
| DISP-15 [L704](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:704) | UA-V1-12；RF-V1-05；RS-V1-08/09 | [E25](#e25) / MISSING / READ | 无餐厅D结算 | OP-11/13/14；RV-06 | WP07/WP03 | 首次违约结果收到后 48h 内未申请最终复核，期满进入餐厅补偿结算，不再以新增运营审批作为 Q88 已选流程的默认前置。（含展开条件）；NOT_RUN |
| EXC-01 [L736](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:736) | UA-V1-09；RF-V1-06；PN-V1-05 | [E26](#e26) / PARTIAL / READ | 退款申请有，非特殊申诉 | OP-10/11/14；RV-05 | WP06/WP07 | 已正式成团的用户，因突发疾病、航班取消或重大交通中断等特殊情况无法参加，可申请例外退款。（含展开条件）；NOT_RUN |
| EXC-02 [L740](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:740) | UA-V1-09；RF-V1-06；PN-V1-05 | [E26](#e26) / MISSING / READ | 无最小证明受控通道 | OP-10/11/14；RV-05 | WP06/WP07 | 原则上提供能够支持申诉的合理材料，只收完成审核必要的信息。（含展开条件）；NOT_RUN |
| EXC-03 [L752](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:752) | UA-V1-09；RF-V1-06；PN-V1-05 | [E26](#e26) / CONFLICT / READ | 拒绝看当前事实无原取消档位 | OP-10/11/14；RV-05 | WP06/WP07 | 保证金归属看原取消受理时间，而不是运营多久后驳回；普通成团后取消若原本 Δ>24h，D 业务归平台；若 Δ≤24h，D 补偿餐厅。（含展开条件）；NOT_RUN |
| EXC-04 [L754](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:754) | UA-V1-09；RF-V1-06；PN-V1-05 | [E26](#e26) / CONFLICT / READ | 整笔审批无D_ONLY/F_AND_D | OP-10/11/14；RV-05 | WP06/WP07 | 运营可在 Q32 两种方案间选择，需要原因和依据；不代表可以随意改写所有用户的正常取消档位。（含展开条件）；NOT_RUN |
| CHG-01 [L767](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:767) | UA-V1-13；RS-V1-10；RF-V1-04 | [E27](#e27) / MISSING / READ | 编辑锁不是换店先同意 | OP-09/13 | WP08 | 已成团并披露餐厅后，原餐厅无法履约，平台可提出替代餐厅，但不能单方替换。（含展开条件）；NOT_RUN |
| CHG-02 [L771](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:771) | UA-V1-13；RS-V1-10；RF-V1-04 | [E27](#e27) / MISSING / READ | 无明确接受记录 | OP-09/13 | WP08 | 用户明确同意则继续；拒绝或确认期限届满未回复视为不同意，F+D 全退。（含展开条件）；NOT_RUN |
| CHG-03 [L773](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:773) | UA-V1-13；RS-V1-10；RF-V1-04 | [E27](#e27) / MISSING / READ | 无动态期限/超时拒绝全退 | OP-09/13 | WP08 | 依距开始的剩余时间设置，在通知时明确截止时间；不采用全场固定 2h/4h，不把无回复视为默认接受。（含展开条件）；NOT_RUN |
| CHG-04 [L777](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:777) | UA-V1-13；RS-V1-10；RF-V1-04 | [E27](#e27) / MISSING / READ | 无原餐厅额外补偿义务 | OP-09/13 | WP08 | 原餐厅应提供额外补偿。由原餐厅承担的金额、形式、是否包括同意替换后继续参加的用户，以及平台先行补偿与向原餐厅追偿的关系待定。（含展开条件）；NOT_RUN |
| CHG-05 [L781](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:781) | UA-V1-13；RS-V1-10；RF-V1-04 | [E28](#e28) / MISSING / READ | 无核心条件重新同意 | OP-07/09；RV-03 | WP08 | 已成团后，预计消费明显变化、新增最低消费/固定额外费、时间明显变更、包间改大厅等核心条件变化，须获得用户明确同意；不同意可无责退出，F+D 全退。（含展开条件）；NOT_RUN |
| CHG-06 [L783](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:783) | UA-V1-13；RS-V1-10；RF-V1-04 | [E28](#e28) / PARTIAL / READ | 现场自付有，费用区间/固定费类型无 | OP-07/09；RV-03 | WP08 | 用户现场自行点单导致消费高于预计区间，适用 Q17 的参考价规则；餐厅/平台主动改变核心服务或新增固定收费，适用 Q94，不可用“预计仅供参考”掩盖。（含展开条件）；NOT_RUN |
| CHG-07 [L785](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:785) | UA-V1-13；RS-V1-10；RF-V1-04 | [E28](#e28) / MISSING / READ | 无不回应变更收口 | OP-07/09；RV-03 | WP08 | Q94 的承接规则保留这一边界。但其他核心变更是否全部使用 Q93 的动态期限、超时后具体如何结束，未逐项选择，需同步方案。（含展开条件）；NOT_RUN |
| OPS-01 [L811](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:811) | UA-V1-14；RF-V1-07；PN-V1-09 | [E29](#e29) / PARTIAL / READ | API受理有，客服正式受理关系未定 | OP-11/13 | WP06/WP07/WP10 | 取消、退款、申诉等应记录系统真实受理时间，不能因人工晚读消息让用户落入更不利取消档位。（含展开条件）；NOT_RUN |
| OPS-02 [L830](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:830) | UA-V1-14；RF-V1-07；PN-V1-09 | [E29](#e29) / PARTIAL / READ | 渠道未知成功有，待批次与D状态无 | OP-11/13 | WP06/WP07/WP10 | “已申请”“审核通过”“待批量发起”“已提交渠道”“退款结果未知/处理中”“已退款成功”不应相互冒充。业务展示名称可由产品设计，但不能把审核通过直接显示为已到账。（含展开条件）；NOT_RUN |
| OPS-03 [L832](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:832) | UA-V1-14；RF-V1-07；PN-V1-09 | [E29](#e29) / MISSING / READ | 无24h/两次48h分流 | OP-11/13 | WP06/WP07/WP10 | Q98 一般退款审核是 24h；履约申诉的用户说明窗口为 48h。如果同一事件被系统同时套入两者，就会出现尚未等完用户说明却要求审核结案。两类适用范围和时限优先级尚未明确，必须在流程中分开评审，不能靠“人工尽快”掩盖。（含展开条件）；NOT_RUN |
| PRI-01 [L836](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:836) | UA-V1-15；PN-V1-06—10 | [E30](#e30) / MISSING / READ | 无随时注销申请 | OP-10/15；RV-04/05 | WP09 | 用户可以提出注销，不必先自行证明所有订单已结清。（含展开条件）；NOT_RUN |
| PRI-02 [L838](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:838) | UA-V1-15；PN-V1-06—10 | [E30](#e30) / MISSING / READ | 无注销前全义务收口 | OP-10/15；RV-04/05 | WP09 | 存在未结束活动、保证金、退款、餐厅补偿、申诉/复核等，进入注销处理中，这些事项继续履行；结清后完成注销。（含展开条件）；NOT_RUN |
| PRI-03 [L840](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:840) | UA-V1-15；PN-V1-06—10 | [E30](#e30) / PARTIAL / READ | 独立实收有，注销不删资金未验 | OP-10/15；RV-04/05 | WP09 | 注销不直接删除已经发生的订单、支付、退款、保证金处置及必要审计，不消灭退款或补偿义务。具体保留、脱敏和期限须与实际主体/业务核实。（含展开条件）；NOT_RUN |
| PRI-04 [L842](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/BUSINESS_RULES_BASELINE.md:842) | UA-V1-15；PN-V1-06—10 | [E30](#e30) / MISSING / READ | 注销期权利待OP-15 | OP-10/15；RV-04/05 | WP09 | 注销申请是否阻止新报名、是否撤回通知权限、能否撤销注销申请、最终完成期限及身份核验方式，本轮没有确认。不得把“可以申请注销”写成所有数据即时自动删除，也不能由注销自动取消现有活动而不告知后果。（含展开条件）；NOT_RUN |

## 5. 无ID规范表逐表核对

逐表保留基线第2—16/18—19节原行；以下原行是上游目标，绝非已完成证明，运行均NOT_RUN。第17节OP/RV见决策提案；第20节64场景见下节；Q追溯/第22节签收不能替代本轮证据。

### M01 2.2 各角色的业务权限（基线L141—L150）

E01/E02/E08/E21/E25：真实主体/餐厅/异人权限及签收待核验。

| 角色 | 主要职责/权限 | 已确认的限制 |
| :--- | :--- | :--- |
| 平台运营主体 | 提供组织服务；处理报名、费用说明、退款、履约争议与补偿安排 | 本文未核实商户号、收款账户、发票与资金结算资质 |
| 用户 | 浏览、报名/候补、付款、取消、扫码签到、申诉/复核、申请注销 | 必须满足准入；不得因收到候补付款凭证就视为已获得桌位 |
| 餐厅 | 确认逐场桌型、容量、费用、接待条件；提供签到二维码；当晚确认正常履约/履约异常 | 无权自行从用户保证金中扣款；运营也不能代餐厅擅改容量参数 |
| 平台运营/客服 | 联系餐厅、通知用户、核实争议、按规则审核、决定获授权的补偿方案 | 不能因客服晚回复改变取消受理时间；不能借人工审核任意改写既定金额规则 |
| 首次审核人员 | 审查履约争议或特殊退款申请 | 普通规则与例外要分别记录；餐厅标签不是已经完成的资金结论 |
| 最终复核人员 | 处理用户一次最终复核申请 | 必须不同于首次审核人员；平台内部最终结论须再次通知 |
| 技术/QA | 将批准规则实现为可验证功能和异常处理 | 不替业务负责人决定待定金额、时限、例外或合规结论 |
| 法务/隐私/资金主责 | 对重要条款、敏感材料、保证金性质、餐厅补偿和结算方式做专项确认 | 本文不冒用这些角色的签收 |

### M02 3.2 首发资料清单（基线L175—L192）

E02—E05/E09/E30：旧画像和时间必填冲突；新资格缺失，历史处理/适配待批准。

| 数据/选项 | 是否采集 | 必填性与用途 | 来源/边界 |
| :--- | :--- | :--- | :--- |
| 微信登录身份 | 保留 | 识别登录用户及订单归属 | Q89 |
| 授权手机号 | 保留 | 报名/付款必备；必要活动联系和异常处理 | Q89 |
| 性别：男/女 | 保留 | 报名必填；仅内部排桌软参考 | Q38、Q40、Q90；需更新隐私文件 |
| 时间偏好 | 保留 | 选填；活动推荐 + 开局需求统计 | Q46—Q48 |
| 具体年龄/年龄段 | 不采集 | 排桌不考虑年龄 | Q41 |
| 出生日期/出生年份 | 不采集 | 不通过年龄问题扩大采集 | Q41 |
| 职业/公司/职级/行业 | 不采集 | 不参与排桌 | Q42 |
| 兴趣爱好 | 不采集 | 不做兴趣标签和匹配 | Q43 |
| 普通口味/菜系偏好 | 不采集 | 不参与排桌 | Q44 |
| 方便参与区域偏好 | 首发暂不采集 | 用户按活动展示的区域自行选择 | Q45 |
| 长期预算偏好 | 不采集 | 根据每场预计消费自行选择 | Q49 |
| 饭局氛围偏好 | 不采集 | 不参与排桌 | Q50 |
| 同桌性别期待 | 不提供、不采集 | 不设希望同性/异性或男女比例选项 | Q39 被后续撤回，Q40 |
| 用户可接受桌位人数范围 | 不再让用户选择 | 按餐厅逐场确认的桌型规则报名 | Q51 覆盖 Q20—Q24 的相关分支 |
| 需要特殊饮食保障的适配判断 | 有收费前拦截要求 | 具体最小字段/告知方式未定；不等于收集完整健康或宗教资料 | Q19、Q44；待定项 OP-10 |
| 用户自述、头像、昵称等其他资料 | 本轮未单独决定 | 不凭这份基线新增必填项 | 待对照现有实现 |

### M03 4.2 付款与退款的金额语义（基线L233—L240）

E06/E20/E25：各D去向及仅退D缺失，原金额预算保留；平台去向不直接计会计收入。

| 业务说法 | 本文的金额含义 |
| :--- | :--- |
| 服务费全退 | 退还该订单尚未退还的 F 对应金额 |
| 保证金全退 | 退还该订单尚未退还的 D 对应金额 |
| 两项全退 / 全额退款 | 针对 F + D，不自动包含到店直接支付的餐费 M |
| 服务费不退、保证金全退 | 保留 F，退还 D；不是任意比例折扣退款 |
| 保证金不退 | 依具体场景确定平台或餐厅归属；尚处申诉/复核的不等于已经结算 |
| 额外补偿 | 应退款项之外另行决定的补偿，不能替代应退现金 |

### M04 4.3 保证金去向总表（基线L246—L260）

E06/E20/E25：各D去向及仅退D缺失，原金额预算保留；平台去向不直接计会计收入。

| 场景 | D 的业务去向 | 来源 |
| :--- | :--- | :--- |
| 正常履约，餐厅确认完成 | 次日核对并原路全退给用户 | Q07、Q76—Q79 |
| 尚在候补时主动退出 | 原路全退给用户 | Q62 |
| T-24h 候补未转正 / 最终未成团 | 原路全退给用户 | Q05、Q58、Q66 |
| 普通未成团取消，按可退保证金档 | 原路全退给用户 | Q03—Q04；等号边界见第 10 节 |
| 普通未成团在不足 8h 取消 | 不退，全部补偿对应餐厅；该正常路径是否可达见第 17 节 | Q04、Q12 |
| 普通正式成团后主动取消，距开始 >24h | 不退，经营意图为平台收入 | Q26—Q28 |
| 普通正式成团后主动取消，距开始 ≤24h | 不退，全部补偿对应餐厅 | Q27—Q28 |
| 晚报名用户取消时距开始仍在保证金可退档 | D 全退 | Q71 |
| 晚报名用户取消时距开始 <8h | 不退，补偿餐厅 | Q71、Q12 |
| No-show / 平台最终认定履约违约 | 不退，补偿对应餐厅；争议流程和结算前置见第 12 节 | Q03、Q11、Q79—Q88 |
| 平台/餐厅取消、批准无责退出 | 原路全退；额外补偿另列 | Q29、Q73、Q92—Q94 |
| 特殊情况申诉获批 | D 全退；F 是否同退由运营在批准范围内选择 | Q32 |
| 餐厅未确认、争议或最终复核未结 | 保持待处理，不自动认定为平台/餐厅已得款项 | Q78、Q87 |

### M05 5.2 正常桌型参数（基线L289—L294）

E07/E08/E11：maxTables/签收及正式候补容量分离缺失。

| 参数 | 业务含义 | 约束 |
| :--- | :--- | :--- |
| 最低成团人数 | 一桌达到此人数才具备正常成团资格 | 正常配置在 4—8 人内 |
| 目标人数 | 餐厅优先希望组织的人数 | 只是目标，不是必须达到的门槛 |
| 单桌最大人数 | 该桌可容纳的业务人数上限 | 正常配置在 4—8 人内，不得突破 |
| 本场最大桌数 | 本次活动最多提供多少桌 | 由餐厅确认，不默认无限多桌 |

### M06 6.1 时间词典（基线L329—L337）

E12/E13/E16/E18/E29：T-24/T-8及自然日批次缺失；受理时间、改期和等号先冻结。

| 符号/说法 | 定义 |
| :--- | :--- |
| T | 该次活动适用的开始时刻 |
| T-24h | 活动开始前 24 小时 |
| T-8h | 活动开始前 8 小时 |
| Δ | 取消请求被系统受理时，距离活动开始的时间，即 `T - 取消受理时刻` |
| 次日 | 在 Asia/Shanghai 口径下的下一个自然日；具体批次几点未定，不等同于随意延后 24 个工作小时 |
| 收到通知 | 申诉/复核期限使用的业务起点；如何证明收到尚未确定，不直接等同于后台创建消息 |
| 24 小时退款审核 | Q98 的用户退款审核时限；不能擅自改成“24 个客服工作小时” |

### M07 6.2 三个报名阶段（基线L345—L350）

E12/E13/E16/E18/E29：T-24/T-8及自然日批次缺失；受理时间、改期和等号先冻结。

| 时间阶段 | 正式报名 | 付费候补 | 成团处理 |
| :--- | :--- | :--- | :--- |
| T-24h 之前 | 可报名；已有候补且出现席位时先处理 FIFO 候补 | 满正式容量后可付费候补；用户可退出全退 | 各桌达最低人数立即成团；仍可补至最大人数 |
| 到达 T-24h | 未达到最低人数的桌应结束待成团并处理退款；已成团桌保留 | 未转正候补结束，F+D 全退；不再建新候补 | 最终成团检查，不要求达到目标人数 |
| T-24h 至 T-8h 的晚报名窗口 | **仅有效已成团且未满桌允许新的直接报名** | 不再建立或恢复候补 | 晚报名用户有独立的取消退款例外 |
| 到达 T-8h 及以后 | 关闭所有新报名；退出后也不招新补位 | 不启用候补 | 维持履约；人数跌破最低值时进入餐厅最终确认 |

### M08 7.5 T-8h 后（基线L413—L418）

E10/E12/E14：逐桌可逆/低人数无实现，业务态不直接当DB enum。

| 餐厅结论 | 其余愿意参加者的处理 | 来源 |
| :--- | :--- | :--- |
| 不继续开桌 | 该桌取消；F+D 全退，并给予由运营决定的额外补偿 | Q73 |
| 愿意继续开桌 | 平台通知实际人数变化；无须其余用户重新确认，订单继续有效 | Q74 |
| 愿意继续，但某位剩余用户因人数少而退出 | 该用户按自身适用的主动取消规则处理，不自动视为无责退款 | Q75 |
| 未回复/尚未决定 | 截止期限与兜底结果没有确认，不得无限维持等待 | OP-07 |

### M09 9. 餐厅名称与地址可见性（基线L480—L487）

E17：本人检查有，T-24解锁冲突，失效保店名/换店/终态缺失。

| 用户/该桌状态 | 餐厅名称 | 详细地址 | 来源 |
| :--- | :--- | :--- | :--- |
| 首次尚未正式成团 | 不展示具体餐厅名称 | 不展示 | Q25 的承接解释，与旧规则一并调整 |
| 首次正式成团且获得有效桌位 | 立即展示 | 立即展示，不等待 T-24h | Q25 |
| 曾成团，后因人数下降重新待成团 | 保留可见 | 重新隐藏 | Q67 |
| 重新成团 | 保留可见 | 再次解锁 | Q67 |
| 付费候补、尚未获得正式席位 | 不因活动其他桌已成团而获得正式席位信息权限 | 不因候补付款解锁正式席位地址 | Q57、Q60；有效席位边界见 S1 第 40 行 |
| 用户取消、退款中、已退款、注销中/完成 | 本轮没有逐项确认所有终态的具体显示范围 | 原清单要求有效席位变化时收回访问，具体实现需与新规则复核 | OP-15 |

### M10 10.1 判定维度（基线L502—L510）

E18/E19/E20/E26：六张金额表必须按F/D、历史、原因、时刻、未知预算共同判定，补偿独立。

| 事实 | 为什么需要 |
| :--- | :--- |
| 用户此刻是候补还是正式席位 | 候补主动退出始终两项全退 |
| 是否属于晚报名窗口加入已成团桌 | 该类用户明确例外适用时间阶梯 |
| 取消被系统受理时刻与适用活动开始时刻 | 判断 Δ 与 24h、8h 档位 |
| 取消前桌子的成团情况，以及是否曾失效 | 曾成团重新待成团的取消规则尚未闭合 |
| 谁发起取消、原因是什么、用户属于何类受影响方 | 平台/餐厅取消不能冒用用户主动取消扣费 |
| 是否存在特殊申诉、已批准例外、履约争议/最终复核 | 决定是否允许例外退 D 或 F+D、是否暂缓结算 |
| F、D 原金额与已退/已处置部分 | 不能重复退款或把餐费混入平台退款 |

### M11 10.2 普通“未成团用户主动取消”（基线L522—L528）

E18/E19/E20/E26：六张金额表必须按F/D、历史、原因、时刻、未知预算共同判定，补偿独立。

| 取消时距开始 Δ | F | D | 不退 D 去向 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| >24h | 全退 | 全退 | 不适用 | 已明确 |
| 恰好 24h | 对话暂按全退 | 对话暂按全退 | 不适用 | **承接口径：最初等号曾标暂定，整版签收时明确** |
| 8h<Δ<24h | 不退 | 全退 | 不适用 | 已明确；普通未成团在此窗口的可达性另见 OP-01 |
| 恰好 8h | 对话暂按不退 | 对话暂按全退 | 不适用 | **承接口径：最初等号曾标暂定，整版签收时明确** |
| 0<Δ<8h | 不退 | 不退 | 补偿对应餐厅 | 已明确；普通未成团路径本身待闭合 |

### M12 10.3 普通正式成团后的主动取消（基线L536—L540）

E18/E19/E20/E26：六张金额表必须按F/D、历史、原因、时刻、未知预算共同判定，补偿独立。

| 取消时距开始 Δ | F | D | D 去向 | 来源 |
| :--- | :--- | :--- | :--- | :--- |
| >24h | 不退 | 不退 | 平台，业务意图为收入 | Q26—Q27 |
| =24h | 不退 | 不退 | 补偿对应餐厅 | Q28 明确选择 B |
| <24h、活动尚未开始 | 不退 | 不退 | 补偿对应餐厅 | Q27—Q28 |

### M13 10.4 晚报名用户主动取消的明确例外（基线L550—L555）

E18/E19/E20/E26：六张金额表必须按F/D、历史、原因、时刻、未知预算共同判定，补偿独立。

| 该用户取消时 Δ | F | D | D 去向 |
| :--- | :--- | :--- | :--- |
| 8h<Δ<24h | 不退 | 全退 | 原路退给用户 |
| 恰好 8h | 对话沿用不退 F、全退 D | 同左 | 等号仍按第 10.2 的承接口径标识 |
| 0<Δ<8h | 不退 | 不退 | 补偿餐厅 |
| 最终 No-show/确认违约 | 不退 | 不退 | 补偿餐厅；履约争议流程仍适用 |

### M14 10.5 候补与成团失败（基线L561—L566）

E18/E19/E20/E26：六张金额表必须按F/D、历史、原因、时刻、未知预算共同判定，补偿独立。

| 情况 | F | D | 额外补偿 | 来源 |
| :--- | :--- | :--- | :--- | :--- |
| 尚在候补，用户主动退出 | 全退 | 全退 | 未约定 | Q62 |
| T-24h 候补仍未转正 | 全退 | 全退 | 未约定 | Q58 |
| 普通桌最终未成团 | 全退 | 全退 | 未统一承诺 | Q05 |
| 曾成团后失效，T-24h 仍无法恢复，剩余用户 | 全退 | 全退 | 未统一承诺 | Q66 |

### M15 10.6 平台、餐厅原因及后期低人数（基线L572—L579）

E18/E19/E20/E26：六张金额表必须按F/D、历史、原因、时刻、未知预算共同判定，补偿独立。

| 情况 | 受影响对象 | F / D | 补偿 | 来源 |
| :--- | :--- | :--- | :--- | :--- |
| 平台或餐厅原因取消，无论是否成团 | 因此无法参加的用户 | 两项全退 | 必须额外补偿，方案由运营决定 | Q06、Q29—Q30 |
| T-8h 后因他人退出跌破最低，餐厅不继续接待 | 剩余愿意参加者 | 两项全退 | 必须额外补偿，运营决定 | Q73 |
| 上一行中导致人数不足的主动取消者 | 原主动取消用户 | 按其本人适用规则 | 不因后续整桌取消自动增加其退款权利 | Q73 |
| T-8h 后餐厅愿以较少人数继续，用户因人数少退出 | 该退出用户 | 按本人主动取消规则 | 不因此自动补偿 | Q74—Q75 |
| 换餐厅，用户拒绝或确认超时未回复 | 不接受替换者 | 两项全退 | 原餐厅承担额外补偿责任；覆盖对象/金额见 OP-09 | Q92—Q93 |
| 其他核心条件变化，用户不接受 | 不接受变更者 | 两项全退 | 是否统一额外补偿未单独明确 | Q94 |

### M16 10.7 正常履约、No-show 与特殊申诉（基线L587—L593）

E18/E19/E20/E26：六张金额表必须按F/D、历史、原因、时刻、未知预算共同判定，补偿独立。

| 情况 | F | D | 备注 |
| :--- | :--- | :--- | :--- |
| 正常履约 | 正常收取，不退 | 全退 | 餐厅当晚确认，平台次日核对发起 |
| No-show/最终确认履约违约 | 不退 | 不退，补偿餐厅 | 具体认定、申诉、复核与结算见第 12 节 |
| 特殊情况申诉获批方案 1 | 不退 | 全退 | 运营决定并留依据 |
| 特殊情况申诉获批方案 2 | 全退 | 全退 | 运营决定并留依据 |
| 特殊情况申诉未获批 | 恢复本人原适用普通规则 | 恢复本人原适用普通规则 | 不因审核耗时重新计算取消发生时间 |

### M17 13.2 审核结果（基线L746—L750）

E26：仅D或F+D例外，拒绝复原原取消时刻；不得任意百分比。

| 结果 | 处理 | 来源 |
| :--- | :--- | :--- |
| 获批，运营选方案 1 | F 不退，D 全退 | Q32 |
| 获批，运营选方案 2 | F+D 全退 | Q32 |
| 未获批 | 回到该用户原本适用的普通取消规则；不是统一改判为特殊退款 | Q34 |

### M18 15.1 客服能力分阶段（基线L802—L807）

E29/E30：客服实际能力未知，一般24h不能冲掉48h，注销未实现。

| 项目 | 首发决定 | 后续目标/待定 |
| :--- | :--- | :--- |
| 渠道 | 仅微信小程序内在线客服 | 后续扩为小程序客服 + 电话 + 企业微信 |
| 服务时间 | 每日 10:00—22:00，Asia/Shanghai | 暂无变更时间表 |
| 首次人工响应 | 暂不承诺固定时长 | 有稳定能力后可再定 |
| 渠道实际可用性 | 本轮确定的是业务安排 | 上线前需配置并验收，不能声明本次已验证 |

### M19 15.2 退款时间表（基线L817—L826）

E29/E30：客服实际能力未知，一般24h不能冲掉48h，注销未实现。

| 场景/节点 | 已确定时限或动作 | 未确定内容 |
| :--- | :--- | :--- |
| 用户提交退款申请 | 24h 内完成审核 | 缺材料、复杂争议是否例外及怎样告知 |
| 审核通过 | 审核通过后的次日统一批量发起 | 每天具体批次几点、失败补批 |
| 正常履约退保证金 | 餐厅当晚确认；饭局结束次日核对发起 | 午餐、跨午夜、“当晚”具体截止 |
| 餐厅漏确认 | 不自动退；进入运营异常待办 | 最长处理时间、失联兜底 |
| 履约异常首次说明 | 用户收到异常通知后 48h | 送达、补证、审核完成时限 |
| 最终复核申请 | 用户收到首次结果后 48h | 平台多久完成复核 |
| 系统成团失败/候补到期自动退款 | 全退义务已明确 | 是否需要人工批准、如何衔接次日批量 |
| 支付渠道到账 | 原路退；以渠道实际结果为准 | 不设置未经确认的“必定 X 天到账” |

### M20 16.1 后续决定覆盖表（基线L861—L881）

E03—E30：撤旧承诺保留历史权利和资金测试，不删断言追求全绿。

| 旧说法/旧选择 | 最终处理 | 覆盖来源 | 下游不得误做 |
| :--- | :--- | :--- | :--- |
| 仅收活动服务费 | 改为 F+D；餐费 M 仍直接付餐厅 | Q02、Q15 | 不能继续将支付总额全部当服务费 |
| 开始前取消一律全退服务费的草案建议 | 采用未成团时间阶梯、普通成团后不退、晚报名例外 | Q03—Q04、Q26—Q28、Q71 | 不能把旧草案建议当已选政策 |
| 保证金一律不能成为平台收入 | 普通成团后 Δ>24h 主动取消的 D 业务去向为平台；其他按情形 | Q27—Q28 | 不作全局餐厅归属或全局平台归属 |
| 用户选择自己可接受的单桌人数 | 取消个人选择；按餐厅逐场参数报名 | Q51、Q54 | 不新增或继续必填 acceptableTableSizes 类用户选项 |
| 用户单桌人数不满足时需最后一次确认 | 该个人偏好流程取消 | Q51 覆盖 Q20—Q24 相关分支 | 不保留 T-24h 后继续等用户个人单桌人数回复的循环 |
| T-24h 才展示详细地址 | 正式成团即展示；失效后隐藏地址、保留名称 | Q25、Q67 | 不因旧实现继续延迟披露 |
| 成团永久不可逆 | T-24h 前可失效并重新成团；后期另有餐厅确认例外 | Q65—Q67、Q72 | 不忽略成员退出的影响 |
| 必須达到目标人数才成团 | 达餐厅最低即自动成团；目标只是软目标 | Q63、Q69 | 不把 target 当 min |
| 平台统一固定 6 人桌、默认各桌均允许 4—8 人 | 正常 4—8 是配置边界；具体 min/target/max、桌数、分配由餐厅确认 | Q52—Q56 | 不让运营随意改餐厅承诺 |
| 用户同桌性别期待可选 | 删除此功能；只保留内部均衡软目标 | Q39 后的明确撤回、Q40 | 不新增 genderPreference 类功能 |
| 完整画像/偏好问卷 | 仅保留必需身份/手机号/性别及选填时间偏好；其他本轮明确不采集 | Q41—Q50、Q89—Q90 | 不因历史 Schema 已有就继续强制填写 |
| 候补退出按普通 24h/8h 档位 | 尚在候补即两项全退 | Q62 覆盖 Q61 | 不对候补用户扣服务费 |
| T-24h 后彻底停止全部报名 | 已成团桌可直接补招到 T-8h；候补仍在 T-24h 结束 | Q70 | 不把候补和直接晚报名混为一谈 |
| 加入已成团桌的所有用户一律不退 | 晚报名窗口新用户适用时间阶梯例外 | Q71 | 不能只凭当前 GROUPED 状态扣两项 |
| 餐厅异常直接扣 D | 餐厅只报告，平台审核；初次申诉和最终复核 | Q10、Q79—Q88 | 不做商家一键没收 |
| 首次认定违约立即把 D 付餐厅 | 先经过最终复核申请期；若申请则待最终结果 | Q87—Q88 | 不提前结算争议款 |
| 正常履约后立即逐笔退款 | 活动结束次日统一核对发起 D 退款 | Q76 | 不把“正常确认”当渠道已退 |
| 退款获批后立即发起 | 审核获批次日批量发起 | Q99 | 不承诺即时到账 |
| 首发具备电话和企业微信客服 | 首发只有小程序客服；D 是未来目标 | Q95 | 不发布未配置联系渠道 |

### M21 18. 最低业务记录与责任证据（基线L946—L961）

所有E：单同意和资金事实有基础；餐厅、成团历史、候补、履约、送达、材料、结算、注销证据缺失。

| 记录对象 | 至少要能还原的信息 | 关联规则 |
| :--- | :--- | :--- |
| 活动与餐厅确认 | 餐厅/活动关联、时间、min/target/max、最大桌数、多桌分配原则、费用/额外收费、确认人、确认版本 | VEN-01—VEN-06 |
| 用户报名 | 微信身份归属、手机号授权/性别必填是否满足、成年资格处理、是否候补/正式、适用政策 | USR-01—USR-05、WL-01 |
| 收费 | F、D、已付渠道事实、支付状态、餐费不代收说明、适用金额版本 | FEE-01—FEE-04 |
| 候补 | 有效排队时间依据、顺序、退出/到期/转正事实、自动转正告知和退款义务 | WL-01—WL-10 |
| 成团历史 | 桌成员、最低人数、首次成团、失效、再次成团、餐厅后期例外确认 | FORM-01—FORM-16 |
| 晚报名资格 | 该用户何时、以何种状态加入哪桌，采用哪套取消政策 | FORM-10—FORM-11、REF-03 |
| 取消/退款 | 谁、何时、何因提出；Δ；F/D判定；接收与审批时间；退款/补偿义务；原渠道结果 | 第10、15节 |
| 更换/核心变更 | 原条件、新条件、餐厅责任、期限、用户明确选择或未回复、退款及补偿 | CHG-01—CHG-07 |
| 签到与履约 | 本人本场扫码事实、餐厅确认结果与时间、漏确认/异常 | FUL-01—FUL-09 |
| 争议 | 异常原因与材料、用户通知/送达、说明、首次结果、复核窗口、不同审核人、最终结果 | DISP-01—DISP-15 |
| 特殊申诉 | 原取消事实、必要证明、批准方案或拒绝依据、运营身份 | EXC-01—EXC-04 |
| 餐厅补偿 | 对应用户/活动/原保证金、金额与原因、复核结束依据、应结与实结、失败/翻案记录 | FEE、DISP、OP-14 |
| 政策证据 | 用户当时可阅读的正文、版本、内容摘要、确认时间、来源；历史版本不被覆盖 | S1第48—54行 |
| 注销与隐私 | 申请、核验、未结事项、最终处理、保留/删除/脱敏范围 | PRI-01—PRI-04 |

### M22 19. 五份下游文件的同步要求（基线L968—L974）

E03：五派生文件仍草案，正式签收/政策版本/G0—G4新范围未通过。

| 文件 | 必须依据本基线更新的内容 | 不应夹带的内容 |
| :--- | :--- | :--- |
| USER_AGREEMENT.md | 实际运营主体、18+、上海首发、F+D与餐费边界、自动成团/可逆、候补、晚报名、核心变更和争议救济 | 不把未定 F 金额、未审扣费条款、未来客服渠道当已生效事实 |
| PRIVACY_NOTICE.md | 性别必填、时间偏好选填、删除的画像项、签到/餐厅履约、必要特殊证明、两轮申诉、注销处理中 | 不照搬已停用画像；不承诺未建设的一键导出/即时删除；不公开原始材料 |
| RESTAURANT_SERVICE_STANDARD.md | 逐场人数/最大桌数/分配原则、费用确认、扫码、当晚履约、漏确认待办、异常举证、后期低人数决定、补偿责任 | 不给予商家直接扣保证金权；不以平台默认参数替代真实签收 |
| REFUND_POLICY.md | F与D分项、普通未成团、普通成团后、晚报名、候补全退、平台/餐厅取消、特殊申诉、争议暂缓、24h审核/次日发起、原路原则 | 不再只写开始前全退或成团后全不退；不混淆餐费、补偿和应退资金 |
| POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md | 本基线规则ID→实际代码/接口→测试→餐厅/客服/资金证据→负责人→Gate；同步 OP/RV 条件 | 不把业务确认当成实现完成；不直接沿用旧32项测试当作覆盖全部新增范围 |

### 非表格记录/图/签收要求

- 6.3/6.4、7.6、12.7/12.8：地址即时解锁与T-24终局分开；成团历史和两轮争议链用独立事实，不宣称支付机构提供冻结/托管。
- 15.4/15.5：实际共享、材料、留存、通知字段及终态访问待OP-10/13/15；SENT/已读不自动等于获批送达。
- 第18节最低证据：主体、受理/生效时间、原新条件、正文版本、决定依据、通知/收到、原支付/分项、义务和结算事实同链可追溯。
- 第19—23节：Q20—24个人桌型和Q61候补普通取消已被覆盖；100问不等于整版签收，历史同意/实收不可重写。

## 6. 64基线场景及12补充场景

全部76项NOT_RUN，6个上游BLOCKED_POLICY另保留。旧测试复用基础映射：01—08→E02/E04/E05/E09；09—12→E06—E08；13—21→E10/E12/E17；22—28→E11/E13/E15/E16；29—36→E14/E18/E19；37—45→E21—E25；46—48→E26；49—51→E27/E28；52—55→E20/E29；56→E30；57—58→E06/E20；59→E03；60—64→E12/E16/E18/E23。该映射不代表新场景已有完整测试。

| 场景 | 领域 | 输入 | 上游预期 | 依据 | 上游标识 | 本轮执行 |
| --- | --- | --- | --- | --- | --- | --- |
| BR-AT-01 | 准入 | 仅确认成年资格，不填具体年龄 | 保留18+准入；不新增出生日期、年龄段或身份证必填。 | Q35、Q41 | NOT_RUN | NOT_RUN |
| BR-AT-02 | 准入 | 用户浏览后尝试未授权手机号报名 | 允许浏览；报名/付款要求微信登录与手机号授权。 | Q89 | NOT_RUN | NOT_RUN |
| BR-AT-03 | 准入 | 报名未填性别 | 按业务选择不能报名；仅男/女，字段启用还须专项复核。 | Q38、Q90；RV-04 | NOT_RUN | NOT_RUN |
| BR-AT-04 | 准入 | 时间偏好空白或与所选活动时间不同 | 不阻止报名/付款；填写后仅推荐和开局统计使用。 | Q47—Q48 | NOT_RUN | NOT_RUN |
| BR-AT-05 | 准入 | 旧问卷的行业、口味、预算、氛围等未填 | 不能继续因为旧必填规则拒绝报名，不新增这些画像。 | Q41—Q50 | NOT_RUN | NOT_RUN |
| BR-AT-06 | 准入 | 用户寻找同桌性别期待选项 | 首发没有此选项；内部均衡不对外保证比例。 | Q39—Q40 | NOT_RUN | NOT_RUN |
| BR-AT-07 | 排序 | 候补队首不利于性别均衡 | 仍FIFO优先，不跳过有效队首。 | Q40、Q59 | NOT_RUN | NOT_RUN |
| BR-AT-08 | 饮食 | 用户明确需要本场不支持的专门饮食保障 | 在收费前阻止该安排，不先收款后排桌拒绝。 | Q19；OP-10 | NOT_RUN | NOT_RUN |
| BR-AT-09 | 收费 | 用户准备付费 | 分别展示F、D及总计；餐费M不混入平台收款。 | Q02、Q15 | NOT_RUN | NOT_RUN |
| BR-AT-10 | 餐费 | 现场主动点单超过预计人均上限 | 预计区间只作参考，不把它实现成硬上限。 | Q16—Q17 | NOT_RUN | NOT_RUN |
| BR-AT-11 | 餐费 | 餐厅临时增加固定包间费 | 不能单方强加；核心变更需明确同意，不接受者两项全退。 | Q18、Q94 | NOT_RUN | NOT_RUN |
| BR-AT-12 | 桌型 | 餐厅参数不满足正常4≤min≤target≤max≤8 | 不按正常桌型放行；后期特例不得伪装成初始非法参数。 | Q54、Q72 | NOT_RUN | NOT_RUN |
| BR-AT-13 | 成团 | min=4/target=6/max=6，第4位有效成员加入 | 立即自动成团，不需运营确认；名称和地址解锁。 | Q25、Q63 | NOT_RUN | NOT_RUN |
| BR-AT-14 | 成团 | 已4人成团，继续出现第5/6/7位用户 | 第5/6位可合法加入；第7位不能超单桌最大值。 | Q64 | NOT_RUN | NOT_RUN |
| BR-AT-15 | 容量 | 餐厅最大6人、最多2桌，正式席位已12个 | 不能加第3桌或正式超售；可按候补规则受理候补。 | Q55、Q57 | NOT_RUN | NOT_RUN |
| BR-AT-16 | 排桌 | 餐厅指定多桌分配原则 | 按签收原则组织，不由运营自由改分配或人数参数。 | Q53、Q56 | NOT_RUN | NOT_RUN |
| BR-AT-17 | 成团 | T-24h时min4/target6/max6，实际5人 | 照常举行，不因未到目标人数失败。 | Q69 | NOT_RUN | NOT_RUN |
| BR-AT-18 | 多桌 | 同活动一桌成团、另一桌未成团 | 按具体桌/席位判定结果与地址，不让所有订单共享一个粗糙结果。 | Q63、Q25 | NOT_RUN | NOT_RUN |
| BR-AT-19 | 成团失效 | T-24h前4人成团后退1人，min4 | 回到待成团并补人；名称保留，地址隐藏。 | Q65—Q67 | NOT_RUN | NOT_RUN |
| BR-AT-20 | 恢复 | 上一场景补足至4人 | 再次成团并恢复详细地址。 | Q66—Q67 | NOT_RUN | NOT_RUN |
| BR-AT-21 | 最终失败 | 到T-24h仍未补足最低人数 | 剩余有效用户F+D全退，不套他们的主动取消扣费。 | Q66 | NOT_RUN | NOT_RUN |
| BR-AT-22 | 候补 | 正式容量已满，用户付F+D进入候补 | 清楚标示候补，不赋予正式席位或成团事实。 | Q57 | NOT_RUN | NOT_RUN |
| BR-AT-23 | 候补 | T-24h前释放席位且有有效队列 | FIFO自动转正并通知，不需二次同意，不让新用户插队。 | Q59—Q60、Q68 | NOT_RUN | NOT_RUN |
| BR-AT-24 | 候补 | 仍未转正的用户主动退出 | F+D全退，不按时间阶梯扣费。 | Q62 | NOT_RUN | NOT_RUN |
| BR-AT-25 | 候补 | 到T-24h仍未转正 | 自动结束候补，产生两项全退处理，不无限等待。 | Q58、Q62 | NOT_RUN | NOT_RUN |
| BR-AT-26 | 候补 | T-24h后有临时空位 | 不恢复已结束候补；按已成团桌直接报名规则处理。 | Q70 | NOT_RUN | NOT_RUN |
| BR-AT-27 | 晚报名 | T-20h有效已成团桌有空位 | 可直接报名，受最大人数/桌数限制，不新建候补。 | Q70 | NOT_RUN | NOT_RUN |
| BR-AT-28 | 截止 | 到T-8h有人想新报名，或T-5h出现空位 | 不再开放新报名或新候补；截止前待付/晚到支付另需边界方案。 | Q70、Q72；OP-05 | NOT_RUN | NOT_RUN |
| BR-AT-29 | 退款 | 尚未成团、距开始25h主动取消 | F全退、D全退。 | Q03、Q26 | NOT_RUN | NOT_RUN |
| BR-AT-30 | 退款 | 普通用户已经正式成团、距开始25h主动取消 | F不退、D不退；D按业务选择归平台。 | Q26—Q27 | NOT_RUN | NOT_RUN |
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
| BR-AT-57 | 异常实收 | 本地订单关闭后确认收款或额外重复收款 | 保存真实资金事实与处理义务，不删除记录使钱无主。 | S1第108—115行；第10节 | NOT_RUN | NOT_RUN |
| BR-AT-58 | 金额范围 | 平台承诺该订单两项全退 | 退F+D，餐费M不混入；重复处理不得重复退款。 | Q15、Q100 | NOT_RUN | NOT_RUN |
| BR-AT-59 | 历史政策 | 新政策上线或餐厅条件更新 | 保留历史适用版本，不回写旧订单同意或追溯增加扣费。 | S1第48—54行 | NOT_RUN | NOT_RUN |
| BR-AT-60 | 未闭合窗口 | T-15h已成团桌退出后低于min | 处理尚未明确，必须给出获批规则后补验收。 | OP-01 | BLOCKED_POLICY | NOT_RUN |
| BR-AT-61 | 重组退款 | 曾成团、当前重新待成团用户主动退出 | 不能任意选当前状态或历史状态；等待规则闭合。 | OP-02 | BLOCKED_POLICY | NOT_RUN |
| BR-AT-62 | 等号边界 | 普通未成团恰好T-24h或晚报名恰好T-8h取消 | 按对话暂定口径列预期，整体签收前不能冒称边界独立已定。 | OP-05 | BLOCKED_POLICY | NOT_RUN |
| BR-AT-63 | 队列竞争 | 候补退出与自动转正同时发生 | 需批准唯一事件顺序；不得既全退退出又按成团扣留。 | OP-05 | BLOCKED_POLICY | NOT_RUN |
| BR-AT-64 | 申诉时钟 | 仅写入站内消息、用户是否收到未知 | 不可把技术写入直接当已收到并运行扣除倒计时；先明确送达规则。 | Q82、Q86；OP-13 | BLOCKED_POLICY | NOT_RUN |

| 场景 | 输入 | 预期 | WP | 本轮 |
| --- | --- | --- | --- | --- |
| RB-AT-01 | 新客报名金额为F+D，正常履约只退D | 保留F；对应原支付累计退款和在途金额不超实收；不误退整笔 | WP03/WP06/WP07 | NOT_RUN |
| RB-AT-02 | 同一退D任务重复或并发，先退D后又批准F+D | D只退一次，后续仅退未退F；真实渠道及本地金额分别一致 | WP03/WP06 | NOT_RUN |
| RB-AT-03 | 两笔支付收F/D与一笔合并的候选设计比较 | 仅执行最终批准设计；不替用户决定；双分项与原渠道关联可追溯 | WP03；OP-04/RV-06 | NOT_RUN |
| RB-AT-04 | 复核申请与48h期满结算任务同刻 | 按获批生效顺序唯一处理；不能已受理复核却把D转餐厅 | WP03/WP07；OP-05/13/14 | NOT_RUN |
| RB-AT-05 | 餐厅A人员尝试确认B餐厅/他场/无权限用户 | 拒绝越权；正常确认与异常标签不能绕平台变成直接资金命令 | WP07；OP-15 | NOT_RUN |
| RB-AT-06 | 扫码重复、跨场、二维码外传或网络失败 | 按获批最小防护及补录方案处理，不新增GPS/人脸默认采集 | WP07；OP-12 | NOT_RUN |
| RB-AT-07 | 只删旧问卷UI但后端仍要求budgetRange等 | 测试应暴露不一致；兼容历史不恢复新必填，不破坏旧快照 | WP01/WP09 | NOT_RUN |
| RB-AT-08 | 工作区只有旧单一服务费的Gate绿灯 | 新增F/D、候补、自动成团及争议范围保持未验收，不能继承PASS | WP10 | NOT_RUN |
| RB-AT-09 | 三份用户正文hash与订单记录不匹配、草案被启用 | 拒绝生效/确认；保留历史全文；不能只删TBD标识 | WP10 | NOT_RUN |
| RB-AT-10 | 政策缺OP-01/02等明确结果，尝试通过代码默认扣款 | 阻止该未批分支启用；保留真实资金与人工待办，不推定无限冻结合法 | WP05/WP06 | NOT_RUN |
| RB-AT-11 | 上午饭局/跨午夜结束/退款在午夜前获批 | 按OP-11/12获批日历定义及批次测试；不能擅定23:59或再推迟一天 | WP06/WP07 | NOT_RUN |
| RB-AT-12 | 恢复备份后存在先前隐私处置、渠道新增款和D已结算 | 重放有效隐私处置并双向对账，不能为了删除画像抹D义务 | WP03/WP09 | NOT_RUN |

保留服务端金额、登录/越权、回调可靠落盘、独立实收、原绑定、重复/未知退款预算、旧租约结果失效、八次转人工、双向对账与恢复断言。问卷/地址/人工成团旧断言须批准新契约后增补/调整，不能删资金断言。旧QA-P/审计T无法唯一匹配的仍待核验，本轮不伪造旧编号通过证据。

## 7. 导入/差异/出口

导入14份：BUSINESS_RULES_BASELINE.md、CODEX_NEXT_TASK.md、CONSISTENCY_REPORT.md、OPEN_DECISION_REVIEW.md、POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md、POLICY_REBASE_CHANGELOG.md、PRIVACY_NOTICE.md、README.md、REFUND_POLICY.md、RESTAURANT_SERVICE_STANDARD.md、TRACEABILITY_INDEX.json、USER_AGREEMENT.md、sources/REFERENCE_NOTES.md、sources/fanju_policy_cto_checklist_2026-09-30.md。复用/目录内跳过0；外层两文件未导入。

新增四份分析，不改输入政策状态、不启用AgreementPolicy。AGENTS/PRD/PROJECT_CONTEXT有旧问卷/T-24/整体状态约定，后续批准对应包时同步契约，本轮不写这些文件。旧Gate不是新范围通过证据。

唯一首批建议WP10-A见工作包文档，未启动开发；交回后停止等待人工审核。

## 8. 函数/API及迁移精确补充定位

以下从本轮实际读取源码抽取，均为现有入口；不是拟新增API。待新增API/结构只在技术设计标PROPOSED。

| 实际API | 文件/行 | 相关E域 |
| --- | --- | --- |
| POST /api/mock/wechat-login | [app.ts:154](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:154) | E02—E29，按上文职责域对应 |
| POST /api/mock/phone | [app.ts:170](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:170) | E02—E29，按上文职责域对应 |
| GET /api/agreement/current | [app.ts:190](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:190) | E02—E29，按上文职责域对应 |
| POST /api/consents | [app.ts:197](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:197) | E02—E29，按上文职责域对应 |
| GET /api/profile | [app.ts:229](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:229) | E02—E29，按上文职责域对应 |
| PUT /api/profile | [app.ts:237](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:237) | E02—E29，按上文职责域对应 |
| GET /api/activities | [app.ts:283](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:283) | E02—E29，按上文职责域对应 |
| GET /api/activities/:id | [app.ts:293](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:293) | E02—E29，按上文职责域对应 |
| POST /api/ops/restaurants | [app.ts:306](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:306) | E02—E29，按上文职责域对应 |
| PUT /api/ops/restaurants/:id | [app.ts:318](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:318) | E02—E29，按上文职责域对应 |
| GET /api/ops/restaurants | [app.ts:337](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:337) | E02—E29，按上文职责域对应 |
| POST /api/ops/activities | [app.ts:350](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:350) | E02—E29，按上文职责域对应 |
| POST /api/ops/activities/:id/publish | [app.ts:377](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:377) | E02—E29，按上文职责域对应 |
| POST /api/ops/activities/:id/open-registration | [app.ts:401](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:401) | E02—E29，按上文职责域对应 |
| GET /api/ops/activities | [app.ts:421](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:421) | E02—E29，按上文职责域对应 |
| POST /api/ops/activities/:id/start | [app.ts:438](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:438) | E02—E29，按上文职责域对应 |
| POST /api/ops/activities/:id/complete | [app.ts:467](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:467) | E02—E29，按上文职责域对应 |
| GET /api/notifications | [app.ts:605](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:605) | E02—E29，按上文职责域对应 |
| POST /api/notifications/:id/read | [app.ts:632](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:632) | E02—E29，按上文职责域对应 |
| GET /api/ops/activities/:id/table-candidates | [app.ts:788](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:788) | E02—E29，按上文职责域对应 |
| POST /api/ops/activities/:id/table-groups/draft | [app.ts:831](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:831) | E02—E29，按上文职责域对应 |
| POST /api/ops/activities/:id/table-groups/confirm | [app.ts:851](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:851) | E02—E29，按上文职责域对应 |
| PUT /api/ops/activities/:id/table-groups | [app.ts:869](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:869) | E02—E29，按上文职责域对应 |
| POST /api/ops/activities/:id/mark-group-failed | [app.ts:890](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:890) | E02—E29，按上文职责域对应 |
| POST /api/ops/activities/:id/cancel | [app.ts:965](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:965) | E02—E29，按上文职责域对应 |
| POST /api/orders | [app.ts:1007](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1007) | E02—E29，按上文职责域对应 |
| GET /api/orders | [app.ts:1104](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1104) | E02—E29，按上文职责域对应 |
| GET /api/orders/:id | [app.ts:1121](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1121) | E02—E29，按上文职责域对应 |
| POST /api/orders/:id/reports | [app.ts:1184](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1184) | E02—E29，按上文职责域对应 |
| PUT /api/orders/:id/review | [app.ts:1197](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1197) | E02—E29，按上文职责域对应 |
| POST /api/orders/:id/cancel | [app.ts:1225](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1225) | E02—E29，按上文职责域对应 |
| POST /api/mock/payments | [app.ts:1286](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1286) | E02—E29，按上文职责域对应 |
| GET /api/payments/:id | [app.ts:1327](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1327) | E02—E29，按上文职责域对应 |
| POST /api/ops/financial-cases/:id/resolve | [app.ts:1406](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1406) | E02—E29，按上文职责域对应 |
| POST /api/ops/refunds/:id/approve | [app.ts:1469](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1469) | E02—E29，按上文职责域对应 |
| POST /api/ops/refunds/:id/reject | [app.ts:1530](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1530) | E02—E29，按上文职责域对应 |
| POST /api/wechat/pay/notify | [app.ts:1645](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1645) | E02—E29，按上文职责域对应 |
| POST /api/wechat/refund/notify | [app.ts:1667](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/app.ts:1667) | E02—E29，按上文职责域对应 |

| 实际函数 | 文件/行 |
| --- | --- |
| agreementHash | [services/api/src/orders/agreement.ts:4](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/agreement.ts:4) |
| currentAgreement | [services/api/src/orders/agreement.ts:8](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/agreement.ts:8) |
| hasUnsettledFunding | [services/api/src/orders/inventory.ts:11](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.ts:11) |
| releaseTerminalOrder | [services/api/src/orders/inventory.ts:35](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.ts:35) |
| markOrderState | [services/api/src/orders/inventory.ts:46](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.ts:46) |
| scheduleExpiration | [services/api/src/orders/inventory.ts:55](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.ts:55) |
| expireOrder | [services/api/src/orders/inventory.ts:59](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/inventory.ts:59) |
| currentCandidates | [services/api/src/orders/formation.ts:12](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:12) |
| candidateDigest | [services/api/src/orders/formation.ts:42](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:42) |
| draftFormation | [services/api/src/orders/formation.ts:92](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:92) |
| adjustFormation | [services/api/src/orders/formation.ts:120](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:120) |
| confirmFormation | [services/api/src/orders/formation.ts:134](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:134) |
| deliverInbox | [services/api/src/orders/formation.ts:171](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:171) |
| queueDecisionNotifications | [services/api/src/orders/formation.ts:178](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:178) |
| createDecisionRefundDuties | [services/api/src/orders/formation.ts:193](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/orders/formation.ts:193) |
| bindingFor | [services/api/src/funding/intents.ts:8](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/intents.ts:8) |
| ensurePaymentIntent | [services/api/src/funding/intents.ts:14](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/intents.ts:14) |
| lockOrder | [services/api/src/funding/receipts.ts:14](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.ts:14) |
| recordPayment | [services/api/src/funding/receipts.ts:23](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.ts:23) |
| applyPaymentEvidence | [services/api/src/funding/receipts.ts:83](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/receipts.ts:83) |
| reserveRefund | [services/api/src/funding/refunds.ts:7](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:7) |
| prepareObligation | [services/api/src/funding/refunds.ts:43](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:43) |
| recordRefund | [services/api/src/funding/refunds.ts:64](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:64) |
| confirmRefund | [services/api/src/funding/refunds.ts:104](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:104) |
| recordRefundFailure | [services/api/src/funding/refunds.ts:108](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/funding/refunds.ts:108) |
| persistTrustedEvent | [services/api/src/events/inbox.ts:24](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/events/inbox.ts:24) |
| applyEvent | [services/api/src/events/inbox.ts:47](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/events/inbox.ts:47) |
| enqueue | [services/api/src/jobs/queue.ts:9](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/jobs/queue.ts:9) |
| openCase | [services/api/src/jobs/queue.ts:19](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/jobs/queue.ts:19) |
| claimJob | [services/api/src/jobs/queue.ts:28](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/jobs/queue.ts:28) |
| finishJob | [services/api/src/jobs/queue.ts:45](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/jobs/queue.ts:45) |
| retryJob | [services/api/src/jobs/queue.ts:55](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/jobs/queue.ts:55) |
| runOne | [services/api/src/jobs/queue.ts:75](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/jobs/queue.ts:75) |
| importStatement | [services/api/src/reconciliation/service.ts:15](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/reconciliation/service.ts:15) |
| reconcileKnown | [services/api/src/reconciliation/service.ts:50](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/reconciliation/service.ts:50) |
| resolveVerifiedCase | [services/api/src/reconciliation/cases.ts:4](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/services/api/src/reconciliation/cases.ts:4) |
| evaluateRefundDecision | [packages/shared/src/rules/refund.ts:38](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/refund.ts:38) |
| calculateOrderAmountCents | [packages/shared/src/rules/pricing.ts:5](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/pricing.ts:5) |
| getActivityInfoVisibility | [packages/shared/src/rules/addressUnlock.ts:21](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/addressUnlock.ts:21) |

实际迁移证据：

- [prisma/migrations/20260929020000_inventory_expand/migration.sql](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/migrations/20260929020000_inventory_expand/migration.sql:1)：库存持久有效状态/部分唯一与旧约束切换，或完整单正文同意扩展。本轮只读，不迁移。
- [prisma/migrations/20260929021000_inventory_cutover/migration.sql](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/migrations/20260929021000_inventory_cutover/migration.sql:1)：库存持久有效状态/部分唯一与旧约束切换，或完整单正文同意扩展。本轮只读，不迁移。
- [prisma/migrations/20260929040000_profile_consent_expand/migration.sql](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/prisma/migrations/20260929040000_profile_consent_expand/migration.sql:1)：库存持久有效状态/部分唯一与旧约束切换，或完整单正文同意扩展。本轮只读，不迁移。
