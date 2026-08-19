import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export type TerminalSessionStatus = "ready" | "running" | "stopped" | "error";
export type TerminalStreamKind = "stdout" | "stderr" | "system" | "result";

export interface TerminalSession {
  id: string;
  repo: string;
  branch?: string;
  cwd: string;
  status: TerminalSessionStatus;
  createdAt: number;
  lastActivityAt: number;
  commandCount: number;
  process?: ChildProcessWithoutNullStreams;
}

export interface TerminalEvent {
  kind: TerminalStreamKind;
  text: string;
  command?: string;
  exitCode?: number | null;
  timestamp: number;
}

export interface VerificationStep {
  id: "lint" | "typecheck" | "test" | "build";
  label: string;
  command: string;
}

const sessions = new Map<string, TerminalSession>();
const MAX_SESSIONS = 12;
const SESSION_TTL_MS = 30 * 60 * 1000;
const COMMAND_TIMEOUT_MS = 180_000;
const WORKSPACE_ROOT = "/tmp/ora-workspaces";

const VERIFICATION_STEPS: VerificationStep[] = [
  { id: "lint", label: "Lint", command: "npm run lint" },
  { id: "typecheck", label: "Typecheck", command: "npm run typecheck" },
  { id: "test", label: "Tests", command: "npm run test" },
  { id: "build", label: "Build", command: "npm run build" },
];

const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/\brm\s+-rf\b/i, "recursive force deletion is blocked"],
  [/(^|\s)(sudo|su)\b/i, "privilege escalation is blocked"],
  [/(^|\s)(shutdown|reboot|mkfs|mount|umount)\b/i, "system administration commands are blocked"],
  [/(^|\s)(curl|wget)\s+[^|\n]*\|\s*(sh|bash)\b/i, "remote script execution is blocked"],
  [/\b(git\s+push|git\s+reset\s+--hard|git\s+clean\s+-fd)\b/i, "destructive or remote Git operations require the GitHub workflow"],
  [/(drop|truncate)\s+(database|table|schema)/i, "destructive database operations are blocked"],
];

function now() { return Date.now(); }

function safeRepo(repo: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Repository must use the owner/name format");
  return repo;
}

export function validateTerminalCommand(command: string): { valid: true } | { valid: false; reason: string } {
  const trimmed = command.trim();
  if (!trimmed) return { valid: false, reason: "Command cannot be empty" };
  if (trimmed.length > 2000) return { valid: false, reason: "Command is too long" };
  for (const [pattern, reason] of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) return { valid: false, reason };
  }
  return { valid: true };
}

function emit(onEvent: (event: TerminalEvent) => void, kind: TerminalStreamKind, text: string, extra: Partial<TerminalEvent> = {}) {
  if (!text) return;
  onEvent({ kind, text, timestamp: now(), ...extra });
}

