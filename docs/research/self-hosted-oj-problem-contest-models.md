# 自建 OJ / CTF 平台如何建模 Problem / Contest / Visibility / Submission

与 `icpc-ioi-problem-contest-models.md`（DOMjudge / CLICS / CMS / Kattis）和
`oj-problem-contest-models.md`（Codeforces / AtCoder / 洛谷 / DMOJ）同一组问题，
换一批可自建、schema 可直接阅读的系统。

## 0. 方法与证据等级

全部结论来自 `git clone --depth 1` 下来的源码。行号对应下表的 HEAD。

| 系统 | 仓库 | HEAD | 提交日期 |
|---|---|---|---|
| QDUOJ | `QingdaoU/OnlineJudge` | `df873278ab1b29510aa3a0979677d7aa9a53ca0e` | 2024-10-23 |
| HydroOJ | `hydro-dev/Hydro` | `73b2e4d75d2d9a50895fffb1d6f61bceed4356e7` | 2026-09-01 |
| UOJ | `UniversalOJ/UOJ-System` | `1fd7777778103a34c4951e132f2accdfb0effbc7` | 2026-03-19 |
| SYZOJ | `syzoj/syzoj` | `573796fa7670e28d428692f1d91e7ea50ee154e5` | 2023-08-03 |
| CTFd | `CTFd/CTFd` | `91ced62d44d3ec3142a0948ee96ed19947cfc979` | 2026-08-19 |
| HUSTOJ | `zhblue/hustoj` | `1340a7120ddfea4efcfeb34b45a333233c6faeb7` | 2026-08-30 |

QDUOJ 另有两处历史版本经 GitHub API 取回（`0fdaab7e88`，2017-02；`0f9f34df65`，2017-12-03），
仅用于解释当前字段语义的由来，正文均标明 SHA。

未能从源码证实的条目集中列在第 7 节。

---

## A. 题目住在哪里

### QDUOJ：同一张表，靠 nullable FK 区分；赛题是独立副本

```python
# problem/models.py:37-42
class Problem(models.Model):
    # display ID
    _id = models.TextField(db_index=True)
    contest = models.ForeignKey(Contest, null=True, on_delete=models.CASCADE)
    # for contest problem
    is_public = models.BooleanField(default=False)
```

```python
# problem/models.py:72-73, 85-88
    rule_type = models.TextField()
    visible = models.BooleanField(default=True)
...
    class Meta:
        db_table = "problem"
        unique_together = (("_id", "contest"),)
        ordering = ("create_time",)
```

四个 ID / 可见性字段的语义：

- `id` — Django 自动主键，全局唯一，判题、提交、榜单内部一律用它。
- `_id`（display id）— 展示编号，`TextField(db_index=True)`，**不唯一**；唯一性由
  `unique_together = (("_id", "contest"))` 保证，即「同一场比赛内不重复」。公开题库那一侧
  （`contest IS NULL`）的唯一性靠应用层检查：`problem/views/admin.py:207-208` 的
  `if Problem.objects.filter(_id=_id, contest_id__isnull=True).exists(): return self.error("Display ID already exists")`。
- `visible` — 题目自身的开关。公开题库的每条查询都硬性附带 `visible=True`
  （`problem/views/oj.py:22, 54, 65`），比赛内查询同样带（`:103, 114`）。
- `is_public` — 注释写着 `# for contest problem`。它不是「这题是否公开」的开关，而是
  「这条赛题记录是否已经被复制到公开题库过」的去重标记，见下文 `MakeContestProblemPublicAPIView`。

当前 master 没有 `AbstractProblem`（全仓库零命中）。2017-02 的 `0fdaab7e88` 曾是
`problem` 与 `contest_problem` 两张物理表共享一个抽象基类，migration
`problem/migrations/0008_auto_20170923_1318.py` 把两者合并为一张表
（`RemoveField(contestproblem.contest)` :31-33、`AddField(problem.contest)` :43-45、
`AddField(problem.is_public)` :49-51、`DeleteModel(ContestProblem)` :63-64）。
「副本」语义在合并前后没有改变，只是副本从另一张表变成同表的另一行。

复制发生在把已有公开题加进比赛时，用 Django 官方的复制惯用法 `pk = None; save()`：

```python
# problem/views/admin.py:471-496
class AddContestProblemAPI(APIView):
    @validate_serializer(AddContestProblemSerializer)
    def post(self, request):
        ...
        if Problem.objects.filter(contest=contest, _id=data["display_id"]).exists():
            return self.error("Duplicate display id in this contest")

        tags = problem.tags.all()
        problem.pk = None
        problem.contest = contest
        problem.is_public = True
        problem.visible = True
        problem._id = request.data["display_id"]
        problem.submission_number = problem.accepted_number = 0
        problem.statistic_info = {}
        problem.save()
        problem.tags.set(tags)
        return self.success()
```

`problem.pk = None` 之后 `save()` INSERT 一行新记录：新 `id`、新 `_id`、`contest` 指向本场、
计数器清零。原题行不变。测试数据目录 `test_case_id` 被两行共享，是唯一的共用资源。
该 API 由 `0f9f34df65`（commit message「支持选取已有题目作为比赛题目」）引入。

反方向（赛后公开）是第二次复制，见 E 节。

### HydroOJ：全局题目 + 比赛文档上的 `pids` 数组

```ts
// packages/hydrooj/src/interface.ts:254-271
export interface Tdoc extends Document {
    docId: ObjectId;
    docType: document['TYPE_CONTEST'];
    beginAt: Date;
    endAt: Date;
    attend: number;
    title: string;
    content: string;
    rule: string;
    pids: number[];
    rated?: boolean;
    _code?: string;
    assign?: string[];
    ...
}
```

`ProblemDoc` 上没有比赛字段（`packages/hydrooj/src/interface.ts:166-190`）：只有
`hidden?: boolean`、`sort`、`difficulty`、`reference` 等。`reference` 是**跨 domain**
引用（`ProblemModel.copy`，`packages/hydrooj/src/model/problem.ts:252-264`），与
「比赛引用题目」是两回事。

### UOJ：纯连接表，题目表上没有任何比赛列

```sql
-- db/app_uoj233.sql:270-274
CREATE TABLE `contests_problems` (
  `problem_id` int(11) NOT NULL,
  `contest_id` int(11) NOT NULL,
  PRIMARY KEY (`problem_id`,`contest_id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
```

只有两列，复合主键。题目表完全不知道比赛存在（`db/app_uoj233.sql:452-463`），
可见性只有一个 `is_hidden tinyint(1) NOT NULL DEFAULT '0'`。

赛内题号是推导出来的，不存列：

```php
// web/app/libs/uoj-query-lib.php:63-68
function queryContestProblemRank($contest, $problem) {
	if (!DB::selectFirst("select * from contests_problems where contest_id = {$contest['id']} and problem_id = {$problem['id']}")) {
		return null;
	}
	return DB::selectCount("select count(*) from contests_problems where contest_id = {$contest['id']} and problem_id <= {$problem['id']}");
}
```

即「本场中 `problem_id` 不大于它的题数」——题号顺序恒等于 `problem_id` 升序，无法手工排序。
字母由此得出：`$problem_letter = chr(ord('A') + $problem_rank - 1);`（`web/app/controllers/problem.php:18`）。

唯一的「比赛维度题目属性」是 `contests.extra_config` 里的 `problem_{id}` 键，取值
`[sample]` / `[full]` / `[no-details]`，控制赛中该题跑样例还是全量数据
（`web/app/controllers/contest_manage.php:99-114`）。

### SYZOJ：比赛行上的一个管道分隔字符串

```ts
// models/contest.ts:47-58
  @TypeORM.Column({ nullable: true, type: "text" })
  problems: string;
  ...
  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;
```

没有 `ContestProblem` 实体、没有连接表。`problems` 是 `text` 列，内容形如 `"1|5|12"`：

```ts
// models/contest.ts:95-112
  async getProblems() {
    if (!this.problems) return [];
    return this.problems.split('|').map(x => parseInt(x));
  }
