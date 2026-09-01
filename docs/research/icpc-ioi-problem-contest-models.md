# ICPC / IOI 系比赛系统如何建模 Problem / Contest / Visibility / Submission

调研对象：DOMjudge、ICPC CLICS Contest API、CMS（Contest Management System）、Kattis。
调研日期：2026-09-01。

本文是 `docs/research/oj-problem-contest-models.md`（Codeforces / DMOJ / AtCoder / 洛谷）的姊妹篇。
那一篇看的是公开 OJ 平台，这一篇看的是**现场赛控制系统（CCS）血统**的系统——两者在题目归属上的取舍差别很大。

## 0. 方法与证据等级

本报告只使用**一手来源**：官方规范原文、官方文档、以及真实源代码。凡是无法用一手来源证实的，显式写 **unverified**，不做记忆推测。

| 系统 | 一手来源 | 证据类型 |
|---|---|---|
| DOMjudge | `github.com/DOMjudge/domjudge` @ `79032b304c4d3316b0204ff2a0d231abc2482d57`（2026-09-01，`README.md` 自报 `version 10.0.0DEV`）；官方手册 `doc/manual/*.rst` 及其发布版 `www.domjudge.org/docs` | 真实源代码 + 官方文档 + **本机跑通迁移后 dump 出的真实 DDL** |
| CLICS | `github.com/icpc/ccs-specs`：`master` 分支 @ `39e96730f7b3bc713fe9c5de531878478beff351`（即站点上的 `draft`），已发布分支 `2026-01` @ `cfeceec14783a9dafc24ad15369afaa767423f5f`；站点 `ccs-specs.icpc.io` | 官方规范原文 + JSON Schema |
| CMS | `github.com/cms-dev/cms` @ `114df9cba222521c047e41f57936e21f898a8f4b`（2026-08-19）；官方文档 `docs/*.rst` 及其发布版 `cms.readthedocs.io` | 真实源代码 + 官方文档 |
| Kattis | 官方 CLI `github.com/Kattis/kattis-cli` @ `58daa46da95d43793ac2112c0a7ecc9f7280e560`；`open.kattis.com` 线上 URL 实测 | 官方源代码 + 黑盒实测（**无可达的官方文档页**，见 §F） |

关于 DOMjudge 的一点方法说明：DOMjudge 早期版本在仓库里维护 `sql/mysql_db_structure.sql`，现在**已经没有这个文件**了，schema 完全由 Doctrine 迁移生成。所以本报告没有去读某个可能过期的 dump，而是按 DOMjudge 自己的安装脚本所做的事（`sql/dj_setup_database.in:400` → `symfony_console doctrine:migrations:migrate -n`）在本机跑完全部 126 个迁移，再 `SHOW CREATE TABLE` 拿到权威 DDL。完整可复现记录见 `/opt/cursor/artifacts/domjudge_schema_verification.log`。

CLICS / CMS / Kattis 的关键原文摘录见 `/opt/cursor/artifacts/clics_cms_kattis_source_excerpts.log`。

本文正文里 150 条 `文件:行号` 引用全部做过机械核对：逐条解析回上表锁定的那几个 commit，把被引的行原样打印出来复核。核对全过程与每一条被引行的原文见 `/opt/cursor/artifacts/citation_audit.log`。

---

## A. 题目住在哪里 —— 比赛内部，还是全局题库？

### A.1 DOMjudge：全局题库，比赛通过一张多对多连接表引用题目

`problem` 表**没有 `cid` 列**，主键就是 `probid` 一列：

```sql
CREATE TABLE `problem` (
  `probid` int(4) unsigned NOT NULL AUTO_INCREMENT COMMENT 'Problem ID',
  `externalid` varchar(255) ... COMMENT 'Problem ID in an external system, should be unique inside a single contest',
  `name` varchar(255) NOT NULL COMMENT 'Descriptive name',
  `timelimit` double unsigned NOT NULL DEFAULT 0 ...,
  `memlimit` int(4) unsigned DEFAULT NULL ...,
  `outputlimit` int(4) unsigned DEFAULT NULL ...,
  `special_run` varchar(32) DEFAULT NULL ...,
  `special_compare` varchar(32) DEFAULT NULL ...,
  `special_compare_args` varchar(255) DEFAULT NULL ...,
  `problemstatement_type` varchar(4) DEFAULT NULL ...,
  `multipass_limit` int(10) unsigned DEFAULT NULL ...,
  `types` int(11) NOT NULL COMMENT 'Bitmask of problem types, default is pass-fail.',
  `parent_testcase_group_id` int(10) unsigned DEFAULT NULL ...,
  PRIMARY KEY (`probid`),
  UNIQUE KEY `externalid` (`externalid`(190)),
  ...
) ... COMMENT='Problems the teams can submit solutions for'
```

（`/opt/cursor/artifacts/domjudge_schema_verification.log:19-41`，由本机迁移生成。对应实体 `webapp/src/Entity/Problem.php:23-43`。）

实体侧同样没有任何 `Contest` 字段——`Problem` 里唯一与比赛相关的东西是一个 `OneToMany`：

```php
/** @var Collection<int, ContestProblem> */
#[ORM\OneToMany(targetEntity: ContestProblem::class, mappedBy: 'problem')]
#[Serializer\Exclude]
private Collection $contest_problems;
```

（`webapp/src/Entity/Problem.php:152-157`。）

评委端的题目列表路由是 `/jury/problems`，**不在任何比赛之下**，查询也不带比赛条件：

```php
#[Route(path: '', name: 'jury_problems')]
public function indexAction(): Response
{
    $problems = $this->em->createQueryBuilder()
        ->select('p', 'COUNT(tc.testcaseid) AS testdatacount')
        ->from(Problem::class, 'p')
        ->leftJoin('p.testcases', 'tc')
        ->orderBy('p.probid', 'ASC')
        ->groupBy('p.probid')
        ->getQuery()->getResult();
```

（`webapp/src/Controller/Jury/ProblemController.php:51,69-78`。）

而且这个列表里**有一列专门叫「# contests」**——平台明确地把「这道题被几场比赛用了」当成题目的一个属性来展示：

```php
'num_contests' => ['title' => '# contests', 'sort' => true],
```

（`webapp/src/Controller/Jury/ProblemController.php:84`，计数查询在 `:100-106`。）

一道题可以完全不属于任何比赛而存在（`problem` 表无 `NOT NULL` 的比赛外键，`contestproblem` 里可以零行）。

#### `contestproblem` 的每一列

这就是 DOMjudge 的核心连接表。真实 DDL：

```sql
CREATE TABLE `contestproblem` (
  `cid` int(4) unsigned NOT NULL COMMENT 'Contest ID',
  `probid` int(4) unsigned NOT NULL COMMENT 'Problem ID',
  `shortname` varchar(255) NOT NULL COMMENT 'Unique problem ID within contest, used to sort problems in the scoreboard and typically a single letter',
  `points` int(4) unsigned NOT NULL DEFAULT 1 COMMENT 'Number of points earned by solving this problem',
  `allow_submit` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Are submissions accepted for this problem?',
  `allow_judge` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'Are submissions for this problem judged?',
  `color` varchar(32) DEFAULT NULL COMMENT 'Balloon colour to display on the scoreboard',
  `lazy_eval_results` int(10) unsigned NOT NULL COMMENT 'Whether to do lazy evaluation for this problem; if set this overrides the global configuration setting',
  PRIMARY KEY (`cid`,`probid`),
  UNIQUE KEY `shortname` (`cid`,`shortname`(190)),
  KEY `cid` (`cid`),
  KEY `probid` (`probid`),
  CONSTRAINT `contestproblem_ibfk_1` FOREIGN KEY (`cid`) REFERENCES `contest` (`cid`) ON DELETE CASCADE,
  CONSTRAINT `contestproblem_ibfk_2` FOREIGN KEY (`probid`) REFERENCES `problem` (`probid`) ON DELETE CASCADE
) ... COMMENT='Many-to-Many mapping of contests and problems'
```

（`/opt/cursor/artifacts/domjudge_schema_verification.log:48-64`。）

你事先猜的八列**完全正确**，一列不多一列不少。逐列说明：

| 列 | 类型 / 约束 | 作用 | 出处 |
|---|---|---|---|
| `cid` | `int unsigned NOT NULL`，主键组成，FK→`contest(cid)` `ON DELETE CASCADE` | 引用哪场比赛 | `Entity/ContestProblem.php:77-81` |
| `probid` | `int unsigned NOT NULL`，主键组成，FK→`problem(probid)` `ON DELETE CASCADE` | 引用哪道题 | `Entity/ContestProblem.php:83-87` |
| `shortname` | `varchar(255) NOT NULL`，`UNIQUE (cid, shortname(190))` | 该题在**这场比赛内**的编号（通常单个字母），决定榜单排序；序列化到 CLICS API 时字段名就是 `label` | `Entity/ContestProblem.php:29,38-43`；`#[Serializer\SerializedName('label')]` 在 `:42` |
| `points` | `int unsigned NOT NULL DEFAULT 1` | 「解出这道题得几分」 | `Entity/ContestProblem.php:45-52` |
| `allow_submit` | `tinyint(1) NOT NULL DEFAULT 1` | 「是否接受本题提交」——实际语义远不止于此，见 §D.3 | `Entity/ContestProblem.php:54-56` |
| `allow_judge` | `tinyint(1) NOT NULL DEFAULT 1` | 「本题提交是否评测」 | `Entity/ContestProblem.php:58-60` |
| `color` | `varchar(32) NULL` | 榜单上的气球颜色；API 里同时导出 `rgb`（十六进制）与 `color`（可读名） | `Entity/ContestProblem.php:62-68`，导出逻辑 `:171-191` |
| `lazy_eval_results` | `int unsigned NOT NULL` | 本题的惰性评测策略，**覆盖**全局配置。取值：`0`=Default、`1`=Yes（Lazy）、`2`=No（Full）、`3`=On demand | `Entity/ContestProblem.php:70-75`；常量 `Service/DOMJudgeService.php:80-83`，表单选项 `Form/Type/ContestProblemType.php:59-67` |

