# A2 本地资金待办及历史样本演练

仅适用于获批的可丢弃数据库、持久模拟渠道，不授权真实历史交易认领、微信请求、生产迁移或收费。命令运行编译产物；不是手写SQL修改资金状态。操作者和复核者字段用于本地演练审计，不能替代生产管理员认证或真实双人复核。

## 历史模拟收款认领

1. 用受控账单导入工具校验摘要并保存事件；运行worker消费，产生未关联receipt及待办。
2. 核对原Payment商户单号、mock渠道、金额与receipt一致。只允许从legacy-unverified切到固定mock-local/mock-v1；不根据当前全局配置替换历史真实绑定。
3. 独立复核人核对后，在显式APP_ENV=local/ci、NODE_ENV=development/test、PAYMENT_PROVIDER=mock、REFUND_PROVIDER=mock和DATABASE_URL下运行：

```sh
FINANCIAL_CASE_OWNER=local-operator FINANCIAL_CASE_REVIEWER=local-reviewer \
node services/api/dist/local-funding-cli.js claim-mock <payment-id> <receipt-id>
```

认领事务保留原订单履约状态，记录receipt关联和原收款事实，不直接建立外发退款。所有历史未关联退款一并关联原receipt并保留MANUAL及占款；总额超过原收款、存在多笔收款歧义、渠道/金额/商户号不一致则整个事务失败。重复相同认领不重复审计或占款。资金核心事实不能被改写。

历史退款后续必须从受控账单或可信回调补齐退款事实，走统一事件/资金服务。没有证据不能把FAILED改成无占款，也不能通过普通审批重新发起历史MANUAL退款。真实历史认领仍需逐笔材料和另行批准。

## 待办处理与复核

```sh
FINANCIAL_CASE_OWNER=local-operator node services/api/dist/local-funding-cli.js list
FINANCIAL_CASE_OWNER=local-operator FINANCIAL_CASE_REVIEWER=local-reviewer \
node services/api/dist/local-funding-cli.js resolve <case-id>
```

只有待办责任人可结案，复核者必须不同。工具只接受可从数据库验证的终态：未关联收款已可信关联；历史/未收敛退款已确认；耗尽任务对应的支付、退款或事件已有确认结果。未解决的资金冲突、履约判断、渠道不可用、缺账单等保持OPEN，工具不提供自由文本“强制成功”。结论和审计同事务提交。结案不删除事件/任务/资金记录，也不释放资金预算。

一般运营待办交互、人工恢复重试预算、真实历史多笔映射属于后续工具补齐项；本工具不能据此签收完整运营闭环。

## 恢复顺序

保持新收费关闭 → 恢复数据库 → 导入缺失期间账单与核对未结清交易 → 消费可信事件 → 处理未关联/冲突待办 → 复核所有未结清责任。只有后续独立发布审批通过才可恢复真实收费。

任何回退都保留新增表、证据、任务和审计。当前没有获批兼容提交SHA，禁止回退到bc25f5b继续写资金。
