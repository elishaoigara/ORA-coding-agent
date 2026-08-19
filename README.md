# ORA Coding Agent

ORA is a self-hosted coding agent for GitHub repositories. It can inspect a repository, search and read relevant files, propose a structured plan, wait for approval, stage complete file changes, show diffs, and commit selected changes to a branch.

## What it does

- **Agent workflow:** investigate → plan → approve → implement → review → push
- **Repository tools:** list, search, read, create, modify, and delete files
- **Safe review:** no agent-generated change is pushed automatically
- **Branch-first mode:** optionally create a dedicated `agent/...` branch before planning
- **Chat mode:** stream answers with selected repository and local-file context
- **Provider routing:** automatically choose a configured provider, or select one manually
- **Conversation history:** local storage with optional private GitHub Gist sync
- **Deployment protection:** optional password login backed by an HttpOnly session cookie

> ORA operates through the GitHub API and stages proposed content in the browser. It does not execute untrusted repository code on the server. Run the project’s checks locally or in CI before merging.

## Agent workflow

1. Select a repository in the GitHub panel.
2. Switch from **Chat** to **Agent**.
3. Optionally enable the **⎇ branch-first** safety toggle.
4. Describe the change.
5. ORA explores the repository and returns a file-by-file plan.
6. Approve or reject the plan.
7. Review the staged diffs and select the files to commit.
8. Push to the generated branch or another existing branch.

The agent reads files again before modification, stages complete file contents, rejects obvious truncation placeholders, preserves corrected versions of re-staged files, and resumes long executions in bounded batches.

## Local setup

### Requirements

- Node.js 20.9 or newer
- A key for at least one supported model provider
- A GitHub personal access token for repository features

### Install and run

```bash
npm ci
cp .env.local.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

```env
# Optional deployment password
APP_PASSWORD=choose-a-strong-password

# Configure at least one model provider
GROQ_API_KEY=
DEEPSEEK_API_KEY=
QWEN_API_KEY=
# DASHSCOPE_API_KEY=        # alternate Qwen variable
OPENAI_API_KEY=
OPENROUTER_API_KEY=

# Required for repository browsing, Agent mode, pushes, and Gist sync
GITHUB_PAT=

