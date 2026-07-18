"use client";

import { useCallback, useRef, useState } from "react";
import type { InjectedFile } from "@/types";

interface Props {
  onFilesLoaded: (files: InjectedFile[]) => void;
  /** When true, renders only a paperclip icon button (no drop zone UI) */
  compact?: boolean;
}

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h",
  ".json", ".yaml", ".yml", ".toml", ".xml", ".env", ".env.example",
  ".md", ".mdx", ".txt", ".sh", ".bash", ".zsh", ".fish",
  ".html", ".css", ".scss", ".sass", ".less",
  ".sql", ".graphql", ".prisma",
  ".dockerfile", ".dockerignore", ".gitignore", ".eslintrc", ".prettierrc",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build",
  ".vercel", "coverage", "__pycache__", ".venv", "venv",
]);

function isTextFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.includes(".")) return true;
  const ext = "." + lower.split(".").pop();
  return TEXT_EXTENSIONS.has(ext);
}

async function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function extractZip(file: File): Promise<InjectedFile[]> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const buffer = await readAsArrayBuffer(file);
  const uint8 = new Uint8Array(buffer);
  let unzipped: Record<string, Uint8Array>;
  try { unzipped = unzipSync(uint8); }
  catch { throw new Error(`Could not extract "${file.name}" — is it a valid ZIP?`); }
  const results: InjectedFile[] = [];
  for (const [entryPath, data] of Object.entries(unzipped)) {
    if (entryPath.endsWith("/")) continue;
    const parts = entryPath.split("/");
    if (parts.some((p) => SKIP_DIRS.has(p))) continue;
    const name = parts[parts.length - 1];
    if (!isTextFile(name)) continue;
    if (data.byteLength > 500_000) continue;
    try { results.push({ path: entryPath, content: strFromU8(data) }); }
    catch { /* binary file */ }
  }
  return results;
}

async function processFile(file: File): Promise<InjectedFile[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) return extractZip(file);
  if (!isTextFile(file.name)) throw new Error(`"${file.name}" is not a supported file type.`);
  if (file.size > 500_000) throw new Error(`"${file.name}" is too large (max 500 KB).`);
  const content = await readAsText(file);
  return [{ path: file.name, content }];
}

export default function LocalFileContext({ onFilesLoaded, compact }: Props) {
  const [dragging, setDragging] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [loaded,   setLoaded]   = useState<{ name: string; count: number }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    setLoading(true);
    setError(null);
    const fileArray = Array.from(files);
    const allInjected: InjectedFile[] = [];
    const summary: { name: string; count: number }[] = [];
    for (const file of fileArray) {
      try {
        const injected = await processFile(file);
        allInjected.push(...injected);
        summary.push({ name: file.name, count: injected.length });
      } catch (e) {
        setError((e as Error).message);
        setLoading(false);
        return;
      }
    }
    onFilesLoaded(allInjected);
    setLoaded((prev) => [...prev, ...summary]);
    setLoading(false);
  }, [onFilesLoaded]);

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setDragging(true); }
  function onDragLeave() { setDragging(false); }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFiles(files);
  }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = "";
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept=".zip,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.kt,.json,.md,.txt,.html,.css,.sql,.sh,.yaml,.yml,.toml,.env"
      onChange={onInputChange}
      className="hidden"
    />
  );

  // ── Compact mode: just a paperclip icon button ──────────────────────────
  if (compact) {
    return (
      <div className="flex-shrink-0">
        {fileInput}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          title={loaded.length > 0 ? `${loaded.length} file(s) attached` : "Attach files or ZIP"}
          className="flex items-center justify-center w-[46px] h-[46px] rounded-xl transition-colors text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 relative"
        >
          {loading ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          )}
          {loaded.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-teal-500 text-[9px] text-white flex items-center justify-center font-bold">
              {loaded.length}
            </span>
          )}
        </button>
        {error && (
          <p className="absolute bottom-full mb-1 left-0 text-xs text-red-400 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 whitespace-nowrap z-50">
            {error}
          </p>
        )}
      </div>
    );
  }

  // ── Full drop zone (desktop settings panel / sidebar) ──────────────────
  return (
    <div className="px-3 py-2">
      {fileInput}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border border-dashed rounded-lg px-4 py-3 cursor-pointer text-center transition-colors select-none ${
          dragging
            ? "border-teal-500 bg-teal-950/40 text-teal-300"
            : "border-zinc-700 hover:border-zinc-500 text-zinc-500 hover:text-zinc-400"
        }`}
      >
        {loading
          ? <span className="text-xs">Extracting files…</span>
          : <span className="text-xs">↓ Drop files or ZIP here<span className="hidden sm:inline text-zinc-600"> — or click to browse</span></span>
        }
      </div>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      {loaded.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {loaded.map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-400">
              <span className="text-teal-400">📁</span>
              {item.name}
              {item.count > 1 && <span className="text-zinc-600">({item.count})</span>}
            </span>
          ))}
          <button
            onClick={(e) => { e.stopPropagation(); setLoaded([]); onFilesLoaded([]); }}
            className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
          >clear</button>
        </div>
      )}
    </div>
  );
}
