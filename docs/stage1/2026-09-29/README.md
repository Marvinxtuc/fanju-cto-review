# 阶段 1：S1a 最小隔离与 S3 构建实施记录

日期：2026-09-29。用户“继续”授权承接阶段 0 推荐的 S1a/S3。本次仅本地实施，未提交、推送、部署、修改资金模型或调用真实微信。

## 结论与边界

S1a 代码与隔离验证完成；S3 的脚本、真实构建和本地发布包验证完成。S3 尚缺微信开发者工具导入及平台验证；GitHub Actions 仅新增工作流，未推送触发云端运行。G0 不标通过，S1b 会话认证、S2 完整配置矩阵等仍未实施。原 F01/F03 只完成最小隔离，不能因此关闭全部权限/配置审计问题。

基线 `bc25f5b4859623338829ec09278c72619392141c`，工作分支 `codex/fanju-stage0-baseline`。变更尚未形成新提交，源码摘要见 evidence/source-manifest.json。阶段 0 文档保持原状，不能用本次结果覆盖其原始失败记录。

## 修改内容与追踪

| 包 / 关联 | 文件 | 实际行为与断言 |
| --- | --- | --- |
| S1a / F01、F03、R08 | API config.ts、app.ts、auth.ts、security.test.ts | 演示开关默认 false；本地显式全 mock 才注册管理员、支付成功、退款成功/失败四类路由；生产/测试非演示环境这些路由 404；恶意 role 不触发 upsert |
| S1a / 权限隔离 | auth.ts | 尚无可信管理员认证，非演示环境 OPS/SUPER_ADMIN 即使签名有效也返回 403；读、写及超级管理员删除路径均有断言 |
| S1a / 路由兼容 | security.test.ts、app.test.ts、probe-state-machine.ts | 保留真实 provider 共用的身份、手机号、支付创建路径与真实通知路由；既有测试显式启用隔离演示，无断言删除 |
| S3 / B01、F27、R01 | 根 package.json | 测试、provider 单测、数据库测试、HTTP 探针及 typecheck 均先生成 Prisma、构建 shared |
| S3 / 真实产物 | 前端 package.json、miniapp config、ops api.ts | 两端显式生产打包；类型检查独立；小程序缺 API 地址拒绝打包；运营生产默认同源，不再静默固化 localhost |
| S3 / CI | .github/workflows/ci.yml、scripts/test-ci.mjs | Node 22.23.1 / pnpm 9.15.9；专用 PG16.14 空库迁移；强制 DB 27 条基线及零 skipped/todo；保存测试 JSON |
| S3 / 发布闭包 | API/shared package.json、scripts/verify-release.mjs | package files 限定 dist；直接 node dist/server.js 启动，真实 HTTP 验证 health、activities、默认 demo 404；核验页面入口和 5 页微信产物并记录 SHA256 |
| 开发说明 | .env.example、README、.gitignore | 新开关、构建地址、启动范围；忽略 .swc 与自动证据目录，保留 docs 下经整理证据 |

主责：本轮 Codex；独立代码复核：codex-review（见后文）；人工验收负责人待用户指定，未虚构签收。无 schema、持久化格式、依赖版本或生产依赖新增。

## 验证环境与结果

在 `/tmp/fanju-stage1-20260929/clean` 从当前 tracked/untracked 源文件建立新副本，排除 node_modules、dist、generated、.env 和缓存；独立 frozen-lockfile 安装。使用进程白名单环境，没有加载真实 Secret。临时数据库容器 `fanju-stage1-20260929`，PG16.14，tmpfs，loopback 动态端口 32769。未访问默认 5432 的既有 SSH 通道。

