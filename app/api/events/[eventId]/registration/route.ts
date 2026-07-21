import { NextResponse } from "next/server";
import { z } from "zod";
import { cancelEventRegistration, submitEventRegistration } from "@/lib/database";
import { isSameOriginRequest } from "@/lib/http-security";
import { assertParticipationAllowed, requireUserSession } from "@/lib/user-auth";

export const runtime = "nodejs";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), note: z.string().trim().max(600).default("") }),
  z.object({ action: z.literal("cancel") }),
]);

export async function POST(request: Request, context: { params: Promise<{ eventId: string }> }) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  let session;
  try {
    session = await requireUserSession();
    assertParticipationAllowed(session);
  } catch {
    return NextResponse.json({ error: "登录状态已失效，请重新进入攒攒。" }, { status: 401 });
  }
  const body = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "报名信息不完整。" }, { status: 400 });
  }
  const { eventId } = await context.params;
  try {
    if (body.data.action === "cancel") {
      cancelEventRegistration({ eventId, userId: session.id });
      return NextResponse.json({ registration: null });
    }
    const registration = submitEventRegistration({
      eventId,
      userId: session.id,
      note: body.data.note,
    });
    return NextResponse.json({ registration });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "暂时无法处理报名。",
    }, { status: 400 });
  }
}
