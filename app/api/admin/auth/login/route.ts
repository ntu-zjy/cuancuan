import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_SESSION_COOKIE,
  adminCookieOptions,
  authenticateAdmin,
} from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/http-security";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().email().max(180),
  password: z.string().min(8).max(200),
});

const attempts = new Map<string, { count: number; resetAt: number }>();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "请输入管理员邮箱和密码。" }, { status: 400 });

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const attemptKey = `${forwarded}:${parsed.data.email.toLowerCase()}`;
  const current = attempts.get(attemptKey);
  if (current && current.resetAt > Date.now() && current.count >= 6) {
    return NextResponse.json({ error: "尝试次数过多，请 15 分钟后再试。" }, { status: 429 });
  }

  const result = authenticateAdmin(parsed.data.email, parsed.data.password);
  if (!result) {
    attempts.set(attemptKey, {
      count: current && current.resetAt > Date.now() ? current.count + 1 : 1,
      resetAt: Date.now() + 15 * 60 * 1000,
    });
    return NextResponse.json({ error: "管理员邮箱或密码不正确。" }, { status: 401 });
  }

  attempts.delete(attemptKey);
  const response = NextResponse.json({ admin: result.admin });
  response.cookies.set(ADMIN_SESSION_COOKIE, result.token, adminCookieOptions());
  return response;
}
