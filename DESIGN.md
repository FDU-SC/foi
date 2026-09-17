# 界面设计约定

本文件记录现有题库界面的视觉约定。面向参赛者，便于浏览方向、选择题目和查看完成进度；沿用现有中文界面，不改变站点的语言配置。

## 样式来源

`app/globals.css` 是颜色、字体和主题的权威来源，通过 Tailwind 的 `@theme inline` 映射到工具类；`content/theme.css` 可覆盖颜色。本文不生成或复制颜色值。新增元素复用语义工具类，兼容浅色和深色主题。

## 字体与布局

沿用 Geist Sans 与系统字体回退；计数使用等宽数字。方向标题使用半粗体，说明与统计使用小号文字。题库沿用响应式一至三列布局、带边框的圆角面板和紧凑分区列表；单分区方向保留横向介绍与题目预览。

## 颜色、层次与形状

面板使用 `bg-surface`、`border-border`，标题区使用 `bg-surface-2/60`。文字通过 `text-fg`、`text-fg-muted`、`text-fg-subtle` 区分层次。面板沿用 `rounded-xl`，按钮沿用 `rounded-md`，进度条使用 `rounded-full`。不为进度条新增阴影或装饰图标。

## 进度与状态

方向和分区进度复用 `views/problems/catalogue.tsx` 内的 `DirectionProgress`，轨道使用 `bg-surface-3`，填充使用 `bg-primary`，高度为 `h-1.5`。计数仅显示“完成数 / 总题数”，不加“已通过”前缀；同时提供读屏可识别的名称、当前值和总数。分区统计规则遵循 `lib/problems/selection.ts`；只汇总可见分区，缺少完整进度或没有题目时隐藏进度条。跨分区的同题按各自所属比赛分别统计。

## 交互与加载

保留现有链接、排行榜入口和焦点样式。进度条是静态信息，不增加动画或客户端请求。加载态沿用 `components/ui/skeleton.tsx`，题库骨架保留进度区域。界面文案遵循 `AGENTS.md`，不展示配置或实现细节。
