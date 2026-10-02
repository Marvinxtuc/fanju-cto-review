# N1/P1 本地实施与验证记录

2026-09-30。用户批准 `N1_LOCAL_DESIGN.md` 所列本地通知、就绪/停机、诊断和可丢弃数据库恢复演练。当前工作区是 `codex/fanju-stage0-baseline`，基底 SHA `bc25f5b4859623338829ec09278c72619392141c`，上层改动尚未提交。没有推送、生产迁移、真实微信请求或收费。

## 已实现

| 工作包 | 本地结果 |
|---|---|
| N1 通知 | 第 11 项迁移为通知增加可空的订单、活动关联与已读时间，只回填能由既有业务键和本人订单交叉确认的旧记录。新成团/失败/取消通知同事务写关联与持久任务。本人接口仅分页返回 `SENT`，游标按创建时间和 ID 排序；已读接口限制本人且幂等。小程序增加收件箱、未读提示和分页；点击前重新查询本人订单。`SENT` 只表示站内可读。 |
| N1 恢复 | `inbox-only` worker 只领取站内任务，不创建资金渠道处理器。`inbox:audit` 默认只读列出缺任务、未收敛任务和不可靠关联；显式 `--repair` 只补建有完整业务键及订单归属的待投递任务。超重试预算仍沿用现有 `MANUAL` 与待办机制。 |
| P1 就绪 | 第 12 项迁移增加数据库时钟写入的 worker 心跳；第 13 项迁移为账单覆盖判定加入精确顺序。`/ready` 检查数据库、迁移和所需模式近 30 秒心跳；生产默认要求 `events-only,inbox-only`。恢复新收费时校验账单 scope 等于实际支付商户绑定，再要求指定账期最新覆盖判定为完整；缺失时新支付入口返回 503。`/health` 保持存活检查。 |
| P1 运行 | API SIGTERM 排空连接，最长 15 秒；运营诊断接口按订单显示资金事实、退款义务、任务和待办的内部 ID 与状态，也可按任务 ID 追到站内通知。队列接口给出各状态数量、最旧任务时间及最近账单覆盖状态，不回传渠道流水或用户联系方式。 |

## 隔离验证

