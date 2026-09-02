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
app/         Next.js 的契约面：路由薄壳、Server Action、API handler
views/       页面主体。路由渲染的一切都在这里
components/  平台 UI 原语与插槽组件
lib/         平台核心：类型契约、注册表、机制
content/     赛事内容。题目、比赛、计分规则、报名、邮件、站点配置
```

平台通过十二个入口发现内容：`content/_modules/` 下的七个注册表，加上 `content/` 里的
`site.ts`、`site-views.tsx`、`backends.ts`、`schema.ts` 与 `theme.css`。这是两层之间唯一的接口。

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

题目只能作为比赛的所属物被打开，所以新题还要写进某场比赛的 `problems`——不属于任何
比赛的题目没有 URL，启动检查会点名它。谁能打开、什么时候能打开、比赛结束之后还剩
什么，全部由那场比赛说了算。

加一个比赛，建 `content/contests/<slug>/contest.ts`。比赛持有自己的排行榜，每个排行榜
引用一套计分规则。想让一批题长期开放，就让这场比赛的窗口足够长。

题库是一组这样的比赛：`content/site.ts` 的 `catalogue` 指名哪几场，它们就答在
`/problems` 下——比赛在 `/problems/<比赛>`，题目在 `/problems/<比赛>/<题目>`，排行榜在
`/problems/<比赛>/standings`，并且不再出现在 `/contests` 列表里。除了地址，它们和别的
比赛没有任何区别，各自有窗口、受众与排行榜。`/problems` 是它们的索引页，一场比赛一张
卡片，按各自的 `domain` 分组。其余比赛照旧是 `/contests/<比赛>/problems/<题目>`，
一对「比赛 + 题目」始终只有一个 URL。`content/contests/graphs/` 是现成的例子。

难度与标签写在题目的 `ui` 里，平台不读它。让它们变成可筛的维度靠 `views.tsx` 的
`facets`，而露不露则由比赛的 `facets` 决定——不写就什么都不露，所以正式轮次默认不会
在赛中泄露标签。

加一套计分规则，建 `content/rulesets/<id>.tsx`，导出一个纯函数：收进提交，吐出名次。
它不需要知道封榜，也不需要知道怎么渲染，那些是另外的事。

## 派生一份自己的部署

`content/` 里的题目与比赛、`components/` 里的组件、`views/` 里的页面，全都是**示例**。
直接改它们，每次同步上游都会在同一批文件上撞车——上游也在演进这些文件。

三者各有一个 `.local` 孪生目录，上游没有。`tsconfig.json` 把别名优先解析到那一半，
**逐文件回落**：

```json
"@/content/*":    ["./content.local/*",    "./content/*"],
"@/components/*": ["./components.local/*", "./components/*"],
"@/views/*":      ["./views.local/*",      "./views/*"],
```

放一份同名文件就换掉那一个，其余照旧从上游取。`tsconfig.json`、`vitest.config.mts`
一个字都不用改，上游合并不再冲突。

### 按定制深度挑手段

**优先用最浅的那个**——越往下走，放弃的上游演进越多。

**一、改数据，不写代码。** 品牌、导航、首页导语、页脚文案与链接都在 `content/site.ts`；
配色在 `content/theme.css`，它在 `globals.css` 之后加载，重新声明哪个变量就覆盖哪个：

```css
/* content.local/theme.css */
:root { --primary: oklch(55% 0.2 25); }
.dark { --primary: oklch(72% 0.17 25); }
```

完整的变量表在 `app/globals.css` 开头。

**二、换掉页面的一块。** `content/site-views.tsx` 导出 `SiteViews`，五个插槽依次是
`Header`（顶栏）、`Footer`（页脚）、`Brand`（品牌标识）、`HomeHero`（首页导语区）、
`AuthShell`（认证页壳）：

```tsx
// content.local/site-views.tsx
import type { SiteViews } from "@/lib/site-views";
import { Footer } from "./ui/footer";

