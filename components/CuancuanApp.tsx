"use client";

import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import AskUserQuestionCard from "./AskUserQuestionCard";
import EntryScreen from "./EntryScreen";
import OpportunityCard from "./OpportunityCard";
import { opportunities as seedOpportunities } from "@/lib/data";
import type { AgentQuestionForm, ChatMessage, Intent, Opportunity, Profile, QuestionAnswers } from "@/lib/types";

type Page = "chat" | "discover" | "rooms" | "profile";
type Provider = "waiting" | "stepfun" | "local";

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "你好，我是攒攒。你现在想认识怎样的人，或者希望遇到一个怎样的机会？可以从任何地方说起。",
  },
];

const sceneStarters = [
  { label: "合作", text: "我想找一位可以一起做事的伙伴。现在的情况是……" },
  { label: "招聘", text: "我正在找一位关键成员，希望对方……我们目前……" },
  { label: "关系", text: "我想认真认识一个人。比起条件清单，我更在意……" },
];

const pageTitles: Record<Page, { eyebrow: string; title: string }> = {
  chat: { eyebrow: "01 / CONVERSATION", title: "和攒攒聊" },
  discover: { eyebrow: "02 / OPEN ROOMS", title: "发现新局" },
  rooms: { eyebrow: "03 / YOUR ROOMS", title: "我的局" },
  profile: { eyebrow: "04 / PROFILE", title: "我的资料" },
};

