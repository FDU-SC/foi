# 赛题可见性与提交归属：对本平台的结论

三份一手调研的收敛结果，落到本平台的三个具体问题上。原始证据见同目录：

- `icpc-ioi-problem-contest-models.md` — DOMjudge / CLICS / CMS / Kattis
- `oj-problem-contest-models.md` — Codeforces / AtCoder / 洛谷 / DMOJ
- `self-hosted-oj-problem-contest-models.md` — QDUOJ / HydroOJ / UOJ / SYZOJ / CTFd / HUSTOJ

---

## 贯穿十余个系统的一条规律

**可见性不是题目的属性。** 十余个系统里没有一个让题目自己声明「赛前不可见」。答案一律是
一个四元函数：

```
可见 = f(题目 × 比赛绑定, 比赛阶段, 观察者身份, 访问路径)
```

CTFd 是唯一的例外，它把 `state` 放在题目上——而它恰好是唯一的单事件平台，一个部署一场比赛。
这反过来说明了原因：**一旦有多场比赛，可见性就不可能是题目的单值属性**，因为答案依赖于
「谁在问、从哪条路径问、现在几点」。

实现分三类：

| 类别 | 系统 | 做法 |
|---|---|---|
| 结构性排除 | QDUOJ、AtCoder、DOMjudge | 赛题根本不在公开集合里（副本 / 题目 ID 内嵌比赛 / 题目只能经比赛访问） |
| 路径分岔 | Hydro、UOJ、SYZOJ、DMOJ、HUSTOJ 的提交路径 | 题目上有一个全局隐藏位，但**比赛路径不查它** |
| 动态推导 | HUSTOJ 的读路径 | 题目上不存任何状态，每次查询从连接表和时间窗现场 JOIN |

本平台走的是第三类：`embargoOf()` 从题目→比赛的反向索引现算，题目配置里没有任何比赛字段。
这是三类里最不容易状态漂移的一种——Hydro 的 `autoHide` 直接改全局 `pdoc.hidden` 且没有引用
计数，两场比赛引用同一题时会互踩；QDUOJ 的复制让血缘完全丢失。本平台把推导放在 authz 层
而不是散落的 SQL 里，比 HUSTOJ 又更收敛（HUSTOJ 的题库列表与题目页条件已经不一致）。

---

## 问题 1：赛题与比赛一起发布时，题目如何声明可见组？

**不声明。省略 `visibleTo`。**

`visibleTo` 与「赛前保密」是两个正交维度，不要用前者表达后者：

- `visibleTo` 是**受众**——谁有资格看这一类题（校队、某个班、某一届）。与时间无关。
- 「赛前保密」是**时相**——把题写进某场比赛的 `problems[]` 就自动获得，题目一侧什么都不用写。

尤其不要用 `visibleTo: []` 表达「先藏起来」。那是 staging 的写法，比赛开始后它也不会公开；
`lib/problems/warnings.ts` 已经为这个组合准备了启动告警。

两条现成的护栏说明这个划分是自洽的：

- `audienceCovers`（`lib/contests/registry.ts`）在加载期拒绝「比赛受众宽于它任一题的受众」，
  所以受众维度不会因为比赛而泄漏。
- `contest.readProblemSet` 是独立动作，题单（编号、标题、分值）与题面各有各的门。

### 但当前的禁运窗口开早了

`embargoOf()` 在**任一**引用比赛 `hasContestStarted` 时返回 `null`，即开赛瞬间解禁。
主流平台的谓词是「结束」而不是「开始」：

| 系统 | 遮蔽条件 |
|---|---|
| HUSTOJ | `NOT EXISTS (... c.end_time > now ...)` — 存在任一未结束的引用比赛即遮蔽 |
| UOJ | 赛前不可见；赛中仅报名者；赛后（过 `end_time`）对所有人开放 |
| Hydro | `autoHide` 注册 `executeAfter: endAt` 的 `unhide` 任务 |
| DMOJ | `Problem.is_public` 默认 `False`，赛中靠 `Profile.current_contest` 临时放行 |
| Codeforces / AtCoder / DOMjudge | 赛中题目只在比赛内可达 |

用内核夹具实测当前谓词的三个后果（`fixture-main` 窗口内、参赛范围为 `夹具-参赛组`）：

