# S1b 与 S2 本地实施结果

2026-09-29。用户明确批准受控本地管理员账号，随后批准 A2 本地资金设计。本文只记录本轮 S1b/S2；后续资金变更另记阶段2，不覆盖本轮证据。

## 已验证

- 新干净副本 `/tmp/fanju-stage1b-20260929/clean`，frozen-lockfile 安装；PG16.14 临时容器 `fanju-stage1b-20260929`、loopback动态端口32770、独立空库；现有4项迁移部署成功。
- 最终 `RUN_DB_TESTS=1 pnpm test:ci`：**84 passed / 0 failed / 0 skipped**。shared18、API53（DB28/provider13/crypto3/security3/auth4/config2）、ops3、miniapp10。
- typecheck四包、真实Vite/weapp/API/shared构建、HTTP状态机探针、文案和Secret扫描均通过；ops会话竞态修复后重跑受影响测试、类型、Vite及发布包检查通过。
- 发布包没有API源码目录，`node dist/server.js` 独立启动；health/activities200、演示admin-login404。使用合成wechat配置仅测试启动与DB，不进行真实微信请求；新收费关闭。
- 浏览器实际显示账号密码表单；合成本地账号登录200、8项后台数据读取200；退出后回到空密码登录表单且运营数据移除。无自动演示登录请求。
- 密码摘要工具在PTY用合成密码实际走完隐藏输入/确认/摘要生成，明文未回显；没有生成或设置真实管理员凭证。

最终修复后使用第二个专用空库（`fanju-stage2-20260929`、127.0.0.1:32771）重跑84项测试；重新构建并打包API，发布产物启动检查通过。该库随后用于阶段2，旧32770容器已移除。

## 失败与修复

- 初版会话 audience 校验将合法用户访问后台从403变成401，3个原数据库断言失败。已保留原断言，明确区分未认证和权限不足，修复后全过。
- 独立复核复现旧异步操作在退出后触发旧token刷新、恢复私有数据。采用render捕获的SessionSnapshot贯穿操作、后续refresh及状态写入；旧token的401事件也不再失效新会话。实际App内存复现重测：退出后token空、data=null、旧loadOpsData调用0次。新增2条异步会话隔离断言。
- 第二轮复核发现小程序迟到401可能清除新会话。已仅在请求token仍等于缓存token时清除，并新增异步回归；10项小程序测试通过。
- API发布依赖仍有前轮已记录的pnpm可选编译工具bin/peer警告，纯Node启动通过；没有为消除警告升级框架/增加生产依赖。

## 完成口径

F02/T02、客户端无隐式mock回退等已有本地证据；不以本轮测试关闭全部F03/F04/AT10或宣称G0/G1完成。交易原渠道绑定、累计收费额度、资金未知恢复/任务/对账仍由已批准A2实现；微信IDE导入、真实身份与平台资料、生产Secret/多实例限速均未验证。代理部署前须定义可信入口和客户端地址提取策略；当前只按直接连接IP限速，不信任任意转发头。

配置快照更新需要重启全部API实例，真实撤销传播和轮换属于部署演练。运营退出目前移除浏览器会话；已经签发的令牌在到期、账号revision/version变化或撤销配置生效前仍按服务端策略校验，不能把页面退出等同于全局撤销。

本次没有Schema改动、真实账号配发、生产访问、Git提交/推送。工作副本仍是 `codex/fanju-stage0-baseline`，基线bc25f5b；本次源文件摘要与产物摘要见evidence（SHA256以Base64表示，避免十六进制摘要中的随机11位数字误触手机号扫描）。配置原件位于 `/tmp/fanju-stage1b-20260929/originals/`，回滚仅还原本包hunks并保留S1a默认关闭策略；不能重新接受旧无限期会话。

独立复核命令：`/Users/marvin.x/.codex/skills/codex-review/scripts/codex-review --mode local`。两轮共接受并修复2项会话竞态；最终复核 exit 0 / clean，无剩余可操作问题。定向16项测试通过，日志 `/tmp/fanju-stage1b-20260929/review-final.log`。
