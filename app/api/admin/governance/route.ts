import { NextResponse } from "next/server";
import { z } from "zod";
import { listTrustReports, setTrustReportStatus } from "@/lib/database";
import { requireAdminSession } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/http-security";

export const runtime = "nodejs";

const schema = z.object({
  reportId: z.string().uuid(),
  status: z.enum(["submitted", "reviewing", "resolved", "rejected"]),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  try {
    await requireAdminSession();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "治理状态不完整。" }, { status: 400 });
    setTrustReportStatus(parsed.data);
    return NextResponse.json({ reports: listTrustReports() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "暂时无法更新。" }, { status: 400 });
  }
}
