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
