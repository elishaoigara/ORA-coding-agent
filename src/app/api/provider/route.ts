import { NextResponse } from "next/server";
import { getAllPublicProviders } from "@/lib/providers";

// Returns ALL configured providers so the UI can build
// the runtime provider + model switcher.
// Each model now includes contextWindow for token bar display
export async function GET() {
  const providers = getAllPublicProviders();
  return NextResponse.json(providers);
}
