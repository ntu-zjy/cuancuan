import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createUserSession, deleteUserSession, findUserSession } from "./database";

export const USER_SESSION_COOKIE = "cuancuan_user_session";
const USER_SESSION_SECONDS = 60 * 60 * 24 * 30;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function issueUserSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  createUserSession({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + USER_SESSION_SECONDS * 1000).toISOString(),
  });
  return token;
}

export async function destroyUserSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USER_SESSION_COOKIE)?.value;
  if (token) deleteUserSession(hashToken(token));
  cookieStore.delete(USER_SESSION_COOKIE);
}

export async function getUserSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(USER_SESSION_COOKIE)?.value;
  if (!token) return null;
  return findUserSession(hashToken(token)) ?? null;
}

export async function requireUserSession() {
  const session = await getUserSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export function assertParticipationAllowed(session: Awaited<ReturnType<typeof getUserSession>>) {
  if (!session) throw new Error("UNAUTHORIZED");
  if (session.restriction_status === "permanent" || session.restriction_status === "limited") throw new Error("账号当前限制发起、加入和局内互动；你仍可查看资料并提交申诉。");
  if (session.restriction_status === "temporary" && (!session.restricted_until || Date.parse(session.restricted_until) > Date.now())) {
    throw new Error("账号当前处于临时限制期；你仍可查看资料并提交申诉。");
  }
}

export function userCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: USER_SESSION_SECONDS,
  };
}
