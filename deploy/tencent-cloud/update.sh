#!/usr/bin/env bash

set -Eeuo pipefail

CONF_FILE="${CONF_FILE:-/etc/cuancuan/deploy.conf}"
if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo 运行：sudo cuancuan-update" >&2
  exit 1
fi
if [[ ! -f "${CONF_FILE}" ]]; then
  echo "缺少部署配置：${CONF_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${CONF_FILE}"

if [[ ! "${APP_NAME}" =~ ^[a-zA-Z0-9_-]+$ || "${APP_ROOT}" != /* || "${APP_ROOT}" == "/" ]]; then
  echo "部署配置不安全，已停止更新。" >&2
  exit 1
fi

PREVIOUS_RELEASE="$(readlink -f "${APP_ROOT}/current" || true)"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"

rollback() {
  local exit_code=$?
  if [[ -n "${PREVIOUS_RELEASE}" && -d "${PREVIOUS_RELEASE}" ]]; then
    echo "更新失败，恢复上一版本：${PREVIOUS_RELEASE}" >&2
    ln -sfn "${PREVIOUS_RELEASE}" "${APP_ROOT}/current"
    chown -h "${APP_USER}:${APP_GROUP}" "${APP_ROOT}/current"
    systemctl restart "${APP_NAME}.service" || true
  fi
  exit "${exit_code}"
}
trap rollback ERR

echo "[1/5] 更新前备份数据库"
/usr/local/sbin/cuancuan-backup

echo "[2/5] 下载 ${BRANCH} 最新版本"
sudo -u "${APP_USER}" git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${RELEASE_DIR}"

echo "[3/5] 安装依赖并构建"
sudo -u "${APP_USER}" env NODE_OPTIONS=--max-old-space-size=1536 npm --prefix "${RELEASE_DIR}" ci
sudo -u "${APP_USER}" env NODE_OPTIONS=--max-old-space-size=1536 npm --prefix "${RELEASE_DIR}" run build

echo "[4/5] 切换版本并重启"
ln -sfn "${RELEASE_DIR}" "${APP_ROOT}/current"
chown -h "${APP_USER}:${APP_GROUP}" "${APP_ROOT}/current"
if [[ -d "${RELEASE_DIR}/deploy/tencent-cloud" ]]; then
  install -m 0755 "${RELEASE_DIR}/deploy/tencent-cloud/update.sh" /usr/local/sbin/cuancuan-update
  install -m 0755 "${RELEASE_DIR}/deploy/tencent-cloud/backup.sh" /usr/local/sbin/cuancuan-backup
  install -m 0755 "${RELEASE_DIR}/deploy/tencent-cloud/restore.sh" /usr/local/sbin/cuancuan-restore
fi
systemctl restart "${APP_NAME}.service"

echo "[5/5] 健康检查"
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/ >/dev/null; then
    trap - ERR
    mapfile -t OLD_RELEASES < <(find "${APP_ROOT}/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | tail -n +4 | cut -d' ' -f2-)
    for old_release in "${OLD_RELEASES[@]}"; do
      case "${old_release}" in
        "${APP_ROOT}"/releases/*)
          if [[ "$(readlink -f "${APP_ROOT}/current")" != "${old_release}" ]]; then
            rm -rf -- "${old_release}"
          fi
          ;;
      esac
    done
    echo "更新完成：${RELEASE_ID}"
    exit 0
  fi
  sleep 2
done

echo "健康检查失败。" >&2
false