```

题目本体是全局的，`Problem` 上只有 `is_public`（`models/problem.ts:93-95`）、
`publicizer_id`（`:57-58`）、`publicize_time`（`:106-108`）。

赛内题号就是数组下标，路由用 1-based 序号而不是真实 `problem_id`：

```ts
// modules/contest.js:500-506
    let problems_id = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
```

路由是 `/contest/:id/problem/:pid`（`modules/contest.js:493`）——赛中 URL 完全不泄露真实题号。
提交详情页做同样的反向映射：`judge.problem_id = problems_id.indexOf(judge.problem_id) + 1;`（`:462`）。

### CTFd：单事件，没有 contest 表

`CTFd/models/__init__.py` 的全部 `__tablename__`：`notifications, pages, challenges, hints,
awards, tags, topics, challenge_topics, solutions, files, flags, users, admins, teams,
submissions, solves, unlocks, tracking, config, tokens, comments, fields, field_entries,
brackets, audiences, audience_members, modules, module_audience_access, ratings`。

没有任何 contest / event / round 表。时间窗口是全局 config 键值：

```python
# CTFd/utils/dates/__init__.py:48-55
def ctf_started():
    return time.time() > int(get_config("start") or 0)


def ctf_ended():
    if int(get_config("end") or 0):
        return time.time() > int(get_config("end") or 0)
    return False
```

一个 CTFd 部署 = 一场比赛。「多场比赛」等价于「多个部署」。

最接近分组的是 `Challenges.module_id`，单值 nullable FK：

```python
# CTFd/models/__init__.py:110-134
class Challenges(db.Model):
    __tablename__ = "challenges"
    ...
    state = db.Column(db.String(80), nullable=False, default="visible")
    ...
    scheduled_at = db.Column(db.DateTime, nullable=True)
    module_id = db.Column(
        db.Integer, db.ForeignKey("modules.id", ondelete="SET NULL"), nullable=True
    )

    requirements = db.Column(db.JSON)
