import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import {
  createAdminSession,
  createAdminUser,
  deleteAdminSession,
  findAdminByEmail,
  findAdminSession,
  touchAdminLogin,
} from "./database";

export const ADMIN_SESSION_COOKIE = "cuancuan_admin_session";
export const ADMIN_SESSION_SECONDS = 60 * 60 * 12;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function passwordHash(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
    || (process.env.NODE_ENV === "production" ? "" : "admin@cuancuan.local");
  const password = process.env.ADMIN_PASSWORD?.trim()
    || (process.env.NODE_ENV === "production" ? "" : "CuancuanAdmin2026!");
  if (!email || !password) return null;
  const existing = findAdminByEmail(email);
  if (existing) return existing;
  const salt = randomBytes(16).toString("hex");
  createAdminUser({ email, passwordHash: passwordHash(password, salt), passwordSalt: salt });
  return findAdminByEmail(email) ?? null;
}

export function authenticateAdmin(email: string, password: string) {
  bootstrapAdmin();
  const admin = findAdminByEmail(email);
  if (!admin) return null;
  const expected = Buffer.from(admin.password_hash, "hex");
  const received = Buffer.from(passwordHash(password, admin.password_salt), "hex");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000).toISOString();
  createAdminSession({ adminUserId: admin.id, tokenHash: tokenHash(token), expiresAt });
  touchAdminLogin(admin.id);
  return { token, admin: { id: admin.id, email: admin.email, role: admin.role } };
}

export async function getAdminSession() {
  const token = (await cookies()).get(ADMIN_SESSION_COOKIE)?.value;
  if (!token) return null;
  return findAdminSession(tokenHash(token)) ?? null;
}

export async function destroyAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (token) deleteAdminSession(tokenHash(token));
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

export async function requireAdminSession() {
  const session = await getAdminSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  };
}

export function getLocalAdminHint() {
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD) return null;
  return {
    email: "admin@cuancuan.local",
    password: "CuancuanAdmin2026!",
  };
}
