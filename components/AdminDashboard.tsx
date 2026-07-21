"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MODEL_PROVIDER_PRESETS, type ModelProviderKind } from "@/lib/model-presets";
import type { Opportunity, OpportunityRegistrationStatus } from "@/lib/types";
import BrandMark from "./BrandMark";

type Section = "overview" | "providers" | "events" | "governance" | "invites" | "users" | "logs";

type Provider = {
  id: string;
  name: string;
  providerKind: ModelProviderKind;
  baseUrl: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  apiKeyMasked: string;
  hasApiKey: boolean;
  updatedAt: string;
};

type DashboardData = {
  overview: { users: number; activeInviteCodes: number; providers: number; agentRuns: number; pendingReports: number };
  providers: Provider[];
  inviteCodes: Array<{ code: string; maxUses: number; usedCount: number; enabled: boolean; createdAt: string }>;
  users: Array<{ id: string; email: string; nickname: string; role: string; progress: number; createdAt: string; lastSeenAt: string; restrictionStatus: "none" | "limited" | "temporary" | "permanent"; restrictionReason?: string; restrictedUntil?: string; emailVerified: boolean; phoneVerified: boolean; workVerified: boolean; hostVerified: boolean; realNameVerified: boolean; institutionVerified: boolean; creditScore: number; completedRooms: number; noShowCount: number; reportCount: number }>;
  logs: Array<{ id: string; requestType: string; providerName: string; model: string; status: string; durationMs: number; errorMessage?: string; createdAt: string }>;
  events: AdminEvent[];
  reports: Array<{ id: string; eventId?: string; eventTitle: string; category: string; details: string; evidenceUrl?: string; status: "submitted" | "reviewing" | "resolved" | "rejected"; createdAt: string; reporterName: string; reporterEmail: string; reportedUserName?: string }>;
  environmentFallback: boolean;
};

type AdminRegistration = {
  id: string;
  eventId: string;
  status: OpportunityRegistrationStatus;
  note: string;
  joinedAt: string;
  nickname: string;
  email: string;
};

type AdminEvent = Opportunity & {
  published: boolean;
  joinChannel?: Opportunity["joinChannel"] & { enabled: boolean };
  registrations: AdminRegistration[];
};

type EventChannelDraft = {
  eventId: string;
  eventTitle: string;
  type: "wecom" | "wechat" | "none";
  label: string;
  href: string;
  instructions: string;
  enabled: boolean;
};

type ProviderDraft = {
  id?: string;
  providerKind: ModelProviderKind;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
  setDefault: boolean;
};

const emptyProvider = (): ProviderDraft => {
  const preset = MODEL_PROVIDER_PRESETS[0];
  return {
    providerKind: preset.kind,
    name: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: "",
    enabled: true,
    setDefault: false,
  };
};

