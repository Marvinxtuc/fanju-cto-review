# FJ-WP10-A1 执行与验收报告

## 1. 结论

**历史V1.0夹具隔离已完成；原生Vitest原52项全部通过，shared typecheck通过。** 本轮等待人工代码验收，没有启用V1.1或开始其他工作包。

| 项目 | 实际记录 |
| --- | --- |
| 任务 / 状态 | FJ-WP10-A1 / IMPLEMENTED_LOCAL_VERIFICATION_PASSED；PENDING_HUMAN_ACCEPTANCE |
| 授权 | 用户下发FJ_WP10_A1_FIXTURE_ISOLATION_TASK.md并明确要求执行；只允许其8个仓库路径 |
| 验收输入 | FJ_POLICY_V1_1_ACCEPTANCE_20261001.md：文档PASS_DOCUMENT_REBASE，V11-F01为限定跟进 |
| 工作区 | /Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局 |
| 分支 | codex/fanju-stage0-baseline |
| 起始 / 结束HEAD | 003200820922d11b374b84a9e756d4d763bea3f2 |
| 历史字节来源 | b47c0fefb3c4392a742696fc8f14004c011313e1，先校验再git show读取，未checkout |
| 改动 | 1个tracked测试文件修改，7个untracked新增文件；最多且正好8个白名单路径 |
| 生产源码/配置 | 未修改policyBundle.ts、public index、依赖、tsconfig、Vitest配置、Schema、API、worker、前端或资金/业务逻辑 |
| 本轮禁止事项 | 未执行DB、migration、业务构建、真实微信/资金/餐厅转账、部署、Git stage/commit/push/checkout/reset/clean/stash |
| 政策资格 | V1.1仍REBASED_DRAFT / NOT_ACTIVATABLE；本轮不提供V1.1支持或激活器 |

记录时间：2026-10-01T05:40:31.126754+08:00（Asia/Shanghai）。

## 2. 起始dirty保留

起始已有V1.1文档改动：11 tracked修改、5 untracked新增，共16个路径。它们是上一轮成果，不计入WP10-A1增量；当前24份既有docs/policy文件逐字节保留，仅新增本报告。

起始git status --short：

```text
 M docs/policy/BUSINESS_RULES_BASELINE.md
 M docs/policy/OPEN_DECISION_REVIEW.md
 M docs/policy/POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md
 M docs/policy/POLICY_TECH_DESIGN.md
 M docs/policy/POLICY_WORK_PACKAGES.md
 M docs/policy/PRIVACY_NOTICE.md
 M docs/policy/README.md
 M docs/policy/REFUND_POLICY.md
 M docs/policy/RESTAURANT_SERVICE_STANDARD.md
 M docs/policy/TRACEABILITY_INDEX.json
 M docs/policy/USER_AGREEMENT.md
?? docs/policy/POLICY_REBASE_V1_1_CHANGELOG.md
?? docs/policy/POLICY_V1_1_BUNDLE_MANIFEST.json
?? docs/policy/POLICY_V1_1_CONSISTENCY_REPORT.md
?? docs/policy/SHA256SUMS_V1_1.txt
?? docs/policy/sources/FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md
```

起始dirty文件摘要（本轮前后均相同）：

