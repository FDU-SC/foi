# 大型公开评测平台如何建模 Problem / Contest / Visibility / Submission

调研对象：Codeforces、DMOJ、AtCoder、洛谷 Luogu。
调研日期：2026-09-01。

## 0. 方法与证据等级

本报告只使用**一手来源**：

| 平台 | 一手来源 | 证据类型 |
|---|---|---|
| Codeforces | `codeforces.com/apiHelp/objects`、`codeforces.com/help`、管理员本人的官方博客、公开 API 的实测响应 | 官方文档 + 官方 API 实测 |
| DMOJ | `github.com/DMOJ/online-judge`，commit `6aaddea6aaeabf4927b83787714509ff9fff8897`（2026-05-17） | 真实源代码 |
| AtCoder | `atcoder.jp` 官方 rules / FAQ 页面 + URL 结构实测 | 官方文档 + 黑盒实测 |
| 洛谷 | `github.com/luogu-dev/docs`（洛谷帮助中心，commit `0bf65e35`，2026-08-05）、`github.com/luogu-dev/luogu-rules`（commit `5047f9ab`）、`github.com/luogu-dev/lgapi-docs`（commit `b055ec29`） | 官方文档仓库源文件 |

实测原始输出保存在：

- `/opt/cursor/artifacts/codeforces-api-evidence.log`
- `/opt/cursor/artifacts/atcoder-url-evidence.log`

凡是无法用一手来源证实的，本报告显式写 **unverified**，不做记忆推测。社区博客一律不引用。

---

## A. 题目住在哪里 —— 比赛内部，还是全局题库？

### A.1 Codeforces：题目的家就是比赛；problemset 是比赛题目的一个视图

`codeforces.com/apiHelp/objects` 中 `Problem` 对象的定义（原文引用）：

| Field | Description |
|---|---|
| `contestId` | Integer. Can be absent. **Id of the contest, containing the problem.** |
| `problemsetName` | String. Can be absent. **Short name of the problemset the problem belongs to.** |
| `index` | String. Usually, a letter or letter with digit(s) indicating **the problem index in a contest**. |
| `name` | String. Localized. |
| `type` | Enum: PROGRAMMING, QUESTION. |
| `points` | Floating point number. Can be absent. **Maximum amount of points for the problem.** |
| `rating` | Integer. Can be absent. Problem rating (difficulty). |
| `tags` | String list. Problem tags. |

来源：<https://codeforces.com/apiHelp/objects>

关键点是两个字段都写了 "Can be absent"。实测证明 **`contestId` 与 `problemsetName` 是互斥的两套寻址方案**：

```
# 默认 problemset 的 11370 道题，problemsetName 全部缺席，contestId 全部存在
$ curl -sS "https://codeforces.com/api/problemset.problems" \
  | jq -r '[.result.problems[].problemsetName] | map(if .==null then "(absent)" else . end) | group_by(.)[] | "\(.[0]): \(length)"'
(absent): 11370

# acmsguru 这个独立题库，contestId 全部缺席，problemsetName 全部存在
$ curl -sS "https://codeforces.com/api/problemset.problems?problemsetName=acmsguru" | jq -r '.result.problems[0:3][]'
contestId=ABSENT  problemsetName=acmsguru  index=553  name=Sultan's Pearls
contestId=ABSENT  problemsetName=acmsguru  index=552  name=Database Optimization
contestId=ABSENT  problemsetName=acmsguru  index=551  name=Preparing Problem
```

（原始输出见 `codeforces-api-evidence.log` 第 4 节。）

结论：

1. Codeforces 上一道题的身份是 **`(contestId, index)` 这个二元组**。它不是"归属于某比赛的全局题目"，而是"某比赛的第 index 题"。
2. `problemset`（题库）**不是另一个命名空间**，而是所有已结束比赛题目的聚合视图。URL 也说明了这一点：`/problemset/problem/{contestId}/{index}` 与 `/contest/{contestId}/problem/{index}` 指向同一道题，前者仍然以 contestId 做主键。
3. `problemsetName` 只用于**没有比赛的外来题库**（如从 acm.sgu.ru 引入的 acmsguru，`index` 是纯数字 553、552 而不是字母）。这是 `contestId` 唯一会缺席的情形。
4. `points` 挂在 Problem 上，但它是**比赛内的分值**，不是题目的固有属性——见 §B.3 的实测，同一道题在两场比赛里的 `points` 不同。

### A.2 DMOJ：题目是全局一等实体，`ContestProblem` 是允许复用的连接表

`Problem` 是独立的顶层模型，自带可见性和权限字段：

```python
# judge/models/problem.py:124-132
    authors = models.ManyToManyField(Profile, verbose_name=_('creators'), blank=True, related_name='authored_problems',
                                     help_text=_('These users will be able to edit the problem, '
                                                 'and be listed as authors.'))
    curators = models.ManyToManyField(Profile, verbose_name=_('curators'), blank=True, related_name='curated_problems',
                                      help_text=_('These users will be able to edit the problem, '
                                                  'but not be listed as authors.'))
    testers = models.ManyToManyField(Profile, verbose_name=_('testers'), blank=True, related_name='tested_problems',
                                     help_text=_(
                                         'These users will be able to view the private problem, but not edit it.'))
```

```python
# judge/models/problem.py:155
    is_public = models.BooleanField(verbose_name=_('publicly visible'), db_index=True, default=False)

# judge/models/problem.py:179-181
    organizations = models.ManyToManyField(Organization, blank=True, verbose_name=_('organizations'),
                                           help_text=_('If private, only these organizations may see the problem.'))
    is_organization_private = models.BooleanField(verbose_name=_('private to organizations'), default=False)
```

三个角色的语义分工很清楚（都写在 `help_text` 里）：`authors` 可编辑并署名，`curators` 可编辑但不署名，`testers` **可以看私有题目但不能编辑**——这正是"赛前验题人"这个角色。

比赛通过 `through` 表引用题目：

```python
# judge/models/contest.py:90
    problems = models.ManyToManyField(Problem, verbose_name=_('problems'), through='ContestProblem')
```

```python
# judge/models/contest.py:609-629
class ContestProblem(models.Model):
    problem = models.ForeignKey(Problem, verbose_name=_('problem'), related_name='contests', on_delete=CASCADE)
    contest = models.ForeignKey(Contest, verbose_name=_('contest'), related_name='contest_problems', on_delete=CASCADE)
    points = models.IntegerField(verbose_name=_('points'))
    partial = models.BooleanField(default=True, verbose_name=_('partial'))
    is_pretested = models.BooleanField(default=False, verbose_name=_('is pretested'))
    order = models.PositiveIntegerField(db_index=True, verbose_name=_('order'))
    output_prefix_override = models.IntegerField(verbose_name=_('output prefix length override'),
                                                 default=0, null=True, blank=True)
    max_submissions = models.IntegerField(verbose_name=_('max submissions'),
                                          help_text=_('Maximum number of submissions for this problem, '
                                                      'or leave blank for no limit.'),
                                          default=None, null=True, blank=True,
                                          validators=[MinValueOrNoneValidator(1, _('Why include a problem you '
                                                                                   "can't submit to?"))])

    class Meta:
        unique_together = ('problem', 'contest')
```

**`ContestProblem` 是不折不扣的连接表，且明确允许复用。** 决定性证据是第 626 行的 `unique_together = ('problem', 'contest')`：唯一性约束落在 **(题目, 比赛) 这一对**上，而不是单独落在 `problem` 上。它禁止的只是"同一题在同一场比赛里出现两次"，完全不限制同一题出现在任意多场比赛中。第 610 行 `related_name='contests'`（复数）也直说了：从一道题可以反查出它参加过的所有比赛。

所有**比赛内语义**都挂在这张连接表上而不是题目上：`points`（本场分值）、`partial`（本场是否给部分分）、`is_pretested`（本场是否只跑 pretest）、`order`（本场题号顺序）、`max_submissions`（本场提交次数上限）。同一道题在不同比赛里可以有完全不同的分值、赛制和提交限制。

### A.3 AtCoder：不存在比赛之外的题目 URL

AtCoder 的题目 URL 恒为 `/contests/<contest>/tasks/<task_id>`，且 `task_id` 本身就编码了比赛（`abc466_a`）。实测（`atcoder-url-evidence.log` 第 1 节）：

```
  200  https://atcoder.jp/contests/abc466/tasks/abc466_a
  404  https://atcoder.jp/tasks/abc466_a
  404  https://atcoder.jp/problems/abc466_a
  200  https://atcoder.jp/contests/abc466/submissions
  404  https://atcoder.jp/submissions
  200  https://atcoder.jp/contests/abc466/standings
```

**AtCoder 没有任何比赛之外的题目 URL，也没有全站提交列表。** 题目、提交、榜单三者全部只在 `/contests/<contest>/` 之下存在。

比赛结束后如何做旧题：提交入口仍然是**原比赛下的那一个**。`/contests/abc466/submit`（abc466 已于 2026-07-11 结束）匿名访问返回登录跳转，而跳转的 `continue` 参数原样保留了 `https://atcoder.jp/contests/abc466/submit`——路由存在，只是缺登录态：

```
  code=200
  final=https://atcoder.jp/login?continue=https%3A%2F%2Fatcoder.jp%2Fcontests%2Fabc466%2Fsubmit
```

所以赛后练习提交**仍然落在原比赛下**，AtCoder 没有"练习区"这个独立容器。

