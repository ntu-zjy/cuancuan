"use client";

import type { Opportunity, OpportunityRegistrationStatus } from "@/lib/types";

type Props = {
  opportunity: Opportunity;
  joined: boolean;
  registrationStatus?: OpportunityRegistrationStatus;
  compact?: boolean;
  onView: () => void;
  onToggleJoin: () => void;
};

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function dateParts(value: string) {
  const date = new Date(value);
  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: `${date.getMonth() + 1} 月`,
    weekday: WEEKDAYS[date.getDay()],
  };
}

function timeRange(start: string, end: string) {
  const format = (value: string) => new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
  return `${format(start)}—${format(end)}`;
}

function priceLabel(opportunity: Opportunity) {
  if (opportunity.price.type === "free") return "免费";
  if (opportunity.price.type === "aa") return "AA 制";
  return opportunity.price.amount ? `¥${opportunity.price.amount}` : opportunity.price.note || "费用待定";
}

function statusLabel(status?: OpportunityRegistrationStatus) {
  if (status === "confirmed") return "已确认";
  if (status === "pending") return "待确认";
  if (status === "waitlisted") return "候补中";
  return "";
}

function lifecycleLabel(status?: Opportunity["lifecycleStatus"]) {
  const labels: Record<string, string> = {
    recruiting: "招募中",
    pending_confirmation: "待确认",
    formed: "已成立",
    scheduled: "已预约",
    in_progress: "进行中",
    completed: "已完成",
    cancelled: "已取消",
    follow_up: "后续连接",
  };
  return labels[status || "recruiting"];
}

export default function OpportunityCard({
  opportunity,
  joined,
  registrationStatus,
  compact,
  onView,
  onToggleJoin,
}: Props) {
  const full = opportunity.members >= opportunity.maxMembers && !joined;
  const date = dateParts(opportunity.startsAt);
  const remaining = Math.max(0, opportunity.maxMembers - opportunity.members);

  return (
    <article className={`opportunity-card event-listing ${compact ? "compact" : ""}`}>
      <button type="button" className="event-listing-main" onClick={onView} aria-label={`查看${opportunity.title}`}>
        <time className="event-date-stamp" dateTime={opportunity.startsAt}>
          <span>{date.month}</span>
          <strong>{date.day}</strong>
          <small>{date.weekday}</small>
        </time>

        <div className="event-listing-copy">
          <div className="opportunity-meta">
            <span>{opportunity.type}</span>
            <span>{opportunity.city}</span>
            <span className="room-lifecycle-chip">{lifecycleLabel(opportunity.lifecycleStatus)}</span>
            {registrationStatus && <span className={`registration-chip ${registrationStatus}`}>{statusLabel(registrationStatus)}</span>}
          </div>
          <h3>{opportunity.title}</h3>
          <p className="opportunity-summary">{opportunity.summary}</p>
          <div className="event-logistics" aria-label="活动时间与地点">
            <span><i>时间</i>{timeRange(opportunity.startsAt, opportunity.endsAt)}</span>
            <span><i>地点</i>{opportunity.venue}{typeof opportunity.distanceKm === "number" ? ` · ${opportunity.distanceKm} km` : ""}</span>
          </div>
          <div className="event-listing-foot">
            <div className="event-attendee-preview" aria-label={`${opportunity.members} 人已在其中`}>
              <span className="attendee-stack" aria-hidden="true">
                {opportunity.people.slice(0, 4).map((person) => <i key={person.name}>{person.name.slice(0, 1)}</i>)}
              </span>
              <strong>{opportunity.members} / {opportunity.maxMembers}</strong>
              <small>{remaining > 0 ? `还可以加入 ${remaining} 人` : "名额已满"}</small>
            </div>
            <span className="event-price">{priceLabel(opportunity)}</span>
          </div>
        </div>
        <span className="event-listing-arrow" aria-hidden="true">↗</span>
      </button>

      {!compact && (
        <div className="match-reason">
          <span>{opportunity.matchInsight ? "攒攒为什么推荐" : "为什么值得看看"}</span>
          <p>{opportunity.matchInsight?.headline || opportunity.reason}</p>
          {opportunity.matchInsight && (
            <ul className="match-evidence-list">
              {opportunity.matchInsight.reasons.slice(0, 2).map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          )}
        </div>
      )}

      <div className="event-listing-actions">
        <button type="button" className="text-button" onClick={onView}>查看详情</button>
        <button
          type="button"
          className={joined ? "secondary-button" : "highlight-button"}
          onClick={onToggleJoin}
          disabled={full}
        >
          {joined ? statusLabel(registrationStatus) || "已加入" : full ? "进入候补" : opportunity.registrationMode === "approval" ? "申请加入" : "确认参加"}
        </button>
      </div>
    </article>
  );
}
