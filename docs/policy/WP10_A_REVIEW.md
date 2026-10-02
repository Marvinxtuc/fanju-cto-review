# FJ-WP10-A 执行与代码验收报告

日期：2026-09-30
状态：本地实现及限定验证完成；等待人工代码级验收。
政策启用状态：**NOT_ACTIVATABLE**。

## 1. 批准依据与实际工作区

用户明确批准 FJ-WP10-A「本地政策束完整性与启用资格检查」，并声明 FJ-POLICY-GAP-01 人工审核 PASS。该 PASS 是本包实施依据，不能继承为正式政策启用或新业务上线证明。

批准依据：

- [POLICY_GAP_ANALYSIS.md](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/POLICY_GAP_ANALYSIS.md)
- [POLICY_DECISION_PROPOSALS.md](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/POLICY_DECISION_PROPOSALS.md)
- [POLICY_TECH_DESIGN.md](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/POLICY_TECH_DESIGN.md)
- [POLICY_WORK_PACKAGES.md](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/POLICY_WORK_PACKAGES.md)

| 项目 | 实际值 |
| --- | --- |
| 工作区 | /Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局 |
| 分支 | codex/fanju-stage0-baseline |
| HEAD | 7dfae5db3e6d882b6fb3154065f57327e4a08fe3 |
| 开始时未提交内容 | `?? docs/policy/`，共 18 份既有政策输入与分析文件 |
| 执行中 Git 操作 | 只读；未切分支、切历史提交、stage、commit 或 push |

当前实施基于已有整改工作树；旧目录 /Users/marvin.x/Documents/饭局 未修改。

## 2. 实际新增文件及目的

| 文件 | 本次动作 | 目的 |
| --- | --- | --- |
| [policyBundle.ts](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/policyBundle.ts) | 新增，319 行 | 固定政策束的纯本地同步校验、错误分类和启用阻断 |
| [policyBundle.test.ts](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared/src/rules/policyBundle.test.ts) | 新增，340 行 | 实际本地政策夹具及 52 项完整性、安全和输入不变断言 |
| [WP10_A_REVIEW.md](/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/docs/policy/WP10_A_REVIEW.md) | 新增，259 行 | 授权边界、契约、差异、测试证据与限制 |

未修改现有公共 `packages/shared/src/index.ts`；本模块只在新增文件中导出类型和函数，现有业务不引用它。

## 3. Validator 输入契约

入口：

```ts
validatePolicyBundle(input: unknown): PolicyBundleValidation
```

调用者传入被动的 JSON 形状 DTO；推荐由 JSON 解析得到普通数据。模块接受普通对象或无原型数据对象及标准密集数组，拒绝对象和数组 getter、稀疏数组，以及数组额外属性和数组 Symbol。任意 live JavaScript Proxy 不属于契约范围；该模块不是 JavaScript 隔离执行沙箱。

| 输入字段 | 结构与检查 |
| --- | --- |
| bundleId / bundleVersion / documentStatus | 必须分别等于固定包 ID、V1.0、REBASED_DRAFT |
| baseline | `{ documentId, sha256, text }`；ID、声明摘要与内存重算摘要必须匹配固定基线 |
| ruleIds | 104 个显式规则 ID 的完整集合；缺失、重复、未知均拒绝 |
| documents | USER_AGREEMENT、PRIVACY_NOTICE、REFUND_POLICY 各一份 |
| 每份 document | `{ kind, documentId, version, bundleId, bundleVersion, documentStatus, sha256, text }`；所有标识、版本、状态和全文摘要固定核对 |
| openDecisions | OP-01—OP-15 各一次，`{ id, status: "OPEN" }` |
| specialReviews | RV-01—RV-07 各一次，`{ id, status: "REVIEW_REQUIRED" }` |

校验全文包括 Markdown 控制区，使用 Node 内建 SHA-256 按 UTF-8 重算；不 trim、不换行归一化，也不只信任输入声明的 hash。单份 text 最多 1,048,576 个 JavaScript 字符；规则/OP/RV 数组最多 208 个成员，正文数组最多 6 个成员，然后按固定集合核验。

可信预期值是模块私有常量，不接受调用者传入的 trustedManifest 或 expectedHash。JSON 字段中的 `approved`、`approval`、`approvalEvidence` 被归类为 UNTRUSTED_APPROVAL；旧 Gate/AgreementPolicy 声明归类为 LEGACY_EVIDENCE_NOT_APPLICABLE；其他未知 JSON 字段被拒绝。

### 固定批准输入