# Optional per-request agent budget; clamped to 10–280 seconds
AGENT_WATCHDOG_MS=45000
```

For a classic GitHub PAT, grant `repo` for private repositories and `gist` if cross-device history is needed. Use the narrowest permissions appropriate for your deployment.

If `APP_PASSWORD` is omitted, the app is intentionally left without a login gate. When configured, all provider, repository, conversation, and diagnostic API routes require the signed session cookie created by `/api/auth`.

## Quality checks

```bash
npm run lint       # ESLint 9 flat config + Next.js rules
npm run typecheck  # strict TypeScript check
npm test           # Vitest unit tests
npm run build      # production Next.js build
npm run check      # all checks above
```

## Architecture

```text
src/
├── app/
│   ├── api/
│   │   ├── agent/          # thin streaming agent orchestrator
│   │   ├── auth/           # password session endpoint
│   │   ├── chat/           # streaming chat endpoint
│   │   ├── conversations/  # optional GitHub Gist sync
│   │   ├── github/         # browse, branch, and atomic multi-file commits
│   │   ├── health/         # authenticated deployment diagnostics
│   │   └── provider/       # public-safe provider metadata
│   └── page.tsx            # application shell and client workflow
├── components/             # auth, chat, plans, diffs, artifacts, sidebars
├── hooks/                  # conversations and keyboard shortcuts
├── lib/
│   ├── agent/
│   │   ├── githubWorkspace.ts  # repository tool execution
│   │   ├── prompts.ts          # planning and execution contracts
│   │   ├── providerClient.ts   # provider request adapter and timeout
│   │   ├── types.ts            # agent domain types
│   │   └── utils.ts            # plan parsing, continuation, staged-file merge
│   ├── auth.ts             # session verification shared by API routes
│   ├── providers.ts        # provider/model registry
│   ├── readSse.ts          # chunk-safe SSE parser
│   └── validation.ts       # centralized Zod request validation
└── types/                  # shared application types
```

### Agent boundaries

- Planning receives read-only tools.
- Execution receives read and staging tools only after plan approval.
- Tool names are allowlisted by phase on the server.
- Repository paths are normalized and cannot contain `..` traversal segments.
- Files are limited to 2 MB and resumed payloads are schema-validated.
- The selected branch is used for agent reads and later commits.
- GitHub pushes use blobs, a tree, a commit, and a non-forced ref update.

## Providers

Provider definitions live in [`src/lib/providers.ts`](src/lib/providers.ts). ORA currently supports Groq, DeepSeek, Alibaba Cloud Model Studio/Qwen, OpenAI, and OpenRouter through OpenAI-compatible Chat Completions APIs.

Adding a provider requires updating:

1. `ProviderId` and the provider registry in `src/lib/providers.ts`
2. environment checks in `src/lib/env.ts`
3. auto-routing policy in `src/lib/autoRouter.ts` if it should be auto-selected
4. optional cost metadata in `src/lib/tokenCost.ts`
5. `.env.local.example` and this README

## Deploying to Vercel

1. Import the repository into Vercel.
2. Add the same environment variables used locally.
3. Set `APP_PASSWORD` for any internet-accessible deployment.
4. Deploy and verify `/api/health` after signing in.

ORA sets a maximum route duration of 300 seconds for Agent mode and uses continuation batches so long tasks can resume before common serverless request limits.

## Professional agent runtime

ORA now uses a two-phase workflow designed for personal software work: **plan, then execute**. Planning is read-only and must inspect the repository before producing a bounded `<PLAN>` block. Execution accepts only an approved plan, re-reads target files, stages complete file contents, and rejects writes outside the approved file/action boundary.

The runtime profiles each task as a feature, bugfix, refactor, test, documentation, investigation, or mixed task and assigns a low, medium, or high risk level. Every run receives a run ID and reports provider, model, task kind, risk, budget, iteration count, tool-call count, and staged-file count through the event stream. This makes long runs resumable and makes the UI’s progress truthful instead of treating every model response as a successful edit.

### Personal safety controls

The server applies bounded budgets to prevent runaway agent loops. The defaults are 18 iterations, 48 tool calls, and 32 file changes per run. You can override them through `AGENT_MAX_ITERATIONS`, `AGENT_MAX_TOOL_CALLS`, and `AGENT_MAX_CHANGES`; values are clamped to safe server-side ranges. The existing `AGENT_WATCHDOG_MS` controls the time budget for one request batch.

The agent refuses repository traversal paths, protected `.git` and `node_modules` paths, duplicate plan entries, oversized plans, unapproved files, wrong file actions, incomplete staged content, and obvious truncation placeholders. These checks are applied both when a plan is generated and when an approved plan is executed.

### Recommended workflow

Start with a narrow task and let ORA inspect the repository. Review the generated plan carefully, especially for high-risk authentication, dependency, database, deployment, or destructive work. Approve only the files that should change. After execution, inspect the staged diff and run the repository checks before pushing to GitHub. If the run reaches a time or iteration boundary, use the continuation payload rather than starting over; already staged changes are preserved.

### Validation

The repository includes focused guardrail tests in `src/lib/agent/guardrails.test.ts` in addition to the existing workspace, SSE, validation, utility, and staged-change tests. Run `npm run check` to execute linting, strict TypeScript checking, all tests, and the production build.


## ORA v1 Phase 1: Workspace Runtime

ORA now includes a guarded terminal workspace for connected GitHub repositories. Open a repository, select the terminal control in the top bar, and start a workspace. ORA creates an ephemeral repository checkout, streams command output into the terminal panel, and supports a standard verification pipeline.

The verification pipeline runs available package scripts in this order: `lint`, `typecheck`, `test`, and `build`. It stops on the first failure so the agent can inspect the actual output and repair the smallest safe cause before re-running verification.

Terminal commands are subject to safety checks. Recursive force deletion, privilege escalation, remote-script piping, destructive system commands, destructive database operations, and direct remote Git mutation are blocked. Git pushes and pull requests should continue to use the explicit GitHub workflow with user confirmation.

Terminal sessions are currently **ephemeral and process-scoped**. They are intended for personal development sessions and may be lost when a serverless instance is recycled. A future persistent-compute phase can move workspace state to a durable worker or connected local runtime without changing the UI contract.


## ORA v1 Phase 2: Repair Loops and Multi-file Changes

When verification fails, the terminal workspace now identifies the failed stage and offers a **Repair with ORA** handoff. This creates a focused Agent-mode task containing the failure evidence and asks ORA to inspect the affected code, make the smallest safe multi-file change, and verify the result.

The terminal runtime also exposes a bounded multi-file patch action for approved repair batches. A repair batch is limited to 32 files, rejects duplicate paths, blocks protected `.git` paths and traversal attempts, enforces a 2 MB per-file limit, and supports create, modify, and delete actions. Patches are applied to the active workspace before the verification pipeline is run again.

Repair automation remains bounded by ORA’s existing plan approval, tool-call, iteration, file-change, timeout, and authentication guardrails. Direct remote Git mutation remains blocked in the terminal runtime; commits and pushes continue through the explicit GitHub workflow.
