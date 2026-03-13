# Token Counter MCP

Track every Claude token automatically — input, output, cache read/write — with a live analytics dashboard, interactive charts, and per-project cost breakdown. Works in any Claude Code project with zero configuration after a one-time setup.

---

## Quickstart

```bash
npx -y token-counter-mcp setup
```

Restart Claude Code. That's it.

**What setup does:**
1. Registers `token-counter-mcp` globally (`--scope user`) — active in every project
2. Creates `~/.claude/token-counter-stop.sh` — a stop hook that logs tokens after each response
3. Wires the hook into `~/.claude/settings.json` — no per-project config needed

**Dashboard:** open the URL printed at session start (usually `http://localhost:8899`)

---

## Dashboard

The dashboard gives you a full picture of your token usage with:

- **Live stats** — total cost, input/output tokens, cache usage, API call count
- **Interactive charts** (powered by Chart.js):
  - **Spending Trend** — daily cost over the last 30 days (area chart)
  - **Cost by Project** — top projects by spend (doughnut chart)
  - **Token Breakdown** — input vs output tokens per project (stacked bar)
  - **Model Distribution** — usage and cost split by model (doughnut chart)
- **Project cards** — folder-wise breakdown with cost %, token counts, session history, and expandable detail panels
- **Paginated call log** — 10 entries per page with navigation, model tags color-coded by tier (opus/sonnet/haiku)

The dashboard updates in real-time via Server-Sent Events (SSE).

---

## Auto-Tracking

After setup, token usage is logged **automatically after every Claude response** — no manual `log_usage` calls needed.

To check your running cost mid-session, ask Claude:
```
What's my total spend this session?
```

---

## Available Tools

| Tool | What it does |
|------|-------------|
| `count_tokens` | Count tokens for any text or conversation before sending it |
| `log_usage` | Manually record token usage (input, output, cache) |
| `get_session_stats` | Running totals and USD cost for the current session |
| `get_usage_history` | Last N usage entries across all sessions |
| `reset_session` | Zero out session totals (history is preserved) |
| `estimate_cost` | Calculate USD cost for a given token count |

### Token Counting Accuracy

| Mode | When | Accuracy |
|------|------|----------|
| **Exact** (Anthropic API) | `ANTHROPIC_API_KEY` is set | 100% |
| **Local** (gpt-tokenizer) | No API key | ~97–99% |

The local mode uses the `cl100k_base` BPE tokenizer which closely matches Claude's tokenizer. Cost calculations are always exact for the token counts reported.

---

## Setup Options

### Option 1: Automatic (recommended)

```bash
npx -y token-counter-mcp setup
```

This registers the MCP globally and installs the auto-tracking stop hook.

### Option 2: Manual — global (all projects)

```bash
claude mcp add --scope user token-counter -- npx -y token-counter-mcp
```

### Option 3: Manual — per-project only

```bash
claude mcp add token-counter -- npx -y token-counter-mcp
```

> **Note:** Options 2 and 3 skip the stop hook, so you won't get automatic tracking. You'll need to call `log_usage` manually or ask Claude to log usage after each task.

### Optional: Exact token counting

Set your Anthropic API key to enable 100% exact token counts:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without it, token counting uses a local approximation (~97–99% accurate). Cost tracking and logging work either way.

---

## Local Dashboard

The dashboard runs on your machine while Claude Code is active:

```
Token usage dashboard → http://localhost:8899
```

If port 8899 is taken, it increments automatically (8900, 8901, …). The current port is saved to `~/.claude/token-counter/dashboard-port.txt`.

### Running the dashboard in dev mode

```bash
git clone https://github.com/kunal12203/token-counter-mcp.git
cd token-counter-mcp
npm install
npm run dev
```

---

## Supported Models & Pricing

| Model | Input | Output | Cache Read | Cache Write |
|-------|-------|--------|------------|-------------|
| `claude-opus-4-6` | $5.00 / 1M | $25.00 / 1M | $0.50 / 1M | $1.25 / 1M |
| `claude-sonnet-4-6` | $3.00 / 1M | $15.00 / 1M | $0.30 / 1M | $0.75 / 1M |
| `claude-haiku-4-5` | $1.00 / 1M | $5.00 / 1M | $0.10 / 1M | $0.25 / 1M |

Models not in the table fall back to Sonnet pricing. Versioned IDs (e.g. `claude-sonnet-4-6-20260101`) are matched by prefix.

---

## Token Storage

Usage is stored locally at `~/.claude/token-counter/`:

| File | Contents |
|------|----------|
| `session.json` | Current session totals and entries |
| `history.json` | All-time log, capped at 10,000 entries |
| `dashboard-port.txt` | Port the dashboard is currently listening on |

---

## Project Structure

```
src/
├── index.ts        # MCP server, tool handlers, HTTP/SSE endpoints
├── dashboard.ts    # Dashboard HTML with charts and pagination
├── storage.ts      # Token usage persistence (session + history)
├── tokenizer.ts    # Token counting (Anthropic API or local BPE)
├── costs.ts        # Model pricing and cost calculation
└── setup.ts        # One-time setup script
```

---

## Requirements

- Node.js 18+
- Claude Code CLI (`claude`)
