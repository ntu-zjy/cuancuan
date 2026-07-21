import { NextResponse } from "next/server";
import { z } from "zod";
import { createTrustReport } from "@/lib/database";
import { getUserSession } from "@/lib/user-auth";
import { isSameOriginRequest } from "@/lib/http-security";

export const runtime = "nodejs";

const schema = z.object({
  type: z.enum(["appeal", "correction", "deletion_request"]),
  details: z.string().trim().min(5).max(1500),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  try {
    const session = await getUserSession();
    if (!session) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "请至少用一句话说明请求。" }, { status: 400 });
    const id = createTrustReport({ reporterUserId: session.id, category: parsed.data.type, details: parsed.data.details });
    return NextResponse.json({ id, message: "请求已提交，管理员会在治理后台处理。" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "暂时无法提交。" }, { status: 400 });
  }
}
