"use client";

/**
 * LocalFileContext — drag & drop (or click-to-browse) local files into the agent.
 *
 * Supported inputs
 *   • Individual text/code files (.ts, .tsx, .js, .py, .json, .md, .txt, …)
 *   • ZIP archives — all text files inside are extracted and injected
 *
 * Dependencies: `npm install fflate`
 * fflate (~14 kB gzipped) is the fastest pure-JS zip parser; no WASM needed.
 */

import { useCallback, useRef, useState } from "react";
import type { InjectedFile } from "@/types";

interface Props {
  onFilesLoaded: (files: InjectedFile[]) => void;
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
  // Files with no extension that are likely text (Makefile, Dockerfile, etc.)
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
  // Lazy-load fflate so the rest of the app pays no bundle cost if unused
  const { unzipSync, strFromU8 } = await import("fflate");

  const buffer = await readAsArrayBuffer(file);
  const uint8 = new Uint8Array(buffer);

  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(uint8);
  } catch {
    throw new Error(`Could not extract "${file.name}" — is it a valid ZIP?`);
  }

  const results: InjectedFile[] = [];

  for (const [entryPath, data] of Object.entries(unzipped)) {
    // Skip directories (end with /)
    if (entryPath.endsWith("/")) continue;

    // Skip junk directories
    const parts = entryPath.split("/");
    if (parts.some((p) => SKIP_DIRS.has(p))) continue;

    const name = parts[parts.length - 1];
    if (!isTextFile(name)) continue;

    // Skip very large files (>500 KB uncompressed)
    if (data.byteLength > 500_000) continue;

    try {
      const content = strFromU8(data);
      results.push({ path: entryPath, content, repo: `local:${file.name}` });
    } catch {
      // Binary file disguised as text — skip
    }
  }

  return results;
}

async function processFile(file: File): Promise<InjectedFile[]> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".zip")) {
    return extractZip(file);
  }

  if (!isTextFile(file.name)) {
    throw new Error(`"${file.name}" is not a supported file type.`);
  }

  if (file.size > 500_000) {
    throw new Error(`"${file.name}" is too large (max 500 KB).`);
  }

  const content = await readAsText(file);
  return [{ path: file.name, content, repo: "local" }];
}

export default function LocalFileContext({ onFilesLoaded }: Props) {
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

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function onDragLeave() {
    setDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFiles(files);
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = "";
  }

  return (
    <div className="px-3 py-2">
      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`
          border border-dashed rounded-lg px-4 py-3 cursor-pointer text-center
          transition-colors select-none
          ${dragging
            ? "border-teal-500 bg-teal-950/40 text-teal-300"
            : "border-zinc-700 hover:border-zinc-500 text-zinc-500 hover:text-zinc-400"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".zip,.ts,.tsx,.js,.jsx,.py,.go,.rs,.java,.kt,.json,.md,.txt,.html,.css,.sql,.sh,.yaml,.yml,.toml,.env"
          onChange={onInputChange}
          className="hidden"
        />

        {loading ? (
          <span className="text-xs">⟳ Extracting files…</span>
        ) : (
          <span className="text-xs">
            ↓ Drop files or ZIP here
            <span className="hidden sm:inline text-zinc-600"> — or click to browse</span>
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="mt-1.5 text-xs text-red-400">{error}</p>
      )}

      {/* Loaded file list */}
      {loaded.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {loaded.map((item, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-400"
            >
              <span className="text-teal-400">📁</span>
              {item.name}
              {item.count > 1 && (
                <span className="text-zinc-600">({item.count} files)</span>
              )}
            </span>
          ))}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLoaded([]);
              onFilesLoaded([]);
            }}
            className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
}