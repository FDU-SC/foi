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
| mock 题目后端 | 4100 | `pnpm backend:mock` | 提交→评测闭环所需 |

### 非显然的注意事项

- **Postgres 用的是原生 apt cluster，不是 `docker compose`**。README 里写的是 `docker compose up`，但本环境未装 Docker；改用系统 cluster，端口已配置为 `5433` 以匹配 `DATABASE_URL`。cluster 开机不会自启，每次会话先跑 `sudo pg_ctlcluster 16 main start`（已启动时会提示 already running，可忽略）。`foi` 角色/数据库、迁移和种子数据都随快照保留。
- **`.env.local` 已生成且被 gitignore**，内含 `AUTH_SECRET`、`FOI_BACKEND_SECRET` 等。快照会保留它，无需重新创建。
- **必须用 Turbopack**（`next dev` 在 Next 16 默认即是），不要切回 webpack：题目注册表依赖 `import.meta.glob`。
- **数据库迁移会在 dev server 启动时由 `instrumentation.ts` 自动应用**，也可手动 `pnpm db:migrate`。
- **种子账号**：`admin` / `alice` / `bob` / `carol`，统一密码 `foi-dev-2026`（可用 `FOI_SEED_PASSWORD` 覆盖）。
- **mock 题目后端返回随机评测结果**，用于验证「提交→投递→回调」闭环。`backends.config.ts` 里六个后端在**没有配** `FOI_BACKEND_<NAME>_URL` 时都回落到 `:4100`，所以本环境不配也能跑通闭环。注意这条回落**只在非生产环境成立**：生产缺任何一个后端 URL 会 `assertEnv` 拒绝启动。`.env.local` 目前只给了 `traditional` 与 `flag-checker`（用的还是改名前的 `FOI_JUDGE_*`，仍然认），其余四个走的就是这条回落。
- Postgres 用户密码认证：连接串已用 `foi_dev_password`，通过 TCP `localhost:5433` 连接。
