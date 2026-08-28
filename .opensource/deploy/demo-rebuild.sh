#!/bin/bash
# 演示站的自助重建。
#
# 比对 :nightly 标签的摘要，变了才动手；没变就安静退出。由 systemd timer 定时唤起，
# 所以运行频率决定的是「发现新镜像后多久生效」，而不是「多久重建一次」——镜像一天
# 才换一次，重建也就一天一次。
#
# 部署由这台机器主动发起，CI 不持有任何进入这里的凭据。
set -euo pipefail

ROOT=${FOI_DEMO_ROOT:-<deploy-path>}
DEMO_DIR="$ROOT/foi-demo"
RUNNER_DIR="$ROOT/foi-runners-demo"
STATE="$DEMO_DIR/.deployed-digest"

log() { printf '%s %s\n' "$(date -Is)" "$*"; }
die() { log "错误: $*"; exit 1; }

[ -d "$DEMO_DIR" ] || die "$DEMO_DIR 不存在"
[ -d "$RUNNER_DIR" ] || die "$RUNNER_DIR 不存在"

# shellcheck disable=SC1090
IMAGE=$(grep -E '^FOI_IMAGE=' "$DEMO_DIR/.env" | head -1 | cut -d= -f2-)
[ -n "$IMAGE" ] || die "$DEMO_DIR/.env 里没有 FOI_IMAGE"

DEMO_PASSWORD=$(grep -E '^FOI_DEMO_PASSWORD=' "$DEMO_DIR/.env" | head -1 | cut -d= -f2-)
[ -n "$DEMO_PASSWORD" ] || die "$DEMO_DIR/.env 里没有 FOI_DEMO_PASSWORD"
ACCOUNT_COUNT=$(grep -E '^FOI_DEMO_ACCOUNT_COUNT=' "$DEMO_DIR/.env" | head -1 | cut -d= -f2-)
ACCOUNT_COUNT=${ACCOUNT_COUNT:-5}

log "检查 $IMAGE"
docker pull --quiet "$IMAGE" > /dev/null || die "拉取失败"

latest=$(docker image inspect "$IMAGE" --format '{{index .RepoDigests 0}}')
deployed=$(cat "$STATE" 2>/dev/null || echo "")

if [ "$latest" = "$deployed" ]; then
  log "摘要未变，无需重建"
  exit 0
fi

log "发现新镜像，开始重建"
log "  旧: ${deployed:-（无记录）}"
log "  新: $latest"

# 评测机先撤下：清库期间它没有平台可领活，留着只会刷失败日志，而且它也要换新镜像。
( cd "$RUNNER_DIR" && docker compose down --remove-orphans )

cd "$DEMO_DIR"

# 清库要在应用起来之前：表结构由应用启动时的自动迁移重建，先起应用再清就把刚建好的
# 表又删了。停掉 app 同时也断开它对数据库的连接，drop schema 会被活动连接挡住。
docker compose stop app
docker compose up -d --wait postgres

docker compose run --rm --no-deps \
  -e FOI_ALLOW_DESTRUCTIVE=yes-drop-everything \
  app node scripts/db-reset.cjs

docker compose up -d --wait --remove-orphans

docker compose run --rm --no-deps \
  -e FOI_DEMO_PASSWORD="$DEMO_PASSWORD" \
  app node scripts/demo-seed.cjs --count "$ACCOUNT_COUNT"

( cd "$RUNNER_DIR" && docker compose up -d )

# 自检：--wait 只证明容器自认健康，这一步走一遍真实的 HTTP 路径。
for attempt in 1 2 3 4 5; do
  if docker compose exec -T app node -e \
    'fetch("http://127.0.0.1:3000/api/health").then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))'; then
    break
  fi
  [ "$attempt" -eq 5 ] && die "应用重建后不响应健康检查"
  log "健康检查第 $attempt/5 次未通过，5s 后重试"
  sleep 5
done

# 摘要最后才记：中途失败就不留记录，下次唤起会重试同一个镜像。
echo "$latest" > "$STATE"

docker image prune -f --filter "until=168h" > /dev/null 2>&1 || true

log "重建完成：$IMAGE"