1. 非参赛者 `problemFor` 打得开，`embargo: null`、`preview: false`——他是通过正常受众策略
   拿到的，赛题此刻就在公开题库里。
2. 非参赛者 `submitFor(contest=null)` 放行，记为练习。
3. 参赛者同样可以 `submitFor(contest=null)`：不进榜、不罚时、用题目自己的节流而不是比赛条目的
   覆盖值。这是一个免费 oracle。

第三条正是 HUSTOJ 在源码注释里写明那条子查询存在的理由（"they can bypass the penalty time of
20 mins for each non-AC submission in contest"），也是洛谷官方规则里明文列为作弊的行为
（「利用其中一场比赛测试提交，以绕过错误提交造成的罚时或分数扣除」）。

### 建议的形状

把 `builtin:problem-audience` 拆成两条 permit，正好是 UOJ `isContestProblemVisibleToUser`
的三段式，且完全落在「builtin 只解释平台声明的资源属性」这条纪律内——它解释的是
`problems[]` 绑定、比赛时间窗与 `participants`：

1. `builtin:problem-audience` — `inAudience(visibleTo)` **且** 没有任何引用比赛尚未结束。
   谓词从 `hasContestStarted` 改成 `hasContestEnded`，并且不再短路：要**全部**引用比赛都结束
   才放开。
2. `builtin:problem-in-contest`（新）— 调用方指名了比赛（`context.contest`）、题在该比赛题单、
   比赛在收题窗内、且此人过得了 `contest.enter` → 放行 `problem.read` / `submit` / `invoke`。

连带影响：

- `ProblemView.embargo` 的语义从「未开赛的那场」变成「扣住它的那场」。
- 赛中练习入口自动关闭，因为唯一放行的路径变成带 `contest` 的那条。这正是要的效果。
- 运维预览不受影响：`staff:preview` 是另一条 permit，本来就不经过受众策略。
- 一题多赛时，为 B 赛排期会把已经公开过的题重新藏起来。HUSTOJ 接受这个代价（它是纯推导的
  必然结果），Hydro 有同样问题且未解决。建议接受，并在启动告警里提示。

---

## 问题 2：会不会有「新比赛引用已有题目」？

**会，而且是主流。本平台的引用模型已经对了。**

| 系统 | 一题多赛 | 依据 |
|---|---|---|
| DOMjudge | 是 | `contestproblem` 主键 `(cid, probid)`，表注释 `Many-to-Many mapping of contests and problems` |
| Codeforces | 是 | mashup 按 `1234D` 形式的 ID 引用站内已有题目，站长原话 |
| DMOJ | 是 | `ContestProblem.Meta.unique_together = ('problem', 'contest')`——只禁同题同赛重复 |
| Hydro | 是，一等公民 | `getRelated()` 反查一题的所有比赛，删题时做引用完整性检查 |
| UOJ / HUSTOJ / SYZOJ | 是 | 连接表 / 数组 |
| 洛谷 | 是 | 官方规则专门为「一道题目被用于两场以上同时举办的公开比赛」立法 |
| CMS | **否** | 官方文档："A task cannot be associated to more than one contest" |
| AtCoder | **否** | 题目 ID 内嵌比赛（`abc466_a`） |
| QDUOJ | **否** | 每次「引用」都是 `pk = None; save()` 的快照复制 |

关键设计点是**per-contest 的覆盖字段挂在引用点上，而不是题目上**。DOMjudge 的
`contestproblem` 八列里有六列是这种覆盖（`shortname`、`points`、`allow_submit`、`allow_judge`、
`color`、`lazy_eval_results`），所以同一道题可以在一场里是 1 分的 A、在另一场里是 5 分的 C。

本平台的 `ContestProblemConfig`（`slug` + `label` + `points` + `rateLimit` + `config`）就是同一
结构。唯一没有对应物的是 DOMjudge 的 `allow_submit` / `allow_judge`——「同一题在不同比赛有不同
开放度」。本平台只有全局的 `retired`。这在 everything-as-code 下不一定要补：改 content 重新
部署即可。