统一包 ID：`FJ-POLICY-V1.0-20260930-REBASE-01`；版本：`V1.0`；文本状态：`REBASED_DRAFT`。这里「批准输入」仅指本地分析/实施所用固定材料。

| 材料 | 固定文档 ID | SHA-256（全文） |
| --- | --- | --- |
| BUSINESS_RULES_BASELINE | FJ-BUSINESS-BASELINE-20260930-V1.0 | 48357a92e9d84e816f84948149363834746c3cfd9d1936df228c7ae280f0c187 |
| USER_AGREEMENT | FJ-UA-V1.0-20260930-REBASE-01 | daa90ce2e21e5b421c7b1a5303fe5a2a0b7e0245e131d0d748ac990b9b935599 |
| PRIVACY_NOTICE | FJ-PN-V1.0-20260930-REBASE-01 | ecf1a9ffbe7a54b71c9291cacb36d12e0d6b47657cf6b9386789c9b1cb5fe912 |
| REFUND_POLICY | FJ-RF-V1.0-20260930-REBASE-01 | 4fddec3eb1a3a74f1de94d49385ef8d1c5f1ea16c7f14293b5526fa1daf8e93e |

规则清单按固定前缀与序号生成：BAS 3、USR 10、FEE 4、VEN 8、FORM 16、WL 10、INFO 3、REF 8、FUL 9、DISP 15、EXC 4、CHG 7、OPS 3、PRI 4，共 104 个。编号格式为 `PREFIX-01` 起的连续两位序号。本地正常夹具使用原 TRACEABILITY_INDEX.json 中的 ID，而非复用模块生成器。

## 4. Validator 输出契约

```ts
{
  integrity: "VALID" | "INVALID",
  activation: "NOT_ACTIVATABLE",
  issues: Array<{
    code: PolicyIssueCode,
    field: "bundle" | "baseline" | "ruleIds" | "documents"
      | "openDecisions" | "specialReviews",
    index?: number,
    expectedId?: string
  }>,
  activationBlockers: [
    "WP10_A_HAS_NO_ACTIVATION_AUTHORITY",
    "PINNED_BUNDLE_IS_REBASED_DRAFT",
    "OPEN_DECISIONS_REMAIN",
    "SPECIAL_REVIEWS_REQUIRED"
  ]
}
```

- 完整匹配的草案返回 `integrity: "VALID"`、空 issues，同时仍为 `NOT_ACTIVATABLE`。
- 缺项、混用、内容变化、伪造审批或旧门禁声明返回 `integrity: "INVALID"`；activation 同样不可启用。
- 输出仅含固定错误码、固定字段、数字索引以及缺失项的固定白名单 ID；不回显候选正文、hash、未知键名、未知 ID、Secret 或用户材料。
- 校验只使用局部集合和内存哈希；不修改输入、不排序输入、不读取文件/环境/时钟、不调用 DB/API/资金/外部网络、不写日志。
- 测试代码为构造夹具读取本地政策文件；validator 本身不执行文件读取。
- 四项 blockers 为本包固定拒绝启用原因，并非根据调用者声明推导出的审批结论。

## 5. 验证命令与最终结果

工作目录：`/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared`。

```sh
pnpm exec vitest run src/rules/policyBundle.test.ts --no-cache --reporter=verbose --no-file-parallelism
pnpm typecheck
```

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| policyBundle 单元测试 | **52 passed / 0 failed / 0 skipped** | Vitest v4.1.9；1 个测试文件；最终执行退出码 0 |
| packages/shared typecheck | **PASS** | `tsc -p tsconfig.json --noEmit`，退出码 0 |
| 新文件 diff 审阅及空白检查 | PASS | 对未跟踪新增文件执行 `git diff --no-index`；未发现空白问题 |
| git diff --stat / git diff --cached --stat | 无输出 | 原有跟踪文件和暂存区均无差异；新增文件未 stage |
| git status --short | 已核对 | 见第 7 节 |
| 既有 18 份政策文件 SHA-256 | **18/18 不变** | 与实施开始时记录逐一比较，无修改文件 |
| DB 测试 / migration / 真实构建 / 真实渠道 | **NOT_RUN** | 用户本轮明确禁止，未执行 |

shared 的既有 tsconfig 排除 `*.test.ts`；typecheck 验证新增 validator 和 shared 既有生产源文件。测试文件由 Vitest 转译执行，不将此结果表述为测试文件全部经过独立 tsc 检查。

### 全部 52 项测试结果

下列名称保留最终 Vitest 输出原文。每项均 passed，无 failed 或 skipped。

