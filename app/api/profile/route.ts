import { NextResponse } from "next/server";
import { z } from "zod";
import { getTrustSummary, getUserProfile, getUserProfileForSpace, listRelationshipSpaces, updateUserProfileForSpace } from "@/lib/database";
import { DEFAULT_CHANNEL, isChannel } from "@/lib/channels";
import { isSameOriginRequest } from "@/lib/http-security";
import { requireUserSession } from "@/lib/user-auth";

export const runtime = "nodejs";

const presetAvatar = /^\/avatars\/avatar-0[1-6]\.png$/;
const uploadedAvatar = /^data:image\/(?:jpeg|png|webp);base64,/;

const profileSchema = z.object({
  channel: z.string().refine(isChannel),
  nickname: z.string().trim().min(2, "昵称至少需要两个字。").max(30),
  avatar: z.string().max(900_000).refine(
    (value) => presetAvatar.test(value) || uploadedAvatar.test(value),
    "头像格式不支持。",
  ),
  city: z.string().trim().max(40),
  identity: z.string().trim().max(80),
  skills: z.string().trim().max(180),
  offer: z.string().trim().max(180),
  bio: z.string().trim().max(180),
  wechat: z.string().trim().max(60),
});

function publicProfile(record: NonNullable<ReturnType<typeof getUserProfile>>, trust = getTrustSummary(record.id)) {
  return {
    nickname: record.nickname,
    email: record.email,
    avatar: record.avatar,
    city: record.city,
    identity: record.identity,
    skills: record.skills,
    offer: record.offer,
    bio: record.bio,
    wechat: record.wechat,
    trust,
  };
}

export async function GET(request: Request) {
  try {
    const session = await requireUserSession();
    const requestedChannel = new URL(request.url).searchParams.get("channel");
    const channel = requestedChannel && isChannel(requestedChannel) ? requestedChannel : DEFAULT_CHANNEL;
    const profile = getUserProfileForSpace(session.id, channel);
    if (!profile) return NextResponse.json({ error: "用户不存在。" }, { status: 404 });
    return NextResponse.json({ profile: publicProfile(profile), spaces: listRelationshipSpaces(session.id) });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
    return NextResponse.json({ error: unauthorized ? "请先登录。" : "暂时无法读取资料。" }, { status: unauthorized ? 401 : 500 });
  }
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "请求来源无效。" }, { status: 403 });
  }
  try {
    const session = await requireUserSession();
    const parsed = profileSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message || "资料格式不正确。" }, { status: 400 });
    }
    const { channel, ...profileInput } = parsed.data;
    const profile = updateUserProfileForSpace({ id: session.id, channel, ...profileInput });
    return NextResponse.json({ profile: publicProfile(profile) });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
    return NextResponse.json({ error: unauthorized ? "登录已失效，请重新登录。" : "暂时无法保存资料。" }, { status: unauthorized ? 401 : 500 });
  }
}
