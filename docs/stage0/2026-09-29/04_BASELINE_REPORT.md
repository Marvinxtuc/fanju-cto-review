# 04 基线测试与真实构建报告

日期：2026-09-29。输入源码 SHA `bc25f5b4859623338829ec09278c72619392141c`；执行分支 `codex/fanju-stage0-baseline`。运行时源码和锁文件未修改。本次新增的是阶段 0 文档；构建产物/缓存未提交。

## 环境与隔离

- Node v22.23.1、pnpm 9.15.9；macOS arm64；Docker 29.2.1。
- PostgreSQL 16.14，镜像 postgres:16-alpine（本地已有），独立容器 `fanju-stage0-20260929`，tmpfs 数据，仅 `127.0.0.1:32768` 绑定。
- 专用新空库 fanju_stage0 / stage0；无业务库凭证，测试认证仅本机可丢弃环境。原 5432 是 SSH 监听，未连接、未修改。
- 子进程仅保留 PATH/HOME/TMPDIR/LANG，加显式专用 DATABASE_URL、mock provider、关闭真实支付开关；未加载用户 shell 中其他凭证或仓库外 secret。
- 既有四项迁移仅应用于该空库；没有执行新 Schema 设计。只使用现有锁文件安装，没有新增项目依赖。
- 真实身份/资金 provider 测试使用现有注入的 fake HTTP 客户端与测试签名材料，不执行真实微信请求。

## 实测结果

| 项目 | 结果 | 精确含义 |
| --- | --- | --- |
| frozen-lockfile 安装 | passed | 1275 包；项目锁文件不变 |
| Prisma validate/generate | passed | schema 校验与本地生成物成功 |
| migrate deploy 到空测试库 | passed | 四项既有迁移全部执行 |
| 干净副本 RUN_DB_TESTS=1 pnpm test | **failed** | shared/dist 尚未生成；API app.test.ts 收集失败，27 个 DB 用例未执行；其余 40 项通过 |
| 现有 pnpm build | passed | shared/API 编译；两前端步骤仅 typecheck，不能充作发布包证据 |
| pnpm typecheck | passed | 各 workspace 类型检查通过 |
| 构建后 RUN_DB_TESTS=1 pnpm test | passed | 共 67 项：miniapp 5、ops 1、shared 18、API 43（其中 app.test.ts 27 项真实 DB）；无跳过 |
| HTTP 状态机探针 | passed | 随机 loopback 端口，七类既有黑盒保护场景 |
| pnpm check:copy | passed | 仅当前脚本覆盖的禁用词规则，不代表文案承诺全部正确 |
| pnpm check:secrets | passed | 仅当前脚本扫描范围，不等于全 Git 历史/所有密钥类型审计 |
| Vite 实际打包 | passed | 33 modules，生成 index.html/JS/CSS；独立命令，不是现有 build |
| Taro weapp 实际生产编译 | passed | 生成 29 个文件、5 页面及 app 配置；没有旧 dist |
| ops 静态产物浏览器渲染 | passed / 限定范围 | 可见运营台、模块按钮；CSP connect-src none 阻断自动请求 localhost:3000，显示 Failed to fetch；未接通真实运营流程 |
| weapp 开发者工具导入 | blocked | 首次工具连接超时，重试后到达隔离目录导入表单；产物没有 project.config.json/AppID，需确认隔离测试 AppID 配置，已取消导入；未复用原项目真实配置、未开通云服务 |
| API node 启动（工作副本 dist） | observed | 监听成功；运行器 12 秒到时主动终止（exit 124），不是进程崩溃，也不算完整产物验收 |
| pnpm deploy --prod 临时独立目录 | passed with warnings | 有 peer dependency/tsc-bin 警告；不因此宣称生产依赖闭包全合格 |
| API 独立目录、源码移开后 node 启动 | passed | API/src 与 shared/src 均不在运行包；/health 200，/api/activities 200 且空列表，实际 DB 读取成功；随后主动停进程 |
| F01 专用库隔离复现 | **vulnerability reproduced** | 无身份凭证 POST admin-login，自报 SUPER_ADMIN，返回 200/该角色/token；证据仅记录布尔结果，不保存 token |
| worker 产物/恢复 | not_run | 基线没有实现 worker |
| T01–T28 / AT01–AT10 新整改测试 | not_run / partial evidence | 未编写完整新测试；AT01 有打包/部分产物证据，导入/worker 不通过，不能整体标 passed |
| 真实微信、生产迁移、备份恢复、上传、收费 | not_run | 不在本轮授权范围 |
| 独立安全复核、全历史 Secret、依赖漏洞审计 | not_run | 当前扫描通过不替代这些门禁 |

