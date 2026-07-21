import { NextResponse } from "next/server";
import { z } from "zod";
import {
  addRoomMessage,
  createTrustReport,
  getRoomWorkspace,
  saveEventSettingsForOwner,
  saveRoomFeedback,
  setEventRegistrationStatusForOwner,
  updateRoomStateForOwner,
} from "@/lib/database";
import { isSameOriginRequest } from "@/lib/http-security";
import { assertParticipationAllowed, requireUserSession } from "@/lib/user-auth";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("message"),
    content: z.string().trim().min(1).max(1200),
  }),
  z.object({
    action: z.literal("feedback"),
    attended: z.boolean(),
    outcome: z.enum(["completed", "partial", "not_started"]),
    continueInterest: z.enum(["yes", "maybe", "no"]),
    rating: z.number().int().min(1).max(5),
    notes: z.string().trim().max(800).default(""),
  }),
  z.object({
    action: z.literal("report"),
    reportedUserId: z.string().uuid().optional(),
    category: z.enum(["identity", "no_show", "promotion", "harassment", "false_project", "privacy", "other"]),
    details: z.string().trim().min(5).max(1500),
    evidenceUrl: z.union([z.literal(""), z.string().url().max(1000)]).default(""),
  }),
  z.object({
    action: z.literal("update_state"),
    status: z.enum(["recruiting", "pending_confirmation", "formed", "scheduled", "in_progress", "completed", "cancelled", "follow_up"]),
    scheduledAt: z.string().datetime().optional(),
    location: z.string().trim().max(200).default(""),
    meetingUrl: z.union([z.literal(""), z.string().url().max(1000)]).default(""),
    objective: z.string().trim().max(500).default(""),
    roles: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
    deadline: z.string().datetime().optional(),
    completionCriteria: z.string().trim().max(500).default(""),
    continuationDecision: z.string().trim().max(500).default(""),
  }),
  z.object({
    action: z.literal("settings"),
    registrationMode: z.enum(["instant", "approval"]),
    visibility: z.enum(["public", "invite_only"]),
  }),
  z.object({
    action: z.literal("registration"),
    registrationId: z.string().uuid(),
    status: z.enum(["pending", "confirmed", "waitlisted"]),
  }),
]);

export async function GET(_: Request, context: { params: Promise<{ eventId: string }> }) {
  try {
    const session = await requireUserSession();
    const { eventId } = await context.params;
    return NextResponse.json({ workspace: getRoomWorkspace(session.id, eventId) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "暂时无法读取这个局。",
    }, { status: 400 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  try {
    const session = await requireUserSession();
    const { eventId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "提交内容不完整。" }, { status: 400 });
    }
    if (parsed.data.action !== "report") assertParticipationAllowed(session);
    if (parsed.data.action === "message") {
      return NextResponse.json({ workspace: addRoomMessage({ eventId, userId: session.id, content: parsed.data.content }) });
    }
    if (parsed.data.action === "feedback") {
      return NextResponse.json({ workspace: saveRoomFeedback({ eventId, userId: session.id, ...parsed.data }) });
    }
    if (parsed.data.action === "update_state") {
      return NextResponse.json({ workspace: updateRoomStateForOwner(session.id, { eventId, ...parsed.data }) });
    }
    if (parsed.data.action === "settings") {
      return NextResponse.json({ workspace: saveEventSettingsForOwner({ eventId, userId: session.id, ...parsed.data }) });
    }
    if (parsed.data.action === "registration") {
      return NextResponse.json({ workspace: setEventRegistrationStatusForOwner({ eventId, userId: session.id, ...parsed.data }) });
    }
    const reportId = createTrustReport({
      reporterUserId: session.id,
      reportedUserId: parsed.data.reportedUserId,
      eventId,
      category: parsed.data.category,
      details: parsed.data.details,
      evidenceUrl: parsed.data.evidenceUrl,
    });
    return NextResponse.json({ reportId, message: "举报已经提交，管理员会按治理流程处理。" });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "暂时无法处理。",
    }, { status: 400 });
  }
}
