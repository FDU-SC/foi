# FOI 竞赛平台

FOI 用于搭建可定制的竞赛站点。题目、比赛、计分规则、报名策略和邮件模板由仓库中的 TypeScript 文件定义；平台负责存储与运行机制，内容层负责解释竞赛数据。

演示站点：https://foi-nightly.fdusc.moe （用首页公示的演示账号登录，数据每晚重置）

## 平台与内容层

提交格式、计分方式和通过条件由内容层定义。平台将以下字段作为不透明的 JSON 存储、读取并传给内容层渲染：

- `payload` — 选手提交了什么。代码、flag、一段文本、一个文件地址，随内容层定义
- `result` — 判定结果。得分、是否通过、耗时，取决于计分规则要读什么
- `detail` — 提交详情页要展示的东西。测试点表格、编译错误、任何形状
- `problem.ui` — 题目的展示信息。难度、标签，平台只负责传给组件

平台提供账号与权限、提交队列、评测机协议、排行榜计算、封榜和邮件投递机制。
竞赛数据的含义由 `content/` 定义。

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

完整指南见 [内容开发指南](content/AGENTS.md)。常见操作如下。

加一道内联判题的题目，建 `content/problems/<slug>/`，放三个文件：`problem.ts` 声明
配置与判题函数，`statement.mdx` 写题面，`views.tsx` 决定提交内容和判定详情怎么显示。
glob 会自动发现它，不需要注册。

题目只能通过所属比赛访问，因此新题还需加入某场比赛的 `problems`。未加入任何比赛的
题目没有 URL，启动检查会报告此问题。比赛决定题目的访问范围、开放时间和赛后访问规则。

加一个比赛，建 `content/contests/<slug>/contest.ts`。比赛持有自己的排行榜，每个排行榜
引用一套计分规则。想让一批题长期开放，就让这场比赛的窗口足够长。

`content/site.ts` 的 `catalogue` 指定作为题库分区的比赛：索引为 `/problems`，
比赛、题目和排行榜分别使用 `/problems/<比赛>`、`/problems/<比赛>/<题目>`、
`/problems/<比赛>/standings`，不再出现在 `/contests` 列表中。索引按比赛的 `domain`
分组，每场比赛一张卡片。比赛的窗口、受众与排行榜不变；其余比赛的题目仍使用
`/contests/<比赛>/problems/<题目>`。每对「比赛 + 题目」只有一个 URL，
示例见 `content/contests/graphs/`。

难度与标签写在题目的 `ui` 里，平台不读取其字段。`views.tsx` 的 `facets` 将它们提供为
筛选维度，比赛的 `facets` 决定显示哪些维度。默认不显示筛选项及对应徽章，避免赛中泄露标签。

加一套计分规则，建 `content/rulesets/<id>.tsx`，导出一个纯函数，根据提交记录计算排名。
封榜和渲染由其他模块负责。

## 派生一份自己的部署

`content/` 里的题目与比赛、`components/` 里的组件、`views/` 里的页面，均为示例。
直接修改这些文件可能在同步上游时产生合并冲突。

三者各有对应的 `.local` 目录，上游不包含这些目录。`tsconfig.json` 优先解析本地覆盖，
**逐文件回落**：

```json
"@/content/*":    ["./content.local/*",    "./content/*"],
"@/components/*": ["./components.local/*", "./components/*"],
"@/views/*":      ["./views.local/*",      "./views/*"],
```

同名文件覆盖上游文件，其余文件沿用上游版本。无需修改 `tsconfig.json` 或
`vitest.config.mts`。

### 选择定制方式

优先选择改动范围最小的方式，以保留更多上游更新。

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

插槽均可选，未覆盖的部分使用平台默认实现并继续接收上游更新；`{}` 是有效配置。

**三、整文件替换。** `components/` 与 `views/` 下的任何文件，都能被 `.local` 目录里
的同名文件整个换掉。想重做整个题目页，就写一份 `views.local/problems/detail.tsx`。
被覆盖的文件不再自动获得上游更新。

替换组件时须保留完整的导出接口。缺少 prop 或具名导出会导致 `pnpm typecheck` 在调用方
报错。可以复用上游类型：

```tsx
// components.local/ui/badge.tsx
import type { BadgeProps } from "../../components/ui/badge";

export function Badge(props: BadgeProps) { /* ... */ }
```

复用或包装上游组件必须使用相对路径。使用别名会解析回覆盖文件，造成自引用：

```tsx
// components.local/site/header.tsx
import { DefaultHeader } from "../../components/site/header";
```

Next 通过文件系统发现路由，别名不影响这一过程，因此 `app/` 路由文件不支持插槽覆盖。
路由文件只声明段配置并转发到 `views/` 中的页面主体，`test/slots.test.ts` 检查此约束。

### 新增页面与新增表

新增路由放在 `app/(local)/` 路由组，无需插槽。路由组不影响 URL，且上游不在此目录添加
文件，避免双方修改同一路径。

