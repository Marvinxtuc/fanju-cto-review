# L2 本地实施记录

日期：2026-09-29。工作副本 `codex/fanju-stage0-baseline`，基底 `bc25f5b`，改动尚未提交。仅使用 loopback Docker PostgreSQL 16 隔离库 `fanju_stage2` 与 mock 渠道；未访问真实微信、生产数据或收费环境。

## 已落地

- 第 9 项迁移为桌组增加代次、桌序与候选摘要，为站内通知增加唯一业务键。历史桌组和通知保留；历史空摘要草案不能直接确认。迁移仅在可丢弃数据库执行。
- 成团草案、人工调整和确认共用当前完整候选集合。确认时重验已确认收款、席位占用、订单版本与集合摘要。重建会取消旧草案并保留成员；成团决策、审计、通知与持久投递任务同事务提交。
- 人数不足失败时逐笔读取真实收款，先复用可绑定原 receipt 的待审退款，再按未预留余额建立退款义务与任务；worker 经 mock 渠道查询/退款。同一笔收款的未知或进行中退款保守占用预算。无法核实资金的已付订单进入有负责人和期限的异常待办。未结清所有收款时订单维持 `REFUNDING`，最后一笔确认后才改 `REFUNDED` 并释放席位。
- 新增超级管理员取消活动、运营退款审核拒绝入口及后台操作按钮。取消活动会失效桌组、阻止地址展示并建立退款责任；有待付订单时先拒绝取消，要求先完成付款结果恢复。用户申请取消在事务内按开始时间及退款政策重检。审核拒绝重新检查活动、桌位、收款、其他退款与当前时间，不能机械恢复旧状态。
- 地址仅在本人订单有效、当前确认桌位存在、活动状态允许且达到 T-24 时返回；无有效桌位时连餐厅名称也不展示。普通用户仍只可读取自己的订单。

## 验证证据

| 检查 | 本轮结果 |
| --- | --- |
| 隔离库迁移 | `20260929030000_formation_recovery_expand` 已在专用 PostgreSQL 应用，共 9 项迁移 |
| API/PostgreSQL | 44 项测试通过，覆盖六人草案移走一人、晚到付款导致草案失效、历史空摘要草案保留并重建、取消与确认并发、通知任务重放、失败成团逐笔及部分退款恢复、运营取消复用待审退款、审核拒绝及开始后取消拒绝 |
| `pnpm test:ci` | 168 项通过，0 failed、0 skipped/todo，含隔离 PostgreSQL 写入路径及不同金额额外收款不覆盖原支付决议的回归断言 |
| `pnpm probe:api:state-machine` | 真实 HTTP 探针通过；将 L1 待付重复报名的断言更新为“返回同一订单且标记复用”，其余非法状态断言仍执行 |
| `pnpm typecheck`、`pnpm check:copy`、`pnpm check:secrets`、`git diff --check` | 通过；测试手机号只用既有明确允许的虚构测试值 |
| 移走旧 `dist` 后 `TARO_APP_API_BASE_URL=https://api.example.invalid pnpm build` | Vite、Taro 微信包、shared、API/worker 产物重新生成。旧产物在 `/tmp/fanju-l2-20260929/pre-post-review-dist`；此前备份仍在同级 `pre-verified-dist`、`previous-dist`、`pre-final-dist`。不设置小程序 API 地址时，生产构建按配置门禁失败 |
| 独立发布目录 | `pnpm --filter @timeleft-shanghai/api deploy --prod /tmp/fanju-l2-20260929/api-release-post-review` 退出 0；在隔离数据库环境运行 `pnpm verify:release /tmp/fanju-l2-20260929/api-release-post-review`，API HTTP 与 event worker 启动烟测通过，记录 230 个产物摘要 |
| 独立代码审查 | `codex-review --mode local` 最后一轮退出 0，未报告可采纳的待修缺陷。前两轮发现的后台退款提示及额外收款覆盖原支付决议已修复，并由本轮回归覆盖。审查不代替上述 PostgreSQL 与发布产物验证 |

上述自动化不等于真实微信或微信开发者工具本轮导入验证。小程序 IDE 验证、真实身份/支付/退款、生产迁移、部署与收费仍按 G1–G4 独立放行。切换后数据库的最低兼容回退 SHA 仍未形成，`bc25f5b` 不可宣称可回退。没有执行 Git 提交、推送或生产操作。

回滚本轮本地源码应逐文件审阅 L2 差异并保留 L1/A2/U1 已有未提交工作。数据库采用前向兼容列与索引；隔离库可按工作包重建，生产不可直接删列回退。旧 `dist` 已单独备份，无需覆盖其他本地文件。
