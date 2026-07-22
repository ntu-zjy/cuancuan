#!/usr/bin/env bash

set -Eeuo pipefail

CONF_FILE="${CONF_FILE:-/etc/cuancuan/deploy.conf}"
if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo 运行。" >&2
  exit 1
fi
if [[ ! -f "${CONF_FILE}" ]]; then
  echo "缺少部署配置：${CONF_FILE}" >&2
  exit 1
fi
if [[ $# -ne 1 ]]; then
  echo "用法：sudo bash restore.sh /var/backups/cuancuan/cuancuan-时间.db" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${CONF_FILE}"

if [[ ! "${APP_NAME}" =~ ^[a-zA-Z0-9_-]+$ || "${DATA_DIR}" != /* || "${DATA_DIR}" == "/" || "${BACKUP_DIR}" != /* || "${BACKUP_DIR}" == "/" ]]; then
  echo "部署配置不安全，已停止恢复。" >&2
  exit 1
fi

BACKUP_FILE="$(realpath "$1")"
case "${BACKUP_FILE}" in
  "${BACKUP_DIR}"/cuancuan-*.db) ;;
  *)
    echo "只允许恢复 ${BACKUP_DIR} 中的 cuancuan-*.db。" >&2
    exit 1
    ;;
esac

if ! sqlite3 "${BACKUP_FILE}" 'PRAGMA integrity_check;' | grep -qx 'ok'; then
  echo "备份文件完整性检查失败。" >&2
  exit 1
fi

echo "即将用以下备份覆盖当前数据库：${BACKUP_FILE}"
read -r -p '输入 RESTORE 继续：' CONFIRM
[[ "${CONFIRM}" == "RESTORE" ]] || { echo "已取消。"; exit 0; }

SERVICE_STOPPED=0
ensure_service_started() {
  if [[ "${SERVICE_STOPPED}" -eq 1 ]]; then
    systemctl start "${APP_NAME}.service" || true
  fi
}
trap ensure_service_started EXIT

systemctl stop "${APP_NAME}.service"
SERVICE_STOPPED=1
if [[ -f "${DATA_DIR}/cuancuan.db" ]]; then
  cp -a "${DATA_DIR}/cuancuan.db" "${BACKUP_DIR}/before-restore-$(date -u +%Y%m%dT%H%M%SZ).db"
fi
install -m 0640 -o "${APP_USER}" -g "${APP_GROUP}" "${BACKUP_FILE}" "${DATA_DIR}/cuancuan.db"
rm -f -- "${DATA_DIR}/cuancuan.db-wal" "${DATA_DIR}/cuancuan.db-shm"
systemctl start "${APP_NAME}.service"
SERVICE_STOPPED=0
trap - EXIT
echo "恢复完成。"
