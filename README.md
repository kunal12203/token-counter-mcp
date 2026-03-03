# Token Counter MCP

An MCP server that accurately counts and tracks every Claude token — input, output, cache read/write, and planning. Uses the official Anthropic token-counting API for **exact** counts (not estimates).

## Hosted Service — One Command Setup

We run a hosted instance so you don't need your own Anthropic API key or any deployment:

```bash
claude mcp add --transport sse token-counter https://proud-motivation-production-c4ab.up.railway.app/sse
```

Restart Claude Code and the tools are ready.

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

```bash
git clone https://github.com/krishnakantparashar/TokenCounterMCP
cd TokenCounterMCP
npm install && npm run build
```

Set your API key for exact counts (optional — falls back to ~98% accurate local counting without it):

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

---

## Counting Modes

| Mode | Accuracy | Requires |
|------|----------|----------|
| Exact (Anthropic API) | 100% | `ANTHROPIC_API_KEY` set on server |
| Local approximation | ~97–99% | Nothing — works offline |

The hosted service uses exact counting. Local mode without a key uses `gpt-tokenizer` (cl100k_base BPE) as a fallback.

---

## Rate Limits

The hosted service allows **60 requests per minute** per IP. For higher limits, deploy your own instance.

---

## Token Storage (local mode only)

Usage history is stored at `~/.claude/token-counter/` (macOS/Linux) or `%USERPROFILE%\.claude\token-counter\` (Windows). The hosted service does not persist your usage data between sessions.
