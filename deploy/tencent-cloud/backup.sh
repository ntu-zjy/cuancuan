#!/usr/bin/env bash

set -Eeuo pipefail

CONF_FILE="${CONF_FILE:-/etc/cuancuan/deploy.conf}"
if [[ ! -f "${CONF_FILE}" ]]; then
  echo "缺少部署配置：${CONF_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${CONF_FILE}"

if [[ "${DATA_DIR}" != /* || "${DATA_DIR}" == "/" || "${BACKUP_DIR}" != /* || "${BACKUP_DIR}" == "/" ]]; then
  echo "数据或备份目录配置不安全，已停止备份。" >&2
  exit 1
fi

DATABASE_FILE="${DATA_DIR}/cuancuan.db"
if [[ ! -f "${DATABASE_FILE}" ]]; then
  echo "数据库尚未创建，跳过备份：${DATABASE_FILE}"
  exit 0
fi

install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${BACKUP_DIR}"
BACKUP_FILE="${BACKUP_DIR}/cuancuan-$(date -u +%Y%m%dT%H%M%SZ).db"
sqlite3 "${DATABASE_FILE}" ".timeout 10000" ".backup '${BACKUP_FILE}'"
chown "${APP_USER}:${APP_GROUP}" "${BACKUP_FILE}"
chmod 0640 "${BACKUP_FILE}"

if ! sqlite3 "${BACKUP_FILE}" 'PRAGMA integrity_check;' | grep -qx 'ok'; then
  rm -f -- "${BACKUP_FILE}"
  echo "备份完整性检查失败。" >&2
  exit 1
fi

find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'cuancuan-*.db' -mtime +14 -delete
echo "备份完成：${BACKUP_FILE}"
