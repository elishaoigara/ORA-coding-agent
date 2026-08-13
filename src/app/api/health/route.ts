import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { checkEnv } from "@/lib/env";
import { getAllPublicProviders } from "@/lib/providers";

/** Returns deployment diagnostics without exposing secret values. */
export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;

  const env = checkEnv();
  const providers = getAllPublicProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    configured: provider.configured,
  }));

  return NextResponse.json({
    ok: env.ok,
    providers,
    checks: env.checks.map((check) => ({
      key: check.key,
      present: check.present,
      description: check.description,
    })),
    warnings: env.warnings,
    timestamp: new Date().toISOString(),
  });
}