补充证据：单条提交也是按比赛作用域寻址的。`/submissions/69450872` 返回 404 Page Not Found（路由不存在），而 `/contests/language-test-202505/submissions/69450872` 返回 403（路由存在但匿名被拒）。

### A.4 洛谷：题目有独立的可见性状态，题号前缀体现所属题库

洛谷的题目按题号前缀分库，这一点由官方文档反复确认：

- `docs/rules/academic/training-promotion-standard.md:45`：「**公开题单所包含的题目必须是洛谷题库（P 题、B 题）和 RemoteJudge 题库中存在的，不能出现私题、团队题**。」
- `src/pages/release-note.md:188`：「允许管理员为公开题目（P 题、B 题、RemoteJudge 题）添加多语言题面，普通用户可提交工单贡献。目前私有题目不开放多语言题面。」
- `src/pages/release-note.md:400`：「新增"入门与面试"题库，序号为 B 开头」
- `lgapi-docs/docs/judge/pricing.md:43`：「可以评测所有的洛谷题号为 P 或者 B 开头的题目（**公共题目**），约 15,000 题目。」

由此确认的官方分库：**P = 主题库 / 公开题库，B = 入门与面试题库（同为公开），U = 个人私有题目，T = 团队题目，RemoteJudge = 外站题面**。

关于 U（个人私有）：`docs/manual/luogu/problem/index.md:29` 写「进入个人主页-题库-我创建的题目，点击新建题目……**普通用户可创建私有题目数量的上限为 50 题**」，且创建入口是 `https://www.luogu.com.cn/problem/new?type=U`（`docs/manual/luogu/contest.md:24` 给出该链接）。

**决定性的一点：洛谷的题目自身带一个可以设置的"可见性 / 题目状态"字段，与比赛无关。** 官方月赛流程文档两处直接描述了对它的操作：

> 在准备比赛（特别是验题）的过程中，需要确保无关人员无法通过任何渠道获取到题目。一个有风险的途径是**把私题的可见性设置为公众可见**，我们不推荐在验题时这样做，正确的做法是将私题迁移至团队内，并**设置为「仅团队可见」**，让验题人加入团队进行验题。
> —— `docs/rules/academic/lgr/review.md:35`（`docs/rules/academic/lgr/contest-standard.md:93` 有几乎相同的表述）

> 审核管理应及时将月赛题目加入主题库，注意修改题目提供者为**出题人**，**将题目状态改为「公众可见」**，添加对应题目的**算法标签**。
> —— `docs/rules/academic/lgr/contest-standard.md:103`

所以官方确认存在的题目可见性取值至少有 **「公众可见」** 与 **「仅团队可见」** 两种，且它是题目自己的属性，由人显式设置。

题目还可以在题库之间**迁移**：

> 建议所有题目都放置在同一个团队下，并且**按顺序（即你希望它们在主题库中的排列顺序）编号**，即在同一个团队下的 Txxxxx 编号是**递增的**（不一定要连续）。……如果顺序是乱的可以请一位用户**把所有题目迁移到个人题库再按顺序迁移回去**。
> —— `docs/rules/academic/lgr/review.md:30`

这说明洛谷月赛的实际形态是：题目先以 **T 题（团队题，仅团队可见）**存在 → 比赛引用这些 T 题 → 赛后**迁移进主题库**并改为公众可见，获得 P 号。

比赛如何引用题目——官方团队文档直说：

> 比赛题目可选用**洛谷公开题目、其他 OJ（RemoteJudge）题目以及团队内部题目**，参赛人数原则上不设限制。
> —— `docs/manual/luogu/team/index.md:87`

比赛的公开度是**比赛自己的**五档枚举（`docs/manual/luogu/contest.md:9-13`）：官方比赛、个人公开赛、团队公开赛、个人邀请赛（参赛需要邀请码）、团队内部赛（仅限团队内部成员参加）。

---

## B. 在新比赛里复用已有题目

### B.1 Codeforces Mashup：官方明确定位为"复用题库题目"

站长 MikeMirzayanov 本人的官方博客，第一句就是这个功能的定位：

> There is something new for you. It seems that now it will be **easier to reuse problems from the archive** for educational and other purposes.
>
> As you know, **problems from past Codeforces rounds can be added to mashups simply by their codes of the form like `1234D` (contest ID + problem letter).** I myself regularly used this when I taught at Saratov University — it was very convenient to prepare trainings…
>
> —— MikeMirzayanov, *Codeforces New Feature: Rewrite Statements in Mashups*, <https://codeforces.com/blog/entry/84795>

这是本报告最直接的一段证据：**mashup 通过 `(contestId, index)` 引用已存在的归档题目，引用是按 ID 的，不是拷贝一份新题。**

同一篇博客还描述了一个很有意思的机制——**引用方可以覆盖被引用题目的题面**：

> now you can **rewrite statements for problems in mashups, completely replacing it with your own**. …
> - a new icon-link appears in the problem list in mashups, by clicking on which there will be a form for creating/editing a new statement;
> - you can use the original text of the statement as a template when writing your own: be very careful — **you must exactly repeat all the details of a statement so that problems do not formally differ**;
> - you can specify your own tests from a statement (examples) …
> - **if you added examples, then solutions will be judged on them first, and only after on official tests;**

即：题目本体（测试数据、评测逻辑）是共享的，**题面和样例是引用点上的覆盖层**。

Mashup 的创建与可见性，来自官方功能发布博客：

> Such frame is available for all Codeforces users **at Gym page**, who took part in at least three official rated Codeforces Rounds. When you press Create Mashup Contest button, you are redirected to … mashup creation page. On this page you can enter contest name and duration and **find problems via problem search form**.
>
> Problem search form support search by the number of parameters including:
> - **Problem code with format (contest id)(problem index). For example, 123C.**
> - Problem name in both English and Russian language.
> - Contest name in both English and Russian language.
> - Tags.
>
> After you found all the problems and press Create button, mashup contest will appear at Gym page. **This contest will be visible to you only.** If you want to share it with your friends, you can add it to the group.
>
> —— Fefer_Ivan（Codeforces 团队成员，站内官方功能发布）, *New year update: Mashup contests*, <https://codeforces.com/blog/entry/10099>

关于评分/rating：mashup 出现在 Gym 页面下，而 Gym 比赛**不产生 rating 变化**（实测）：

```
contest.ratingChanges?contestId=100001 (gym)  -> {"status":"FAILED","comment":"contestId: Rating changes are unavailable for this contest"}
contest.ratingChanges?contestId=2255  (round) -> {"status":"OK", ... "oldRating":3314,"newRating":3411 ...}
```

需要说明的边界：「mashup 一定 unrated」这一点我是**由"mashup 属于 Gym"+"Gym 无 rating change"推出的**，没有找到一句官方原话直接写"mashups are unrated"。**unverified（作为直接陈述）**。同样 **unverified** 的还有：在 mashup 中通过一道题，是否会同时把归档中的原题标记为已解决。

### B.2 Codeforces Gym：以整场外部比赛为单位导入，与 mashup 不是一回事

Gym 的定位来自站长本人的开站公告：

> On January 19, 2012 at 12:00 we open a sub-project called "Gym". In short, its goal is to enable the Codeforces coders not only to participate in competitions and discuss them, but also to train and coach easily. …
> 1. **Collection of online contests, composed mainly of the past official contests.**
> 2. Opportunity to integrate the final standings of past contests in the online contests to be able to train "against" the official participants. …
> 4. Opportunity to write virtual contests and to solve the problems in a practice mode.
>
> To organize a training session you need **the archive of the past contest**:
> - full tests (if generators are used, then the tests must be pre-generated), including files with answers for each test;
> - original solutions;
> - checkers;
> - a final standings file in the form of the traditional ACM-ICPC standings in HTML…
>
> —— MikeMirzayanov, *Codeforces::Gym*, <https://codeforces.com/blog/entry/3676>

所以 **Gym training 与 mashup 的复用方式相反**：Gym 是把一整场外部比赛（题目数据、checker、原始榜单、ghost 选手）导入成一场**自带题目**的新比赛；mashup 才是按 ID 引用站内已有题目。两者都挂在 Gym 页面下，容易混淆。

Gym 比赛不影响 rating（上面的 `contest.ratingChanges` 实测）。Gym 也支持 ghost 参与者，这在 API 里有一等公民字段：`Party.ghost` — "If true then this party is a ghost. It participated in the contest, but not on Codeforces."（<https://codeforces.com/apiHelp/objects>）

### B.3 Codeforces Div.1 / Div.2 共享题：一道题，两个身份

这是本报告最硬的一条实测证据。取 Codeforces Round 1116：Div. 1 = contestId 2255，Div. 2 = contestId 2256。

```
--- contest.standings?contestId=2255  (Div. 1) ---
  contestId=2255  index=A  points=500.0   name=Hot Potatoes at the Fairy Warehouse
  contestId=2255  index=B  points=1000.0  name=A Ribbon for Tomorrow
  contestId=2255  index=C  points=1750.0  name=Even If the World Turns
  contestId=2255  index=D  points=1750.0  name=How Long Until Nothing Remains?
  contestId=2255  index=E1 points=1750.0  name=What Will Remain at the End? (Easy Version)
  contestId=2255  index=E2 points=1250.0  name=What Will Remain at the End? (Hard Version)
  contestId=2255  index=F  points=3500.0  name=Who Will Witness the End?

--- contest.standings?contestId=2256  (Div. 2) ---
  contestId=2256  index=A  points=500.0   name=Three Numbers on the Blackboard
  contestId=2256  index=B  points=1000.0  name=Domino Tiles
  contestId=2256  index=C  points=1500.0  name=Hot Potatoes at the Fairy Warehouse
  contestId=2256  index=D  points=2000.0  name=A Ribbon for Tomorrow
  contestId=2256  index=E  points=2750.0  name=Even If the World Turns
  contestId=2256  index=F  points=3000.0  name=How Long Until Nothing Remains?
```

