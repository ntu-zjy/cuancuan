# 攒攒 Demo

一个按照 PRD V1.9 实现的响应式网页 Demo：用户从同一个 AI 对话入口选择合作、玩伴、相亲、招聘、创投、旅友或活动名单配对。每个场景拥有隔离的关系空间画像与候选池；用户确认意图后，Agent 会先搜索真实局和匿名授权意图，没有合适局时自主发起公开招募局，并让后续用户继续发现。

## 已实现

- 邀请制注册 / 登录演示（内测码 `CUANCUAN2026`，验证码 `888888`）；
- 一个统一 `/chat` 入口，输入框下可选择找合作伙伴、找玩伴、认真相亲、招聘求职、找创投、找旅友和活动名单配对；
- 各专业能力保留独立 Agent 提示词、轻量表单、局池和用户侧结果语言；
- 基于 Vercel AI SDK `ToolLoopAgent` 的开放式多轮对话、理解进度和 Intent 草稿；
- `ask_user_question` 工具及网页表单渲染，支持单选、多选、简答、“其他”和提交后回显；
- Intent 修改、确认、暂停 / 恢复和重新聊；
- 用户确认的当前意图写入按关系空间隔离的全局授权池；暂停、关闭或过期后不再进入其他用户的 Agent 搜索结果；
- 基于 Vercel AI SDK `ToolLoopAgent` 的 `search_rooms`、`search_people`、`inspect_room` 和 `create_room` 工具，搜索 SQLite 中的真实局与匿名授权意图，并在没有合适局时自主发起公开招募局；
- 新局持久化进入真实局池，发起用户成为 host 和第一位成员；后续用户的 Agent 可以搜索并推荐它；
- 全局组局不使用服务端固定评分公式或阈值替 Agent 作决定；推荐、继续等待或创建新局由 Agent 基于工具返回的事实判断，服务端只保留权限、隐私、幂等、有效期、时间与容量等硬边界；
- 推荐解释包含当前空间画像、候选局事实、成员缺口、可行性、边界、约束与来源；模型未配置或本轮失败时保留已授权意图，但不会由本地规则冒充 Agent 自动推荐或建局；
- 统一发现页的开放局、类型筛选、详情与适配说明；当前关系空间为默认范围，用户仍可主动查看全部公开局；
- 每个局独立配置需要审核 / 即时加入和公开 / 邀请制，支持发起人审核、候补与取消后的自动补位；
- 招募中、待确认、已成立、已预约、进行中、已完成 / 已取消、后续连接完整生命周期；
- 局工作区支持时间地点 / 会议链接、站内提醒、成员摘要、目标与角色、截止日期、完成标准、站内群聊、会后反馈和下一步关系建议；
- 一个 Agent 入口下的合作、玩伴、相亲、招聘、创投和旅友关系空间，身份、能力、资源、简介、对话与 Intent 相互隔离；
- 用户资料、六组 avatar、上传头像、认证与行动信誉展示；
- 举报、证据、申诉、风险限制、临时 / 永久封禁和管理员处理；
- 桌面侧栏、移动端底部导航和本地状态持久化；
- 通过 OpenAI Compatible Provider 接入阶跃星辰模型；
- 活动签到表 Excel 本地导入、需求/资源候选筛选、Agent 优先级判断和可交互合作对接图；
- 对接图支持关系筛选、节点与连线解释、现场第一句话、引荐标记和完整姓名展示；
- SQLite 持久化用户、关系空间画像、已确认授权意图、Agent 幂等建局记录、局、报名、局内群聊、反馈、信任治理、内测码、模型平台和脱敏 Agent 日志；
- 独立管理员后台，支持阶跃星辰、OpenAI、DeepSeek、通义千问、Moonshot、智谱及自定义 OpenAI-Compatible 平台；
- API Key 使用 AES-256-GCM 加密保存，后台只显示掩码并支持默认平台即时切换；
- 模型未配置或异常时的本地演示降级。

## 本地启动

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 进入攒攒产品 Landing Page，点击主按钮进入统一工作台：

