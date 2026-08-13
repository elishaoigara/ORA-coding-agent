import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  isAuthorized,
  isPasswordProtectionEnabled,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    authenticated: isAuthorized(request),
    passwordRequired: isPasswordProtectionEnabled(),
  });
}

export async function POST(request: NextRequest) {
  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password === "string") password = body.password;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!verifyPassword(password)) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  setSessionCookie(response);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  clearSessionCookie(response);
  return response;
}
