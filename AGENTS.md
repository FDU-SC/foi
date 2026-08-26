<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

本环境已预装依赖（`pnpm install` 已跑过）、原生 Postgres 16、以及初始化好的数据库。以下为该环境特有、不显然的启动/运行注意事项，标准命令见 `README.md` 与 `package.json` scripts。

### 服务一览

| 服务 | 端口 | 启动命令 | 说明 |
| --- | --- | --- | --- |
| Postgres 16 | 5433 | `sudo pg_ctlcluster 16 main start` | 见下方 caveat；开机不会自动启动 |
| Next.js dev（Turbopack） | 3000 | `pnpm dev` | 主应用 |
| mock 题目后端 | 4100 | `pnpm backend:mock` | 提交→评测闭环所需；实现在 `content/mock-runner.ts` |

### 非显然的注意事项

- **Postgres 用的是原生 apt cluster，不是 `docker compose`**。README 里写的是 `docker compose up`，但本环境未装 Docker；改用系统 cluster，端口已配置为 `5433` 以匹配 `DATABASE_URL`。cluster 开机不会自启，每次会话先跑 `sudo pg_ctlcluster 16 main start`（已启动时会提示 already running，可忽略）。`foi` 角色与数据库随快照保留。
- **快照里那个 `foi` 库要先删掉重建一次**，这一条只需要做一次，做完之后照旧。初始迁移被重建过——`judge_id` 正名为 `backend_id`，原先的两份迁移压成一份 `0000_init`——而快照库的 `drizzle.__drizzle_migrations` 记的还是旧的两条哈希。drizzle 于是认为 `0000_init` 从未应用，对着已经存在的表跑 `CREATE TABLE` 并失败：`pnpm db:migrate` 直接退 1，`pnpm dev` 也起不来，因为 `instrumentation.ts` 明确选择迁移失败就中止启动而不是拿旧 schema 硬扛。

  ```
  sudo -u postgres psql -p 5433 -c 'drop database foi with (force)' -c 'create database foi owner foi'
  pnpm db:migrate && pnpm db:seed
  ```

  `pnpm db:seed` 是这一步的一部分而不是可选项：种子数据在库里，不在快照的别处。
- **`.env.local` 已生成且被 gitignore**，内含 `AUTH_SECRET`、`FOI_BACKEND_SECRET` 等。快照会保留它，无需重新创建。
- **必须用 Turbopack**（`next dev` 在 Next 16 默认即是），不要切回 webpack：仓库根上八份 `content-*-modules.ts` 全部依赖 `import.meta.glob`，题目、题目渲染、比赛、赛制、报名、邮件、题目后端、题面组件的注册表都从那里来。它们扫的是 `./content/...`，**这八份文件挪不了位置**：`import.meta.glob` 只向下扫，`../`、`@/` 与开头的 `/` 都返回 `{}` 且不报错不告警（在 Next 16.3.1 上用 `pnpm build` 探针实测过；Vite 允许 `../`，所以 `vitest` 通过不算数）。住在根上而不是 `content/` 里，还为了让 `rm -rf content` 之后平台仍然构建得起来，见 CI 的 `content-absent` 作业。
- **数据库迁移会在 dev server 启动时由 `instrumentation.ts` 自动应用**，也可手动 `pnpm db:migrate`。
- **种子账号**：`admin` / `alice` / `bob` / `carol`，统一密码 `foi-dev-2026`（可用 `FOI_SEED_PASSWORD` 覆盖）。
- **mock 题目后端本身就是一个 runner**，返回随机评测结果，用于验证「提交→领活→取详情→心跳→上报」这条闭环。它现在是 `content/mock-runner.ts`（不再在 `scripts/` 下：它认识 `config.mode`、`config.image`，那是这批题目的知识），一个进程服务 `content/backends.ts` 声明的全部队列，靠 `FOI_BACKEND_SECRET` 认证，**不需要配任何 `FOI_BACKEND_<NAME>_URL`**——评测这条路上内核不连后端，是 runner 连 `FOI_PUBLIC_URL`。地址只有 `leaky-bucket` 的 `spawn`/`poll`/`destroy` 才用得到。非生产环境下没配地址的条目回落到 `FOI_DEV_BACKEND_URL`（`.env.example` 里给的是 `:4100`）；**这个回落从前写死在 `lib/backend/env.ts` 里，现在不设就是没有回落**。**别照抄旧说法说「生产缺任何一个后端 URL 会 `assertEnv` 拒绝启动」**：`assertEnv` 早就不看后端地址了，现在拒绝启动的是 `lib/backend/boot.ts` 的 `assertBackendActionUrls()`（连同 `assertBackendSecrets()`，两条都由 `instrumentation.ts` 调用），而且只针对「有题目在它上面声明了 `actions`、它却没有地址」的后端。按后端拼名的两个旧变量 `FOI_JUDGE_<NAME>_URL` 与 `FOI_JUDGE_<NAME>_SECRET` 确实删干净了，**但共享的那一把 `FOI_JUDGE_SECRET` 仍然是活的回落**，`lib/backend/env.ts` 的 `sharedSecret()` 与 `lib/env.ts` 的 `withLegacyNames` 各读一次，改动其中一处必须同时改另一处。`flag-checker`、`output-only`、`roulette` 三台后端退役成了内联判题，见 README「判在哪里」。
- **有五道题不经过任何后端**（`answer-only`、`game-of-life`、`warmup-2025`、`life-oscillator`、`roulette-daily`）。它们在提交那一次请求里同步判完，所以不启 mock 也能验证这几道题的完整闭环。`roulette-daily` 的结果由 `HMAC(AUTH_SECRET, handle|日期)` 派生，换一把 `AUTH_SECRET` 就换一套结果。
- Postgres 用户密码认证：连接串已用 `foi_dev_password`，通过 TCP `localhost:5433` 连接。
