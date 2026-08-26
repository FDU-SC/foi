# 骨架 content

一份最小的 `content/`，用来证明内核不认识任何具体模版。

CI 的 `content-swap` 作业把仓库里的 `content/` 换成这个目录，然后照常跑
`pnpm typecheck`、`pnpm build` 与 `pnpm test`。全绿才说明「平台是薄内核、
赛制/题目/评测机/后端只是模版」这句话是真的——不然它只是一句注释。

这里**没有** `*-modules.ts`。那八份 glob 是内核声明 server/client 边界的地
方，住在仓库根上、扫 `./content/...`，换 content 不换它们，所以骨架也不必再
抄一份。它们曾经就在 `content/` 里，于是这个目录不得不携带八份逐字节副本，
一处边界有两个声明、可以静默漂移；`content-absent` 作业要求的「整个删掉
`content/`」在那种布局下更是根本无从谈起。

## 它为什么不是「最小」的

骨架要满足 `test/content-shapes.ts` 列出的每一个形状，因为内核测试是按形状
找素材的：

- 一道内联判题的题目（`problems/inline-echo`）
- 一道走 runner 队列、并且声明了交互动作的题目（`problems/queued-echo`）
- 一道 retired 的题目（`problems/withdrawn`）
- 一种支持封榜的赛制（`rulesets/plain`）
- 一场按 group 限制参赛、第一道题覆盖了 `rateLimit` 的比赛（`contests/example`）
- 一个带能力的用户组（`enrollment/skeleton.ts`）

少任何一样，对应的内核机制就没有活体消费者，测试会指名说出缺的是哪个形状。

反过来，有两样是**故意只做一半**的。

只有 `queued-echo` 写了 `views.tsx`，另外两道题没有。提交内容与
`verdict.detail` 的渲染是可选插槽，不填就回落成格式化 JSON——留两道题不填，这
条回落才有人走。

`components/index.tsx` 里也没有 `ProblemBadges`。题目在列表和题面标题下要不要
挂难度、标签、满分，是部署的事；骨架一个都不挂，于是「没有这个插槽」那条路径也
有人走——题目就只剩 slug 和标题。

## 它和 `content/` 的区别

这里的题目没有题解、没有测试数据、没有答案——`backend.config` 里只有够 mock
后端认出来的最小信息。文案一律直白，不追求好看。真正的 content 应该长得比这
丰富得多；骨架的价值在于它**足够贫瘠**，贫瘠到内核仍然跑得动。