要加自己的表，在 `content.local/schema.ts` 里声明，`lib/db/index.ts` 会把它们并进
drizzle 实例，类型和 `db.query` 都能用。迁移走单独的目录和单独的 journal：

```bash
pnpm exec drizzle-kit generate --config drizzle.local.config.ts
```

生成到 `drizzle.local/`，`instrumentation.ts` 在 `drizzle/` 之后自动应用它。两边的版本号
永不相撞。表名要带 `drizzle.local.config.ts` 里 `tablesFilter` 约定的前缀，这样即使你
import 上游的表来挂外键，drizzle-kit 也不会试图重复创建它。

平台和部署分别使用 `drizzle.__drizzle_migrations` 与
`drizzle.__drizzle_local_migrations` 记录已执行的迁移。旧版本曾共用前一张表；升级时，
保留原有的两个迁移目录，先让应用以自动迁移开启的状态启动一次。启动流程会按迁移文件的
hash 和时间戳转移旧的部署记录，再应用尚未执行的迁移；无法区分平台和部署的相同 hash
会使启动失败，需要先核查迁移文件。

`drizzle-kit migrate --config drizzle.local.config.ts` 只使用新的部署 journal，
不会转移旧记录。已有部署完成上述启动升级前，不要直接运行此命令，以免重放已执行的迁移。
设置了 `FOI_AUTO_MIGRATE=false` 的部署也需要在这次升级时临时开启自动迁移。

### 覆盖 content 入口

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

`content.local/_modules/<类别>.ts` 会替换整个对应入口。glob 仅扫描本地内容目录，
上游该类别的内容将不再加载。此方式适合替换整类内容；若只修改一道题，需合并两边的注册表。

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

移除上游内容必须接管整个入口；单文件覆盖只能替换同名文件。

配置插槽后，`deployment` 仍运行 `content/**` 中继承的赛制、判题和邮件模板测试。
`content/deployment.test.ts` 除外：它按名称检查上游示例的比赛、罚时和演示账号，
启用 content 插槽后会被排除。请参考该文件在 `content.local/` 中编写部署校验。

你写在 `content.local/`、`components.local/`、`views.local/` 里的测试也归 `deployment`
运行，使用该部署的实际 content，不使用内核夹具。

新增题目放在 `content.local/problems/` 下。放入上游的 `content/` 目录也能运行，
但可能增加同步时的合并冲突。

## 评测机

需要真实评测的题目由独立部署的评测机服务，实现不在这个仓库里。

评测机主动领取任务，平台无需配置评测机地址，双方使用相同密钥认证。协议在
`lib/backend/` 定义，包含领取任务、获取任务详情和上报结果三个端点，均使用 HMAC 签名。
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

生产环境会检查启动配置。例如 `AUTH_SECRET` 仍为示例占位值，或多个评测队列使用同一
密钥时，应用会拒绝启动。


## 管理与排查

赛制在仓库中定义，修改后需重新部署。注册策略和用户分组规则分别在 `content/policies/`
与 `content/enrollment/` 中维护。运维组账号的权限也需在仓库中调整，不能在界面上封禁。
没有已验证邮箱的账号无法收取重置邮件，可在服务器上使用 `scripts/set-password.cjs` 设置密码。

用户组由分流规则计算，不存入数据库；权限由授权策略决定。默认拒绝，匹配的禁止规则
优先于放行规则。邮箱规则不能分配特权组，按用户编号指定的规则可以分配任何组。
比赛可通过用户组限定参赛范围。

创建初始管理员账号时：

1. 设置 `DATABASE_URL`，运行 `node scripts/create-account.cjs <username> --nick <昵称> --email <邮箱>`。
   密码从 stdin 读取；未提供时自动生成并打印一次。
2. 将返回的 uid 加入 `content/enrollment/` 的 `uids` 规则，分配一个已被
   `content/policies/` 放行 `admin.enter` 的用户组，再重新部署。

示例规则为 `{ label: "…", uids: [<返回的 uid>], groups: ["<目标用户组>"] }`。
账号创建成功不代表已授予管理权限，实际权限取决于匹配的分流规则与授权策略。
本地种子账号中，admin 按 uids 规则分组，其余三个账号按邮箱分组。

管理页提示评测任务回收未按时完成时，检查日志中的「回收失败」及进程是否阻塞在
没有超时的调用上。回收任务处理失联评测机的提交、重试耗尽与排队超时，需单独检查；
页面、提交接口和数据库正常不代表回收任务正常。

评测中断可能由评测机上报失败或失联后的回收处理触发，不计入选手成绩。若持续出现，
查看提交详情的错误原因与评测机日志，修复后重新评测。未关联题目的后端应核对是否为
备用配置；已移除题目或比赛的数据库记录用于保留历史提交归属，外键为 `RESTRICT`，应予保留。

分流规则中的用户编号需要对应已有账号。账号未分配用户组时，检查
`content/enrollment/` 中的匹配规则；这类账号无法参加限定用户组的比赛。