export const views: SiteViews = { Footer };
```

每个插槽都是可选的，都有平台默认实现，所以 `{}` 就是一份完整实现。上游后续对页面
其余部分的改进照常生效——这是它比整页覆盖划算的地方。

**三、整文件替换。** `components/` 与 `views/` 下的任何文件，都能被 `.local` 孪生目录里
的同名文件整个换掉。想重做整个题目页，就写一份 `views.local/problems/detail.tsx`。
代价明码标价：**被覆盖的那个文件从此不再跟随上游演进**。

替换一个组件要把它导出的整套契约补齐——少一个 prop、少一个具名导出，`pnpm typecheck`
就会指着调用方报错。想省事就复用上游的类型：

```tsx
// components.local/ui/badge.tsx
import type { BadgeProps } from "../../components/ui/badge";

export function Badge(props: BadgeProps) { /* ... */ }
```

注意这里用的是**相对路径**。包一层上游原版时也一样——写成别名的话会解析回你自己
这个文件，成了自引用：

```tsx
// components.local/site/header.tsx
import { DefaultHeader } from "../../components/site/header";
```

`app/` 下的路由文件不在插槽里——Next 是扫文件系统发现路由的，别名管不着。所以那些
文件只留段配置和一层转发，页面主体都在 `views/`，`test/slots.test.ts` 盯着这条线。

### 新增页面与新增表

新路由不需要插槽：上游在 `app/` 下没有同名文件，加什么都不冲突。放进 `app/(local)/`
这个路由组——路由组不影响 URL，上游承诺永不往里放文件，两边就不会争同一个路径。

要加自己的表，在 `content.local/schema.ts` 里声明，`lib/db/index.ts` 会把它们并进
drizzle 实例，类型和 `db.query` 都能用。迁移走单独的目录和单独的 journal：

```bash
pnpm exec drizzle-kit generate --config drizzle.local.config.ts
```

生成到 `drizzle.local/`，`instrumentation.ts` 在 `drizzle/` 之后自动应用它。两边的版本号
永不相撞。表名要带 `drizzle.local.config.ts` 里 `tablesFilter` 约定的前缀，这样即使你
import 上游的表来挂外键，drizzle-kit 也不会试图重复创建它。

### content 接管的粒度是入口，不是文件

十二个入口分两类，行为不同。

`site.ts`、`site-views.tsx`、`backends.ts`、`schema.ts`、`theme.css` 各是一个文件：插槽里
放一份就整个替换。

其余七个是 glob 注册表，接管它们要多两个文件：

```
content.local/
  _globs.ts      必需——_modules/ 用相对路径 import 它
  _modules/      必需
  problems/      你自己的题目
```

**一旦 `content.local/_modules/<类别>.ts` 存在，那个入口就完全归你，上游同类的内容会
整个消失**——glob 只看得见自己目录下的东西。想换掉整套分流规则，这正合适；想改一道
题却接管了 `problems`，上游十几道题会一起蒸发。

要在保留上游的前提下增改，把两边的 glob 结果叠起来：

```typescript
// content.local/_modules/problems.ts
import { problemConfigModules as upstream } from "../../content/_globs";
import { problemConfigModules as local } from "../_globs";

export const problemConfigModules = { ...upstream, ...local };
```

两边的键格式相同（`./problems/<slug>/problem.ts`），所以同名即覆盖：`content.local/`
下放一份 `problem.ts` 就改写那一道，其余照旧，连 judge 与 views 都仍从上游取。带
`views.tsx` 的题目还要照同样的写法接管 `problem-views` 入口，否则上游的 glob 扫不到
它，这道题就没有渲染。

反过来，接管整个入口是**删掉**上游内容的唯一办法——覆盖只能改写同名的，删不掉。

填了插槽之后，`deployment` 测试仍然跑 `content/**`——回落过来的赛制、判题与邮件
模版还在生效，它们旁边的测试也还算数。只有 `content/deployment.test.ts` 例外：它按
名字钉死上游示例（哪场比赛、多少罚时、哪个演示账号），插槽一填这些话就没了指向，
于是它让位，由你在 `content.local/` 里写自己那份，可以照它的样子写。

你写在 `content.local/`、`components.local/`、`views.local/` 里的测试也归 `deployment`
跑——它们描述的是这套部署，用的是真实 content，而不是内核夹具。

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
