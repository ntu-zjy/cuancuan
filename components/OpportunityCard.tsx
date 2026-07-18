"use client";

import type { Opportunity } from "@/lib/types";

type Props = {
  opportunity: Opportunity;
  joined: boolean;
  compact?: boolean;
  onView: () => void;
  onToggleJoin: () => void;
};

export default function OpportunityCard({ opportunity, joined, compact, onView, onToggleJoin }: Props) {
  const full = opportunity.members >= opportunity.maxMembers && !joined;
  const memberCount = opportunity.members + (joined ? 1 : 0);

  return (
    <article className={`opportunity-card ${compact ? "compact" : ""}`}>
      <div className="opportunity-meta">
        <span>{opportunity.type}</span>
        <span>{opportunity.scene === "startup" ? "工作与共创" : "关系与交友"}</span>
      </div>
      <h3>{opportunity.title}</h3>
      <p className="opportunity-summary">{opportunity.summary}</p>
      <div className="tag-row">
        {opportunity.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <div className="capacity-line">
        <span><strong>{memberCount}</strong> / {opportunity.maxMembers} 人</span>
        <span>{memberCount >= opportunity.minMembers ? "已成局" : `还差 ${opportunity.minMembers - memberCount} 人成局`}</span>
      </div>
      {!compact && (
        <div className="match-reason">
          <span>为什么值得看看</span>
          <p>{opportunity.reason}</p>
        </div>
      )}
      <div className="card-actions">
        <button type="button" className="text-button" onClick={onView}>查看详情</button>
        <button
          type="button"
          className={joined ? "secondary-button small" : "primary-button small"}
          onClick={onToggleJoin}
          disabled={full}
        >
          {joined ? "已加入 · 退出" : full ? "人数已满" : "加入这个局"}
        </button>
      </div>
    </article>
  );
}