注意 `shortname`、`points`、`allow_submit`、`allow_judge`、`color`、`lazy_eval_results` **全部挂在连接表上而不是题目上**。这是这套模型最关键的设计决定：一道题在 A 赛叫 `A` 值 1 分是蓝色，在 B 赛叫 `C` 值 5 分是绿色，互不干扰。§B 有实测。

（`contestproblem` 这张表在 DOMjudge 里存在已久：`webapp/migrations/Version20190803123217.php:151-169` 就是它的初始 `CREATE TABLE`，那时主键已经是 `(cid, probid)`。）

### A.2 CLICS：`problem` 是 contest 的子资源，规范里没有全局题目端点

规范正文：

> Contests are accessible at the `contests` endpoint, and objects within each contest are accessible at endpoints named `contests/<id>/<type-name>`.

（`Contest_API.md:358-359` = <https://ccs-specs.icpc.io/draft/contest_api>。）

端点表里，problems 和 submissions 都只以子资源形式出现：

| Endpoint | JSON object |
|---|---|
| `contests/<id>/problems[/<id>]` | [Problem](https://ccs-specs.icpc.io/draft/json_format#problem) |
| `contests/<id>/submissions[/<id>]` | [Submission](https://ccs-specs.icpc.io/draft/json_format#submission) |

（`Contest_API.md:373,381`。已发布的 `2026-01` 分支同样如此，`Contest_API.md:396,403,1177-1178,1580`。）

**规范中不存在 `/problems` 顶层端点。** 唯一不在 contest 之下的端点是 `.`（API information）和 `webhooks[/<id>]`（`Contest_API.md:368,389`）。

`problem` 对象的属性（`JSON_Format.md:646-663`）：

| Name | Type | Description |
|---|---|---|
| `id` | ID | Identifier of the problem, at the WFs the directory name of the problem package. |
| `uuid` | string ? | UUID of the problem, as defined in the problem package. |
| `label` | string | Label of the problem on the scoreboard, typically a single capitalized letter. |
| `name` | string | Name of the problem. |
| `ordinal` | integer | A unique number that determines the order of the problems, e.g. on the scoreboard. |
| `rgb` | string ? | Hexadecimal RGB value of problem color ... e.g. `#AC00FF` or `#fff`. |
| `color` | string ? | Human readable color description associated to the RGB value. |
| `time_limit` | number | Time limit in seconds per test data set (i.e. per single run). |
| `memory_limit` | integer | Memory limit in MiB enforced on a submission. |
| `output_limit` | integer | Limit in MiB on what the submission can write both to `stdout` and `stderr`. |
| `code_limit` | integer | Limit in KiB on submissions for this problem. |
| `test_data_count` | integer | Number of test data sets. |
| `max_score` | number | Maximum score. ... Required iff contest:scoreboard_type is `score`. |
| `package` | array of FILE ? | Problem package. Expected mime type is application/zip. |
| `statement` | array of FILE ? | Problem statement. Expected mime type is application/pdf. |
| `attachments` | array of FILE ? | Problem attachments. |

JSON Schema 里必需的只有五个：`["id", "label", "name", "ordinal", "test_data_count"]`（`json-schema/problem.json`，`required` 行）。

注意这个对象**把「题目本体属性」（`uuid`/`name`/`time_limit`/`memory_limit`）和「本场比赛内的呈现属性」（`label`/`ordinal`/`rgb`/`color`）拍平在同一层**。这与 DOMjudge 的 `problem` + `contestproblem` 两张表正好对应——DOMjudge 序列化 `ContestProblem` 时用 `#[Serializer\Inline]` 把 `Problem` 内联进来（`webapp/src/Entity/ContestProblem.php:83-87`，`Inline` 在 `:86`），拍出来的就是 CLICS 这个扁平对象。

ID 的作用域也讲清楚了：

> IDs are unique within each endpoint.

（`JSON_Format.md:47`。）也就是说 problem 的 `id` 只保证在**某一场比赛的 problems 端点内**唯一，规范不承诺跨比赛全局唯一。

Contest Package 侧同样是「一场比赛打一个包」：CCS configuration 包的必需文件里有 `problems.json`，题包放在 `problems/problemA/problemA.zip`（`Contest_Package.md:150-180`）。

### A.3 CMS：`Task.contest_id` 可空 —— 明确存在「题池」

官方文档一句话把 A 和 B 一起答了：

> A task is one of the problems to solve within a contest. **A task cannot be associated to more than one contest, but you can have tasks temporarily not associated to any.**

（`docs/Data model.rst:30` = <https://cms.readthedocs.io/en/latest/Data%20model.html>。）

schema 与之一致：

```python
class Task(Base):
    __tablename__ = 'tasks'
    __table_args__ = (
        UniqueConstraint('contest_id', 'num'),
        UniqueConstraint('contest_id', 'name'),
        ...
    )
    ...
    # Contest (id and object) owning the task.
    contest_id: int | None = Column(
        Integer,
        ForeignKey(Contest.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=True,
        index=True)
    contest: Contest | None = relationship(Contest, back_populates="tasks")

    # Short name and long human readable title of the task.
    name: str = Column(Codename, nullable=False, unique=True)
```

（`cms/db/task.py:52-101`。）

三个要点：

1. `contest_id` 是 `nullable=True` —— 题目可以不属于任何比赛。
2. `contest_id` 是**单值标量外键**，不是连接表 —— 一道题最多属于一场比赛。
3. `Task.name` 是**全局** `unique=True`（`:98-101`），不是「比赛内唯一」。

管理端 AWS 直接把这个题池摆在界面上。比赛的 tasks 页面会查出所有无主题目：

```python
self.r_params["unassigned_tasks"] = \
    self.sql_session.query(Task)\
        .filter(Task.contest_id.is_(None))\
        .all()
```

（`cms/server/admin/handlers/contesttask.py:46-51`。）

「加入比赛」和「移出比赛」是两个对称的一等操作：

```python
# Assign the task to the contest.
task.num = len(self.contest.tasks)
task.contest = self.contest
```
（`cms/server/admin/handlers/contesttask.py:174-176`，在 `AddContestTaskHandler` 中。）

```python
if operation == self.REMOVE_FROM_CONTEST:
    # Unassign the task to the contest.
    task.contest = None
    task.num = None  # not strictly necessary
```
（`cms/server/admin/handlers/contesttask.py:81-84`，按钮文案常量 `REMOVE_FROM_CONTEST = "Remove from contest"` 在 `:35`。）

但选手端**看不到无主题目**——CWS 取题一律带比赛过滤：

```python
def get_task(self, task_name: str) -> Task | None:
    """Return the task in the contest with the given name."""
    return self.sql_session.query(Task) \
        .filter(Task.contest == self.contest) \
        .filter(Task.name == task_name) \
        .one_or_none()
```

（`cms/server/contest/handlers/contest.py:254-265`。）

所以 CMS 的题池是**纯管理端概念**：题目可以离开比赛被暂存，但只要不在比赛里，选手侧就完全不存在。

---

## B. 在新比赛里复用已有题目

### B.1 DOMjudge：一等公民，多对多是 schema 层面的事实

`contestproblem` 的主键是 `(cid, probid)`，表注释就是 `Many-to-Many mapping of contests and problems`，实体类的 docblock 也写着同一句话（`webapp/src/Entity/ContestProblem.php:15-25`）。主键包含 `cid` 而 `probid` 只是主键的一半，意味着同一个 `probid` 可以出现在任意多行——**这是 schema 直接允许的，不需要复制题目**。

评委端把已有题目加进比赛的表单，候选集就是**整个全局题库**，不带任何比赛过滤：

```php
$builder->add('problem', EntityType::class, [
    'class' => Problem::class,
    'required' => true,
    'choice_label' => fn(Problem $problem) => sprintf('%s - %s', $problem->getExternalid(), $problem->getName()),
    'choice_value' => 'externalid',
    'query_builder' => fn(EntityRepository $er) => $er
        ->createQueryBuilder('p')
        ->orderBy('p.probid'),
]);
```

（`webapp/src/Form/Type/ContestProblemType.php:22-30`。）

官方手册也是这么写的：

> You can add a problem to a contest while uploading, or associate it by editing the contest from the Contests page later.

（`doc/manual/config-basic.rst:97-99` = <https://www.domjudge.org/docs/manual/main/config-basic.html>。「associate」这个词本身就说明是引用而非拷贝。）

DOMjudge 自己在 CI 里用的 7.3.3 数据库 dump 就是活样本：`probid=1` 同时出现在 `cid=1` 和 `cid=2`，而且颜色不同（`NULL` vs `'magenta'`）：

```sql
INSERT INTO `contestproblem` (`cid`, `probid`, `shortname`, `points`, `allow_submit`, `allow_judge`, `color`, `lazy_eval_results`) VALUES
(1, 1, 'hello', 1, 1, 1, NULL, NULL),
(2, 1, 'hello', 1, 1, 1, 'magenta', NULL),
...
```

（`.github/jobs/data/dj733.sql:219-224`。）

**本机实测**（`/opt/cursor/artifacts/domjudge_schema_verification.log:114-130`）：往刚建好的 10.0.0DEV 库里插一道题、两场比赛、两行 `contestproblem`，结果是

```
+--------------+---------------------+
| problem_rows | contestproblem_rows |
+--------------+---------------------+
|            1 |                   2 |
+--------------+---------------------+
+--------+------------+---------+-------+--------+--------------+-------------+-----------+
| probid | problem_id | contest | label | points | allow_submit | allow_judge | color     |
+--------+------------+---------+-------+--------+--------------+-------------+-----------+
|      1 | reuseme    | spring  | A     |      1 |            1 |           1 | magenta   |
|      1 | reuseme    | autumn  | C     |      5 |            0 |           1 | limegreen |
+--------+------------+---------+-------+--------+--------------+-------------+-----------+
```

一行题目，两个绑定，label / points / allow_submit / 颜色**逐比赛不同**，题目本体一份没有复制。

### B.2 CLICS：规范对此**不表态**

CLICS 描述的是「一场比赛对外长什么样」，不描述后端存储。规范里既没有任何机制表达「这道题也在另一场比赛里」，也没有任何禁止。两场比赛的 problems 端点各自返回自己的数组，`id` 只在端点内唯一（`JSON_Format.md:47`）。

一个可观察的后果：两场比赛完全可以用同一个 problem `id`（比如都叫 `asteroids`），但规范不提供任何方式判断这到底是同一道题还是撞名。唯一带全局含义的字段是 `uuid`（"UUID of the problem, as defined in the problem package"，`JSON_Format.md:649`）——它来自题包而不是比赛，因此两场比赛引用同一题包时 `uuid` 会相同。但**规范没有把「`uuid` 相同即同一题」写成规范性要求**，我没有找到这样的条文；这一点标为 **unverified**。

### B.3 CMS：一等公民，但是**互斥**的 —— 一题同时只能在一场比赛

文档原文已在 §A.3 引过：「A task cannot be associated to more than one contest, but you can have tasks temporarily not associated to any.」（`docs/Data model.rst:30`）

机制就是那个单值 `Task.contest_id`（`cms/db/task.py:87-95`）。把题目从 A 赛移到 B 赛是「先 `task.contest = None`，再 `task.contest = B`」——串行的，不是并行的。

所以 CMS 的复用是**时间维度上的**复用（同一道题可以先后用于多场比赛，题目实体和数据集都保留），不是**空间维度上的**复用（不能同时挂在两场比赛下）。要在两场并行的比赛里用同一道题，只能建两个 `Task` 行——`Task.name` 全局唯一（`:98-101`）意味着连名字都得改。

---

## C. 提交如何归属到比赛

### C.1 DOMjudge：`submission` 同时带 `cid` 和 `probid`，并有指向 `contestproblem` 的复合外键

真实 DDL 的相关部分：

```sql
CREATE TABLE `submission` (
  `submitid` int(4) unsigned NOT NULL AUTO_INCREMENT COMMENT 'Submission ID',
  `origsubmitid` int(10) unsigned DEFAULT NULL ...,
  `cid` int(10) unsigned DEFAULT NULL COMMENT 'Contest ID',
  `teamid` int(10) unsigned DEFAULT NULL COMMENT 'Team ID',
  `userid` int(10) unsigned DEFAULT NULL COMMENT 'User ID',
  `probid` int(10) unsigned DEFAULT NULL COMMENT 'Problem ID',
  `langid` int(10) unsigned DEFAULT NULL COMMENT 'Language ID',
  `submittime` decimal(32,9) unsigned NOT NULL COMMENT 'Time submitted',
  `valid` tinyint(1) NOT NULL DEFAULT 1 COMMENT 'If false ignore this submission in all scoreboard calculations',
  ...
  PRIMARY KEY (`submitid`),
  UNIQUE KEY `externalid` (`cid`,`externalid`(190)),
  KEY `probid_2` (`cid`,`probid`),
  ...
  CONSTRAINT `submission_ibfk_1` FOREIGN KEY (`cid`) REFERENCES `contest` (`cid`) ON DELETE CASCADE,
  CONSTRAINT `submission_ibfk_3` FOREIGN KEY (`probid`) REFERENCES `problem` (`probid`) ON DELETE CASCADE,
  CONSTRAINT `submission_ibfk_8` FOREIGN KEY (`cid`, `probid`) REFERENCES `contestproblem` (`cid`, `probid`) ON DELETE CASCADE
) ... COMMENT='All incoming submissions'
```

（`/opt/cursor/artifacts/domjudge_schema_verification.log:72-108`。）

**有一个 `cid` 列，紧挨着 `probid`。** 关于可空性，需要说得精确一点，因为 DB 层和应用层不一致：

- **DB 层：可空。** `cid` 是 `int(10) unsigned DEFAULT NULL`。这不是一直如此——迁移 `Version20201110113446`（描述为 `Remove explicit column definitions for foreign keys.`）的 `up()` 把它从 `NOT NULL` 改成了 `DEFAULT NULL`（`webapp/migrations/Version20201110113446.php:26,34`），此后再没有迁移改回来（我逐个检查了该迁移之后所有触及 `submission` 表的 10 个迁移，没有任何 `CHANGE cid cid`）。DOMjudge 7.3.3 时代还是 `NOT NULL`（`.github/jobs/data/dj733.sql:889`）。
- **应用层：不可空。** 实体属性是不可空的 PHP 类型：

  ```php
  #[ORM\ManyToOne(inversedBy: 'submissions')]
  #[ORM\JoinColumn(name: 'cid', referencedColumnName: 'cid', onDelete: 'CASCADE')]
  #[Serializer\Exclude]
  private Contest $contest;
  ```
  （`webapp/src/Entity/Submission.php:124-127`；对比同文件 `:139-142` 的 `private ?User $user = null;` 确实写了可空。）

  而且 `SubmissionService::submitSolution()` 的 `$contest` 参数是必填的 `Contest|int`，为空直接抛错：`if (empty($contest)) { throw new BadRequestHttpException("Contest not found"); }`（`webapp/src/Service/SubmissionService.php:829,833,874-876`）。

结论：DDL 上的可空是 Doctrine 自动生成的副产品，**没有任何应用路径会写出 `cid IS NULL` 的提交**。

第三个关联字段更能说明设计意图 —— 实体上还有一个指向 `ContestProblem` 的复合关联：

```php
#[ORM\ManyToOne(inversedBy: 'submissions')]
#[ORM\JoinColumn(name: 'cid', referencedColumnName: 'cid', onDelete: 'CASCADE')]
#[ORM\JoinColumn(name: 'probid', referencedColumnName: 'probid', onDelete: 'CASCADE')]
#[Serializer\Exclude]
private ContestProblem $contest_problem;
```

（`webapp/src/Entity/Submission.php:149-153`，落到 DB 就是 `submission_ibfk_8`。这个约束从 `Version20190803151406.php:132` 就存在了。）

**一次提交能在两场比赛计分吗？不能，而且是数据库层面不能。** 实测（`/opt/cursor/artifacts/domjudge_schema_verification.log:132-152`）：

同一道题在两场比赛里各交一次，产生的是**两行独立的 submission**：

```
+----------+------+---------+--------+-------+
| submitid | cid  | contest | probid | label |
+----------+------+---------+--------+-------+
|        1 |    1 | spring  |      1 | A     |
|        2 |    2 | autumn  |      1 | C     |
+----------+------+---------+--------+-------+
```

而向一个「该比赛并未收录这道题」的 `(cid, probid)` 组合插提交，直接被外键拒绝：

```
ERROR 1452 (23000): Cannot add or update a child row: a foreign key constraint fails
(`domjudge`.`submission`, CONSTRAINT `submission_ibfk_8`
 FOREIGN KEY (`cid`, `probid`) REFERENCES `contestproblem` (`cid`, `probid`) ON DELETE CASCADE)
```

也就是说：**「题目属于这场比赛」不只是应用层的一个判断，它是提交表的外键前提。**

#### DOMjudge 有没有「不属于任何比赛的练习提交」？没有

我在 `webapp/src/` 与 `doc/manual/` 全文搜索 `practice`，命中的全部是「把练习赛建成另一场比赛」，没有任何 contest-less 提交的概念。官方手册的 `contest.yaml` 导入示例直接就是：

```yaml
id:                         practice
name:                       DOMjudge open practice session
start_time:                 2020-04-30T10:00:00+01:00
duration:                   2:00:00
scoreboard_freeze_duration: 0:30:00
penalty_time:               20
```

（`doc/manual/import.rst:352-357`。）DOMjudge 自带的 demo 数据同理，`demoprac` 是一场独立的 contest 行（`.github/jobs/data/dj733.sql:195`）。

**练习 = 又一场比赛。** 这是 DOMjudge 唯一的表达方式。

### C.2 CLICS：submissions 是 contest 子资源，且对象里根本没有 contest 字段

端点：`contests/<id>/submissions[/<id>]`（`Contest_API.md:381`；`2026-01` 分支 `:403,1580`）。DOMjudge 的实现与之一致，POST 只挂在带 `cid` 的路由上：

```php
#[Rest\Get(path: 'submissions')]
#[Rest\Get(path: 'contests/{cid}/submissions')]
...
#[Rest\Post(path: 'contests/{cid}/submissions')]
```

（`webapp/src/Controller/API/SubmissionController.php:67-68,114`。注意 GET 有一个无 `cid` 的便捷别名，但**创建提交只能走带 `cid` 的路由**。）

`submission` 对象的属性（`JSON_Format.md:970-981`）：`id`、`language_id`、`problem_id`、`team_id`、`account_id`、`time`、`contest_time`、`entry_point`、`files`、`reaction`。

**没有 `contest_id` 属性。** 比赛归属完全由 URL 路径承载——这在结构上就排除了「一次提交属于多场比赛」的表达。`contest_time`（"Contest relative time when the submission was made"，`:978`）也预设了「有且只有一个参照系」。

### C.3 CMS：`Submission → Participation → Contest`，外加 `Submission.task_id`

```python
class Submission(Base):
    __tablename__ = 'submissions'
    ...
    # User and Contest, thus Participation (id and object) that did the submission.
    participation_id: int = Column(
        Integer,
        ForeignKey(Participation.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)
    participation: Participation = relationship(Participation, back_populates="submissions")

    # Task (id and object) of the submission.
    task_id: int = Column(
        Integer,
        ForeignKey(Task.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)
    task: Task = relationship(Task, back_populates="submissions")
```

（`cms/db/submission.py:45-86`。代码注释自己就把这条链讲明白了：「User and Contest, thus Participation」。）

链条另一端：

```python
class Participation(Base):
    __tablename__ = 'participations'
    __table_args__ = (
        ForeignKeyConstraint(("group_id", "contest_id"), (Group.id, Group.contest_id)),
        UniqueConstraint("contest_id", "user_id"),
    )
    ...
    contest_id: int = Column(
        Integer,
        ForeignKey(Contest.id, onupdate="CASCADE", ondelete="CASCADE"),
        nullable=False,
        index=True)
```

（`cms/db/user.py:246-256,316-325`。`contest_id` 是 `nullable=False`。）

所以链是完整闭合的：submission → participation（`NOT NULL`）→ contest（`NOT NULL`）。**CMS 里不存在不属于任何比赛的提交。** 官方文档同样确认：「Participations contain the interactions of users and a contest. In particular all of the following are associated to a participation: the submissions sent, their results, questions asked, communications from contest admins.」（`docs/Data model.rst:16`）

**CMS 的「练习提交」是另一种东西：属于比赛但不计分。** `Submission` 有一个布尔列：

```python
# If false, submission will not be considered in contestant's score.
official: bool = Column(Boolean, nullable=False, default=True)
```

（`cms/db/submission.py:104-109`。）

它只在「选手正常参赛」那一个阶段被置真：

```python
# Only set the official bit when the user can compete and we are not in
# analysis mode.
official = self.r_params["actual_phase"] == 0
```

（`cms/server/contest/handlers/tasksubmission.py:91-93`；API 侧同样 `cms/server/contest/handlers/api.py:130`。）

非 official 的提交照常评测，但不会推给排行榜服务：

```python
if not submission.participation.hidden and \
        submission.official and \
        submission.get_result() is not None and \
        submission.get_result().scored():
    for operation in self.operations_for_score(submission):
        self.enqueue(operation)
```

（`cms/service/ProxyService.py:582-587`。）

**能否在两场比赛计分？不能。** 一次提交经由 `participation_id` 恰好指向一个 participation，而 participation 恰好指向一个 contest。而且由于 `Task.contest_id` 单值（§B.3），同一道题在两场并行比赛里根本不可能同时存在，这个问题在 CMS 里连提出的前提都没有。

### C.4 Kattis：`problem` 必填，`contest` 可选 —— 唯一支持「无比赛提交」的系统

官方 CLI 的提交函数：

```python
def submit(submit_url, cookies, problem, language, files, mainclass='', tag='', assignment=None, contest=None):
    ...
    data = {'submit': 'true',
            'submit_ctr': 2,
            'language': language,
            'mainclass': mainclass,
            'problem': problem,
            'tag': tag,
            'script': 'true'}

    if assignment is not None:
        data['assignment'] = assignment
    if contest is not None:
        data['contest'] = contest
```

（`kattis-cli/submit.py:241-261`。）

`problem` 无条件进 payload；`contest` 只有显式给了才进。命令行侧 `--assignment` 与 `--contest` 是**互斥组**：

```python
group = parser.add_mutually_exclusive_group()
group.add_argument('-a', '--assignment',
                    help='''Short name of assignment you want to submit to
Overrides default guess (server guesses based on assignments you are in)''')
group.add_argument('-c', '--contest',
                    help='''Short name of contest you want to submit to
Overrides default guess (server guesses based on contests you are in)''')
```

（`kattis-cli/submit.py:377-384`。）

三点可以直接读出来：

1. 提交的**主语是题目**，比赛是可选修饰。
2. 一次提交最多归属一个 contest **或**一个 assignment（课程作业），互斥。
3. 不给 `contest` 时，「server guesses based on contests you are in」——归属由服务端根据你的报名状态推断。这个推断规则本身是服务端行为，我无法从一手来源确认其细节，标为 **unverified**。

Kattis 是本文四个系统里唯一在提交协议层面允许「无比赛提交」的。

---

## D. 可见性与访问控制

### D.1 DOMjudge 的比赛时间线

`contest` 表的六个时间里程碑，全部带官方列注释（`/opt/cursor/artifacts/domjudge_schema_verification.log` 中 `contest` 段 / `webapp/src/Entity/Contest.php:82-225`）：

| 列 | 可空 | 列注释（原文） |
|---|---|---|
| `activatetime` | `NOT NULL` | `Time contest becomes visible in team/public views` |
| `starttime` | `NOT NULL` | `Time contest starts, submissions accepted` |
| `freezetime` | `NULL` | `Time scoreboard is frozen` |
| `endtime` | `NOT NULL` | `Time after which no more submissions are accepted` |
| `unfreezetime` | `NULL` | `Unfreeze a frozen scoreboard at this time` |
| `deactivatetime` | `NULL` | `Time contest becomes invisible in team/public views` |

另有 `starttime_enabled`（`If disabled, starttime is not used, e.g. to delay contest start`）。

官方手册对整条时间线的表述（`doc/manual/config-basic.rst:57-90` = <https://www.domjudge.org/docs/manual/main/config-basic.html>）：

> Besides the name the most important configuration about a contest are the various time milestones.
>
> A contest can be selected for viewing after its *activate time*, but the scoreboard will only become visible to public and teams once the contest *starts*. **Thus no data such as problems and teams is revealed before then.**
>
> When the contest *ends*, the scores will remain displayed until the *deactivate time* passes.
>
> DOMjudge has the option to 'freeze' the public and team scoreboards at some point during the contest. This means that scores are no longer updated and remain to be displayed as they were at the time of the freeze. This is often done to keep the last hour interesting for all. The scoreboard freeze time can be set with the *freezetime* milestone.
>
> The scoreboard freezing works by looking at the time a submission is made. Therefore it's possible that submissions from (just) before the freezetime but judged after it can still cause updates to the public scoreboard. A rejudging during the freeze may also cause such updates. The jury interface will however always show the actual scoreboard.
>
> Once the contest is over, the scores are not directly 'unfrozen'. You can release the final scores to team and public interfaces when the time is right. You can do this either by setting a predefined *unfreezetime* in the contest table, or you push the 'unfreeze now' button in the jury web interface, under contests.
>
> All events happen at the first moment of the defined time. That is: for a contest with starttime "12:00:00" and endtime "17:00:00", the first submission will be accepted at 12:00:00 and the last one at 16:59:59.

管理界面对每个里程碑的 help 文案（`webapp/src/Form/Type/ContestType.php:49-81`）更精确：

| 字段 | help 原文 |
|---|---|
| Activate time | `Time when the contest becomes visible for teams. Must be in the past to enable submission of jury submissions.` |
| Start time | `Absolute time when the contest starts.` |
| Start time countdown enabled | `Disable to delay the contest start and stop the countdown. Enable again after setting a new start time.` |
| Scoreboard freeze time | `Time when the freeze starts: the results of submissions made after this time are not revealed until the scoreboard unfreeze time below has passed.` |
| End time | `Time when the contest ends. Submissions made after this time will be accepted and judged but shown (to teams and public) as 'too-late' and not counted towards the score.` |
| Scoreboard unfreeze time | `Time when the final scoreboard is revealed. Usually this is a few hours after the contest ends and the award ceremony is over.` |
| Deactivate time | `Time when the contest and scoreboard are hidden again. Usually a few hours/days after the contest ends.` |

⚠️ 注意 `endtime` 的两种说法互相矛盾：DB 列注释说 `Time after which no more submissions are accepted`，而表单 help 说 `Submissions made after this time will be accepted and judged but shown ... as 'too-late'`。**代码站表单这边**：`submitSolution()` 只在 `!$freezeData->started()` 时拒绝非评委提交（`webapp/src/Service/SubmissionService.php:924-928`），**没有任何针对 `stopped()` 的拒绝**；超过 `endtime` 只是记一条 info 日志：

```php
if (Utils::difftime((float)$contest->getEndtime(), $submitTime) <= 0) {
    $this->logger->info("The contest is closed, submission stored but not processed. [c%d]", [ $contest->getCid() ]);
}
```
（`webapp/src/Service/SubmissionService.php:1201-1206`；队伍端提交控制器同样只 gate 了 `started()`，`webapp/src/Controller/Team/SubmissionController.php:131`。）

各阶段的判定函数集中在 `webapp/src/Utils/FreezeData.php`：`started()`（`:77-90`）、`stopped()`（`:94-107`）、`running()`（`:112-119`）、`showFrozen()`（`:54-73`）、`showFinal()`（`:27-50`）、`finalized()`（`:125-138`）。其中 `showFinal()` 的规则是「（没设 freezetime 且已过 endtime）或（设了 unfreezetime 且已过 unfreezetime）」（`:43-46`），`showFrozen()` 是「已过 freezetime 且尚未过 unfreezetime」（`:66-69`）。

### D.2 DOMjudge 的访问范围：`enabled` / `public` / `open_to_all_teams` 与两张连接表

四个开关，每个都有官方 help 文案（`webapp/src/Form/Type/ContestType.php`）：

| 字段 | DB 列注释 | 管理界面 help 原文 |
|---|---|---|
| `enabled` | `Whether this contest can be active` | `When disabled, the contest is hidden from teams (even when active) and judging is disabled. Disabling is a quick way to remove access to it without changing any other settings.`（`:166-171`） |
| `public` | `Is this contest visible for the public?` | 标签是 `Enable public scoreboard`；`When the public scoreboard is enabled, everyone can see it without logging in. When disabled, only logged in users/teams can see the scoreboard.`（`:138-143`） |
| `open_to_all_teams` | `Is this contest open to all teams?` | `When enabled, any logged in team is part of the contest. When disabled, only the teams/categories listed below are part of the contest.`（`:144-149`） |
| `allow_submit`（比赛级，**不同于** `contestproblem.allow_submit`） | `Are submissions accepted in this contest?` | `When disabled, users cannot submit to the contest and a warning will be displayed.`（`:93-97`） |

两张连接表（`open_to_all_teams = 0` 时才起作用）：

```sql
CREATE TABLE `contestteam` (
  `cid` int(4) unsigned NOT NULL COMMENT 'Contest ID',
  `teamid` int(4) unsigned NOT NULL COMMENT 'Team ID',
  PRIMARY KEY (`cid`,`teamid`), ...
) ... COMMENT='Many-to-Many mapping of contests and teams'

CREATE TABLE `contestteamcategory` (
  `cid` int(10) unsigned NOT NULL COMMENT 'Contest ID',
  `categoryid` int(10) unsigned NOT NULL COMMENT 'Team category ID',
  PRIMARY KEY (`cid`,`categoryid`), ...
)
```

（本机 dump；实体映射在 `webapp/src/Entity/Contest.php:417-424`（`contestteam`）与 `:436-444`（`contestteamcategory`）。表单 help：`List of teams participating in the contest, in case it is not open to all teams.`（`ContestType.php:150-157`）、`List of team categories participating in the contest, in case it is not open to all teams.`（`:158-165`）。另有一张同构的 `contestlanguage` 表用于限制语言，`Contest.php:427-434`。）

这些开关的**实际合成规则**在选比赛的那一个查询里：

```php
$qb->select('c')->from(Contest::class, 'c', 'c.externalid');
if (isset($onlyOfTeam)) {
    $qb->leftJoin('c.teams', 'ct')
        ->leftJoin('c.team_categories', 'tc')
        ->leftJoin('tc.teams', 'tct')
        ->andWhere('ct.teamid = :teamid OR tct.teamid = :teamid OR c.openToAllTeams = 1')
        ->setParameter('teamid', $onlyOfTeam);
} elseif ($onlyPublic) {
    $qb->andWhere('c.public = 1');
}
$qb->andWhere('c.enabled = 1')
    ->andWhere('c.deactivatetime IS NULL OR c.deactivatetime > :now')
    ->setParameter('now', $now)
    ->orderBy('c.activatetime');

if (!$alsofuture) {
    $qb->andWhere('c.activatetime <= :now');
}
```

（`webapp/src/Service/DOMJudgeService.php:154-175`。）

读法：

- `enabled = 1` 与 `deactivatetime` 未过，是**所有人**的硬前提。
- `activatetime <= now` 是默认前提（`$alsofuture` 才放开）。
- **队伍视角**看的是三选一：显式列在 `contestteam`、所属分类列在 `contestteamcategory`、或 `open_to_all_teams = 1`。这条路径**不看 `public`**。
- **公众视角**（未登录）才看 `public = 1`。公开页面全部显式传 `onlyPublic: true`（`webapp/src/Controller/PublicController.php:64,109,137,148,239,274,289,304`）。

⚠️ 一个容易踩的不一致：`Contest::isActive()` 把 `public` 也算进去了——

```php
public function isActive(): bool
{
    return $this->getEnabled() &&
        $this->getPublic() &&
        ($this->activatetime <= time()) &&
        ($this->deactivatetime == null || $this->deactivatetime > time());
}
```
（`webapp/src/Entity/Contest.php:1256-1265`，注释写的是 `Returns true iff the contest is already and still active, and not disabled.`）

也就是说 `isActive()` 和 `getCurrentContests()` 对「活跃」的定义并不相同，前者对非公开比赛返回 false。使用时要看清调用的是哪一个。

### D.3 DOMjudge 的 `contestproblem.allow_submit` 与 `allow_judge`（重点）

官方手册原文（`doc/manual/config-basic.rst:101-108`）：

> It is possible to change whether teams can submit solutions for that problem (using the toggle switch 'allow submit'). **If disallowed, submissions for that problem will be rejected, but more importantly, teams will not see that problem on the scoreboard.** Disallow judge will make DOMjudge accept submissions, but leave them queued; this is useful in case an unexpected problem shows up with one of the problems.

代码里 `allow_submit` 的把守点比文档说的还多。它是**一个可见性开关，不只是一个提交开关**：

1. **队伍的题目列表整个滤掉它**：
   ```php
   if ($contest && ($forJury || $contest->getFreezeData()->started())) {
       $problems = $this->em->createQueryBuilder()
           ->from(ContestProblem::class, 'cp')
           ...
           ->andWhere('cp.contest = :contest')
           ->andWhere('cp.allowSubmit = 1')
   ```
   （`webapp/src/Service/DOMJudgeService.php:1126-1138`，同函数 `:1140-1150` 的样例计数同样过滤。该函数同时服务队伍页 `Controller/Team/ProblemController.php:47-52` 和公开页 `Controller/PublicController.php:210-214`。）

2. **提交表单的题目下拉框里没有它**（`webapp/src/Form/Type/SubmitProblemType.php:53-67`，`->andWhere('cp.allowSubmit = 1')` 在 `:58`）。

3. **提交时硬拒**：
   ```php
   if (!$problem->getAllowSubmit()) {
       throw new BadRequestHttpException(
           sprintf("Problem p%d not submittable [c%d].", $problem->getProbid(), $contest->getCid()));
   }
   ```
   （`webapp/src/Service/SubmissionService.php:987-991`，此处 `$problem` 是 `ContestProblem`。）

4. **REST API 的 `GET /contests/{cid}/problems` 不返回它**（`webapp/src/Controller/API/ProblemController.php:504-520`）；**`POST /contests/{cid}/submissions` 找不到它**：
   ```php
   ->andWhere('cp.allowSubmit = 1')
   ...
   if ($problem === null) {
       throw new BadRequestHttpException(sprintf("Problem '%s' not found or not submittable.", $problemId));
   }
   ```
   （`webapp/src/Controller/API/SubmissionController.php:185-201`。）

5. **样例数据 zip 里不包含它**（`webapp/src/Service/DOMJudgeService.php:861-877`）、**榜单计算跳过它**（`webapp/src/Service/ScoreboardService.php:1106`）、**关于它的 clarification 也不列出**（`webapp/src/Controller/API/ClarificationController.php:160`）。

`allow_judge` 则**只影响评测**，不影响可见性也不影响收题：

```php
private function allowJudge(ContestProblem $problem, Submission $submission, Language $language, bool $manualRequest): bool
{
    if (!$problem->getAllowJudge() || !$language->getAllowJudge()) {
        return false;
    }
    ...
}
```

（`webapp/src/Service/DOMJudgeService.php:1709-1712`。）唯一调用点在 `maybeCreateJudgeTasks()`：

```php
if (!$this->allowJudge($problem, $submission, $language, $manualRequest)) {
    return;
}
$this->actuallyCreateJudgetasks($priority, $judging, $overshoot, $valid);
```

（`webapp/src/Service/DOMJudgeService.php:1306-1319`。）返回即 `return`，`judgetask` 一条都不建 —— 提交静静躺在队列里，正是手册说的 "accept submissions, but leave them queued"。

两个开关都是**逐 (比赛, 题目) 对**的，切换路由本身就带着两个 ID：

```php
#[Route(path: '/{contestId}/{probId}/toggle/{type<judge|submit>}', name: 'jury_problem_toggle')]
```
（`webapp/src/Controller/Jury/ProblemController.php:1279-1301`。）

一句话对照：**`allow_submit = 0` ⇒ 这道题在这场比赛里对队伍不存在；`allow_judge = 0` ⇒ 这道题照常展示照常收题，只是不评。**

### D.4 DOMjudge：「比赛开始前题目不可见」具体怎么落地

不是靠题目自己的某个字段，而是靠**三处独立的 `started()` 判断**：

1. **题目列表**：`if ($contest && ($forJury || $contest->getFreezeData()->started()))` —— 条件不成立时 `$problems` 保持空数组（`webapp/src/Service/DOMJudgeService.php:1123-1126,1177`）。
2. **题面 / 附件 / 样例 zip 下载**：
   ```php
   $contest = $this->dj->getCurrentContest($user->getTeam()->getTeamid());
   if (!$contest || !$contest->getFreezeData()->started()) {
       throw new NotFoundHttpException(sprintf('Problem p%d not found or not available', $probId));
   }
   ```
   （`webapp/src/Controller/Team/ProblemController.php:101-114`，被题面 `:56-72`、附件 `:78-85`、样例 `:88-93` 三个路由共用。）
3. **提交动作**：
   ```php
   $freezeData = new FreezeData($contest);
   if (!$this->authService->checkRole('jury') && !$freezeData->started()) {
       throw new AccessDeniedHttpException(
           sprintf("The contest is closed, no submissions accepted. [c%d]", $contest->getCid()));
   }
   ```
   （`webapp/src/Service/SubmissionService.php:924-928`。）
4. **REST API**：
   ```php
   // For non-API-reader users, only expose the problems after the contest has started.
   if (!$this->authService->checkRole('api_reader') && $contest->getStartTimeObject()->getTimestamp() > time()) {
       $queryBuilder->andWhere('1 = 0');
   }
   ```
   （`webapp/src/Controller/API/ProblemController.php:521-524`——这正是 CLICS 那条要求的实现，见 §D.5。）

评委角色（`forJury` / `jury` / `api_reader`）在这四处全部豁免。所以 `activatetime` 到 `starttime` 之间的窗口是给评委用的：比赛在队伍界面「可见」（可以被选中、看到倒计时），但题目一道都拿不到。这正是手册那句 "A contest can be selected for viewing after its *activate time*, but ... Thus no data such as problems and teams is revealed before then."

**关键结论：题目本身没有可见性字段。** `problem` 表里没有任何形如 `visible` / `published` / `status` 的列（见 §A.1 的完整 DDL）。可见性 100% 由「它被绑进了哪场比赛」+「那场比赛现在处于什么阶段」推导出来。

### D.5 CLICS 的可见性要求

CLICS 主规范本身对可见性说得很克制，把它交给具体的 CCS 要求文档。ICPC 的 CCS 要求文档给出了明确的规范性条款：

> #### Access Restrictions
>
> The following access restrictions MUST apply to GETs on the API endpoints:
>
> - **The `public` role can only access the `/problems` endpoint after the contest has started. That is, before contest start `/problems` returns an empty array for clients with the `public` role.**
> - The `backup` element of the `/teams` endpoint requires the `admin` or `analyst` role for access.
> - The `desktop` and `webcam` elements of the `/teams` endpoint are available for the `public` role only when the scoreboard is not frozen.
> - The `entry_point` and `files` elements of the `/submissions` endpoint are accessible only for clients with `admin` or `analyst` role. The `reaction` element is available to clients with `public` role only when the contest is not frozen.
> - For clients with the `public` role the `/judgements` and `/runs` endpoints MUST NOT include judgements or runs for submissions received while the scoreboard is frozen. ...

（上面逐字引自草案分支 `World_Finals_CCS_Requirements.md:445-465`。同一段规定在**已发布的 2026-01 版**里也在，文件改名为 `Contest_Control_System_Requirements.md:1001-1009` = <https://ccs-specs.icpc.io/2026-01/ccs_system_requirements>；措辞逐字相同，只有 RFC 2119 关键词由 `MUST` 改成了小写 `must`。）

注意措辞是 "returns an empty **array**"，不是 404 —— 端点存在，只是空。这和 `access` 端点的设计是配套的：

> For instance, a client logged in with a team account would see the problems type and team_submit capability before a contest starts, even though they cannot see any problems nor submit yet.

（`Contest_API.md:408-412`。）

也就是说 CLICS 把「能力」与「当下有没有数据」分开：`access` 描述你**将来**能看什么，`/problems` 返回你**现在**能看什么。

### D.6 CMS 的可见性：阶段 + participation 属性 + IP

CMS 用一个整数「阶段」表达选手当下能干什么，定义在 `compute_actual_phase()` 的 docstring 里（`cms/server/contest/phase_management.py:52-70`）：

> The phases, and their meaning, are the following:
> * -2: the user cannot compete because the contest hasn't started yet;
> * -1: the user cannot compete because, even if the contest has already started, its per-user time frame hasn't yet (this usually means the user still has to click on the "start!" button in USACO-like contests);
> * 0: the user can compete;
> * +1: the user cannot compete because, even if the contest hasn't stopped yet, its per-user time frame already has (again, this should normally happen only in USACO-like contests);
> * +2: the user cannot compete because the contest has already stopped and the analysis mode hasn't started yet.
> * +3: the user can take part in analysis mode.
> * +4: the user cannot compete because the contest has already stopped. analysis mode has already finished or has been disabled for this contest.
>
> **A user is said to "compete" if he can read the tasks' statements, submit solutions, see their results, etc.**

阶段由一个装饰器强制：

```python
def actual_phase_required(*actual_phases: int):
    """Return decorator filtering out requests in the wrong phase."""
    ...
            unrestricted = self.current_user is not None and self.current_user.unrestricted
            ...
            if self.r_params["actual_phase"] not in actual_phases and not unrestricted:
```

（`cms/server/contest/phase_management.py:205-240`。注意 `unrestricted` 直接绕过整个检查，`:223,230`。）

**「比赛开始前题目不可见」在 CMS 里的落地**：题面与题目描述页要求阶段 ∈ {0,1,2,3,4}，也就是**排除了 -2 和 -1**：

```python
class TaskDescriptionHandler(ContestHandler):
    @tornado.web.authenticated
    @actual_phase_required(0, 1, 2, 3, 4)
    @multi_contest
    def get(self, task_name):
```

（`cms/server/contest/handlers/task.py:55-58`；题面文件 `:70-73`、附件 `:95-98` 同样。）加上 `get_task()` 的 `Task.contest == self.contest` 过滤（§A.3），共同保证「未开始 ⇒ 没有题面」。

除阶段之外，控制选手能否看到题目的还有三层：

| 机制 | 定义 | 效果 |
|---|---|---|
| `Participation.hidden` | `cms/db/user.py:300-305`（`# A hidden participation (e.g. does not appear in public rankings), can also be used for debugging purposes.`） | 配合 `Contest.block_hidden_participations`（`cms/db/contest.py:110-114`）时**禁止登录**：`cms/server/contest/authentication.py:162-163,263-268,304-307`。即使允许登录，其提交也不会推给 RWS：`cms/service/ProxyService.py:582-587`。官方文档：「Blocked hidden participations: users whose participation is hidden cannot log in if "Block hidden participations" is set in the contest configuration.」（`docs/Configuring a contest.rst:174`） |
| `Participation.unrestricted` | `cms/db/user.py:307-314`（`# An unrestricted participation (e.g. contest time, maximum number of submissions, minimum interval between submissions, maximum number of user tests, minimum interval between user tests), can also be used for debugging purposes.`） | 绕过全部阶段检查（`phase_management.py:223,230`）—— 这是 CMS 的「测试账号」机制，可在比赛开始前看题 |
| IP 限制 | `Participation.ip`（`cms/db/user.py:262-269`）+ `Contest.ip_restriction`（`cms/db/contest.py:128-134`，默认 `True`）+ `Contest.ip_autologin`（`:136-142`） | 登录时校验来源 IP 是否落在 participation 的子网列表内：`cms/server/contest/authentication.py:157-160,254-256`。官方文档：「If this is set, then the login will fail if the IP address that attempted it does not match at least one of the addresses or subnets specified in the participation settings. **If the participation IP address is not set, then no restriction applies.**」（`docs/Configuring a contest.rst:162`） |

⚠️ **关于 `analysis_mode` 的一处更正**：你提到的 `Contest.analysis_mode` 在当前 CMS 里**不存在**。分析模式的三个字段挂在 `Group` 上，不在 `Contest` 上：

```python
class Group(Base):
    __tablename__ = 'groups'
    __table_args__ = (
        UniqueConstraint('contest_id', 'name'),
        UniqueConstraint('id', 'contest_id'),
        CheckConstraint("start <= stop"),
        CheckConstraint("stop <= analysis_start"),
        CheckConstraint("analysis_start <= analysis_stop"),
    )
    ...
    # Beginning and ending of the contest.
    start: datetime = Column(DateTime, nullable=False, default=datetime(2000, 1, 1))
    stop: datetime = Column(DateTime, nullable=False, default=datetime(2100, 1, 1))

    # Beginning and ending of the analysis mode for this group.
    analysis_enabled: bool = Column(Boolean, nullable=False, default=False)
    analysis_start: datetime = Column(DateTime, nullable=False, default=datetime(2100, 1, 1))
    analysis_stop: datetime = Column(DateTime, nullable=False, default=datetime(2100, 1, 1))

    # Max contest time for each user in seconds.
    per_user_time: timedelta | None = Column(Interval, ...)
```

（`cms/db/user.py:48-98`。）

**比赛的开始/结束时间本身也在 `Group` 上，不在 `Contest` 上。** `Contest` 只持有一个 `main_group_id`（`cms/db/contest.py:244-252`），作为默认分组。文档里说的「在 AWS 的比赛配置页启用分析模式」实际编辑的是 group：模板是 `cms/server/admin/templates/fragments/group_settings.html:38,47,55`，读取处是 `cms/server/admin/templates/base.html:34-36` 的 `contest.main_group.analysis_*`。`Contest` 上唯一带 analysis 字样的列是 `allow_unofficial_submission_before_analysis_mode`（`cms/db/contest.py:104-108`）。

这个设计的直接后果是：**同一场比赛的不同 group 可以有不同的起止时间和不同的分析窗口**（`Participation.group_id` 是 `nullable=False`，`cms/db/user.py:339-348`）。

---

## E. 比赛结束之后，题目会怎样

### E.1 DOMjudge：`deactivatetime` 之前一直可见，之后整场消失；没有独立的「归档 / 练习模式」

`deactivatetime` 的官方定义有三处一致表述：

- DB 列注释：`Time contest becomes invisible in team/public views`
- 管理界面 help：`Time when the contest and scoreboard are hidden again. Usually a few hours/days after the contest ends.`（`webapp/src/Form/Type/ContestType.php:77-81`）
- 手册：`When the contest ends, the scores will remain displayed until the deactivate time passes.`（`doc/manual/config-basic.rst:65-66`）

它是**可空**的（`deactivatetime` 列 `DEFAULT NULL`）。留空 ⇒ 比赛永不消失。执行点就是那个选比赛的查询：

```php
->andWhere('c.deactivatetime IS NULL OR c.deactivatetime > :now')
```
（`webapp/src/Service/DOMJudgeService.php:166`，`Contest::isActive()` 同理，`webapp/src/Entity/Contest.php:1264`。）

注意它作用于**整场比赛**，而不是单道题目。DOMjudge 里不存在「比赛结束后把题目放进题库供练习」这种状态转换——题目**从头到尾就在全局题库里**（§A.1），它只是不再被任何进行中的比赛引用而已。

`public` 控制的是「未登录公众能否看」：

- 列注释 `Is this contest visible for the public?`
- 管理界面 help（标签 `Enable public scoreboard`）：`When the public scoreboard is enabled, everyone can see it without logging in. When disabled, only logged in users/teams can see the scoreboard.`（`webapp/src/Form/Type/ContestType.php:138-143`）
- 执行点：`/public/*` 全部路由都传 `onlyPublic: true`（`webapp/src/Controller/PublicController.php:64` 等），落到 `->andWhere('c.public = 1')`（`webapp/src/Service/DOMJudgeService.php:163-164`）

所以 DOMjudge 的「赛后归档」实践就是：**endtime 已过 → unfreeze 放榜 → 保持 `public = 1` 且不设 `deactivatetime`**，比赛与榜单就永久停在只读的公开状态。想让选手继续练这些题，标准做法是**再建一场练习比赛引用同一批题目**（§C.1 的 `practice` / `demoprac` 例子），这也正好是 §B.1 那个多对多设计的用途。

⚠️ 一处细节：比赛结束后队伍**仍然能提交**（§D.1 的矛盾点），提交会被存下来标记为 too-late 且不计分。所以严格说 DOMjudge 的「赛后练习」在原比赛里就能进行，只是不会上榜。这一点我只从代码路径确认了提交会被接受与存储（`webapp/src/Service/SubmissionService.php:1201-1206` 只记日志、无拒绝），至于 too-late 的判定与展示细节没有逐行核实，标为部分 **unverified**。

### E.2 CMS：`analysis_enabled` 开启一个赛后阶段，提交照评但 `official=False`

官方文档（`docs/Configuring a contest.rst:203-210` = <https://cms.readthedocs.io/en/latest/Configuring%20a%20contest.html>）：

> ### Analysis mode
>
> After the contest it is often customary to allow contestants to see the results of all their submissions and use the grading system to try different solutions. CMS offers an analysis mode to do this. **Solutions submitted during the analysis are evaluated as usual, but are marked as not official, and thus do not contribute to the rankings. Users will also be prevented from using tokens.**
>
> The admins can enable the analysis mode in the contest configuration page in AWS; they also must set start end stop time (which must be after the contest end).
>
> By awarding extra time or adding delay to a contestant, it is possible to extend the contest time for a user over the start of the analysis. In this case, the start of the analysis will be postponed for this user. If the contest rules contemplate extra time or delay, we suggest to avoid starting the analysis right after the end of the contest.

对应到代码就是阶段 +3（`phase_management.py:65`：`+3: the user can take part in analysis mode.`）：

- 提交处理器允许阶段 {0,1,2,3}（`cms/server/contest/handlers/tasksubmission.py:78`）
- `official = (actual_phase == 0)`（`:93`）—— 分析期提交必然 `official=False`
- `official=False` 的提交不推给 RWS（`cms/service/ProxyService.py:582-587`）
- 分析期反馈完全放开：`# During analysis mode we show the full feedback regardless of` ...`is_analysis_mode = self.r_params["actual_phase"] == 3`（`cms/server/contest/handlers/tasksubmission.py:312-320`）
- 阶段 +2（赛后、分析未开始）与 +1 想提交，需要 `Contest.allow_unofficial_submission_before_analysis_mode`（`cms/server/contest/handlers/tasksubmission.py:81-85`，列定义 `cms/db/contest.py:104-108`）

题面在阶段 +1/+2/+3/+4 **一直可读**（`actual_phase_required(0, 1, 2, 3, 4)`，`cms/server/contest/handlers/task.py:56,71,97`）。也就是说 CMS 的题目在赛后默认保持可见，只是能不能提交、算不算分随阶段变。

要把题目彻底从选手视野里拿走，只能把它移出比赛（`task.contest = None`，§A.3），或者关掉比赛。

### E.3 CLICS：规范不涉及赛后归档

CLICS 只定义 contest 的 `start_time` / `duration` / `scoreboard_freeze_duration` / `scoreboard_thaw_time`（`JSON_Format.md:349-353`），**没有** deactivate / archive / practice 概念。Contest Package（`Contest_Package.md`）是它对「归档」最接近的回答：把一场比赛的全部数据打成一个包，其中 `problems.json` 与 `problems/<name>/<name>.zip` 保存题目（`:150-180`）。规范里没有「赛后题目进入练习池」这类状态机。

---

## F. Kattis：可达性说明与实测所得

**没有可达的官方文档页。** 我逐一探测了下列地址：

| URL | 结果 |
|---|---|
| `https://open.kattis.com/help` | 404（curl 与 WebFetch 均是） |
| `https://open.kattis.com/about` | 404 |
| `https://kattis.com/documentation` | 404 |
| `https://kattis.com/judge-docs` | 404 |
| `https://open.kattis.com/` | 200 |
| `https://open.kattis.com/problems` | 200 |
| `https://open.kattis.com/contests` | 200 |

因此 Kattis 一节只用两类一手来源：**官方开源 CLI 的源代码**，以及**线上 URL 结构的黑盒实测**。所有结论的置信度低于前三个系统，请据此权衡。

**A（题目住在哪）+ B（复用）—— 全局题库 + 比赛内别名**：

```
HTTP 200  https://open.kattis.com/problems/hello
HTTP 200  https://open.kattis.com/contests/a622b5/problems/hello
HTTP 200  https://open.kattis.com/problems/acm
HTTP 200  https://open.kattis.com/contests/city6p/problems/acm
```

（`/opt/cursor/artifacts/clics_cms_kattis_source_excerpts.log:330-333`。两个 contest id 是从 `https://open.kattis.com/contests` 页面上抓下来的真实比赛。）

同一个 problem slug 在全局路径和比赛路径下都返回 200，页面 `<title>` 也相同（`Hello World! – Kattis, Kattis`）。这与 DOMjudge 的形状一致：全局题目 + 比赛内引用。但**我无法从一手来源确认同一道题能否同时挂在两场进行中的比赛下**，标为 **unverified**。

**C（提交归属）—— 见 §C.4**：`problem` 必填、`contest` 可选、`contest` 与 `assignment` 互斥。这是四个系统里唯一在协议层面允许「提交不属于任何比赛」的。

**D、E**：没有一手来源，全部 **unverified**。

---

## G. 横向对比

| 维度 | DOMjudge | CLICS 规范 | CMS | Kattis |
|---|---|---|---|---|
| 题目住在哪 | **全局池**（`problem`，PK 仅 `probid`） | 只定义 contest 子资源 `contests/<id>/problems`，无全局端点 | **全局池**（`Task.contest_id` 可空） | 全局池（`/problems/<id>` 可达） |
| 题↔赛关系 | **多对多**（`contestproblem` PK `(cid,probid)`） | 不表态 | **一对多**（一题最多一赛） | unverified |
| 同题多赛并行 | ✅ 一等公民，实测通过 | 不表态 | ❌ schema 禁止 | unverified |
| 逐比赛可变的题目属性 | `shortname`/`points`/`allow_submit`/`allow_judge`/`color`/`lazy_eval_results` | `label`/`ordinal`/`rgb`/`color`（与题本体属性拍平在一起） | 不适用（一题一赛） | unverified |
| 提交带 contest 标识 | ✅ `submission.cid`（DDL 可空，ORM 必填）+ 复合 FK →`contestproblem` | ✅ 由 URL 路径承载，对象里**无** `contest_id` | ✅ 经 `participation_id`（`NOT NULL`）间接持有 | 可选参数 `contest` |
| 无比赛的提交 | ❌ 不存在；练习 = 另建一场比赛 | ❌ 端点结构上不可能 | ❌ 不存在；但有 `official=False` 表示不计分 | ✅ 不传 `contest` 即可 |
| 一次提交多赛计分 | ❌ `submission_ibfk_8` 从 DB 层排除 | ❌ 结构上不可表达 | ❌ 一题一赛，前提不成立 | ❌（`--contest`/`--assignment` 互斥） |
| 题目自带可见性字段 | ❌ 无 | ❌ 无 | ❌ 无 | unverified |
| 赛前保密机制 | 三处 `FreezeData::started()` + API 的 `1 = 0` | 规范性条款：public 角色在开赛前 `/problems` 返回空数组 | 阶段 -2/-1 被 `actual_phase_required` 挡掉 | unverified |
| 赛后 | `deactivatetime` 整场隐藏；`public` 控公众可见；无独立练习模式 | 不涉及 | `analysis_enabled` 分析阶段，提交 `official=False` | unverified |
| 时间/阶段挂在哪 | `contest` 表六个里程碑 | `contest` 对象四个字段 | **`Group` 表**（`start`/`stop`/`analysis_*`/`per_user_time`），`Contest` 只有 `main_group_id` | unverified |

---

## H. 未能证实的条目（unverified）

1. **CLICS 是否规定「`uuid` 相同 ⇒ 同一道题」。** `uuid` 的描述只是 "UUID of the problem, as defined in the problem package"（`JSON_Format.md:649`），我没有找到把它规定为跨比赛同一性判据的规范性条文。
2. **Kattis 在不传 `contest` 时的服务端归属推断规则。** CLI 只写了 "server guesses based on contests you are in"（`kattis-cli/submit.py:384`），具体算法是服务端行为，无一手来源。
3. **Kattis 能否让同一题同时出现在两场进行中的比赛。** 只观察到同一 slug 在全局与某一场比赛下均可达，无法证明并行多赛。
4. **Kattis 的赛前保密与赛后归档机制。** 无可达官方文档，未做任何推断。
5. **DOMjudge `endtime` 之后提交的 too-late 判定与展示细节。** 我确认了提交会被接受并存储（`SubmissionService.php:1201-1206` 仅记日志），也引用了管理界面 help 的说法，但没有逐行核实榜单侧如何标记与排除。
6. **DOMjudge 10.0.0DEV 是开发版**（`README.md:9`）。本文引用的 `contestproblem` 八列结构、`(cid, probid)` 主键、`submission_ibfk_8` 复合外键在 7.3.3 的官方 dump（`.github/jobs/data/dj733.sql`）与 2019 年的初始迁移（`Version20190803123217.php:151-169`）里都存在，属于长期稳定结构；但 10.0.0DEV 新增的 `scoreboard_type` / `testcase_group` / `Problem.types` 等尚未随稳定版发布（最新稳定 tag 是 `9.0.1`）。

---

## 对三个问题的直接回答

### 1. 赛题与比赛同时发布时，题目自身如何声明可见性（还是根本不需要自己声明）？

**根本不需要自己声明。四个系统里没有任何一个在题目实体上放可见性字段。**

- **DOMjudge**：`problem` 表的完整列清单（§A.1）里没有 `visible` / `published` / `status` 之类的东西。可见性是**推导出来的**，输入有三个：(a) 这道题在不在某场比赛的 `contestproblem` 里；(b) 那场比赛的 `enabled` / `public` / `open_to_all_teams` / `activatetime` / `deactivatetime` 让不让当前这个人看到它（`DOMJudgeService.php:154-175`）；(c) 那场比赛过没过 `starttime`（`FreezeData::started()`，在题目列表 `DOMJudgeService.php:1126`、题面下载 `Team/ProblemController.php:105`、提交 `SubmissionService.php:925`、REST API `API/ProblemController.php:521-524` 四处独立把守）。唯一「像是题目自己的」开关是 `contestproblem.allow_submit`，而它也**挂在连接表上而不是题目上**——它的语义是「这道题在**这一场**比赛里对队伍不存在」（手册原文：`teams will not see that problem on the scoreboard`，`doc/manual/config-basic.rst:103-104`）。

- **CLICS**：problem 对象十六个属性里没有可见性字段（§A.2）。可见性是**服务端按角色与比赛阶段过滤集合**的结果，规范以「返回空数组」的形式写死：`before contest start /problems returns an empty array for clients with the public role`（`Contest_Control_System_Requirements.md:1003-1005`）。

- **CMS**：`Task` 上没有可见性字段——整个类（`cms/db/task.py:52-297`）的列清单是 `id`/`num`/`contest_id`/`name`/`title`/`submission_format`/`primary_statements`/`allowed_languages`/`token_*`/`max_*`/`min_*`/`feedback_level`/`score_precision`/`score_mode`/`active_dataset_id`，没有一个表达「可见」。可见性 = `Task.contest_id` 指向的那场比赛 + 当前选手的 `actual_phase`（`actual_phase_required(0,1,2,3,4)` 排除了赛前的 -2/-1，`cms/server/contest/handlers/task.py:56`）+ participation 的 `hidden`/`unrestricted`/IP。唯一「隐藏题目」的手段是把它移出比赛（`task.contest = None`）。

**对建模的启示**：可见性是 (题, 赛) 绑定关系 + 比赛时间线 + 观察者身份三者的函数，不是题目的属性。把 `visible` 放在题目上，第一次遇到「同一题在 A 赛已公开、在 B 赛还没开始」就会崩。

### 2. 新比赛引用已有题目，是否是一等公民？

**看是哪一系：ICPC 系（DOMjudge）是彻底的一等公民；IOI 系（CMS）是一等公民但互斥。**

- **DOMjudge —— 是，而且是设计核心。** 连接表 `contestproblem` 的主键是 `(cid, probid)`，表注释原文就是 `Many-to-Many mapping of contests and problems`。评委界面加题时的候选集是**整个全局题库**，不带任何过滤（`ContestProblemType.php:22-30`）；题目列表页专门有一列 `# contests`（`Jury/ProblemController.php:84`）。所有「这道题在这场比赛里长什么样」的属性——编号、分值、颜色、能不能交、能不能评、惰性评测策略——**全部挂在连接行上**，所以同一道题在不同比赛里可以完全不同的面貌。实测：一行 `problem` + 两行 `contestproblem`，label `A` vs `C`、分值 1 vs 5、`allow_submit` 1 vs 0、颜色 magenta vs limegreen（`/opt/cursor/artifacts/domjudge_schema_verification.log:114-130`）。**不需要复制题目，不需要新建题目 ID。**

- **CMS —— 是一等公民，但同时只能属于一场。** 官方文档一句话说死：`A task cannot be associated to more than one contest, but you can have tasks temporarily not associated to any.`（`docs/Data model.rst:30`）。机制是单值可空外键 `Task.contest_id`（`cms/db/task.py:87-95`）。AWS 里「Remove from contest」与「add task」是一对对称的一等操作（`cms/server/admin/handlers/contesttask.py:81-84,174-176`），中间态就是那个 `contest_id IS NULL` 的题池（`:46-51`）。所以 CMS 支持的是**串行复用**：一道题（连同它的 datasets、statements）可以先后服务多场比赛。要**并行**，只能建两个 `Task` 行，且因为 `Task.name` 全局唯一（`:98-101`），连名字都得改。

- **CLICS —— 规范不表态。** 它只描述单场比赛的对外视图，既无机制表达跨赛复用，也无禁止（§B.2）。

- **Kattis —— unverified**（§F）。

**对建模的启示**：如果你要支持「同一题同时出现在多场比赛」，DOMjudge 的连接表是被大规模验证过的形状，而且关键在于**把逐比赛可变的属性放到连接行上**，而不是放在题目上再想办法覆盖。

### 3. 同一题被多场比赛引用时，提交入口是否分开，一次提交是否可能在多场比赛计分？

**入口分开，一次提交绝不可能在多场计分。四个系统无一例外。**

**入口分开：**

- **DOMjudge**：URL 层面就分开。REST 的创建路由是 `POST /contests/{cid}/submissions`（`API/SubmissionController.php:114`），没有无 `cid` 的写入口。队伍界面靠「当前选中的比赛」区分：`SubmissionService::submitSolution()` 的 `$contest` 是必填参数（`:829,833`），题目下拉框的候选集按 `cp.contest = :contest` 过滤（`SubmitProblemType.php:55-59`）。
- **CLICS**：`contests/<id>/submissions` 是唯一形态（`Contest_API.md:381`）。
- **CMS**：CWS 每个 handler 都带 `@multi_contest`，`get_task()` 强制 `Task.contest == self.contest`（`cms/server/contest/handlers/contest.py:262-265`）——而且因为一题只属一赛，这个问题在 CMS 里不成立。
- **Kattis**：靠可选的 `contest` 参数区分；不传时服务端按报名状态推断（`kattis-cli/submit.py:260-261,382-384`）。

**不可能多赛计分：**

- **DOMjudge —— 数据库层面排除。** `submission` 只有**一个** `cid` 列，且有复合外键 `submission_ibfk_8 (cid, probid) → contestproblem (cid, probid)`。实测（`/opt/cursor/artifacts/domjudge_schema_verification.log:132-152`）：同一题在两场比赛各交一次，得到的是 `submitid=1 (cid=1)` 和 `submitid=2 (cid=2)` **两行独立记录**；而试图写入一个该比赛并未收录该题的 `(cid, probid)` 组合，直接 `ERROR 1452` 被外键拒绝。要在两场比赛都有成绩，就必须交两次。

- **CLICS —— 结构上不可表达。** submission 对象根本没有 `contest_id` 属性（`JSON_Format.md:970-981`），归属完全由 URL 承载；`contest_time` 也预设了单一参照系。

- **CMS —— 前提不成立。** 一次提交 → 一个 `participation_id`（`NOT NULL`）→ 一个 `contest_id`（`NOT NULL`）（`cms/db/submission.py:67-72`、`cms/db/user.py:316-322`）。加上一题只属一赛，「同题多赛」在 CMS 里根本不可能发生。

- **Kattis —— 互斥。** `--assignment` 与 `--contest` 在同一个 `add_mutually_exclusive_group()` 里（`kattis-cli/submit.py:378-384`），一次提交最多归属一个上下文。

**一个额外的观察，与「计分」相关但不同**：DOMjudge 与 CMS 都有「提交存在、但不计分」的表示，而且两家的做法不一样。

- DOMjudge 用 `submission.valid`（`If false ignore this submission in all scoreboard calculations`），这是**评委的管理动作**（rejudge 相关）。
- CMS 用 `Submission.official`（`If false, submission will not be considered in contestant's score.`），这是**按提交时所处阶段自动决定**的：`official = (actual_phase == 0)`（`cms/server/contest/handlers/tasksubmission.py:93`）。

CMS 的 `official` 值得单独学：它让「赛后练习」不需要新建比赛、不需要新建题目、不需要复制任何东西——同一场比赛、同一道题、同一个提交入口，只是那一位 boolean 变成 false，排行榜服务就自动跳过它（`cms/service/ProxyService.py:582-587`）。DOMjudge 达成同样效果的做法则是**再建一场练习比赛引用同一批题**，这也正是它那张多对多表的日常用途。

---

## 附：本报告引用的一手来源清单

**DOMjudge** —— `github.com/DOMjudge/domjudge` @ `79032b304c4d3316b0204ff2a0d231abc2482d57`（`README.md:9` 自报 `version 10.0.0DEV`；最新稳定 tag 为 `9.0.1`）

- 实体：`webapp/src/Entity/Problem.php`、`ContestProblem.php`、`Contest.php`、`Submission.php`
- 迁移：`webapp/migrations/Version20190803123217.php`（`contestproblem` 初始 DDL）、`Version20190803151406.php`（`submission_ibfk_8`）、`Version20201110113446.php`（`submission.cid` 改为可空）、`Version20221004135409.php` / `Version20240319140330.php`（`lazy_eval_results`）
- 服务与控制器：`webapp/src/Service/DOMJudgeService.php`、`SubmissionService.php`、`ScoreboardService.php`；`webapp/src/Controller/Team/ProblemController.php`、`Team/SubmissionController.php`、`Jury/ProblemController.php`、`PublicController.php`、`API/ProblemController.php`、`API/SubmissionController.php`
- 表单（权威 UI 文案）：`webapp/src/Form/Type/ContestType.php`、`ContestProblemType.php`、`SubmitProblemType.php`
- 工具：`webapp/src/Utils/FreezeData.php`
- 安装脚本：`sql/dj_setup_database.in`
- CI 数据：`.github/jobs/data/dj733.sql`（DOMjudge 7.3.3 官方 dump，用于升级测试）
- 官方手册：`doc/manual/config-basic.rst`、`import.rst`；发布版 <https://www.domjudge.org/docs/manual/main/config-basic.html>
- **本机验证**：按 `dj_setup_database.in` 的方式跑完 126 个 Doctrine 迁移后 dump 的真实 DDL 与三组实测，见 `/opt/cursor/artifacts/domjudge_schema_verification.log`

**ICPC CLICS** —— `github.com/icpc/ccs-specs`

- `master`（= 站点 `draft`）@ `39e96730f7b3bc713fe9c5de531878478beff351`：`Contest_API.md`、`JSON_Format.md`、`Contest_Package.md`、`World_Finals_CCS_Requirements.md`、`json-schema/problem.json`、`json-schema/submission.json`
- 已发布分支 `2026-01` @ `cfeceec14783a9dafc24ad15369afaa767423f5f`：`Contest_API.md`、`Contest_Control_System_Requirements.md`
- 站点：<https://ccs-specs.icpc.io/draft/contest_api>、<https://ccs-specs.icpc.io/draft/json_format>、<https://ccs-specs.icpc.io/draft/contest_package>、<https://ccs-specs.icpc.io/2026-01/contest_api>、<https://ccs-specs.icpc.io/2026-01/ccs_system_requirements>

**CMS** —— `github.com/cms-dev/cms` @ `114df9cba222521c047e41f57936e21f898a8f4b`

- 数据模型：`cms/db/task.py`、`cms/db/contest.py`、`cms/db/user.py`、`cms/db/submission.py`
- 选手端：`cms/server/contest/phase_management.py`、`handlers/contest.py`、`handlers/task.py`、`handlers/tasksubmission.py`、`handlers/api.py`、`authentication.py`
- 管理端：`cms/server/admin/handlers/contesttask.py`、`templates/fragments/group_settings.html`、`templates/base.html`
- 服务：`cms/service/ProxyService.py`
- 官方文档：`docs/Data model.rst`、`docs/Configuring a contest.rst`；发布版 <https://cms.readthedocs.io/en/latest/Data%20model.html>、<https://cms.readthedocs.io/en/latest/Configuring%20a%20contest.html>

**Kattis**

- 官方 CLI `github.com/Kattis/kattis-cli` @ `58daa46da95d43793ac2112c0a7ecc9f7280e560`：`submit.py`
- 线上实测：`https://open.kattis.com/problems/<id>`、`https://open.kattis.com/contests/<cid>/problems/<id>`、`https://open.kattis.com/contests`
- **无可达的官方文档页**（`/help`、`/about`、`kattis.com/documentation` 均 404）

CLICS / CMS / Kattis 的原文摘录汇总见 `/opt/cursor/artifacts/clics_cms_kattis_source_excerpts.log`。
