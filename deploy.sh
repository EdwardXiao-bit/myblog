#!/usr/bin/env bash
#
# 一键部署 / 更新。在服务器上（仓库目录里）执行：
#
#   ./deploy.sh              # 构建并启动，然后自检
#   ./deploy.sh --pull       # 先 git pull 再部署
#   ./deploy.sh --no-smoke   # 跳过部署后自检
#
# 设计原则：**部署脚本自己会验收**。跑完如果自检没过，会明确报错退出，
# 而不是留下一句「部署完成」让你自己去发现站是坏的。

set -euo pipefail
cd "$(dirname "$0")"

PULL=0
SMOKE=1
for arg in "$@"; do
  case "$arg" in
    --pull) PULL=1 ;;
    --no-smoke) SMOKE=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$arg"; exit 2 ;;
  esac
done

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
die() { printf '\n\033[1;31m!! %s\033[0m\n' "$1" >&2; exit 1; }

# ---------- 1. 前置检查：缺一个都别往下走 ----------
say "检查环境"
command -v docker >/dev/null || die "没有 docker"
docker compose version >/dev/null 2>&1 || die "没有 docker compose 插件"
docker info >/dev/null 2>&1 || die "docker 守护进程不可用（当前用户可能不在 docker 组）"

[ -f .env ] || die "缺少 .env —— 请先 cp .env.example .env 并填好"
set -a; . ./.env; set +a

[ -n "${SITE_URL:-}" ] || die ".env 里必须设置 SITE_URL（构建期变量，canonical/RSS/sitemap/OG 都用它）"
case "$SITE_URL" in
  *example.com*) die "SITE_URL 还是占位的 example.com，改成你的真实地址（没域名就先写 http://服务器IP）" ;;
esac
[ -n "${ADMIN_PASSWORD:-}" ] || die ".env 里必须设置 ADMIN_PASSWORD"
# 只查通用弱口令，不把任何真实密码写进仓库
case "$ADMIN_PASSWORD" in
  change-me*|password*|passw0rd*|admin*|root*|123456*) die "ADMIN_PASSWORD 还是默认值/常见弱口令，换一个再上线" ;;
esac
if [ "${#ADMIN_PASSWORD}" -lt 10 ]; then
  die "ADMIN_PASSWORD 只有 ${#ADMIN_PASSWORD} 位，至少 10 位（建议 12 位以上，混合大小写+数字+符号）"
fi
if printf '%s' "$ADMIN_PASSWORD" | grep -qE '^[0-9]+$'; then
  die "ADMIN_PASSWORD 不能是纯数字"
fi
if [ "${#ADMIN_PASSWORD}" -lt 12 ]; then
  echo "  提示：ADMIN_PASSWORD 少于 12 位，建议再加长一些"
fi
[ -n "${GUESTBOOK_SALT:-}" ] || die ".env 里必须设置 GUESTBOOK_SALT（IP 哈希用的盐）"
[ "${GUESTBOOK_SALT}" != "change-me-too" ] || die "GUESTBOOK_SALT 还是默认值，换成随机串"

echo "  SITE_URL      = $SITE_URL"
echo "  SITE_DOMAIN   = ${SITE_DOMAIN:-（未设置，将用 http://IP 访问）}"
echo "  审核模式      = ${MODERATION:-on}"

# ---------- 2. 取代码 ----------
if [ "$PULL" = "1" ]; then
  say "拉取最新代码"
  git pull --ff-only
fi

# ---------- 3. 构建 + 启动 ----------
say "构建镜像（SITE_URL 在这一步写进产物）"
docker compose build

say "启动服务"
docker compose up -d

# ---------- 4. 等健康 ----------
say "等待应用健康"
for i in $(seq 1 60); do
  status=$(docker compose ps --format json app 2>/dev/null | grep -o '"Health":"[a-z]*"' | head -1 | cut -d'"' -f4 || true)
  if [ "$status" = "healthy" ]; then echo "  应用已就绪（第 ${i} 次探测）"; break; fi
  if [ "$i" = "60" ]; then
    docker compose logs --tail 50 app
    die "应用 60 次探测仍未 healthy，上面是最后 50 行日志"
  fi
  sleep 2
done

# ---------- 5. 自检 ----------
if [ "$SMOKE" = "1" ]; then
  say "部署后自检（在容器内跑，能直接读到数据库）"
  # --expect-proxy：断言「不同访客的 IP 能被区分开」。
  # 这是反向代理部署最容易悄悄踩的坑（限流退化成全站共享），必须验。
  docker compose exec -T app node scripts/smoke-prod.mjs http://127.0.0.1:4321 --write --expect-proxy \
    || die "自检未通过 —— 站点可能有问题，请先看上面的失败项"
fi

# ---------- 6. 备份一次，确认备份链路也是通的 ----------
say "立即做一次备份（并验证可恢复）"
docker compose exec -T app node scripts/backup.mjs
docker compose exec -T app node scripts/restore-drill.mjs \
  || die "备份做出来了但恢复演练失败 —— 这份备份不可信，务必排查"

# ---------- 7. 收尾 ----------
say "部署完成"
if [ -n "${SITE_DOMAIN:-}" ]; then
  echo "  访问地址：https://${SITE_DOMAIN}"
else
  ip=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo "服务器IP")
  echo "  访问地址：http://${ip}"
  echo "  （买了域名后：在 .env 里填 SITE_DOMAIN 和 SITE_URL，再跑一次 ./deploy.sh）"
fi
echo "  管理页  ：/admin"
echo "  健康检查：/healthz"
echo "  备份目录：$(pwd)/backups"
echo
echo "  记得给 backups/ 配个站外同步（另一块盘 / 对象存储），"
echo "  否则磁盘挂了备份和数据一起没。"
