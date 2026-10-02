# CTO 审核清单

请从 [审核入口](CTO_REVIEW.md) 开始。请分别给出「代码结论」「运行验证结论」「上线条件」，不要用测试通过替代真实渠道验收。当前没有生产通过声明。

## 需要逐项审查的内容

| # | 具体检查点 | 主要代码入口 | 应取得的结论或证据 |
|---|---|---|---|
| 1 | 当前页面是否进入controlled；legacy旧Order与prelaunch模拟是否混入V1.1验收 | apps/ops/src/ControlledIdentityWorkspace.tsx；FormalBusinessWorkspace.tsx；cto-review/ROUTE_MODE_MATRIX.json | 页面、登录、业务API、数据模型对应明确；旧后台可读不作为V1.1通过 |
| 2 | 普通主动取消先保存取消前权益，再退出正式成员、释放席位并重算成团；退款独立 | services/api/src/prelaunch/refund-request-intake.ts；formal-refund-service.ts；tests/prelaunch/op04-cancel-accepted-native.test.mjs | 本人退出导致桌失效时仍按取消前权益核定；并发重试不重复退出/退款 |
| 3 | 咨询、补证、争议、复审不自动取消；类别幂等key隔离且关联本人原请求 | services/api/src/prelaunch/formal-business-routes.ts；formal-rights-routes.ts；tests/prelaunch/formal-aftersales-linkage-native.test.mjs | 每类请求的成员、资金和权益状态变化符合已确认规则 |
| 4 | 支付金额服务端计算，回调/查询幂等；失败不fallback mock；关闭、过期、重报竞争不越权授资格 | formal-registration.ts；formal-qualification.ts；formal-payment-close.ts；formal-rejoin-safety.ts | 非法状态拒绝、竞态结果确定；正式F/D缺输入时拒绝启动或执行 |
| 5 | 退款额度、原渠道、查询恢复、重试和批次不会重复付款或覆盖历史事实 | formal-refund-service.ts；formal-refund-followup.ts；services/api/src/funding/original-recovery.ts及authority/target模块 | 旧单作用域与签名授权必须真实绑定；隔离恢复证明与旧生产恢复分别报告 |
| 6 | NORMAL履约与责任取消/核心变更拒绝相交时，是否保留原F留存/D退款事实并进入专业待核 | formal-fulfillment-service.ts；formal-responsibility-cancellation.ts；formal-core-change-service.ts | 不自动建立冲突F+D义务，不使用通用测试签收替代专业选择 |
| 7 | 签到二维码签名、场次/餐厅/授权绑定、过期/重放与伪造拒绝；现场扫码未验证 | formal-checkin-signing.ts；formal-checkin-professional.ts；formal-checkin-service.ts；apps/ops/src/formal-checkin-qr.ts | 本地编码/解码与真机现场验收分开；无生产凭据进源码 |
| 8 | 本人数据边界、OPS角色授权、资料/注销请求权限；资金事实不被注销删除 | formal-rights-routes.ts；apps/miniapp/src/FormalRights.tsx；apps/ops/src/FormalRightsInbox.tsx | 不能读他人订单/问卷/手机号；受理不冒充实体更正或注销完成 |
| 9 | 外部只读认证由网关/API执行；GET白名单、session-bound Bearer、同源Cookie、过期撤销 | cto-review/READ_ONLY_ACCESS_REPORT.md；实际审查入口由负责人安全渠道提供 | 用一次性克隆做写拒绝/过期/权限负测；共享入口不进行业务写入；实际请求不发访客localhost |
| 10 | 干净安装、Linux构建、迁移、worker模式与ready的覆盖边界 | package.json；services/api/src/worker.ts；cto-review/TENCENT_LINUX_EXECUTION.md | 区分本地1087与云端706；required modes完整；备份恢复和自动启动有实际证据 |
| 11 | 小程序主流程与OP04在拟发布handler上完成；编译、模拟器、真机和真实渠道分别列证据 | apps/miniapp/src/api.ts；FormalOrderDetail.tsx；tests/ui/formal-main-http-dom.test.tsx | 不关闭正式合法域名校验作为通过；缺真机/渠道证据明确未完成 |
| 12 | 产品定位、正式业务参数、专业签收及发布条件 | PRD.md；AGENTS.md；cto-review/CURRENT_MINIMUM_INPUTS.md | 上海餐厅兴趣体验定位；不添加交友功能；价格、资金范围、发布受众和运维值守需实际批准 |

## 如何提交审核结果

代码问题请在PR对应行评论，并写明：严重程度（P0阻止发布/P1上线前修复/P2后续改进）、文件/行、触发条件、实际与预期、修复建议及必要验证。不得在公开评论中贴token、密码、个人资料、支付流水或原始HAR。

审核结论请覆盖：1. 可接受的源码候选；2. 必须修复的问题；3. 已实际验证的路径；4. 未执行的平台/资金/真机/恢复项；5. 发布前仍需输入。没有实际证据的项请写未验证，不勾选通过。

建议从2、4、5、6、8、9开始，它们直接影响成员、资金或数据权限。专业业务决定由有权负责人签收，CTO代码审查不替代其签收。
