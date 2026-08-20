import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { profileSyncSchema, validateOr400, type ProfileSyncRequest } from "@/lib/validation";

const PAT = process.env.GITHUB_PAT ?? "";
const DESCRIPTION = "ORA Coding Agent – personal profile";
const PROFILE_FILE = "ora-profile.json";
const MAX_TOTAL_BYTES = 900_000;

type SoundPack = ProfileSyncRequest["soundPacks"][number];
type ProfilePayload = { updatedAt: number; appearance: ProfileSyncRequest["appearance"]; soundPacks: Array<Omit<SoundPack, "dataUrl"> & { file: string }>; customPromptTemplates?: ProfileSyncRequest["customPromptTemplates"] };
type GistFile = { content?: string };
type Gist = { id: string; files: Record<string, GistFile> };

function headers() {
  return { Authorization: `Bearer ${PAT}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
}

async function getGist(id: string): Promise<Gist | null> {
  try {
    const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(id)}`, { headers: headers(), cache: "no-store" });
    return response.ok ? await response.json() as Gist : null;
  } catch { return null; }
}

async function discoverGist(): Promise<Gist | null> {
  try {
    const response = await fetch("https://api.github.com/gists?per_page=100", { headers: headers(), cache: "no-store" });
    if (!response.ok) return null;
    const gists = await response.json() as Array<{ id: string; description?: string }>;
    const match = gists.find((item) => item.description === DESCRIPTION);
    return match ? getGist(match.id) : null;
  } catch { return null; }
}

function parseProfile(gist: Gist | null): ProfilePayload | null {
  if (!gist) return null;
  try {
    const parsed = JSON.parse(gist.files?.[PROFILE_FILE]?.content ?? "null") as ProfilePayload;
    if (!parsed || !parsed.appearance || !Array.isArray(parsed.soundPacks)) return null;
    return parsed;
  } catch { return null; }
}

function hydrateProfile(profile: ProfilePayload | null, gist: Gist | null) {
  if (!profile || !gist) return null;
  return {
    updatedAt: profile.updatedAt,
    appearance: profile.appearance,
    soundPacks: profile.soundPacks.flatMap((pack) => {
      const dataUrl = gist.files?.[pack.file]?.content;
      return dataUrl ? [{ id: pack.id, name: pack.name, mime: pack.mime, dataUrl }] : [];
    }),
    customPromptTemplates: profile.customPromptTemplates ?? [],
  };
}

function profileFiles(payload: ProfileSyncRequest, updatedAt: number) {
  const files: Record<string, { content: string } | null> = {};
  const packs = payload.soundPacks.map((pack) => {
    const safeFile = `ora-sound-${pack.id}.${pack.mime.split("/")[1] === "mpeg" ? "mp3" : pack.mime.split("/")[1]}`;
    files[safeFile] = { content: pack.dataUrl };
    return { id: pack.id, name: pack.name, mime: pack.mime, file: safeFile };
  });
  const profile: ProfilePayload = { updatedAt, appearance: payload.appearance, soundPacks: packs, customPromptTemplates: payload.customPromptTemplates };
  files[PROFILE_FILE] = { content: JSON.stringify(profile, null, 2) };
  return files;
}

async function createGist(payload: ProfileSyncRequest) {
  const response = await fetch("https://api.github.com/gists", { method: "POST", headers: headers(), body: JSON.stringify({ description: DESCRIPTION, public: false, files: profileFiles(payload, Date.now()) }) });
  if (!response.ok) return null;
  return await response.json() as Gist;
}

async function patchGist(id: string, payload: ProfileSyncRequest, previous: Gist | null) {
  const files = profileFiles(payload, Date.now());
  for (const name of Object.keys(previous?.files ?? {})) {
    if (name.startsWith("ora-sound-") && !(name in files)) files[name] = null;
  }
  const response = await fetch(`https://api.github.com/gists/${encodeURIComponent(id)}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ files }) });
  return response.ok ? await response.json() as Gist : null;
}

export async function GET(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  if (!PAT) return NextResponse.json({ configured: false, gistId: null, profile: null });
  const requestedId = request.nextUrl.searchParams.get("gistId");
  const gist = (requestedId ? await getGist(requestedId) : null) ?? await discoverGist();
  return NextResponse.json({ configured: true, gistId: gist?.id ?? null, profile: hydrateProfile(parseProfile(gist), gist) });
}

export async function POST(request: NextRequest) {
  const unauthorized = requireAuth(request);
  if (unauthorized) return unauthorized;
  if (!PAT) return NextResponse.json({ configured: false, gistId: null, profile: null });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = validateOr400(profileSyncSchema, raw);
  if (parsed instanceof NextResponse) return parsed;
  const payload = parsed as ProfileSyncRequest;
  const totalBytes = payload.soundPacks.reduce((sum, pack) => sum + pack.dataUrl.length, 0);
  if (totalBytes > MAX_TOTAL_BYTES) return NextResponse.json({ error: "Sound packs exceed the 900KB profile limit" }, { status: 413 });

  let gist = payload.gistId ? await getGist(payload.gistId) : null;
  if (!gist) gist = await discoverGist();
  const next = gist ? await patchGist(gist.id, payload, gist) : await createGist(payload);
  if (!next) return NextResponse.json({ error: "Unable to read or update the private GitHub Gist. Confirm the token has gist scope." }, { status: 502 });
  return NextResponse.json({ configured: true, gistId: next.id, profile: hydrateProfile(parseProfile(next), next) });
}