- [http://localhost:3000/chat](http://localhost:3000/chat) — 和攒攒聊，并在同一输入框下选择功能；
- 旧 `/founder`、`/play`、`/love`、`/jobs`、`/capital` 链接会自动汇入 `/chat`。

管理员后台位于 [http://localhost:3000/admin](http://localhost:3000/admin)。未配置管理员环境变量时，本地开发默认账号会预填在登录页；生产环境不提供默认账号，必须设置 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD`。

## 阶跃星辰配置

在 `.env.local` 中配置：

```dotenv
STEP_API_KEY=你的阶跃星辰密钥
STEP_API_BASE_URL=https://api.stepfun.com/v1
STEP_MODEL=step-3.5-flash-2603
```

密钥只由 `/api/chat`、`/api/recommendations` 和 `/api/event-match` 的服务端 Route Handler 读取。不要添加 `NEXT_PUBLIC_` 前缀，不要提交 `.env.local`。修改环境变量后需要重启开发服务。`step-3.5-flash-2603` 使用低推理模式，避免活动现场的短任务消耗过多时间。

## 管理员后台与数据库

默认使用 Node.js 内置 SQLite，数据库文件位于 `.data/cuancuan.db`。后台包含：

- 数据概览；
- 多模型平台配置与默认平台切换；
- 现有阶跃星辰环境变量配置的一键加密迁入；
- 内测码创建、余量与停用；
- 活动报名、加入规则、发现范围、生命周期和外部群入口；
- 用户列表、认证状态、行动信誉、信用分与限制；
- 举报、证据、处理结论和申诉；
- 不含对话正文的 Agent 运行日志。

生产环境必须配置：

```dotenv
ADMIN_EMAIL=你的管理员邮箱
ADMIN_PASSWORD=至少12位独立强密码
APP_ENCRYPTION_KEY=32字节Base64密钥
DATABASE_PATH=/app/data/cuancuan.db
DEMO_VERIFY_CODE=六位体验验证码
```

生成加密主密钥：

```bash
openssl rand -base64 32
```

`APP_ENCRYPTION_KEY` 不可随意更换；更换后已保存的模型 API Key 将无法解密，需要重新录入。管理员会话保存在数据库并通过 HttpOnly、SameSite=Strict Cookie 传递，12 小时后失效。

界面输入区右下角会显示本轮使用的模式：

- `Agent · 阶跃星辰`：由 Vercel AI SDK Agent 编排，模型请求成功；
- `模型繁忙 · 本地完成`：有限重试后模型仍未响应，本轮已由本地逻辑完成。状态只显示在聊天输入区，不会在切换页面后弹出全局提示。

聊天请求期间可以正常切换“发现新局”或“我的局”。请求会在后台继续，返回聊天页后仍可看到结果；只有“新对话”和退出登录会主动取消尚未完成的请求。个人资料从左下角账号菜单进入。

当用户表达较短、主动希望获得选项，或少量结构化问题明显更省力时，Agent 可以调用 `ask_user_question`。表单答案会转换为用户可读的中文上下文继续发送给 Agent；用户刚提交表单后的下一轮不会连续再发表单。

## 现场攒攒 Demo

登录后进入“现场攒攒”，可导入当前 17 列活动签到表模板（单次 2–120 位嘉宾）。Excel 仅在浏览器内解析：页面展示嘉宾完整姓名，但发给模型的内容只有匿名 ID、角色、阶段、需求和可提供资源；姓名、微信、手机号、公司名与原始文件不会发送给模型或写入仓库。

服务端先用确定性规则筛出可解释候选，再由阶跃星辰 Agent 选择最高价值关系；关系理由和开场句只使用该对嘉宾的原始需求/资源确定性生成，防止跨候选串信息，最后再按覆盖率补齐现场引荐队列。100 人场次的关系预算会随人数增长，默认每位嘉宾最多进入 3 条关系；资料不足或没有真实候选的人会被明确保留为待补充，系统不会为了消除孤立节点硬凑关系。模型超时或输出异常时自动使用候选规则出图，不阻断现场使用。仓库内的演示名单全部为合成数据，真实签到表不属于项目文件。

## 验证

```bash
npm run lint
npm run build
npm run simulate:100
npm run simulate:global-agent:100
npm run test:agent-db
```

`simulate:100` 不读取或写入 SQLite，也不调用模型；它使用与 `/api/event-match` 相同的确定性候选和覆盖率选择逻辑，连续验收四组 100 人匿名样本：

- **供给均衡**：100 位资料完整、存在结构化互补关系的嘉宾必须全部进入关系图；
- **资料不足**：88 位可解释嘉宾进入关系图，12 位资料不足者明确保留为待补充；
- **完整但无对口**：10 位资料完整但本场没有真实对口的嘉宾不被硬配；
- **供给失衡**：97 位融资需求对 3 位投资人时，受每人最多 3 条关系保护，系统应诚实显示资源容量不足，而不是伪造 100% 覆盖。

部署后可在服务器本机额外运行一次真实接口验收：

```bash
npm run simulate:100:http
```

该命令只请求 `127.0.0.1:3000/api/event-match`，用内存中的匿名合成嘉宾检查线上接口的覆盖率、关系上限、单人连接上限和孤岛情况。它不创建用户、活动或签到数据，但会留下 1 条匿名 Agent 运行日志。若要确认本次确实调用了已配置模型、而不是本地规则降级，请运行：

```bash
REQUIRE_AGENT=1 EVENT_MATCH_FIXTURE=balanced npm run simulate:100:http
REQUIRE_AGENT=1 EVENT_MATCH_FIXTURE=mixed npm run simulate:100:http
REQUIRE_AGENT=1 EVENT_MATCH_FIXTURE=no-counterpart npm run simulate:100:http
REQUIRE_AGENT=1 EVENT_MATCH_FIXTURE=capacity npm run simulate:100:http
```

这里的 `balanced`、`mixed`、`no-counterpart` 和 `capacity` 分别对应上面的四种场景。脚本默认拒绝向公网发送模拟名单；若服务本机端口不是 3000，可用 `EVENT_MATCH_URL=http://127.0.0.1:<端口>/api/event-match` 覆盖。

`simulate-global-agent-100-users.mjs` 验证的是跨活动、跨时间的 Agent-first 工具闭环：合成用户确认意图后进入授权池；Agent 必须先搜索现有局和匿名意图；有合适局时推荐已有局，没有合适局时调用工具创建新局；后续用户可发现该局；未授权、过期、跨空间或资料不足的意图不会被误用。工程验收还会在隔离的 SQLite 数据库中直接校验意图保存、匿名候选读取、建局事务和幂等复用。

以上 100 人验证使用合成数据和受控的 Agent 工具模拟，SQLite 集成验证也只覆盖数据与事务边界。它们**不调用真实阶跃星辰模型，不是 100 个真实会话的并发压测，也不能证明线上模型在峰值流量下的延迟、成功率或成本**；正式扩量前仍需单独完成真实模型小流量端到端验收与并发压测。

## 腾讯云单机部署准备

当前 Demo 采用轻量的原生单机方案：Node.js 运行 Next.js，systemd 负责进程守护，Caddy 终止 HTTPS 并反向代理到仅监听本机的 3000 端口。SQLite 文件保存在 `/var/lib/cuancuan/cuancuan.db`，由定时任务生成一致性备份，不依赖 Docker。

生产环境变量保存在 `/etc/cuancuan/cuancuan.env`，至少配置管理员账号、独立强密码、`APP_ENCRYPTION_KEY`、数据库路径和体验验证码。服务器防火墙只对公网开放 80/443，SSH 端口应限制到可信来源；应用端口 3000 不对公网开放。

曾经出现在聊天、截图或终端记录中的模型 Key 应先在平台侧作废并重新生成，再通过 HTTPS 管理员后台录入。`APP_ENCRYPTION_KEY` 必须独立备份，丢失或更换后数据库中既有模型密钥将无法解密。

完整的无 Docker 安装、更新、备份、恢复和排查命令见 [`deploy/tencent-cloud/README.md`](deploy/tencent-cloud/README.md)。首次部署入口：

```bash
sudo bash deploy/tencent-cloud/install.sh
```

## 当前数据边界

账号核心资料、各关系空间画像、用户确认并授权匹配的 Intent、Agent 幂等建局记录、局、报名、生命周期、局内群聊、反馈、信任治理、内测码、管理员会话、模型平台配置和 Agent 运行日志已经进入 SQLite。对话消息与尚未确认的 Intent 草稿仍按关系空间保存在当前浏览器 LocalStorage；活动签到表及对接结果只存在当前页面内存，刷新后清空。

当前邮箱、手机号、工作 / 学校、主理人、实名和机构背书属于管理员人工核验标记，提醒为站内提醒。正式开放前还需要接入真实邮箱 / 手机 / 机构核验、对象存储头像、消息通知、接口频控、数据库备份、内容安全和严重事件处理 SLA。
