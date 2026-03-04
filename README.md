# Token Counter MCP

An MCP server that accurately counts and tracks every Claude token — input, output, cache read/write, and planning. Uses the official Anthropic token-counting API for **exact** counts (not estimates).

## Hosted Service — One Command Setup

We run a hosted instance so you don't need your own Anthropic API key or any deployment:

```bash
claude mcp add --transport sse token-counter https://proud-motivation-production-c4ab.up.railway.app/sse
```

Restart Claude Code and the tools are ready.

### Interactive Setup (with Dashboard)

For a guided setup that also configures the live dashboard token:

```bash
npx -y token-counter-mcp --setup
```

This updates `~/.claude.json` automatically and prints your personal dashboard URL.

---

## Available Tools

| Tool | What it does |
|------|-------------|
| `count_tokens` | Exact token count for any text or conversation via Anthropic API |
| `log_usage` | Record actual token usage after an API call (input, output, cache) |
| `get_session_stats` | Running totals and USD cost for the current session |
| `get_usage_history` | Last N usage entries across all sessions |
| `reset_session` | Zero out session totals (history is preserved) |
| `estimate_cost` | Calculate USD cost for a given token count without making an API call |

---

## Usage in Claude Code

Once added, ask Claude things like:

```
How many tokens is this conversation so far?
Log my last API call: 1500 input, 300 output, claude-opus-4-6
What's my total spend this session?
How much would 50k input + 10k output tokens cost on claude-sonnet-4-6?
Show me my usage history for the last 10 entries.
Reset my session totals.
```

---

## Self-Hosted Deployment

Want to run your own instance with your own API key?

### macOS

```bash
# Install Railway CLI
brew install railway

# Clone and build
git clone https://github.com/krishnakantparashar/TokenCounterMCP
cd TokenCounterMCP
npm install && npm run build

# Deploy
railway login
railway init
railway up
railway domain

# Set your Anthropic API key
railway variables set ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
```

### Windows (PowerShell)

```powershell
# Install Railway CLI (requires Node.js)
npm install -g @railway/cli

# Clone and build
git clone https://github.com/krishnakantparashar/TokenCounterMCP
cd TokenCounterMCP
npm install
npm run build

# Deploy
railway login
railway init
railway up
railway domain

# Set your Anthropic API key
railway variables set ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE
```

After deployment, connect with:
```bash
claude mcp add --transport sse token-counter https://YOUR-URL.up.railway.app/sse
```

---

## Local stdio Mode

Runs entirely on your machine. Requires Node.js 18+.

### Quickstart (no clone needed)

```bash
claude mcp add token-counter -- npx -y token-counter-mcp
```

That's it. Restart Claude Code — the server starts on demand via `npx`.

### Manual install (if you prefer)

```bash
git clone https://github.com/krishnakantparashar/TokenCounterMCP
cd TokenCounterMCP
npm install && npm run build
```

Set your API key for exact counts (optional — falls back to ~97–99% accurate local counting without it):

```bash
export ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE   # macOS/Linux
$env:ANTHROPIC_API_KEY="sk-ant-YOUR_KEY_HERE"   # Windows PowerShell
```

Add to Claude Code:

```bash
# macOS/Linux
claude mcp add token-counter -- node "/absolute/path/to/TokenCounterMCP/dist/index.js"

# Windows
claude mcp add token-counter -- node "C:\path\to\TokenCounterMCP\dist\index.js"
```

### Local Dashboard

When running in local stdio mode, a live dashboard is available at:

```
http://localhost:8899
```

Open it in your browser to see session totals, per-project cost breakdowns, and usage history.

---

## Counting Modes

| Mode | Accuracy | Requires |
|------|----------|----------|
| Exact (Anthropic API) | 100% | `ANTHROPIC_API_KEY` set on server |
| Local approximation | ~97–99% | Nothing — works offline |

The hosted service uses exact counting. Local mode without a key uses `gpt-tokenizer` (cl100k_base BPE) as a fallback.

---

## Supported Models & Pricing

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| `claude-opus-4-6` | $5.00 / 1M | $25.00 / 1M | $0.50 / 1M | $1.25 / 1M |
| `claude-sonnet-4-6` | $3.00 / 1M | $15.00 / 1M | $0.30 / 1M | $0.75 / 1M |
| `claude-haiku-4-5` | $1.00 / 1M | $5.00 / 1M | $0.10 / 1M | $0.25 / 1M |

Models not in the table fall back to Sonnet pricing. Versioned model IDs (e.g. `claude-opus-4-6-20260101`) are matched by prefix.

---

## Rate Limits

The hosted service allows **60 requests per minute** per IP. For higher limits, deploy your own instance.

---

## Token Storage (local mode only)

Usage history is stored at `~/.claude/token-counter/` (macOS/Linux) or `%USERPROFILE%\.claude\token-counter\` (Windows):

| File | Contents |
|------|----------|
| `session.json` | Current session totals (reset with `reset_session`) |
| `history.json` | All-time log, capped at 10,000 entries |

The hosted service does not persist your usage data between sessions.
