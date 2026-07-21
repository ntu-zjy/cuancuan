import { NextResponse } from "next/server";
import { destroyAdminSession } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/http-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  await destroyAdminSession();
  return NextResponse.json({ ok: true });
}
