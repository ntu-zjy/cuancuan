#!/usr/bin/env bash

set -Eeuo pipefail

APP_NAME="${APP_NAME:-cuancuan}"
APP_USER="${APP_USER:-${SUDO_USER:-ubuntu}}"
APP_ROOT="${APP_ROOT:-/opt/cuancuan}"
CONFIG_DIR="${CONFIG_DIR:-/etc/cuancuan}"
DATA_DIR="${DATA_DIR:-/var/lib/cuancuan}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/cuancuan}"
REPO_URL="${REPO_URL:-https://github.com/ntu-zjy/cuancuan.git}"
BRANCH="${BRANCH:-main}"
NODE_MAJOR="${NODE_MAJOR:-24}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "请使用 sudo 运行：sudo bash deploy/tencent-cloud/install.sh" >&2
  exit 1
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  echo "系统用户不存在：${APP_USER}。可通过 APP_USER=用户名 指定。" >&2
  exit 1
fi

if [[ ! "${APP_NAME}" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "APP_NAME 只能包含字母、数字、下划线和连字符。" >&2
  exit 1
fi
for target_dir in "${APP_ROOT}" "${CONFIG_DIR}" "${DATA_DIR}" "${BACKUP_DIR}"; do
  if [[ "${target_dir}" != /* || "${target_dir}" == "/" ]]; then
    echo "部署目录必须是非根目录的绝对路径：${target_dir}" >&2
    exit 1
  fi
done

APP_GROUP="$(id -gn "${APP_USER}")"

if [[ -z "${SITE_ADDRESS:-}" ]]; then
  PUBLIC_IP="$(curl -4fsS --max-time 8 https://api.ipify.org || true)"
  if [[ "${PUBLIC_IP}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    SITE_ADDRESS="${PUBLIC_IP//./-}.sslip.io"
  else
    echo "无法自动获取公网 IP。请指定 SITE_ADDRESS，例如：" >&2
    echo "sudo SITE_ADDRESS=43-160-203-221.sslip.io bash deploy/tencent-cloud/install.sh" >&2
    exit 1
  fi
fi

escape_env_value() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "${value}"
}

prompt_secret() {
  local prompt="$1"
  local result
  read -r -s -p "${prompt}" result
  echo >&2
  printf '%s' "${result}"
}

echo "[1/8] 安装 Node.js、Caddy、Git 和 SQLite 工具"
if [[ -f /etc/apt/sources.list.d/caddy-stable.list ]] \
  && command -v curl >/dev/null 2>&1 \
  && command -v gpg >/dev/null 2>&1; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
fi
apt-get update
apt-get install -y ca-certificates curl git gnupg sqlite3 rsync

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(`.`)[0]' 2>/dev/null || echo 0)" -lt "${NODE_MAJOR}" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  chmod o+r /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "[2/8] 为 2GB 服务器准备构建交换空间"
TOTAL_MEMORY_KB="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if [[ "${TOTAL_MEMORY_KB}" -lt 3000000 ]] && ! swapon --show=NAME | grep -qx '/swapfile'; then
  if [[ ! -e /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  grep -qE '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "[3/8] 创建应用、数据、配置和备份目录"
install -d -m 0755 -o "${APP_USER}" -g "${APP_GROUP}" "${APP_ROOT}" "${APP_ROOT}/releases"
install -d -m 0750 -o "${APP_USER}" -g "${APP_GROUP}" "${DATA_DIR}" "${BACKUP_DIR}"
install -d -m 0750 -o root -g "${APP_GROUP}" "${CONFIG_DIR}"

ENV_FILE="${CONFIG_DIR}/cuancuan.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  ADMIN_EMAIL_VALUE="${ADMIN_EMAIL:-}"
  while [[ -z "${ADMIN_EMAIL_VALUE}" ]]; do
    read -r -p '管理员邮箱：' ADMIN_EMAIL_VALUE
  done

  ADMIN_PASSWORD_VALUE="${ADMIN_PASSWORD:-}"
  while [[ "${#ADMIN_PASSWORD_VALUE}" -lt 12 ]]; do
    ADMIN_PASSWORD_VALUE="$(prompt_secret '管理员密码（至少 12 位）：')"
    if [[ "${#ADMIN_PASSWORD_VALUE}" -lt 12 ]]; then
      echo "密码长度不足 12 位，请重新输入。" >&2
    fi
  done

  DEMO_VERIFY_CODE_VALUE="${DEMO_VERIFY_CODE:-}"
  while [[ ! "${DEMO_VERIFY_CODE_VALUE}" =~ ^[0-9]{6}$ ]]; do
    read -r -p 'Demo 六位验证码：' DEMO_VERIFY_CODE_VALUE
  done

  APP_ENCRYPTION_KEY_VALUE="${APP_ENCRYPTION_KEY:-$(openssl rand -base64 32)}"
  umask 077
  {
    echo 'NODE_ENV=production'
    printf 'ADMIN_EMAIL="%s"\n' "$(escape_env_value "${ADMIN_EMAIL_VALUE}")"
    printf 'ADMIN_PASSWORD="%s"\n' "$(escape_env_value "${ADMIN_PASSWORD_VALUE}")"
    printf 'APP_ENCRYPTION_KEY="%s"\n' "$(escape_env_value "${APP_ENCRYPTION_KEY_VALUE}")"
    printf 'DATABASE_PATH="%s/cuancuan.db"\n' "${DATA_DIR}"
    printf 'DEMO_VERIFY_CODE="%s"\n' "${DEMO_VERIFY_CODE_VALUE}"
  } > "${ENV_FILE}"
  chown root:"${APP_GROUP}" "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
else
  echo "保留已有环境变量文件：${ENV_FILE}"
fi

cat > "${CONFIG_DIR}/deploy.conf" <<EOF
APP_NAME="${APP_NAME}"
APP_USER="${APP_USER}"
APP_GROUP="${APP_GROUP}"
APP_ROOT="${APP_ROOT}"
CONFIG_DIR="${CONFIG_DIR}"
DATA_DIR="${DATA_DIR}"
BACKUP_DIR="${BACKUP_DIR}"
REPO_URL="${REPO_URL}"
BRANCH="${BRANCH}"
SITE_ADDRESS="${SITE_ADDRESS}"
EOF
chmod 0644 "${CONFIG_DIR}/deploy.conf"

echo "[4/8] 下载并构建首个版本"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)"
RELEASE_DIR="${APP_ROOT}/releases/${RELEASE_ID}"
sudo -u "${APP_USER}" git clone --depth 1 --branch "${BRANCH}" "${REPO_URL}" "${RELEASE_DIR}"
sudo -u "${APP_USER}" env NODE_OPTIONS=--max-old-space-size=1536 npm --prefix "${RELEASE_DIR}" ci
sudo -u "${APP_USER}" env NODE_OPTIONS=--max-old-space-size=1536 npm --prefix "${RELEASE_DIR}" run build
ln -sfn "${RELEASE_DIR}" "${APP_ROOT}/current"
chown -h "${APP_USER}:${APP_GROUP}" "${APP_ROOT}/current"

echo "[5/8] 安装 systemd 服务"
cat > "/etc/systemd/system/${APP_NAME}.service" <<EOF
[Unit]
Description=Cuancuan Next.js application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_ROOT}/current
EnvironmentFile=${ENV_FILE}
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm run start -- --hostname 127.0.0.1 --port 3000
Restart=always
RestartSec=5
TimeoutStopSec=20
KillSignal=SIGINT
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

echo "[6/8] 配置 Caddy HTTPS 反向代理"
cat > /etc/caddy/Caddyfile <<EOF
${SITE_ADDRESS} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3000

  header {
    X-Content-Type-Options nosniff
    Referrer-Policy strict-origin-when-cross-origin
    -Server
  }
}
EOF
caddy validate --config /etc/caddy/Caddyfile

echo "[7/8] 安装更新与 SQLite 备份命令"
DEPLOY_SOURCE_DIR="${RELEASE_DIR}/deploy/tencent-cloud"
if [[ ! -d "${DEPLOY_SOURCE_DIR}" ]]; then
  DEPLOY_SOURCE_DIR="${SCRIPT_DIR}"
fi
install -m 0755 "${DEPLOY_SOURCE_DIR}/update.sh" /usr/local/sbin/cuancuan-update
install -m 0755 "${DEPLOY_SOURCE_DIR}/backup.sh" /usr/local/sbin/cuancuan-backup
install -m 0755 "${DEPLOY_SOURCE_DIR}/restore.sh" /usr/local/sbin/cuancuan-restore

cat > "/etc/systemd/system/${APP_NAME}-backup.service" <<EOF
[Unit]
Description=Backup Cuancuan SQLite database

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/cuancuan-backup
EOF

cat > "/etc/systemd/system/${APP_NAME}-backup.timer" <<EOF
[Unit]
Description=Daily Cuancuan SQLite backup

[Timer]
OnCalendar=*-*-* 03:20:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now "${APP_NAME}.service"
systemctl enable --now caddy
systemctl enable --now "${APP_NAME}-backup.timer"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow 80/tcp
  ufw allow 443/tcp
fi

echo "[8/8] 健康检查"
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:3000/ >/dev/null; then
    break
  fi
  sleep 2
done
curl -fsS http://127.0.0.1:3000/ >/dev/null
systemctl reload caddy
/usr/local/sbin/cuancuan-backup

echo
echo "部署完成："
echo "  访问地址：https://${SITE_ADDRESS}"
echo "  管理后台：https://${SITE_ADDRESS}/admin"
echo "  查看日志：sudo journalctl -u ${APP_NAME} -f"
echo "  更新版本：sudo cuancuan-update"
echo "  手动备份：sudo cuancuan-backup"
echo "  恢复备份：sudo cuancuan-restore /var/backups/cuancuan/备份文件.db"
echo
echo "请确认腾讯云防火墙已经开放 TCP 80 和 443。"
echo "模型 API Key 不在部署脚本中；请登录 HTTPS 管理员后台后配置。"
