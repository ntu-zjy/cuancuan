import { NextResponse } from "next/server";
import { isSameOriginRequest } from "@/lib/http-security";
import { destroyUserSession } from "@/lib/user-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  await destroyUserSession();
  return NextResponse.json({ ok: true });
}