现有测试重复运行是为了验证首次收集失败的原因，首次失败记录保留。后续需 S3 把 shared 构建写入正式测试依赖，不能要求操作者依赖隐藏顺序。

## 产物与证据

- [命令退出码、耗时和运行记录](evidence/command-results.json)。
- [测试计数、失败原因、迁移和构建摘录](evidence/output-excerpts.txt)。原始请求日志留在仓库外临时目录，没有复制 token/真实用户数据。
- [逐文件产物摘要与锁文件摘要](evidence/artifact-manifest.json)。这些是基线产物，不是已签收发布候选。
- ops 浏览器观察：本地静态服务，页面“饭局运营台”，餐厅/活动/订单退款/反馈/评价/黑名单/审计按钮可见；API 调用被 CSP 有意阻断。
- weapp 全局样式为 app.wxss；页面没有单独 wxss 不自动算缺文件，实际导入仍待验证。

## 复测方法与禁止事项

1. 从固定 SHA 创建干净隔离副本，不借现有 node_modules/dist。
2. 新建专用 PostgreSQL 16 空库，仅绑定 loopback 随机端口；显式提供 DATABASE_URL。不要使用默认 5432 或原项目 .env。
3. 使用环境白名单并设置全部 provider=mock、真实支付开关=false；不继承真实身份/支付凭证。
4. 执行 pnpm install --frozen-lockfile、db:validate、db:generate、prisma migrate deploy。
5. 首次基线直接 RUN_DB_TESTS=1 pnpm test 可复现 shared entry 缺失；随后 pnpm build、pnpm typecheck，再运行 DB-enabled 全量测试和 HTTP 探针。
6. 前端另执行 Vite build 与 NODE_ENV=production Taro build --type weapp；产物独立服务/导入，禁止自动登录本机已有后台。
7. API 用 pnpm --filter @timeleft-shanghai/api deploy --prod 输出新临时目录，移开该临时包的 API/shared 源码，node dist/server.js，使用专用库和随机 loopback 端口检查 HTTP/DB。
8. 保存结果摘要，停止本轮服务与临时库。不要删除用户原工作副本、缓存、数据库或 SSH 隧道。

## 小程序导入补充记录

开发者工具 Stable 2.01.2510290 可连接，已选择本次隔离 dist。导入表单要求 AppID，目录尚无项目配置。本轮未指定隔离测试 AppID，未复用原项目身份配置，未创建测试号/云服务，取消了导入。故最终阻塞是隔离导入配置缺失，早先连接超时已恢复。不能将原项目已打开的旧 dist 作为本次产物验证。

## 结论

阶段 0 取得可复测的成功与失败证据。B01 测试构建顺序、正式打包脚本、前端本地 API 地址和 F01 等审计缺口均未整改。G0 blocked；没有因为现有 67 项通过而关闭 P0 或放行真实资金。

## 收尾

本轮临时 PostgreSQL 容器已停止，--rm/tmpfs 测试数据随之销毁；静态产物 HTTP 服务和 API 验证进程已停止。原 5432 SSH 隧道未动，隔离 worktree 保留。见 [清理记录](evidence/cleanup.json)。
