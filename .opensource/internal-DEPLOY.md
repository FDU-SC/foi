# 部署

## 两个仓库

平台代码是公开的，赛事内容不是。这条边界由仓库划分，不由分支划分：

| 仓库                  | 可见性 | 内容                                                   |
| --------------------- | ------ | ------------------------------------------------------ |
| `FDU-SC/foi`          | 公开   | 平台本身，加一份去身份化的示例 `content/`              |
| `FDU-SC/foi-internal` | 私有   | 真实 `content/`，以及面向 staging 与 production 的部署 |

公开仓库是平台的唯一真源，平台改动一律在那边提 PR。本仓库只往一个方向流动：

```
FDU-SC/foi  main
                │  git merge upstream/main
            staging ──merge──> prod
```

本仓库没有 `main`。从这里流回公开仓库的路径在物理上不存在——跨仓库合并需要主动
`git remote add` 再推送，不会因为点错按钮发生。

这套划分之所以成立，是因为平台从设计上就不认识任何具体内容：它只通过八个入口发现
内容，`app/` 与 `components/` 从不直接 import `content/`。公开仓库 CI 里的「抽空
content」检查守着这条边界——它把 `content/` 删到只剩注册表骨架，然后验证平台仍然能
编译和启动。这个检查一旦挂掉，就说明有内容语义漏进了平台层，两个仓库也就无法只靠
替换 `content/` 来区分。

### 从上游同步

```bash
git remote add upstream https://github.com/FDU-SC/foi.git    # 只需一次
git fetch upstream
git checkout staging && git merge upstream/main
```

合并只带来平台改动，`content/` 留在本仓库。`content/site.ts` 与
`content/enrollment/` 两边都会改，同一处冲突会反复出现，建议开一次
`git config rerere.enabled true`，让 git 记住上次的解法。

## 分支与环境

| 分支      | GitHub Environment | 用途             |
| --------- | ------------------ | ---------------- |
| `staging` | `staging`          | 正式上线前的检验 |
| `prod`    | `production`       | 生产正式站点     |

开发环境不在本仓库：公开仓库每晚从 `main` 重建一个演示站点，跑在独立宿主上。

## 触发部署

推送到 `staging` / `prod`，或在 Actions 页面手动触发。只改 Markdown、`docs/` 或
`LICENSE` 的提交不触发。

手动触发时可以填 `image_tag`（形如 `sha-abc1234`）：CI 确认该镜像已存在于 GHCR 后
直接部署，跳过构建。留空则构建当前 HEAD。

## 部署流程

```
检查      类型检查 + lint + 迁移 + 测试 + 构建 + 启动验证
构建      推送 ghcr.io，按 sha-<commit> 打不可变标签
部署      SSH 到目标机器 → 改写 FOI_IMAGE → compose pull → up --wait
清理      GHCR 上只保留最近 8 个版本
```

部署失败会自动回滚到上一个镜像（`.env.bak` 里记着）。

## 环境配置

每个 GitHub Environment 需要四个 secret：

| Secret               | 说明                                    |
| -------------------- | --------------------------------------- |
| `DEPLOY_HOST`        | 部署目标主机名                          |
| `DEPLOY_USER`        | SSH 用户，需免密                        |
| `DEPLOY_PATH`        | 远端部署目录绝对路径                    |
| `DEPLOY_KNOWN_HOSTS` | 目标主机指纹，`ssh-keyscan <host>` 取得 |

CI 在自托管 runner 上执行，由它免密 SSH 到目标机器的部署用户，该用户需在 `docker`
组中。**自托管 runner 只服务本仓库**：公开仓库用 GitHub 托管 runner，因为任何人都能
fork 后提 PR，依赖安装脚本会随之执行，而这台 runner 能免密进生产。

## 服务器上的两份文件

```
<DEPLOY_PATH>/
├── docker-compose.yml   # 参考 docker-compose.example.yml
└── .env                 # 参考 .env.example
```

**这两份文件由运维手工维护，CI 只改写 `.env` 里的 `FOI_IMAGE` 一行。** 密钥设一次就
长期有效，不随发布变动。

初始化一个新环境，就是建好目录、放进这两份文件（`.env` 里必须已有 `FOI_IMAGE=` 这一
行，值随意，首次部署会覆盖），然后触发一次部署。

`.env.example` 里的 `AUTH_SECRET` 与 `FOI_BACKEND_SECRET` 是占位值，长度足够但写在
仓库里。启动检查会认出这些值并在 staging 与 production 拒绝启动。

## 回滚

```bash
# 方式一：手动触发 workflow，image_tag 填旧的 sha-<commit>
# 方式二：在目标机器上
sed -i 's|^FOI_IMAGE=.*|FOI_IMAGE=<旧镜像>|' .env
docker compose up -d --wait --remove-orphans
```

## 题目后端

需要外部评测的题目由独立部署的判题机服务，它们不在本仓库。判题机是**主动来领活**的：
平台不需要知道它们的地址，只需要两边持有同一把密钥（`FOI_BACKEND_<后端名>_SECRET`，
未设置时回落到 `FOI_BACKEND_SECRET`）。

每个后端应当各用一把密钥。共用一把的话，任何一台判题机被攻破，其余队列的提交、代码和
评测结果一起丢——平台启动时的检查会就此告警。

例外是需要平台主动发起的交互动作（如靶机的启动与销毁），那种后端要额外配
`FOI_BACKEND_<后端名>_URL`。

### 判题机宿主的要求

判题机执行的是选手写的代码，它的宿主要满足这些条件才能接真实比赛：

- **与平台分开部署。** 判题容器内部有隔离，但容器本身才是安全边界；它和平台同机意味着
  一次逃逸就够到生产数据
- **容器要拿到 `SETUID`、`SETGID`、`SETPCAP`、`KILL`、`NET_ADMIN`。** 前三个用于把选手
  进程降到独立 uid，`KILL` 用于杀掉那个 uid 的超时进程，`NET_ADMIN` 用于装出网禁令。
  缺 `KILL` 时超时的提交杀不掉，判题机会被一个死循环占住
- **每个队列一把独立密钥。** 判题机能读到它所服务队列里所有人的代码

判题机自身会在启动时检查降权与出网禁令是否就位，缺任何一项都拒绝启动。

## 靶机题

需要平台代选手拉起靶机的题目，其编排器持有宿主的 `docker.sock`，等价于那台宿主的
root。它必须单独部署，不与平台、也不与其他判题机共处一台。

靶机默认接在 `bridge` 网络上，可以出网。靶机是 Web 服务、选手要访问它，所以既不能用
`none` 也不能用 `--internal`（后者会连发布的端口一起断）。要关上这条出路，需要给靶机
一个专用 bridge 网络，再在宿主防火墙上丢弃该网段的转发流量。