同一道 *Hot Potatoes at the Fairy Warehouse*：

- 在 Div. 1 里 API 报告它是 `contestId=2255, index=A, points=500`；
- 在 Div. 2 里 API 报告它是 `contestId=2256, index=C, points=1500`。

**API 层面它就是两个不同的 Problem 对象，两个 URL，两套分值。** 也就是说 Codeforces 的题目身份是"比赛坐标"，共享题在两场比赛里各有一个身份。

但归档层面只留一份：`problemset.problems` 里 contestId=2255 有 7 道题（Div.1 全部），contestId=2256 只有 2 道（A、B）。共享的那 4 道题在题库里**只以 Div. 1 的坐标存在一次**。所以"两个身份"是比赛视图层面的，题库做了去重，以 Div. 1 的坐标为准。

### B.4 DMOJ：schema 明确允许同一题进入多场比赛

见 §A.2。`ContestProblem.Meta.unique_together = ('problem', 'contest')`（`judge/models/contest.py:626`）唯一约束落在题目与比赛的组合上；`ContestProblem.problem` 的 `related_name='contests'`（`judge/models/contest.py:610`）是复数反向关系。**schema 层面完全允许，且是设计意图。**

同一题在不同比赛可以有不同的 `points` / `partial` / `is_pretested` / `order` / `max_submissions`，因为这些字段都在 `ContestProblem` 上而不是 `Problem` 上。

### B.5 洛谷：复用是产品功能，且官方规则承认"同题多赛"

`docs/manual/luogu/team/index.md:87`：「比赛题目可选用**洛谷公开题目**、其他 OJ（RemoteJudge）题目以及团队内部题目」。作业同理（`docs/manual/luogu/team/index.md:139`：「团队作业中可添加洛谷公有题目、Codeforces 等其他 OJ 的题目以及团队内部题目」）。

更强的证据是官方参赛规则**直接为"同一题被两场同时进行的比赛引用"写了条款**：

> 一个人只能使用一个帐号参加比赛。禁止一个人同时操纵多个帐号参加比赛；**当一道题目被用于两场以上同时举办的公开比赛时**，如果其中一场比赛采用了乐多赛制，ICPC 赛制等成绩与提交次数有关的赛制，则**禁止利用其中一场比赛测试提交，以绕过错误提交造成的罚时或分数扣除等措施**。
> —— `docs/rules/community/contest-participation.md:60`

同一文件 `:80` 把这条行为列为作弊。这条规则本身就是双重证明：既证明**一题多赛是被承认的常态**，也证明**两场比赛的提交计分是各自独立的**（否则"用 A 赛试提交来规避 B 赛罚时"这件事在物理上不可能发生）。

---

## C. 提交归属 —— 关键问题

### C.1 Codeforces：提交恒属于恰好一场比赛，"模式"由 participantType 表达

`codeforces.com/apiHelp/objects` 中 `Submission` 与 `Party` 的定义（原文引用）：

`Submission`：

| Field | Description |
|---|---|
| `contestId` | Integer. **Can be absent.** |
| `relativeTimeSeconds` | Integer. **Number of seconds, passed after the start of the contest (or a virtual start for virtual parties), before the submission.** |
| `problem` | **Problem object.** |
| `author` | **Party object.** |
| `points` | Floating point number. Can be absent. Number of scored points for IOI-like contests. |

`Party`：

| Field | Description |
|---|---|
| `contestId` | Integer. Can be absent. **Id of the contest, in which party is participating.** |
| `participantType` | **Enum: CONTESTANT, PRACTICE, VIRTUAL, MANAGER, OUT_OF_COMPETITION.** |
| `ghost` | Boolean. If true then this party is a ghost. It participated in the contest, but not on Codeforces. |
| `startTimeSeconds` | Integer. Can be absent. **Time, when this party started a contest.** |

来源：<https://codeforces.com/apiHelp/objects>

注意结构：提交的归属信息出现了**三次**——`Submission.contestId`、`Submission.problem.contestId`、`Submission.author.contestId`。实测中三者恒等（见下）。而"这次提交算不算成绩"，不是靠一个布尔位，而是靠 **Party 的 participantType**。

各取值的含义（能用官方来源确认的部分）：

- **CONTESTANT** —— 正式参赛者。实测：Div.1/Div.2 比赛窗口内的提交绝大多数是这个类型。
- **OUT_OF_COMPETITION** —— 报名了但不参与正式排名。官方 FAQ 给出了它最典型的产生方式：「Usually, if you can't take part in the contest officially (e.g. **if it's the contest for the second division and you are in the first one**), then you can **register for the contest to participate out of competition**.」（<https://codeforces.com/help>）
- **PRACTICE** —— 比赛结束后的练习提交。实测：这是题库页提交的类型。
- **VIRTUAL** —— 虚拟参赛。`Submission.relativeTimeSeconds` 的定义里专门为它开了口子（"or a virtual start for virtual parties"），`Party.startTimeSeconds` 记录该 party 各自的开始时刻。
- **MANAGER** —— 比赛管理者。本次实测样本中未采集到该取值，**其精确触发条件 unverified**（枚举值本身有 apiHelp 佐证）。

Codeforces **如何指派 participantType**：由提交者相对该比赛的**参与状态**决定，不是由 URL 决定。最硬的证据是——**从题库页发起的提交，仍然带着原比赛的 contestId**：

```
$ curl -sS "https://codeforces.com/api/problemset.recentStatus?count=8"
  submission.contestId=2257  problem.contestId=2257  index=E  author.contestId=2257  participantType=PRACTICE
  submission.contestId=282   problem.contestId=282   index=A  author.contestId=282   participantType=PRACTICE
  submission.contestId=2174  problem.contestId=2174  index=A  author.contestId=2174  participantType=PRACTICE
  submission.contestId=158   problem.contestId=158   index=A  author.contestId=158   participantType=PRACTICE
  ...
```

**Codeforces 根本不存在"无比赛的提交池"。** 题库提交也是对 `(contestId, index)` 的提交，只是这个 Party 的 participantType 是 PRACTICE。唯一 `contestId` 缺席的情形是 acmsguru 那种本就没有比赛的外来题库：

```
$ curl -sS "https://codeforces.com/api/problemset.recentStatus?count=3&problemsetName=acmsguru"
  submission.contestId=ABSENT  problemsetName=acmsguru  index=106  participantType=PRACTICE
  submission.contestId=ABSENT  problemsetName=acmsguru  index=106  participantType=PRACTICE
  submission.contestId=ABSENT  problemsetName=acmsguru  index=100  participantType=PRACTICE
```

这正好解释了 apiHelp 里 `Submission.contestId` 那句 "Can be absent"。

**赛中从比赛页提交 vs 从题库页提交有什么不同？** 对于一场正在进行的常规 round，其题目**还没有进入题库**（见 §D.1 的实测：BEFORE 阶段的比赛在 `problemset.problems` 中有 0 道题），因此赛中根本不存在题库入口这条路径。真正的区分维度是 participantType：同一个 `(contestId, index)` 上，报名者提交得到 CONTESTANT，跨 Div 报名者得到 OUT_OF_COMPETITION，赛后来做的人得到 PRACTICE，开虚拟场的人得到 VIRTUAL。**"我在赛中用题库 URL 提交会怎样"这一具体交互我没有直接实测（需要账号 + 一场正在进行的比赛），标记 unverified。**

### C.2 Codeforces：一次提交能否在两场比赛同时计分？—— 不能

Round 1116 的两场比赛，取比赛窗口内的提交样本：

```
--- contest.status?contestId=2255 (Div.1，比赛窗口样本) ---
  submission.contestId=2255  problem.contestId=2255  index=A  participantType=CONTESTANT         n=394
  submission.contestId=2255  problem.contestId=2255  index=A  participantType=OUT_OF_COMPETITION n=2
  ...

--- contest.status?contestId=2256 (Div.2，比赛窗口样本) ---
  submission.contestId=2256  problem.contestId=2256  index=C  participantType=CONTESTANT         n=140
  submission.contestId=2256  problem.contestId=2256  index=C  participantType=OUT_OF_COMPETITION n=5
  ...
```

2255/A 与 2256/C 是**同一道题**（§B.3），但它们的提交池**完全不相交**：

- 每一条提交只有一个 `contestId`；样本中不存在 `submission.contestId != problem.contestId` 的记录。
- Div.1 选手打的是 2255/A，Div.2 选手打的是 2256/C，各自只出现在自己那场的 `contest.status` 里。

**结论：Codeforces 上一次提交只属于一场比赛、只在那一场计分。同一题被两场比赛引用时，提交入口是分开的两个 `(contestId, index)`。**

### C.3 DMOJ：比赛归属是一张**独立的连接行**，这是最清晰的一手证据

