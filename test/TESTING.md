# 测试指南

## 四层测试架构

`vitest.config.mts` 将测试分为四个 project，各有不同的执行模式与职责。
内核测试使用 content 夹具，部署测试使用实际部署内容。

### unit — 纯函数行为测试

- **匹配**：`**/*.test.ts`（排除 `*.db.test.ts`、部署测试与 `scripts/`）
- **并行**：是
- **依赖**：无数据库，无网络；`@/content/*` 重定向到 `test/fixtures/content/`
- **职责**：验证内核模块的业务规则——给什么输入，得什么输出

### db — 数据库集成测试

- **匹配**：`**/*.db.test.ts`
- **并行**：否（`fileParallelism: false`）
- **依赖**：`DATABASE_URL`（若未设置则整组 `describe.skip`）；同样使用夹具
- **职责**：验证事务语义、并发竞态、幂等行为

### deployment — 内容部署校验

- **匹配**：`content/**/*.test.ts`，以及每个 `.local` 插槽下的测试
- **并行**：否
- **依赖**：tsconfig 实际解析到的 content
- **职责**：确认当前部署满足内核的前提假设，且自身自洽

### tools — 运维与演示站脚本

- **匹配**：`scripts/**/*.test.ts`
- **依赖**：不重定向；这些测试不得 import `@/content/`，须自带样例

---

## 什么时候写哪种测试

### 行为测试（最常写）

验证一条业务规则："当 X 条件满足时，系统应该 Y"。

- 放在被测模块旁边：`lib/submissions/gate.ts` → `lib/submissions/gate.test.ts`
- 使用 `test/content-shapes.ts` 获取真实的 content 形状（而不是手写假 fixture）
- 每个 `it()` 验证一个行为，用中文写明条件与预期结果

```typescript
it("比赛已结束时是 contest-mismatch", () => {
  const gate = submitFor(ENTRY.slug, CONTEST.slug, ENTRANT, AFTER);
  expect(gate).toEqual({ ok: false, reason: "contest-mismatch" });
});
```

### 结构守卫测试（偶尔新增）

扫描源码，确保新增入口没有遗漏配置。防止"加了路由但忘了声明限流"这类错误。

- `lib/ratelimit/policy.test.ts` — 每个 route handler / Server Action 都在限流表里
- `lib/server/guard.test.ts` — 每个 route.ts 都调了 `guardRequest`
- `lib/authz/registry.test.ts` — 每个动作都有放行策略，内核之外不得自行判断权限
- `content/content-names.test.ts` — 内核不硬编码 content 名字
- `test/slots.test.ts` — 插槽别名配置一致，`app/` 仅包含路由壳，UI 层不直接导入 content

守卫测试的最后一条通常是"扫描确实找到了东西"，防止路径写错导致空真。

### 集成测试（需要数据库）

验证涉及事务、`FOR UPDATE SKIP LOCKED`、并发等必须真实执行 SQL 才能覆盖的行为。

- 文件名带 `.db.test.ts` 后缀
- `const describeDb = process.env.DATABASE_URL ? describe : describe.skip;`
- 测试完清理自己写入的行（`afterAll` 中 DELETE）

---

## Fixture 约定

| 文件 | 提供什么 |
|------|----------|
| `test/content-shapes.ts` | 按形状取出测试所需的题目、比赛、分组、视角 |
| `test/standings-support.ts` | 构造排行榜计算所需的虚拟提交、选手、题目 |
| `test/auth-support.ts` | `AS_PLAYER`：匿名视角 |

取视角用 `viewerWith(action)`（拿到一个被策略放行该动作的组）与 `viewerAllowedOnly(granted, withheld)`（拿到一个能做前者、不能做后者的组）。两者都按策略集的形状挑选，测试里不写死组名——`content/content-names.test.ts` 会扫出硬编码的 content 名字。

内核测试里这些形状来自 `test/fixtures/content/`，不是某套部署。通过辅助函数获取形状，缺失时由 `test/fixtures/content/fixture.test.ts` 明确报告，避免产生无关的断言失败。

---

## 命名与组织

- 文件名：`<module>.test.ts`（紧挨被测模块）或 `<module>.db.test.ts`（需要数据库）
- `describe` 用被测函数或功能命名
- `it` 用中文描述期望行为
- 避免测试实现细节（mock 内部函数）；优先测试公共接口
