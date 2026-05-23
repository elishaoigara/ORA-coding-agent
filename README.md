# AI Coding Agent

Your personal AI coding agent — runs in VS Code, deploys to Vercel, accessible from anywhere.

## Features
- Chat with AI about your code (streaming responses)
- Browse GitHub repos and inject files as context
- Swap AI providers by changing one env variable
- Password-protected so only you can access it
- Supports Groq, DeepSeek, OpenAI, Anthropic

---

## Local Setup (VS Code)

### 1. Install dependencies
```bash
npm install
```

### 2. Create your env file
```bash
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
ACTIVE_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
GITHUB_PAT=ghp_your_token_here
APP_PASSWORD=pick_a_password
```

### 3. Run locally
```bash
npm run dev
```
Open http://localhost:3000

---

## Switching AI Providers

Change **one line** in `.env.local`:

```env
# Use Groq (default, fast, free)
ACTIVE_PROVIDER=groq
GROQ_API_KEY=gsk_...

# Use DeepSeek (great for code)
ACTIVE_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk_...

# Use OpenAI
ACTIVE_PROVIDER=openai
OPENAI_API_KEY=sk_...
```

To add a new model (e.g. DeepSeek V4 when it launches), open
`src/lib/providers.ts` and add it to the `models` array for that provider.
No other changes needed.

---

## Adding a Brand-New Provider

Open `src/lib/providers.ts` and add a block:

```typescript
mynewprovider: {
  name: "My New Provider",
  baseUrl: "https://api.mynewprovider.com/v1",  // must be OpenAI-compatible
  apiKey: process.env.MYNEWPROVIDER_API_KEY ?? "",
  defaultModel: "their-model-id",
  models: [
    { id: "their-model-id", label: "Their Model" },
  ],
},
```

Then set `ACTIVE_PROVIDER=mynewprovider` and `MYNEWPROVIDER_API_KEY=...` in `.env.local`.

---

## GitHub Setup

1. Go to https://github.com/settings/tokens/new
2. Give it a name like "coding-agent"
3. Tick **repo** scope (read access to your repos)
4. Copy the token (`ghp_...`) into `GITHUB_PAT` in `.env.local`

---

## Deploy to Vercel (access from anywhere)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "initial commit"
gh repo create ai-coding-agent --private --push
```

### 2. Deploy to Vercel
```bash
npm install -g vercel
vercel
```

Or connect via https://vercel.com/new → import your repo.

### 3. Set environment variables in Vercel
Go to your project → Settings → Environment Variables and add:
- `ACTIVE_PROVIDER`
- `GROQ_API_KEY` (or whichever provider)
- `GITHUB_PAT`
- `APP_PASSWORD`

Your agent is now live at `https://your-project.vercel.app`

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts        ← AI streaming endpoint
│   │   ├── github/route.ts      ← GitHub file browser API
│   │   └── provider/route.ts    ← Exposes model list to UI
│   ├── page.tsx                 ← Main chat UI
│   └── layout.tsx
├── components/
│   ├── GitHubSidebar.tsx        ← Repo/file browser
│   └── ChatMessage.tsx          ← Message renderer with syntax highlighting
├── lib/
│   └── providers.ts             ← Provider config (swap here)
└── types/
    └── index.ts                 ← Shared TypeScript types
```
