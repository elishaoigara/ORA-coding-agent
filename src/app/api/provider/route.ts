import { NextResponse } from "next/server";
import { getAllPublicProviders } from "@/lib/providers";

// Returns ALL configured providers so the UI can build
// the runtime provider + model switcher.
export async function GET() {
  return NextResponse.json(getAllPublicProviders());
}
