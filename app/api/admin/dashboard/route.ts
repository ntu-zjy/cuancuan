import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { getAdminDashboardData } from "@/lib/database";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdminSession();
    return NextResponse.json(getAdminDashboardData(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "管理员登录已失效。" }, { status: 401 });
  }
}
