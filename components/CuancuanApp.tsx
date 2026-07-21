"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import AskUserQuestionCard from "./AskUserQuestionCard";
import EntryScreen from "./EntryScreen";
import EventMatchPage from "./EventMatchPage";
import OpportunityCard from "./OpportunityCard";
import RoomListItem from "./RoomListItem";
import BrandMark from "./BrandMark";
import {
  CapitalIcon,
  TravelIcon,
  ChatIcon,
  ChevronDownIcon,
  DiscoverIcon,
  JobIcon,
  LoveIcon,
  NetworkIcon,
  NewChatIcon,
  PartnerIcon,
  PlayIcon,
  RoomsIcon,
  SendIcon,
} from "./AppIcons";
import { opportunities as seedOpportunities } from "@/lib/data";
import { CHANNEL_LIST, CHANNELS, DEFAULT_CHANNEL, resolveOpportunityChannel } from "@/lib/channels";
import type {
  AgentQuestionForm,
  Channel,
  ChatMessage,
  Intent,
  Opportunity,
  OpportunityRegistration,
  OpportunityRegistrationStatus,
  OpportunityWithRegistration,
  Profile,
  QuestionAnswers,
  RoomFeedback,
  RoomLifecycleStatus,
  RoomState,
  RoomWorkspace,
  TrustSummary,
} from "@/lib/types";

type Page = "chat" | "discover" | "event" | "rooms" | "profile";
type SpaceSession = {
  messages: ChatMessage[];
  progress: number;
  draftIntent: Intent | null;
  activeIntent: Intent | null;
  recommendationsShown: boolean;
  personalizedRecommendations: Opportunity[];
};

function createInitialMessages(channel: Channel): ChatMessage[] {
  return [{ id: "welcome", role: "assistant", content: CHANNELS[channel].welcome }];
}

const pageTitles: Record<Page, { eyebrow: string; title: string }> = {
  chat: { eyebrow: "AI 社交助理", title: "和攒攒聊" },
  discover: { eyebrow: "为你开放的连接", title: "发现新局" },
  event: { eyebrow: "现场关系网络", title: "现场攒攒" },
  rooms: { eyebrow: "持续中的关系", title: "我的局" },
  profile: { eyebrow: "你的长期信息", title: "我的资料" },
};

const DISCOVER_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function localDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function discoverDateChoices() {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return {
      key: localDateKey(date),
      label: index === 0 ? "今天" : DISCOVER_WEEKDAYS[date.getDay()],
      day: String(date.getDate()).padStart(2, "0"),
    };
  });
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

function formatChatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

function dateTimeLocalValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function dateTimeLocalIso(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

function registrationLabel(status?: OpportunityRegistrationStatus) {
  if (status === "confirmed") return "报名已确认";
  if (status === "pending") return "等待发起人确认";
  if (status === "waitlisted") return "当前在候补名单";
  return "";
}

function priceLabel(opportunity: Opportunity) {
  if (opportunity.price.type === "free") return opportunity.price.note || "免费";
  if (opportunity.price.type === "aa") return opportunity.price.note || "现场 AA";
  return opportunity.price.amount ? `¥${opportunity.price.amount}${opportunity.price.note ? ` · ${opportunity.price.note}` : ""}` : opportunity.price.note || "费用待确认";
}

const STORAGE_KEY_PREFIX = "cuancuan-demo-state";
const LEGACY_STORAGE_KEY = "zanzan-demo-state";
const DEFAULT_AVATAR = "/avatars/avatar-01.png";
const AVATAR_CHOICES = Array.from({ length: 6 }, (_, index) => `/avatars/avatar-0${index + 1}.png`);
const UNIFIED_MODE_LABELS: Record<Channel, string> = {
  founder: "找合作伙伴",
  play: "找玩伴",
  love: "认真相亲",
  jobs: "招聘求职",
  capital: "找创投",
  travel: "找旅友",
};
const HEADLINE_ROOM_LABELS: Record<Channel, string> = {
  founder: "合作局",
  play: "玩伴局",
  love: "相亲局",
  jobs: "招聘局",
  capital: "创投局",
  travel: "旅友局",
};
const ROOM_LIFECYCLE: Array<{ value: RoomLifecycleStatus; label: string }> = [
  { value: "recruiting", label: "招募中" },
  { value: "pending_confirmation", label: "待确认" },
  { value: "formed", label: "已成立" },
  { value: "scheduled", label: "已预约" },
  { value: "in_progress", label: "进行中" },
  { value: "completed", label: "已完成" },
  { value: "follow_up", label: "后续连接" },
];

function lifecycleLabel(status?: RoomLifecycleStatus) {
  if (status === "cancelled") return "已取消";
  return ROOM_LIFECYCLE.find((item) => item.value === status)?.label || "招募中";
}
const CAPABILITY_ICONS = {
  founder: PartnerIcon,
  play: PlayIcon,
  love: LoveIcon,
  jobs: JobIcon,
  capital: CapitalIcon,
  travel: TravelIcon,
} satisfies Record<Channel, typeof PartnerIcon>;

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeProfile(input: Partial<Profile>): Profile {
  const legacyAvatar = input.avatar?.match(/^\/avatars\/line-avatar-(0[1-6])\.png$/);
  const legacyTrust = input.trust as Partial<TrustSummary> | undefined;
  const trust = input.trust
    ? ({
        emailVerified: false,
        phoneVerified: false,
        workVerified: false,
        hostVerified: false,
        realNameVerified: false,
        institutionVerified: false,
        creditScore: 80,
        completedRooms: 0,
        noShowCount: 0,
        reportCount: 0,
        ...legacyTrust,
      } satisfies TrustSummary)
    : undefined;
  return {
    nickname: input.nickname || "攒攒用户",
    email: input.email || "",
    avatar: legacyAvatar ? `/avatars/avatar-${legacyAvatar[1]}.png` : input.avatar || DEFAULT_AVATAR,
    city: input.city || "",
    identity: input.identity || "",
    skills: input.skills || "",
    offer: input.offer || "",
    bio: input.bio || "",
    wechat: input.wechat || "",
    trust,
  };
}

function resizeAvatar(file: File) {
  return new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new window.Image();
    image.onload = () => {
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("浏览器暂时无法处理这张图片。"));
        return;
      }
      context.fillStyle = "#f7f6f2";
      context.fillRect(0, 0, 512, 512);
      context.drawImage(
        image,
        (image.naturalWidth - size) / 2,
        (image.naturalHeight - size) / 2,
        size,
        size,
        0,
        0,
        512,
        512,
      );
      URL.revokeObjectURL(objectUrl);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("没有读懂这张图片，请换一张试试。"));
    };
    image.src = objectUrl;
  });
}