| 路径 | 起始SHA-256 | 本轮处理 |
| --- | --- | --- |
| `docs/policy/BUSINESS_RULES_BASELINE.md` | `38f06f87684d2aee70dd8853391085af22da399cbdd5e2771b26ba54925376ec` | 原字节保留，非本轮新增 |
| `docs/policy/OPEN_DECISION_REVIEW.md` | `7e1b177698826d117a64c8d2de7552db287e79bde32f998150786d648a422965` | 原字节保留，非本轮新增 |
| `docs/policy/POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md` | `41ca1f220f61ec8ddbb83ce8809be088a8944787e0276c6742f6044f1b654505` | 原字节保留，非本轮新增 |
| `docs/policy/POLICY_REBASE_V1_1_CHANGELOG.md` | `0548ac0a7d9472326e475990e75de64ecaf5423b09672f9764a5c73044f1d7aa` | 原字节保留，非本轮新增 |
| `docs/policy/POLICY_TECH_DESIGN.md` | `899b43dcae7d519810c1f73520c49df311aec82dc533ff5339c941f29ce0e002` | 原字节保留，非本轮新增 |
| `docs/policy/POLICY_V1_1_BUNDLE_MANIFEST.json` | `64b0f33a18ee98095b838dab0271b6974e93a29f065fba8d356c9de164f0c8c9` | 原字节保留，非本轮新增 |
| `docs/policy/POLICY_V1_1_CONSISTENCY_REPORT.md` | `9f0e0a0b57c23676ffa34433e13bd327132d7bd096f0e4670ad427c68346c058` | 原字节保留，非本轮新增 |
| `docs/policy/POLICY_WORK_PACKAGES.md` | `fb5ec4dde5b44c89a3c0cccc40002508e03955296ee8270ba15c36194c854b09` | 原字节保留，非本轮新增 |
| `docs/policy/PRIVACY_NOTICE.md` | `2d7a4b00404a07fed3b27f2526718224b58c3ec5e4027146ee4e8e8847ec7b40` | 原字节保留，非本轮新增 |
| `docs/policy/README.md` | `f85c36facadfeb527661fd22b1be03013a0237f81355facc321204979d7e4516` | 原字节保留，非本轮新增 |
| `docs/policy/REFUND_POLICY.md` | `c5b1207fde76a3d853df4eaac56b58ca8bdad5e2f20cb3f0d539071b7c4003d7` | 原字节保留，非本轮新增 |
| `docs/policy/RESTAURANT_SERVICE_STANDARD.md` | `9b7b679f0669e08cdcaa5a1b0a6ac882534592da17fca3e7136f3d1a3eec1761` | 原字节保留，非本轮新增 |
| `docs/policy/SHA256SUMS_V1_1.txt` | `c2982d2c7f0af730c544f8893da1e110d675b2652fff0ae540a22dfe36465435` | 原字节保留，非本轮新增 |
| `docs/policy/TRACEABILITY_INDEX.json` | `5b60aecc60afd049a48be1630726277bb25254741b7e1bb01d384450941073f0` | 原字节保留，非本轮新增 |
| `docs/policy/USER_AGREEMENT.md` | `68c4823f2650ccd6afb7ad722c9235043c89d965aeadcd8f8218c04e451ddbc2` | 原字节保留，非本轮新增 |
| `docs/policy/sources/FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md` | `0268f125663f3a31f9ebb0c8c49870bb2f3df9d47776e2c54439f162b1508743` | 原字节保留，非本轮新增 |

## 3. 实际修改文件（仅授权8路径）

| 文件 | Git状态 / 动作 | 用途 |
| --- | --- | --- |
| packages/shared/src/rules/policyBundle.test.ts | tracked修改 | policyRoot改为测试文件旁固定V1.0夹具；仅补历史范围注释 |
| packages/shared/src/rules/__fixtures__/policy-v1.0/BUSINESS_RULES_BASELINE.md | untracked新增 | V1.0归档原字节 |
| packages/shared/src/rules/__fixtures__/policy-v1.0/USER_AGREEMENT.md | untracked新增 | V1.0归档原字节 |
| packages/shared/src/rules/__fixtures__/policy-v1.0/PRIVACY_NOTICE.md | untracked新增 | V1.0归档原字节 |
| packages/shared/src/rules/__fixtures__/policy-v1.0/REFUND_POLICY.md | untracked新增 | V1.0归档原字节 |
| packages/shared/src/rules/__fixtures__/policy-v1.0/TRACEABILITY_INDEX.json | untracked新增 | V1.0归档原字节与历史OP/RV |
| packages/shared/src/rules/__fixtures__/policy-v1.0/SHA256SUMS | untracked新增 | 五份原字节的实际摘要 |
| docs/policy/WP10_A1_REVIEW.md | untracked新增 | 本执行报告；不进入冻结V1.1 manifest/清单 |

