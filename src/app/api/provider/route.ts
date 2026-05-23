import { NextResponse } from "next/server";
import { getPublicProviderInfo } from "@/lib/providers";

export async function GET() {
  return NextResponse.json(getPublicProviderInfo());
}