export default function CuancuanApp({ initialChannel = DEFAULT_CHANNEL }: { initialChannel?: Channel }) {
  const [activeChannel, setActiveChannel] = useState<Channel>(initialChannel);
  const channelConfig = CHANNELS[activeChannel];
  const storageKey = `${STORAGE_KEY_PREFIX}-unified`;
  const discoverFilterOptions = [
    ["all", "全部"],
    ["founder", "合作"],
    ["play", "玩伴"],
    ["love", "相亲"],
    ["jobs", "招聘"],
    ["capital", "创投"],
    ["travel", "旅行"],
  ];
  const pageNav = [
    ["chat", "和攒攒聊", ChatIcon],
    ["discover", "发现新局", DiscoverIcon],
    ["event", "现场攒攒", NetworkIcon],
    ["rooms", "我的局", RoomsIcon],
  ] as const;
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [page, setPage] = useState<Page>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>(() => createInitialMessages(initialChannel));
  const [progress, setProgress] = useState(0);
  const [draftIntent, setDraftIntent] = useState<Intent | null>(null);
  const [activeIntent, setActiveIntent] = useState<Intent | null>(null);
  const [recommendationsShown, setRecommendationsShown] = useState(false);
  const [personalizedRecommendations, setPersonalizedRecommendations] = useState<Opportunity[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [spaceSessions, setSpaceSessions] = useState<Partial<Record<Channel, SpaceSession>>>({});
  const [joinedIds, setJoinedIds] = useState<string[]>([]);
  const [hostIds, setHostIds] = useState<string[]>([]);
  const [remoteOpportunities, setRemoteOpportunities] = useState<Opportunity[]>([]);
  const [registrations, setRegistrations] = useState<Record<string, OpportunityRegistration>>({});
  const [customOpportunities, setCustomOpportunities] = useState<Opportunity[]>([]);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null);
  const [discoverFilter, setDiscoverFilter] = useState<string>(initialChannel);
  const [discoverDate, setDiscoverDate] = useState("all");
  const [discoverCity, setDiscoverCity] = useState("all");
  const [discoverSort, setDiscoverSort] = useState("recommended");
  const [registrationNote, setRegistrationNote] = useState("");
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [roomsFilter, setRoomsFilter] = useState("all");
  const [profileDraft, setProfileDraft] = useState<Profile | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [roomWorkspace, setRoomWorkspace] = useState<RoomWorkspace | null>(null);
  const [roomWorkspaceLoading, setRoomWorkspaceLoading] = useState(false);
  const [roomMessageDraft, setRoomMessageDraft] = useState("");
  const [roomChatOpen, setRoomChatOpen] = useState(false);
  const [roomActionBusy, setRoomActionBusy] = useState(false);
  const [createdRoomResult, setCreatedRoomResult] = useState<Opportunity | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [roomPlanDraft, setRoomPlanDraft] = useState<RoomState | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState<Omit<RoomFeedback, "eventId" | "createdAt">>({
    attended: true,
    outcome: "completed",
    continueInterest: "maybe",
    rating: 5,
    notes: "",
  });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const chatRequestRef = useRef<AbortController | null>(null);

  const allOpportunities = useMemo(() => {
    const persistedById = new Map(
      [...seedOpportunities, ...remoteOpportunities].map((item) => [item.id, item]),
    );
    return [...customOpportunities, ...persistedById.values()];
  }, [customOpportunities, remoteOpportunities]);

  const refreshEvents = useCallback(async () => {
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { events?: OpportunityWithRegistration[] };
      const incoming = Array.isArray(data.events) ? data.events : [];
      const nextRegistrations: Record<string, OpportunityRegistration> = {};
      const serverHostIds: string[] = [];
      const normalized = incoming.map((item) => {
        if (item.registration) nextRegistrations[item.id] = item.registration;
        if (item.isHost) serverHostIds.push(item.id);
        const { registration: _registration, isHost: _isHost, ...event } = item;
        void _registration;
        void _isHost;
        return event as Opportunity;
      });
      setRemoteOpportunities(normalized);
      setRegistrations(nextRegistrations);
      setJoinedIds((current) => Array.from(new Set([
        ...current.filter((id) => id.startsWith("created-")),
        ...Object.keys(nextRegistrations),
      ])));
      setHostIds((current) => Array.from(new Set([
        ...current.filter((id) => id.startsWith("created-")),
        ...serverHostIds,
      ])));
      setSelectedOpportunity((current) => {
        if (!current) return current;
        return normalized.find((item) => item.id === current.id) || current;
      });
    } catch {
      // Keep the bundled preview data available when the local API is restarting.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const state = JSON.parse(saved);
          if (state.profile) {
            const restored = normalizeProfile(state.profile);
            setProfile(restored);
            setProfileDraft(restored);
          }
          const restoredChannel = state.channel && CHANNELS[state.channel as Channel]
            ? state.channel as Channel
            : initialChannel;
          if (state.schemaVersion === 4 || state.schemaVersion === 5) {
            setActiveChannel(restoredChannel);
            setMessages(state.messages?.length ? state.messages : createInitialMessages(restoredChannel));
            setProgress(state.progress ?? 0);
            setDraftIntent(state.draftIntent ?? null);
            setActiveIntent(state.activeIntent ?? null);
            setRecommendationsShown(Boolean(state.recommendationsShown));
            setPersonalizedRecommendations(state.personalizedRecommendations ?? []);
            setSpaceSessions(state.spaceSessions ?? {});
            setJoinedIds(state.joinedIds ?? []);
            setHostIds(state.hostIds ?? []);
            setCustomOpportunities(state.customOpportunities ?? []);
          }
        }
      } catch {
        window.localStorage.removeItem(storageKey);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
      }

      try {
        const response = await fetch(`/api/profile?channel=${encodeURIComponent(initialChannel)}`, { cache: "no-store" });
        if (response.ok) {
          const data = await response.json() as { profile?: Profile };
          if (data.profile && !cancelled) {
            const serverProfile = normalizeProfile(data.profile);
            setProfile(serverProfile);
            setProfileDraft(serverProfile);
          }
        }
      } catch {
        // Local state remains available while the profile API is restarting.
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void hydrate();
    return () => { cancelled = true; };
  }, [initialChannel, storageKey]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function loadSpaceProfile() {
      try {
        const response = await fetch(`/api/profile?channel=${encodeURIComponent(activeChannel)}`, { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as { profile?: Profile };
        if (!cancelled && data.profile) {
          const nextProfile = normalizeProfile(data.profile);
          setProfile(nextProfile);
          setProfileDraft(nextProfile);
        }
      } catch {
        // Keep the current space profile while the API is restarting.
      }
    }
    void loadSpaceProfile();
    return () => { cancelled = true; };
  }, [activeChannel, ready]);

  useEffect(() => {
    setDiscoverFilter(activeChannel);
  }, [activeChannel]);

  useEffect(() => {
    if (ready && profile) void refreshEvents();
  }, [profile, ready, refreshEvents]);

  useEffect(() => {
    if (!ready || !profile) return;
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        schemaVersion: 5,
        channel: activeChannel,
        profile,
        messages,
        progress,
        draftIntent,
        activeIntent,
        recommendationsShown,
        personalizedRecommendations,
        spaceSessions,
        joinedIds,
        hostIds,
        customOpportunities,
      }),
    );
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [ready, profile, messages, progress, draftIntent, activeIntent, recommendationsShown, personalizedRecommendations, spaceSessions, joinedIds, hostIds, customOpportunities, activeChannel, storageKey]);

  useEffect(() => {
    if (!ready || !profile) return;
    setSpaceSessions((current) => ({
      ...current,
      [activeChannel]: { messages, progress, draftIntent, activeIntent, recommendationsShown, personalizedRecommendations },
    }));
  }, [activeChannel, activeIntent, draftIntent, messages, personalizedRecommendations, profile, progress, ready, recommendationsShown]);

  useEffect(() => {
    function handlePointer(event: PointerEvent) {
      const target = event.target as Node;
      if (accountMenuRef.current && !accountMenuRef.current.contains(target)) setAccountMenuOpen(false);
    }
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
        setRoomChatOpen(false);
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
    if (personalizedRecommendations.length > 0) return personalizedRecommendations;
    return allOpportunities
      .filter((item) => resolveOpportunityChannel(item) === (activeIntent.channel || activeChannel))
      .slice(0, 2);
  }, [activeChannel, activeIntent, allOpportunities, personalizedRecommendations]);

  const dateChoices = useMemo(() => discoverDateChoices(), []);
  const discoverCities = useMemo(
    () => Array.from(new Set(allOpportunities.map((item) => item.city).filter(Boolean))),
    [allOpportunities],
  );

  const discoverItems = useMemo(() => {
    const personalizedById = new Map(personalizedRecommendations.map((item) => [item.id, item]));
    const filtered = allOpportunities.map((item) => personalizedById.get(item.id) || item).filter((item) => {
      if (discoverDate !== "all" && localDateKey(item.startsAt) !== discoverDate) return false;
      if (discoverCity !== "all" && item.city !== discoverCity) return false;
      if (discoverFilter !== "all" && resolveOpportunityChannel(item) !== discoverFilter) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (discoverSort === "time") return Date.parse(a.startsAt) - Date.parse(b.startsAt);
      if (discoverSort === "distance") return (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
      const scoreDifference = (b.matchInsight?.score || 0) - (a.matchInsight?.score || 0);
      if (scoreDifference) return scoreDifference;
      const aJoined = registrations[a.id]?.status === "confirmed" ? 1 : 0;
      const bJoined = registrations[b.id]?.status === "confirmed" ? 1 : 0;
      return bJoined - aJoined || Date.parse(a.startsAt) - Date.parse(b.startsAt);
    });
  }, [allOpportunities, discoverCity, discoverDate, discoverFilter, discoverSort, personalizedRecommendations, registrations]);

  const joinedRooms = useMemo(
    () => allOpportunities.filter((item) => joinedIds.includes(item.id)),
    [allOpportunities, joinedIds],
  );

  const roomFilterCounts = useMemo(() => {
    const count = (predicate: (item: Opportunity) => boolean) => joinedRooms.filter(predicate).length;
    return {
      all: joinedRooms.length,
      host: count((item) => hostIds.includes(item.id)),
      recruiting: count((item) => {
        const lifecycle = item.lifecycleStatus || "recruiting";
        return lifecycle === "recruiting" || lifecycle === "pending_confirmation";
      }),
      active: count((item) => {
        const lifecycle = item.lifecycleStatus || "recruiting";
        return lifecycle === "formed" || lifecycle === "scheduled" || lifecycle === "in_progress";
      }),
      completed: count((item) => item.lifecycleStatus === "completed" || item.lifecycleStatus === "follow_up"),
    };
  }, [hostIds, joinedRooms]);

  const myRooms = useMemo(() => {
    return joinedRooms.filter((item) => {
      const lifecycle = item.lifecycleStatus || "recruiting";
      if (roomsFilter === "host") return hostIds.includes(item.id);
      if (roomsFilter === "recruiting") return lifecycle === "recruiting" || lifecycle === "pending_confirmation";
      if (roomsFilter === "active") return lifecycle === "formed" || lifecycle === "scheduled" || lifecycle === "in_progress";
      if (roomsFilter === "completed") return lifecycle === "completed" || lifecycle === "follow_up";
      return true;
    });
  }, [hostIds, joinedRooms, roomsFilter]);

  function enter(profileValue: Profile) {
    const normalized = normalizeProfile(profileValue);
    setProfile(normalized);
    setProfileDraft(normalized);
  }

  function logout() {
    void fetch("/api/auth/logout", { method: "POST" });
    chatRequestRef.current?.abort();
    chatRequestRef.current = null;
    window.localStorage.removeItem(storageKey);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    setAccountMenuOpen(false);
    setProfile(null);
    setProfileDraft(null);
    setProfileError("");
    setPage("chat");
    setMessages(createInitialMessages(activeChannel));
    setProgress(0);
    setDraftIntent(null);
    setActiveIntent(null);
    setRecommendationsShown(false);
    setPersonalizedRecommendations([]);
    setSending(false);
    setJoinedIds([]);
    setHostIds([]);
    setRegistrations({});
    setRemoteOpportunities([]);
    setCustomOpportunities([]);
  }

  function selectChannel(channel: Channel) {
    if (channel === activeChannel) {
      window.setTimeout(() => textareaRef.current?.focus(), 50);
      return;
    }
    chatRequestRef.current?.abort();
    chatRequestRef.current = null;
    const targetSession = spaceSessions[channel];
    setActiveChannel(channel);
    setMessages(targetSession?.messages?.length ? targetSession.messages : createInitialMessages(channel));
    setProgress(targetSession?.progress || 0);
    setDraftIntent(targetSession?.draftIntent || null);
    setActiveIntent(targetSession?.activeIntent || null);
    setRecommendationsShown(Boolean(targetSession?.recommendationsShown));
    setPersonalizedRecommendations(targetSession?.personalizedRecommendations || []);
    setComposer("");
    setNotice("");
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
    setNotice("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages, userEmail: profile?.email, channel: activeChannel }),
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
      if (data.intentDraft) {
        setDraftIntent({ ...data.intentDraft, status: "draft" });
        setRecommendationsShown(false);
        setPersonalizedRecommendations([]);
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

  async function loadRecommendations(intent: Intent) {
    setRecommendationsLoading(true);
    try {
      const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: activeChannel, intent }),
      });
      const data = await response.json() as { recommendations?: Opportunity[]; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法完成匹配。");
      setPersonalizedRecommendations(data.recommendations || []);
      if (!data.recommendations?.length) setNotice("当前关系空间里还没有符合边界的开放局，可以按这份意图发起一个新局。");
    } catch (error) {
      setPersonalizedRecommendations([]);
      setNotice(error instanceof Error ? error.message : "暂时无法完成匹配。");
    } finally {
      setRecommendationsLoading(false);
    }
  }

  function confirmIntent() {
    if (!draftIntent) return;
    const confirmedIntent = { ...draftIntent, channel: activeChannel, status: "active" as const };
    setActiveIntent(confirmedIntent);
    setDraftIntent(null);
    setProgress(5);
    setRecommendationsShown(true);
    setPersonalizedRecommendations([]);
    setMessages((current) => [
      ...current,
      {
        id: uid(),
        role: "assistant",
        content: `方向已经确认。我先从当前开放的${channelConfig.opportunityLabel}里找相容选项。推荐只是判断线索，下一步仍由你决定。`,
      },
    ]);
    void loadRecommendations(confirmedIntent);
  }

  function requestIntentEdit() {
    setComposer("这版意图里，我想补充或修改的是：");
    window.setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function restartConversation() {
    const hasConversationWork = messages.length > 1 || Boolean(draftIntent) || Boolean(activeIntent) || sending;
    if (!hasConversationWork) {
      setPage("chat");
      window.setTimeout(() => textareaRef.current?.focus(), 50);
      return;
    }
    if (!window.confirm("开始新对话会结束当前对话和意图，但保留你已经加入或创建的局。要继续吗？")) return;
    chatRequestRef.current?.abort();
    chatRequestRef.current = null;
    setMessages(createInitialMessages(activeChannel));
    setProgress(0);
    setDraftIntent(null);
    setActiveIntent(null);
    setRecommendationsShown(false);
    setPersonalizedRecommendations([]);
    setSending(false);
    setNotice("新的对话已经开始。你加入和创建的局都还在。");
    setPage("chat");
  }

  async function loadRoomWorkspace(opportunity: Opportunity) {
    if (opportunity.id.startsWith("created-")) {
      setRoomWorkspace(null);
      return;
    }
    setRoomWorkspaceLoading(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(opportunity.id)}`, { cache: "no-store" });
      const data = await response.json() as { workspace?: RoomWorkspace };
      if (response.ok && data.workspace) {
        setRoomWorkspace(data.workspace);
        setRoomPlanDraft(data.workspace.state);
        if (data.workspace.feedback) {
          const { eventId: _eventId, createdAt: _createdAt, ...feedback } = data.workspace.feedback;
          void _eventId;
          void _createdAt;
          setFeedbackDraft(feedback);
        }
      } else {
        setRoomWorkspace(null);
        setRoomPlanDraft(null);
      }
    } catch {
      setRoomWorkspace(null);
      setRoomPlanDraft(null);
    } finally {
      setRoomWorkspaceLoading(false);
    }
  }

  function openOpportunity(opportunity: Opportunity) {
    setRegistrationNote("");
    setRoomWorkspace(null);
    setRoomPlanDraft(null);
    setRoomMessageDraft("");
    setRoomChatOpen(false);
    setSelectedOpportunity(opportunity);
    void loadRoomWorkspace(opportunity);
  }

  function openRegistration(opportunity: Opportunity) {
    openOpportunity(opportunity);
  }

  async function submitRegistration(opportunity: Opportunity) {
    if (registrationBusy) return;
    if (opportunity.id.startsWith("created-")) {
      setNotice(`你已经在「${opportunity.title}」里。`);
      return;
    }
    setRegistrationBusy(true);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(opportunity.id)}/registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", note: registrationNote }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "暂时无法提交。 ");
      const registration = data.registration as OpportunityRegistration;
      setRegistrations((current) => ({ ...current, [opportunity.id]: registration }));
      setJoinedIds((current) => current.includes(opportunity.id) ? current : [...current, opportunity.id]);
      setNotice(registration.status === "confirmed"
        ? `已确认参加「${opportunity.title}」。`
        : registration.status === "waitlisted"
          ? `已登记候补「${opportunity.title}」。`
          : `已发出申请，等待「${opportunity.title}」确认。`);
      await refreshEvents();
      await loadRoomWorkspace(opportunity);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法提交。 ");
    } finally {
      setRegistrationBusy(false);
    }
  }

  async function cancelRegistration(opportunity: Opportunity) {
    if (registrationBusy || !window.confirm(`取消「${opportunity.title}」吗？`)) return;
    if (opportunity.id.startsWith("created-")) return;
    setRegistrationBusy(true);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(opportunity.id)}/registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "暂时无法取消。 ");
      setRegistrations((current) => {
        const next = { ...current };
        delete next[opportunity.id];
        return next;
      });
      setJoinedIds((current) => current.filter((id) => id !== opportunity.id));
      setNotice(`已取消「${opportunity.title}」。`);
      setSelectedOpportunity(null);
      await refreshEvents();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法取消。 ");
    } finally {
      setRegistrationBusy(false);
    }
  }

  async function createOpportunity() {
    if (!activeIntent || !profile) return;
    const existing = allOpportunities.find((item) => hostIds.includes(item.id) && resolveOpportunityChannel(item) === activeChannel);
    if (existing) {
      setCreatedRoomResult(existing);
      setNotice(`这个方向已经有「${existing.title}」，可以继续推进。`);
      return;
    }
    setCreatedRoomResult(null);
    setRoomActionBusy(true);
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: activeChannel, intent: activeIntent }),
      });
      const data = await response.json() as { event?: Opportunity; error?: string };
      if (!response.ok || !data.event) throw new Error(data.error || "暂时无法发起新局。");
      setHostIds((current) => current.includes(data.event!.id) ? current : [...current, data.event!.id]);
      setJoinedIds((current) => current.includes(data.event!.id) ? current : [...current, data.event!.id]);
      setCreatedRoomResult({ ...data.event, members: 1 });
      setNotice("新局已经写入真实数据库，你是发起人和第一位成员。");
      await refreshEvents();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法发起新局。");
    } finally {
      setRoomActionBusy(false);
    }
  }

  async function postRoomAction(body: object) {
    if (!selectedOpportunity || selectedOpportunity.id.startsWith("created-") || roomActionBusy) return;
    setRoomActionBusy(true);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(selectedOpportunity.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { workspace?: RoomWorkspace; message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "操作没有完成。");
      if (data.workspace) {
        setRoomWorkspace(data.workspace);
        setRoomPlanDraft(data.workspace.state);
      }
      if (data.message) setNotice(data.message);
      const action = (body as { action?: string }).action;
      if (action === "update_state" || action === "settings" || action === "registration") await refreshEvents();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作没有完成。");
      return false;
    } finally {
      setRoomActionBusy(false);
    }
  }

  async function sendRoomMessage(event: FormEvent) {
    event.preventDefault();
    if (!roomMessageDraft.trim()) return;
    const sent = await postRoomAction({ action: "message", content: roomMessageDraft });
    if (sent) setRoomMessageDraft("");
  }

  async function submitRoomFeedback(event: FormEvent) {
    event.preventDefault();
    const saved = await postRoomAction({ action: "feedback", ...feedbackDraft });
    if (saved) setNotice("反馈已保存。攒攒会据此更新行动信誉和下一步建议。");
  }

  async function saveRoomPlan(event: FormEvent) {
    event.preventDefault();
    if (!roomPlanDraft) return;
    const saved = await postRoomAction({
      action: "update_state",
      status: roomPlanDraft.status,
      scheduledAt: roomPlanDraft.scheduledAt || undefined,
      location: roomPlanDraft.location || "",
      meetingUrl: roomPlanDraft.meetingUrl || "",
      objective: roomPlanDraft.objective || "",
      roles: roomPlanDraft.roles,
      deadline: roomPlanDraft.deadline || undefined,
      completionCriteria: roomPlanDraft.completionCriteria || "",
      continuationDecision: roomPlanDraft.continuationDecision || "",
    });
    if (saved) setNotice("行动安排已更新，所有已确认成员都会在局内看到。");
  }

  async function saveOwnerSettings(registrationMode: Opportunity["registrationMode"], visibility: NonNullable<Opportunity["visibility"]>) {
    const saved = await postRoomAction({ action: "settings", registrationMode, visibility });
    if (saved) {
      setSelectedOpportunity((current) => current ? { ...current, registrationMode, visibility } : current);
      setNotice("加入规则已更新。");
    }
  }

  async function reviewApplication(registrationId: string, status: OpportunityRegistrationStatus) {
    const saved = await postRoomAction({ action: "registration", registrationId, status });
    if (saved) setNotice(status === "confirmed" ? "报名已确认，成员现在可以进入局内群聊。" : status === "waitlisted" ? "申请已转入候补。" : "申请已恢复为待确认。");
  }

  async function reportRoom() {
    const details = window.prompt("请简要说明问题（虚假身份、爽约、推销、骚扰、虚假项目或隐私问题）：");
    if (!details?.trim() || details.trim().length < 5) return;
    const reportableMembers = roomWorkspace?.members.filter((member) => member.userId !== roomWorkspace.currentUserId) || [];
    let reportedUserId: string | undefined;
    if (reportableMembers.length > 0) {
      const memberName = window.prompt(`如果问题涉及具体成员，请输入姓名；不确定可留空。\n${reportableMembers.map((member) => member.name).join("、")}`)?.trim();
      reportedUserId = reportableMembers.find((member) => member.name === memberName)?.userId;
    }
    const evidenceUrl = window.prompt("如有截图或文件证据，可填写已上传文件的链接；没有可留空：")?.trim() || "";
    await postRoomAction({ action: "report", category: "other", details, evidenceUrl, reportedUserId });
  }

  async function submitGovernanceRequest(type: "appeal" | "correction" | "deletion_request") {
    const prompts = {
      appeal: "请说明需要申诉的限制或处理结果：",
      correction: "请说明需要纠正的数据：",
      deletion_request: "请说明希望删除的数据范围：",
    };
    const details = window.prompt(prompts[type]);
    if (!details?.trim() || details.trim().length < 5) return;
    try {
      const response = await fetch("/api/governance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, details }),
      });
      const data = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "暂时无法提交。");
      setNotice(data.message || "请求已提交。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "暂时无法提交。");
    }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profileDraft) return;
    setProfileSaving(true);
    setProfileSaved(false);
    setProfileError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...profileDraft, channel: activeChannel }),
      });
      const data = await response.json() as { profile?: Profile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error || "资料保存失败。");
      const saved = normalizeProfile(data.profile);
      setProfile(saved);
      setProfileDraft(saved);
      setProfileSaved(true);
      setNotice("资料已保存。");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "资料保存失败，请稍后重试。");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleAvatarUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !profileDraft) return;
    if (!file.type.startsWith("image/")) {
      setProfileError("请选择 JPG、PNG 或 WebP 图片。");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileError("图片请控制在 5MB 以内。");
      return;
    }
    setProfileError("");
    try {
      const avatar = await resizeAvatar(file);
      if (avatar.length > 900_000) throw new Error("图片处理后仍然太大，请换一张更简单的图片。");
      setProfileDraft({ ...profileDraft, avatar });
      setProfileSaved(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "头像处理失败。");
    }
  }

  function toggleMatching() {
    if (!activeIntent) return;
    const next = activeIntent.status === "paused" ? "active" : "paused";
    setActiveIntent({ ...activeIntent, status: next });
    setNotice(next === "paused" ? "匹配已暂停，已有的局不受影响。 " : "匹配已恢复。 ");
  }

  if (!ready) {
    return <div className="boot-screen"><span className="brand-mark"><BrandMark priority /></span></div>;
  }

  if (!profile) return <EntryScreen channel={activeChannel} onEnter={enter} />;

  const isFreshConversation = messages.length === 1
    && messages[0]?.id === "welcome"
    && !draftIntent
    && !activeIntent
    && !sending;
  const selectedRegistration = selectedOpportunity ? registrations[selectedOpportunity.id] : undefined;
  const selectedIsHost = selectedOpportunity ? hostIds.includes(selectedOpportunity.id) : false;
  const selectedPeople = selectedOpportunity ? [
    ...selectedOpportunity.people,
    ...(roomWorkspace?.members || [])
      .filter((member) => !selectedOpportunity.people.some((person) => person.name === member.name))
      .map((member) => ({ name: member.name, summary: member.summary, offer: member.offer, need: undefined, role: member.isHost ? "发起人" : member.identity })),
  ] : [];

  function renderComposer(extraClass = "") {
    const ActiveIcon = CAPABILITY_ICONS[activeChannel];
    return (
      <form className={`composer ${extraClass}`.trim()} onSubmit={sendMessage}>
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
          placeholder={channelConfig.composerPlaceholder}
          disabled={sending}
        />
        <div className="composer-footer">
          <span className="composer-mode" aria-label={`当前功能：${channelConfig.shortName}`}>
            <ActiveIcon />
            <span>{channelConfig.shortName}</span>
          </span>
        </div>
        <button type="submit" disabled={!composer.trim() || sending} aria-label={sending ? "攒攒正在理解" : "发送消息"}>
          <span className="sr-only">{sending ? "理解中" : "发送"}</span><SendIcon />
        </button>
      </form>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand brand-static" aria-label="攒攒">
            <span className="brand-mark"><BrandMark priority /></span>
            <span>攒攒</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="主要导航">
          <button type="button" className="sidebar-new-conversation" onClick={restartConversation}>
            <NewChatIcon className="nav-icon" />
            <span className="nav-label">新对话</span>
          </button>
          {pageNav.map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              className={page === value ? "active" : ""}
              onClick={() => setPage(value)}
              aria-current={page === value ? "page" : undefined}
            >
              <Icon className="nav-icon" />
              <span className="nav-label">{label}</span>
              {value === "rooms" && joinedIds.length > 0 && <b>{joinedIds.length}</b>}
            </button>
          ))}
        </nav>

        <div className="account-wrap" ref={accountMenuRef}>
          {accountMenuOpen && (
            <div className="popover account-popover" role="menu">
              <button role="menuitem" type="button" onClick={() => { setPage("profile"); setAccountMenuOpen(false); }}>我的资料</button>
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
            <span className="account-avatar"><Image src={profile.avatar} alt="" width={72} height={72} unoptimized /></span>
            <div><strong>{profile.nickname}</strong><small>{profile.email}</small></div>
            <ChevronDownIcon className="account-caret" />
          </button>
        </div>
      </aside>

      <main className={`app-main page-${page}`}>
        <header className="mobile-header">
          <div className="brand brand-static" aria-label="攒攒">
            <span className="brand-mark"><BrandMark priority /></span><span>攒攒</span>
          </div>
        </header>

        {notice && (
          <div className="notice-bar" role="status">
            <span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="关闭提示">×</button>
          </div>
        )}

        {page === "chat" && (
          <section className={`chat-page ${isFreshConversation ? "is-fresh" : ""}`}>
            <header className="workspace-header">
              <div className="agent-selector-wrap">
                <div className="agent-selector" aria-label="当前 Agent：攒攒 1.0">
                  <span>攒攒 1.0</span>
                </div>
              </div>
            </header>

            <div className="chat-scroll" aria-live="polite">
              <div className="conversation">
                {isFreshConversation && (
                  <div className="initial-chat-intro">
                    <h2>
                      你想让攒攒帮你攒一个
                      <strong key={activeChannel}>{HEADLINE_ROOM_LABELS[activeChannel]}</strong>
                      ？
                    </h2>
                    {renderComposer("inline-composer")}
                    <div className="capability-switch" aria-label="选择攒攒功能">
                      {CHANNEL_LIST.map((item) => {
                        const Icon = CAPABILITY_ICONS[item.id];
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={activeChannel === item.id ? "active" : ""}
                            onClick={() => selectChannel(item.id)}
                            aria-pressed={activeChannel === item.id}
                          >
                            <Icon />
                            {UNIFIED_MODE_LABELS[item.id]}
                          </button>
                        );
                      })}
                      <button type="button" onClick={() => setPage("event")}>
                        <NetworkIcon />
                        活动名单配对
                      </button>
                    </div>
                  </div>
                )}

                {!isFreshConversation && messages.map((message) => (
                  <div key={message.id} className={`message ${message.role}`}>
                    {message.role === "assistant" && <span className="agent-stamp"><BrandMark /></span>}
                    <div>
                      {message.role === "assistant" && (
                        <span className="message-author">
                          <strong>攒攒</strong><small>{channelConfig.shortName}</small>
                        </span>
                      )}
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
                    <span className="agent-stamp"><BrandMark /></span>
                    <div><span className="message-author"><strong>攒攒</strong><small>{channelConfig.shortName}</small></span><p>正在结合前面的对话理解<span className="thinking-dots">...</span></p></div>
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
                      <div><p className="eyebrow">AGENT SEARCH / 当前关系空间</p><h2>攒攒看过成员缺口后的建议</h2></div>
                      <span>{channelConfig.shortName}空间 · 不跨空间使用资料</span>
                    </div>
                    {recommendationsLoading ? (
                      <div className="recommendation-searching"><i /><div><strong>正在搜索真实局和成员缺口</strong><span>核对目标、互补能力、城市时间与硬性边界</span></div></div>
                    ) : recommended.length > 0 ? (
                      <div className="recommendation-list">{recommended.map((opportunity) => (
                        <OpportunityCard
                          key={opportunity.id}
                          opportunity={opportunity}
                          joined={joinedIds.includes(opportunity.id)}
                          registrationStatus={registrations[opportunity.id]?.status}
                          onView={() => openOpportunity(opportunity)}
                          onToggleJoin={() => openRegistration(opportunity)}
                        />
                      ))}</div>
                    ) : <p className="recommendation-empty">没有找到同时满足当前边界的开放局。</p>}
                    {createdRoomResult ? (
                      <div className="create-room-success" role="status" aria-live="polite">
                        <span className="create-room-success-mark" aria-hidden="true">✓</span>
                        <div><small>新局已经建立</small><strong>{createdRoomResult.title}</strong><p>你是发起人和第一位成员，接下来可以邀请合适的人。</p></div>
                        <div className="create-room-success-actions">
                          <button type="button" onClick={() => openOpportunity(createdRoomResult)}>查看新局</button>
                          <button type="button" onClick={() => setPage("rooms")}>进入我的局 →</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className={`create-room-button ${roomActionBusy ? "is-busy" : ""}`} onClick={createOpportunity} disabled={roomActionBusy} aria-busy={roomActionBusy}>
                        <span>{roomActionBusy ? "正在建立新局" : "没有合适的？"}</span><strong>{roomActionBusy ? "正在写入并确认发起人身份…" : "按当前意图发起一个新局 →"}</strong>
                      </button>
                    )}
                  </section>
                )}
                <div ref={chatEndRef} />
              </div>
            </div>

            {!isFreshConversation && renderComposer()}
          </section>
        )}

        {page === "discover" && (
          <section className="content-page">
            <header className="content-header">
              <div><h1>发现新局</h1></div>
              <p>合作、活动、关系、招聘与创投的局，都在这里查看。</p>
            </header>
            <div className="event-date-strip" role="tablist" aria-label="按日期筛选局">
              <button type="button" className={discoverDate === "all" ? "active" : ""} onClick={() => setDiscoverDate("all")} role="tab" aria-selected={discoverDate === "all"}>
                <span>全部</span><strong>ALL</strong>
              </button>
              {dateChoices.map((choice) => (
                <button key={choice.key} type="button" className={discoverDate === choice.key ? "active" : ""} onClick={() => setDiscoverDate(choice.key)} role="tab" aria-selected={discoverDate === choice.key}>
                  <span>{choice.label}</span><strong>{choice.day}</strong>
                </button>
              ))}
            </div>
            <div className="discover-toolbar">
              <div className="filter-row" role="tablist" aria-label="按类型筛选局">
                {discoverFilterOptions.map(([value, label]) => (
                  <button key={value} type="button" className={discoverFilter === value ? "active" : ""} onClick={() => setDiscoverFilter(value)} role="tab" aria-selected={discoverFilter === value}>{label}</button>
                ))}
              </div>
              <div className="discover-selects">
                <label><span>城市</span><select value={discoverCity} onChange={(event) => setDiscoverCity(event.target.value)}><option value="all">全部城市</option>{discoverCities.map((city) => <option value={city} key={city}>{city}</option>)}</select></label>
                <label><span>排序</span><select value={discoverSort} onChange={(event) => setDiscoverSort(event.target.value)}><option value="recommended">为你推荐</option><option value="time">按时间</option><option value="distance">按距离</option></select></label>
              </div>
            </div>
            {discoverItems.length > 0 ? (
              <div className="opportunity-grid event-list">
                {discoverItems.map((opportunity) => (
                  <OpportunityCard
                    key={opportunity.id}
                    opportunity={opportunity}
                    joined={joinedIds.includes(opportunity.id)}
                    registrationStatus={registrations[opportunity.id]?.status}
                    compact
                    onView={() => openOpportunity(opportunity)}
                    onToggleJoin={() => openRegistration(opportunity)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state event-empty"><span>当前条件下还没有合适的局</span><h2>换个日期或类型看看。</h2><button type="button" className="secondary-button" onClick={() => { setDiscoverDate("all"); setDiscoverCity("all"); setDiscoverFilter("all"); }}>清除筛选</button></div>
            )}
          </section>
        )}

        {page === "event" && <EventMatchPage />}

        {page === "rooms" && (
          <section className="content-page rooms-page">
            <header className="rooms-header">
              <div>
                <p className="eyebrow">{pageTitles.rooms.eyebrow}</p>
                <h1>{pageTitles.rooms.title}</h1>
                <p>查看进度、确认安排，继续和局里的人保持联系。</p>
              </div>
              <dl className="rooms-overview" aria-label="我的局概览">
                <div><dt>全部</dt><dd>{roomFilterCounts.all}</dd></div>
                <div><dt>正在推进</dt><dd>{roomFilterCounts.recruiting + roomFilterCounts.active}</dd></div>
                <div><dt>已经完成</dt><dd>{roomFilterCounts.completed}</dd></div>
              </dl>
            </header>
            <div className="rooms-filterbar" role="tablist" aria-label="筛选我的局">
              {[["all", "全部"], ["host", "我发起的"], ["recruiting", "招募与确认"], ["active", "进行中"], ["completed", "已完成"]].map(([value, label]) => (
                <button key={value} type="button" className={roomsFilter === value ? "active" : ""} onClick={() => setRoomsFilter(value)} role="tab" aria-selected={roomsFilter === value}>
                  <span>{label}</span><small>{roomFilterCounts[value as keyof typeof roomFilterCounts]}</small>
                </button>
              ))}
            </div>
            {myRooms.length > 0 ? (
              <div className="room-list">
                {myRooms.map((opportunity) => (
                  <RoomListItem
                    key={opportunity.id}
                    opportunity={opportunity}
                    isHost={hostIds.includes(opportunity.id)}
                    registrationStatus={registrations[opportunity.id]?.status || (opportunity.id.startsWith("created-") ? "confirmed" : undefined)}
                    onView={() => openOpportunity(opportunity)}
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
            <header className="content-header profile-header">
              <div><h1>{pageTitles.profile.title}</h1></div>
              <p>完善公开资料，让合适的人更容易了解你。</p>
            </header>
            {profileDraft && (
              <form className="profile-editor" onSubmit={saveProfile}>
                <aside className="profile-avatar-panel">
                  <div className="profile-avatar-preview">
                    <Image src={profileDraft.avatar} alt={`${profileDraft.nickname}的头像`} width={320} height={320} unoptimized priority />
                  </div>
                  <strong>{profileDraft.nickname || "你的昵称"}</strong>
                  <span>{profile.email}</span>
                  <details className="avatar-picker">
                    <summary>更换头像</summary>
                    <div className="avatar-choice-grid" aria-label="选择线稿头像">
                      {AVATAR_CHOICES.map((avatar, index) => (
                        <button
                          key={avatar}
                          type="button"
                          className={profileDraft.avatar === avatar ? "selected" : ""}
                          onClick={() => { setProfileDraft({ ...profileDraft, avatar }); setProfileSaved(false); setProfileError(""); }}
                          aria-label={`选择线稿头像 ${index + 1}`}
                          aria-pressed={profileDraft.avatar === avatar}
                        >
                          <Image src={avatar} alt="" width={96} height={96} unoptimized />
                        </button>
                      ))}
                    </div>
                    <label className="avatar-upload-button">
                      <span>上传自己的头像</span>
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAvatarUpload} />
                    </label>
                  </details>
                  {profile.trust && (
                    <details className="profile-trust-summary">
                      <summary><span>行动信誉</span><strong>{profile.trust.creditScore}</strong></summary>
                      <p>{profile.trust.emailVerified ? "邮箱已验证" : "邮箱待验证"} · 完成 {profile.trust.completedRooms} 个局 · 爽约 {profile.trust.noShowCount} 次 · 成立举报 {profile.trust.reportCount} 次</p>
                      <div className="profile-trust-badges"><span className={profile.trust.emailVerified ? "verified" : ""}>邮箱</span><span className={profile.trust.phoneVerified ? "verified" : ""}>手机</span><span className={profile.trust.workVerified ? "verified" : ""}>工作 / 学校</span><span className={profile.trust.hostVerified ? "verified" : ""}>主理人</span><span className={profile.trust.realNameVerified ? "verified" : ""}>可选实名</span><span className={profile.trust.institutionVerified ? "verified" : ""}>机构背书</span></div>
                    </details>
                  )}
                </aside>

                <div className="profile-fields">
                  <section className="profile-form-section profile-form-main">
                    <div className="profile-form-heading"><h2>公开资料</h2><span>这些信息会帮助攒攒判断谁更适合认识你</span></div>
                    <div className="profile-field-grid">
                      <label><span>昵称</span><input value={profileDraft.nickname} maxLength={30} autoComplete="nickname" onChange={(event) => { setProfileDraft({ ...profileDraft, nickname: event.target.value }); setProfileSaved(false); }} /></label>
                      <label><span>所在城市</span><input value={profileDraft.city} maxLength={40} placeholder="例如：上海" onChange={(event) => { setProfileDraft({ ...profileDraft, city: event.target.value }); setProfileSaved(false); }} /></label>
                      <label className="full-field"><span>当前身份</span><input value={profileDraft.identity} maxLength={80} placeholder="例如：独立产品设计师" onChange={(event) => { setProfileDraft({ ...profileDraft, identity: event.target.value }); setProfileSaved(false); }} /></label>
                      <label className="full-field"><span>一句话介绍</span><textarea value={profileDraft.bio} maxLength={180} rows={3} placeholder="用自然的一句话介绍自己" onChange={(event) => { setProfileDraft({ ...profileDraft, bio: event.target.value }); setProfileSaved(false); }} /></label>
                      <label><span>兴趣与擅长</span><textarea value={profileDraft.skills} maxLength={180} rows={4} placeholder="你擅长什么、关心什么" onChange={(event) => { setProfileDraft({ ...profileDraft, skills: event.target.value }); setProfileSaved(false); }} /></label>
                      <label><span>我能提供</span><textarea value={profileDraft.offer} maxLength={180} rows={4} placeholder="你愿意为一段连接带来什么" onChange={(event) => { setProfileDraft({ ...profileDraft, offer: event.target.value }); setProfileSaved(false); }} /></label>
                      <label className="full-field"><span>微信号</span><input value={profileDraft.wechat} maxLength={60} autoComplete="off" placeholder="只在双方同意建立联系后开放" onChange={(event) => { setProfileDraft({ ...profileDraft, wechat: event.target.value }); setProfileSaved(false); }} /></label>
                    </div>
                  </section>

                  <p className="profile-privacy-note">微信号不会发送给模型，只在双方同意建立联系后开放。</p>
                  <details className="profile-data-controls">
                    <summary>隐私与数据管理</summary>
                    <p>当前资料用于“{channelConfig.shortName}”关系空间，其他空间的私密意图不会进入这里。</p>
                    <div className="profile-governance-actions" aria-label="隐私与申诉">
                      <button type="button" onClick={() => submitGovernanceRequest("correction")}>申请纠正资料</button>
                      <button type="button" onClick={() => submitGovernanceRequest("deletion_request")}>申请删除数据</button>
                      <button type="button" onClick={() => submitGovernanceRequest("appeal")}>提交申诉</button>
                    </div>
                  </details>
                  {profileError && <p className="profile-error" role="alert">{profileError}</p>}
                  <div className="profile-save-row">
                    {profileSaved && <span role="status">资料已保存 ✓</span>}
                    <button className="primary-button" type="submit" disabled={profileSaving || profileDraft.nickname.trim().length < 2}>{profileSaving ? "保存中…" : profileSaved ? "再次保存" : "保存资料"}</button>
                  </div>
                </div>
              </form>
            )}

            {activeIntent && (
              <section className="profile-intent-strip">
                <div><span>当前意图</span><strong>{activeIntent.title}</strong><p>{activeIntent.summary}</p></div>
                <button type="button" className="text-button" onClick={toggleMatching}>{activeIntent.status === "paused" ? "恢复匹配" : "暂停匹配"}</button>
              </section>
            )}
          </section>
        )}
      </main>

      <nav className="mobile-nav" aria-label="移动端主要导航">
        {pageNav.map(([value, label, Icon]) => (
          <button key={value} type="button" className={page === value ? "active" : ""} onClick={() => setPage(value)} aria-current={page === value ? "page" : undefined}>
            <Icon className="nav-icon" />
            <span>{label === "和攒攒聊" ? "对话" : label === "发现新局" ? "发现" : label === "现场攒攒" ? "现场" : label}</span>
          </button>
        ))}
      </nav>

      {selectedOpportunity && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOpportunity(null); }}>
          <section className="detail-modal event-detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title">
            <button type="button" className="modal-close" onClick={() => setSelectedOpportunity(null)} aria-label="关闭详情">×</button>
            <header className="event-detail-hero">
              <div className="event-detail-flags">
                <span>{selectedOpportunity.type}</span>
                {selectedRegistration && <span className="is-status">{registrationLabel(selectedRegistration.status)}</span>}
              </div>
              <h2 id="detail-title">{selectedOpportunity.title}</h2>
              <p>{selectedOpportunity.summary}</p>
              <div className="event-detail-hostline">
                <i>{selectedOpportunity.organizer.name.slice(0, 1)}</i>
                <span><strong>{selectedOpportunity.organizer.name}</strong> 发起{selectedOpportunity.organizer.verified ? " · 已核验" : ""}</span>
              </div>
            </header>

            <div className="event-detail-facts" aria-label="活动关键信息">
              <div>
                <span>时间</span>
                <strong>{new Date(selectedOpportunity.startsAt).toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" })}</strong>
                <small>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(selectedOpportunity.startsAt))}–{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(selectedOpportunity.endsAt))}</small>
              </div>
              <div>
                <span>地点</span>
                <strong>{selectedOpportunity.venue}</strong>
                <small>{selectedOpportunity.address}{typeof selectedOpportunity.distanceKm === "number" ? ` · ${selectedOpportunity.distanceKm} km` : ""}</small>
              </div>
              <div>
                <span>费用</span>
                <strong>{selectedOpportunity.price.type === "free" ? "免费" : selectedOpportunity.price.type === "aa" ? "AA 制" : `¥${selectedOpportunity.price.amount || "待定"}`}</strong>
                <small>{priceLabel(selectedOpportunity)}</small>
              </div>
              <div>
                <span>名额</span>
                <strong>{selectedOpportunity.members} / {selectedOpportunity.maxMembers} 位</strong>
                <small>{selectedOpportunity.members >= selectedOpportunity.minMembers ? "已经成局" : `还差 ${selectedOpportunity.minMembers - selectedOpportunity.members} 位成局`}</small>
              </div>
            </div>

            <div className="event-detail-actionline" aria-label="局的行动进度">
              <div><span>当前阶段</span><strong>{lifecycleLabel(roomWorkspace?.state.status || selectedOpportunity.lifecycleStatus)}</strong></div>
              <div><span>下一步</span><strong>{roomWorkspace?.coordination.nextAction || (selectedOpportunity.members >= selectedOpportunity.minMembers ? "确认时间和地点" : "等待合适成员加入")}</strong></div>
              {roomWorkspace && <div><span>时间提醒</span><p>{roomWorkspace.coordination.reminder}</p></div>}
            </div>

            <div className="event-detail-body">
              <aside className="event-detail-sidebar">
                <div className={`event-registration-panel ${selectedRegistration?.status || (selectedIsHost ? "confirmed" : "")}`}>
                  {selectedIsHost ? (
                    <>
                      <span>发起人控制</span><h3>决定谁能加入</h3>
                      <div className="owner-join-settings">
                        <label>加入方式<select value={selectedOpportunity.registrationMode} disabled={roomActionBusy} onChange={(event) => void saveOwnerSettings(event.target.value as Opportunity["registrationMode"], selectedOpportunity.visibility || "public")}><option value="approval">需要我审核</option><option value="instant">有名额即可加入</option></select></label>
                        <label>发现范围<select value={selectedOpportunity.visibility || "public"} disabled={roomActionBusy} onChange={(event) => void saveOwnerSettings(selectedOpportunity.registrationMode, event.target.value as NonNullable<Opportunity["visibility"]>)}><option value="public">公开可发现</option><option value="invite_only">仅受邀可见</option></select></label>
                      </div>
                      <p>{roomWorkspace?.coordination.pendingCount || 0} 个待审核 · {roomWorkspace?.coordination.waitlistCount || 0} 个候补</p>
                      {roomWorkspace?.applications.length ? <div className="owner-application-list">{roomWorkspace.applications.map((application) => <article key={application.id}><div><Image src={application.avatar} alt="" width={32} height={32} unoptimized /><p><strong>{application.name}</strong><small>{application.note || "未填写申请说明"}</small></p></div><span>{application.status === "pending" ? "待审核" : "候补"}</span><div>{application.status !== "confirmed" && <button type="button" disabled={roomActionBusy} onClick={() => void reviewApplication(application.id, "confirmed")}>确认</button>}{application.status !== "waitlisted" && <button type="button" disabled={roomActionBusy} onClick={() => void reviewApplication(application.id, "waitlisted")}>候补</button>}</div></article>)}</div> : <p>当前没有需要处理的申请。</p>}
                    </>
                  ) : selectedRegistration ? (
                    <><span>报名状态</span><h3>{registrationLabel(selectedRegistration.status)}</h3><p>{selectedRegistration.status === "confirmed" ? "活动信息有更新时会出现在这里。" : selectedRegistration.status === "pending" ? "发起人确认后会为你开放活动群入口。" : "有名额释放时会按候补顺序处理。"}</p>
                      {selectedRegistration.status === "confirmed" && (
                        <div className="join-group-panel"><small>报名后沟通</small><strong>{selectedOpportunity.joinChannel?.label || "活动群入口将在活动前开放"}</strong><p>{selectedOpportunity.joinChannel?.instructions || "攒攒负责报名状态、地点和通知；现场沟通先通过微信或企业微信群完成。"}</p>{selectedOpportunity.joinChannel?.href && <a href={selectedOpportunity.joinChannel.href} target="_blank" rel="noreferrer">加入活动群 ↗</a>}</div>
                      )}
                      <button type="button" className="secondary-button" onClick={() => cancelRegistration(selectedOpportunity)} disabled={registrationBusy}>{registrationBusy ? "处理中" : "取消报名"}</button>
                      <small>可取消至 {formatDateTime(selectedOpportunity.cancellationDeadline)}</small>
                    </>
                  ) : (
                    <><span>{selectedOpportunity.registrationMode === "approval" ? "发起人确认后加入" : "报名后即时加入"}</span><h3>{selectedOpportunity.members >= selectedOpportunity.maxMembers ? "加入候补" : "想参加这个局"}</h3><textarea rows={3} value={registrationNote} onChange={(event) => setRegistrationNote(event.target.value)} placeholder="简单说说你为什么想来（选填）" maxLength={600} /><button type="button" className="highlight-button" onClick={() => submitRegistration(selectedOpportunity)} disabled={registrationBusy}>{registrationBusy ? "正在提交" : selectedOpportunity.members >= selectedOpportunity.maxMembers ? "加入候补" : selectedOpportunity.registrationMode === "approval" ? "提交申请" : "确认参加"}</button><small>报名截止 {formatDateTime(selectedOpportunity.registrationDeadline)}</small></>
                  )}
                </div>
                <div className="event-detail-note">
                  <strong>参加前知道</strong>
                  <ul>{selectedOpportunity.notices.map((noticeItem) => <li key={noticeItem}>{noticeItem}</li>)}</ul>
                  <button type="button" className="report-link" onClick={reportRoom}>举报或反馈安全问题</button>
                </div>
              </aside>

              <div className="event-detail-content">
                <section className="event-detail-about">
                  <h3>关于这个局</h3>
                  <p className="event-long-description">{selectedOpportunity.description}</p>
                  <ol className="event-detail-agenda-inline" aria-label="活动流程">{selectedOpportunity.agenda.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, "0")}</span>{item}</li>)}</ol>
                  <div className="event-detail-reason">
                    <strong>为什么推荐给你</strong>
                    <p>{selectedOpportunity.matchInsight?.headline || selectedOpportunity.observation}</p>
                    {selectedOpportunity.matchInsight && (
                      <>
                        <ul>{selectedOpportunity.matchInsight.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                        {selectedOpportunity.matchInsight.constraints.length > 0 && <p className="match-boundary"><b>加入前确认</b>{selectedOpportunity.matchInsight.constraints.join("；")}</p>}
                        <p className="match-next-step"><b>建议下一步</b>{selectedOpportunity.matchInsight.nextStep}</p>
                      </>
                    )}
                  </div>
                </section>
                <section className="member-section">
                  <div className="event-detail-section-heading"><h3>谁会来</h3><span>{selectedPeople.length} 位成员摘要</span></div>
                  <div className="member-list">
                    {selectedPeople.map((person) => (
                      <article key={`${selectedOpportunity.id}-${person.name}`}>
                        <span className="member-initial">{person.name.slice(0, 1)}</span>
                        <div>
                          <h4>{person.name}{person.role ? <small>{person.role}</small> : null}</h4>
                          <p>{person.summary}</p>
                          <div className="member-context"><span>可以带来：{person.offer}</span>{person.need && <span>希望认识：{person.need}</span>}</div>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                {roomWorkspace?.canManage && roomPlanDraft && (
                  <details className="room-owner-plan event-detail-fold">
                    <summary>推进时间、地点与分工</summary>
                    <form onSubmit={saveRoomPlan}>
                      <div className="room-owner-plan-grid">
                        <label><span>行动状态</span><select value={roomPlanDraft.status} onChange={(event) => setRoomPlanDraft({ ...roomPlanDraft, status: event.target.value as RoomLifecycleStatus })}>{ROOM_LIFECYCLE.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}<option value="cancelled">已取消</option></select></label>
                        <label><span>约定时间</span><input type="datetime-local" value={dateTimeLocalValue(roomPlanDraft.scheduledAt)} onChange={(event) => setRoomPlanDraft({ ...roomPlanDraft, scheduledAt: dateTimeLocalIso(event.target.value) })} /></label>
                        <label><span>地点</span><input value={roomPlanDraft.location || ""} maxLength={200} placeholder="线下地点或线上" onChange={(event) => setRoomPlanDraft({ ...roomPlanDraft, location: event.target.value })} /></label>
                        <label><span>会议链接</span><input type="url" value={roomPlanDraft.meetingUrl || ""} maxLength={1000} placeholder="https://…（可选）" onChange={(event) => setRoomPlanDraft({ ...roomPlanDraft, meetingUrl: event.target.value })} /></label>
                        <label className="full-field"><span>小目标</span><textarea rows={2} value={roomPlanDraft.objective || ""} maxLength={500} onChange={(event) => setRoomPlanDraft({ ...roomPlanDraft, objective: event.target.value })} /></label>
                        <label className="full-field"><span>角色分工（用顿号或逗号分隔）</span><input value={roomPlanDraft.roles.join("、")} maxLength={500} onChange={(event) => setRoomPlanDraft({ ...roomPlanDraft, roles: event.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })} /></label>
                        <label><span>截止时间</span><input type="datetime-local" value={dateTimeLocalValue(roomPlanDraft.deadline)} onChange={(event) => setRoomPlanDraft({ ...roomPlanDraft, deadline: dateTimeLocalIso(event.target.value) })} /></label>
                        <label><span>完成标准</span><input value={roomPlanDraft.completionCriteria || ""} maxLength={500} onChange={(event) => setRoomPlanDraft({ ...roomPlanDraft, completionCriteria: event.target.value })} /></label>
                        <label className="full-field"><span>是否继续合作 / 连接</span><input value={roomPlanDraft.continuationDecision || ""} maxLength={500} placeholder="行动结束后再填写" onChange={(event) => setRoomPlanDraft({ ...roomPlanDraft, continuationDecision: event.target.value })} /></label>
                      </div>
                      <button type="submit" className="secondary-button" disabled={roomActionBusy}>{roomActionBusy ? "保存中…" : "保存行动安排"}</button>
                    </form>
                  </details>
                )}

                {(selectedOpportunity.trialPlan || roomWorkspace?.state.objective) && !roomWorkspace?.canManage && (
                  <details className="room-plan-section event-detail-fold">
                    <summary><span>行动目标</span><small>查看目标与完成标准</small></summary>
                    <dl>
                      <div><dt>小目标</dt><dd>{roomWorkspace?.state.objective || selectedOpportunity.trialPlan?.objective}</dd></div>
                      <div><dt>角色分工</dt><dd>{(roomWorkspace?.state.roles.length ? roomWorkspace.state.roles : selectedOpportunity.trialPlan?.roles || []).join(" · ") || "成立后一起确认"}</dd></div>
                      <div><dt>截止日期</dt><dd>{formatDateTime(roomWorkspace?.state.deadline || selectedOpportunity.trialPlan?.deadline || selectedOpportunity.endsAt)}</dd></div>
                      <div><dt>完成标准</dt><dd>{roomWorkspace?.state.completionCriteria || selectedOpportunity.trialPlan?.completionCriteria}</dd></div>
                    </dl>
                  </details>
                )}

                <button
                  type="button"
                  className="room-chat-entry"
                  onClick={() => setRoomChatOpen(true)}
                  disabled={roomWorkspaceLoading || !roomWorkspace?.canChat}
                  aria-label={roomWorkspace?.canChat ? `进入「${selectedOpportunity.title}」局内群聊` : "确认加入后开放局内群聊"}
                >
                  <span className="room-chat-entry-icon"><ChatIcon /></span>
                  <span className="room-chat-entry-copy">
                    <strong>{roomWorkspace?.canChat ? "进入局内群聊" : "局内群聊"}</strong>
                    <small>
                      {roomWorkspaceLoading
                        ? "正在读取群聊…"
                        : roomWorkspace?.canChat
                          ? `${roomWorkspace.members.length} 位成员 · ${roomWorkspace.messages.length ? `${roomWorkspace.messages.length} 条消息` : "还没有消息"}`
                          : "报名确认后开放"}
                    </small>
                    <span>
                      {roomWorkspace?.canChat
                        ? roomWorkspace.messages.at(-1)?.content || "和局里的成员确认时间、地点与分工"
                        : "加入成功后，可以和成员在这里继续沟通。"}
                    </span>
                  </span>
                  <span className="room-chat-entry-action">{roomWorkspace?.canChat ? "进入" : "未开放"}<i>→</i></span>
                </button>

                {roomWorkspace?.canChat && (
                  <details className="room-feedback-section event-detail-fold">
                    <summary>结束后反馈与下一步</summary>
                    <form onSubmit={submitRoomFeedback}>
                      <div className="feedback-choice-row"><label><input type="checkbox" checked={feedbackDraft.attended} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, attended: event.target.checked })} />实际参加</label><label>结果<select value={feedbackDraft.outcome} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, outcome: event.target.value as RoomFeedback["outcome"] })}><option value="completed">完成约定</option><option value="partial">部分完成</option><option value="not_started">尚未开始</option></select></label><label>愿意继续<select value={feedbackDraft.continueInterest} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, continueInterest: event.target.value as RoomFeedback["continueInterest"] })}><option value="yes">愿意</option><option value="maybe">再看看</option><option value="no">不继续</option></select></label></div>
                      <textarea rows={3} value={feedbackDraft.notes} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, notes: event.target.value })} placeholder="这次发生了什么？下一步最需要什么？" maxLength={800} />
                      <button type="submit" className="secondary-button" disabled={roomActionBusy}>{roomWorkspace.feedback ? "更新反馈" : "提交反馈"}</button>
                    </form>
                  </details>
                )}
                {roomWorkspace?.canChat && <p className="room-next-suggestion"><strong>下一步建议</strong>{roomWorkspace.coordination.nextRelationshipSuggestion}</p>}
              </div>
            </div>
          </section>
        </div>
      )}

      {selectedOpportunity && roomChatOpen && roomWorkspace?.canChat && (
        <div className="room-chat-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setRoomChatOpen(false); }}>
          <section className="room-chat-panel" role="dialog" aria-modal="true" aria-labelledby="room-chat-title">
            <header className="room-chat-panel-header">
              <button type="button" className="room-chat-back" onClick={() => setRoomChatOpen(false)} aria-label="返回活动详情">←</button>
              <div className="room-chat-heading">
                <span>局内群聊</span>
                <h2 id="room-chat-title">{selectedOpportunity.title}</h2>
                <p>{roomWorkspace.members.length} 位成员 · 已加入这个局的成员可见</p>
              </div>
              <div className="room-chat-member-stack" aria-label={`${roomWorkspace.members.length} 位群成员`}>
                {roomWorkspace.members.slice(0, 4).map((member) => (
                  <Image key={member.userId} src={member.avatar} alt={member.name} title={member.name} width={34} height={34} unoptimized />
                ))}
                {roomWorkspace.members.length > 4 && <span>+{roomWorkspace.members.length - 4}</span>}
              </div>
            </header>

            <div className="room-chat-context">
              <span>群聊用于确认见面时间、地点和分工</span>
              <small>联系方式只在双方同意后解锁</small>
            </div>

            <div className="room-chat-timeline" aria-live="polite">
              <p className="room-chat-system-message">这个局的群聊已建立</p>
              {roomWorkspace.messages.map((message) => {
                const isMine = message.userId === roomWorkspace.currentUserId;
                return (
                  <article key={message.id} className={`room-chat-message${isMine ? " is-mine" : ""}`}>
                    {!isMine && <Image src={message.avatar} alt="" width={34} height={34} unoptimized />}
                    <div>
                      {!isMine && <span className="room-chat-message-meta"><strong>{message.author}</strong><time>{formatChatTime(message.createdAt)}</time></span>}
                      <p>{message.content}</p>
                      {isMine && <time>{formatChatTime(message.createdAt)}</time>}
                    </div>
                  </article>
                );
              })}
              {roomWorkspace.messages.length === 0 && (
                <div className="room-chat-empty-state">
                  <strong>群聊已经开放</strong>
                  <p>发第一条消息，和大家确认时间、地点或要带的东西。</p>
                </div>
              )}
            </div>

            <form className="room-chat-panel-composer" onSubmit={sendRoomMessage}>
              <textarea
                rows={1}
                value={roomMessageDraft}
                onChange={(event) => setRoomMessageDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                maxLength={1200}
                placeholder="发消息给局里的成员"
                aria-label="群聊消息"
              />
              <span>Enter 发送 · Shift + Enter 换行</span>
              <button type="submit" disabled={!roomMessageDraft.trim() || roomActionBusy} aria-label="发送群聊消息">
                <SendIcon />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
