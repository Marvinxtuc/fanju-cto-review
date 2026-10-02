# L1 本地实施记录

2026-09-29。工作副本 `codex/fanju-stage0-baseline`，基底 `bc25f5b`，改动尚未提交。仅使用 Docker PostgreSQL 16 临时库 `fanju_stage2`（loopback `127.0.0.1:32771`）和 mock 渠道。未访问真实微信、生产数据库或收费环境。

## 已实施

- 两段迁移增加 `registrationActive`、`capacityHeld`、`version`，先建活动报名的部分唯一索引，再移除旧绝对唯一索引；历史行保留。已付及退款中状态有数据库占位检查约束。
- 创建订单时同事务安排 `EXPIRE_ORDER` 持久任务。到期/待付取消先核对原付款渠道并关闭原商户号，再决定是否释放席位。未知或无法关闭的结果保留占位；worker 过早领取会重试。
- 同一用户重复待付报名复用原订单；确认关单后可重新报名并保留旧订单。容量以持久 `capacityHeld` 计算。
- 释放前逐笔检查收款、退款和义务。成功支付缺少独立收款凭据、历史退款未绑定原收款，均保留占位。支付意图与预付参数发布增加报名有效/席位占位门禁。普通退款先完成、额外收款补偿后完成时，最后一笔确认会重新检查并释放已退款订单的占位。

## 本轮证据

| 检查 | 结果 |
| --- | --- |
| `prisma migrate status` | 8 项迁移已应用，数据库与迁移目录一致 |
| 重复 `prisma migrate deploy` | 在同一隔离库返回 `No pending migrations to apply`，原始记录 `/tmp/fanju-stage2-20260929/l1-migrate-redeploy.log` |
| 历史数据迁移演练 | 在隔离库的临时 Schema 先应用前 6 项迁移、写入 3 条旧订单，再应用 L1 两段迁移：3 条均保留；释放旧单后可新增报名；第二条有效报名和已付不占位写入均被约束拒绝。原始运行记录：`/tmp/fanju-stage2-20260929/l1-historical-migration-final.log` |
| L1 + API 针对性测试 | L1 12 项、API 33 项通过 |
| `pnpm test:ci` | 156 项通过、0 failed、0 skipped/todo，包含真实 PostgreSQL 写入路径 |
| `pnpm typecheck`、`pnpm check:copy`、`pnpm check:secrets`、`git diff --check` | 通过 |
| 空产物目录后 `TARO_APP_API_BASE_URL=https://api.example.invalid pnpm build` | Vite、Taro 微信包、shared、API 全部生成产物。首次未设置必需 API 地址时按配置门禁失败 |
| `pnpm --filter @timeleft-shanghai/api deploy --prod /tmp/fanju-l1-api-release-reviewed-20260929` | 修复后重新打包退出 0，有 peer/TypeScript bin 警告；本次未新增依赖 |
| `node scripts/verify-release.mjs` | 独立 API HTTP + event worker 启动通过；227 个产物摘要写入 `artifacts/release-manifest.json` |
| 打包后 local-recovery worker `--once` | 退出 0，启动并执行一轮领取 |

现有 20 并发最后一席、历史重报、关单与渠道支付并发、首次支付意图与取消并发、关单超时保留占位、未知退款保护、过早任务重试和持久 worker 测试均包含在上述 CI。测试与日志原文位于仓库外 `/tmp/fanju-stage2-20260929/`。构建前旧产物备份位于 `/tmp/fanju-l1-dist-backup.0Ll0HA`，新产物是忽略文件；回滚本次源码时应按文件审查差异，保留其他未提交工作，不使用 `git reset --hard`。

`codex-review --uncommitted` 首轮指出额外收款补偿结清后未重新释放席位；已用真实 PostgreSQL 测试复现并修复。修复后全量 CI、类型检查、API 包构建与独立运行复测通过。第二轮同命令退出 0，未报告仍需修复的问题；该复核自己未重跑数据库与构建，数据库和产物结果来自上述独立检查。

## 尚未证明与门禁

- 迁移只在隔离库演练；尚未给出可回退的兼容提交 SHA，也未演练生产数据和真实渠道。`bc25f5b` 仍禁止对切换后数据库写入。
- 小程序本轮产物尚未在微信开发者工具重新导入验证；构建成功只证明编译。占位 API 地址不得用于真实发布。
- L2 成团及退款政策、真实身份/支付联调、生产部署和收费仍各按独立门禁处理。L1 不等于 G1 通过。