```

### HUSTOJ：连接表，且是六者中信息最丰富的一张

```sql
-- trunk/install/db.sql:27-35
CREATE TABLE IF NOT EXISTS `contest_problem` (
  `problem_id` int(11) NOT NULL DEFAULT '0' COMMENT '题号',
  `contest_id` int(11) DEFAULT NULL COMMENT '所属比赛ID',
  `title` char(200) NOT NULL DEFAULT '' COMMENT '题目标题(比赛显示)',
  `num` int(11) NOT NULL DEFAULT '0' COMMENT '比赛内编号(A/B/C...)',
  `c_accepted` int(11) NOT NULL DEFAULT '0' COMMENT '比赛内通过次数',
  `c_submit` int(11) NOT NULL DEFAULT '0' COMMENT '比赛内提交次数',
  KEY `Index_contest_id` (`contest_id`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
```

除关联外还带 `num`（可自定义赛内顺序，UOJ / SYZOJ 都做不到）、`title`（赛内可改题名）、
per-(赛, 题) 计数器 `c_accepted` / `c_submit`。注意它**只有 KEY 没有 PRIMARY KEY / UNIQUE**，
schema 层面不阻止重复行。

题目表就一个 `defunct char(1) NOT NULL DEFAULT 'N' COMMENT '已停用标记(N=显示 Y=隐藏)'`
（`trunk/install/db.sql:84-106`）。

---

## B. 在新比赛里复用已有题目

| 系统 | 能否 | 依据 |
|---|---|---|
| QDUOJ | **否**（只能复制多份） | 一行 `problem` 只有一个 `contest_id`；副本间无任何互指列（`problem/models.py:37-83` 全部字段） |
| HydroOJ | **是，一等公民** | `{ pids: pid }` 数组包含查询，见下 |
| UOJ | **是** | 复合主键 `(problem_id, contest_id)` |
| SYZOJ | **是，但无索引支持** | 字符串可含任意题号，无唯一约束 |
| CTFd | 不适用 | 单事件 |
| HUSTOJ | **是** | 连接表，且代码处处假设一题多赛 |

Hydro 是唯一把「引用」建成双向可查关系的：

```ts
// packages/hydrooj/src/model/contest.ts:857-860
export async function getRelated(domainId: string, pid: number, rule?: string) {
    const rules = Object.keys(RULES).filter((i) => !RULES[i].hidden);
    return await document.getMulti(domainId, document.TYPE_CONTEST, { pids: pid, rule: rule || { $in: rules } }).toArray();
}
```

并在这之上建了真功能——题目详情页列出「本题被哪些比赛 / 作业用过」，还按 `assign` 过滤：

```ts
// packages/hydrooj/src/handler/problem.ts:417-423
            [this.response.body.ctdocs, this.response.body.htdocs] = (await Promise.all([
                contest.getRelated(this.args.domainId, this.pdoc.docId),
                contest.getRelated(this.args.domainId, this.pdoc.docId, 'homework'),
            ])).map((tdocs) => tdocs.filter((tdoc) =>
                this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST) || !tdoc.assign?.length
                || new Set(tdoc.assign).intersection(new Set(this.user.group)).size,
            ));
```

删题时用它做引用完整性检查：

```ts
// packages/hydrooj/src/handler/problem.ts:448-453
    async postDelete() {
        if (!this.user.own(this.pdoc, PERM.PERM_EDIT_PROBLEM_SELF)) this.checkPerm(PERM.PERM_EDIT_PROBLEM);
        const tdocs = await contest.getRelated(this.args.domainId, this.pdoc.docId);
        if (tdocs.length) throw new ProblemAlreadyUsedByContestError(this.pdoc.docId, tdocs[0]._id);
        await problem.del(this.pdoc.domainId, this.pdoc.docId);
```

UOJ 的多赛遍历出现在附件下载的鉴权上——只要用户在引用该题的任一比赛里报了名且已开赛，就放行：

```php
// web/app/controllers/download.php:9-19
			$visible = isProblemVisibleToUser($problem, $myUser);
			if (!$visible && $myUser != null) {
				$result = DB::query("select contest_id from contests_problems where problem_id = {$_GET['id']}");
				while (list($contest_id) = DB::fetch($result, MYSQLI_NUM)) {
					$contest = queryContest($contest_id);
					genMoreContestInfo($contest);
					if ($contest['cur_progress'] != CONTEST_NOT_STARTED && hasRegistered($myUser, $contest) && queryContestProblemRank($contest, $problem)) {
						$visible = true;
					}
				}
			}
```

SYZOJ 虽然 schema 允许多赛，但源码中**不存在**任何反向查询，删题也无引用检查——
「一题多赛」可行，但系统对此一无所知。

---

## C. 提交归属

### 归属字段一览

| 系统 | 字段 | 空值约定 |
|---|---|---|
| QDUOJ | `Submission.contest` FK（`submission/models.py:27`） | `null` = 练习 |
| HydroOJ | `RecordDoc.contest: ObjectId`（`interface.ts:212-217`） | 两个哨兵 ObjectId 占位 |
| UOJ | `submissions.contest_id`（`db/app_uoj233.sql:584`） | `NULL` = 练习 |
| SYZOJ | `judge_state.type` + `type_info`（`models/judge_state.ts:90-103`） | `type=0` = 普通 |
| CTFd | 无 | 不适用 |
| HUSTOJ | `solution.contest_id`（`db.sql:140`） | `0` = 非赛 |

### QDUOJ

```python
# submission/models.py:25-28
class Submission(models.Model):
    id = models.TextField(default=rand_str, primary_key=True, db_index=True)
    contest = models.ForeignKey(Contest, null=True, on_delete=models.CASCADE)
    problem = models.ForeignKey(Problem, on_delete=models.CASCADE)
```

写入点只有一处，且用一条查询同时锁死题与赛：

```python
# submission/views/oj.py:69-80
        try:
            problem = Problem.objects.get(id=data["problem_id"], contest_id=data.get("contest_id"), visible=True)
        except Problem.DoesNotExist:
            return self.error("Problem not exist")
        ...
        submission = Submission.objects.create(user_id=request.user.id,
                                               ...
                                               problem_id=problem.id,
                                               contest_id=data.get("contest_id"))
```

`contest_id` 缺省时匹配 `contest_id IS NULL`（公开题），给定时必须与题目行的 `contest_id` 一致。
由于题目行本身只属于一场，`submission.contest_id` 与 `submission.problem.contest_id` 恒等——
不存在「同一提交归属两场」的表达空间。

榜单是**物化**的，每人每赛一行：

```python
# contest/models.py:58-88
class AbstractContestRank(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    contest = models.ForeignKey(Contest, on_delete=models.CASCADE)
    submission_number = models.IntegerField(default=0)

    class Meta:
        abstract = True


class ACMContestRank(AbstractContestRank):
    accepted_number = models.IntegerField(default=0)
    # total_time is only for ACM contest, total_time =  ac time + none-ac times * 20 * 60
    total_time = models.IntegerField(default=0)
    # {"23": {"is_ac": True, "ac_time": 8999, "error_number": 2, "is_first_ac": True}}
    # key is problem id
    submission_info = JSONField(default=dict)

    class Meta:
        db_table = "acm_contest_rank"
        unique_together = (("user", "contest"),)
```

写入时机在判题完成后，且明确排除非进行中时段与比赛管理员的调试提交：

```python
# judge/dispatcher.py:186-194
        if self.contest_id:
            if self.contest.status != ContestStatus.CONTEST_UNDERWAY or \
                    User.objects.get(id=self.submission.user_id).is_contest_admin(self.contest):
                logger.info(
                    "Contest debug mode, id: " + str(self.contest_id) + ", submission id: " + self.submission.id)
                return
            with transaction.atomic():
                self.update_contest_problem_status()
                self.update_contest_rank()
```

提交列表也是两条完全分离的入口：`SubmissionListAPI` 强制 `contest_id__isnull=True` 且
显式拒绝带 `contest_id` 的请求（`submission/views/oj.py:132-135`），`ContestSubmissionListAPI`
强制 `contest_id=contest.id`（`:164`）。

### HydroOJ

```ts
// packages/hydrooj/src/model/record.ts:159-173
        let isContest = !!args.contest;
        if (args.contest) data.contest = args.contest;
        ...
        } else if (args.type === 'pretest') {
            data.input = args.input || [];
            isContest = false;
            data.contest = RecordModel.RECORD_PRETEST;
        } else if (args.type === 'generate') {
            data.contest = RecordModel.RECORD_GENERATE;
        }
```

`RECORD_PRETEST = new ObjectId('000000000000000000000000')`、`RECORD_GENERATE = ...0001`
（`model/record.ts:39-40`）——这两个哨兵值占用了 `contest` 字段，本身就证明它是单值。

提交入口按 `tid` 分流，`tid` 来自 URL query（`@param('tid', Types.ObjectId, true)`，`handler/problem.ts:488`），是单个 ObjectId：

```ts
// packages/hydrooj/src/handler/problem.ts:529-542
        const rid = await record.add(
            domainId, this.pdoc.docId, this.user._id, lang, code, true,
            pretest ? { input, type: 'pretest' } : { contest: tid, files, type: 'judge' },
        );
        if (!pretest) {
            await Promise.all([
                problem.inc(domainId, this.pdoc.docId, 'nSubmit', 1),
                domain.incUserInDomain(domainId, this.user._id, 'nSubmit'),
                tid && contest.updateStatus(domainId, tid, this.user._id, rid, this.pdoc.docId),
            ]);
        }
```

`contest.updateStatus` 只被调用一次，只往一场比赛的 status doc 里 push journal
（`model/contest.ts:906-923`）。所有赛制的 `stat()` 都先按 `tdoc.pids.includes(j.pid)` 过滤
（`contest.ts:120, 301, 490, 569, 649`），只处理自己名单内的题。

参赛是显式 attend，用 capped inc 保证幂等（`model/contest.ts:932-945`）。

### UOJ

两条路由指向同一个 controller（`web/app/route.php:16, 32`），controller 据此分岔：

```php
// web/app/controllers/problem.php:111-117
		if ($is_in_contest) {
			DB::query("insert into submissions (problem_id, contest_id, submit_time, ...) values (${problem['id']}, ${contest['id']}, now(), ...)");
		} else {
			DB::query("insert into submissions (problem_id, submit_time, ...) values (${problem['id']}, now(), ...)");
		}
```

赛内提交 `contest_id` 有值且 `is_hidden = 0`；练习提交不写 `contest_id`（留 NULL），
`is_hidden` 继承题目的。`$is_in_contest` 的赋值同时是「参赛」的触发点：

```php
// web/app/controllers/problem.php:22-38
	$is_in_contest = false;
	if ($contest != null) {
		if (!hasContestPermission($myUser, $contest)) {
			if ($contest['cur_progress'] == CONTEST_NOT_STARTED) {
				become404Page();
			} elseif ($contest['cur_progress'] == CONTEST_IN_PROGRESS) {
				if ($myUser == null || !hasRegistered($myUser, $contest)) {
					becomeMsgPage("<h1>比赛正在进行中</h1><p>很遗憾，您尚未报名。比赛结束后再来看吧～</p>");
				} else {
					$is_in_contest = true;
					DB::update("update contests_registrants set has_participated = 1 where ...");
				}
			} else {
				$ban_in_contest = !isProblemVisibleToUser($problem, $myUser);
			}
		}
	}
```

UOJ 有六者中最完整的成员模型——显式报名表，并在报名时快照 rating：

```sql
-- db/app_uoj233.sql:292-299
CREATE TABLE `contests_registrants` (
  `username` varchar(20) NOT NULL,
  `user_rating` int(11) NOT NULL,
  `contest_id` int(11) NOT NULL,
  `has_participated` tinyint(1) NOT NULL,
  `rank` int(11) NOT NULL,
  PRIMARY KEY (`contest_id`,`username`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4;
```

另有 `contests_permissions` 与 `problems_permissions` 两张按 username 授权的表
（`:248-252`、`:504-508`）。榜单在「公布成绩」时物化进 `contests_submissions`
（`:317-325`，写入见 `web/app/libs/uoj-contest-lib.php:215`）；赛前赛中实时扫 `submissions` 算
（`uoj-contest-lib.php:149-150, 163-164`），赛后读物化表（`:167`）。

### SYZOJ

```ts
// models/judge_state.ts:90-103
  /*
   * "type" indicate it's contest's submission(type = 1) or normal submission(type = 0)
   * if it's contest's submission (type = 1), the type_info is contest_id
   * use this way represent because it's easy to expand // Menci：这锅我不背，是 Chenyao 留下来的坑。
   */
  @TypeORM.Column({ nullable: true, type: "integer" })
  type: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  type_info: number;
```

写入时的分支，注意 `else` 才检查 `isAllowedUseBy`（即 `is_public`）：

```js
// modules/problem.js:669-686
    let contest_id = parseInt(req.query.contest_id);
    let contest;
    if (contest_id) {
      contest = await Contest.findById(contest_id);
      if (!contest) throw new ErrorMessage('无此比赛。');
      if ((!contest.isRunning()) && (!await contest.isSupervisior(curUser))) throw new ErrorMessage('比赛未开始或已结束。');
      let problems_id = await contest.getProblems();
      if (!problems_id.includes(id)) throw new ErrorMessage('无此题目。');

      judge_state.type = 1;
      judge_state.type_info = contest_id;

      await judge_state.save();
    } else {
      if (!await problem.isAllowedUseBy(curUser)) throw new ErrorMessage('您没有权限进行此操作。');
      judge_state.type = 0;
      await judge_state.save();
    }
    await judge_state.updateRelatedInfo(true);
```

**带 `contest_id` 提交时不检查题目是否公开**，只检查题在 `contest.problems` 里且比赛进行中。
分流的后果是比赛提交不计入用户全局 AC 数与题目统计：

```ts
// models/judge_state.ts:136-153
  async updateRelatedInfo(newSubmission) {
    if (this.type === 0) {
      await this.loadRelationships();
      const promises = [];
      promises.push(this.user.refreshSubmitInfo());
      promises.push(this.problem.resetSubmissionCount());
      if (!newSubmission) {
        promises.push(this.problem.updateStatistics(this.user_id));
      }
      await Promise.all(promises);
    } else if (this.type === 1) {
      let contest = await Contest.findById(this.type_info);
      await contest.newSubmission(this);
    }
  }
```

`ContestPlayer` 是每人每赛一行的物化记录（`models/contest_player.ts:11-29`），**懒式创建**——
第一次提交才建行，SYZOJ 没有报名表（`models/contest.ts:114-142`）。

### CTFd

```python
# CTFd/models/__init__.py:879-899
class Submissions(db.Model):
    __tablename__ = "submissions"
    id = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE")
    )
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    team_id = db.Column(db.Integer, db.ForeignKey("teams.id", ondelete="CASCADE"))
    ...
    type = db.Column(db.String(32))
    __mapper_args__ = {"polymorphic_on": type}
```

`type` 是单表多态判别列，子类 `Solves`（`"correct"`）、`Fails`（`"incorrect"`）、
`Partials`（`"partial"`）、`Discards`（`"discard"`）、`Ratelimiteds`（`"ratelimited"`）。
`Solves` 是单独一张表并带唯一约束：

```python
# CTFd/models/__init__.py:933-962
class Solves(Submissions):
    __tablename__ = "solves"
    __table_args__ = (
        db.UniqueConstraint("challenge_id", "user_id"),
        db.UniqueConstraint("challenge_id", "team_id"),
        {},
    )
```

`UniqueConstraint("challenge_id", "user_id")` 是单事件模型最硬的证据：一个账号对一道题只能有
一条 solve，schema 上无法容纳「同一题在两个赛事里各一条 solve」。

### HUSTOJ

赛内提交按 `(cid, num)` 寻址，再翻成真 `problem_id`：

```php
// trunk/web/submit.php:135-144
    $sql = "SELECT `problem_id` FROM `contest_problem` WHERE `contest_id`=? AND `num`=?";
    $result = pdo_query($sql, $cid, $pid);
```

两条 INSERT 分支（`trunk/web/submit.php:329, 332`）。由于 `num` 也被快照进 `solution`，
改赛题顺序时需要回填：`contest_edit.php:83` 先 `update solution set num=-1 where contest_id=?`，
再逐题 `update solution set num=? where contest_id=? and problem_id=?`（`:97-98`）。

---

## D. 可见性状态机

### QDUOJ

`Contest` 的相关字段（`contest/models.py:11-26`）：`real_time_rank`、`password`、`rule_type`、
`start_time`、`end_time`、`visible`（注释「是否可见 false的话相当于删除」）、`allowed_ip_ranges`。

`status` 是计算属性，没有存储列（`contest/models.py:28-38`）；`contest_type` 同样派生——
有 `password` 即 `PASSWORD_PROTECTED_CONTEST`（`:40-44`）。常量见 `utils/constants.py:8-21`。

**没有报名表**，「参赛资格」= 通过密码校验并在 session 里留痕：

```python
# account/decorators.py:106-132（check_contest_permission 主体）
            try:
                self.contest = Contest.objects.select_related("created_by").get(id=contest_id, visible=True)
            except Contest.DoesNotExist:
                return self.error("Contest %s doesn't exist" % contest_id)

            if not user.is_authenticated:
                return self.error("Please login first.")

            if user.is_contest_admin(self.contest):
                return func(*args, **kwargs)

            if self.contest.contest_type == ContestType.PASSWORD_PROTECTED_CONTEST:
                if not check_contest_password(request.session.get(CONTEST_PASSWORD_SESSION_KEY, {}).get(self.contest.id), self.contest.password):
                    return self.error("Wrong password or password expired")

            # regular user get contest problems, ranks etc. before contest started
            if self.contest.status == ContestStatus.CONTEST_NOT_START and check_type != "details":
                return self.error("Contest has not started yet.")

            if self.contest.status == ContestStatus.CONTEST_UNDERWAY and self.contest.rule_type == ContestRuleType.OI:
                if not self.contest.real_time_rank and (check_type == "ranks" or check_type == "submissions"):
                    return self.error(f"No permission to get {check_type}")
```

赛前隐藏因此不是题目字段，而是第 126-127 行：`check_type != "details"` 时未开赛一律拒。
题目列表用 `check_type="problems"`（`problem/views/oj.py:98`），提交用同一个
（`submission/views/oj.py:37-38`），所以赛前只能看到比赛简介。

`allowed_ip_ranges` 只在提交时校验，不在读题时校验（`submission/views/oj.py:37-46`）。
`real_time_rank` 就是封榜开关。`Contest.problem_details_permission`（`contest/models.py:47-51`）
决定赛中能否看到题目的提交 / AC 计数，不满足时序列化器降级为 `ProblemSafeSerializer`
（`problem/views/oj.py:108-119`）。

### HydroOJ

权限位全表在 `packages/common/permission.ts:1-96`，全部是 `bigint` 位标志。与本题相关的：

```ts
    // Problem
    PERM_CREATE_PROBLEM: 1n << 4n,
    PERM_EDIT_PROBLEM: 1n << 5n,
    PERM_EDIT_PROBLEM_SELF: 1n << 6n,
    PERM_VIEW_PROBLEM: 1n << 7n,
    PERM_VIEW_PROBLEM_HIDDEN: 1n << 8n,
    PERM_SUBMIT_PROBLEM: 1n << 9n,
    PERM_READ_PROBLEM_DATA: 1n << 10n,
```

```ts
// packages/common/permission.ts:59-77
    // Contest
    PERM_VIEW_CONTEST: 1n << 41n,
    PERM_VIEW_CONTEST_SCOREBOARD: 1n << 42n,
    PERM_VIEW_CONTEST_HIDDEN_SCOREBOARD: 1n << 43n,
    PERM_CREATE_CONTEST: 1n << 44n,
    PERM_ATTEND_CONTEST: 1n << 45n,
    PERM_EDIT_CONTEST: 1n << 50n,
    PERM_EDIT_CONTEST_SELF: 1n << 51n,
    PERM_VIEW_HIDDEN_CONTEST: 1n << 68n,

    // Homework
    PERM_VIEW_HOMEWORK: 1n << 52n,
    PERM_VIEW_HOMEWORK_SCOREBOARD: 1n << 53n,
    PERM_VIEW_HOMEWORK_HIDDEN_SCOREBOARD: 1n << 54n,
    PERM_CREATE_HOMEWORK: 1n << 55n,
    PERM_ATTEND_HOMEWORK: 1n << 56n,
    PERM_EDIT_HOMEWORK: 1n << 57n,
    PERM_EDIT_HOMEWORK_SELF: 1n << 58n,
    PERM_VIEW_HIDDEN_HOMEWORK: 1n << 69n,
```

`PERM_BASIC`（游客，`:98-108`）含 `PERM_VIEW_PROBLEM | PERM_VIEW_CONTEST |
PERM_VIEW_CONTEST_SCOREBOARD`，**不含** `PERM_VIEW_PROBLEM_HIDDEN`；`PERM_DEFAULT`
（注册用户，`:110-153`）额外含 `PERM_SUBMIT_PROBLEM`、`PERM_ATTEND_CONTEST`，同样不含。
角色映射见 `packages/hydrooj/src/model/builtin.ts:89-93`；`PERMS` 数组（`:12-78`）把每个位
归到一个 family 供 domain 角色编辑界面分组。

**赛前隐藏有两套机制并存。** 其一是阶段逻辑，不动 `pdoc.hidden`：

```ts
// packages/hydrooj/src/handler/problem.ts:301-318
    @route('pid', Types.ProblemId, true)
    @query('tid', Types.ObjectId, true)
    async _prepare(domainId: string, pid: number | string, tid?: ObjectId) {
        this.pdoc = await problem.get(domainId, pid);
        if (!this.pdoc) throw new ProblemNotFoundError(domainId, pid);
        if (tid) {
            if (!this.tdoc?.pids?.includes(this.pdoc.docId)) throw new ContestNotFoundError(domainId, tid);
            if (contest.isNotStarted(this.tdoc)) throw new ContestNotLiveError(tid);
            if (!contest.isDone(this.tdoc, this.tsdoc) && (!this.tsdoc?.attend || !this.tsdoc.startAt)) throw new ContestNotAttendedError(tid);
            // Delete problem-related info in contest mode
            if (this.pdoc.tag) this.pdoc.tag.length = 0;
            delete this.pdoc.nAccept;
            delete this.pdoc.nSubmit;
            delete this.pdoc.difficulty;
            delete this.pdoc.stats;
        } else if (!problem.canViewBy(this.pdoc, this.user)) {
            throw new PermissionError(PERM.PERM_VIEW_PROBLEM_HIDDEN);
        }
```

`tid` 分支完全不检查 `pdoc.hidden`，只检查「题在名单里 / 已开赛 / 已 attend」；
非 `tid` 分支才走 `canViewBy`。比赛题目列表同理（`handler/contest.ts:294-299`）。
阶段判定函数见 `model/contest.ts:60-81`（`isNotStarted` / `isOngoing` / `isDone` / `isLocked`）。

其二是 `autoHide`，见 E 节。

`hidden` 的两个过滤点：

```ts
// packages/hydrooj/src/model/problem.ts:459-465
    static canViewBy(pdoc: ProblemDoc, udoc: User) {
        if (!udoc.hasPerm(PERM.PERM_VIEW_PROBLEM)) return false;
        if (udoc.own(pdoc)) return true;
        if (udoc.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN)) return true;
        if (pdoc.hidden) return false;
        return true;
    }
```

```ts
// packages/hydrooj/src/handler/problem.ts:44-54
function buildQuery(udoc: User) {
    const q: Filter<ProblemDoc> = {};
    if (!udoc.hasPerm(PERM.PERM_VIEW_PROBLEM_HIDDEN)) {
        q.$or = [
            { hidden: false },
            { owner: udoc._id },
            { maintainer: udoc._id },
        ];
    }
    return q;
}
```

榜单可见性是 per-rule 的纯函数：

| rule | 行 | `showScoreboard` | `showSelfRecord` | `showRecord` |
|---|---|---|---|---|
| `acm`（XCPC） | 103-110 | `now > beginAt` | `true` | `now > endAt && !isLocked` |
| `oi` | 289, 318-320 | `now > endAt && !keepScoreboardHidden` | 同左 | 同左 |
| `ioi` | 468, 472-474 | `now > beginAt` | `true` | `now > endAt && !isLocked` |
| `strictioi` | 480, 483-485 | `now > endAt && !keepScoreboardHidden` | `!keepScoreboardHidden \|\| !isDone` | `now > endAt && !keepScoreboardHidden` |
| `ledo` | 559, 563-565 | `now > beginAt` | `true` | `now > endAt` |
| `homework` | 639, 683-685 | `true` | `true` | `now > endAt` |

权限位在这之上做覆盖（`model/contest.ts:1006-1028` 的 `canViewHiddenScoreboard` /
`canShowRecord` / `canShowScoreboard`）。

比赛准入用 `assign`（分组名数组）：

```ts
// packages/hydrooj/src/handler/contest.ts:89-94
        if (this.tdoc.assign?.length && !this.user.own(this.tdoc) && !this.user.hasPerm(PERM.PERM_VIEW_HIDDEN_CONTEST)) {
            const groups = await user.listGroup(domainId, this.user._id);
            if (!new Set(this.tdoc.assign).intersection(new Set(groups.map((i) => i.name))).size) {
                throw new NotAssignedError('contest', tid);
            }
        }
```

另有 `_code`（邀请码）在 attend 时校验（`:180`）。

### UOJ

进度是 `contests.status`（存储列，取值 `unfinished` / `testing` / `finished`）与当前时间共同推导
（常量 `web/app/libs/uoj-contest-lib.php:2-6`，推导 `:107-119`）。

题目可见性有两个函数，全局与比赛内各一个：

```php
// web/app/libs/uoj-query-lib.php:109-123
function isProblemVisibleToUser($problem, $user) {
	return !$problem['is_hidden'] || hasProblemPermission($user, $problem);
}
function isContestProblemVisibleToUser($problem, $contest, $user) {
	if (isProblemVisibleToUser($problem, $user)) {
		return true;
	}
	if ($contest['cur_progress'] >= CONTEST_PENDING_FINAL_TEST) {
		return true;
	}
	if ($contest['cur_progress'] == CONTEST_NOT_STARTED) {
		return false;
	}
	return hasRegistered($user, $contest);
}
```

第二个函数就是完整答案：赛前 `CONTEST_NOT_STARTED` 返回 false（且 `problem.php:26-27` 直接
404）；赛中只有报名者可见；赛后（`>= CONTEST_PENDING_FINAL_TEST`，即时间过了 `end_time`）
对所有人可见，无需任何管理员动作。

提交可见性也分两层：`isSubmissionVisibleToUser`（列表级，看 `submissions.is_hidden`，
`uoj-query-lib.php:125-133`）与 `isSubmissionFullVisibleToUser`（代码级，`:144-156`）。

### SYZOJ

比赛类型是硬编码枚举，决定赛中能看到什么（`models/contest.ts:11-15, 75-93`）：
`allowedSeeingOthers`（仅 `acm`）、`allowedSeeingScore`（仅 `ioi`）、
`allowedSeeingResult`（`ioi` / `acm`）、`allowedSeeingTestcase`（仅 `ioi`）。
赛制不可配置，对比 Hydro 的可插拔 `ContestRule`。

提交可见性：

```ts
// models/judge_state.ts:121-134
  async isAllowedVisitBy(user) {
    await this.loadRelationships();

    if (user && user.id === this.problem.user_id) return true;
    else if (this.type === 0) return this.problem.is_public || (user && (await user.hasPrivilege('manage_problem')));
    else if (this.type === 1) {
      let contest = await Contest.findById(this.type_info);
      if (contest.isRunning()) {
        return user && await contest.isSupervisior(user);
      } else {
        return true;
      }
    }
  }
```

赛中比赛提交只有管理员可见，赛后对所有人可见——与 UOJ 同样是时间驱动的自动放开。

赛前隐藏的关键分支只有五行，把 SYZOJ 的模型讲清楚了：

```js
// modules/contest.js:509-515
    contest.ended = contest.isEnded();
    if (!await contest.isSupervisior(curUser) && !(contest.isRunning() || contest.isEnded())) {
      if (await problem.isAllowedUseBy(res.locals.user)) {
        return res.redirect(syzoj.utils.makeUrl(['problem', problem_id]));
      }
      throw new ErrorMessage('比赛尚未开始。');
    }
```

赛前访问 `/contest/:id/problem/:pid`，如果该题本来就是公开题，就跳转到 `/problem/:id`；
如果题不公开，报「比赛尚未开始」。**比赛引用一道公开题，不会让它变得不可见。**

### CTFd

`Challenges.state` 是裸 `db.String(80)`，没有 DB 层枚举、没有 marshmallow 校验。
实际取值只能从消费方反推，共三个：

```python
# CTFd/utils/challenges/__init__.py:40-49
    chal_q = Challenges.query
    # Admins can see hidden and locked challenges in the admin view
    if admin is False:
        chal_q = chal_q.filter(
            and_(Challenges.state != "hidden", Challenges.state != "locked"),
            or_(
                Challenges.scheduled_at.is_(None),
                Challenges.scheduled_at <= datetime.datetime.utcnow(),
            ),
        )
```

```python
# CTFd/api/v1/challenges.py:720-728（attempt 端点）
        if challenge.state == "hidden":
            abort(404)

        if challenge.state == "locked":
            abort(403)

        if not can_access_challenge(challenge, user):
            abort(404)
```

- `"visible"` — 模型默认值（`models/__init__.py:122`）
- `"hidden"` — 列表过滤掉、详情 404、attempt 404
- `"locked"` — 列表过滤掉、attempt **403**（语义是「你知道它在，但现在不能交」）

管理 UI 只暴露前两个（`CTFd/themes/admin/templates/challenges/update.html:189-192`）；
新建题目时强制 `hidden`（`create.html:58`）。`"locked"` 只能由 API 或插件写入。

四个 visibility config 的取值枚举（`CTFd/constants/options.py:4-43`）：
`ChallengeVisibilityTypes` = PUBLIC / PRIVATE / ADMINS；
`ScoreVisibilityTypes` = PUBLIC / PRIVATE / **HIDDEN** / ADMINS（多出的 HIDDEN 就是 CTF 的封榜）；
`AccountVisibilityTypes` = PUBLIC / PRIVATE / ADMINS；
`RegistrationVisibilityTypes` = PUBLIC / PRIVATE / MLC。

执行在装饰器层（`CTFd/utils/decorators/visibility.py:55-86`）。**两者是与逻辑且层级不同**：
`challenge_visibility` 是装饰器层、全局、判断「你这个身份能不能碰题目端点」；`state` 是
查询 / 记录层、逐题、判断「这道题存不存在」。`state` 无法放宽 `challenge_visibility`，
反之亦然。

module + audience 是 CTFd 里最接近「比赛成员制」的东西：

```python
# CTFd/utils/modules/__init__.py:15-49
@cache.memoize(timeout=60)
def get_accessible_module_ids_for_account_id(account_id):
    if account_id is None:
        return set()
    q = (
        Modules.query.with_entities(Modules.id)
        .join(ModuleAudienceAccess, ModuleAudienceAccess.module_id == Modules.id)
        .join(Audiences, Audiences.id == ModuleAudienceAccess.audience_id)
        .join(AudienceMembers, AudienceMembers.audience_id == Audiences.id)
        .filter(AudienceMembers.account_id == account_id)
    )
    return {row.id for row in q.all()}
...
def can_access_challenge(challenge, user):
    """True if the user can access the challenge.

    A challenge is accessible when its scheduled release time (if any) has
    passed AND it either has no module or is in a module the user can access.
    This does not account for admin status; callers are expected to bypass
    this check for admins where appropriate.
    """
    scheduled_at = getattr(challenge, "scheduled_at", None)
    if scheduled_at is not None and scheduled_at > datetime.utcnow():
        return False
    module_id = getattr(challenge, "module_id", None)
    if module_id is None:
        return True
    return module_id in get_accessible_module_ids(user)
```

注意**默认放行**（`module_id is None` 返回 True），与 OJ 的默认隐藏相反。

先决条件机制存在 `requirements` JSON 列里，结构是 `{"prerequisites": [id, ...], "anonymize": ...}`：

```python
# CTFd/api/v1/challenges.py:203-230（列表端点节选）
        all_challenge_ids = {
            c.id for c in Challenges.query.with_entities(Challenges.id).all()
        }
        for challenge in chal_q:
            if challenge.requirements:
                requirements = challenge.requirements.get("prerequisites", [])
                anonymize = challenge.requirements.get("anonymize")
                prereqs = set(requirements).intersection(all_challenge_ids)
                if user_solves >= prereqs or admin_view:
                    pass
                else:
                    if anonymize:
                        if anonymize == "preview":
                            # Show identifying details but don't allow actual access
```

判定用集合包含（`user_solves >= prereqs` 即超集）；`prereqs` 先与 `all_challenge_ids` 求交，
以容忍指向已删题目的悬挂引用。提交端点做同样检查但只 403，不做匿名化（`:730-747`）。

### HUSTOJ

准入检查集中在 `contest-check.php`：`defunct` 关闭（`:49-51`）、`private` + `privilege` 表的
`c{cid}` 权限串或 session 密码（`:60-72`）、`in_subnet_of_contest` 的 IP 段（`:43-46`）、
未开赛拦截（`:85-96`）。管理员与 `contest_creator` 一律放行（`:77-78`）。

赛内提交路径**硬编码了 `defunct='N'`**，等于跳过题目的隐藏检查：

```php
// trunk/web/submit.php:55-70
if (isset($_POST['cid'])) {
    ...
    $sql = "select `problem_id`,'N' defunct  FROM `contest_problem` WHERE `num`=? AND contest_id=? ";
    $res = mysql_query_cache($sql,$pid,$cid);
} else {
    $id = intval($_POST['id']);
    $test_run = $id <= 0;
    $sql = "select `problem_id`,defunct FROM `problem` WHERE `problem_id`=? ";
    if (!($test_run || isset($_SESSION[$OJ_NAME . '_' . 'administrator']) || ...))
        $sql .= " and defunct='N'";
    $res = mysql_query_cache($sql,$id);
}
```

`'N' defunct` 是 SQL 常量列，不是从 `problem` 读出来的——与 Hydro / SYZOJ「比赛路径不查
hidden」同构，只是用 SQL 常量实现。

---

## E. 比赛结束之后

| 系统 | 赛后公开 |
|---|---|
| QDUOJ | 纯手工两步 |
| HydroOJ | **可自动**（唯一一家） |
| UOJ | 半自动：比赛路径自动放开，进题库仍需手工 |
| SYZOJ | 纯手工，且与比赛完全无关 |
| CTFd | 管理员改 `state`，或 `scheduled_at` 到点 |
| HUSTOJ | 无需动作——它从来没被隐藏 |

### QDUOJ：第二次复制

```python
# problem/views/admin.py:440-468
class MakeContestProblemPublicAPIView(APIView):
    @validate_serializer(ContestProblemMakePublicSerializer)
    @problem_permission_required
    def post(self, request):
        data = request.data
        display_id = data.get("display_id")
        if Problem.objects.filter(_id=display_id, contest_id__isnull=True).exists():
            return self.error("Duplicate display ID")
        ...
        if not problem.contest or problem.is_public:
            return self.error("Already be a public problem")
        problem.is_public = True
        problem.save()
        # https://docs.djangoproject.com/en/1.11/topics/db/queries/#copying-model-instances
        tags = problem.tags.all()
        problem.pk = None
        problem.contest = None
        problem._id = display_id
        problem.visible = False
        problem.submission_number = problem.accepted_number = 0
        problem.statistic_info = {}
        problem.save()
        problem.tags.set(tags)
        return self.success()
```

`problem.is_public = True; problem.save()` 先落在原赛题行上（这就是 `is_public` 的真实用途：
防止同一道赛题被公开两次，见 `:454`），然后 `pk = None` 复制出公开行，且新行
`visible = False`——公开出来的题默认仍不可见，需要管理员再手动打开。加上必须手工指定新的
`display_id`（`ContestProblemMakePublicSerializer` 只有 `id` 和 `display_id` 两个字段，
`problem/serializers.py:139-141`），一共两步人工操作。

全仓库没有任何定时任务或 `end_time` 触发器会改动题目可见性。

### HydroOJ：`autoHide` + 调度任务

```ts
// packages/hydrooj/src/handler/contest.ts:428-469（postUpdate 节选）
        if (autoHide) this.checkPerm(PERM.PERM_EDIT_PROBLEM);
        ...
        const task = {
            type: 'schedule', subType: 'contest', domainId, tid,
        };
        await ScheduleModel.deleteMany(task);
        const operation = [];
        if (Date.now() <= endAt.getTime() && autoHide) {
            await Promise.all(pids.map((pid) => problem.edit(domainId, pid, { hidden: true })));
            operation.push('unhide');
        }
        if (operation.length) {
            await ScheduleModel.add({
                ...task,
                operation,
                executeAfter: endAt,
            });
        }
```

```ts
// packages/hydrooj/src/handler/contest.ts:949-961
    ctx.worker.addHandler('contest', async (doc) => {
        const tdoc = await contest.get(doc.domainId, doc.tid);
        if (!tdoc) return;
        const tasks = [];
        for (const op of doc.operation) {
            if (op === 'unhide') {
                for (const pid of tdoc.pids) {
                    tasks.push(problem.edit(doc.domainId, pid, { hidden: false }));
                }
            }
        }
        await Promise.all(tasks);
    });
```

`autoHide` 需要 `PERM_EDIT_PROBLEM`（`:429`），因为它在改全局题目对象——这正是「多场比赛共享
同一道题」的代价：`autoHide` 是全局副作用，两场比赛引用同一题时会互相干扰，`unhide` 无条件把
所有 `pids` 设为 `hidden: false`，没有加锁或引用计数。这是该设计的已知张力，源码未解决。

### UOJ

`cur_progress >= CONTEST_PENDING_FINAL_TEST`（时间过 `end_time`）后**比赛路径**自动对所有人
开放，即使 `problems.is_hidden = 1`。但 `/problem/{id}`（全局路径）仍被 `is_hidden` 挡住
（`problem.php:39-42`），题目也不出现在题库列表（`problem_set.php:24`）。

要真正进入题库是手工翻 `is_hidden`，且会连带改写历史提交与 hack 的可见性：

```php
// web/app/controllers/problem_statement_manage.php:40-43
		if ($data['is_hidden'] != $problem['is_hidden'] ) {
			DB::update("update problems set is_hidden = {$data['is_hidden']} where id = {$problem['id']}");
			DB::update("update submissions set is_hidden = {$data['is_hidden']} where problem_id = {$problem['id']}");
			DB::update("update hacks set is_hidden = {$data['is_hidden']} where problem_id = {$problem['id']}");
		}
```

### SYZOJ

```js
// modules/problem.js:570-601
async function setPublic(req, res, is_public) {
  try {
    let id = parseInt(req.params.id);
    let problem = await Problem.findById(id);
    if (!problem) throw new ErrorMessage('无此题目。');

    let allowedManage = await problem.isAllowedManageBy(res.locals.user);
    if (!allowedManage) throw new ErrorMessage('您没有权限进行此操作。');

    problem.is_public = is_public;
    problem.publicizer_id = res.locals.user.id;
    problem.publicize_time = new Date();
    await problem.save();

    JudgeState.query('UPDATE `judge_state` SET `is_public` = ' + is_public + ' WHERE `problem_id` = ' + id);
    ...
}
```

`/problem/:id/public` 与比赛毫无关联，没有任何代码在 `end_time` 之后自动调用它。
`JudgeState.is_public` 是从题目反规范化下来的冗余列（提交时从题目拷贝：`modules/problem.js:644, 665`），
仅用于提交列表的索引过滤（`models/judge_state.ts:32-35` 的复合索引都以 `type, is_public` 打头）。

### HUSTOJ

加进比赛时反而主动取消隐藏：

```php
// trunk/web/admin/contest_add.php:74-88
    for($i=0; $i<count($pieces); $i++){
      ...
    }
    //echo $sql_1;
    $sql = "UPDATE `problem` SET defunct='N' WHERE `problem_id` IN ($plist)";
    pdo_query($sql) ;
```

`contest_edit.php:105` 有同样一行。所以 `defunct` 与「赛前隐藏」在 HUSTOJ 里是解耦的——
遮蔽完全由 F 节的动态子查询负责，`end_time` 一过子查询自动失效，题目回到题库。

---

## F. 「只能通过这场比赛访问」

| 系统 | 如何表达 |
|---|---|
| QDUOJ | **结构性独占**。赛题行 `contest_id IS NOT NULL`，公开题库每条查询写死 `contest_id__isnull=True`（`problem/views/oj.py:53-54, 65`）。赛题在题库里根本不存在，无需额外标志位。代价是 N 场比赛 N 份互不关联的副本 |
| HydroOJ | 无显式建模。最接近的是「`hidden: true` + 加入比赛」：`/p/xxx` 走 `canViewBy` 被拒，`/p/xxx?tid=` 走 `tid` 分支不查 `hidden`。独占性是两条独立规则的交集 |
| UOJ | 部分表达。`is_hidden = 1` 的题全局路径不可达，比赛路径按 `isContestProblemVisibleToUser` 三段式可达。独占是**可撤销且渐进的**（赛后自动对所有人开放比赛路径） |
| SYZOJ | 同 UOJ，且更严格——赛内 URL 用序号而非真实 `problem_id`，赛前连题号都不泄露 |
| CTFd | module + audience，六者中唯一基于**成员集合**而非时间 / 副本的可见性建模；另有 `scheduled_at` 纯时间延迟发布，二者在 `can_access_challenge` 里是与关系 |
| HUSTOJ | **唯一显式建模的**，见下 |

HUSTOJ 的赛前 / 赛中隐藏靠一条动态子查询，从连接表和比赛时间窗口现场推导，不存任何标志位：

```php
// trunk/web/problem.php:40-49
	}else{
        $sql = "SELECT * FROM `problem` WHERE `problem_id`=? AND `defunct`='N' AND NOT EXISTS (
            SELECT 1 FROM `contest_problem` cp
            INNER JOIN `contest` c ON cp.contest_id=c.contest_id
            WHERE cp.problem_id=? AND (c.end_time>'$now' AND c.defunct='N' OR c.private='1')
        )";        //////////  people should not see the problem used in contest before they end by modifying url in browser address bar
    /////////   if you give students opportunities to test their result out side the contest ,they can bypass the penalty time of 20 mins for
    /////////   each non-AC sumbission in contest. if you give them opportunities to view problems before exam ,they will ask classmates to write
    /////////   code for them in advance, if you want to share private contest problem to practice you should modify the contest into public
		$result = pdo_query($sql, $id, $id);
	}
```

源码注释把设计意图写得很直白：不这样做，学生会改地址栏绕过比赛的 20 分钟罚时、或提前看题找人代写。
遮蔽条件是 `c.end_time > $now`——即「存在任一引用比赛尚未结束」，而不是「任一比赛尚未开始」。

题库列表用同一逻辑（`trunk/web/problemset.php:120-133`），由全局开关 `$OJ_FREE_PRACTICE` 控制
是否放弃这套遮蔽。**两个查询的条件并不完全一致**：`problem.php:44` 含 `OR c.private='1'`
（私有赛的题永久遮蔽），`problemset.php:130` 的当前有效行不含——那一支被注释掉了（`:131`）。
也就是说，私有赛的题会出现在题库列表里但点不进去。

同类逻辑也用在源码浏览上——已结束比赛的提交，如果该题正被另一场进行中的比赛使用，代码不给看：

```php
// trunk/web/submitpage.php:96-108
    $sql = "select contest_id from contest where contest_id in (select contest_id from contest_problem where problem_id=?) 
									and start_time < '$now' and end_time > '$now' ";
    if ($need_check_using) {
        $result = pdo_query($sql, $sproblem_id);
        if (count($result) > 0 && !isset($_SESSION[$OJ_NAME . '_' . 'source_browser'])) {
            $view_errors = "<center>";
            $view_errors .= "<h3>$MSG_CONTEST_ID : " . $result[0][0] . "</h3>";
            $view_errors .= "<p> $MSG_SOURCE_NOT_ALLOWED_FOR_EXAM </p>";
```

多赛复用确实制造了跨赛耦合，HUSTOJ 选择在读侧（可见性）而非写侧（计分）处理它。

---

## G. 横向对比

| 系统 | 题目归属 | 复用到多赛 | 提交归属字段 | 赛前隐藏机制 | 赛后公开机制 |
|---|---|---|---|---|---|
| **QDUOJ** | 副本。同表 `problem`，`contest` nullable FK；加题即 `pk=None` 复制新行 | 否 | `Submission.contest` nullable FK，与 `problem.contest` 恒等 | `check_contest_permission` 在未开赛且 `check_type != "details"` 时拒绝；赛题行本就不在题库查询范围内 | 纯手工两步：复制出公开行（新 `_id`），该行 `visible=False` 需再手动开启 |
| **HydroOJ** | 全局。`Tdoc.pids: number[]` | **是，一等公民** | `RecordDoc.contest: ObjectId` 单值 | ①阶段逻辑：`tid` 分支不查 `pdoc.hidden`；②`autoHide` 把 `pids` 设 `hidden: true` | **可自动**：`executeAfter: endAt` 的 `unhide` 调度任务 |
| **UOJ** | 全局 + 连接表 `contests_problems`，复合主键仅两列 | 是 | `submissions.contest_id` nullable | `isContestProblemVisibleToUser`：赛前 false，赛中仅报名者 | 半自动：过 `end_time` 后比赛路径自动开放；进题库仍需手工翻 `is_hidden` |
| **SYZOJ** | 全局 + 管道分隔字符串 `"1\|5\|12"` | 是，但无索引支持、无反向查询 | `judge_state.type` + `type_info` | 赛前访问比赛路径：题若公开则 302 跳全局路径，否则报「比赛尚未开始」 | 纯手工，且与比赛无关 |
| **CTFd** | 单事件，无 contest 表；`Challenges.module_id` 单值 nullable FK | 不适用 | 无 contest 列；`Solves` 带 `UniqueConstraint("challenge_id","user_id")` | `state` ∈ visible/hidden/locked + `scheduled_at` + module/audience + `requirements.prerequisites` | 管理员改 `state`，或 `scheduled_at` 到点 |
| **HUSTOJ** | 全局 + 连接表，带赛内题号与 per-(赛,题) 计数器，无 PK/UNIQUE | 是 | `solution.contest_id`（0 = 非赛）+ 冗余 `num` | 动态子查询 `NOT EXISTS (... c.end_time > now ...)`，可被 `$OJ_FREE_PRACTICE` 关闭 | 无需动作——加进比赛时反而 `SET defunct='N'`，`end_time` 一过子查询自动失效 |

---

## H. 未能证实的条目（unverified）

- QDUOJ 前端 `OnlineJudgeFE`（独立仓库）是否另有可见性行为。
- SYZOJ `judge_state.type` 除 0 / 1 外是否有其他约定取值。源码注释只定义了这两个，代码中也只
  出现这两个，但类型是 `integer` 而非枚举。
- CTFd `Challenges.state` 是否有插件写入三种之外的第四种取值。该列是裸 `String(80)`，
  无 DB 约束也无 schema 校验，核心代码只消费 `visible` / `hidden` / `locked`。

---

## 对三个问题的直接回答

### 1. 赛题与比赛一起发布时，题目自身如何声明可见性？

**没有一个系统让「赛题」在题目对象上声明可见性。** 六者一致地把「赛前不可见」放在题目之外，
只是位置不同，可归为三类：

**(a) 结构性排除（QDUOJ）** — 赛题是 `contest_id IS NOT NULL` 的独立行，公开题库的每条查询都
写死 `contest_id__isnull=True`。`Problem.visible` 确实存在，但它是赛题行自己在赛内的开关，
不是「对外是否公开」。真正声明对外可见性的是 `contest` 这个外键为不为空。

**(b) 路径分岔（Hydro / UOJ / SYZOJ / HUSTOJ 的提交路径）** — 题目对象上都有一个全局隐藏位
（`pdoc.hidden` / `problems.is_hidden` / `problem.is_public` / `problem.defunct`），但比赛路径
不查它：Hydro 的 `if (tid) {...} else if (!problem.canViewBy(...))`；UOJ 的
`isContestProblemVisibleToUser` 在 `isProblemVisibleToUser` 失败后改用「比赛进度 + 报名状态」；
SYZOJ 带 `contest_id` 的提交路径不调 `isAllowedUseBy`；HUSTOJ 的 `'N' defunct` SQL 常量列。
所以「赛题可见性」= 比赛阶段函数 × 成员判定，题目自身的隐藏位只管全局入口。

**(c) 动态推导（HUSTOJ 的读路径）** — 题目上完全没有「我属于某场未结束的比赛」这个状态，
每次查询现场 JOIN 出来。好处是永远不会状态漂移，坏处是每次读题多一次 JOIN，且逻辑散落在多个
SQL 里（题库列表与题目页的条件已经不一致）。

CTFd 是例外：因为单事件，它不需要「赛前」概念，直接用 `Challenges.state` 这个题目自身的字段
加全局 `start` / `end` config 就够了。这恰好反证了前五家的复杂度来源——**一旦有多场比赛，
「可见性」就不可能是题目的单值属性**，因为答案依赖于「谁在问、从哪条路径问、现在几点」。

### 2. 新比赛引用已有题目，是否一等公民？

分成三档。

**一等公民（Hydro）。** 唯一把引用建成双向可查关系的系统：`Tdoc.pids` 正向、`getRelated()`
反向，并在这之上建了真功能——题目详情页列出「本题用于哪些比赛」，删题时报
`ProblemAlreadyUsedByContestError`。这是「引用是一等概念」的可操作定义：系统知道引用存在，
并据此约束行为。代价是 `autoHide` 直接改全局 `pdoc.hidden` 且没有引用计数，两场比赛引用同一题
时会互踩。

**支持但不完整（HUSTOJ > UOJ > SYZOJ，深度递减）。** HUSTOJ 的连接表最富（`num` 可自定义赛内
顺序、`title` 可改赛内题名、per-(赛,题) 计数器），但没有主键或唯一约束；UOJ 的连接表最瘦
（只有两列），赛内题号只能靠 `problem_id` 排序推导，无法手工排序；SYZOJ 最弱，schema 允许多赛
但没有任何反向查询，也没有删题引用检查。

**不是公民（QDUOJ）。** `AddContestProblemAPI` 的名字是「add from public」，实现却是
`pk = None; save()`——每次「引用」都是一次快照复制，复制后血缘完全丢失。这有真实好处（赛题内容
在比赛开始后被冻结，改原题不会污染进行中的比赛），但代价是同一道题在 N 场比赛里有 N+1 份，
统计、标签、题面修订全部分裂。

### 3. 同一题被多场比赛引用时，提交入口是否分开？一次提交能否在多场比赛计分？

**入口分开，一次提交只能在一场计分。六个系统无一例外。**

入口分开的实现形式有三种：**URL 路径分岔**（UOJ 的 `/problem/{id}` vs
`/contest/{cid}/problem/{id}`；SYZOJ 的 `/contest/:id/problem/:pid`，且用序号而非真题号）、
**query 参数**（Hydro 的 `?tid=`；SYZOJ 提交端的 `?contest_id=`）、**POST 字段**（HUSTOJ 的
`$_POST['cid']` + 赛内号 `pid`，vs `$_POST['id']` 真题号）。QDUOJ 严格说不是「同一题的两个
入口」，而是「两道不同的题各有一个入口」，但对用户呈现相同。

不能双记分是 schema 层的硬约束，不是策略选择：

| 系统 | 字段 | 为什么不可能双记 |
|---|---|---|
| QDUOJ | `Submission.contest` FK | 单值 FK；且 `Problem.objects.get(id=..., contest_id=...)` 强制与题目行一致 |
| Hydro | `RecordDoc.contest: ObjectId` | 单值；`contest.updateStatus` 在提交路径只调一次 |
| UOJ | `submissions.contest_id` | 单列 `int unsigned DEFAULT NULL` |
| SYZOJ | `judge_state.type_info` | 单 integer；`updateRelatedInfo` 的 `else if` 只调一次 `newSubmission` |
| CTFd | 无 contest 列 | 单事件；`Solves` 的唯一约束连「同题两条 solve」都不允许 |
| HUSTOJ | `solution.contest_id` | 单列，0 表示非赛 |

深层原因是所有系统的榜单都从提交的归属字段**单向扇出**到 per-(赛, 人) 的物化结构：
QDUOJ 的 `ACMContestRank` / `OIContestRank`、Hydro 的 contest status doc journal、
SYZOJ 的 `ContestPlayer`、UOJ 的 `contests_submissions`。要支持双记分，得把这条边改成多对多，
同时解决罚时 / 首杀 / 封榜在两场之间的语义冲突（一次提交在 A 赛是首杀、在 B 赛不是？
A 赛封了 B 赛没封？）。没有任何一个系统尝试过这件事。