历史夹具是测试输入，不是正式政策或运行配置。历史15项OP=OPEN、7项RV=REVIEW_REQUIRED保留正例事实；当前V1.1的3 CLOSED/4 PARTIALLY_CLOSED/8 OPEN没有被改回。夹具未加入公共index，不创建运行时注册或加载平台。

## 4. 历史原字节核验

所有文件从已核验归档提交读取，不从当前V1.1倒改、不只换版本字符串、不改旧validator固定值。

| 历史文件 | 字节 | 必须匹配且实际匹配的SHA-256 | 结果 |
| --- | --- | --- | --- |
| BUSINESS_RULES_BASELINE.md | 109433 | `48357a92e9d84e816f84948149363834746c3cfd9d1936df228c7ae280f0c187` | MATCH |
| USER_AGREEMENT.md | 21060 | `daa90ce2e21e5b421c7b1a5303fe5a2a0b7e0245e131d0d748ac990b9b935599` | MATCH |
| PRIVACY_NOTICE.md | 19725 | `ecf1a9ffbe7a54b71c9291cacb36d12e0d6b47657cf6b9386789c9b1cb5fe912` | MATCH |
| REFUND_POLICY.md | 18481 | `4fddec3eb1a3a74f1de94d49385ef8d1c5f1ea16c7f14293b5526fa1daf8e93e` | MATCH |
| TRACEABILITY_INDEX.json | 64116 | `f7792323105aad37b4f9fc20c7054657f7dbf458488d91c06dfaf6961be34dba` | MATCH |

历史SHA256SUMS在夹具目录内用shasum -a 256 -c SHA256SUMS验证：5/5 OK，退出码0。

## 5. 原52项原生Vitest结果

安全检查：shared/package.json的typecheck直接调用tsc，没有pre/post hook。指定pnpm exec不执行根test脚本；仓库没有Vitest配置/全局setup。test仅导入node:crypto、node:fs、vitest和未变的policyBundle模块。根test/typecheck含prepare:test/Prisma路径，本轮没有调用。

工作目录：/Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared

命令：

```bash
pnpm exec vitest run src/rules/policyBundle.test.ts --no-cache --reporter=verbose --no-file-parallelism
```

| 环境/结果 | 实测 |
| --- | --- |
| Node / pnpm / Vitest | v22.23.1 / 9.15.9 / v4.1.9 |
| 原生用例 | 52 passed / 0 failed / 0 skipped / 0 todo |
| 测试文件 | 1 passed，指定policyBundle.test.ts |
| 退出码 | 0 |
| runner结果 | Tests 52 passed (52)，Duration 184ms，tests 21ms |
| 原用例数量来源 | 37普通it + 四组it.each展开3/2/6/4，共52 |
| 替代适配器 | 未使用；实际由既有Vitest执行 |

### 5.1 每项原生测试

名称取自本次verbose输出，没有删减、skip或改变期望。

