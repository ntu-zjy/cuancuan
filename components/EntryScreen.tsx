"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import type { Channel, Profile } from "@/lib/types";
import { SendIcon } from "./AppIcons";
import BrandMark from "./BrandMark";

type Props = { channel: Channel; onEnter: (profile: Profile) => void };

export default function EntryScreen({ channel, onEnter }: Props) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState("CUANCUAN2026");
  const [verifyCode, setVerifyCode] = useState("888888");
  const [registerStep, setRegisterStep] = useState<1 | 2>(1);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("请填写一个有效邮箱。 ");
    if (!/^\d{6}$/.test(verifyCode)) return setError("请填写 6 位邮箱验证码。 ");
    if (mode === "register" && registerStep === 1) {
      setRegisterStep(2);
      return;
    }
    if (mode === "register" && nickname.trim().length < 2) return setError("昵称至少需要两个字。 ");
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, email, nickname, inviteCode, verifyCode, channel }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "暂时无法进入攒攒。 ");
      onEnter(data.profile as Profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法进入攒攒。 ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="entry-shell">
      <header className="entry-nav" aria-label="品牌导航">
        <Link className="brand" href="/" aria-label="返回攒攒首页">
          <span className="brand-mark"><BrandMark priority /></span>
          <span>攒攒</span>
        </Link>
      </header>

      <section className="entry-hero" id="top">
        <div className="entry-panel-wrap reveal-panel">
          <div className="entry-panel">
            <div className="entry-auth-intro">
              <span className="entry-auth-mark"><BrandMark priority /></span>
              <h1>登录或加入</h1>
              <p>和攒攒开始一段对话</p>
            </div>

            <div className="auth-tabs" role="tablist" aria-label="账号方式">
              <button
                type="button"
                className={mode === "register" ? "active" : ""}
                onClick={() => { setMode("register"); setRegisterStep(1); setError(""); }}
                role="tab"
                aria-selected={mode === "register"}
              >
                加入内测
              </button>
              <button
                type="button"
                className={mode === "login" ? "active" : ""}
                onClick={() => { setMode("login"); setRegisterStep(1); setError(""); }}
                role="tab"
                aria-selected={mode === "login"}
              >
                已有账号
              </button>
            </div>

            <div className="panel-heading">
              <h2>
                {mode === "login"
                  ? "使用邮箱登录"
                  : registerStep === 1
                    ? "使用邮箱加入"
                    : "完成账号资料"}
              </h2>
              {mode === "register" && <p className="auth-progress">第 {registerStep} 步，共 2 步</p>}
            </div>

            <form onSubmit={submit} noValidate>
              {(mode === "login" || registerStep === 1) && (
                <>
                  <label>
                    <span>邮箱</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                    />
                  </label>
                  <label>
                    <span>邮箱验证码</span>
                    <div className="input-action-row">
                      <input
                        inputMode="numeric"
                        value={verifyCode}
                        onChange={(event) => setVerifyCode(event.target.value)}
                        maxLength={6}
                      />
                      <button type="button" onClick={() => setVerifyCode("888888")}>获取验证码</button>
                    </div>
                  </label>
                </>
              )}
              {mode === "register" && registerStep === 2 && (
                <>
                  <label>
                    <span>昵称</span>
                    <input
                      value={nickname}
                      onChange={(event) => setNickname(event.target.value)}
                      placeholder="大家怎么称呼你"
                      autoComplete="nickname"
                      autoFocus
                    />
                  </label>
                  <label>
                    <span>内测码</span>
                    <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} />
                  </label>
                  <button
                    className="auth-back"
                    type="button"
                    onClick={() => { setRegisterStep(1); setError(""); }}
                  >
                    返回修改邮箱
                  </button>
                </>
              )}
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="highlight-button auth-submit" type="submit" disabled={submitting}>
                {submitting
                  ? "正在验证"
                  : mode === "login"
                    ? "继续对话"
                    : registerStep === 1
                      ? "继续"
                      : "进入攒攒"}
                <SendIcon />
              </button>
            </form>
            <p className="demo-hint">
              {mode === "register" && registerStep === 2
                ? "内测期间仅用于控制体验名额。"
                : "体验环境已预填验证码。"}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