| 序号 | 测试名称 | 结果 |
| --- | --- | --- |
| 1 | accepts the complete imported bundle as valid integrity, with all 104 rules, 15 OP and 7 RV | passed |
| 2 | rejects a missing user body: USER_AGREEMENT | passed |
| 3 | rejects a missing user body: PRIVACY_NOTICE | passed |
| 4 | rejects a missing user body: REFUND_POLICY | passed |
| 5 | rejects a declared body hash inconsistent with its full text | passed |
| 6 | rejects changed full text even when the original declared hash is retained | passed |
| 7 | rejects edited text with a newly recomputed candidate hash instead of trusting candidate expectations | passed |
| 8 | does not normalize full text or line endings before hashing | passed |
| 9 | rejects a baseline hash inconsistent with the pinned approved input | passed |
| 10 | rejects edited baseline bytes with a candidate-supplied matching hash | passed |
| 11 | rejects a mismatched baseline document ID | passed |
| 12 | rejects a missing Rule ID | passed |
| 13 | rejects duplicate Rule IDs even with exactly 104 entries | passed |
| 14 | rejects unknown Rule IDs even with exactly 104 entries | passed |
| 15 | accepts reordered complete identities without sorting or changing input | passed |
| 16 | rejects a missing OP | passed |
| 17 | rejects a missing RV | passed |
| 18 | rejects an OP forged as Approved | passed |
| 19 | rejects an RV forged as Approved | passed |
| 20 | rejects duplicated and unknown OP identities | passed |
| 21 | rejects duplicated and unknown RV identities | passed |
| 22 | rejects a mixed top-level bundle version | passed |
| 23 | rejects a mixed top-level bundle ID | passed |
| 24 | rejects a user body from a different bundle | passed |
| 25 | rejects a mixed user-body bundle version | passed |
| 26 | rejects a mixed document version | passed |
| 27 | rejects a mixed document ID despite correct body bytes | passed |
| 28 | rejects duplicate and unknown user-body identities | passed |
| 29 | keeps REBASED_DRAFT not activatable even when every text/hash is correct | passed |
| 30 | rejects a forged non-draft bundle status | passed |
| 31 | rejects a forged non-draft body status | passed |
| 32 | cannot forge approval by passing approved=true or approvalEvidence | passed |
| 33 | rejects nested approval claims instead of accepting a new trust source | passed |
| 34 | does not inherit a legacy Gate PASS | passed |
| 35 | does not inherit a legacy single AgreementPolicy | passed |
| 36 | does not let candidates supply their own trusted manifest | passed |
| 37 | returns only fixed codes, fields, indexes and pinned missing IDs, never secret or user data | passed |
| 38 | is deterministic and does not mutate deeply frozen valid input | passed |
| 39 | does not mutate deeply frozen invalid input | passed |
| 40 | rejects malformed top-level input #0 | passed |
| 41 | rejects malformed top-level input #1 | passed |
| 42 | rejects malformed top-level input #2 | passed |
| 43 | rejects malformed top-level input #3 | passed |
| 44 | rejects malformed top-level input #4 | passed |
| 45 | rejects malformed top-level input #5 | passed |
| 46 | rejects malformed or oversized collections and invalid text types | passed |
| 47 | rejects candidate getters without invoking them | passed |
| 48 | rejects ruleIds array index getters without invoking them | passed |
| 49 | rejects documents array index getters without invoking them | passed |
| 50 | rejects openDecisions array index getters without invoking them | passed |
| 51 | rejects specialReviews array index getters without invoking them | passed |
| 52 | rejects sparse arrays and non-JSON array properties | passed |

### 执行中发现并修复的问题

1. 初版 47 项测试通过，shared typecheck 出现 TS2591：Node 类型未被 TypeScript 自动加载。仅在新增源文件添加 `/// <reference types="node" />`，使用仓库已有 Node 类型，未修改依赖或配置；之后 47 项及 typecheck 通过。
2. 只读复核发现数组索引 getter 在读取前缺少统一防护。新增 dataArray 描述符校验及 5 项测试。首次防护表达式错误导致普通数组被拒绝，出现 26 passed / 26 failed。
3. 修正防护实现，保留原断言和新增断言，最终 **52/52 passed，shared typecheck PASS**。
4. 最终只读复核确认此前数组 getter 问题已修复，未发现新的本包阻塞项。复核代理未写文件、未运行测试；测试通过依据是主执行记录，人工代码级验收仍待用户完成。

## 6. 用户要求逐项对应