```python
# judge/models/contest.py:632-646
class ContestSubmission(models.Model):
    submission = models.OneToOneField(Submission, verbose_name=_('submission'),
                                      related_name='contest', on_delete=CASCADE)
    problem = models.ForeignKey(ContestProblem, verbose_name=_('problem'), on_delete=CASCADE,
                                related_name='submissions', related_query_name='submission')
    participation = models.ForeignKey(ContestParticipation, verbose_name=_('participation'), on_delete=CASCADE,
                                      related_name='submissions', related_query_name='submission')
    points = models.FloatField(default=0.0, verbose_name=_('points'))
    is_pretest = models.BooleanField(verbose_name=_('is pretested'),
                                     help_text=_('Whether this submission was ran only on pretests.'),
                                     default=False)

    class Meta:
        verbose_name = _('contest submission')
        verbose_name_plural = _('contest submissions')
```

逐条读这张表，它说明了四件事：

1. **`Submission` 本身不含比赛语义。** `Submission` 只有 `user`（`judge/models/submission.py:67`）和 `problem`（`:68`，指向全局 `Problem`）。一次提交首先是"某人对某题的一次评测"。
2. **比赛归属是一张单独的行。** `ContestSubmission` 把 submission 连到 `ContestProblem`（注意：不是 `Problem`——是"某比赛的某题"这个坐标）和 `ContestParticipation`（"某人在某比赛的某次参与"）。没有这一行，这次提交就不属于任何比赛。
3. **`submission` 是 `OneToOneField`（第 633 行）。** 这是"一次提交能否在多场比赛计分"的判决性答案：**在 DMOJ 上物理上不可能**。一条 `Submission` 至多挂一条 `ContestSubmission`，因此至多属于一场比赛的一次参与。
4. **比赛内得分单独存放。** `ContestSubmission.points`（第 639 行）与 `Submission.points`（`judge/models/submission.py:72`）是两个字段。前者是按本场 `ContestProblem` 规则折算出来的分。

折算逻辑本身也在源码里：

```python
# judge/models/submission.py:179-192
    def update_contest(self):
        try:
            contest = self.contest
        except AttributeError:
            return

        contest_problem = contest.problem
        contest.points = round(self.case_points / self.case_total * contest_problem.points
                               if self.case_total > 0 else 0, 3)
        if not contest_problem.partial and contest.points != contest_problem.points:
            contest.points = 0
        contest.save()
        contest.participation.recompute_results()
```

`self.contest` 就是那条 `ContestSubmission`（related_name），`contest.problem` 是 `ContestProblem`。评测原始结果（`case_points / case_total`）按**本场**的 `points` 与 `partial` 折算——同一次评测放进不同比赛会得到不同的分数。

此外 `Submission` 上还有一个反范式化的直接指针，仅用于查询：

```python
# judge/models/submission.py:88-89
    contest_object = models.ForeignKey('Contest', verbose_name=_('contest'), null=True, blank=True,
                                       on_delete=models.SET_NULL, related_name='+', db_index=False)
```

它是 `null=True` 的，且 `related_name='+'`（不建反向关系），配合 `judge/models/submission.py:247` 的索引 `models.Index(fields=['contest_object', 'problem', 'user', '-points', '-time'])` 使用。**权威归属是 `ContestSubmission`，`contest_object` 是它的缓存副本。**

**DMOJ 归属是怎么定的：靠"我现在人在哪场比赛"，而不是靠 URL。** 这是与 Codeforces 最大的架构差异。

提交 URL 只有一个，与比赛无关：

```python
# dmoj/urls.py:105-112
    path('problem/<str:problem>', include([
        path('', problem.ProblemDetail.as_view(), name='problem_detail'),
        ...
        path('/submit', problem.ProblemSubmit.as_view(), name='problem_submit'),
```

用户身上有一个"当前比赛"状态位：

```python
# judge/models/profile.py:180-181
    current_contest = models.OneToOneField('ContestParticipation', verbose_name=_('current contest'),
                                           null=True, blank=True, related_name='+', on_delete=models.SET_NULL)
```

它在"加入比赛"时被设上（`judge/views/contests.py:446`，位于 `join_contest` 内）：

```python
        profile.current_contest = participation
        profile.save()
```

提交时，视图拿当前比赛去反查这道题在**该场**比赛里的 `ContestProblem`：

```python
# judge/views/problem.py:46-50
def get_contest_problem(problem, profile):
    try:
        return problem.contests.get(contest_id=profile.current_contest.contest_id)
    except ObjectDoesNotExist:
        return None
```

```python
# judge/views/problem.py:621-625
    @cached_property
    def contest_problem(self):
        if self.request.profile.current_contest is None:
            return None
        return get_contest_problem(self.object, self.request.profile)
```

然后在一个事务里决定要不要建那条归属行：

```python
# judge/views/problem.py:720-737
        with transaction.atomic():
            self.new_submission = form.save(commit=False)

            contest_problem = self.contest_problem
            if contest_problem is not None:
                # Use the contest object from current_contest.contest because we already use it
                # in profile.update_contest().
                self.new_submission.contest_object = self.request.profile.current_contest.contest
                if self.request.profile.current_contest.live:
                    self.new_submission.locked_after = self.new_submission.contest_object.locked_after
                self.new_submission.save()
                ContestSubmission(
                    submission=self.new_submission,
                    problem=contest_problem,
                    participation=self.request.profile.current_contest,
                ).save()
            else:
                self.new_submission.save()
```

含义非常明确：**同一个 URL，同一个按钮。你"人在比赛里"就多建一条 `ContestSubmission`，不在就不建。** 如果这道题同时属于 5 场比赛，`get_contest_problem` 只会命中你当前所在的那一场，其余四场收不到任何东西。

`ContestParticipation` 用一个整数区分正式/虚拟/旁观：

```python
# judge/models/contest.py:513-525, 606
class ContestParticipation(models.Model):
    LIVE = 0
    SPECTATE = -1
    ...
    virtual = models.IntegerField(verbose_name=_('virtual participation id'), default=LIVE,
                                  help_text=_('0 means non-virtual, otherwise the n-th virtual participation.'))
    ...
        unique_together = ('contest', 'user', 'virtual')
```

比赛内的提交次数限制也是按 participation 数的，进一步证明计数是按 (比赛, 参与) 隔离的：

```python
# judge/views/problem.py:53-55
def get_contest_submission_count(problem, profile, virtual):
    return profile.current_contest.submissions.exclude(submission__status__in=['IE']) \
                  .filter(problem__problem=problem, participation__virtual=virtual).count()
```

### C.4 AtCoder：一次提交属于恰好一场比赛

由 §A.3 的 URL 实测直接得出：题目 URL、提交列表 URL、单条提交 URL 全部只在 `/contests/<contest>/` 下存在，全站级的 `/submissions`、`/submissions/<id>` 均返回 404。**提交没有比赛无关的表示形式，因此属于恰好一场比赛。** 赛后练习提交也落在原比赛下。

「一次提交能否在两场比赛计分」在 AtCoder 上不成立——AtCoder 的题目 ID 本身就绑死了比赛（`abc466_a`），观察不到跨比赛共享同一道题的情形。**AtCoder 是否存在任何"同题多赛"机制，unverified**（我没有找到官方文档描述这种机制，也没有观察到实例）。

### C.5 洛谷：赛内提交与平时提交明确区分

三条一手证据：

1. **赛中提交需要报名。** 「当用户没有登录，或者**没有报名该题目所在的正在进行中的比赛**，将无法提交评测。」（`docs/manual/luogu/problem/index.md:11`）注意措辞——判定依据是"该题目所在的正在进行中的比赛"与"你有没有报名"，而不是 URL。
2. **提交记录自身携带"是否比赛提交"的属性。** 代码公开计划一节写：「当用户的某道题达到 60 分，且已加入代码公开计划，就可以查看其他加入代码公开计划的用户这道题的代码。……**比赛代码不可查看。**」（`docs/manual/luogu/account/setting.md:12`）平台必须知道某条记录是不是比赛提交，才能执行这条规则。
3. **两场同时进行的比赛引用同一题时，计分互相独立。** 见 §B.5 引用的 `docs/rules/community/contest-participation.md:60` 与 `:80`。禁止"用其中一场比赛测试提交来规避另一场的罚时/扣分"，前提正是**两场各自记各自的提交次数与罚时**。

**洛谷是否也像 DMOJ 那样存在"进入比赛模式"的全局状态位，还是像 Codeforces 那样按 URL 区分入口，属于实现细节，unverified**（官方文档未描述）。

---

## D. 赛前保密与赛后公开

### D.1 Codeforces

**赛前**：比赛这个对象本身是公开的（`contest.list` 能列出未开始的比赛，含 id、name、startTimeSeconds、`phase: BEFORE`），但**题目不可达**。API 明确拒绝：

```
  contestId=2261  phase=BEFORE  Codeforces Round (Div. 1 + Div. 2)
    contest.standings -> {"status":"FAILED","comment":"contestId: Contest with id 2261 has not started"}
  contestId=2260  phase=BEFORE  Educational Codeforces Round 194 (Rated for Div. 2)
    contest.standings -> {"status":"FAILED","comment":"contestId: Contest with id 2260 has not started"}
  contestId=2259  phase=BEFORE  Codeforces Round (Div. 3)
    contest.standings -> {"status":"FAILED","comment":"contestId: Contest with id 2259 has not started"}
```

