# FOI - Everything is code.

一个 一切皆代码 的竞赛平台。题目、比赛、计分规则、报名策略、邮件模板等都是仓库里的 TypeScript 文件；平台不对其做理解。

演示站点：https://foi-nightly.fdusc.moe （用首页公示的演示账号登录，数据每晚重置）

## Why FOI?

现有的竞赛平台往往让平台本身去理解"什么是一次提交"、"怎么算分"、"什么叫通过"。于是，接一道非常规的题就要大改系统。
FOI 反过来：这些语义一概不进平台。

我们具体到代码。下面这些字段在平台看来都是不透明的 JSON。存进去、取出来、交给内容层渲染，中间不做任何解释：

- `payload` — 选手提交了什么。代码、flag、一段文本、一个文件地址，随内容层定义
- `result` — 判定结果。得分、是否通过、耗时，取决于计分规则要读什么
- `detail` — 提交详情页要展示的东西。测试点表格、编译错误、任何形状
- `problem.ui` — 题目的展示信息。难度、标签，平台只负责传给组件

平台提供的是机制：账号与权限、提交队列与评测机协议、排行榜计算与封榜、邮件投递...
意义全部来自 `content/`。

## 目录

```
app/         Next.js 路由。消费 lib/ 与 components/，从不 import content/
components/  平台 UI 原语与插槽组件，同样不 import content/
lib/         平台核心：类型契约、注册表、机制
content/     赛事内容。题目、比赛、计分规则、报名、邮件、站点配置
```

平台通过九个入口发现内容：`content/_modules/` 下的七个注册表，加上 `content/site.ts`
与 `content/backends.ts`。这是两层之间唯一的接口。

## 本地运行

推荐 Node 22、pnpm 11 和 PostgreSQL 17。

```bash
pnpm install
cp .env.example .env.local        # 至少改掉 AUTH_SECRET 与 FOI_BACKEND_SECRET
docker compose up -d postgres     # 或者自备一个 PostgreSQL
pnpm db:migrate
pnpm db:seed                      # 建几个开发账号，密码见 scripts/seed.ts
pnpm dev
```

打开 http://localhost:3000 。示例内容里有十来道题，其中五道是内联判题，装好就能提交。

剩下几道要外部评测机。我们提供了一个模拟评测机：

```bash
FOI_STUB_RUNNER=yes-fake-verdicts node scripts/stub-runner.cjs
```

## 增加自定义内容

`content/AGENTS.md` 是增加自定义内容的完整指南。TL, DR:

加一道内联判题的题目，建 `content/problems/<slug>/`，放三个文件——`problem.ts` 声明
配置与判题函数，`statement.mdx` 写题面，`views.tsx` 决定提交内容和判定详情怎么显示。
glob 会自动发现它，不需要注册。

加一个比赛，建 `content/contests/<slug>/contest.ts`。比赛持有自己的排行榜，每个排行榜
引用一套计分规则。

加一套计分规则，建 `content/rulesets/<id>.tsx`，导出一个纯函数：收进提交，吐出名次。
它不需要知道封榜，也不需要知道怎么渲染，那些是另外的事。

## 派生一份自己的部署

`content/` 里的题目、比赛与策略是**示例**。直接改它们，每次同步上游都会在同一批文件上
撞车——上游也在演进这些示例。

把自己的内容放进 `content.local/`，这个目录上游没有。`@/content/*` 会优先解析到它，
逐模块回落：

```
content.local/
  _globs.ts      必需——_modules/ 用相对路径 import 它
  _modules/      必需
  site.ts        覆盖站点配置
  policies/      覆盖授权策略
  problems/      你自己的题目
```

只放 `site.ts` 就只有站点配置被覆盖，其余照旧来自 `content/`；放全套就完全接管。
`_shared/` 里的模板可以继续复用上游的，不必复制。

这样 `content/`、`tsconfig.json`、`vitest.config.mts` 一个字都不用改，上游合并不再冲突。

填了插槽之后，`deployment` 测试仍然跑 `content/**`——回落过来的赛制、判题与邮件
模版还在生效，它们旁边的测试也还算数。只有 `content/deployment.test.ts` 例外：它按
名字钉死上游示例（哪场比赛、多少罚时、哪个演示账号），插槽一填这些话就没了指向，
于是它让位，由你在 `content.local/` 里写自己那份，可以照它的样子写。

自己新增的题目也放 `content.local/problems/` 下——放进 `content/` 虽然也能跑，但那
是上游的目录，下次同步就多一处要解的地方。

## 评测机

需要真实评测的题目由独立部署的评测机服务，实现不在这个仓库里。

评测机是**主动来领活**的：平台不需要知道它们在哪，两边持有同一把密钥即可。协议在
`lib/backend/` 定义，一共三个端点——领取任务、取任务详情、上报结果，都用 HMAC 签名。
`scripts/stub-runner.cjs` 是一份最小实现，三百行，可以照着写。

例外是需要平台主动发起的交互动作（比如为选手拉起一台靶机），那种后端要额外配一个地址。

## 部署

镜像里是一个 Next.js standalone 产物，配一个 PostgreSQL 就能跑：

```bash
cp docker-compose.example.yml docker-compose.yml
cp .env.example .env              # 改掉 AUTH_SECRET 与 FOI_BACKEND_SECRET
docker compose up -d              # 想连模拟评测机一起，加 --profile demo
```

数据库迁移在应用启动时自动执行，可以用 `FOI_AUTO_MIGRATE=false` 关掉。

生产环境有一组启动检查，配置不完整会拒绝启动而不是带病运行——比如 `AUTH_SECRET`
还是示例文件里的占位值、几个评测队列共用同一把密钥。