| 序号 | 原生测试名称 | 结果 |
| --- | --- | --- |
| 1 | accepts the complete imported bundle as valid integrity, with all 104 rules, 15 OP and 7 RV | PASSED |
| 2 | rejects a missing user body: USER_AGREEMENT | PASSED |
| 3 | rejects a missing user body: PRIVACY_NOTICE | PASSED |
| 4 | rejects a missing user body: REFUND_POLICY | PASSED |
| 5 | rejects a declared body hash inconsistent with its full text | PASSED |
| 6 | rejects changed full text even when the original declared hash is retained | PASSED |
| 7 | rejects edited text with a newly recomputed candidate hash instead of trusting candidate expectations | PASSED |
| 8 | does not normalize full text or line endings before hashing | PASSED |
| 9 | rejects a baseline hash inconsistent with the pinned approved input | PASSED |
| 10 | rejects edited baseline bytes with a candidate-supplied matching hash | PASSED |
| 11 | rejects a mismatched baseline document ID | PASSED |
| 12 | rejects a missing Rule ID | PASSED |
| 13 | rejects duplicate Rule IDs even with exactly 104 entries | PASSED |
| 14 | rejects unknown Rule IDs even with exactly 104 entries | PASSED |
| 15 | accepts reordered complete identities without sorting or changing input | PASSED |
| 16 | rejects a missing OP | PASSED |
| 17 | rejects a missing RV | PASSED |
| 18 | rejects an OP forged as Approved | PASSED |
| 19 | rejects an RV forged as Approved | PASSED |
| 20 | rejects duplicated and unknown OP identities | PASSED |
| 21 | rejects duplicated and unknown RV identities | PASSED |
| 22 | rejects a mixed top-level bundle version | PASSED |
| 23 | rejects a mixed top-level bundle ID | PASSED |
| 24 | rejects a user body from a different bundle | PASSED |
| 25 | rejects a mixed user-body bundle version | PASSED |
| 26 | rejects a mixed document version | PASSED |
| 27 | rejects a mixed document ID despite correct body bytes | PASSED |
| 28 | rejects duplicate and unknown user-body identities | PASSED |
| 29 | keeps REBASED_DRAFT not activatable even when every text/hash is correct | PASSED |
| 30 | rejects a forged non-draft bundle status | PASSED |
| 31 | rejects a forged non-draft body status | PASSED |
| 32 | cannot forge approval by passing approved=true or approvalEvidence | PASSED |
| 33 | rejects nested approval claims instead of accepting a new trust source | PASSED |
| 34 | does not inherit a legacy Gate PASS | PASSED |
| 35 | does not inherit a legacy single AgreementPolicy | PASSED |
| 36 | does not let candidates supply their own trusted manifest | PASSED |
| 37 | returns only fixed codes, fields, indexes and pinned missing IDs, never secret or user data | PASSED |
| 38 | is deterministic and does not mutate deeply frozen valid input | PASSED |
| 39 | does not mutate deeply frozen invalid input | PASSED |
| 40 | rejects malformed top-level input #0 | PASSED |
| 41 | rejects malformed top-level input #1 | PASSED |
| 42 | rejects malformed top-level input #2 | PASSED |
| 43 | rejects malformed top-level input #3 | PASSED |
| 44 | rejects malformed top-level input #4 | PASSED |
| 45 | rejects malformed top-level input #5 | PASSED |
| 46 | rejects malformed or oversized collections and invalid text types | PASSED |
| 47 | rejects candidate getters without invoking them | PASSED |
| 48 | rejects ruleIds array index getters without invoking them | PASSED |
| 49 | rejects documents array index getters without invoking them | PASSED |
| 50 | rejects openDecisions array index getters without invoking them | PASSED |
| 51 | rejects specialReviews array index getters without invoking them | PASSED |
| 52 | rejects sparse arrays and non-JSON array properties | PASSED |

## 6. shared typecheck

同一shared工作目录执行pnpm typecheck，实际展开tsc -p tsconfig.json --noEmit，退出码0。

```text

> @timeleft-shanghai/shared@0.0.0 typecheck /Users/marvin.x/.codex/worktrees/fanju-stage0-baseline/饭局/packages/shared
> tsc -p tsconfig.json --noEmit
```

**覆盖边界：**packages/shared/tsconfig.json include src/**/*.ts，但exclude src/**/*.test.ts。因此类型检查覆盖validator和共享源码，不给policyBundle.test.ts出具tsc类型检查结论；测试文件由本次原生Vitest实际加载并运行。没有为扩大覆盖修改tsconfig、增依赖或执行根类型检查。

## 7. 当前V1.1冻结文件前后SHA

原清单15个文件全部前后匹配，并再次shasum -a 256 -c docs/policy/SHA256SUMS_V1_1.txt得到15/15 OK，退出码0。以下对完整原始文件字节计算，不做换行归一化。

