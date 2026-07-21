"use client";

import { ChangeEvent, DragEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { readSheet } from "read-excel-file/browser";
import { demoEventGuests } from "@/lib/event-demo";
import type { EventGuest, EventMatch } from "@/lib/types";
import BrandMark from "./BrandMark";

type MatchFilter = "all" | "priority" | "mutual";
type MatchProvider = "waiting" | "agent" | "local";

const GRAPH_WIDTH = 920;
const GRAPH_HEIGHT = 590;

function splitTags(value: string) {
  return value
    .split(/[，,、;；/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cellText(value: unknown) {
  if (value instanceof Date) return value.toLocaleString("zh-CN");
  return value === null || value === undefined ? "" : String(value).trim();
}

function findHeader(headers: string[], predicate: (header: string) => boolean) {
  return headers.findIndex(predicate);
}

function parseGuestRows(rows: unknown[][]): { guests: EventGuest[]; contactColumns: number } {
  if (rows.length < 2) throw new Error("表格里还没有可读取的嘉宾记录。");
  const headers = rows[0].map(cellText);
  const indexes = {
    name: findHeader(headers, (header) => header.includes("您的姓名")),
    tagline: findHeader(headers, (header) => header.includes("最能让大家记住")),
    roles: findHeader(headers, (header) => header.includes("自我角色定位")),
    company: findHeader(headers, (header) => header.includes("公司/团队名称")),
    stage: findHeader(headers, (header) => header.includes("项目阶段")),
    position: findHeader(headers, (header) => header.includes("职务/团队角色")),
    needs: findHeader(headers, (header) => header === "核心需求（必填）" || header === "核心需求"),
    needDetail: findHeader(headers, (header) => header.includes("核心需求补充")),
    offers: findHeader(headers, (header) => header === "可提供资源（必填）" || header === "可提供资源"),
    offerDetail: findHeader(headers, (header) => header.includes("可提供资源补充")),
  };

  if (indexes.name < 0 || indexes.needs < 0 || indexes.offers < 0) {
    throw new Error("没有找到“姓名 / 核心需求 / 可提供资源”字段，请确认使用活动签到表模板。");
  }

  const get = (row: unknown[], index: number) => index < 0 ? "" : cellText(row[index]);
  const guests = rows.slice(1)
    .map((row, index): EventGuest => ({
      id: `guest-${String(index + 1).padStart(2, "0")}`,
      name: get(row, indexes.name),
      tagline: get(row, indexes.tagline),
      roles: splitTags(get(row, indexes.roles)),
      company: get(row, indexes.company),
      stage: get(row, indexes.stage),
      position: get(row, indexes.position),
      needs: splitTags(get(row, indexes.needs)),
      needDetail: get(row, indexes.needDetail),
      offers: splitTags(get(row, indexes.offers)),
      offerDetail: get(row, indexes.offerDetail),
      sourceRow: index + 2,
    }))
    .filter((guest) => guest.name && (guest.needs.length > 0 || guest.offers.length > 0));

  if (guests.length < 2) throw new Error("至少需要两位填写了需求或资源的嘉宾才能匹配。");
  if (guests.length > 40) throw new Error("当前 Demo 单次最多分析 40 位嘉宾，请先按场次拆分。");

  return {
    guests,
    contactColumns: headers.filter((header) => /微信|手机|电话|邮箱|联系方式/.test(header)).length,
  };
}

function strengthLabel(strength: EventMatch["strength"]) {
  if (strength === 3) return "优先对接";
  if (strength === 2) return "值得聊";
  return "可以认识";
}

function initials(name: string) {
  return name.trim().slice(0, 1) || "嘉";
}

function NetworkGraph({
  guests,
  matches,
  selectedGuestId,
  selectedMatchId,
  displayName,
  onSelectGuest,
  onSelectMatch,
}: {
  guests: EventGuest[];
  matches: EventMatch[];
  selectedGuestId: string;
  selectedMatchId: string;
  displayName: (guest: EventGuest) => string;
  onSelectGuest: (id: string) => void;
  onSelectMatch: (id: string) => void;
}) {
  const positions = useMemo(() => new Map(guests.map((guest, index) => {
    const angle = (Math.PI * 2 * index) / guests.length - Math.PI / 2;
    const radiusX = guests.length > 12 ? 352 : 330;
    const radiusY = guests.length > 12 ? 235 : 220;
    return [guest.id, {
      x: GRAPH_WIDTH / 2 + Math.cos(angle) * radiusX,
      y: GRAPH_HEIGHT / 2 + Math.sin(angle) * radiusY,
    }];
  })), [guests]);

  function pathFor(match: EventMatch, index: number) {
    const start = positions.get(match.requesterId);
    const end = positions.get(match.providerId);
    if (!start || !end) return "";
    const middleX = (start.x + end.x) / 2;
    const middleY = (start.y + end.y) / 2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const bend = ((index % 3) - 1) * 17;
    const controlX = middleX - (dy / length) * bend;
    const controlY = middleY + (dx / length) * bend;
    return `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`;
  }

  return (
    <svg className="event-network" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} role="img" aria-label="嘉宾需求与资源合作对接图">
      <defs>
        <marker id="event-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>

      <g className="event-edges">
        {matches.map((match, index) => {
          const selected = match.id === selectedMatchId;
          const connected = !selectedGuestId || match.requesterId === selectedGuestId || match.providerId === selectedGuestId;
          const d = pathFor(match, index);
          return (
            <g
              key={match.id}
              className={`event-edge strength-${match.strength} ${selected ? "selected" : ""} ${connected ? "" : "faded"}`}
              role="button"
              tabIndex={0}
              aria-label={`${strengthLabel(match.strength)}：${match.dimensions.join("、")}`}
              onClick={() => onSelectMatch(match.id)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectMatch(match.id); }}
            >
              <path className="event-edge-hit" d={d} />
              <path
                className="event-edge-line"
                d={d}
                markerEnd="url(#event-arrow)"
                markerStart={match.mutual ? "url(#event-arrow)" : undefined}
              />
            </g>
          );
        })}
      </g>

      <g className="event-nodes">
        {guests.map((guest) => {
          const position = positions.get(guest.id)!;
          const connected = matches.some((match) => match.requesterId === guest.id || match.providerId === guest.id);
          const selected = guest.id === selectedGuestId;
          return (
            <g
              key={guest.id}
              className={`event-node ${selected ? "selected" : ""} ${connected ? "connected" : ""}`}
              transform={`translate(${position.x} ${position.y})`}
              role="button"
              tabIndex={0}
              aria-label={`查看${displayName(guest)}的需求与资源`}
              onClick={() => onSelectGuest(guest.id)}
              onKeyDown={(event: KeyboardEvent<SVGGElement>) => {
                if (event.key === "Enter" || event.key === " ") onSelectGuest(guest.id);
              }}
            >
              <circle className="event-node-halo" r="39" />
              <circle className="event-node-body" r="29" />
              <text className="event-node-initial" textAnchor="middle" dominantBaseline="central">{initials(displayName(guest))}</text>
              <text className="event-node-name" y="48" textAnchor="middle">{displayName(guest)}</text>
              <text className="event-node-role" y="65" textAnchor="middle">{guest.roles[0] || guest.position || "现场嘉宾"}</text>
              <title>{displayName(guest)}：需要 {guest.needs.join("、")}；可提供 {guest.offers.join("、")}</title>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export default function EventMatchPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scenePointerStartX = useRef<number | null>(null);
  const [activeScene, setActiveScene] = useState(0);
  const [guests, setGuests] = useState<EventGuest[]>([]);
  const [matches, setMatches] = useState<EventMatch[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [contactColumns, setContactColumns] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState<MatchProvider>("waiting");
  const [providerName, setProviderName] = useState("");
  const [filter, setFilter] = useState<MatchFilter>("all");
  const [selectedGuestId, setSelectedGuestId] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [introducedIds, setIntroducedIds] = useState<string[]>([]);

  const guestMap = useMemo(() => new Map(guests.map((guest) => [guest.id, guest])), [guests]);
  const filteredMatches = useMemo(() => matches.filter((match) => {
    if (filter === "priority") return match.strength === 3;
    if (filter === "mutual") return match.mutual;
    return true;
  }), [filter, matches]);
  const selectedMatch = matches.find((match) => match.id === selectedMatchId) || null;
  const selectedGuest = guestMap.get(selectedGuestId) || null;
  const connectedGuestIds = new Set(matches.flatMap((match) => [match.requesterId, match.providerId]));
  const mutualCount = matches.filter((match) => match.mutual).length;
  const displayName = (guest: EventGuest) => guest.name;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setTimeout(() => setActiveScene((current) => (current + 1) % 3), 10000);
    return () => window.clearTimeout(timer);
  }, [activeScene]);

  function finishSceneSwipe(clientX: number) {
    if (scenePointerStartX.current === null) return;
    const distance = clientX - scenePointerStartX.current;
    scenePointerStartX.current = null;
    if (Math.abs(distance) < 40) return;
    setActiveScene((current) => (current + (distance < 0 ? 1 : -1) + 3) % 3);
  }

  function resetAnalysis(nextGuests: EventGuest[], nextSource: string, excludedContactColumns: number) {
    setGuests(nextGuests);
    setSourceName(nextSource);
    setContactColumns(excludedContactColumns);
    setMatches([]);
    setProvider("waiting");
    setProviderName("");
    setFilter("all");
    setSelectedGuestId("");
    setSelectedMatchId("");
    setIntroducedIds([]);
    setError("");
  }

  async function importFile(file: File) {
    if (!/\.xlsx$/i.test(file.name)) {
      setError("请导入 .xlsx 格式的活动签到表。");
      return;
    }
    setReading(true);
    setError("");
    try {
      const rows = await readSheet(file);
      const parsed = parseGuestRows(rows as unknown as unknown[][]);
      resetAnalysis(parsed.guests, file.name, parsed.contactColumns);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "签到表读取失败，请检查文件格式。");
    } finally {
      setReading(false);
    }
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void importFile(file);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void importFile(file);
  }

  async function runMatching() {
    if (guests.length < 2 || loading) return;
    setLoading(true);
    setError("");
    setProvider("waiting");
    setProviderName("");
    try {
      const response = await fetch("/api/event-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guests: guests.map(({ id, roles, stage, position, needs, needDetail, offers, offerDetail }) => ({
            id, roles, stage, position, needs, needDetail, offers, offerDetail,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "现场匹配失败");
      setMatches(data.matches || []);
      setProvider(data.provider === "agent" ? "agent" : "local");
      setProviderName(typeof data.providerName === "string" ? data.providerName : "");
      setFilter("all");
      setSelectedMatchId(data.matches?.[0]?.id || "");
      setSelectedGuestId("");
      setIntroducedIds([]);
    } catch (matchError) {
      setError(matchError instanceof Error ? matchError.message : "现场匹配失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  function selectGuest(id: string) {
    setSelectedGuestId(id);
    setSelectedMatchId("");
  }

  function selectMatch(id: string) {
    setSelectedMatchId(id);
    setSelectedGuestId("");
  }

  function toggleIntroduced(id: string) {
    setIntroducedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  const detailContent = selectedMatch ? (() => {
    const requester = guestMap.get(selectedMatch.requesterId);
    const resourceProvider = guestMap.get(selectedMatch.providerId);
    if (!requester || !resourceProvider) return null;
    return (
      <>
        <div className="match-detail-kicker"><span>{strengthLabel(selectedMatch.strength)}</span><span>{selectedMatch.mutual ? "双向互补" : "需求 → 资源"}</span></div>
        <h2>{displayName(requester)} <i>→</i> {displayName(resourceProvider)}</h2>
        <p className="match-detail-reason">{selectedMatch.reason}</p>
        <div className="match-dimensions">{selectedMatch.dimensions.map((item) => <span key={item}>{item}</span>)}</div>
        <dl className="match-direction">
          <div><dt>{displayName(requester)}正在找</dt><dd>{requester.needs.join("、") || "还需补充"}</dd></div>
          <div><dt>{displayName(resourceProvider)}可以带来</dt><dd>{resourceProvider.offers.join("、") || "还需补充"}</dd></div>
        </dl>
        <div className="match-opening"><span>现场第一句</span><p>{selectedMatch.opening}</p></div>
        <button type="button" className={introducedIds.includes(selectedMatch.id) ? "secondary-button" : "highlight-button"} onClick={() => toggleIntroduced(selectedMatch.id)}>
          {introducedIds.includes(selectedMatch.id) ? "已标记引荐 · 撤销" : "标记为已引荐"}
        </button>
      </>
    );
  })() : selectedGuest ? (
    <>
      <div className="match-detail-kicker"><span>嘉宾信息</span><span>{selectedGuest.stage || "阶段待补充"}</span></div>
      <h2>{displayName(selectedGuest)}</h2>
      <p className="guest-tagline">{selectedGuest.tagline || `${selectedGuest.position || "现场嘉宾"} · ${selectedGuest.company || "团队待补充"}`}</p>
      <dl className="match-direction guest-direction">
        <div><dt>核心需求</dt><dd>{selectedGuest.needs.join("、") || "还需补充"}</dd></div>
        <div><dt>可以提供</dt><dd>{selectedGuest.offers.join("、") || "还需补充"}</dd></div>
        {selectedGuest.needDetail && <div><dt>需求补充</dt><dd>{selectedGuest.needDetail}</dd></div>}
      </dl>
      <span className="guest-match-count">当前连接 {matches.filter((match) => match.requesterId === selectedGuest.id || match.providerId === selectedGuest.id).length} 组关系</span>
    </>
  ) : (
    <div className="inspector-empty">
      <span>关系图说明</span>
      <h2>{matches.length > 0 ? "点一条线，看为什么值得聊。" : "先让 Agent 整理现场关系。"}</h2>
      <p>箭头从需求方指向资源方；双箭头表示双方都有能回应彼此的资源。</p>
    </div>
  );

  return (
    <section className="content-page event-match-page">
      <header className="content-header event-content-header">
        <h1>现场攒攒</h1>
      </header>

      <input ref={fileInputRef} className="sr-only" type="file" accept=".xlsx" onChange={handleFile} />

      {guests.length === 0 ? (
        <div className="event-import-stage" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <div
            className="event-import-visual"
            role="region"
            aria-label="创业、婚恋与兴趣场景示例，可左右滑动切换"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") setActiveScene((current) => (current + 1) % 3);
              if (event.key === "ArrowLeft") setActiveScene((current) => (current + 2) % 3);
            }}
            onPointerDown={(event) => {
              scenePointerStartX.current = event.clientX;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => finishSceneSwipe(event.clientX)}
            onPointerCancel={() => { scenePointerStartX.current = null; }}
          >
            <div className={`live-scene scene-startup ${activeScene === 0 ? "active" : ""}`} aria-hidden={activeScene !== 0}>
              <h3>创业局</h3>
              <svg viewBox="0 0 520 520" aria-hidden="true">
                <g className="scene-figure founder-product" transform="translate(76 135) rotate(-8 42 66)">
                  <path d="M23 29 C25 12 57 8 68 24 C75 36 65 51 49 52 C33 53 20 44 23 29Z" />
                  <path d="M28 27 C41 21 57 22 68 29" />
                  <path d="M34 54 C22 64 21 82 31 95 C42 105 62 103 72 91 C78 79 72 64 61 54" />
                  <path d="M33 93 L25 124 M68 94 L76 122 M45 103 L43 131" />
                </g>
                <g className="scene-figure founder-tech" transform="translate(355 126) rotate(9 42 66)">
                  <path d="M23 29 C25 12 57 8 68 24 C75 36 65 51 49 52 C33 53 20 44 23 29Z" />
                  <path d="M28 27 C41 21 57 22 68 29" />
                  <path d="M34 54 C22 64 21 82 31 95 C42 105 62 103 72 91 C78 79 72 64 61 54" />
                  <path d="M33 93 L25 124 M68 94 L76 122 M45 103 L43 131" />
                </g>
                <g className="scene-figure founder-channel" transform="translate(222 320) rotate(3 42 66)">
                  <path d="M23 29 C25 12 57 8 68 24 C75 36 65 51 49 52 C33 53 20 44 23 29Z" />
                  <path d="M28 27 C41 21 57 22 68 29" />
                  <path d="M34 54 C22 64 21 82 31 95 C42 105 62 103 72 91 C78 79 72 64 61 54" />
                  <path d="M33 93 L25 124 M68 94 L76 122 M45 103 L43 131" />
                </g>
                <g className="scene-center startup-project">
                  <path d="M199 251 C211 220 247 207 282 214 C315 220 334 244 322 271 C310 299 272 311 238 301 C207 292 188 276 199 251Z" />
                  <path d="M208 247 C235 263 285 265 316 249" />
                  <path d="M238 270 L260 284 L290 262" />
                </g>
                <g className="scene-links">
                  <path className="scene-connection connection-a" pathLength="1" d="M150 229 C178 230 197 239 211 251" />
                  <path className="scene-connection connection-b" pathLength="1" d="M365 221 C340 225 322 237 310 250" />
                  <path className="scene-connection connection-c" pathLength="1" d="M267 320 C267 314 266 307 266 302" />
                  <path className="scene-orbit" pathLength="1" d="M145 197 C214 111 349 126 388 211" />
                </g>
              </svg>
              <span className="scene-name name-a">林乔 · 产品</span>
              <span className="scene-name name-b">周衡 · 技术</span>
              <span className="scene-name name-c">陈望 · 渠道</span>
              <span className="scene-link-copy link-a">需要技术合伙人</span>
              <span className="scene-link-copy link-b">可提供首批客户</span>
              <span className="scene-link-copy link-c">共同产品共创</span>
              <p className="scene-result">技术合伙人 × 首批客户 × 产品共创</p>
            </div>

            <div className={`live-scene scene-romance ${activeScene === 1 ? "active" : ""}`} aria-hidden={activeScene !== 1}>
              <h3>婚恋局</h3>
              <svg viewBox="0 0 520 520" aria-hidden="true">
                <g className="scene-figure romance-left" transform="translate(92 178) rotate(-6 42 66)">
                  <path d="M23 29 C25 12 57 8 68 24 C75 36 65 51 49 52 C33 53 20 44 23 29Z" />
                  <path d="M28 27 C41 21 57 22 68 29" />
                  <path d="M34 54 C22 64 21 82 31 95 C42 105 62 103 72 91 C78 79 72 64 61 54" />
                  <path d="M33 93 L23 125 M68 94 L79 122 M48 101 L64 118" />
                </g>
                <g className="scene-figure romance-right" transform="translate(342 178) rotate(7 42 66)">
                  <path d="M23 29 C25 12 57 8 68 24 C75 36 65 51 49 52 C33 53 20 44 23 29Z" />
                  <path d="M28 27 C41 21 57 22 68 29" />
                  <path d="M34 54 C22 64 21 82 31 95 C42 105 62 103 72 91 C78 79 72 64 61 54" />
                  <path d="M33 93 L22 123 M68 94 L78 125 M46 101 L30 118" />
                </g>
                <g className="scene-center romance-table">
                  <path d="M194 337 C210 321 298 321 320 337 C298 356 213 358 194 337Z" />
                  <path d="M201 339 C220 351 294 352 315 339" />
                  <path d="M257 354 L257 389 M233 393 C248 384 269 384 284 393" />
                  <path d="M232 303 C232 290 248 287 255 297 L255 316 L233 316Z" />
                  <path d="M278 303 C278 290 294 287 301 297 L301 316 L279 316Z" />
                  <path d="M255 301 C263 296 270 296 278 301" />
                </g>
                <g className="scene-links">
                  <path className="scene-connection connection-a" pathLength="1" d="M169 249 C206 229 299 229 342 249" />
                  <path className="scene-connection connection-b" pathLength="1" d="M176 281 C210 304 294 305 336 280" />
                  <path className="scene-orbit" pathLength="1" d="M147 182 C205 105 317 106 374 182" />
                </g>
              </svg>
              <span className="scene-name name-a">许言</span>
              <span className="scene-name name-b">顾宁</span>
              <span className="scene-link-copy link-a">目标 · 认真关系</span>
              <span className="scene-link-copy link-b">共同 · 看展徒步</span>
              <span className="scene-link-copy link-c">节奏 · 慢一点认识</span>
              <p className="scene-result">认真关系 × 看展徒步 × 慢一点认识</p>
            </div>

            <div className={`live-scene scene-interest ${activeScene === 2 ? "active" : ""}`} aria-hidden={activeScene !== 2}>
              <h3>兴趣局</h3>
              <svg viewBox="0 0 520 520" aria-hidden="true">
                <g className="scene-figure interest-left" transform="translate(65 234) rotate(-9 42 66)">
                  <path d="M23 29 C25 12 57 8 68 24 C75 36 65 51 49 52 C33 53 20 44 23 29Z" />
                  <path d="M28 27 C41 21 57 22 68 29" />
                  <path d="M34 54 C22 64 21 82 31 95 C42 105 62 103 72 91 C78 79 72 64 61 54" />
                  <path d="M33 93 L24 124 M68 94 L77 123 M44 103 L42 131" />
                </g>
                <g className="scene-figure interest-top" transform="translate(221 102) rotate(3 42 66)">
                  <path d="M23 29 C25 12 57 8 68 24 C75 36 65 51 49 52 C33 53 20 44 23 29Z" />
                  <path d="M28 27 C41 21 57 22 68 29" />
                  <path d="M34 54 C22 64 21 82 31 95 C42 105 62 103 72 91 C78 79 72 64 61 54" />
                  <path d="M33 93 L24 124 M68 94 L77 123 M44 103 L42 131" />
                </g>
                <g className="scene-figure interest-right" transform="translate(371 246) rotate(8 42 66)">
                  <path d="M23 29 C25 12 57 8 68 24 C75 36 65 51 49 52 C33 53 20 44 23 29Z" />
                  <path d="M28 27 C41 21 57 22 68 29" />
                  <path d="M34 54 C22 64 21 82 31 95 C42 105 62 103 72 91 C78 79 72 64 61 54" />
                  <path d="M33 93 L24 124 M68 94 L77 123 M44 103 L42 131" />
                </g>
                <g className="scene-center interest-route">
                  <path d="M194 297 C197 263 224 235 260 235 C298 235 326 263 326 300 C326 338 298 365 259 365 C223 365 196 337 194 297Z" />
                  <path d="M224 299 C240 277 276 277 296 299 C279 321 244 323 224 299Z" />
                  <circle cx="260" cy="299" r="14" />
                  <path d="M218 347 C199 366 191 388 204 405 C221 424 256 406 278 414 C301 423 327 409 333 390" />
                  <circle cx="204" cy="405" r="4" />
                  <circle cx="333" cy="390" r="4" />
                </g>
                <g className="scene-links">
                  <path className="scene-connection connection-a" pathLength="1" d="M146 296 C167 295 181 296 194 298" />
                  <path className="scene-connection connection-b" pathLength="1" d="M263 226 C263 216 263 207 263 195" />
                  <path className="scene-connection connection-c" pathLength="1" d="M326 303 C344 304 361 303 377 301" />
                </g>
              </svg>
              <span className="scene-name name-a">宋屿</span>
              <span className="scene-name name-b">叶青</span>
              <span className="scene-name name-c">闻川</span>
              <span className="scene-link-copy link-a">想加入 · 周末摄影</span>
              <span className="scene-link-copy link-b">同城 · 朝阳出发</span>
              <span className="scene-link-copy link-c">成局 · 城市漫步</span>
              <p className="scene-result">周末摄影 × 同城出发 × 城市漫步</p>
            </div>

            <div className="scene-progress" aria-label="切换现场攒攒场景">
              {["创业局", "婚恋局", "兴趣局"].map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={activeScene === index ? "active" : ""}
                  aria-label={`查看${label}`}
                  aria-pressed={activeScene === index}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveScene(index);
                  }}
                />
              ))}
            </div>
          </div>
          <div className="event-import-copy">
            <h2>把签到表拖进来，<br />现场就知道谁该先聊。</h2>
            <p className="event-import-lead">微信、手机号等联系方式不会发送给模型。</p>
            {error && <div className="event-error" role="alert">{error}</div>}
            <div className="event-import-actions">
              <button type="button" className="highlight-button" onClick={() => fileInputRef.current?.click()} disabled={reading}>{reading ? "正在读取" : "导入活动签到表"}</button>
              <button type="button" className="text-button" onClick={() => resetAnalysis(demoEventGuests, "合成演示数据 · 8 位嘉宾", 0)}>先看演示数据</button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="event-source-bar">
            <div><span>数据源</span><strong>{sourceName}</strong></div>
            <div><span>可参与匹配</span><strong>{guests.length} 位</strong></div>
            <div><span>已排除联系方式</span><strong>{contactColumns} 列</strong></div>
            <div className={`event-agent-state ${provider}`}><span>匹配方式</span><strong>{provider === "agent" ? `Agent · ${providerName || "已配置模型"}` : provider === "local" ? "本地规则降级" : matches.length ? "已完成" : "等待开始"}</strong></div>
            <div className="event-source-actions">
              <button type="button" className="text-button" onClick={() => fileInputRef.current?.click()}>重新导入</button>
              <button type="button" className="highlight-button" onClick={runMatching} disabled={loading}>{loading ? "Agent 分析中" : matches.length ? "重新生成" : "生成对接图"}</button>
            </div>
          </div>

          {error && <div className="event-error source-error" role="alert">{error}</div>}

          <div className="event-workspace">
            <section className="event-graph-panel">
              <div className="event-graph-toolbar">
                <div>
                  <p className="eyebrow">需求与资源</p>
                  <h2>{matches.length ? `${matches.length} 组可解释的对接关系` : `${guests.length} 位嘉宾等待整理`}</h2>
                </div>
                {matches.length > 0 && (
                  <div className="event-filter-row" role="tablist" aria-label="筛选对接关系">
                    {([[
                      "all", "全部"], ["priority", "优先对接"], ["mutual", "双向互补"],
                    ] as Array<[MatchFilter, string]>).map(([value, label]) => (
                      <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="event-graph-scroll">
                <NetworkGraph
                  guests={guests}
                  matches={filteredMatches}
                  selectedGuestId={selectedGuestId}
                  selectedMatchId={selectedMatchId}
                  displayName={displayName}
                  onSelectGuest={selectGuest}
                  onSelectMatch={selectMatch}
                />
                {loading && <div className="event-graph-loading"><span className="agent-stamp"><BrandMark /></span><p>正在比较每个人的需求与资源<span className="thinking-dots">...</span></p></div>}
              </div>
              <div className="event-graph-legend">
                <span><i className="legend-line strong" />优先对接</span>
                <span><i className="legend-line medium" />值得聊</span>
                <span><i className="legend-line light" />共同话题</span>
                <span>箭头：需求 → 资源</span>
              </div>
            </section>

            <aside className="event-inspector" aria-live="polite">{detailContent}</aside>
          </div>

          {matches.length > 0 && (
            <section className="event-match-ledger">
              <div className="section-heading-row">
                <div><p className="eyebrow">建议行动顺序</p><h2>现场引荐顺序</h2></div>
                <span>{connectedGuestIds.size}/{guests.length} 位已进入关系图 · {mutualCount} 组双向互补</span>
              </div>
              <div className="event-match-list">
                {matches.map((match, index) => {
                  const requester = guestMap.get(match.requesterId);
                  const resourceProvider = guestMap.get(match.providerId);
                  if (!requester || !resourceProvider) return null;
                  return (
                    <button key={match.id} type="button" className={`${selectedMatchId === match.id ? "active" : ""} ${introducedIds.includes(match.id) ? "introduced" : ""}`} onClick={() => selectMatch(match.id)}>
                      <span className="match-order">{String(index + 1).padStart(2, "0")}</span>
                      <strong>{displayName(requester)} <i>→</i> {displayName(resourceProvider)}</strong>
                      <span className="match-list-dimensions">{match.dimensions.join(" · ")}</span>
                      <span className={`match-strength strength-${match.strength}`}>{introducedIds.includes(match.id) ? "已引荐" : strengthLabel(match.strength)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