| 检查 | 结果 |
| --- | --- |
| frozen-lockfile install | 通过；没有升级或修改 lockfile |
| 现有 4 个迁移在空库 deploy | 通过；没有新增迁移 |
| 干净副本 `pnpm test:ci`（先于任何全量 build） | 70 passed，0 failed，0 skipped；shared18、API46（含 DB27/provider13/crypto3/security3）、ops1、miniapp5 |
| 无 shared/dist 再运行 `RUN_DB_TESTS=1 pnpm test` | 70 条通过；确认常规测试入口也不依赖旧产物 |
| `pnpm typecheck` | 四包通过 |
| `pnpm build` | Vite 3 个文件、weapp 29 个文件/5 页、API/shared 编译产物；ops 生产模式修复后单独重建通过 |
| `pnpm probe:api:state-machine` | HTTP 探针通过，保留原 7 类检查 |
| `pnpm check:copy`、`pnpm check:secrets` | 通过；限于现有扫描规则，不代表全历史审计 |
| `pnpm deploy --prod` + `pnpm verify:release` | 通过；API 包没有 src、根依赖无 tsx/typescript，直接 Node 启动，连接专用 DB；health/activities 200，admin-login 404 |
| 浏览器加载生产 ops 包 | 同源代理到专用本地演示 API；页面正常显示运营概览，初始 8 项读取与刷新 8 项读取均 200；请求证据不保存 token |
| weapp 缺构建 API 地址 | 负向验证通过：构建失败并明确要求 TARO_APP_API_BASE_URL |
| 微信 IDE 导入/真机、真实微信、生产 worker | 未执行；IDE 缺批准 AppID/project 配置沿用阶段 0 阻塞，worker 未实现 |

本轮构建的小程序使用 `https://api.example.invalid` 占位地址，不可用于实际联网验收。API NODE_ENV=production 冒烟仅在隔离库使用兼容 mock allowance，演示路由保持关闭；它不是实际生产配置建议。浏览器测试另外使用显式本地演示模式，仅验证产物加载、鉴权兼容和读取/刷新，不等同于运营全流程验收。

### 失败与纠正记录

1. 复核确认 CI 的 NODE_ENV=test 会让 Vite 把 DEV 视为 true，原本仍将 localhost 固化到产物；已将 ops 构建设为 NODE_ENV=production，并加入发布产物本地地址断言，重建及 Node/HTTP 验证通过。
2. 首版产物检查误要求每页存在 wxss；当前样式集中在 app.wxss，已改为检查全局样式与每页 js/json/wxml。随后发现脚本替换误改 readFile 参数，已修正并实际重跑发布检查通过。失败退出码保留在 command-results.jsonl。
3. pnpm deploy 仍输出 @prisma/client 可选工具链关联的 tsc/tsserver bin 警告和 prisma studio 的 @types/react peer 警告。核实发布包根无 typescript、tsx、prisma，API 所需 @prisma/client 与 shared 存在，纯 Node 冒烟通过。尚未证明所有生产依赖路径与 Linux 发布组合可用；这些警告保留在 packaging-warnings.txt，不为消除警告新增生产编译器或升级框架。

## 复核

使用 `/Users/marvin.x/.codex/skills/codex-review/scripts/codex-review --mode local`。首轮退出 0，无剩余可执行问题；该轮实际读取了生产 Vite 修复、app.wxss 检查和 localhost 产物断言。独立复核提出的 Vite 环境问题已采纳并验证；没有需要拒绝的有效问题。完整日志保留 `/tmp/fanju-stage1-20260929/review.log`。误启动的第二轮在确认首轮已覆盖最终代码后取消，不当作额外通过证据。

## 回滚与后续边界

- 配置原件备份：`/tmp/fanju-stage1-20260929/originals/`，包含根/前端 package.json、miniapp config 与 .env.example；跟踪文件原件也可在基线 SHA 定位。回滚前先保存当前差异，仅还原本包对应 hunks；新增文件逐个确认移除，不能用 reset --hard 或全目录 clean。
- 原主工作目录未修改。本轮只读原报告并保留已有 docs/stage0 工作，不写长期记忆。
- 安全回退不得恢复公网演示赋权。若后续部署发生故障，应关闭运营入口或切安全版本；当前不提供已验证的生产回退 SHA。
- 下一包先冻结 S1b 管理员身份源、会话期限/撤销、密钥及角色核验设计；S2 资金开关须保留存量回调/退款；阶段 2 资金 schema/任务机制仍需设计评审后授权。
- CI 实际运行、微信导入、真实身份、资金恢复、对账及所有 G0–G4 条件继续按阶段 0 台账收证。人工发布/收费批准仍独立。

## 清理

临时浏览器页、静态代理与 API 子进程均已结束；专用 PostgreSQL 容器已停止并自动移除。源码副本、发布包、配置备份和脱敏证据保留在 `/tmp/fanju-stage1-20260929/`，仓库内保留精简验收证据。
