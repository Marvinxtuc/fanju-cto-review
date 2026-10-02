# U1 本地订单找回实施记录

2026-09-29。本地实现、自动化及独立复核已完成；G1尚未通过。承接用户持续本地实施授权；无Schema切换、生产迁移、微信身份/资金请求、上传发布或Git提交推送。主责本次Codex。

## 代码与行为

- services/api/src/app.ts：新增本人订单分页GET /api/orders，20条+nextCursor，createdAt/id倒序，游标限定本人；只返回必要摘要。详情增加退款进度、付款处理中/待核查、当前取消入口状态。
- apps/miniapp/src/api.ts：服务端找回、显式ID详情、原订单续付、取消申请。只有显式demo+服务端mock+payable才模拟完成；MANUAL/processing/不可支付不调用收银台；支付取消保留原订单。
- order-list首页入口、详情刷新/续付/取消原因/退款进度；中文业务状态。路由ID优先于旧lastOrderId，无旧缓存时可查服务端。
- 隐藏/重新显示页面使旧请求失效，异步响应与当前会话比对；401清空当前页面私有内容；并发详情/通知共享一次登录。通知503不阻断订单，通知401使整个组合结果失效。
- 未确认的payment/refund只要其持久任务MANUAL，用户显示待核查；已CONFIRMED成功不被遗留MANUAL任务误标为处理中。

## 实际验证

- 完整CI：142 passed、0 failed、0 skipped，包含PostgreSQL。逐断言见evidence/tests-u1.json。
- U1数据库断言：22条同时间订单稳定分页、本人游标、他人订单详情/付款/取消拒绝；退款申请后仍REVIEWING；付款/退款任务MANUAL的显示；确认成功后遗留任务不覆盖成功展示。
- 客户端断言：清缓存找回、路由ID优先、旧会话迟到200拒绝、并发登录、收银台取消后原单续付、演示构建也不模拟微信交易、通知故障与会话失效。
- 全仓类型检查通过；API独立编译、无旧dist重新生成weapp；prod依赖发布包已在纯Node中启动API/事件worker。最后履约异常显示修复的api-fulfillment-display已通过纯Node API/worker启动验证；224项生成产物摘要见evidence/artifacts-u1.json（不含IDE本地工程配置）。
- 文案/diff检查通过。敏感扫描曾匹配新增测试号码和token变量的函数赋值；改用既有合成号码与明确authToken变量后通过，没有修改扫描规则；命名与样例调整后45项受影响测试通过。
- 已在微信开发者工具Stable 2.01.2510290使用测试号、不使用云服务导入临时构建目录，项目fanju-local-u1。用户已明确允许“运行这份本地测试包”；模拟器启动成功，首页与“我的订单”入口可见。占位API域名被合法域名校验拦截，故只确认导入/渲染，不声称业务联调成功；未点击触发微信登录的订单按钮，未作真机、上传或发布。

## 复核

review-last-fixes.log指出退款任务耗尽后仍显示处理中，接受修复：按refund业务键读取MANUAL任务，确认成功优先。30项API数据库回归通过。review-u1-final.log发现退款通知不提供currency而被公共解密校验拒绝，接受修复：支付继续要求CNY，退款允许省略currency但拒绝显式非CNY，并保留原CNY收款、商户、签名、金额及预算关联校验。官方四字段退款样例通过签名、落盘、应答及数据库异步应用测试；新增支付缺币种/非CNY与退款非CNY拒绝断言。37项定向及141项完整CI通过。review-refund-protocol.log退出1，发现已确认收款但履约待核查仍显示待付款，接受修复：按本订单receipt关联未结案履约待办，paymentState返回REQUIRES_REVIEW，现有页面禁用续付；正常履约确认成功仍忽略旧MANUAL任务。31项数据库回归及142项全量CI通过，review-fulfillment-display.log最终退出0，未发现仍需修复的问题；复核自身执行60项测试，未重跑数据库、全量构建或设备验证。本次主实施的142项全量CI包含真实PostgreSQL，二者证据分开记录。新断言初次因合成结案fixture缺独立复核人触发数据库约束，补全复核证据后通过，未降低约束。

源HEAD仍bc25f5b，代码未提交，以evidence/source-manifest.json识别当前源码，不能用HEAD代表新实现。最终命令和产物摘要在同目录保存。

## 尚未完成与回退

L1待付到期/待付取消/历史重报仍待专项确认；L2取消政策与成团/退款恢复仍open。U1沿用现有取消条件，未代替L2政策验收。开发者工具首页渲染通过，联通后端的模拟器业务验收与真机验收未完成。G1、真实联调、收费和发布均未放行。

回退仅撤销本包app.ts订单读接口增量、miniapp API/页面及路由入口，保留A1/A2资金实现和用户原有改动；无数据库回退，不删除资金记录，不reset/clean。旧客户端不使用新列表接口仍可访问原详情和付款兼容路径。

协议依据：[微信支付国内退款通知](https://pay.weixin.qq.com/wiki/doc/apiv3/apis/chapter3_5_11.shtml)，amount含total/refund/payer_total/payer_refund，不含currency。纯Node发布包验证使用合成配置且停止新收费，无真实微信请求。pnpm deploy的可选tsc/tsserver bin与React类型peer告警仍存在；不影响本次Node产物启动，不据此宣称依赖风险消失。

最终复核证据：evidence/review-final.json。A2/U1本地交付已具备复核材料；不代替项目负责人签收或G1放行。待用户回复既有L1专项确认后继续到期/取消/重报及有效订单约束实施；不重复发起审批。