`Contest.phase` 是 API 的一等字段：「Enum: BEFORE, CODING, PENDING_SYSTEM_TEST, SYSTEM_TEST, FINISHED.」（<https://codeforces.com/apiHelp/objects>）**可见性是从比赛的时间窗口推导出来的，题目上没有独立的可见性开关。**

赛中保密由规则约束：「Don't publish or spread your solutions and solution ideas during the contest.」（<https://codeforces.com/help>）

**赛后**：题目进入题库。官方 FAQ 的说法：

> I've noticed that the site contains the solutions of all the contestants and the previous contests' tests. How is it allowed to use them?
> **In fact, we publish materials from the past contests and they can be used, for example, for individual lessons.** Using the materials on other Online Judges, public contests, etc. is prohibited.
> —— <https://codeforces.com/help>

实测对照（阶段 vs 是否在题库中）：

```
  contestId=2261  phase=BEFORE    problems present in problemset.problems = 0
  contestId=2260  phase=BEFORE    problems present in problemset.problems = 0
  contestId=2259  phase=BEFORE    problems present in problemset.problems = 0
  contestId=2255  phase=FINISHED  problems present in problemset.problems = 7
  contestId=2256  phase=FINISHED  problems present in problemset.problems = 2
```

**归档的确切触发时刻（比赛结束瞬间 / system test 之后 / 是否需要人工动作）我没有找到官方表述，unverified。** 能证实的是：BEFORE 阶段 0 道，FINISHED 阶段全部在列，且不需要出题人另行操作（Div.2 只有 2 道是因为另外 4 道以 Div.1 坐标归档了，见 §B.3）。

### D.2 AtCoder

**赛前**：比赛页公开，题目页被权限拦截。实测（当前时间 2026-09-01 14:38 UTC）：

```
  abc466   window=2026-07-11 21:00 → 22:40 (+0900)   /contests/abc466 -> 200   /tasks -> 200
  abc474   window=2026-09-06 13:10 → 14:50 (+0900)   /contests/abc474 -> 200   /tasks -> 404 Permission denied.
  abc475   window=2026-09-12 21:00 → 22:40 (+0900)   /contests/abc475 -> 200   /tasks -> 404 Permission denied.
  arc230   window=2026-09-20 21:00 → 23:30 (+0900)   /contests/arc230 -> 200   /tasks -> 404 Permission denied.
  abc477   window=2026-09-26 21:00 → 22:40 (+0900)   /contests/abc477 -> 200   /tasks -> 404 Permission denied.
```

已结束的 abc466 的 `/tasks` 返回 200；四场未来比赛全部返回 **404 且页面正文写 "Permission denied."**。**与 Codeforces 同构：可见性由比赛时间窗口推导，题目上没有独立开关。**

赛中保密由官方比赛规则约束（<https://atcoder.jp/contests/abc466/rules>）：

> Do not disclose the problem on the Internet during the contest. Also refrain from reporting the contest on the spot as it might lead to the disclosure of the problem.

规则页还逐条列举了赛中不得泄露的"非公开信息"：

> - The number of WAs, the number of TLEs, the number of test cases, etc. **This information is not public until the contest ends.**
> - Problem names, statements, genres, constraints, etc. **This information is also not public until the contest ends.**

**赛后**：题目继续留在原比赛下并对所有人开放（abc466 的 `/tasks` 返回 200），**不会迁移到任何全局题库**——因为 AtCoder 根本没有全局题库（§A.3）。所以 AtCoder 的"赛后公开"就是同一个 URL 从 permission denied 变成 200，没有搬家动作。

### D.3 洛谷：赛后入库是**人工操作**，不是自动开关

洛谷是四家里唯一把"赛后公开"写成显式人工步骤的：

> 赛后收尾工作：
> - 审核管理应及时将月赛题目**加入主题库**，注意修改题目提供者为**出题人**，**将题目状态改为「公众可见」**，添加对应题目的**算法标签**。
> —— `docs/rules/academic/lgr/contest-standard.md:103`

> - 没有出锅的话题目都会在**赛后立刻加进主题库**（有必要时，请**催促审核员**）。
> - 比赛结束后，题目加入主题库时，审核员需要添加对应题目的**算法标签**，以供用户筛选。所有题目都需要有至少一个算法标签。
> —— `docs/rules/academic/lgr/review.md:66, 70`

「有必要时，请催促审核员」这半句本身就说明**没有"赛后自动公开"开关**——它是一件由人执行、可能被忘记的运维动作。

公开赛的默认策略是入库，但**可以退出**：

> **所有公开赛题目默认加入主题库**，题目贡献者为出题人。**如果出题人不愿意将题目加入主题库，请提前私信管理。**
> —— `docs/rules/academic/opencontest-standard.md:55`

反过来，进入主题库的唯一正规通道也是公开赛：

> 洛谷原则上不接受个人零散投题，如果你想让洛谷收录你出的题目**必须通过公开赛的形式申请，公开赛顺利结束后收录至主题库**。
> —— `docs/rules/academic/problem-standard.md:138`

**赛前保密**靠的是题目自身的可见性字段（§A.4）：验题时正确做法是「将私题迁移至团队内，并设置为**仅团队可见**，让验题人加入团队进行验题」，官方明确**不推荐**把私题设成"公众可见"来给验题人看（`docs/rules/academic/lgr/review.md:35`、`docs/rules/academic/lgr/contest-standard.md:93`）。

比赛侧另有报名门槛：个人邀请赛/团队邀请赛用**邀请码**，支持固定邀请码或一人一码的多邀请码（`docs/manual/luogu/team/index.md:95, 99, 103`）；团队内部赛「仅限团队内部成员参加」（`docs/manual/luogu/contest.md:13`）。

### D.4 DMOJ：题目的可见性是题目自己的，比赛只是**临时授予**访问权

DMOJ 在这一题上给出的答案最完整，因为能读到全部代码。它的做法可以概括成一句话：**比赛题目不靠"藏"，靠"题目本身默认就是私有的"；比赛只是在你处于比赛中时临时开一扇门。**

#### (1) 题目默认私有

```python
# judge/models/problem.py:155
    is_public = models.BooleanField(verbose_name=_('publicly visible'), db_index=True, default=False)
```

`default=False`。一道新建的题目**不在公开题库里**，与任何比赛无关。

#### (2) 公开列表只查 `is_public=True`，因此比赛题目根本不会出现在里面

```python
# judge/models/problem.py:316-317
    def get_public_problems(cls):
        return cls.objects.filter(is_public=True, is_organization_private=False).defer('description')
```

```python
# judge/models/problem.py:259-298（节选）
    def get_visible_problems(cls, user):
        # Do unauthenticated check here so we can skip authentication checks later on.
        if not user.is_authenticated:
            return cls.get_public_problems()
        ...
        if not (user.has_perm('judge.see_private_problem') or edit_all_problem):
            q = Q(is_public=True)
            if not (user.has_perm('judge.see_organization_problem') or edit_public_problem):
                # Either not organization private or in the organization.
                q &= Q(is_organization_private=False) | cls.organization_filter_q(...)
            if edit_own_problem:
                q |= cls.organization_filter_q(...)
            # Authors, curators, and testers should always have access.
            q = cls.q_add_author_curator_tester(q, user.profile)
            queryset = queryset.filter(q)
        return queryset
```

**注意 `get_visible_problems` 里完全没有"比赛"这个概念。** 它只认 `is_public`、组织归属、以及 author/curator/tester 三种个人关系。题目列表页走的是同一条路：

```python
# judge/views/problem.py:441-442
    def get_normal_queryset(self):
        filter = Q(is_public=True)
```

所以一道 `is_public=False` 的比赛题目，**在任何时间点（赛前、赛中、赛后）都不会漏进公开题目列表**，除非有人显式把它改成 public。这就是"防泄漏"的全部机制——不是过滤，是它压根就不在集合里。

#### (3) 比赛中的题目列表是**另一个 queryset**，只列本场题目

```python
# judge/views/problem.py:485-489
    def get_queryset(self):
        if self.in_contest:
            return self.get_contest_queryset()
        else:
            return self.get_normal_queryset()
```

```python
# judge/views/problem.py:410-418（节选）
    def get_contest_queryset(self):
        queryset = self.profile.current_contest.contest.contest_problems.select_related('problem__group') \
            .defer('problem__description').order_by('problem__code') \
            ...
            .order_by('order')
```

比赛中你看到的不是"过滤后的题库"，而是**本场比赛的 `ContestProblem` 集合**，按 `order` 排。两条路径互不相干。

#### (4) 单题访问：`is_accessible_by` 由比赛**临时授予**

```python
# judge/models/problem.py:212-253
    def is_accessible_by(self, user, skip_contest_problem_check=False):
        # If we don't want to check if the user is in a contest containing that problem.
        if not skip_contest_problem_check and user.is_authenticated:
            # If user is currently in a contest containing that problem.
            current = user.profile.current_contest_id
            if current is not None:
                from judge.models import ContestProblem
                if ContestProblem.objects.filter(problem_id=self.id, contest__users__id=current).exists():
                    return True

        # Problem is public.
        if self.is_public:
            # Problem is not private to an organization.
            if not self.is_organization_private:
                return True

            # If the user can see all organization private problems.
            if user.has_perm('judge.see_organization_problem'):
                return True

            # If the user is in the organization.
            if user.is_authenticated and \
                    self.organizations.filter(id__in=user.profile.organizations.all()):
                return True

        if not user.is_authenticated:
            return False

        # If the user can view all problems.
        if user.has_perm('judge.see_private_problem'):
            return True

        # If the user can edit the problem.
        # We are using self.editor_ids to take advantage of caching.
        if self.is_editable_by(user) or user.profile.id in self.editor_ids:
            return True

        # If user is a tester.
        if self.testers.filter(id=user.profile.id).exists():
            return True

        return False
```