| 路径 | 修改前SHA-256 | 修改后SHA-256 | 结果 |
| --- | --- | --- | --- |
| `docs/policy/BUSINESS_RULES_BASELINE.md` | `38f06f87684d2aee70dd8853391085af22da399cbdd5e2771b26ba54925376ec` | `38f06f87684d2aee70dd8853391085af22da399cbdd5e2771b26ba54925376ec` | UNCHANGED |
| `docs/policy/OPEN_DECISION_REVIEW.md` | `7e1b177698826d117a64c8d2de7552db287e79bde32f998150786d648a422965` | `7e1b177698826d117a64c8d2de7552db287e79bde32f998150786d648a422965` | UNCHANGED |
| `docs/policy/POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md` | `41ca1f220f61ec8ddbb83ce8809be088a8944787e0276c6742f6044f1b654505` | `41ca1f220f61ec8ddbb83ce8809be088a8944787e0276c6742f6044f1b654505` | UNCHANGED |
| `docs/policy/POLICY_REBASE_V1_1_CHANGELOG.md` | `0548ac0a7d9472326e475990e75de64ecaf5423b09672f9764a5c73044f1d7aa` | `0548ac0a7d9472326e475990e75de64ecaf5423b09672f9764a5c73044f1d7aa` | UNCHANGED |
| `docs/policy/POLICY_TECH_DESIGN.md` | `899b43dcae7d519810c1f73520c49df311aec82dc533ff5339c941f29ce0e002` | `899b43dcae7d519810c1f73520c49df311aec82dc533ff5339c941f29ce0e002` | UNCHANGED |
| `docs/policy/POLICY_V1_1_BUNDLE_MANIFEST.json` | `64b0f33a18ee98095b838dab0271b6974e93a29f065fba8d356c9de164f0c8c9` | `64b0f33a18ee98095b838dab0271b6974e93a29f065fba8d356c9de164f0c8c9` | UNCHANGED |
| `docs/policy/POLICY_V1_1_CONSISTENCY_REPORT.md` | `9f0e0a0b57c23676ffa34433e13bd327132d7bd096f0e4670ad427c68346c058` | `9f0e0a0b57c23676ffa34433e13bd327132d7bd096f0e4670ad427c68346c058` | UNCHANGED |
| `docs/policy/POLICY_WORK_PACKAGES.md` | `fb5ec4dde5b44c89a3c0cccc40002508e03955296ee8270ba15c36194c854b09` | `fb5ec4dde5b44c89a3c0cccc40002508e03955296ee8270ba15c36194c854b09` | UNCHANGED |
| `docs/policy/PRIVACY_NOTICE.md` | `2d7a4b00404a07fed3b27f2526718224b58c3ec5e4027146ee4e8e8847ec7b40` | `2d7a4b00404a07fed3b27f2526718224b58c3ec5e4027146ee4e8e8847ec7b40` | UNCHANGED |
| `docs/policy/README.md` | `f85c36facadfeb527661fd22b1be03013a0237f81355facc321204979d7e4516` | `f85c36facadfeb527661fd22b1be03013a0237f81355facc321204979d7e4516` | UNCHANGED |
| `docs/policy/REFUND_POLICY.md` | `c5b1207fde76a3d853df4eaac56b58ca8bdad5e2f20cb3f0d539071b7c4003d7` | `c5b1207fde76a3d853df4eaac56b58ca8bdad5e2f20cb3f0d539071b7c4003d7` | UNCHANGED |
| `docs/policy/RESTAURANT_SERVICE_STANDARD.md` | `9b7b679f0669e08cdcaa5a1b0a6ac882534592da17fca3e7136f3d1a3eec1761` | `9b7b679f0669e08cdcaa5a1b0a6ac882534592da17fca3e7136f3d1a3eec1761` | UNCHANGED |
| `docs/policy/TRACEABILITY_INDEX.json` | `5b60aecc60afd049a48be1630726277bb25254741b7e1bb01d384450941073f0` | `5b60aecc60afd049a48be1630726277bb25254741b7e1bb01d384450941073f0` | UNCHANGED |
| `docs/policy/USER_AGREEMENT.md` | `68c4823f2650ccd6afb7ad722c9235043c89d965aeadcd8f8218c04e451ddbc2` | `68c4823f2650ccd6afb7ad722c9235043c89d965aeadcd8f8218c04e451ddbc2` | UNCHANGED |
| `docs/policy/sources/FJ_DR01_DR02_DECISION_FREEZE_V1_1_INPUT.md` | `0268f125663f3a31f9ebb0c8c49870bb2f3df9d47776e2c54439f162b1508743` | `0268f125663f3a31f9ebb0c8c49870bb2f3df9d47776e2c54439f162b1508743` | UNCHANGED |

