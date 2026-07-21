import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin-auth";
import { getAdminEvents, saveEventJoinChannel, saveEventSettings, setEventRegistrationStatus } from "@/lib/database";
import { isSameOriginRequest } from "@/lib/http-security";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save_channel"),
    eventId: z.string().min(1).max(120),
    type: z.enum(["wecom", "wechat", "none"]),
    label: z.string().trim().min(2).max(80),
    href: z.union([z.literal(""), z.string().url().max(1000)]),
    instructions: z.string().trim().max(500),
    enabled: z.boolean(),
  }),
  z.object({
    action: z.literal("update_registration"),
    eventId: z.string().min(1).max(120),
    registrationId: z.string().uuid(),
    status: z.enum(["pending", "confirmed", "waitlisted"]),
  }),
  z.object({
    action: z.literal("save_settings"),
    eventId: z.string().min(1).max(120),
    registrationMode: z.enum(["instant", "approval"]),
    visibility: z.enum(["public", "invite_only"]),
    lifecycleStatus: z.enum(["recruiting", "pending_confirmation", "formed", "scheduled", "in_progress", "completed", "cancelled", "follow_up"]),
  }),
]);

export async function GET() {
  try {
    await requireAdminSession();
    return NextResponse.json({ events: getAdminEvents() });
  } catch {
    return NextResponse.json({ error: "管理员登录已失效。" }, { status: 401 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "管理员登录已失效。" }, { status: 401 });
  }
  const body = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "活动设置不完整。" }, { status: 400 });
  }
  try {
    if (body.data.action === "save_channel") {
      saveEventJoinChannel(body.data);
    } else if (body.data.action === "update_registration") {
      setEventRegistrationStatus(body.data);
    } else {
      saveEventSettings(body.data);
    }
    return NextResponse.json({ events: getAdminEvents() });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "暂时无法更新活动。",
    }, { status: 400 });
  }
}
