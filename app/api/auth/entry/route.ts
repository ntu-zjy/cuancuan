import { NextResponse } from "next/server";
import { z } from "zod";
import { registerOrLoginUser } from "@/lib/database";
import { isSameOriginRequest } from "@/lib/http-security";
import { issueUserSession, USER_SESSION_COOKIE, userCookieOptions } from "@/lib/user-auth";

export const runtime = "nodejs";

const entrySchema = z.object({
  mode: z.enum(["register", "login"]),
  email: z.string().email().max(180),
  nickname: z.string().trim().max(60).optional(),
  inviteCode: z.string().trim().max(32).optional(),
  verifyCode: z.string().length(6),
});

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  const parsed = entrySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "注册或登录信息不完整。" }, { status: 400 });
  const expectedVerifyCode = process.env.DEMO_VERIFY_CODE || "888888";
  if (parsed.data.verifyCode !== expectedVerifyCode) {
    return NextResponse.json({ error: "邮箱验证码不正确。" }, { status: 400 });
  }
  if (parsed.data.mode === "register" && (!parsed.data.nickname || parsed.data.nickname.length < 2)) {
    return NextResponse.json({ error: "昵称至少需要两个字。" }, { status: 400 });
  }

  try {
    const user = registerOrLoginUser(parsed.data);
    const response = NextResponse.json({
      profile: {
        nickname: user.nickname,
        email: user.email,
        avatar: user.avatar,
        city: user.city,
        identity: user.identity,
        skills: user.skills,
        offer: user.offer,
        bio: user.bio,
        wechat: user.wechat,
      },
    });
    response.cookies.set(USER_SESSION_COOKIE, issueUserSession(user.id), userCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "暂时无法完成登录。",
    }, { status: 400 });
  }
}