SHA清单自身（不在15条记录中）前后同为 `c2982d2c7f0af730c544f8893da1e110d675b2652fff0ae540a22dfe36465435`。

Bundle按既定canonical JSON口径重算，前后均为：

```text
1fcd70ea51b9776f819c9c9ada9e1611408a57b79ced56325226f8d5ae58f1a0
```

manifest中14份文档记录和清单中额外的manifest文件均未改；本报告是新的工程证据，未加入原冻结bundle，不重新生成或覆盖其manifest/SHA清单。当前所有24份既有docs/policy文件前后摘要相同。

## 8. policyBundle.ts与测试摘要

| 文件 | 修改前SHA-256 | 修改后SHA-256 | 结果 |
| --- | --- | --- | --- |
| `packages/shared/src/rules/policyBundle.ts` | `ce5fa6c69555de62adba71c32efcfaf07a588358ec659fa2c695a8e034086ada` | `ce5fa6c69555de62adba71c32efcfaf07a588358ec659fa2c695a8e034086ada` | UNCHANGED |
| `packages/shared/src/rules/policyBundle.test.ts` | `8f20df9922d0effb98e8c182412c5912227981ba0e178ac11b7a2d3fe4331a0f` | `5a9b4a327a02666cc912665950cc5b6be5b2064227044e2d3299af78fa44f58c` | 路径/注释变更 |

V1.0 bundle/基线/正文固定ID及SHA可信值完全保留，旧版本拒绝规则没有修改，也没有新增V1.1允许路径；原“混用版本/ID/摘要拒绝”及always-NOT_ACTIVATABLE测试原样运行。本轮未新增对V1.1的直接调用或测试；当前V1.1不可启用不会因52项恢复而改变。

## 9. 差分与范围核对

### 9.1 本轮增量tracked diff

```text
 packages/shared/src/rules/policyBundle.test.ts | 7 ++++---
 1 file changed, 4 insertions(+), 3 deletions(-)
```

实际test完整diff：

```text
diff --git a/packages/shared/src/rules/policyBundle.test.ts b/packages/shared/src/rules/policyBundle.test.ts
index 67bd34f..4091e8f 100644
--- a/packages/shared/src/rules/policyBundle.test.ts
+++ b/packages/shared/src/rules/policyBundle.test.ts
@@ -9,8 +9,9 @@ import {
   type PolicyIssueCode,
 } from "./policyBundle.js";
 
-// Only approved local policy documents are read. No environment, DB or real materials.
-const policyRoot = new URL("../../../../docs/policy/", import.meta.url);
+// Pinned V1.0 historical test data, separate from current policies and runtime configuration.
+// No environment, DB or real materials are read; historical OP/RV states grant no activation.
+const policyRoot = new URL("./__fixtures__/policy-v1.0/", import.meta.url);
 const readPolicy = (name: string) => readFileSync(new URL(name, policyRoot), "utf8");
 const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
 const index = JSON.parse(readPolicy("TRACEABILITY_INDEX.json")) as {
@@ -55,7 +56,7 @@ const fixture: PolicyBundleInput = {
   specialReviews: index.special_reviews.map(({ id, status }) => ({ id, status })),
 };
 
-// Tests mutate cloned DTOs, never the approved fixture or policy files.
+// Tests mutate cloned DTOs, never historical fixture files or current policy documents.
 const candidate = () => structuredClone(fixture);
 function rejects(input: unknown, code: PolicyIssueCode): PolicyBundleValidation {
   const result = validatePolicyBundle(input);
```