这是整套机制的枢纽。读法：

- **第一个分支就是"比赛授权"**：如果你的 `current_contest` 所在比赛包含这道题，直接放行。这是一个**因你的会话状态而临时成立的权限**，不改变题目本身的 `is_public`。你一离开比赛，这扇门就关了。
- 之后才是常规判定：public（且组织可见）、`see_private_problem` 权限、可编辑者、tester。
- **默认 return False。** 默认拒绝。
- 参数 `skip_contest_problem_check` 的存在说明这个"比赛临时授权"是被有意识地隔离出来的一块，调用方可以选择不要它。

题目详情页把它作为唯一闸门：

```python
# judge/views/problem.py:63-67
    def get_object(self, queryset=None):
        problem = super(ProblemMixin, self).get_object(queryset)
        if not problem.is_accessible_by(self.request.user):
            raise Http404()
        return problem
```

DMOJ 自己的测试断言 `is_accessible_by` 与 `get_visible_problems` 必须一致（`judge/models/tests/test_problem.py:303-316`）：

```python
    def test_problems_list(self):
        for name, user in self.users.items():
            with self.subTest(user=name):
                with self.subTest(list='accessible problems'):
                    # We only care about consistency between Problem.is_accessible_by and Problem.get_visible_problems
                    problem_codes = []
                    for problem in Problem.objects.prefetch_related('authors', 'curators', 'testers', 'organizations'):
                        if problem.is_accessible_by(user):
                            problem_codes.append(problem.code)

                    self.assertCountEqual(
                        Problem.get_visible_problems(user).distinct().values_list('code', flat=True),
                        problem_codes,
                    )
```

#### (5) 比赛侧的可见性字段

```python
# judge/models/contest.py:94-97
    is_visible = models.BooleanField(verbose_name=_('publicly visible'), default=False,
                                     help_text=_('Should be set even for organization-private contests, where it '
                                                 'determines whether the contest is visible to members of the '
                                                 'specified organizations.'))
```

```python
# judge/models/contest.py:128-134
    is_private = models.BooleanField(verbose_name=_('private to specific users'), default=False)
    private_contestants = models.ManyToManyField(Profile, blank=True, verbose_name=_('private contestants'),
                                                 help_text=_('If non-empty, only these users may see the contest.'),
                                                 related_name='private_contestants+')
    hide_problem_tags = models.BooleanField(verbose_name=_('hide problem tags'),
                                            help_text=_('Whether problem tags should be hidden by default.'),
                                            default=False)
```

```python
# judge/models/contest.py:147-149
    is_organization_private = models.BooleanField(verbose_name=_('private to organizations'), default=False)
    organizations = models.ManyToManyField(Organization, blank=True, verbose_name=_('organizations'),
                                           help_text=_('If non-empty, only these organizations may see the contest.'))
```

```python
# judge/models/contest.py:165-167
    access_code = models.CharField(verbose_name=_('access code'), blank=True, default='', max_length=255,
                                   help_text=_('An optional code to prompt contestants before they are allowed '
                                               'to join the contest. Leave it blank to disable.'))
```

`is_visible` 同样 `default=False`。

**关于问题中提到的 `Contest.hide_scoreboard`：该字段已被删除。** 迁移 `judge/migrations/0115_contest_scoreboard_visibility.py` 把布尔字段 `hide_scoreboard` 换成了四态枚举 `scoreboard_visibility`（该迁移第 8 行把 `hide_scoreboard=True` 的比赛映射为 `'C'`，第 29-31 行 `RemoveField` 掉旧字段）：

```python
# judge/models/contest.py:58-67
    SCOREBOARD_VISIBLE = 'V'
    SCOREBOARD_AFTER_CONTEST = 'C'
    SCOREBOARD_AFTER_PARTICIPATION = 'P'
    SCOREBOARD_HIDDEN = 'H'
    SCOREBOARD_VISIBILITY = (
        (SCOREBOARD_VISIBLE, _('Visible')),
        (SCOREBOARD_AFTER_CONTEST, _('Hidden for duration of contest')),
        (SCOREBOARD_AFTER_PARTICIPATION, _('Hidden for duration of participation')),
        (SCOREBOARD_HIDDEN, _('Hidden permanently')),
    )
```

（字段声明在 `judge/models/contest.py:107-109`。）

比赛访问判定用异常而不是布尔，以便区分"看不见"和"私有"：

```python
# judge/models/contest.py:340-400（节选）
    class Inaccessible(Exception):
        pass

    class PrivateContest(Exception):
        pass

    def access_check(self, user):
        # Do unauthenticated check here so we can skip authentication checks later on.
        if not user.is_authenticated:
            # Unauthenticated users can only see visible, non-private contests
            if not self.is_visible:
                raise self.Inaccessible()
            if self.is_private or self.is_organization_private:
                raise self.PrivateContest()
            return

        # If the user can view or edit all contests
        if user.has_perm('judge.see_private_contest') or user.has_perm('judge.edit_all_contest'):
            return
        # User is organizer or curator for contest
        if user.profile.id in self.editor_ids:
            return
        # User is tester for contest
        if user.profile.id in self.tester_ids:
            return
        # User is spectator for contest
        if user.profile.id in self.spectator_ids:
            return
        # Contest is not publicly visible
        if not self.is_visible:
            raise self.Inaccessible()
        # Contest is not private
        if not self.is_private and not self.is_organization_private:
            return
        ...
        if self.is_private and self.is_organization_private:
            if in_org and in_users:
                return
            raise self.PrivateContest()
```

```python
# judge/models/contest.py:441-447
    def is_accessible_by(self, user):
        try:
            self.access_check(user)
        except (self.Inaccessible, self.PrivateContest):
            return False
        else:
            return True
```

```python
# judge/models/contest.py:221-225
    def is_in_contest(self, user):
        if user.is_authenticated:
            profile = user.profile
            return profile and profile.current_contest is not None and profile.current_contest.contest == self
        return False
```

`is_in_contest` 判的是"你的 `current_contest` 是否正是这场"——同样是会话状态，不是权限表。

`access_code` 在加入比赛时校验（`judge/views/contests.py:398`）：

```python
        requires_access_code = (not self.can_edit and contest.access_code and access_code != contest.access_code)
```

列表侧的过滤（`judge/models/contest.py:461-484`，节选）：

```python
    def get_visible_contests(cls, user):
        if not user.is_authenticated:
            return cls.objects.filter(is_visible=True, is_organization_private=False, is_private=False) \
                              .defer('description').distinct()
        ...
            q = Q(is_visible=True)
            q &= (
                Q(view_contest_scoreboard=user.profile) |
                Q(is_organization_private=False, is_private=False) |
                Q(is_organization_private=False, is_private=True, private_contestants=user.profile) |
                (Q(is_organization_private=True, is_private=False) & org_check) |
                (Q(is_organization_private=True, is_private=True, private_contestants=user.profile) & org_check)
            )
            q |= Q(authors=user.profile)
            q |= Q(curators=user.profile)
            q |= Q(testers=user.profile)
            q |= Q(spectators=user.profile)
```

**小结（DMOJ 如何防止比赛题目在赛前/赛中泄漏到公开题目列表）：**

1. 题目 `is_public` 默认 `False`，比赛题目本来就不在公开集合里；
2. 公开列表（`get_public_problems` / `get_visible_problems` / `get_normal_queryset`）只按 `is_public` 等题目自身属性取集合，**完全不感知比赛**，所以不存在"忘了过滤"这种失败模式；
3. 比赛中的题目列表走**另一条 queryset**（`get_contest_queryset`），只列本场 `ContestProblem`；
4. 单题访问经 `is_accessible_by`，比赛只在你 `current_contest` 命中时**临时授予**访问权，默认拒绝；
5. 赛前给验题人看题，用的是题目自己的 `testers` 字段（`judge/models/problem.py:130-132`，help_text 写明 "These users will be able to view the private problem, but not edit it."），而不是改 `is_public`；
6. 赛后是否公开，是人工把 `is_public` 改成 `True`——**DMOJ 源码中没有任何按比赛结束时间自动翻转 `is_public` 的逻辑**（`Problem.date` 字段的 help_text 甚至专门写了 "Doesn't have the magic ability to auto-publish due to backward compatibility."，`judge/models/problem.py:158-160`）。

---

## E. 横向对比

