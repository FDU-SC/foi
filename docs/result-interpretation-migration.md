# 结果解释与练习排行榜迁移

本次直接移除旧 interface，无兼容期。数据库仍使用原来的 JSONB 列，不需要数据迁移。

## 题目内容

将 `ProblemViews.verdicts` 替换为 `describeResult(result: unknown)`，返回
`{ label, short, tone }`。结果字段解析和未知状态的原文显示都由此函数负责。
使用示例结果格式的题目可以从 `content/_shared/verdicts` 导入
`describeResult` 与 `progress`；该文件仍导出标签字典，供自定义解释使用。

`progress(history)` 接收当前用户在当前比赛、当前题目的完整可读历史，返回
`{ state: "untouched" | "attempted" | "solved", verdict: VerdictPreset | null }`。
记录包含 id、提交记录状态、result、createdAt、judgedAt，按创建时间和 id 升序排列。
函数应处理空历史以及 pending、disrupted 记录；示例实现仅把 completed 且
`accepted === true` 算作通过，曾经通过优先，否则显示最新结果。

不配置 `describeResult` 时显示中性“已评测”。不配置 `progress` 时隐藏该题进度；
仅全部可见题目支持进度时展示题单总计和状态筛选。游客不查询个人历史。
回调通过客户端可见的题目视图注册表加载，应保持纯函数且不导入数据库代码。

结果可为任意非 null JSON，包含 false、0、字符串和数组。null 保留为没有结果。
内联判题和外部完成回报使用同一校验；无效内联结果成为评测中断，外部回报则被拒绝。

## 页面覆盖与排行榜

原 `lib/stats` 已移除。题库页面改用 `progressFor(contestSlug, viewer)`，
由它限定本人、比赛、可见题目及读取权限。派生部署的页面覆盖应一起迁移，
不要再自行组合提交列表和状态计算；历史不再截断到 5000 条。

在 `content/site-views.tsx` 提供可选的 `Leaderboard` 与 `HomeLeaderboard`。
平台保留登录和 `leaderboard.read` 门禁；缺少完整榜单时返回 404。
删除榜单功能的部署也应移除自己的导航入口。样例完整页和首页摘要共享
`content/chrome/leaderboard-data.ts`，数据库查询只在服务端运行。

示例练习榜规则：

- 仅题库中的比赛，且比赛和题目当前匿名可读；封榜期间整场暂时退出。
- 只计 active 账号的 completed 提交，创建时间在开赛后且不晚于当前时间，包含赛后练习。
- 同题跨比赛只算一道。按解题数降序、达成时间升序、uid 升序排序。
  每题取最早通过提交时间，达成时间是这些时间的最大值；零解题者按 uid 排序。
- 提交次数包含已完成的失败答案；至少一次符合条件的已完成提交才上榜。
- 首杀按通过提交的创建时间确定，同时间按提交 id 升序决定。首杀和提交次数不参与排序。
- 封禁、重判、题目退役、题库收录与可见性变化会重新决定成绩和首杀，解封后重新参与。
- 示例通过判定仅识别 JSON 布尔值 `accepted: true`，不接受字符串 `"true"`。
  使用不同结果格式的部署应替换内容解释及榜单查询。

榜单在数据库内筛选和聚合，首页取前五名，完整页取前五十名，不新增跨请求缓存。
比赛排行榜的赛制、计分窗口与权限封榜机制保持原样。

## 测试

结果格式与排名语义的断言放在 content 的 deployment 测试中。内核测试使用独立
fixture 验证不透明传递、授权和内容调用，不依赖示例部署的 accepted/status 字段。