async function cleanupExpiredSessions() {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastActivityAt < cutoff && !session.process) {
      sessions.delete(id);
      await rm(session.cwd, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function createTerminalSession(repoInput: string, branch: string | undefined, onEvent: (event: TerminalEvent) => void): Promise<TerminalSession> {
  await cleanupExpiredSessions();
  if (sessions.size >= MAX_SESSIONS) throw new Error("Terminal session capacity reached; stop an idle session and try again");
  const repo = safeRepo(repoInput);
  const token = process.env.GITHUB_PAT;
  if (!token) throw new Error("GITHUB_PAT is required to create a terminal workspace");

  const id = crypto.randomUUID();
  const cwd = path.join(WORKSPACE_ROOT, id);
  await mkdir(WORKSPACE_ROOT, { recursive: true });
  const session: TerminalSession = {
    id, repo, branch, cwd, status: "running", createdAt: now(), lastActivityAt: now(), commandCount: 0,
  };
  sessions.set(id, session);
  emit(onEvent, "system", `Preparing workspace for ${repo}`);

  const cloneUrl = `https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`;
  const cloneArgs = ["clone", "--depth=1", ...(branch ? ["--branch", branch] : []), cloneUrl, cwd];
  await runProcess(session, "git", cloneArgs, onEvent, 180_000, true);
  session.status = "ready";
  session.lastActivityAt = now();
  emit(onEvent, "system", `Workspace ready at ${repo}${branch ? ` · ${branch}` : ""}`);
  return { ...session, process: undefined };
}

export function getTerminalSession(id: string): TerminalSession | undefined {
  const session = sessions.get(id);
  if (session) session.lastActivityAt = now();
  return session;
}

export async function stopTerminalSession(id: string): Promise<boolean> {
  const session = sessions.get(id);
  if (!session) return false;
  session.process?.kill("SIGTERM");
  session.process = undefined;
  session.status = "stopped";
  await rm(session.cwd, { recursive: true, force: true }).catch(() => undefined);
  sessions.delete(id);
  return true;
}

function runProcess(
  session: TerminalSession,
  command: string,
  args: string[],
  onEvent: (event: TerminalEvent) => void,
  timeoutMs = COMMAND_TIMEOUT_MS,
  isSetup = false,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: isSetup ? undefined : session.cwd, env: { ...process.env, CI: "1", FORCE_COLOR: "0" }, shell: false });
    session.process = child;
    session.status = "running";
    session.lastActivityAt = now();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      settled = true;
      session.process = undefined;
      session.status = "error";
      emit(onEvent, "stderr", `Command timed out after ${Math.round(timeoutMs / 1000)}s`);
      reject(new Error("Terminal command timed out"));
    }, timeoutMs);

    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.process = undefined;
      session.lastActivityAt = now();
      session.status = code === 0 ? "ready" : "error";
      emit(onEvent, "result", code === 0 ? "Command completed successfully" : `Command exited with code ${code}`, { exitCode: code });
      resolve(code);
    };

    child.stdout.on("data", (chunk: Buffer) => emit(onEvent, "stdout", chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => emit(onEvent, "stderr", chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      session.process = undefined;
      session.status = "error";
      if (!settled) { settled = true; reject(error); }
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

export async function executeTerminalCommand(id: string, input: string, onEvent: (event: TerminalEvent) => void): Promise<number> {
  const session = sessions.get(id);
  if (!session) throw new Error("Terminal session not found or expired");
  const check = validateTerminalCommand(input);
  if (!check.valid) throw new Error(check.reason);
  if (session.process) throw new Error("Another terminal command is already running");
  session.commandCount += 1;
  session.lastActivityAt = now();
  emit(onEvent, "system", `$ ${input}`, { command: input });
  return runProcess(session, "bash", ["-lc", input], onEvent);
}

export interface WorkspacePatch { path: string; content: string; action?: "create" | "modify" | "delete"; }

function safeWorkspacePath(cwd: string, filePath: string): string {
  const normalized = path.posix.normalize(`/${filePath}`).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("..") || normalized.includes("/../") || normalized.startsWith(".git/")) {
    throw new Error(`Unsafe workspace path: ${filePath}`);
  }
  return path.join(cwd, normalized);
}

export async function applyWorkspacePatches(id: string, patches: WorkspacePatch[], onEvent: (event: TerminalEvent) => void): Promise<number> {
  const session = sessions.get(id);
  if (!session) throw new Error("Terminal session not found or expired");
  if (session.process) throw new Error("Stop the active command before applying patches");
  if (!Array.isArray(patches) || patches.length === 0) throw new Error("At least one patch is required");
  if (patches.length > 32) throw new Error("A repair batch cannot modify more than 32 files");
  const seen = new Set<string>();
  for (const patch of patches) {
    if (!patch || typeof patch.path !== "string" || seen.has(patch.path)) throw new Error("Repair batch contains an invalid or duplicate path");
    seen.add(patch.path);
    const target = safeWorkspacePath(session.cwd, patch.path);
    if (patch.action === "delete") {
      await rm(target, { force: true });
      emit(onEvent, "system", `Deleted ${patch.path}`);
    } else {
      if (typeof patch.content !== "string" || patch.content.length > 2_000_000) throw new Error(`Invalid content for ${patch.path}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, patch.content, "utf8");
      emit(onEvent, "system", `Applied ${patch.path}`);
    }
  }
  session.lastActivityAt = now();
  return patches.length;
}

export async function runVerification(id: string, onEvent: (event: TerminalEvent) => void): Promise<{ passed: boolean; steps: Array<VerificationStep & { exitCode: number; passed: boolean }> }> {
  const session = sessions.get(id);
  if (!session) throw new Error("Terminal session not found or expired");
  const results: Array<VerificationStep & { exitCode: number; passed: boolean }> = [];
  emit(onEvent, "system", "Starting verification pipeline: lint → typecheck → test → build");
  for (const step of VERIFICATION_STEPS) {
    const packageJsonCheck = await executeTerminalCommand(id, `node -e "const p=require('./package.json'); process.exit(p.scripts?.${step.id} ? 0 : 1)"`, () => undefined).catch(() => 1);
    if (packageJsonCheck !== 0) {
      emit(onEvent, "system", `${step.label} skipped: npm script not defined`);
      results.push({ ...step, exitCode: 0, passed: true });
      continue;
    }
    emit(onEvent, "system", `Running ${step.label}: ${step.command}`);
    const exitCode = await executeTerminalCommand(id, step.command, onEvent).catch(() => 1);
    const passed = exitCode === 0;
    results.push({ ...step, exitCode, passed });
    if (!passed) {
      emit(onEvent, "stderr", `${step.label} failed; stopping verification so the agent can inspect the failure`);
      break;
    }
  }
  const passed = results.every((step) => step.passed);
  emit(onEvent, "result", passed ? "Verification pipeline passed" : "Verification pipeline needs repair", { exitCode: passed ? 0 : 1 });
  return { passed, steps: results };
}

export function listVerificationSteps() { return VERIFICATION_STEPS; }
