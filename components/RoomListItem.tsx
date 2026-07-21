"use client";

import type { Opportunity, OpportunityRegistrationStatus } from "@/lib/types";

type Props = {
  opportunity: Opportunity;
  isHost: boolean;
  registrationStatus?: OpportunityRegistrationStatus;
  onView: () => void;
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

function lifecycleLabel(status?: Opportunity["lifecycleStatus"]) {
  const labels: Record<string, string> = {
    recruiting: "正在招募",
    pending_confirmation: "等待确认",
    formed: "已经成局",
    scheduled: "已经约好",
    in_progress: "正在进行",
    completed: "已经完成",
    cancelled: "已经取消",
    follow_up: "继续联系",
  };
  return labels[status || "recruiting"];
}

function nextStep(opportunity: Opportunity, isHost: boolean, registrationStatus?: OpportunityRegistrationStatus) {
  if (registrationStatus === "pending") return "等待发起人确认";
  if (registrationStatus === "waitlisted") return "候补中，留意通知";

  const steps: Record<string, string> = {
    recruiting: isHost ? "继续邀请合适的人" : "等待成员到齐",
    pending_confirmation: isHost ? "确认成员与安排" : "等待最终确认",
    formed: "确认时间和地点",
    scheduled: "按约定时间见面",
    in_progress: "进入局内沟通",
    completed: "留下这次见面的反馈",
    cancelled: "查看取消说明",
    follow_up: "决定是否继续联系",
  };
  return steps[opportunity.lifecycleStatus || "recruiting"];
}

function priceLabel(opportunity: Opportunity) {
  if (opportunity.price.type === "free") return "免费";
  if (opportunity.price.type === "aa") return "AA 制";
  return opportunity.price.amount ? `¥${opportunity.price.amount}` : opportunity.price.note || "费用待定";
}

export default function RoomListItem({ opportunity, isHost, registrationStatus, onView }: Props) {
  const date = dateParts(opportunity.startsAt);
  const remaining = Math.max(0, opportunity.maxMembers - opportunity.members);

  return (
    <article className="room-list-item">
      <button type="button" onClick={onView} aria-label={`查看${opportunity.title}的进度`}>
        <time className="room-list-date" dateTime={opportunity.startsAt}>
          <span>{date.month}</span>
          <strong>{date.day}</strong>
          <small>{date.weekday}</small>
        </time>

        <div className="room-list-copy">
          <div className="room-list-flags">
            <span>{isHost ? "我发起的" : "我加入的"}</span>
            <span>{opportunity.type}</span>
            <span className={`room-stage room-stage-${opportunity.lifecycleStatus || "recruiting"}`}>
              {lifecycleLabel(opportunity.lifecycleStatus)}
            </span>
          </div>
          <h2>{opportunity.title}</h2>
          <p>{opportunity.summary}</p>
          <div className="room-list-meta">
            <span>{timeRange(opportunity.startsAt, opportunity.endsAt)}</span>
            <span>{opportunity.venue}</span>
            <span>{priceLabel(opportunity)}</span>
          </div>
        </div>

        <div className="room-list-progress">
          <div>
            <span>下一步</span>
            <strong>{nextStep(opportunity, isHost, registrationStatus)}</strong>
          </div>
          <div className="room-list-progress-foot">
            <span className="room-list-people" aria-label={`${opportunity.members} 人已加入`}>
              <i aria-hidden="true">
                {opportunity.people.slice(0, 3).map((person) => <b key={person.name}>{person.name.slice(0, 1)}</b>)}
              </i>
              <span>{opportunity.members} / {opportunity.maxMembers}</span>
              <small>{remaining > 0 ? `还差 ${remaining} 人` : "成员已到齐"}</small>
            </span>
            <span className="room-list-open">查看 <b aria-hidden="true">↗</b></span>
          </div>
        </div>
      </button>
    </article>
  );
}