const sections: Array<{ id: Section; label: string; index: string }> = [
  { id: "overview", label: "数据概览", index: "01" },
  { id: "providers", label: "模型平台", index: "02" },
  { id: "events", label: "活动与报名", index: "03" },
  { id: "governance", label: "信任与治理", index: "04" },
  { id: "invites", label: "内测码", index: "05" },
  { id: "users", label: "用户", index: "06" },
  { id: "logs", label: "Agent 日志", index: "07" },
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function statusText(status: string) {
  if (status === "success") return "成功";
  if (status === "degraded") return "本地降级";
  if (status === "error") return "失败";
  return status;
}

function requestTypeText(type: string) {
  if (type === "chat") return "对话理解";
  if (type === "recommendation") return "个性化推荐";
  return "活动匹配";
}

export default function AdminDashboard({ adminEmail }: { adminEmail: string }) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("overview");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [providerDraft, setProviderDraft] = useState<ProviderDraft | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteLimit, setInviteLimit] = useState(50);
  const [eventChannelDraft, setEventChannelDraft] = useState<EventChannelDraft | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/dashboard", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "后台数据读取失败");
      setData(next);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "后台数据读取失败");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const task = window.setTimeout(() => { void loadData(); }, 0);
    return () => window.clearTimeout(task);
  }, [loadData]);

  const activeProvider = useMemo(
    () => data?.providers.find((provider) => provider.isDefault),
    [data],
  );

  async function adminAction(url: string, body: object) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "操作失败");
    return result;
  }

  function editProvider(provider: Provider) {
    setProviderDraft({
      id: provider.id,
      providerKind: provider.providerKind,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey: "",
      enabled: provider.enabled,
      setDefault: provider.isDefault,
    });
  }

  function choosePreset(kind: ModelProviderKind) {
    const preset = MODEL_PROVIDER_PRESETS.find((item) => item.kind === kind)!;
    setProviderDraft((current) => ({
      ...(current || emptyProvider()),
      providerKind: kind,
      name: current?.id ? current.name : preset.label,
      baseUrl: preset.baseUrl,
      model: preset.model,
    }));
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault();
    if (!providerDraft) return;
    setSavingProvider(true);
    setError("");
    try {
      await adminAction("/api/admin/providers", { action: "save", ...providerDraft });
      setProviderDraft(null);
      setNotice("模型平台配置已加密保存。 ");
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSavingProvider(false);
    }
  }

  async function setDefaultProvider(provider: Provider) {
    try {
      await adminAction("/api/admin/providers", { action: "set_default", id: provider.id });
      setNotice(`已切换到 ${provider.name}。`);
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "切换失败");
    }
  }

  async function removeProvider(provider: Provider) {
    if (!window.confirm(`确认删除“${provider.name}”？已保存的密钥也会一并删除。`)) return;
    try {
      await adminAction("/api/admin/providers", { action: "delete", id: provider.id });
      setNotice("模型平台已删除。 ");
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    }
  }

  async function importEnvironmentProvider() {
    try {
      await adminAction("/api/admin/providers", { action: "import_environment" });
      setNotice("环境变量中的阶跃星辰配置已加密迁入数据库，并设为默认平台。 ");
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入失败");
    }
  }

  async function createCode(event: FormEvent) {
    event.preventDefault();
    try {
      await adminAction("/api/admin/invite-codes", {
        action: "create", code: inviteCode, maxUses: inviteLimit,
      });
      setInviteCode("");
      setNotice("新内测码已创建。 ");
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    }
  }

  async function toggleCode(code: DashboardData["inviteCodes"][number]) {
    try {
      await adminAction("/api/admin/invite-codes", {
        action: "toggle", code: code.code, enabled: !code.enabled,
      });
      await loadData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "更新失败");
    }
  }

  function editEventChannel(event: AdminEvent) {
    setEventChannelDraft({
      eventId: event.id,
      eventTitle: event.title,
      type: event.joinChannel?.type || "wecom",
      label: event.joinChannel?.label || "加入活动沟通群",
      href: event.joinChannel?.href || "",
      instructions: event.joinChannel?.instructions || "报名确认后可加入活动群，具体见面信息以攒攒活动页为准。",
      enabled: Boolean(event.joinChannel?.enabled),
    });
  }

  async function saveEventChannel(event: FormEvent) {
    event.preventDefault();
    if (!eventChannelDraft) return;
    setSavingEvent(true);
    setError("");
    try {
      const result = await adminAction("/api/admin/events", { action: "save_channel", ...eventChannelDraft });
      setData((current) => current ? { ...current, events: result.events } : current);
      setEventChannelDraft(null);
      setNotice("活动群入口已更新，只有报名确认的用户能够看到。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "群入口保存失败");
    } finally {
      setSavingEvent(false);
    }
  }

  async function updateRegistration(eventId: string, registrationId: string, status: OpportunityRegistrationStatus) {
    try {
      const result = await adminAction("/api/admin/events", {
        action: "update_registration", eventId, registrationId, status,
      });
      setData((current) => current ? { ...current, events: result.events } : current);
      setNotice(status === "confirmed" ? "报名已确认。" : status === "waitlisted" ? "已转入候补。" : "已恢复为待确认。 ");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "报名状态更新失败");
    }
  }

  async function updateEventSettings(event: AdminEvent, patch: Partial<Pick<AdminEvent, "registrationMode" | "visibility" | "lifecycleStatus">>) {
    try {
      const result = await adminAction("/api/admin/events", {
        action: "save_settings",
        eventId: event.id,
        registrationMode: patch.registrationMode || event.registrationMode,
        visibility: patch.visibility || event.visibility || "public",
        lifecycleStatus: patch.lifecycleStatus || event.lifecycleStatus || "recruiting",
      });
      setData((current) => current ? { ...current, events: result.events } : current);
      setNotice("局的加入规则与行动状态已更新。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "局设置更新失败");
    }
  }

  async function updateReport(reportId: string, status: DashboardData["reports"][number]["status"]) {
    try {
      await adminAction("/api/admin/governance", { reportId, status });
      await loadData();
      setNotice("治理状态已更新；严重事件仍需人工复核证据后处置。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "治理状态更新失败");
    }
  }

  async function updateUserRestriction(user: DashboardData["users"][number], status: DashboardData["users"][number]["restrictionStatus"]) {
    const reason = status === "none" ? "" : window.prompt("请记录限制原因（会用于审计与申诉处理）：", user.restrictionReason || "")?.trim();
    if (status !== "none" && !reason) return;
    try {
      const result = await adminAction("/api/admin/users", { action: "restriction", userId: user.id, status, reason: reason || "" });
      setData((current) => current ? { ...current, users: result.users } : current);
      setNotice(status === "none" ? "用户限制已解除。" : "用户限制已生效并写入审计记录。");
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : "用户限制更新失败");
    }
  }

  async function updateUserVerification(
    user: DashboardData["users"][number],
    field: "phone" | "work" | "host" | "real_name" | "institution",
    verified: boolean,
  ) {
    try {
      const result = await adminAction("/api/admin/users", { action: "verification", userId: user.id, field, verified });
      setData((current) => current ? { ...current, users: result.users } : current);
      setNotice(verified ? "认证已确认。" : "认证标记已撤销。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "认证状态更新失败");
    }
  }

  async function logout() {
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/" className="admin-brand"><BrandMark priority /><strong>攒攒</strong><span>ADMIN</span></Link>
        <nav aria-label="后台导航">
          {sections.map((item) => (
            <button key={item.id} className={section === item.id ? "active" : ""} type="button" onClick={() => setSection(item.id)}>
              <small>{item.index}</small><span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="admin-account">
          <span>管理员</span><strong>{adminEmail}</strong>
          <button type="button" onClick={logout}>退出</button>
        </div>
      </aside>

      <section className="admin-workspace">
        <header className="admin-workspace-header">
          <div><p className="admin-kicker">OPERATIONS / {sections.find((item) => item.id === section)?.index}</p><h1>{sections.find((item) => item.id === section)?.label}</h1></div>
          <div className="admin-runtime"><i className={activeProvider ? "online" : ""} /><span>{activeProvider ? `${activeProvider.name} · ${activeProvider.model}` : data?.environmentFallback ? "使用环境变量中的阶跃星辰" : "当前使用本地降级"}</span></div>
        </header>

        {(notice || error) && (
          <div className={`admin-notice ${error ? "error" : ""}`} role="status">
            <span>{error || notice}</span><button type="button" onClick={() => { setNotice(""); setError(""); }}>关闭</button>
          </div>
        )}

        {loading && !data ? <div className="admin-loading">正在读取运营数据…</div> : null}

        {data && section === "overview" && (
          <section className="admin-section admin-overview">
            <div className="admin-metrics">
              <div><span>注册用户</span><strong>{data.overview.users}</strong><small>累计进入攒攒</small></div>
              <div><span>可用内测码</span><strong>{data.overview.activeInviteCodes}</strong><small>未停用且有余量</small></div>
              <div><span>模型平台</span><strong>{data.overview.providers}</strong><small>当前启用</small></div>
              <div><span>Agent 调用</span><strong>{data.overview.agentRuns}</strong><small>不含原始对话</small></div>
              <div><span>待处理举报</span><strong>{data.overview.pendingReports}</strong><small>需要人工治理</small></div>
            </div>
            <div className="admin-overview-grid">
              <div>
                <p className="admin-kicker">MODEL ROUTING</p>
                <h2>{activeProvider ? "生产请求已接入后台模型配置" : data.environmentFallback ? "仍在使用环境变量兜底" : "模型未配置，当前仅使用本地逻辑"}</h2>
                <p>数据库中的默认平台优先级高于环境变量。切换默认平台后，下一次 Agent 请求立即生效，无需重新构建。</p>
                <button type="button" className="admin-primary" onClick={() => setSection("providers")}>管理模型平台</button>
                {!activeProvider && data.environmentFallback && <button type="button" className="admin-secondary-action" onClick={importEnvironmentProvider}>安全迁入现有阶跃星辰配置</button>}
              </div>
              <div className="admin-recent">
                <div className="admin-section-heading"><div><span>最近运行</span><h3>Agent 状态</h3></div><button type="button" onClick={() => setSection("logs")}>查看全部</button></div>
                {data.logs.slice(0, 5).map((log) => (
                  <div className="admin-compact-row" key={log.id}>
                    <i className={log.status} /><strong>{requestTypeText(log.requestType)}</strong><span>{log.providerName}</span><small>{log.durationMs}ms</small>
                  </div>
                ))}
                {data.logs.length === 0 && <p className="admin-empty">还没有 Agent 调用记录。</p>}
              </div>
            </div>
          </section>
        )}

        {data && section === "providers" && (
          <section className="admin-section">
            <div className="admin-section-heading">
              <div><span>OpenAI-Compatible</span><h2>模型平台配置</h2><p>API Key 仅在服务端解密；修改时留空会保留原 Key。</p></div>
              <button className="admin-primary" type="button" onClick={() => setProviderDraft(emptyProvider())}>添加平台</button>
            </div>
            <div className="admin-table admin-provider-table">
              <div className="admin-table-head"><span>平台</span><span>模型与地址</span><span>密钥</span><span>状态</span><span>操作</span></div>
              {data.providers.map((provider) => (
                <div className="admin-table-row" key={provider.id}>
                  <div><strong>{provider.name}</strong><small>{provider.providerKind}</small></div>
                  <div><strong>{provider.model}</strong><small>{provider.baseUrl}</small></div>
                  <div><code>{provider.apiKeyMasked}</code></div>
                  <div><span className={`admin-status ${provider.isDefault ? "default" : provider.enabled ? "enabled" : "disabled"}`}>{provider.isDefault ? "默认" : provider.enabled ? "启用" : "停用"}</span></div>
                  <div className="admin-row-actions">
                    {!provider.isDefault && <button type="button" onClick={() => setDefaultProvider(provider)}>设为默认</button>}
                    <button type="button" onClick={() => editProvider(provider)}>编辑</button>
                    <button type="button" className="danger" onClick={() => removeProvider(provider)}>删除</button>
                  </div>
                </div>
              ))}
              {data.providers.length === 0 && <div className="admin-empty-row">还没有数据库模型配置；可添加阶跃星辰或其他兼容平台。</div>}
            </div>
            {data.environmentFallback && <p className="admin-footnote">环境变量中的阶跃星辰 Key 仍保留为故障兜底，不会在后台显示或回传。{!activeProvider && <button type="button" onClick={importEnvironmentProvider}>安全迁入数据库</button>}</p>}
          </section>
        )}

        {data && section === "events" && (
          <section className="admin-section admin-events-section">
            <div className="admin-section-heading">
              <div><span>EVENT OPERATIONS</span><h2>活动、报名与群入口</h2><p>攒攒保存报名状态、时间地点和通知；确认报名后再开放微信或企业微信群入口。</p></div>
            </div>
            <div className="admin-event-list">
              {data.events.map((event) => {
                const pending = event.registrations.filter((item) => item.status === "pending").length;
                const confirmed = event.registrations.filter((item) => item.status === "confirmed").length;
                const waitlisted = event.registrations.filter((item) => item.status === "waitlisted").length;
                return (
                  <article className="admin-event" key={event.id}>
                    <header>
                      <div><span>{formatTime(event.startsAt)} · {event.city}</span><h3>{event.title}</h3><p>{event.venue} · {event.members + confirmed} / {event.maxMembers} 人</p></div>
                      <div className="admin-event-summary"><span>待确认 <strong>{pending}</strong></span><span>已确认 <strong>{confirmed}</strong></span><span>候补 <strong>{waitlisted}</strong></span><button type="button" onClick={() => editEventChannel(event)}>{event.joinChannel?.enabled ? "编辑群入口" : "配置群入口"}</button></div>
                    </header>
                    <div className="admin-event-channel"><i className={event.joinChannel?.enabled ? "online" : ""} /><span>{event.joinChannel?.enabled ? `${event.joinChannel.label} · ${event.joinChannel.type === "wecom" ? "企业微信" : event.joinChannel.type === "wechat" ? "微信" : "无外部群"}` : "报名确认后暂不开放群入口"}</span></div>
                    <div className="admin-event-settings">
                      <label><span>加入方式</span><select value={event.registrationMode} onChange={(input) => updateEventSettings(event, { registrationMode: input.target.value as AdminEvent["registrationMode"] })}><option value="approval">需要审核</option><option value="instant">允许直接加入</option></select></label>
                      <label><span>发现范围</span><select value={event.visibility || "public"} onChange={(input) => updateEventSettings(event, { visibility: input.target.value as NonNullable<AdminEvent["visibility"]> })}><option value="public">公开可发现</option><option value="invite_only">仅受邀可见</option></select></label>
                      <label><span>行动状态</span><select value={event.lifecycleStatus || "recruiting"} onChange={(input) => updateEventSettings(event, { lifecycleStatus: input.target.value as NonNullable<AdminEvent["lifecycleStatus"]> })}><option value="recruiting">招募中</option><option value="pending_confirmation">待确认</option><option value="formed">已成立</option><option value="scheduled">已预约</option><option value="in_progress">进行中</option><option value="completed">已完成</option><option value="cancelled">已取消</option><option value="follow_up">后续连接</option></select></label>
                    </div>
                    {event.registrations.length > 0 ? (
                      <div className="admin-registration-list">
                        {event.registrations.map((registration) => (
                          <div key={registration.id}>
                            <p><strong>{registration.nickname}</strong><small>{registration.email}</small></p>
                            <p><span className={`admin-status ${registration.status === "confirmed" ? "success" : registration.status === "waitlisted" ? "disabled" : "degraded"}`}>{registration.status === "confirmed" ? "已确认" : registration.status === "waitlisted" ? "候补" : "待确认"}</span><small>{registration.note || "未填写报名说明"}</small></p>
                            <div className="admin-row-actions">
                              {registration.status !== "confirmed" && <button type="button" onClick={() => updateRegistration(event.id, registration.id, "confirmed")}>确认报名</button>}
                              {registration.status !== "waitlisted" && <button type="button" onClick={() => updateRegistration(event.id, registration.id, "waitlisted")}>转入候补</button>}
                              {registration.status !== "pending" && <button type="button" onClick={() => updateRegistration(event.id, registration.id, "pending")}>恢复待确认</button>}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : <p className="admin-empty">还没有用户报名。</p>}
                  </article>
                );
              })}
              {data.events.length === 0 && <div className="admin-empty-row">还没有活动。</div>}
            </div>
          </section>
        )}

        {data && section === "invites" && (
          <section className="admin-section">
            <div className="admin-section-heading"><div><span>ACCESS CONTROL</span><h2>内测码管理</h2><p>创建、停用并查看每个内测码的使用余量。</p></div></div>
            <form className="admin-inline-form" onSubmit={createCode}>
              <label><span>新内测码</span><input value={inviteCode} onChange={(event) => setInviteCode(event.target.value.toUpperCase())} placeholder="例如 CUANCUAN-HK" required /></label>
              <label><span>最大使用次数</span><input type="number" min="1" max="100000" value={inviteLimit} onChange={(event) => setInviteLimit(Number(event.target.value))} required /></label>
              <button className="admin-primary" type="submit">创建内测码</button>
            </form>
            <div className="admin-table invite-table">
              <div className="admin-table-head"><span>内测码</span><span>使用情况</span><span>创建时间</span><span>状态</span><span>操作</span></div>
              {data.inviteCodes.map((code) => (
                <div className="admin-table-row" key={code.code}>
                  <div><code>{code.code}</code></div>
                  <div><strong>{code.usedCount} / {code.maxUses}</strong><small>已使用 / 上限</small></div>
                  <div>{formatTime(code.createdAt)}</div>
                  <div><span className={`admin-status ${code.enabled ? "enabled" : "disabled"}`}>{code.enabled ? "可用" : "停用"}</span></div>
                  <div className="admin-row-actions"><button type="button" onClick={() => toggleCode(code)}>{code.enabled ? "停用" : "启用"}</button></div>
                </div>
              ))}
            </div>
          </section>
        )}

        {data && section === "governance" && (
          <section className="admin-section">
            <div className="admin-section-heading"><div><span>TRUST &amp; SAFETY</span><h2>举报、证据与人工处理</h2><p>原始对话不进入后台。这里只处理用户主动提交的事件说明与证据链接。</p></div></div>
            <div className="admin-governance-list">
              {data.reports.map((report) => (
                <article key={report.id}>
                  <header><div><span>{formatTime(report.createdAt)} · {report.category}</span><h3>{report.eventTitle}</h3><p>提交人：{report.reporterName} · {report.reporterEmail}{report.reportedUserName ? ` · 涉及成员：${report.reportedUserName}` : ""}</p></div><span className={`admin-status ${report.status === "resolved" ? "success" : report.status === "reviewing" ? "degraded" : report.status === "rejected" ? "disabled" : "default"}`}>{report.status === "submitted" ? "待处理" : report.status === "reviewing" ? "核查中" : report.status === "resolved" ? "已处理" : "不成立"}</span></header>
                  <p>{report.details}</p>
                  {report.evidenceUrl && <a href={report.evidenceUrl} target="_blank" rel="noreferrer">查看用户提交的证据 ↗</a>}
                  <div className="admin-row-actions">
                    {report.status !== "reviewing" && <button type="button" onClick={() => updateReport(report.id, "reviewing")}>开始核查</button>}
                    {report.status !== "resolved" && <button type="button" onClick={() => updateReport(report.id, "resolved")}>标记已处理</button>}
                    {report.status !== "rejected" && <button type="button" onClick={() => updateReport(report.id, "rejected")}>判定不成立</button>}
                  </div>
                </article>
              ))}
              {data.reports.length === 0 && <div className="admin-empty-row">当前没有待处理的举报。</div>}
            </div>
          </section>
        )}

        {data && section === "users" && (
          <section className="admin-section">
            <div className="admin-section-heading"><div><span>REGISTERED USERS</span><h2>用户列表</h2><p>只展示账号与产品进度，不展示用户原始对话。</p></div></div>
            <div className="admin-table user-table">
              <div className="admin-table-head"><span>用户</span><span>信誉状态</span><span>理解进度</span><span>注册时间</span><span>操作</span></div>
              {data.users.map((user) => (
                <div className="admin-table-row" key={user.id}>
                  <div><strong>{user.nickname}</strong><small>{user.email}</small></div>
                  <div className="admin-user-trust"><span className={`admin-status ${user.restrictionStatus === "none" ? "success" : user.restrictionStatus === "permanent" ? "disabled" : "degraded"}`}>{user.restrictionStatus === "none" ? `信用 ${user.creditScore}` : user.restrictionStatus === "limited" ? "功能受限" : user.restrictionStatus === "temporary" ? "临时封禁" : "永久封禁"}</span><small>完成 {user.completedRooms} · 爽约 {user.noShowCount} · 成立举报 {user.reportCount}</small><div className="admin-verification-row"><span className="verified">邮箱</span><button type="button" aria-pressed={user.phoneVerified} className={user.phoneVerified ? "verified" : ""} onClick={() => updateUserVerification(user, "phone", !user.phoneVerified)}>手机</button><button type="button" aria-pressed={user.workVerified} className={user.workVerified ? "verified" : ""} onClick={() => updateUserVerification(user, "work", !user.workVerified)}>工作 / 学校</button><button type="button" aria-pressed={user.hostVerified} className={user.hostVerified ? "verified" : ""} onClick={() => updateUserVerification(user, "host", !user.hostVerified)}>主理人</button><button type="button" aria-pressed={user.realNameVerified} className={user.realNameVerified ? "verified" : ""} onClick={() => updateUserVerification(user, "real_name", !user.realNameVerified)}>实名</button><button type="button" aria-pressed={user.institutionVerified} className={user.institutionVerified ? "verified" : ""} onClick={() => updateUserVerification(user, "institution", !user.institutionVerified)}>机构背书</button></div></div>
                  <div><strong>{user.progress} / 5</strong></div>
                  <div>{formatTime(user.createdAt)}</div>
                  <div className="admin-row-actions"><button type="button" onClick={() => updateUserRestriction(user, "limited")}>限制</button><button type="button" onClick={() => updateUserRestriction(user, "temporary")}>封禁 7 天</button><button type="button" className="danger" onClick={() => updateUserRestriction(user, "permanent")}>永久封禁</button>{user.restrictionStatus !== "none" && <button type="button" onClick={() => updateUserRestriction(user, "none")}>解除</button>}</div>
                </div>
              ))}
              {data.users.length === 0 && <div className="admin-empty-row">还没有注册用户。</div>}
            </div>
          </section>
        )}

        {data && section === "logs" && (
          <section className="admin-section">
            <div className="admin-section-heading"><div><span>SERVER-SIDE ONLY</span><h2>Agent 日志</h2><p>记录平台、模型、耗时和状态；不记录提示词、对话正文或活动名单。</p></div></div>
            <div className="admin-table log-table">
              <div className="admin-table-head"><span>请求</span><span>模型平台</span><span>结果</span><span>耗时</span><span>时间</span></div>
              {data.logs.map((log) => (
                <div className="admin-table-row" key={log.id}>
                  <div><strong>{requestTypeText(log.requestType)}</strong>{log.errorMessage && <small title={log.errorMessage}>{log.errorMessage}</small>}</div>
                  <div><strong>{log.providerName}</strong><small>{log.model}</small></div>
                  <div><span className={`admin-status ${log.status}`}>{statusText(log.status)}</span></div>
                  <div>{log.durationMs} ms</div>
                  <div>{formatTime(log.createdAt)}</div>
                </div>
              ))}
              {data.logs.length === 0 && <div className="admin-empty-row">还没有 Agent 调用记录。</div>}
            </div>
          </section>
        )}
      </section>

      {providerDraft && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProviderDraft(null); }}>
          <section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="provider-dialog-title">
            <div className="admin-dialog-head"><div><p className="admin-kicker">MODEL PROVIDER</p><h2 id="provider-dialog-title">{providerDraft.id ? "编辑模型平台" : "添加模型平台"}</h2></div><button type="button" aria-label="关闭" onClick={() => setProviderDraft(null)}>×</button></div>
            <form onSubmit={saveProvider}>
              <label><span>平台预设</span><select value={providerDraft.providerKind} onChange={(event) => choosePreset(event.target.value as ModelProviderKind)}>{MODEL_PROVIDER_PRESETS.map((preset) => <option key={preset.kind} value={preset.kind}>{preset.label}</option>)}</select></label>
              <label><span>显示名称</span><input value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })} required /></label>
              <label><span>Base URL</span><input type="url" value={providerDraft.baseUrl} onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })} required /></label>
              <label><span>模型 ID</span><input value={providerDraft.model} onChange={(event) => setProviderDraft({ ...providerDraft, model: event.target.value })} required /></label>
              <label><span>API Key</span><input type="password" autoComplete="new-password" value={providerDraft.apiKey} onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })} placeholder={providerDraft.id ? "留空以保留已保存的 Key" : "只会加密存储在服务端"} required={!providerDraft.id} /></label>
              <div className="admin-dialog-switches">
                <label><input type="checkbox" checked={providerDraft.enabled} onChange={(event) => setProviderDraft({ ...providerDraft, enabled: event.target.checked })} /><span>启用此平台</span></label>
                <label><input type="checkbox" checked={providerDraft.setDefault} onChange={(event) => setProviderDraft({ ...providerDraft, setDefault: event.target.checked })} /><span>设为默认平台</span></label>
              </div>
              <p>保存后 Key 不会再次以明文返回浏览器。更换加密主密钥前需要重新录入所有平台 Key。</p>
              <div className="admin-dialog-actions"><button type="button" onClick={() => setProviderDraft(null)}>取消</button><button className="admin-primary" type="submit" disabled={savingProvider}>{savingProvider ? "正在加密保存" : "保存配置"}</button></div>
            </form>
          </section>
        </div>
      )}

      {eventChannelDraft && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEventChannelDraft(null); }}>
          <section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="event-channel-title">
            <div className="admin-dialog-head"><div><p className="admin-kicker">POST-REGISTRATION</p><h2 id="event-channel-title">配置活动群入口</h2><small>{eventChannelDraft.eventTitle}</small></div><button type="button" aria-label="关闭" onClick={() => setEventChannelDraft(null)}>×</button></div>
            <form onSubmit={saveEventChannel}>
              <label><span>沟通方式</span><select value={eventChannelDraft.type} onChange={(event) => setEventChannelDraft({ ...eventChannelDraft, type: event.target.value as EventChannelDraft["type"] })}><option value="wecom">企业微信群</option><option value="wechat">微信群 / 微信联系人</option><option value="none">暂不提供外部群</option></select></label>
              <label><span>入口名称</span><input value={eventChannelDraft.label} onChange={(event) => setEventChannelDraft({ ...eventChannelDraft, label: event.target.value })} required minLength={2} maxLength={80} /></label>
              <label><span>群入口链接</span><input type="url" value={eventChannelDraft.href} onChange={(event) => setEventChannelDraft({ ...eventChannelDraft, href: event.target.value })} placeholder="企业微信入群链接或活动方承接页（可稍后补充）" /></label>
              <label><span>加入说明</span><textarea rows={4} value={eventChannelDraft.instructions} onChange={(event) => setEventChannelDraft({ ...eventChannelDraft, instructions: event.target.value })} maxLength={500} /></label>
              <div className="admin-dialog-switches"><label><input type="checkbox" checked={eventChannelDraft.enabled} onChange={(event) => setEventChannelDraft({ ...eventChannelDraft, enabled: event.target.checked })} /><span>对已确认报名者开放</span></label></div>
              <p>群入口不会展示给未报名、待确认或候补用户。活动通知与报名状态仍以攒攒为准，群聊只承接现场沟通。</p>
              <div className="admin-dialog-actions"><button type="button" onClick={() => setEventChannelDraft(null)}>取消</button><button className="admin-primary" type="submit" disabled={savingEvent}>{savingEvent ? "正在保存" : "保存群入口"}</button></div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
