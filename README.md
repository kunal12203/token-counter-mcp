# Token Counter MCP

Track every Claude token automatically — input, output, cache read/write — with a live local dashboard and per-project cost breakdown. Works in any Claude Code project with zero configuration after a one-time setup.

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

## Auto-Tracking

After setup, token usage is logged **automatically after every Claude response** — no manual `log_usage` calls needed. The dashboard shows:

- Session totals (input / output / cache / cost)
- Per-project breakdown (costs grouped by project folder)
- Full usage history

To check your running cost mid-session, ask Claude:
```
What's my total spend this session?
```

---

## Available Tools

| Tool | What it does |
|------|-------------|
| `count_tokens` | Estimate token count for any text before reading it |
| `log_usage` | Manually record token usage (input, output, cache) |
| `get_session_stats` | Running totals and USD cost for the current session |
| `get_usage_history` | Last N usage entries across all sessions |
| `reset_session` | Zero out session totals (history is preserved) |
| `estimate_cost` | Calculate USD cost for a given token count |

---

## Manual Install (alternative to setup)

If you prefer to register the MCP without the stop hook:

```bash
claude mcp add --scope user token-counter -- npx -y token-counter-mcp
```

Or per-project only:
```bash
claude mcp add token-counter -- npx -y token-counter-mcp
```

---

## Local Dashboard

The dashboard runs on your machine while Claude Code is active. The actual port is printed at session start:

```
Token usage dashboard → http://localhost:8899
```

If port 8899 is taken, it increments automatically (8900, 8901, …). The current port is always saved to `~/.claude/token-counter/dashboard-port.txt` so the stop hook finds it regardless.

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
| `session.json` | Current session totals |
| `history.json` | All-time log, capped at 10,000 entries |
| `dashboard-port.txt` | Port the dashboard is currently listening on |

---

## Requirements

- Node.js 18+
- Claude Code CLI (`claude`)
