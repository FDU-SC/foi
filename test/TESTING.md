# 测试指南

## 三层测试架构

`vitest.config.mts` 将测试分为三个 project，各有不同的执行模式与职责：

### unit — 纯函数行为测试

- **匹配**：`**/*.test.ts`（排除 `*.db.test.ts` 和 `content/`）
- **并行**：是
- **依赖**：无数据库，无网络
- **职责**：验证内核模块的业务规则——给什么输入，得什么输出

典型模式：构造入参 → 调用函数 → 断言返回值。

### db — 数据库集成测试

- **匹配**：`**/*.db.test.ts`
- **并行**：否（`fileParallelism: false`）
- **依赖**：`DATABASE_URL`（若未设置则整组 `describe.skip`）
- **职责**：验证事务语义、并发竞态、幂等行为

### deployment — 内容部署校验

- **匹配**：`content/**/*.test.ts`
- **并行**：否
- **依赖**：仓库里挂载的 `content/` 模块
- **职责**：确认当前 content 满足内核的前提假设，且自身自洽

---

## 什么时候写哪种测试

### 行为测试（最常写）

验证一条业务规则："当 X 条件满足时，系统应该 Y"。

- 放在被测模块旁边：`lib/submissions/gate.ts` → `lib/submissions/gate.test.ts`
- 使用 `test/content-shapes.ts` 获取真实的 content 形状（而不是手写假 fixture）
- 每个 `it()` 回答一个问题，用中文命名，让测试列表本身就是需求文档

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
- `test/enforcement.test.ts` — 每个门禁函数都在授权地图里
- `test/content-names.test.ts` — 内核不硬编码 content 名字

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
| `test/content-shapes.ts` | 从真实 content 中按形状取出测试所需的题目、比赛、分组 |
| `test/standings-support.ts` | 构造排行榜计算所需的虚拟提交、选手、题目 |
| `test/auth-support.ts` | `AS_PLAYER`：匿名视角 |
| `test/enforcement.ts` | 授权地图的声明（READ_GATES / WRITE_GATES / PAGE_CHECKS）|

使用 `content-shapes.ts` 而不是手写假数据的好处：如果 content 被修改导致假设不再成立，`content/deployment.test.ts` 会立即报错并说明需要什么形状。

---

## 命名与组织

- 文件名：`<module>.test.ts`（紧挨被测模块）或 `<module>.db.test.ts`（需要数据库）
- `describe` 用被测函数或功能命名
- `it` 用中文描述期望行为
- 避免测试实现细节（mock 内部函数）；优先测试公共接口