- `fanju_stage2` 应用 13 项迁移；`RUN_DB_TESTS=1 ... pnpm test:ci` 最终 183 项通过、零跳过。`pnpm probe:api:state-machine` 通过；类型检查、文案扫描、敏感信息扫描和 `git diff --check` 通过。
- `TARO_APP_API_BASE_URL=https://api.example.invalid pnpm build` 通过。该地址仅为本地编译占位，产物不能作为真实网络配置。独立 API 发布目录 `/tmp/fanju-n1p1-api-release-final-local-20260930` 通过 `pnpm verify:release`：API HTTP、`events-only` 和 `inbox-only` 打包运行；记录 251 个产物摘要。当时尚未用微信开发者工具导入本轮小程序包；后续导入状态见“尚未完成”。
- 通知隔离库测试覆盖待投递不可见、本人送达可读、跨用户已读 404、重复已读、稳定分页、坏游标 400、缺任务补建幂等。独立进程验证 `inbox-only` 完成站内任务后，另一条资金任务仍为 `READY`。
- API 进程验证：隔离库 `/ready` 返回 200；无效数据库连接返回 503；两进程收到 SIGTERM 后正常退出。自动测试还覆盖无心跳、过期心跳和恢复心跳。用数据库锁将公开活动请求阻塞约 3 秒，期间发送 SIGTERM；请求最终返回 HTTP 200，API 以 0 退出。超过 15 秒强制退出的路径未做故障注入。
- 2026-09-30 补充强制停机注入：独立发布包 API 监听本机 `127.0.0.1:38647`，在可丢弃库对 `Activity` 表加临时独占锁并发起公开活动读取。确认请求仍待处理后发送 SIGTERM；API 在 **15.06 秒**后以状态 1 退出，客户端收到 `RemoteDisconnected`。数据库锁持有 22 秒后正常释放。该用例只验证强制退出期限和未完成 HTTP 请求的中断，不把它当作已应答资金事件的恢复证明；未改业务数据。
- 该注入后复查停机失败路径：若 `app.close()` 抛错，旧代码会跳过 Prisma 断连并清除强制退出计时器，可能留下不退出的进程。现已让关闭 HTTP 与断连分别尝试，任一步失败均记录错误并以非零状态退出；15 秒期限仍覆盖卡住的步骤。修改后在隔离库重跑 `pnpm test:ci`：**183 passed、0 failed、0 skipped**；`pnpm typecheck`、API `tsc` 构建、编译后的 API `/health` + SIGTERM 正常退出烟测及 `git diff --check` 通过。该烟测退出码为 0，停机耗时 0.02 秒。新 `server.ts` SHA256 为 `43b0cf919a0ffc55e51e0bd3962c4e352dd87d878f051f3c1a3db782e772f656`；编译后 `server.js` 为 `e46f56ed6d0c27fd5efdff7fe53e95d2eb8249036156dee4a05d63cdd5ed8e22`。重新生成独立发布目录 `/tmp/fanju-n1p1-api-release-shutdown-fix-20260930`，`pnpm verify:release` 验证 API HTTP 与两种 worker 启动通过，251 个产物清单 SHA256 为 `310237d8233267e35f3e84daeb9562c064c353d29b585fb852e63c64fe0a4a96`。`pnpm deploy` 有可选 `tsc` bin 与 React 类型 peer 告警，未阻止纯 Node 产物启动。
- 随后将停机清理提为可独立测试的 `shutdown.ts`，新增两项回归：HTTP 关闭抛错后仍断连，数据库断连抛错后返回失败。当时完整 CI **185 passed、0 failed、0 skipped**；`pnpm typecheck`、API 构建、`pnpm probe:api:state-machine`、文案/敏感信息扫描与 `git diff --check` 通过。独立目录 `/tmp/fanju-n1p1-api-release-shutdown-regression-20260930` 经 `pnpm verify:release` 验证 API HTTP、`events-only` 和 `inbox-only` worker，256 个产物清单 SHA256 为 `b72698cb63fd479122042635fc4b02a68732e072bab0b7622e54b1493e825635`。前一条的 183 项与 251 个产物是历史阶段结果。
- 为确认构建没有借用旧 API `dist`，先将其完整移到 `/tmp/fanju-n1p1-api-dist-backup-gKbpke/dist`，再运行 API `tsc`。新的 `dist/server.js` 与 `dist/shutdown.js` 均存在，未发现 `.test.js`；独立包 `/tmp/fanju-n1p1-api-release-clean-20260930` 再次通过 `pnpm verify:release`。最终 256 项产物清单摘要仍为 `b72698cb63fd479122042635fc4b02a68732e072bab0b7622e54b1493e825635`；API `server.js` 为 `ad9725bdaebfe04f55bf6643371095719af5909361895249dae2cae3447f2223`，`shutdown.js` 为 `9e2359f2c57258caf3035596cec2a68e77439bd862ce979bbc5fa3f98dc07bae`。旧产物备份保留，未执行删除。
- 备份演练：`fanju_n1p1_source_20260930` 含 1 笔合成收款与 1 个合成任务，备份 SHA256 为 `ba953dc1540ccf879ed6392ead65597f1be78320c121cd96f0607a3af5e019a8`。恢复到独立 `fanju_n1p1_loss_20260930` 后，仅在该可丢弃副本移去这两项，再导入 SHA256 为 `e976ce2ca4c1567f33eb55909d47ccc61d8cbaeda7c90b7829fb4615f27982e5` 的受控 mock 账单。事件 worker 完成后：同一渠道交易的收款事实 1、`UNASSOCIATED_RECEIPT` 待办 1、事件任务 `DONE` 1。此时仍须人工核验和结案，不能据此恢复真实收费。
- 首轮 `codex-review --mode local` 指出两处有效问题：活动发布和餐厅编辑缺少共享锁；订单诊断漏查以收款事实与任务 ID 为来源的异常待办。已修复并增加并发与关联回归。复核工具针对整个未提交工作树运行。
- 第二轮复核指出旧的不完整账单批次会永久阻止后导入的完整批次。已改为按数据库序号读取最新覆盖判定，历史批次不删除。隔离库验证了 `UNAVAILABLE → COMPLETE → INCOMPLETE → COMPLETE` 四次判定与三条保留记录。
- 第三轮复核指出直接创建已开放活动与餐厅编辑仍可能并发，以及账单 scope 可能配置为非当前支付商户。已将活动创建纳入餐厅锁，并在启动时校验 scope；新增隔离库并发用例和配置单测。最后用 `codex review` 自定义范围复核这两条修复，退出 0，未发现指定路径的可操作缺陷；这不是全分支清洁复核。复核工具自己运行的跳过数据库测试不作为验收依据。
- 对同商户同账期的账单最终判定增加事务级 advisory lock，避免并发导入时决定序号与提交顺序错位。对应 5 项隔离库对账测试通过；再次用限定文件的 `codex review` 复核，退出 0，未发现指定文件中的明确错误放行或永久阻断缺陷。该复核未执行并发数据库测试，完整 CI 结果见上。
- 最后一轮全工作区复核另指出三项可复现问题：退款后的历史成团通知缺失任务不能补建；成团冲突复发后已结工单未重开；运营订单列表漏计以持久任务 ID 为来源的工单。分别修复并加入隔离 PostgreSQL 回归。最新 `pnpm test:ci` 为 **186 passed、0 failed、0 skipped**；`pnpm typecheck`、`pnpm probe:api:state-machine`、`pnpm check:copy`、`pnpm check:secrets`、`git diff --check` 均通过。先把旧 API `dist` 移至 `/tmp/fanju-n1p1-api-dist-backup-UTEzvA/dist`，再从空目录构建；独立包 `/tmp/fanju-n1p1-api-release-20260930-final2` 的 `pnpm verify:release` 验证 API HTTP 与两种 worker，记录 256 个产物摘要。前述 185 项结果及旧包均为历史快照。
- 最终运行 `codex review --uncommitted` 复核当前已暂存、未暂存及未跟踪改动，退出 0，未报告有充分证据支持的可操作缺陷。复核进程自行运行的定向测试不替代上面的完整隔离库 CI、真实构建或外部联调。

