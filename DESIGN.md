# 界面设计约定

界面按印刷题册与记分板排版：墨色文字，细线分隔，颜色只表达结果。

## 样式来源

- `app/globals.css`：颜色、字体、圆角的唯一来源，经 `@theme inline` 映射为工具类
- `content/theme.css`：部署覆盖颜色 token，加载在 `globals.css` 之后
- 新元素只用语义工具类（`text-fg`、`bg-surface-2`、`border-border` 等），不写色值
- 浅色与暗色两套 token 同名，组件不写 `dark:` 颜色

## 颜色

- 墨与纸
  - `fg` / `fg-muted` / `fg-subtle`：正文、次要、弱化三级文字
  - `bg`、`surface`：纸面
  - `surface-2`：表头、样例与代码区底色
  - `surface-3`：按下、选中
  - `border`：细线与输入框边框；`border-strong`：输入框悬停，聚焦时改墨色
  - `primary`：墨色，只用于主按钮
- 结果色：只用于判题结果、比赛状态、记分格和提示
  - `ok` 通过，`err` 错误，`warn` 警告与未公开，`partial` 部分分，`info` 待定与进行中
  - `*-subtle`：对应的浅底
  - `ok-strong`：首杀
- `mark`：荧光笔，只标自己那一行（排行榜、记分板、我的排名）
- `code-*`：编辑器语法色

## 字体

- 黑体 `font-sans`（系统无衬线）：界面、标题、表格
- 宋体 `font-serif`：题面正文、列表、样例说明
  - 拉丁字形用 `KaTeX_Main`，与公式同一套字形
- 等宽 `font-mono`：代码、题号、用时与内存、计数与时间戳、结果码
- 数字一律 `tabular-nums`

## 线与形状

- 分隔用 1px 细线，不画卡片外框
- 表头下、面板标题下用墨线 `border-fg`
- 当前项：侧栏左侧 2px 墨线，tab 与导航下边 2px 墨线
- 提示框只留左侧 2px 竖线：提示类墨色，警告与错误类用结果色
- 圆角上限 2px，在 token 层封顶；`rounded-full` 只给头像和状态点
- 无投影、渐变、模糊，`shadow-*` 在 token 层清空

## 组件形态

- 状态用符号与彩色文字
  - 题表状态列：✓ / ✗，读屏读结果文字
  - 结果码：`Badge` 彩色等宽字，无底色
- 用列表与表格承载内容，日期直接写
- 记分板
  - 每题一列，题号墨色加粗
  - 自己那行的名次、选手、总分格铺 `mark`
  - ACM 格
    - 通过：`ok-subtle`，`+` / `+N` 与用时
    - 首杀：`ok-strong` 白字
    - 未过：`err-subtle`，`−N`
    - 待揭晓：`info-subtle`，`?` 与次数

## 布局

- 内容宽度 `--site-content-width`，默认 1200px
- 顶栏 48px，实底，下边细线
- 题库两栏
  - 左栏：「全部题目」与按方向分组的题单
    - 方向标题只作标签
    - 窄屏收成一行，横向滚动
  - 右栏：题单标题，其下「题目」「排行榜」tab
    - 题目：说明、筛选、题表、分页
    - 排行榜：时间范围、我的排名、搜索、榜单、分页
- 进度计数
  - 显示 `完成数/总题数`，带 progressbar 语义（名称、当前值、总数）
  - 进度不完整或没有题目时只显示总数
  - 统计规则见 `lib/problems/selection.ts`

## 动效

- 只保留颜色过渡 `transition-colors` 与按钮 `Spinner`
- 不做页面切换、入场、数字滚动、庆祝动画
- `prefers-reduced-motion` 下关闭全部过渡与动画

## 加载

- 壳内切换：外壳保持挂载，上一个面板留到下一个就绪，不淡入
  - 题库：`(catalogue)/(shell)` 保持左栏、标题与 tab
  - 比赛工作区：`(workspace)` 保持顶栏与题单侧栏
- 进入外壳或整页跳转：`loading.tsx` 骨架，随链接预取
  - 骨架放在 `views/skeletons/`，外层 `SkeletonScreen`，读屏文案形如「正在加载题库」
  - 灰块静态，不闪烁；固定标题写真实文字
  - `loading.tsx` 只包一个页面或一个外壳；有子路由的页面移入 `(index)` 路由组
- 页内分块（首页面板）：`Suspense`，fallback 用 `SkeletonScreen`
- 等待操作结果：按钮 `pending`，禁用并显示 `Spinner`，文案形如「提交中…」
- 后台进行中（评测中、自动刷新、评测机在线）：`PulseDot` 静态圆点

## 文案

遵循 `AGENTS.md` 的「Copywriting」。
