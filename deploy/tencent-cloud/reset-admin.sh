#!/usr/bin/env bash

set -Eeuo pipefail

CONF_FILE="${CONF_FILE:-/etc/cuancuan/deploy.conf}"
ENV_FILE="${ENV_FILE:-/etc/cuancuan/cuancuan.env}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo 运行：sudo cuancuan-reset-admin" >&2
  exit 1
fi
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "缺少环境变量文件：${ENV_FILE}" >&2
  exit 1
fi

APP_NAME="cuancuan"
if [[ -f "${CONF_FILE}" ]]; then
  # shellcheck disable=SC1090
  source "${CONF_FILE}"
fi

read -r -p "新的管理员邮箱：" ADMIN_EMAIL_VALUE
while [[ -z "${ADMIN_EMAIL_VALUE}" ]]; do
  read -r -p "新的管理员邮箱：" ADMIN_EMAIL_VALUE
done

read_secret() {
  local prompt="$1"
  local value
  read -r -s -p "${prompt}" value
  echo >&2
  printf '%s' "${value}"
}

ADMIN_PASSWORD_VALUE="$(read_secret "新的管理员密码（至少 12 位）：" )"
while [[ "${#ADMIN_PASSWORD_VALUE}" -lt 12 ]]; do
  echo "密码长度不足 12 位，请重新输入。" >&2
  ADMIN_PASSWORD_VALUE="$(read_secret "新的管理员密码（至少 12 位）：" )"
done

ADMIN_PASSWORD_CONFIRM="$(read_secret "再次输入管理员密码：" )"
if [[ "${ADMIN_PASSWORD_VALUE}" != "${ADMIN_PASSWORD_CONFIRM}" ]]; then
  echo "两次密码不一致，已停止。" >&2
  exit 1
fi

escape_env_value() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

replace_or_append_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^${key}=" "${ENV_FILE}"; then
    sed -i "s|^${key}=.*|${key}=\"$(escape_env_value "${value}")\"|" "${ENV_FILE}"
  else
    printf '%s="%s"\n' "${key}" "$(escape_env_value "${value}")" >> "${ENV_FILE}"
  fi
}

replace_or_append_env "ADMIN_EMAIL" "${ADMIN_EMAIL_VALUE}"
replace_or_append_env "ADMIN_PASSWORD" "${ADMIN_PASSWORD_VALUE}"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${DATABASE_PATH:-}" ]]; then
  echo "缺少 DATABASE_PATH 环境变量。" >&2
  exit 1
fi

ADMIN_EMAIL_VALUE="${ADMIN_EMAIL_VALUE}" ADMIN_PASSWORD_VALUE="${ADMIN_PASSWORD_VALUE}" node <<'NODE'
const { randomBytes, scryptSync, randomUUID } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const database = new DatabaseSync(process.env.DATABASE_PATH);
database.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);
const email = process.env.ADMIN_EMAIL_VALUE.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD_VALUE.trim();
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
const now = new Date().toISOString();
const existing = database.prepare("SELECT id FROM admin_users WHERE lower(email) = lower(?)").get(email);

database.exec("BEGIN");
try {
  if (existing) {
    database.prepare(`
      UPDATE admin_users
      SET password_hash = ?, password_salt = ?, role = 'admin'
      WHERE id = ?
    `).run(hash, salt, existing.id);
  } else {
    database.prepare(`
      INSERT INTO admin_users (id, email, password_hash, password_salt, role, created_at)
      VALUES (?, ?, ?, ?, 'admin', ?)
    `).run(randomUUID(), email, hash, salt, now);
  }
  database.prepare("DELETE FROM admin_sessions").run();
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
}
database.close();
NODE

# The reset tool runs as root, while the web process uses APP_USER. Keep the
# SQLite database and any WAL sidecar files readable and writable by the app.
chown "${APP_USER}:${APP_GROUP}" "${DATABASE_PATH}" 2>/dev/null || true
for sqlite_sidecar in "${DATABASE_PATH}-wal" "${DATABASE_PATH}-shm"; do
  [[ -e "${sqlite_sidecar}" ]] && chown "${APP_USER}:${APP_GROUP}" "${sqlite_sidecar}"
done
chmod 0640 "${DATABASE_PATH}" 2>/dev/null || true

systemctl restart "${APP_NAME}.service"

echo "管理员已重置：${ADMIN_EMAIL_VALUE}"
echo "请重新打开 /admin 登录。"