## 当前兼容矩阵与回退边界

| 组合 | 结果 |
|---|---|
| 本工作区 Schema 13 + 当前 API/worker + 当前 ops/weapp 产物 | 本地测试、构建及发布包烟测通过；小程序正式构建包仍使用占位 API 域名。临时 loopback 包已实测报名、原订单找回与重试、成团通知投递/已读、实时详情及退款进度；该临时包不是发布产物。 |
| 本工作区 Schema 13 + 基底 `bc25f5b` API/worker | 不作为回退组合；旧版仍依赖一人一活动只有一条订单，且未验证新结构。 |
| Schema 10–12 + 当前 API/worker | 未验证且缺少通知、心跳或账单覆盖顺序列；禁止作为运行组合。 |
| 最低兼容回退 SHA | **尚不存在**：当前改动未形成提交，也未做新旧版本组合演练。G3 仍阻塞。 |

`artifacts/release-manifest.json` SHA256：`5b282abedadc9b930e059ba837b93fc0be9e6042a8462137b302af864c4758c6`。API `app.js`：`c885fe0b1af84c75592f7f69f5e63e8820920c81c921c6da96483c943c21e376`；对账服务：`f6954c2d52a8a571be46613d6425d2cfe62ac1b02f40ecdc9adeeed54e990327`；小程序新收件箱页面：`cc625b8fcb5072e5ff9acf10f6fc9d58437ee382a7c90cb0f697933ded38e3fc`。摘要只绑定本次本地构建，源码 SHA 尚不能绑定未提交改动。

