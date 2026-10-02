# S1b 受控管理员与会话设计

2026-09-29：用户明确选择“采用受控本地管理员账号”，并授权继续整改实施。本包只实现本地能力、测试和配置说明；没有创建真实账号、读取真实凭证或对外部署。

## 契约

- 保留身份、手机号和资金既有路径。新增 `POST /api/ops/login`（username/password），严格拒绝客户端 role 等额外字段。只有配置受控账号且关闭本地演示时注册。
- 服务端通过 `OPS_ACCOUNTS_JSON` 注入账号数组：username、role（OPS/SUPER_ADMIN）、passwordHash、version、enabled。数据库只保存已有 AdminUser；不新增 schema、不存明文密码。role 由服务端配置决定；成功校验后短事务更新 AdminUser 和成功登录审计。
- 密码摘要格式 `scrypt:<16字节随机salt的hex文本>:<64字节摘要hex>`；scrypt 参数 N=16384/r=8/p=1（Node 默认值），salt 输入为32位hex字符串。`scripts/hash-admin-password.mjs` 从终端隐藏输入生成摘要，不能通过命令行参数传密码。真实账号清单必须保存在仓库外 Secret。
- 不配置账号则运营 API 继续关闭。显式演示不得与正式账号配置共存；生产编译的前端没有演示按钮或自动演示登录。
- 按直接连接 IP 和账号分别限制每15分钟10次尝试，最多4个并行 scrypt；请求字段限长，限速表最多10000项，过期清理。单机内存限速不跨实例；上线多副本必须由入口代理另加共享限速，不能把此限制称为全局防护。

## 会话

- 用户期限1小时，管理员15分钟。所有 token 必须带 exp/iat、发行方（fanju:APP_ENV）、正确 audience、sessionVersion。旧无期限 token 失效。只接受 HS256。
- 非演示环境强制至少32字符 SESSION_SECRET，拒绝已知开发/占位密钥。推荐48字节随机值由 Secret 服务注入；不得出现在前端、Git、日志。
- SESSION_VERSION 变更撤销全部会话；SESSION_REVOKED_SUBJECTS 按内部 subject ID 撤销。配置为进程启动快照：操作必须覆盖所有 API 实例并排空旧实例，未完成全实例更新前不能声称撤销已传播。
- 每次用户请求核实账号存在；黑名单仍由报名服务限制新报名，不遮断历史订单、退款和申诉权利。
- 每次运营请求读当前 AdminUser，核对角色及 updatedAt 快照；受控账号还核对配置 enabled/role/version。删除、降权、修改账号后旧 token 不再通过。密码变更须增加 account version 并更新全部实例；新登录也更新数据库 revision。
- 前端 token 仅驻留运营页面内存。401 清除会话、重新显示登录，保留当前页面/输入上下文，不自动重放高风险操作。小程序换用新会话缓存键，401 移除 token，保留订单恢复上下文。

## 配置与回退

通过进程环境/部署 Secret 注入；不假定根 .env 自动加载。账号 JSON 格式示意（不含可用密码摘要）：

```json
[{"username":"operator","role":"OPS","passwordHash":"<由隐藏输入工具生成>","version":"1","enabled":true}]
```

禁用账号：enabled=false 或移除账号、增加 account version、更新所有 API 实例；紧急全撤销同时轮换密钥/SESSION_VERSION。受控管理员身份变化必须写明变更人和审批，不能直接编辑用户 token。

本地回退仅还原本包 diff，S1a 的默认关闭策略保留；不能回退到接受旧无期限 token/默认生产密钥的版本。尚无已发布新 SHA，不宣称生产回退演练通过。多实例限速、HTTPS、密钥轮换和实际账号配发仍属于部署验收。