| 要求 | 实际实现 / 证据 |
| --- | --- |
| 基线 hash 匹配固定输入 | BASELINE_ID / BASELINE_HASH 私有常量及正文重算；测试 9—11 |
| 104 Rule ID 无缺失、重复、未知 | RULE_IDS 固定集合及 checkIds；测试 1、12—15 |
| 三份用户正文完整一致 | DOCUMENTS 固定集合、正文逐项检查；测试 1—8、24—28 |
| 文档 ID、版本、全文摘要、包版本不可混用 | 顶层与逐文档固定核验；测试 22—28 |
| 15 OP 保持 OPEN | checkIds + OP_STATUS_MISMATCH；测试 16、18、20 |
| 7 RV 保持 REVIEW_REQUIRED | checkIds + RV_STATUS_MISMATCH；测试 17、19、21 |
| approved=true 不能伪造批准 | UNTRUSTED_APPROVAL 且 activation 固定不可启用；测试 32—33 |
| REBASED_DRAFT 即使 hash 正确仍不可启用 | activation 与固定 blockers；测试 1、29—31 |
| 旧 AgreementPolicy / Gate PASS 不继承 | LEGACY_EVIDENCE_NOT_APPLICABLE；测试 34—36 |
| 不调用 DB/API/资金/网络 | 源码仅导入 Node 内建 crypto；未接入运行时 |
| 不修改输入 | 无写入/原地排序；深冻结有效/无效输入测试 38—39 |
| 错误不含 Secret 或用户数据 | 固定结构、合成敏感值不回显；测试 37 |
| 不执行输入 getter | 对象和数组描述符防护；测试 47—52 |

## 7. Git 差异与范围复核

普通 `git diff --stat` 和 `git diff --cached --stat` 无输出，因为三份新增文件保持未跟踪，未为统计而 stage。

为展示未跟踪文件，逐文件执行：

```sh
git diff --no-index --stat -- /dev/null packages/shared/src/rules/policyBundle.ts
git diff --no-index --stat -- /dev/null packages/shared/src/rules/policyBundle.test.ts
git diff --no-index --stat -- /dev/null docs/policy/WP10_A_REVIEW.md
```

每条 no-index 差异命令返回 1，表示发现新文件差异，属于预期结果。以下为三条统计的任务汇总：

```text
packages/shared/src/rules/policyBundle.ts       | 319 +
packages/shared/src/rules/policyBundle.test.ts  | 340 +
docs/policy/WP10_A_REVIEW.md                    | 259 +
3 files changed, 918 insertions(+)
```

最终 `git status --short`：

```text
?? docs/policy/
?? packages/shared/src/rules/policyBundle.test.ts
?? packages/shared/src/rules/policyBundle.ts
```

docs/policy/ 包含原 18 份未跟踪文件及本轮新增报告；原 18 份 SHA-256 均保持不变。状态中的目录行不能解读为本轮新增全部政策材料。

最终源文件摘要：

| 文件 | SHA-256 |
| --- | --- |
| policyBundle.ts | ce5fa6c69555de62adba71c32efcfaf07a588358ec659fa2c695a8e034086ada |
| policyBundle.test.ts | 8f20df9922d0effb98e8c182412c5912227981ba0e178ac11b7a2d3fe4331a0f |

**是否触及授权范围外文件：否。** 未修改 Schema、migration、API、worker、支付/退款/保证金、订单/候补/成团状态机、前端、现有政策正文、AgreementPolicy、依赖、运行配置或其他跟踪文件。未激活政策、调用真实微信/支付/退款、部署、提交或推送。

## 8. 剩余问题与回退范围

- 人工代码级验收待用户完成；本报告不代替验收结论。
- 本校验器固定对应当前 REBASED_DRAFT，无可信审批接入和运行时启用控制；业务不会自动调用它。未来版本/可信批准/持久化/API 接入必须单独授权。
- 15 OP 保持 OPEN，7 RV 保持 REVIEW_REQUIRED；未填补业务答案、未代签正式协议或餐厅保障。
- 使用 Node 内建 crypto，仅验证本地 Node 执行场景；未承诺小程序或浏览器直接运行，未做构建验证。
- 输入须为被动 JSON 数据；live Proxy 的任意代码执行不属于本包保护范围。
- 104 ID 集合完整只证明本包索引完整，不证明对应业务代码已经实现或验收。
- 回退对象仅为本次新增的三份文件。撤销前核对本文源摘要及文件是否有后续修改，由有权限者撤销本次新增内容；不执行 reset/clean，不覆盖既有政策材料或用户工作。本轮未执行删除或回退。

**WP10-A 到此停止。未进入 WP10-B 或其他工作包。**
