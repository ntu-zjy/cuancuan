# 腾讯云原生部署（无 Docker）

这套脚本适用于 Ubuntu 24.04 轻量应用服务器，架构为：

- Node.js 24 运行 Next.js；
- systemd 守护进程并自动重启；
- Caddy 自动申请 HTTPS 证书并反向代理；
- SQLite 保存在 `/var/lib/cuancuan/cuancuan.db`；
- 每天生成一致性备份，保留 14 天；
- 发布采用版本目录 + 原子软链接，失败自动回滚。

## 1. 腾讯云控制台

在轻量服务器防火墙中开放：

- TCP 22：建议只允许自己的固定公网 IP；
- TCP 80：全部 IPv4；
- TCP 443：全部 IPv4。

应用端口 3000 不要对公网开放。

## 2. 首次安装

### 方式 A：上传独立部署包

把 `cuancuan-tencent-native-deploy.tar.gz` 通过腾讯云文件管理器或你自己的终端上传到服务器，然后执行：

```bash
tar -xzf cuancuan-tencent-native-deploy.tar.gz
cd deploy/tencent-cloud
sudo SITE_ADDRESS=43-160-203-221.sslip.io bash install.sh
```

安装器会从公开 GitHub 仓库拉取应用代码；部署包自身不包含数据库、环境变量或任何 API Key。

### 方式 B：从 GitHub 仓库执行

SSH 登录服务器后执行：

```bash
sudo apt-get update
sudo apt-get install -y git
git clone --depth 1 https://github.com/ntu-zjy/cuancuan.git
cd cuancuan
sudo bash deploy/tencent-cloud/install.sh
```

脚本会询问管理员邮箱、至少 12 位管理员密码和六位 Demo 验证码。加密主密钥会在服务器上自动生成，不会进入 Git。

没有自有域名时，脚本会根据公网 IP 自动使用 `IP.sslip.io` 免费解析，例如：

```text
https://43-160-203-221.sslip.io
```

如需明确指定地址：

```bash
sudo SITE_ADDRESS=43-160-203-221.sslip.io bash deploy/tencent-cloud/install.sh
```

有正式域名后，把域名 A 记录指向服务器，再修改 `/etc/caddy/Caddyfile` 第一行并执行：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 3. 配置模型

部署脚本不会保存任何模型 API Key。访问 `https://你的地址/admin`，登录管理员后台后添加阶跃星辰或其他 OpenAI-Compatible 平台。

曾经出现在聊天、截图或终端历史中的 Key 应先在模型平台作废并重新生成。

## 4. 日常操作

```bash
# 查看服务
sudo systemctl status cuancuan --no-pager

# 实时日志
sudo journalctl -u cuancuan -f

# 拉取 main 最新代码、构建、切换并健康检查
sudo cuancuan-update

# 立即备份
sudo cuancuan-backup

# 查看定时备份
systemctl list-timers cuancuan-backup.timer
ls -lh /var/backups/cuancuan
```

## 5. 恢复数据库

执行已安装的恢复命令：

```bash
sudo cuancuan-restore /var/backups/cuancuan/cuancuan-20260722T120000Z.db
```

恢复前必须输入 `RESTORE`。脚本会先停止应用，并额外保留一份覆盖前的数据库。

## 6. 环境变量与备份

- 生产环境变量：`/etc/cuancuan/cuancuan.env`
- 部署配置：`/etc/cuancuan/deploy.conf`
- 数据库：`/var/lib/cuancuan/cuancuan.db`
- 数据库备份：`/var/backups/cuancuan/`
- 当前版本：`/opt/cuancuan/current`
- 历史版本：`/opt/cuancuan/releases/`（保留最近 3 个）

请单独安全备份 `/etc/cuancuan/cuancuan.env`。其中的 `APP_ENCRYPTION_KEY` 丢失后，管理员后台已保存的模型 Key 将无法解密。

## 7. 常见排查

```bash
# 应用本机健康检查
curl -I http://127.0.0.1:3000/

# Caddy 配置与日志
sudo caddy validate --config /etc/caddy/Caddyfile
sudo journalctl -u caddy -n 100 --no-pager

# 端口监听
sudo ss -ltnp | grep -E ':(80|443|3000)\\b'

# 数据库完整性
sudo sqlite3 /var/lib/cuancuan/cuancuan.db 'PRAGMA integrity_check;'
```
