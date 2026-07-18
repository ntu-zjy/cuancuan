# 攒攒 Demo

一个按照 PRD V1.3 实现的响应式网页 Demo：用户通过自然对话表达关系需求，攒攒整理当前意图，用户确认后再查看、加入或创建合适的局。

## 已实现

- 邀请制注册 / 登录演示（内测码 `CUANCUAN2026`，验证码 `888888`）；
- 基于 Vercel AI SDK `ToolLoopAgent` 的开放式多轮对话、理解进度和 Intent 草稿；
- `ask_user_question` 工具及网页表单渲染，支持单选、多选、简答、“其他”和提交后回显；
- Intent 修改、确认、暂停 / 恢复和重新聊；
- 工作与关系两类开放局、筛选、详情、适配说明；
- 加入、退出、创建新局和“我的局”；
- 长期资料查看与编辑；
- 桌面侧栏、移动端底部导航和本地状态持久化；
- 通过 OpenAI Compatible Provider 接入阶跃星辰模型；
- 模型未配置或异常时的本地演示降级。

## 本地启动

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 阶跃星辰配置

在 `.env.local` 中配置：

```dotenv
STEP_API_KEY=你的阶跃星辰密钥
STEP_API_BASE_URL=https://api.stepfun.com/v1
STEP_MODEL=step-3.5-flash
```

密钥只由 `app/api/chat/route.ts` 在服务端读取。不要添加 `NEXT_PUBLIC_` 前缀，不要提交 `.env.local`。修改环境变量后需要重启开发服务。

界面输入区右下角会显示本轮使用的模式：

- `Agent · 阶跃星辰`：由 Vercel AI SDK Agent 编排，模型请求成功；
- `模型繁忙 · 本地完成`：有限重试后模型仍未响应，本轮已由本地逻辑完成。状态只显示在聊天输入区，不会在切换页面后弹出全局提示。

聊天请求期间可以正常切换“发现新局”“我的局”或“我的”。请求会在后台继续，返回聊天页后仍可看到结果；只有“重新聊”和退出登录会主动取消尚未完成的请求。

当用户表达较短、主动希望获得选项，或少量结构化问题明显更省力时，Agent 可以调用 `ask_user_question`。表单答案会转换为用户可读的中文上下文继续发送给 Agent；用户刚提交表单后的下一轮不会连续再发表单。

## 验证

```bash
npm run lint
npm run build
```

## 当前数据边界

为了快速验证产品闭环，账号资料、对话、Intent 和参与状态暂存在浏览器 LocalStorage。模型密钥不会进入 LocalStorage。生产版本仍需按 PRD 接入服务端会话、D1 数据库、真实邮箱验证码、频控与审计日志。