const STORAGE_KEY = "cuancuan-demo-state";
const LEGACY_STORAGE_KEY = "zanzan-demo-state";

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function CuancuanApp() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [page, setPage] = useState<Page>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [progress, setProgress] = useState(0);
  const [draftIntent, setDraftIntent] = useState<Intent | null>(null);
  const [activeIntent, setActiveIntent] = useState<Intent | null>(null);
  const [recommendationsShown, setRecommendationsShown] = useState(false);
  const [joinedIds, setJoinedIds] = useState<string[]>([]);
  const [hostIds, setHostIds] = useState<string[]>([]);
  const [customOpportunities, setCustomOpportunities] = useState<Opportunity[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [provider, setProvider] = useState<Provider>("waiting");
  const [notice, setNotice] = useState("");
  const [sceneMenuOpen, setSceneMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [discoverFilter, setDiscoverFilter] = useState("all");
  const [roomsFilter, setRoomsFilter] = useState("all");
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState<Profile | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sceneMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const chatRequestRef = useRef<AbortController | null>(null);

  const allOpportunities = useMemo(
    () => [...customOpportunities, ...seedOpportunities],
    [customOpportunities],
  );

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
        || window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        setProfile(state.profile ?? null);
        setMessages(state.messages?.length ? state.messages : initialMessages);
        setProgress(state.progress ?? 0);
        setDraftIntent(state.draftIntent ?? null);
        setActiveIntent(state.activeIntent ?? null);
        setRecommendationsShown(Boolean(state.recommendationsShown));
        setJoinedIds(state.joinedIds ?? []);
        setHostIds(state.hostIds ?? []);
        setCustomOpportunities(state.customOpportunities ?? []);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready || !profile) return;
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profile,
        messages,
        progress,
        draftIntent,
        activeIntent,
        recommendationsShown,
        joinedIds,
        hostIds,
        customOpportunities,
      }),
    );
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [ready, profile, messages, progress, draftIntent, activeIntent, recommendationsShown, joinedIds, hostIds, customOpportunities]);

  useEffect(() => {
    function handlePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (sceneMenuRef.current && !sceneMenuRef.current.contains(target)) setSceneMenuOpen(false);
      if (accountMenuRef.current && !accountMenuRef.current.contains(target)) setAccountMenuOpen(false);
    }
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setSceneMenuOpen(false);
        setAccountMenuOpen(false);
        setSelectedOpportunity(null);
      }
    }
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  useEffect(() => {
    if (page === "chat") chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, draftIntent, recommendationsShown, sending, page]);

  const recommended = useMemo(() => {
    if (!activeIntent) return [];
    return allOpportunities.filter((item) => item.scene === activeIntent.scene).slice(0, 2);
  }, [activeIntent, allOpportunities]);

  const discoverItems = useMemo(() => {
    return allOpportunities.filter((item) => {
      if (discoverFilter === "startup") return item.scene === "startup";
      if (discoverFilter === "love") return item.scene === "love";
      if (discoverFilter === "group") return item.maxMembers > 2;
      if (discoverFilter === "almost") return item.maxMembers - item.members <= 2;
      return true;
    });
  }, [allOpportunities, discoverFilter]);

  const myRooms = useMemo(() => {
    return allOpportunities.filter((item) => {
      if (!joinedIds.includes(item.id)) return false;
      const members = item.members + 1;
      if (roomsFilter === "host") return hostIds.includes(item.id);
      if (roomsFilter === "waiting") return members < item.minMembers;
      if (roomsFilter === "formed") return members >= item.minMembers;
      return true;
    });
  }, [allOpportunities, hostIds, joinedIds, roomsFilter]);

  function enter(profileValue: Profile) {
    setProfile(profileValue);
    setProfileDraft(profileValue);
  }

  function logout() {
    chatRequestRef.current?.abort();
    chatRequestRef.current = null;
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    setProfile(null);
    setPage("chat");
    setMessages(initialMessages);
    setProgress(0);
    setDraftIntent(null);
    setActiveIntent(null);
    setRecommendationsShown(false);
    setSending(false);
    setJoinedIds([]);
    setHostIds([]);
    setCustomOpportunities([]);
  }

  function chooseStarter(text: string) {
    setPage("chat");
    setComposer(text);
    setSceneMenuOpen(false);
    window.setTimeout(() => textareaRef.current?.focus(), 50);
  }

  async function sendContent(rawContent: string, baseMessages: ChatMessage[] = messages) {
    const content = rawContent.trim();
    if (!content || sending) return;
    const userMessage: ChatMessage = { id: uid(), role: "user", content };
    const nextMessages = [...baseMessages, userMessage];
    const controller = new AbortController();
    chatRequestRef.current = controller;
    setMessages(nextMessages);
    setComposer("");
    setSending(true);
    setProvider("waiting");
    setNotice("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "发送失败");
      if (chatRequestRef.current !== controller) return;
      setMessages((current) => [
        ...current,
        {
          id: uid(),
          role: "assistant",
          content: data.reply,
          questionForm: data.questionForm || undefined,
        },
      ]);
      setProgress(data.progress ?? progress);
      setProvider(data.provider === "stepfun" ? "stepfun" : "local");
      if (data.intentDraft) {
        setDraftIntent({ ...data.intentDraft, status: "draft" });
        setRecommendationsShown(false);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setMessages((current) => [
        ...current,
        {
          id: uid(),
          role: "assistant",
          content: error instanceof Error ? `这条消息没有送达：${error.message}。你的输入还在，可以稍后重试。` : "这条消息没有送达，请稍后重试。",
        },
      ]);
    } finally {
      if (chatRequestRef.current === controller) {
        chatRequestRef.current = null;
        setSending(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
    }
  }

  function sendMessage(event?: FormEvent) {
    event?.preventDefault();
    void sendContent(composer);
  }

  function submitQuestionForm(messageId: string, form: AgentQuestionForm, answers: QuestionAnswers) {
    if (sending || form.status === "submitted") return;
    const submittedMessages: ChatMessage[] = messages.map((message) => message.id === messageId
      ? { ...message, questionForm: { ...form, status: "submitted", answers } }
      : message);
    setMessages(submittedMessages);

    const labels = new Map(form.questions.map((question) => [question.id, question.label]));
    const answerText = Object.entries(answers)
      .map(([id, value]) => `- ${labels.get(id) || id}：${Array.isArray(value) ? value.join("、") : value}`)
      .join("\n");
    void sendContent(`我通过快速表单补充了：\n${answerText}`, submittedMessages);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  function confirmIntent() {
    if (!draftIntent) return;
    setActiveIntent({ ...draftIntent, status: "active" });
    setDraftIntent(null);
    setProgress(5);
    setRecommendationsShown(true);
    setMessages((current) => [
      ...current,
      {
        id: uid(),
        role: "assistant",
        content: "方向已经确认。我先从当前开放的局里选了两组相容的机会。推荐只是判断线索，加入仍由你决定。",
      },
    ]);
  }

  function requestIntentEdit() {
    setComposer("这版意图里，我想补充或修改的是：");
    window.setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function restartConversation() {
    if (!window.confirm("重新聊会清空当前对话和意图，但保留你已经加入或创建的局。要继续吗？")) return;
    chatRequestRef.current?.abort();
    chatRequestRef.current = null;
    setMessages(initialMessages);
    setProgress(0);
    setDraftIntent(null);
    setActiveIntent(null);
    setRecommendationsShown(false);
    setSending(false);
    setProvider("waiting");
    setNotice("已经重新开始。你加入和创建的局都还在。 ");
    setPage("chat");
  }

  function toggleJoin(opportunity: Opportunity) {
    const joined = joinedIds.includes(opportunity.id);
    if (!joined && opportunity.members >= opportunity.maxMembers) return;
    setJoinedIds((current) => joined ? current.filter((id) => id !== opportunity.id) : [...current, opportunity.id]);
    setNotice(joined ? `已退出「${opportunity.title}」。` : `已加入「${opportunity.title}」，可以在“我的局”里继续查看。`);
  }

  function createOpportunity() {
    if (!activeIntent || !profile) return;
    const existing = customOpportunities.find((item) => item.id === `created-${activeIntent.scene}`);
    if (existing) {
      setSelectedOpportunity(existing);
      return;
    }
    const opportunity: Opportunity = {
      id: `created-${activeIntent.scene}`,
      scene: activeIntent.scene,
      type: activeIntent.scene === "startup" ? "发起试合作" : "发起认识",
      title: activeIntent.title,
      summary: activeIntent.summary,
      description: `${activeIntent.target}。${activeIntent.context || ""} ${activeIntent.constraints || ""}`.trim(),
      tags: activeIntent.scene === "startup" ? ["新发起", "试合作", "开放加入"] : ["新发起", "认真认识", "开放加入"],
      members: 0,
      minMembers: 2,
      maxMembers: activeIntent.scene === "startup" ? 4 : 2,
      deadline: "2026.10.18",
      reason: "这个局直接来自你刚刚确认的意图，参与者会先看到经过整理的摘要和边界。",
      observation: "这是一个新局，目标表达已经清楚，仍需要等待第一位合适的人加入。",
      people: [
        {
          name: profile.nickname,
          summary: profile.bio || profile.identity || "发起人正在逐步补充自己的长期资料。",
          offer: activeIntent.offer,
        },
      ],
    };
    setCustomOpportunities((current) => [opportunity, ...current]);
    setJoinedIds((current) => [...current, opportunity.id]);
    setHostIds((current) => [...current, opportunity.id]);
    setNotice("新局已经创建，你是发起人和第一位成员。 ");
    setSelectedOpportunity(opportunity);
  }

  function askFit(opportunity: Opportunity) {
    setMessages((current) => [
      ...current,
      { id: uid(), role: "user", content: `这个局「${opportunity.title}」适合我吗？` },
      {
        id: uid(),
        role: "assistant",
        content: `${opportunity.reason} 目前仍需要你确认：${opportunity.observation} 我建议先看清投入方式，再决定是否加入。`,
      },
    ]);
    setSelectedOpportunity(null);
    setPage("chat");
  }

  function startProfileEdit() {
    if (!profile) return;
    setProfileDraft({ ...profile });
    setEditingProfile(true);
  }

  function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profileDraft) return;
    setProfile(profileDraft);
    setEditingProfile(false);
    setNotice("资料已保存，后续对话会结合这些长期信息。 ");
  }

  function toggleMatching() {
    if (!activeIntent) return;
    const next = activeIntent.status === "paused" ? "active" : "paused";
    setActiveIntent({ ...activeIntent, status: next });
    setNotice(next === "paused" ? "匹配已暂停，已有的局不受影响。 " : "匹配已恢复。 ");
  }

  if (!ready) {
    return <div className="boot-screen"><span className="brand-mark">攒</span></div>;
  }

  if (!profile) return <EntryScreen onEnter={enter} />;

  const statusLabel = activeIntent?.status === "paused"
    ? "已暂停"
    : draftIntent
      ? "待确认"
      : activeIntent
        ? "匹配中"
        : sending
          ? "正在理解"
          : "可以开始";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top" ref={sceneMenuRef}>
          <button
            className="brand brand-button"
            type="button"
            onClick={() => setSceneMenuOpen((open) => !open)}
            aria-expanded={sceneMenuOpen}
            aria-haspopup="menu"
          >
            <span className="brand-mark">攒</span>
            <span>攒攒</span>
            <span className="menu-caret" aria-hidden="true">⌄</span>
          </button>
          {sceneMenuOpen && (
            <div className="popover scene-popover" role="menu">
              <p>你想认识什么人？</p>
              {sceneStarters.map((starter) => (
                <button key={starter.label} role="menuitem" type="button" onClick={() => chooseStarter(starter.text)}>
                  <span>{starter.label}</span><small>带入一段可编辑的开场</small>
                </button>
              ))}
              <button role="menuitem" type="button" onClick={restartConversation}>
                <span>重新聊</span><small>保留已经加入的局</small>
              </button>
            </div>
          )}
        </div>

        <nav className="side-nav" aria-label="主要导航">
          {([
            ["chat", "01", "和攒攒聊"],
            ["discover", "02", "发现新局"],
            ["rooms", "03", "我的局"],
            ["profile", "04", "我的"],
          ] as Array<[Page, string, string]>).map(([value, number, label]) => (
            <button
              key={value}
              type="button"
              className={page === value ? "active" : ""}
              onClick={() => setPage(value)}
              aria-current={page === value ? "page" : undefined}
            >
              <span>{number}</span>{label}
              {value === "rooms" && joinedIds.length > 0 && <b>{joinedIds.length}</b>}
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className={`status-dot ${activeIntent?.status === "paused" ? "paused" : ""}`} />
          <div><small>当前状态</small><strong>{statusLabel}</strong></div>
        </div>

        <div className="account-wrap" ref={accountMenuRef}>
          {accountMenuOpen && (
            <div className="popover account-popover" role="menu">
              <button role="menuitem" type="button" onClick={() => { setPage("profile"); setAccountMenuOpen(false); }}>我的资料</button>
              <button role="menuitem" type="button" onClick={() => { setPage("chat"); setAccountMenuOpen(false); }}>回到对话</button>
              <button role="menuitem" type="button" className="danger-text" onClick={logout}>退出登录</button>
            </div>
          )}
          <button
            type="button"
            className="account-button"
            onClick={() => setAccountMenuOpen((open) => !open)}
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
          >
            <span>{profile.nickname.slice(0, 1)}</span>
            <div><strong>{profile.nickname}</strong><small>{profile.email}</small></div>
            <i aria-hidden="true">⌃</i>
          </button>
        </div>
      </aside>

      <main className={`app-main page-${page}`}>
        <header className="mobile-header">
          <button className="brand brand-button" type="button" onClick={() => setSceneMenuOpen((open) => !open)}>
            <span className="brand-mark">攒</span><span>攒攒</span>
          </button>
          <span className="mobile-status">{statusLabel}</span>
          {sceneMenuOpen && (
            <div className="popover mobile-scene-popover">
              {sceneStarters.map((starter) => (
                <button key={starter.label} type="button" onClick={() => chooseStarter(starter.text)}>{starter.label}<small>带入开场</small></button>
              ))}
              <button type="button" onClick={restartConversation}>重新聊<small>保留已加入的局</small></button>
            </div>
          )}
        </header>

        {notice && (
          <div className="notice-bar" role="status">
            <span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="关闭提示">×</button>
          </div>
        )}

        {page === "chat" && (
          <section className="chat-page">
            <header className="workspace-header">
              <div>
                <p className="eyebrow">{pageTitles.chat.eyebrow}</p>
                <h1>{pageTitles.chat.title}</h1>
              </div>
              <div className="understanding-status">
                <div className="progress-dots" aria-label={`理解进度 ${progress}/5`}>
                  {[1, 2, 3, 4, 5].map((value) => <span key={value} className={value <= progress ? "filled" : ""} />)}
                </div>
                <span>{statusLabel}</span>
                <button type="button" onClick={restartConversation}>重新聊</button>
              </div>
            </header>

            <div className="chat-scroll" aria-live="polite">
              <div className="conversation">
                {messages.map((message) => (
                  <div key={message.id} className={`message ${message.role}`}>
                    {message.role === "assistant" && <span className="agent-stamp">攒</span>}
                    <div>
                      <span className="message-author">{message.role === "assistant" ? "攒攒" : "你"}</span>
                      <p>{message.content}</p>
                      {message.questionForm && (
                        <AskUserQuestionCard
                          form={message.questionForm}
                          disabled={sending}
                          onSubmit={(answers) => submitQuestionForm(message.id, message.questionForm!, answers)}
                        />
                      )}
                    </div>
                  </div>
                ))}

                {sending && (
                  <div className="message assistant thinking">
                    <span className="agent-stamp">攒</span>
                    <div><span className="message-author">攒攒</span><p>正在结合前面的对话理解<span className="thinking-dots">...</span></p></div>
                  </div>
                )}

                {draftIntent && (
                  <article className="intent-card">
                    <div className="intent-card-head">
                      <span>CURRENT INTENT / 当前意图</span>
                      <span className="status-pill waiting">待你确认</span>
                    </div>
                    <h2>{draftIntent.title}</h2>
                    <p className="intent-summary">{draftIntent.summary}</p>
                    <dl className="intent-grid">
                      <div><dt>想找到</dt><dd>{draftIntent.target}</dd></div>
                      {draftIntent.context && <div><dt>当前处境</dt><dd>{draftIntent.context}</dd></div>}
                      <div><dt>可以带来</dt><dd>{draftIntent.offer}</dd></div>
                      {draftIntent.commitment && <div><dt>怎么开始</dt><dd>{draftIntent.commitment}</dd></div>}
                      {draftIntent.constraints && <div><dt>边界</dt><dd>{draftIntent.constraints}</dd></div>}
                      <div><dt>有效期</dt><dd>{draftIntent.validity}</dd></div>
                    </dl>
                    <div className="intent-actions">
                      <button type="button" className="secondary-button" onClick={requestIntentEdit}>继续聊聊修改</button>
                      <button type="button" className="highlight-button" onClick={confirmIntent}>方向没问题，开始匹配</button>
                    </div>
                  </article>
                )}

                {activeIntent && recommendationsShown && (
                  <section className="recommendations">
                    <div className="section-heading-row">
                      <div><p className="eyebrow">MATCHES / 先看这两个</p><h2>和你的方向相容</h2></div>
                      <span>不是评分，是判断线索</span>
                    </div>
                    <div className="recommendation-list">
                      {recommended.map((opportunity) => (
                        <OpportunityCard
                          key={opportunity.id}
                          opportunity={opportunity}
                          joined={joinedIds.includes(opportunity.id)}
                          onView={() => setSelectedOpportunity(opportunity)}
                          onToggleJoin={() => toggleJoin(opportunity)}
                        />
                      ))}
                    </div>
                    <button type="button" className="create-room-button" onClick={createOpportunity}>
                      <span>没有合适的？</span><strong>按当前意图发起一个新局 →</strong>
                    </button>
                  </section>
                )}
                <div ref={chatEndRef} />
              </div>
            </div>

            <form className="composer" onSubmit={sendMessage}>
              <label htmlFor="chat-input" className="sr-only">给攒攒发送消息</label>
              <textarea
                ref={textareaRef}
                id="chat-input"
                rows={1}
                value={composer}
                onChange={(event) => {
                  setComposer(event.target.value);
                  event.target.style.height = "auto";
                  event.target.style.height = `${Math.min(event.target.scrollHeight, 144)}px`;
                }}
                onKeyDown={onComposerKeyDown}
                placeholder="说说你现在想认识什么人……"
                disabled={sending}
              />
              <button type="submit" disabled={!composer.trim() || sending} aria-label="发送消息">
                <span>{sending ? "理解中" : "发送"}</span><i aria-hidden="true">→</i>
              </button>
              <small>Enter 发送 · Shift + Enter 换行</small>
              <span
                className={`provider-state ${provider}`}
                title={provider === "stepfun"
                  ? "由 Vercel AI SDK Agent 编排，底层模型为阶跃星辰。"
                  : provider === "local"
                    ? "模型服务本轮未能响应，已由本地逻辑完成，不影响切换页面或继续操作。"
                    : undefined}
              >
                {provider === "stepfun" ? "Agent · 阶跃星辰" : provider === "local" ? "模型繁忙 · 本地完成" : sending ? "Agent 正在理解" : "等待对话"}
              </span>
            </form>
          </section>
        )}

        {page === "discover" && (
          <section className="content-page">
            <header className="content-header">
              <div><p className="eyebrow">{pageTitles.discover.eyebrow}</p><h1>{pageTitles.discover.title}</h1></div>
              <p>当前有 <strong>{allOpportunities.length}</strong> 个开放局。先看目标和参与方式，再决定要不要靠近。</p>
            </header>
            <div className="filter-row" role="tablist" aria-label="筛选开放局">
              {[
                ["all", "全部"], ["startup", "工作与共创"], ["love", "关系与交友"], ["group", "多人局"], ["almost", "即将满员"],
              ].map(([value, label]) => (
                <button key={value} type="button" className={discoverFilter === value ? "active" : ""} onClick={() => setDiscoverFilter(value)} role="tab" aria-selected={discoverFilter === value}>{label}</button>
              ))}
            </div>
            <div className="opportunity-grid">
              {discoverItems.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={opportunity}
                  joined={joinedIds.includes(opportunity.id)}
                  compact
                  onView={() => setSelectedOpportunity(opportunity)}
                  onToggleJoin={() => toggleJoin(opportunity)}
                />
              ))}
            </div>
          </section>
        )}

        {page === "rooms" && (
          <section className="content-page">
            <header className="content-header">
              <div><p className="eyebrow">{pageTitles.rooms.eyebrow}</p><h1>{pageTitles.rooms.title}</h1></div>
              <p>你创建或主动加入的局都在这里。退出不会删除这个局。</p>
            </header>
            <div className="filter-row" role="tablist" aria-label="筛选我的局">
              {[["all", "全部"], ["host", "我创建的"], ["waiting", "等待成立"], ["formed", "已成立"]].map(([value, label]) => (
                <button key={value} type="button" className={roomsFilter === value ? "active" : ""} onClick={() => setRoomsFilter(value)} role="tab" aria-selected={roomsFilter === value}>{label}</button>
              ))}
            </div>
            {myRooms.length > 0 ? (
              <div className="opportunity-grid">
                {myRooms.map((opportunity) => (
                  <OpportunityCard
                    key={opportunity.id}
                    opportunity={opportunity}
                    joined
                    compact
                    onView={() => setSelectedOpportunity(opportunity)}
                    onToggleJoin={() => toggleJoin(opportunity)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span>还没有符合这一状态的局</span>
                <h2>先看看谁正在等一个合适的人。</h2>
                <button type="button" className="primary-button" onClick={() => setPage("discover")}>去发现新局</button>
              </div>
            )}
          </section>
        )}

        {page === "profile" && (
          <section className="content-page profile-page">
            <header className="content-header">
              <div><p className="eyebrow">{pageTitles.profile.eyebrow}</p><h1>{pageTitles.profile.title}</h1></div>
              <p>长期资料和当前意图是两件事。你可以随时校正，攒攒不会展示原始对话。</p>
            </header>
            <div className="profile-layout">
              <section className="profile-section">
                <div className="section-heading-row">
                  <div><p className="eyebrow">LONG-TERM PROFILE</p><h2>长期资料</h2></div>
                  {!editingProfile && <button type="button" className="text-button" onClick={startProfileEdit}>编辑资料</button>}
                </div>
                {editingProfile && profileDraft ? (
                  <form className="profile-form" onSubmit={saveProfile}>
                    {([
                      ["city", "所在城市", "例如：上海"],
                      ["identity", "当前身份", "例如：独立产品设计师"],
                      ["skills", "能力或兴趣", "你擅长什么、关心什么"],
                      ["offer", "通常可以提供", "你能为一段关系带来什么"],
                      ["bio", "一句话介绍", "让别人快速理解你"],
                    ] as Array<[keyof Profile, string, string]>).map(([key, label, placeholder]) => (
                      <label key={key}><span>{label}</span><input value={profileDraft[key]} placeholder={placeholder} onChange={(event) => setProfileDraft({ ...profileDraft, [key]: event.target.value })} /></label>
                    ))}
                    <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditingProfile(false)}>取消</button><button className="primary-button" type="submit">保存资料</button></div>
                  </form>
                ) : (
                  <dl className="profile-list">
                    <div><dt>昵称</dt><dd>{profile.nickname}</dd></div>
                    <div><dt>所在城市</dt><dd>{profile.city || "还没有告诉攒攒"}</dd></div>
                    <div><dt>当前身份</dt><dd>{profile.identity || "还没有告诉攒攒"}</dd></div>
                    <div><dt>能力或兴趣</dt><dd>{profile.skills || "还没有告诉攒攒"}</dd></div>
                    <div><dt>通常可以提供</dt><dd>{profile.offer || "还没有告诉攒攒"}</dd></div>
                    <div><dt>一句话介绍</dt><dd>{profile.bio || "还没有告诉攒攒"}</dd></div>
                  </dl>
                )}
              </section>

              <section className="profile-section intent-profile-section">
                <div className="section-heading-row">
                  <div><p className="eyebrow">CURRENT INTENT</p><h2>当前意图</h2></div>
                  {activeIntent && <span className={`status-pill ${activeIntent.status === "paused" ? "paused" : "active"}`}>{activeIntent.status === "paused" ? "已暂停" : "匹配中"}</span>}
                </div>
                {activeIntent ? (
                  <>
                    <h3>{activeIntent.title}</h3>
                    <p className="intent-summary">{activeIntent.summary}</p>
                    <dl className="profile-list compact-list">
                      <div><dt>想找到</dt><dd>{activeIntent.target}</dd></div>
                      <div><dt>可以带来</dt><dd>{activeIntent.offer}</dd></div>
                      <div><dt>有效期</dt><dd>{activeIntent.validity}</dd></div>
                    </dl>
                    <button type="button" className={activeIntent.status === "paused" ? "primary-button" : "secondary-button"} onClick={toggleMatching}>{activeIntent.status === "paused" ? "恢复匹配" : "暂停匹配"}</button>
                  </>
                ) : draftIntent ? (
                  <div className="intent-empty"><p>有一版意图正等你确认。</p><button type="button" className="primary-button" onClick={() => setPage("chat")}>回到对话确认</button></div>
                ) : (
                  <div className="intent-empty"><p>你还没有确认当前意图。先说说这段时间想认识谁。</p><button type="button" className="primary-button" onClick={() => setPage("chat")}>开始和攒攒聊</button></div>
                )}
              </section>
            </div>
          </section>
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主要导航">
        {([[
          "chat", "01", "对话"], ["discover", "02", "发现"], ["rooms", "03", "我的局"], ["profile", "04", "我的"],
        ] as Array<[Page, string, string]>).map(([value, number, label]) => (
          <button key={value} type="button" className={page === value ? "active" : ""} onClick={() => setPage(value)}><span>{number}</span>{label}</button>
        ))}
      </nav>

      {selectedOpportunity && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOpportunity(null); }}>
          <section className="detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <button type="button" className="modal-close" onClick={() => setSelectedOpportunity(null)} aria-label="关闭详情">×</button>
            <div className="detail-kicker"><span>{selectedOpportunity.type}</span><span>{selectedOpportunity.scene === "startup" ? "工作与共创" : "关系与交友"}</span></div>
            <h2 id="detail-title">{selectedOpportunity.title}</h2>
            <p className="detail-description">{selectedOpportunity.description}</p>
            <div className="detail-stats">
              <div><span>当前人数</span><strong>{selectedOpportunity.members + (joinedIds.includes(selectedOpportunity.id) ? 1 : 0)} / {selectedOpportunity.maxMembers}</strong></div>
              <div><span>最低成局</span><strong>{selectedOpportunity.minMembers} 人</strong></div>
              <div><span>开放至</span><strong>{selectedOpportunity.deadline}</strong></div>
            </div>
            <div className="agent-observation"><span>攒攒的群体观察</span><p>{selectedOpportunity.observation}</p></div>
            <div className="member-section">
              <div className="section-heading-row"><h3>已经在局里的人</h3><span>仅展示经过整理的摘要</span></div>
              <div className="member-list">
                {selectedOpportunity.people.map((person) => (
                  <article key={`${selectedOpportunity.id}-${person.name}`}><span className="member-initial">{person.name.slice(0, 1)}</span><div><h4>{person.name}</h4><p>{person.summary}</p><small>可以带来：{person.offer}</small></div></article>
                ))}
              </div>
            </div>
            <div className="privacy-note">邮箱、电话和原始对话不会在加入前展示。加入仍需双方尊重边界。</div>
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => askFit(selectedOpportunity)}>问攒攒是否适合</button>
              <button type="button" className={joinedIds.includes(selectedOpportunity.id) ? "secondary-button" : "highlight-button"} onClick={() => toggleJoin(selectedOpportunity)} disabled={!joinedIds.includes(selectedOpportunity.id) && selectedOpportunity.members >= selectedOpportunity.maxMembers}>
                {joinedIds.includes(selectedOpportunity.id) ? "已加入 · 退出" : selectedOpportunity.members >= selectedOpportunity.maxMembers ? "人数已满" : "加入这个局"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
