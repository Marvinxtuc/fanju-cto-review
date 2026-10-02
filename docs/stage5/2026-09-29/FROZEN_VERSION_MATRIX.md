# 固定版本与本地兼容演练

2026-09-30。用户明确批准 `LOCAL_GIT_FREEZE_PLAN.md`，仅本地提交和可丢弃库演练。

## 固定实现与结果

- 本地整改提交：`2e7e012e1f58e093f5913cdaeaa400b4bb7e30a7`（简称 `2e7e012`），分支 `codex/fanju-stage0-baseline`，包含 179 个文件。未推送。
- 从该 SHA 的 `git archive` 导出干净副本 `/tmp/fanju-freeze-2e7e012-20260930`，离线按冻结 lockfile 安装现有依赖。124 项源码/配置摘要与提交前快照全部一致。
- 专用可丢弃库 `fanju_freeze_2e7e012_20260930` 从空库部署 13 项迁移；完整 CI **187 passed / 0 failed / 0 skipped/todo**，类型检查通过。
- 另在本库独立测试 schema 先应用旧 4 项迁移并写入 3 条历史订单，再应用后续 9 项：历史行保留，可取消关闭历史后重报；有效订单重复与已付无容量均被约束拒绝。夹具正常清理自己创建的 schema。
- 从空产物目录执行真实 Vite/Taro/API 构建；独立发布包 `/tmp/fanju-freeze-api-release-2e7e012` 的 API HTTP 和 events-only/inbox-only worker 烟测通过。首轮未提供非演示会话配置而失败；补充仓库外本地测试环境后通过，未改源码。pnpm 9 不支持 `deploy --legacy`；使用该版本支持的 `deploy` 成功。
- 新产物清单为 254 项，SHA256 `b4256bfdceaccd92275d22da08a2b2b3944213ba5c2d60117589a9ab39389844`。此前 256 项包含开发者工具生成的两个 project 配置；干净构建没有它们。新包仍使用占位 API 域名，不能发布。

证据：`evidence/freeze/verification.json`、`release-manifest.json`、`reinstall.json`、`legacy-schema.json`。完整日志保留在 `/tmp/fanju-freeze-*.log`，夹具源脚本已保存在 evidence/freeze 下。

## 允许/禁止组合

| 数据库 | API / worker | 客户端 | 当前结论 |
| --- | --- | --- | --- |
| 完整 13 项迁移，含历史多订单 | `2e7e012` API + 同 SHA worker；两者运行时配置一致 | 同 SHA ops/weapp | 已通过本地 CI、构建与发布启动；先前模拟器业务使用相同源码，固定 SHA 新包尚未另做 IDE/设备验收；仅本地允许 |
| 旧 4 项迁移或无迁移履历 | `2e7e012` | 任意 | 禁止接业务流量；真实 loopback HTTP `/health` 200、`/ready` 503。启动进程不是准入证据 |
| 新 13 项迁移与多历史订单 | `bc25f5b` 旧 API 或旧 worker | 任意 | 禁止；旧 API 假设 `(userId,activityId)` 绝对唯一且没有新增恢复机制；未以执行高风险写入来证明兼容 |
| 新 13 项迁移 | 新旧 API/worker 混跑，或旧客户端 | 任意 | 不在已验证允许集合；没有认定其兼容，不安排滚动混跑 |
| 任意 | `2e7e012` 真实身份/资金 provider | 任意 | 当前未获真实联调批准；本地证据不产生真实渠道放行 |

最低已验证兼容回退 SHA：**`2e7e012e1f58e093f5913cdaeaa400b4bb7e30a7`**。目前没有更早的已验证兼容业务版本。后续版本若改业务或 Schema，必须再证明它可退至此版本；不能由此报告推定未来版本兼容。

## 精确版本重新部署演练

用固定 SHA 的独立包启动 loopback API，测试夹具给同一用户同一活动写入 CLOSED 历史单和 PENDING_PAYMENT 有效单。API 实际读取 2 条；记录可信合成资金事件后 SIGTERM 正常停止 API。独立 events-only worker 处理落盘事件，退出 0，收款事实保留，未知本地关联进入人工待办。再次启动同一固定 SHA 的独立包，原会话读取订单仍为同样 2 条，资金事实 1 条、任务 DONE。第二次正常停止，两个 API 退出码均为 0。

**本次是精确兼容基线的重新部署恢复，不是两个不同业务版本之间的跨版本回退。**它证明具体 SHA 在当前迁移上保留历史和资金、可运行恢复任务。没有虚构旧兼容版本，没有逆向删除迁移、新字段、资金或任务。指定新旧业务版本交错与未来候选回退仍须在对应版本存在后演练。

## 本地回退操作边界

保留当前 13 项迁移和全部资金历史，停止新收费与新写入、正常排空 API/worker。恢复此 SHA 对应的已验证产物和匹配的脱敏配置，再执行 readiness、本人历史订单、资金任务、账单覆盖和待办核对；核对未通过时不恢复收费。不将源码 revert 等同于数据库回滚，不使用 reset/clean，不切回 `bc25f5b` 写入新数据库。

G0–G4 仍未签收。正式协议与餐厅规则、真实平台/商户/账单、目标环境代理/备份/告警及真实设备验收继续缺输入。本轮没有真实微信请求、生产迁移/部署、推送或收费。

## API/worker 版本标识与就绪补证

同一独立包以 `RELEASE_VERSION=2e7e012e1f58e093f5913cdaeaa400b4bb7e30a7` 分别运行 events-only/inbox-only worker。数据库记录两个模式的同 SHA 新鲜心跳；API 指定两种 required mode 后，真实 loopback `/ready` 返回 200、missingModes 空。证据 `evidence/freeze/version-ready.json`。`/ready` 本身核对模式、心跳与迁移，不强制版本相等；本次通过额外数据库核对绑定版本，部署准入仍须显式核对实际 API/worker 产物组合，不能仅凭 ready 200 放行混跑。
