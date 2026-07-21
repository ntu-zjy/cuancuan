"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BrandMark from "./BrandMark";

export default function AdminLogin({ localHint }: {
  localHint: { email: string; password: string } | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState(localHint?.email || "");
  const [password, setPassword] = useState(localHint?.password || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "登录失败");
      router.replace("/admin");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-login-shell">
      <Link className="admin-login-brand" href="/" aria-label="返回攒攒">
        <BrandMark priority />
        <span>攒攒</span>
      </Link>
      <section className="admin-login-panel">
        <p className="admin-kicker">CUANCUAN OPERATIONS</p>
        <h1>管理员登录</h1>
        <p>模型密钥、用户和运行日志只对管理员开放。</p>
        <form onSubmit={submit}>
          <label>
            <span>管理员邮箱</span>
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            <span>密码</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          {error && <p className="admin-form-error" role="alert">{error}</p>}
          <button type="submit" disabled={loading}>{loading ? "正在验证" : "进入后台"}</button>
        </form>
        {localHint && <small>本地开发账号已预填；生产环境必须通过环境变量设置独立密码。</small>}
      </section>
      <footer><span>密钥加密存储</span><span>会话 12 小时后失效</span></footer>
    </main>
  );
}