需要注意的是，一题多赛会放大问题 1 的缺口：`embargoOf` 的短路 `return null` 意味着 A 赛开赛
就把下周 B 赛的题一并解禁。这正是 HUSTOJ 遍历**所有**引用比赛、只要有一场没结束就遮蔽的原因。

---

## 问题 3：一题被多场比赛引用时，提交入口要分开吗？

**必须分开，一次提交只在一场计分。本平台已经对了。**

十余个系统无一例外，而且这是 schema 层的硬约束，不是策略选择。最硬的三条证据：

- **DOMjudge**：`submission` 表的外键 `submission_ibfk_8` 要求 `(cid, probid)` 必须存在于
  `contestproblem`。写一条不属于该比赛的提交会被**数据库**拒绝——「这道题属于这场比赛」是
  外键前提，不只是应用层检查。
- **DMOJ**：`ContestSubmission.submission` 是 `OneToOneField`，物理上禁止一稿多投。比赛归属是
  一张独立的行，连接 `ContestProblem`（某赛的某题）与 `ContestParticipation`（某人在某赛的
  某次参与）；没有这一行，提交就不属于任何比赛。
- **Codeforces**：Div.1 / Div.2 共享题在两场是两个身份。Round 1116 的同一道题在 Div.1 是
  `contestId=2255, index=A, points=500`，在 Div.2 是 `contestId=2256, index=C, points=1500`，
  两场的 `CONTESTANT` 提交池完全不相交。

入口分开有三种实现形式，本平台用的是第二种：

| 形式 | 系统 |
|---|---|
| URL 路径分岔 | UOJ、SYZOJ、AtCoder、Codeforces |
| query 参数 | Hydro（`?tid=`）、SYZOJ 提交端、**本平台**（`?contest=`） |
| 会话状态 | DMOJ（`Profile.current_contest`） |

本平台的形状——`submissions.contestSlug` 单值可空、`?contest=` 决定归属、
`builtin:contest-attribution` 校验题在题单且窗口开着、standings 只认 `contestSlug` 相等的行
——与 UOJ / Hydro / SYZOJ 完全同构。

深层原因值得记下：所有系统的榜单都从提交的归属字段**单向扇出**到 per-(赛, 人) 的物化结构。
要支持一次提交双记分，得把这条边改成多对多，同时解决罚时、首杀、封榜在两场之间的语义冲突
（一次提交在 A 赛是首杀、在 B 赛不是？A 赛封了 B 赛没封？）。没有任何系统尝试过。

### 两处可加固

**(a) 榜单应按当时的题单过滤。** Hydro 的每个赛制 `stat()` 都先 `tdoc.pids.includes(j.pid)`。
本平台的 content 可变，一道题从题单移除后，历史提交的 `contestSlug` 仍在，仍会进榜。

**(b) 归属约束只在写入路径。** DOMjudge 靠外键保证 `(cid, probid)` 成立；本平台的题单在
content 里而不在 DB 里，所以只能靠 `builtin:contest-attribution` 在写入时校验。这是
everything-as-code 的必然代价，可以接受，但要知道边界在哪：DB 里可能存在与当前题单不符的
历史行，这与 (a) 是同一件事的两面。

### 一条可选的替代设计

Codeforces 没有「无比赛的提交」——从题库页发起的练习提交，`contestId` 依然是原比赛的，只是
`author.participantType` 变成 `PRACTICE`。如果将来需要「赛后练习也归属到那场比赛以便统计」，
应该加一个参与类型字段，而不是改动 `contestSlug` 的归属语义。本平台当前的
`contestSlug: null` = 练习，与 UOJ / QDUOJ / Hydro / HUSTOJ / SYZOJ 一致。

---

## 小结

| 问题 | 结论 | 本平台现状 |
|---|---|---|
| 1. 赛题如何声明可见组 | 不声明；省略 `visibleTo`，赛期遮蔽由比赛引用推导 | 模型对，但禁运窗口应从 `startsAt` 改到 `endsAt`，并为参赛路径单开一条 permit |
| 2. 新比赛引用已有题目 | 主流做法，per-contest 覆盖挂在引用点上 | 已是一等公民，结构对齐 DOMjudge `contestproblem` |
| 3. 分提交入口 | 必须分；一次提交只在一场计分 | 已对；可加固榜单按题单过滤 |
