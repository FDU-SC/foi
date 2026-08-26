# 这套 content

平台在上一层。这里是**一份**部署：一批题、三种赛制、四个题目后端、一场演示赛，
外加注册规则、邮件文案和题面词汇。它同时是写自己那一套时的参考实现，所以它是完
整的而不是最小的——完整是为了把平台的每一种能力都摆出来一次。

这些都是示例，不是平台的一部分。判据在仓库根 README 的「[换掉
content](../README.md#换掉-content)」：CI 每个 PR 把这个目录整个删掉再跑一遍类型
检查、lint、构建与冒烟，另有一条用例断言内核源码里不出现这里的任何一个名字。所
以下面写到的任何东西——包括 `traditional` 这个后端名、`demo-acm` 这场比赛、「省
选」这个难度——内核都不认识。

八份 `content-*-modules.ts` 不在这里，在仓库根上。它们是内核声明 server/client
边界的地方，扫的是 `./content/...`，换 content 不换它们。

## 目录

| 路径 | 是什么 |
| --- | --- |
| `problems/<slug>/` | 一道题：`problem.ts` 配置、`statement.mdx` 题面、`views.tsx` 渲染 |
| `problems/_shared/judge/` | 内联判题的实现，多道题共用 |
| `problems/_shared/views/` | 提交内容与评测详情的共用渲染 |
| `contests/demo-acm/` | 演示赛：时间、题单、参赛范围 |
| `rulesets/*.tsx` | 共享赛制模板 |
| `backends.ts` | 题目后端名册 |
| `components/` | 题面词汇、提交面板、题目徽章 |
| `enrollment/example.ts` | 注册策略、用户组能力、按邮箱分流 |
| `emails/` | 验证码与重置密码的文案 |
| `verdicts.ts` | 评测结论的名字与配色 |
| `mock-runner.ts` | 参考评测机 |
| `seed.ts` / `demo-data.sql` | 开发账号与演示赛的种子提交 |
| `env.example` | 这套 content 需要的环境变量 |
| `leak-markers.json` | 只该留在服务端的字符串，给构建期的兜底扫描 |

## 最少需要什么

上面这些几乎全是可选的。严格说一样都不需要——`content/` 整个不存在，平台照样起得
来，八个注册表都把「空」当作合法部署，只是没有东西可做。要让它有用，最少是一道
题：一份 `problems/<slug>/problem.ts` 加一份 `statement.mdx`；题目挂在外部后端上
的话，再加 `backends.ts` 里的一条名册。

其余每一样缺了都有回落，不会拦住启动：

| 缺什么 | 会怎样 |
| --- | --- |
| `contests/` | 题目就是散题，没有榜 |
| `rulesets/` | 同上，赛制是比赛才用得到的 |
| `problems/<slug>/views.tsx` | 提交内容与评测详情回落成格式化 JSON |
| `components/index.tsx` | 题面只能用 `mdx-components.tsx` 给的那些元素 |
| `verdicts.ts` | 评测结论显示原字符串，颜色按分数推 |
| `enrollment/` | 注册不分流、不限域名，没有人能进 `/admin` |
| `emails/` | 验证码与重置密码用内置纯文本 |

启动时每一样缺失都会打一条点名的警告，而不是静悄悄降级。

内核的**测试**要求的比这多：[`test/content-shapes.ts`](../test/content-shapes.ts)
列了几种形状——一道 retired 的题、一道内联判题的题、一场按 group 限制参赛的比赛，
等等。那是跑 `pnpm test` 的前提，不是跑平台的前提，而且清单只收「用例要一个样本、
否则就得点名一个 slug」的那几样。

## 题目

十一道，五道不经过任何后端。

| slug | 判在哪 | 说明 |
| --- | --- | --- |
| `answer-only` | 内联 | 提交答案，逐场景比对 |
| `warmup-2025` | 内联 | 同上，已 `retired`——还能读，不能交 |
| `game-of-life` | 内联 | 提交答案，生命游戏 |
| `life-oscillator` | 内联 | 提交答案，带 special judge |
| `roulette-daily` | 内联 | 签到题，结果由 `HMAC(AUTH_SECRET, handle｜日期)` 派生 |
| `maze-runner` | `traditional` | 传统判题，三档子任务 |
| `hanoi-kth` | `traditional` | 传统判题 |
| `dominator-tree` | `traditional` | 传统判题 |
| `interactive-binary-search` | `interactive` | 交互题 |
| `perf-optimize` | `performance` | 计时题，队列串行 |
| `leaky-bucket` | `leaky-bucket` | 发靶机，唯一声明了 `actions` 的题 |

内联那五道在提交的那一次请求里同步判完，所以不启 mock 也能验证它们的完整闭环。

`_shared/judge/` 里的三个内联判题（`output-only`、`life-oscillator`、
`roulette`）曾经是三台独立后端。判它们不需要内核尚未握有的任何东西——提交、题目
自己的 config、谁提交的、内核自己的密钥——于是三个地址、三把密钥和三套部署一起
没了。

题目的标签与难度写在 `problem.ts` 的 `ui` 里，不是内核字段；画成徽章的是
`components/problem-badges.tsx`，经 `Presentation.ProblemBadges` 登记。

## 赛制

- `acm.tsx` — ICPC 罚时，支持封榜
- `oi.tsx` — 每题取最高分或最后一次，按总分排名
- `ctf-dynamic.tsx` — 分值随解出人数衰减，前三血加成

后两个不写 `supportsFreeze`，也就是不封榜；各自的理由写在文件里。

## 题目后端

`backends.ts` 声明四个。名册在这里，密钥与地址的变量名由 id 拼出来——
`leaky-bucket` → `FOI_BACKEND_LEAKY_BUCKET_SECRET`。给人看的注解在 `env.example`。

**只有 `leaky-bucket` 需要地址。** 评测是评测机自己来平台领活的，平台不连它；
拉不了的只有 `spawn`/`poll`/`destroy` 那种选手点一下、平台同步发起的请求。生产
环境下「有题目声明了 actions、它却没有地址」会拒绝启动。

`mock-runner.ts` 一个进程服务这四条队列，队列名从 `backends.ts` 读。它返回随机
评测结果，用来验证「提交 → 领活 → 取详情 → 心跳 → 上报」这条闭环。它**没有沙
箱**，会在宿主机上直接编译并运行提交的代码，因此 `NODE_ENV=production` 时拒绝
启动。

```
pnpm backend:mock
```

## 账号与比赛

`seed.ts` 建四个开发账号：`admin` / `alice` / `bob` / `carol`，统一密码
`foi-dev-2026`（`FOI_SEED_PASSWORD` 可覆盖）。邮箱形状是对着
`enrollment/example.ts` 的分流规则选的——所有人带 `demo` 标签，其中三个的本地部
分是学号形状，于是带上入学年份的标签。`contests/demo-acm/` 按标签划参赛范围，这
才使得一份新 clone 打开排行榜是有人的。

```
pnpm db:seed                                  # 建号
psql "$DATABASE_URL" -f content/demo-data.sql # 给演示赛填一批判完的提交
```

`demo-data.sql` 要在应用至少跑过一次之后再执行：比赛与题目是通过启动时的同步进
镜像表的，不由这个脚本插入。

内核自己的建号方式是 `scripts/create-account.cjs`，它只问用户名和密码，不认识任
何分流规则。
