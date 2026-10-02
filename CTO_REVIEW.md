# 饭局 CTO 审核入口

这是已运行候选的源码审核快照，非生产上线完成声明。开始请读本页，再逐项完成 [CTO具体审核清单](CTO_CHECKLIST.md)。

## 审核路径

1. [入口与数据模型矩阵](cto-review/ROUTE_MODE_MATRIX.json)：controlled为V1.1正式业务handler+隔离合成传输；legacy为旧Order历史，prelaunch为本地模拟。
2. [外部只读验证](cto-review/READ_ONLY_ACCESS_REPORT.md)：网关/API执行只读，临时凭据通过独立安全渠道提供，不在GitHub保存。
3. 页面：[受控身份入口](apps/ops/src/ControlledIdentityWorkspace.tsx)、[正式业务工作区](apps/ops/src/FormalBusinessWorkspace.tsx)、[用户订单主流程](apps/miniapp/src/FormalOrderDetail.tsx)。
4. API：[正式路由](services/api/src/prelaunch/formal-business-routes.ts)、[取消与退款](services/api/src/prelaunch/formal-refund-service.ts)。OP04必须先保存取消前权益，取消接受后立即退出成员/释放席位，退款独立。
5. [实际云端部署与验证](cto-review/TENCENT_LINUX_EXECUTION.md)、[运行身份](cto-review/TENCENT_CONFIRMED_TARGET.json)、[剩余缺项](cto-review/CURRENT_MINIMUM_INPUTS.md)。

## 快照身份与验证边界

源基线adb548472ddbd371f2c5abcfc36fe1ddfa853ae2，加冻结未提交差分；566文件候选78a17d3ec54f3dd2e8b45480aa5ad3a9a9e4f955e9521e54a345ac1979d2e598。文件摘要见SOURCE_SNAPSHOT.json。云端后续仅两项Linux测试路径兼容补丁，业务编译源保持该快照。本仓库初始快照不冒充原Git历史。

GitHub用于源码评论；它不运行Fastify/PostgreSQL或代替外部页面。公开浏览器地址是临时只读入口，登录口令/token不得进入issue或PR评论。云端706项CI、实际构建、合成备份恢复和整机重启已验证；真实平台、资金、旧生产恢复、真机及发布未完成。

本地准备：pnpm install --frozen-lockfile；运行方式与DB门禁参见原README.md及AGENTS.md。只使用隔离数据；未注入真实凭据时不要开启生产provider。

公开资料中的review-entry.invalid是脱敏占位，不能访问。实际受控页面和临时登录方式由负责人通过安全渠道提供；GitHub审核不会自动获得业务系统访问权限。
