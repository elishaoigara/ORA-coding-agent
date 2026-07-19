import { NextResponse } from "next/server";
import { checkEnv } from "@/lib/env";
import { getAllPublicProviders } from "@/lib/providers";

/**
 * Lightweight, no-secrets-leaked diagnostic endpoint. Returns which env vars
 * are set (never their values) and which providers are usable, so a
 * misconfigured deployment can be debugged from the browser instead of
 * digging through Vercel logs.
 */
export async function GET() {
  const env = checkEnv();
  const providers = getAllPublicProviders().map((p) => ({
    id: p.id,
    name: p.name,
    configured: p.configured,
  }));

  return NextResponse.json({
    ok: env.ok,
    providers,
    checks: env.checks.map((c) => ({ key: c.key, present: c.present, description: c.description })),
    warnings: env.warnings,
    timestamp: new Date().toISOString(),
  });
}