| 维度 | Codeforces | DMOJ | AtCoder | 洛谷 |
|---|---|---|---|---|
| 题目主键 | `(contestId, index)` | 全局 `Problem.code` | `/contests/<c>/tasks/<task_id>` | 全局题号 `P/B/U/T####` |
| 全局题库 | 有，但是已结束比赛题目的视图 | 有，`is_public=True` 的集合 | **无** | 有，主题库（P/B） |
| 题目自带可见性字段 | 无（由比赛窗口推导） | **有**（`is_public` + `is_organization_private`） | 无（由比赛窗口推导） | **有**（公众可见 / 仅团队可见 …） |
| 比赛↔题目关系 | 题目**属于**比赛 | `ContestProblem` 连接表 | 题目**属于**比赛 | 比赛**引用**题目 |
| 同题多赛 | 支持（mashup / Div1+Div2），每处一个身份 | schema 明确支持 | 未观察到 | 支持，官方规则专门规定 |
| 比赛内参数（分值/罚时/提交上限） | 挂在比赛内的 Problem 视图上 | 挂在 `ContestProblem` 上 | 挂在题目上 | unverified（文档未描述存储位置） |
| 提交归属载体 | `Submission.contestId` + `Party.participantType` | **独立行 `ContestSubmission`** | URL 路径 | 提交记录带比赛属性 |
| 一次提交可否多赛计分 | **否** | **否**（OneToOneField 物理禁止） | 否 | **否**（规则反证） |
| 归属由什么决定 | 提交者对该比赛的参与状态 | **`profile.current_contest`（会话状态）** | URL | 是否报名了该题所在的进行中比赛 |
| 赛后公开 | 自动进入题库 | 人工改 `is_public` | 同一 URL 解锁，不搬家 | **人工**改为"公众可见"并入主题库 |

值得单独指出的一条设计分歧：**归属由什么决定**。

- **Codeforces / AtCoder：由入口决定。** 每场比赛给同一道题各开一个 URL，你走哪个门就算哪场。
- **DMOJ：由状态决定。** 全站只有一个 `/problem/<code>/submit`，你身上有一个 `current_contest` 状态位，提交时系统拿它去反查 `ContestProblem`。门只有一扇，算哪场取决于你"人在哪"。
- **洛谷：由报名关系决定。** 「没有报名该题目所在的正在进行中的比赛，将无法提交评测」——判定依据是报名关系。

三种做法的共同结论是一样的：**归属是一条 (提交, 比赛坐标) 的显式记录，不是从题目推导出来的。**

---

## F. 未能证实的条目（unverified）

| # | 命题 | 状态 |
|---|---|---|
| 1 | 「Codeforces mashup 一律 unrated」 | 由"mashup 挂在 Gym 下"+"Gym 无 rating change"推出，无官方原话。**unverified（作为直接陈述）** |
| 2 | 在 mashup 中通过一道题，是否同时把归档原题标记为已解决 | 未找到一手来源。**unverified** |
| 3 | Codeforces `participantType = MANAGER` 的精确触发条件 | 枚举值有 apiHelp 佐证，本次采样未命中该值。**unverified** |
| 4 | Codeforces 赛中用题库 URL 提交会得到什么 participantType | 需账号 + 进行中的比赛，未直接实测。**unverified** |
| 5 | Codeforces 题目进入题库的确切触发时刻（结束瞬间 / system test 后 / 人工） | 只证实了 BEFORE=0、FINISHED=全部。**unverified** |
| 6 | AtCoder 是否存在任何"同题多赛"机制 | 未找到官方描述，也未观察到实例。**unverified** |
| 7 | 洛谷「题目状态」枚举的完整取值列表 | 只证实了「公众可见」与「仅团队可见」两个取值。完整列表 **unverified** |
| 8 | 洛谷是否有 DMOJ 式的"进入比赛模式"全局状态位 | 属实现细节，官方文档未描述。**unverified** |
| 9 | 洛谷比赛内分值 / 罚时参数存储在题目上还是"比赛-题目"关系上 | 官方文档未描述。**unverified** |

---

## 对三个问题的直接回答

### 1. 赛题与比赛一起发布时，题目自身如何声明可见性？

**分成两种截然不同的架构，各占一半。**

**（甲）题目没有自己的可见性 —— 从比赛时间窗口推导。Codeforces 与 AtCoder 属于此类。**

在这两家，题目本来就"住在"比赛里，`(contestId, index)` 或 `/contests/<c>/tasks/<t>` 就是它的全部身份，因此不需要、也没有独立的可见性字段。比赛对象本身始终公开（能看到名字和开始时间），题目则被时间窗口锁住：

- Codeforces：`Contest.phase ∈ {BEFORE, CODING, PENDING_SYSTEM_TEST, SYSTEM_TEST, FINISHED}`（<https://codeforces.com/apiHelp/objects>）。phase=BEFORE 时 API 直接拒绝：`{"status":"FAILED","comment":"contestId: Contest with id 2261 has not started"}`。
- AtCoder：`/contests/abc474` 返回 200，`/contests/abc474/tasks` 返回 404 且正文写 `Permission denied.`；已结束的 abc466 同一路径返回 200。

**（乙）题目有自己的可见性字段 —— 与比赛正交。DMOJ 与洛谷属于此类。**

- **DMOJ**：`Problem.is_public`，`default=False`（`judge/models/problem.py:155`），外加 `is_organization_private` + `organizations`（`:179-181`）。比赛**不改**这个字段，只是在 `is_accessible_by` 的第一个分支里因你的 `current_contest` 命中而**临时**放行（`judge/models/problem.py:212-220`）。赛前给验题人看题用的是题目自己的 `testers` 字段（`:130-132`），也不动 `is_public`。DMOJ 源码里没有任何"比赛结束自动 publish"的逻辑；`Problem.date` 的 help_text 反而明说 "Doesn't have the magic ability to auto-publish due to backward compatibility."（`:158-160`）。
- **洛谷**：题目有可设置的可见性 / 题目状态，官方文档确认的取值至少有「公众可见」与「仅团队可见」。月赛流程明确规定验题时**不要**把私题设成公众可见，正确做法是「将私题迁移至团队内，并设置为**仅团队可见**」（`docs/rules/academic/lgr/review.md:35`）；赛后由审核管理「**将题目状态改为公众可见**」（`docs/rules/academic/lgr/contest-standard.md:103`）。题号前缀（P/B 公开、U 私有、T 团队）同时也是所属题库的标识（`docs/rules/academic/training-promotion-standard.md:45`）。

**对架构设计的含义：** 如果题目要能脱离比赛独立存在（可复用、可进题库、可被多场引用），它就**必须**有自己的可见性字段——DMOJ 和洛谷都是这么做的。反过来，如果题目身份天然绑定比赛（Codeforces、AtCoder），可见性可以直接从比赛窗口推导，但代价是复用必须另建一套机制（Codeforces 的 mashup），而 AtCoder 干脆就不复用。

### 2. 新比赛引用已有题目，是否常见 / 一等公民？

**是一等公民，四家里有三家明确支持，并且都为它建了专门的机制。**

- **Codeforces —— 是，站长本人称之为核心用途。** MikeMirzayanov 的官方博客原话：「It seems that now it will be **easier to reuse problems from the archive** for educational and other purposes. As you know, **problems from past Codeforces rounds can be added to mashups simply by their codes of the form like `1234D` (contest ID + problem letter)**.」（<https://codeforces.com/blog/entry/84795>）引用是**按 ID** 的，不是拷贝。而且引用点上还支持**覆盖题面和样例**（同一博客："now you can rewrite statements for problems in mashups, completely replacing it with your own"，"if you added examples, then solutions will be judged on them first, and only after on official tests"）——题目本体共享，展示层可被引用方覆盖。此外 Div.1/Div.2 同题是官方常规排期，Round 1116 的 4 道题同时是 2255/A–D 和 2256/C–F。
- **DMOJ —— 是，schema 明确允许。** `ContestProblem.Meta.unique_together = ('problem', 'contest')`（`judge/models/contest.py:626`）：唯一约束落在**这一对**上，只禁止同题在同赛重复，不限制同题进多赛。`ContestProblem.problem` 的 `related_name='contests'`（`:610`）是复数反向关系。所有比赛内语义（`points`、`partial`、`is_pretested`、`order`、`max_submissions`）都在连接表上，所以同一题在不同比赛可以有完全不同的赛制与分值。
- **洛谷 —— 是，是产品功能且官方规则为之立法。** 「比赛题目可选用**洛谷公开题目**、其他 OJ（RemoteJudge）题目以及团队内部题目」（`docs/manual/luogu/team/index.md:87`）。官方参赛规则更是直接为「**当一道题目被用于两场以上同时举办的公开比赛时**」写了专门条款（`docs/rules/community/contest-participation.md:60`）——平台不仅允许，还预料到了并发引用。
- **AtCoder —— 否（未观察到）。** 题目 ID 内嵌比赛（`abc466_a`），不存在比赛外的题目 URL，也没找到任何同题多赛的官方机制。**unverified**，但至少可以说它不是一等公民。

需要区分的一点：**Codeforces 的 Gym 与 mashup 不是同一种复用。** Gym 是把一整场外部比赛（题目数据、checker、原始榜单、ghost 选手）**导入**成一场自带题目的新比赛（<https://codeforces.com/blog/entry/3676>）；mashup 才是按 ID 引用站内已有题目（<https://codeforces.com/blog/entry/10099>、<https://codeforces.com/blog/entry/84795>）。两者都挂在 Gym 页面下。

### 3. 同一题被多场比赛引用时，提交入口是否分开？一次提交能否在多场比赛计分？

**入口分开；一次提交只能在一场计分。四家平台无一例外。**

#### Codeforces 的确凿证据

`codeforces.com/apiHelp/objects` 给出结构：`Submission` 有 `contestId`（"Can be absent."）和 `author`（一个 `Party`）；`Party` 有 `contestId`（"Id of the contest, in which party is participating."）和 `participantType`（"Enum: **CONTESTANT, PRACTICE, VIRTUAL, MANAGER, OUT_OF_COMPETITION**."）。

