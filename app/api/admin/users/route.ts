import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminDashboardData, setUserRestriction, setUserTrustVerification } from "@/lib/database";
import { requireAdminSession } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/http-security";

export const runtime = "nodejs";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("restriction"),
    userId: z.string().uuid(),
    status: z.enum(["none", "limited", "temporary", "permanent"]),
    reason: z.string().trim().max(500).default(""),
    restrictedUntil: z.string().datetime().optional(),
  }),
  z.object({
    action: z.literal("verification"),
    userId: z.string().uuid(),
    field: z.enum(["phone", "work", "host", "real_name", "institution"]),
    verified: z.boolean(),
  }),
]);

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  try {
    await requireAdminSession();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "限制设置不完整。" }, { status: 400 });
    if (parsed.data.action === "verification") {
      setUserTrustVerification(parsed.data);
    } else {
      setUserRestriction({
        ...parsed.data,
        restrictedUntil: parsed.data.status === "temporary"
          ? parsed.data.restrictedUntil || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          : undefined,
      });
    }
    return NextResponse.json({ users: getAdminDashboardData().users });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "暂时无法更新用户状态。" }, { status: 400 });
  }
}
