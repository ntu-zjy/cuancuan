import { NextResponse } from "next/server";
import { z } from "zod";
import { createEventForUser, getUserProfileForSpace, listEventsForUser } from "@/lib/database";
import { CHANNELS, isChannel } from "@/lib/channels";
import { isSameOriginRequest } from "@/lib/http-security";
import { assertParticipationAllowed, requireUserSession } from "@/lib/user-auth";
import type { Channel, Intent, Opportunity } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireUserSession();
    return NextResponse.json({ events: listEventsForUser(session.id) });
  } catch {
    return NextResponse.json({ error: "登录状态已失效，请重新进入攒攒。" }, { status: 401 });
  }
}

const createSchema = z.object({
  channel: z.string().refine(isChannel),
  intent: z.object({
    title: z.string().trim().min(2).max(100),
    summary: z.string().trim().min(5).max(700),
    target: z.string().trim().min(2).max(300),
    context: z.string().trim().max(300).optional(),
    offer: z.string().trim().min(2).max(300),
    commitment: z.string().trim().max(300).optional(),
    constraints: z.string().trim().max(300).optional(),
    validity: z.string().trim().max(100),
  }),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  try {
    const session = await requireUserSession();
    assertParticipationAllowed(session);
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "发起局的信息不完整。" }, { status: 400 });
    const channel = parsed.data.channel as Channel;
    const profile = getUserProfileForSpace(session.id, channel);
    if (!profile) return NextResponse.json({ error: "请先完善资料。" }, { status: 404 });
    const intent = parsed.data.intent as Omit<Intent, "scene">;
    const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    startsAt.setHours(19, 30, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
    const isWorkTrial = channel === "founder" || channel === "jobs";
    const event: Opportunity = {
      id: "pending",
      scene: CHANNELS[channel].scene,
      channel,
      type: channel === "founder" ? "发起试合作" : channel === "play" ? "发起活动" : channel === "love" ? "发起认识" : channel === "capital" ? "发起创投交流" : channel === "travel" ? "发起旅行同行" : "发起职业沟通",
      title: intent.title,
      summary: intent.summary,
      description: `${intent.target}。${intent.context || ""} ${intent.constraints || ""}`.trim(),
      tags: ["新发起", CHANNELS[channel].shortName, "开放加入"],
      members: 0,
      minMembers: 2,
      maxMembers: channel === "play" ? 6 : channel === "founder" ? 4 : channel === "capital" ? 3 : channel === "travel" ? 4 : 2,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      registrationDeadline: new Date(startsAt.getTime() - 4 * 60 * 60 * 1000).toISOString(),
      cancellationDeadline: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000).toISOString(),
      city: profile.city || "城市待确认",
      venue: "地点确认后公布",
      address: "确认加入后开放具体地址",
      price: { type: "free", note: "如产生消费，各自承担" },
      organizer: { name: profile.nickname, role: "发起人", verified: true },
      registrationMode: "approval",
      visibility: "public",
      lifecycleStatus: "recruiting",
      agenda: ["彼此介绍当前处境", "对齐真实目标和边界", "确认时间、地点与下一步"],
      notices: ["联系方式双向同意后解锁", "活动前一天仍可取消"],
      reason: "这个局来自发起人已确认的真实意图。",
      observation: "新局仍需等待合适成员，并在成立前再次确认边界。",
      trialPlan: isWorkTrial ? {
        objective: intent.target,
        roles: [profile.identity || "发起人", "待补充角色"],
        deadline: endsAt.toISOString(),
        completionCriteria: "完成一个可验证的小结果，并共同决定是否继续合作。",
      } : undefined,
      people: [{ name: profile.nickname, summary: profile.bio || profile.identity || "发起人", offer: intent.offer }],
    };
    const created = createEventForUser({ userId: session.id, event });
    return NextResponse.json({ event: created, events: listEventsForUser(session.id) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "暂时无法发起新局。" }, { status: 400 });
  }
}