**(a) 入口分开。** Round 1116 的 *Hot Potatoes at the Fairy Warehouse* 一题，API 报告两个身份：Div.1 里是 `contestId=2255, index=A, points=500`，Div.2 里是 `contestId=2256, index=C, points=1500`。同一道题，两个 `(contestId, index)`，两个 URL，两套分值。

**(b) 提交池不相交。** 比赛窗口内的实测：

```
  submission.contestId=2255  problem.contestId=2255  index=A  participantType=CONTESTANT  n=394
  submission.contestId=2256  problem.contestId=2256  index=C  participantType=CONTESTANT  n=140
```

每条提交只有一个 `contestId`，样本中不存在 `submission.contestId != problem.contestId` 的记录。Div.1 选手的提交只出现在 2255 的 `contest.status` 里，Div.2 选手的只出现在 2256 里。

**(c) participantType 才是"这次算不算成绩"的开关，而不是有没有 contestId。** 决定性证据：**从题库页发起的练习提交，仍然带着原比赛的 contestId**——

```
  submission.contestId=2257  problem.contestId=2257  index=E  author.contestId=2257  participantType=PRACTICE
  submission.contestId=282   problem.contestId=282   index=A  author.contestId=282   participantType=PRACTICE
```

Codeforces **没有"无比赛的提交池"**。题库提交也是对 `(contestId, index)` 的提交，只是 Party 类型是 PRACTICE。`contestId` 唯一缺席的情形是 acmsguru 这种本就没有比赛的外来题库（`submission.contestId=ABSENT, problemsetName=acmsguru, participantType=PRACTICE`），这正好解释了 apiHelp 里那句 "Can be absent"。

各取值的分配依据是**提交者相对该比赛的参与状态**：正式报名 → CONTESTANT；跨 Div 报名 → OUT_OF_COMPETITION（官方 FAQ：「if it's the contest for the second division and you are in the first one, then you can register for the contest to participate out of competition」，<https://codeforces.com/help>）；赛后练习 → PRACTICE；虚拟参赛 → VIRTUAL（`Party.startTimeSeconds` 记录各自的虚拟开始时刻）。

#### DMOJ 的确凿证据

```python
# judge/models/contest.py:632-642
class ContestSubmission(models.Model):
    submission = models.OneToOneField(Submission, verbose_name=_('submission'),
                                      related_name='contest', on_delete=CASCADE)
    problem = models.ForeignKey(ContestProblem, verbose_name=_('problem'), on_delete=CASCADE,
                                related_name='submissions', related_query_name='submission')
    participation = models.ForeignKey(ContestParticipation, verbose_name=_('participation'), on_delete=CASCADE,
                                      related_name='submissions', related_query_name='submission')
    points = models.FloatField(default=0.0, verbose_name=_('points'))
    is_pretest = models.BooleanField(verbose_name=_('is pretested'),
                                     help_text=_('Whether this submission was ran only on pretests.'),
                                     default=False)
```

四条读法：

1. **比赛归属是一张独立的行，不是 `Submission` 上的字段。** `Submission` 自己只有 `user` 和指向全局 `Problem` 的 `problem`（`judge/models/submission.py:67-68`）。没有 `ContestSubmission` 这一行，这次提交就不属于任何比赛。
2. **它连的是 `ContestProblem` 而不是 `Problem`**（第 635 行）——归属指向的是"**某比赛的某题**"这个坐标，外加 `participation`（"某人在某比赛的某次参与"，第 637 行）。
3. **`submission` 是 `OneToOneField`（第 633 行）** ——这是"一次提交能否在多场比赛计分"的判决性答案：**在 DMOJ 上物理上不可能**。一条 `Submission` 至多挂一条 `ContestSubmission`。
4. **比赛内得分单独存放**（第 639 行 `ContestSubmission.points`，区别于 `Submission.points`），按本场 `ContestProblem.points` 与 `partial` 折算（`judge/models/submission.py:179-192`）。同一次评测放进不同比赛会算出不同的分。

**归属由会话状态决定，不由 URL 决定。** 全站只有一个提交入口 `/problem/<code>/submit`（`dmoj/urls.py:111`）。用户身上有 `Profile.current_contest`（`judge/models/profile.py:180-181`，一个指向 `ContestParticipation` 的 OneToOne），在加入比赛时设上（`judge/views/contests.py:446`）。提交时：

```python
# judge/views/problem.py:46-50
def get_contest_problem(problem, profile):
    try:
        return problem.contests.get(contest_id=profile.current_contest.contest_id)
    except ObjectDoesNotExist:
        return None
```

```python
# judge/views/problem.py:723-735
            contest_problem = self.contest_problem
            if contest_problem is not None:
                self.new_submission.contest_object = self.request.profile.current_contest.contest
                if self.request.profile.current_contest.live:
                    self.new_submission.locked_after = self.new_submission.contest_object.locked_after
                self.new_submission.save()
                ContestSubmission(
                    submission=self.new_submission,
                    problem=contest_problem,
                    participation=self.request.profile.current_contest,
                ).save()
            else:
                self.new_submission.save()
```

**如果一道题同时属于 5 场比赛，`get_contest_problem` 只会命中你当前所在的那一场，其余四场收不到任何东西。** 这就是 DMOJ 版本的"入口分开"——不是分开的 URL，是分开的会话状态。

（`Submission.contest_object`，`judge/models/submission.py:88-89`，`null=True` + `related_name='+'`，是为查询建的反范式化缓存，配合 `:247` 的复合索引使用；权威归属仍是 `ContestSubmission`。）

#### AtCoder

提交没有比赛无关的表示形式：`/submissions` 与 `/submissions/<id>` 均 404，`/contests/<c>/submissions` 与 `/contests/<c>/submissions/<id>` 存在。因此一次提交属于恰好一场比赛。赛后练习提交也落在原比赛下（`/contests/abc466/submit` 路由在比赛结束后依然存在）。

#### 洛谷

**入口按报名关系分开：** 「当用户没有登录，或者**没有报名该题目所在的正在进行中的比赛**，将无法提交评测。」（`docs/manual/luogu/problem/index.md:11`）

**提交记录自带"是否比赛提交"属性：** 代码公开计划规定「**比赛代码不可查看**」（`docs/manual/luogu/account/setting.md:12`）——平台必须能区分这两类记录才能执行。

**两场同时进行的比赛各自独立计分——由官方规则反证：**

> **当一道题目被用于两场以上同时举办的公开比赛时**，如果其中一场比赛采用了乐多赛制，ICPC 赛制等成绩与提交次数有关的赛制，则**禁止利用其中一场比赛测试提交，以绕过错误提交造成的罚时或分数扣除等措施**。
> —— `docs/rules/community/contest-participation.md:60`（`:80` 把该行为列为作弊）

这条规则要成立，前提必须是**两场比赛各自记各自的提交次数与罚时**。如果一次提交能同时在两场计分，"用 A 赛试提交来规避 B 赛罚时"这件事在物理上就不可能发生，也就不需要立法禁止。

---

## 附：本报告引用的一手来源清单

**Codeforces**
- <https://codeforces.com/apiHelp/objects> —— `Problem` / `Party` / `Submission` / `Contest` 对象定义
- <https://codeforces.com/help> —— 官方 FAQ（out of competition、分区、赛中保密、赛后材料发布）
- <https://codeforces.com/blog/entry/84795> —— MikeMirzayanov, *Codeforces New Feature: Rewrite Statements in Mashups*
- <https://codeforces.com/blog/entry/10099> —— Fefer_Ivan（Codeforces 团队）, *New year update: Mashup contests*
- <https://codeforces.com/blog/entry/3676> —— MikeMirzayanov, *Codeforces::Gym*
- 公开 API 实测：`contest.list`、`contest.standings`、`contest.status`、`contest.ratingChanges`、`problemset.problems`、`problemset.recentStatus`。原始输出见 `/opt/cursor/artifacts/codeforces-api-evidence.log`

**DMOJ** —— `github.com/DMOJ/online-judge` @ `6aaddea6aaeabf4927b83787714509ff9fff8897`
- `judge/models/problem.py`、`judge/models/contest.py`、`judge/models/submission.py`、`judge/models/profile.py`
- `judge/views/problem.py`、`judge/views/contests.py`、`dmoj/urls.py`
- `judge/migrations/0115_contest_scoreboard_visibility.py`、`judge/models/tests/test_problem.py`

**AtCoder**
- <https://atcoder.jp/contests/abc466/rules> —— 官方比赛规则（赛中保密条款）
- <https://atcoder.jp/faq> —— 官方 FAQ
- URL 结构实测，原始输出见 `/opt/cursor/artifacts/atcoder-url-evidence.log`

**洛谷** —— 官方文档仓库
- `github.com/luogu-dev/docs`（洛谷帮助中心）@ `0bf65e3500d93ec22100e7ada69e8ac6f7970df1`
- `github.com/luogu-dev/luogu-rules`（洛谷规则集）@ `5047f9abe650834ec9dcff191d072b8093673d42`
- `github.com/luogu-dev/lgapi-docs`（洛谷开放平台文档）@ `b055ec29c5ba0673b212d8808401ba882fb76717`
- 在线入口：<https://help.luogu.com.cn/>