## 2026-09-30 模拟器业务实测增量

原空数据联调后继续构造本地四人餐桌，实际发现客户端空动作 POST 的 JSON 报文缺陷。修复请求封装并增加付款确认/通知已读回归，完成了同一待付订单的找回和付款重试、新报名、持久 worker 成团通知、通知已读与详情、取消申请、审核/处理/已退款展示及退款后历史通知读取。最新完整 CI 为 **187 passed、0 failed、0 skipped**；空库全部 13 项迁移、类型检查、扫描、Taro 实际发布构建及独立 API/两种 worker 烟测通过。最新发布清单 SHA256 为 `44cb2c2c9886ef8b49730751da1309997ec5f5eb8da94308c5a0ee7ad5a502d3`，上面的 186 项计数和摘要为修复前快照。

详见 [小程序业务实测报告](./UI_ACTION_IMPLEMENTATION_REPORT.md)，其中明确 UI 操作、API 夹具、测试断言和正式验收的证据边界。以下 09:54 段落保留当时仅完成空订单/空通知查询的记录。

## 尚未完成

2026-09-30 已在微信开发者工具 Stable 2.01.2510290 以测试号、无云服务导入本轮 `apps/miniapp/dist`，项目名 `fanju-local-n1p1`。09:06（北京时间）只读复查时仍显示信任提示；用户随后明确授权运行。09:43 复查时提示已消失、首页已渲染。实际点击“我的订单”和“站内通知”，两页均渲染了未登录提示，随后因占位 API 请求失败分别显示“订单加载失败”和“通知加载失败”。09:44 手动重新编译回到首页；“问题”面板为 0，调试器本轮 1 个错误是 `https://api.example.invalid` 不在小程序 request 合法域名列表。另有基础库/渲染兼容等 4 个警告。此前 `fanju-local-u1` 的结果属于旧包，不作为本轮证据。

为本地业务链路验证，另在 `/tmp/fanju-n1p1-loopback-gsCjbg/dist` 编译临时开发包，内置演示模式和 `http://127.0.0.1:48991`。该临时副本编译退出 0；因为副本缺少仓库根部 `tsconfig.base.json`，构建过程提示两次找不到基础配置，不能用作正式发布证明。隔离库 mock API 只绑定 `127.0.0.1:48991`。用户明确批准仅在临时测试项目关闭“校验合法域名”；临时 `project.private.config.json` 设置 `urlCheck=false`，仓库原包配置未改。

09:54 在微信开发者工具 Stable 2.01.2510290 导入临时目录为 `fanju-local-loopback-n1p1` 并运行。工具日志明确显示已关闭该项目的合法域名/TLS 校验，首页从隔离 API 显示了活动记录；随后从“我的订单”进入本地演示登录，页面显示“Mock 登录和手机号已完成”。返回订单页后 Network 面板显示 `orders` 请求 HTTP 200、页面显示“暂无订单”；进入站内通知页后 `notifications` 请求 HTTP 200、页面显示“暂无通知”。这证明本机模拟器至隔离 API 的读取链路和 mock 登录路径连通，尚未验证有订单或有通知时的详情、已读、分页及真实履约。调试器该轮显示 0 errors；警告包括显式关闭校验、基础库和渲染兼容提示，不能将其记为正式版本零警告。联调后已正常停止本机 mock API，端口 `48991` 不再监听；临时项目目录保留供后续复验。

生产备份介质、真实商户账单、微信消息模板与订阅授权、真实微信联调、目标设备与正式环境的完整业务验收、生产部署和收费均未执行。通知多页样例尚未在模拟器手工复验。旧版本回退兼容提交与实际演练、运营告警接收链路尚需完成。强制停机期限已按上面注入验证；该用例没有覆盖资金回调应答后的恢复。G0–G4 均未因本地验证自动签收。

本次可丢弃库的回滚方式是从上面的源快照另建测试库；本工作区代码可按本次文件差异逐项撤回，不能对含既有未提交工作的分支使用 `reset --hard` 或 `clean`。
