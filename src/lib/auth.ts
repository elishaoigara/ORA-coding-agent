import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const AUTH_COOKIE = "ora_session";
const SESSION_DAYS = 30;

function configuredPassword(): string | null {
  const password = process.env.APP_PASSWORD?.trim();
  return password || null;
}

function sessionToken(password: string): string {
  return createHash("sha256")
    .update(`ora-coding-agent:${password}`, "utf-8")
    .digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isPasswordProtectionEnabled(): boolean {
  return configuredPassword() !== null;
}

export function verifyPassword(candidate: string): boolean {
  const password = configuredPassword();
  if (!password) return true;
  return safeEqual(sessionToken(candidate), sessionToken(password));
}

export function isAuthorized(request: NextRequest): boolean {
  const password = configuredPassword();
  if (!password) return true;

  const session = request.cookies.get(AUTH_COOKIE)?.value;
  return Boolean(session && safeEqual(session, sessionToken(password)));
}

export function requireAuth(request: NextRequest): NextResponse | null {
  return isAuthorized(request)
    ? null
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function setSessionCookie(response: NextResponse): void {
  const password = configuredPassword();
  if (!password) return;
  response.cookies.set(AUTH_COOKIE, sessionToken(password), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
