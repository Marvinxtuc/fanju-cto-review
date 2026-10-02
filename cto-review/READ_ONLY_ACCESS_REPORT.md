# 外部只读审核实际结果

任务包四个SHA256摘要全部匹配。审查方此前Cache miss/DNS失败保持NOT_VERIFIED_REVIEW_ACCESS，不诊断成后台宕机或密码错误。

## 当前验证边界

- 本机浏览器经公网HTTPS：实际登录受控工作台及旧App、读取合成供给/正式报名与资料权利记录 PASS；安全请求索引 BROWSER_REQUEST_INDEX.json 表明 /api/v11/* 请求发往公网同origin，未发往访客localhost。截图为 CONTROLLED_PUBLIC_BROWSER.jpg 和 LEGACY_PUBLIC_BROWSER.jpg。
- 非本机浏览器/不同网络：NOT_VERIFIED。当前可用浏览器工具运行在本Mac，不能将它冒充远端客户端。未取得独立远端浏览器目标或审查方成功访问证据。
- 此HTTPS为Cloudflare临时隧道；固定staging未部署，无可用性保证。浏览器/响应、源码与审查方独立结果分别记录。

## 网关认证与只读保护

URL随机引导凭据仅在仓库外0600私有文件。/entry 设置独立随机 Secure/HttpOnly/SameSite=Strict Cookie并303到无token路径，Referrer-Policy:no-referrer、Cache-Control:no-store；报告/ZIP均无token、password、Cookie、Authorization或原始HAR/storageState。

业务API必须同时通过网关session与本session登录签发的Bearer。登录只接受已指定合成审核账号；跨session Bearer、跨origin、跨site均拒绝。身份/访问审计独立于业务资金状态。网关和API上游仅loopback，不公开数据库/日志/secret目录。

GET不是默认放行：按规范化method+exact route白名单转发；未知GET、渠道query/入队路径、业务POST/PUT/PATCH/DELETE均拒绝。认证仅两条POST login例外，logout只撤销审核session。资源静态路径只来自固定构建文件清单。

受控源码原credentials:omit不变。审核层只对本origin /api/ 请求装配same-origin credentials适配，搭配原Bearer；不修改全局生产CORS、不传token到API URL、不对任意跨origin设置include。冻结JS的明确loopback base在审核输出层替换为window.location.origin，原静态构建hash与变换均登记。prelaunch loopback模拟工作区不对外启用。

服务端每请求检查过期与revoked配置，entry凭据轮换立即废止旧session。旧v1代理已停止，其旧引导链接不再有效。本次临时审核结束后须将仓库外revoked=true并核验410；新会话/账号不得迁往生产。此次审核仍进行，未虚构其已结束；独立clone已验证实时撤销。

10项原生负测（含下载保护）证据见 GATEWAY_REVIEW.md / GATEWAY_NEGATIVE_RESULT.json。仅隔离clone+fake upstream，不向共享审核入口业务写入。业务state前后hash一致，控制请求验证观察有效。初次harness断言失败原始日志保留；修复只涉及测试HTTP规范化与预期。

## 入口版本

默认外链现在展示审核导航，workspace=legacy为旧Order，workspace=controlled为新独立CI_TEST数据库的拟发布formal主handler+内存身份/渠道。测试政策授权与专业签收夹具仅synthetic，不能用于生产。生产身份、真实收付、收费、小程序发布均未启用。

## 独立网络增量

2026-10-02 05:13:15 UTC，腾讯云上海目标主机使用未认证Python HTTPS客户端访问审查入口。公共DNS解析成功，HTTPS返回401、Review session required。证据INDEPENDENT_NETWORK_CHECK.png，原生JSON远端evidence/independent-network-check.json。此为独立网络可达及认证边界证据，不是非本机浏览器登录/业务请求验证；后者仍NOT_VERIFIED。
