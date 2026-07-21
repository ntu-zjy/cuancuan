import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "@/lib/admin-auth";
import { createInviteCode, updateInviteCode } from "@/lib/database";
import { isSameOriginRequest } from "@/lib/http-security";

export const runtime = "nodejs";

const createSchema = z.object({
  action: z.literal("create"),
  code: z.string().trim().min(4).max(32).regex(/^[A-Za-z0-9_-]+$/),
  maxUses: z.number().int().min(1).max(100000),
});

const toggleSchema = z.object({
  action: z.literal("toggle"),
  code: z.string().min(4).max(32),
  enabled: z.boolean(),
});

const actionSchema = z.discriminatedUnion("action", [createSchema, toggleSchema]);

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "管理员登录已失效。" }, { status: 401 });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "内测码格式不正确。" }, { status: 400 });

  try {
    if (parsed.data.action === "create") {
      createInviteCode(parsed.data.code, parsed.data.maxUses);
    } else {
      updateInviteCode(parsed.data.code, parsed.data.enabled);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE")
      ? "这个内测码已经存在。"
      : "内测码操作失败。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