精确重建比较证明测试文件等于“原文件 + 唯一policyRoot路径替换 + 上述范围注释”，其他字符完全相同；fixture构造、参数化用例、断言、固定信任来源、旧Gate/AgreementPolicy拒绝与NOT_ACTIVATABLE原则未动。独立只读代理也复核了同一最小差分及五个夹具/15个政策摘要；测试/typecheck结果来自根代理本次实际执行。

### 9.2 全工作区git diff --stat（含上一轮dirty）

```text
 docs/policy/BUSINESS_RULES_BASELINE.md             |  273 +-
 docs/policy/OPEN_DECISION_REVIEW.md                |  126 +-
 .../policy/POLICY_IMPLEMENTATION_AND_ACCEPTANCE.md |  250 +-
 docs/policy/POLICY_TECH_DESIGN.md                  |   58 +-
 docs/policy/POLICY_WORK_PACKAGES.md                |   86 +-
 docs/policy/PRIVACY_NOTICE.md                      |   28 +-
 docs/policy/README.md                              |   85 +-
 docs/policy/REFUND_POLICY.md                       |   63 +-
 docs/policy/RESTAURANT_SERVICE_STANDARD.md         |   53 +-
 docs/policy/TRACEABILITY_INDEX.json                | 7001 +++++++++++++++++++-
 docs/policy/USER_AGREEMENT.md                      |   56 +-
 packages/shared/src/rules/policyBundle.test.ts     |    7 +-
 12 files changed, 7294 insertions(+), 792 deletions(-)
```

此全量stat只列tracked，含原11份V1.1政策修改；不能全部归为本轮。7个本轮untracked新增另在第3节逐一列出；原5个untracked政策新增仍原字节保留。没有git add来生成统计。

### 9.3 范围外核对

起始265个可跟踪/未忽略既有文件的摘要快照中，仅测试文件改变；其余264个字节不变。新文件只允许6个fixture文件和本报告；HEAD、分支、Git索引保持不变。未读取真实密钥/用户材料；未改依赖或配置、业务代码、DB/Schema/迁移/API/worker/资金/候补/成团/前端。测试没有把新政策当旧正例，也没有污染生产入口。

## 10. 复验包、回滚与剩余问题

复验ZIP（仅本轮8个允许文件，保持仓库相对路径）：[fanju_wp10_a1_review_2026-10-01.zip](/Users/marvin.x/Downloads/fanju_wp10_a1_review_2026-10-01.zip)。打包不改变仓库内容，不包含真实资料或密钥。

回滚范围只限本轮8路径：测试原文可从当前HEAD的同路径git show读取（已验证与本轮起始测试字节一致），对照本报告diff恢复该路径和注释；6个夹具及本报告为本輪新文件，可在另行批准的回滚中仅处理这些路径。禁止reset/clean/stash或覆盖当前V1.1政策。

剩余事项：

- 等待人工验收本轮最小代码差分和证据；本报告不自行宣称人工PASS。
- H01非JSON对象形状建议按任务单保持未实施，未顺带加固validator。
- V1.1支持/启用、WP10-B、WP03/04/05/06与其他业务范围没有本轮授权，也没有新增实施。
- 全应用/DB/迁移/构建/真实渠道及91项新业务目标均NOT_RUN；52通过只证明原V1.0历史validator回归恢复。
- 原政策OP/RV及真实定价、商户、结算、专业签收和收费门禁保持原状态。

本轮交回后停止，等待人工验收；不commit、不push。
