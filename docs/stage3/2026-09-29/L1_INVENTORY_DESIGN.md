# L1 库存到期、待付续付与重报切换包

2026-09-29。L1 本地专项设计，已获用户批准并在隔离工作副本实施；实测结果见 [L1 实施记录](L1_IMPLEMENTATION_REPORT.md)。承接F12/F13、R02/R05。A2明确保留了原Order(userId,activityId)绝对唯一约束，本包在批准后切换；仅本地工作副本与可丢弃数据库。真实微信调用、生产迁移、部署、收费、Git提交推送仍不在范围。

## 1. 数据与状态

Order新增registrationActive、capacityHeld、version。资金未决责任始终来自Payment/Receipt/Refund/Obligation，不能拿capacityHeld代替。所有状态写入经同一个事务helper同步更新字段；数据库检查约束防止PAID_PENDING_GROUP/GROUPED/REFUND_REVIEWING/REFUNDING/COMPLETED漏占位。

| 状态/事实 | registrationActive | capacityHeld | 处置 |
| --- | --- | --- | --- |
| 待付且在15分钟内 | true | true | 重复报名返回原待付订单，支付复用原商户号 |
| 待付到期，但未建立支付意图 | false | false | 同事务关闭订单；与支付意图创建共用订单锁，不能先释放后创建 |
| 待付到期且有UNKNOWN/MANUAL或渠道PENDING | true | true | 查原渠道；必须关单并确认CLOSED才释放；无法确定进入8次预算/24小时待办 |
| 到期确认已成功收款 | true | true | 保存收款；交资金/履约判断，不能当未付关闭；无法合法履约建立退款义务或有期限待办 |
| 已确认CLOSED且无成功收款、无未决退款义务 | false | false | 允许在活动仍可报名时重新报名 |
| 已付待成团/已成团/退款审核/退款处理/已完成 | true | true | 本包不改变其履约政策 |
| 已全额退款且全部关联资金责任结清 | false | false | 仅活动可报名、未截止、容量满足时可重报 |
| 历史关闭/取消/失败，但资金证据不完整 | true | 依据历史状态保守初始化 | 不凭状态名清除资金责任；待核验后释放 |

额外收款和晚到收款继续由A2独立事实及义务处理，不复活已关闭订单。新订单不复用老资金意图；老订单/资金记录全部保留。

## 2. 持久到期任务

- 下单与EXPIRE_ORDER任务同事务；runAt等于inventoryLockedUntil。
- 复用已有领取/租约/退避/8次人工机制，不另写临时timer。
- 先锁Activity→User→Order读取快照，提交后查询/关单，返回后再次锁并检查version及当前资金事实。
- mock渠道新增幂等关单：原商户号未收款可CLOSED；已成功不得关成未付；关闭后模拟成功入口也不能伪造渠道支付成功。合法晚到证据可通过独立可信事件模拟。
- 本地支付首次外发也必须检查NEW→UNKNOWN条件更新是否成功，防止到期worker已关闭后旧API继续外发。
- 若支付结果未知，关单请求超时不能释放容量；查不到订单也不立刻释放曾外发意图。先原号关单/可靠阻断后续支付，再释放；无法确认保持待办。
- 新字段和任务也覆盖取消待付：无意图可关闭；已有意图进入同一关单流程，不直接释放。

## 3. 唯一约束与迁移

1. Expand迁移新增字段，保留原绝对唯一索引。旧记录registrationActive先true，不自动放开历史重报；capacityHeld按现有明确占位状态保守回填，并预检查非法状态/未知金额。
2. 建立部分唯一索引Order(userId,activityId) WHERE registrationActive；谓词不含now()。普通查询用findFirst及registrationActive，消除旧复合唯一键假设。
3. 对有充分本地mock证据的终态逐笔释放；未知/真实历史不批量猜测。
4. 更新所有写入者和容量统计，测试新客户端+API+worker+新数据库组合。
5. 第二项本地迁移单独移除旧绝对唯一索引；验证同用户同活动可以保留多条历史订单但最多1条active。
6. 兼容代码未提交前只做本地演练，不填写假SHA。最低兼容提交与版本矩阵需后续Git批准、构建摘要及回退演练。bc25f5b不得回退写入此Schema。

回退保留字段、索引和历史订单；停止新报名/新支付，用兼容版本读取和处理旧资金。不能恢复旧唯一索引导致历史记录删除；不执行drop数据。

## 4. 精确改动范围

- prisma/schema.prisma与两项增量迁移（expand/cutover）。
- services/api/src/orders/*：统一容量/报名状态事务helper、到期处理；jobs运行器只复用。
- app.ts下单/待付取消/资金写入的订单状态调用；funding/receipts.ts、refunds.ts调用统一helper维护新字段。
- PersistentMockChannel关单语义，worker EXPIRE_ORDER handler。
- 测试：真实PG并发、真实loopback HTTP续付/取消/重报、迁移幂等和失败保留记录。用户端找回与操作入口由后续U1接入，本包保证兼容路由返回明确进度。

## 5. 验收与放行

20并发同用户报名仅1active；最后一席20并发仅1成功；无意图到期与创建支付竞态；渠道成功与关单交错；关单超时保持占位；过期worker结果不能释放新责任；重复到期任务幂等；已关闭晚到成功不复活并产生退款义务；退款未结清禁止重报；终态有证据重报保留旧记录；切换后旧API组合明确禁用；重新构建API/worker产物并运行。

L1通过不代表G1通过：L2成团/退款政策与U1找回订单仍需完成。真实渠道、微信IDE、生产回退与真实收费门禁独立保留。

## 独立设计复核补充

review_s1只读复核认为可作为下一包本地专项确认稿，未发现主方向阻断。实现必须再冻结：

1. mock关单持久保存原商户号CLOSED墓碑，即便首次create尚未到达也不能在容量释放后受理旧create。真实微信NOT_FOUND不能可靠关单时继续UNKNOWN/人工，不用mock测试替代真实渠道能力证明。
2. 释放registrationActive必须逐笔receipt核对成功退款、未知/处理中退款与义务；订单REFUNDED不是清空额外/晚到收款责任的证据。每笔实收都必须有明确已结清证据或合法履约，不能将多笔金额直接相抵。

此复核是设计建议。最低兼容SHA仍须在本地实现、测试和复核完成后另行获准Git提交再建立。
