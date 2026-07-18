"use client";

import { FormEvent, useState } from "react";
import type { Profile } from "@/lib/types";

type Props = { onEnter: (profile: Profile) => void };

export default function EntryScreen({ onEnter }: Props) {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [nickname, setNickname] = useState("");
  const [inviteCode, setInviteCode] = useState("CUANCUAN2026");
  const [verifyCode, setVerifyCode] = useState("888888");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("请填写一个有效邮箱。 ");
    if (verifyCode !== "888888") return setError("验证码不正确，Demo 验证码是 888888。 ");
    if (mode === "register" && inviteCode !== "CUANCUAN2026") return setError("内测码无效或已失效。 ");
    if (mode === "register" && nickname.trim().length < 2) return setError("昵称至少需要两个字。 ");
    onEnter({
      nickname: nickname.trim() || email.split("@")[0],
      email,
      city: "",
      identity: "",
      skills: "",
      offer: "",
      bio: "",
    });
  }

  return (
    <main className="entry-shell">
      <header className="entry-nav" aria-label="品牌导航">
        <a className="brand" href="#top" aria-label="攒攒首页">
          <span className="brand-mark">攒</span>
          <span>攒攒</span>
        </a>
        <span className="entry-edition">INVITE DEMO · 2026</span>
      </header>

      <section className="entry-hero" id="top">
        <div className="entry-copy">
          <p className="eyebrow reveal-one">任何关系需求，都从一句真话开始</p>
          <h1 className="reveal-two">
            你想找的人，
            <span className="marker">先说给攒攒听。</span>
          </h1>
          <p className="entry-lead reveal-three">
            合作、招聘、加入团队，或认真认识一个人。你不必先选频道，也不用填一份很长的问卷。
          </p>

          <div className="scene-lines reveal-three" aria-label="支持的三种典型场景">
            <div><span>01 / 合作</span><p>找一位能把想法一起做出来的人</p></div>
            <div><span>02 / 招聘</span><p>遇见真正理解现阶段的关键伙伴</p></div>
            <div><span>03 / 关系</span><p>从真实生活里，认真认识彼此</p></div>
          </div>
        </div>

        <div className="entry-panel-wrap reveal-panel">
          <div className="paper-note" aria-hidden="true">
            <span>攒攒正在听</span>
            <p>“我不急着找一个标准答案，更想先遇见方向和节奏都对的人。”</p>
          </div>
          <div className="entry-panel">
            <div className="auth-tabs" role="tablist" aria-label="账号方式">
              <button
                type="button"
                className={mode === "register" ? "active" : ""}
                onClick={() => { setMode("register"); setError(""); }}
                role="tab"
                aria-selected={mode === "register"}
              >
                加入内测
              </button>
              <button
                type="button"
                className={mode === "login" ? "active" : ""}
                onClick={() => { setMode("login"); setError(""); }}
                role="tab"
                aria-selected={mode === "login"}
              >
                已有账号
              </button>
            </div>

            <div className="panel-heading">
              <p className="eyebrow">{mode === "register" ? "START A CONVERSATION" : "WELCOME BACK"}</p>
              <h2>{mode === "register" ? "先从认识你开始。" : "继续上次的对话。"}</h2>
            </div>

            <form onSubmit={submit} noValidate>
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
              {mode === "register" && (
                <>
                  <label>
                    <span>怎么称呼你</span>
                    <input
                      value={nickname}
                      onChange={(event) => setNickname(event.target.value)}
                      placeholder="一个自然的昵称"
                      autoComplete="nickname"
                    />
                  </label>
                  <label>
                    <span>内测码</span>
                    <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} />
                  </label>
                </>
              )}
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
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="highlight-button auth-submit" type="submit">
                {mode === "register" ? "进入攒攒" : "继续对话"}
                <span aria-hidden="true">→</span>
              </button>
            </form>
            <p className="demo-hint">Demo 已预填体验内测码与验证码；模型密钥只保留在服务端。</p>
          </div>
        </div>
      </section>

      <footer className="entry-footer">
        <span>先聊，再匹配。</span>
        <span>不替你做决定，也不展示原始对话。</span>
      </footer>
    </main>
  );
}
