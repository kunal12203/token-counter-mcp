import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

const IS_WIN = process.platform === "win32";
const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const GLOBAL_SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const STOP_SCRIPT = IS_WIN
  ? path.join(CLAUDE_DIR, "token-counter-stop.ps1")
  : path.join(CLAUDE_DIR, "token-counter-stop.sh");

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJson(p: string): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>; }
  catch { return {}; }
}

function writeJson(p: string, data: unknown) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function registerMcp(): "ok" | "fallback" {
  try {
    if (IS_WIN) {
      // On Windows, use powershell to chain remove + add.
      execSync(
        'claude mcp remove token-counter --scope user 2>$null; claude mcp add --scope user token-counter -- npx -y token-counter-mcp',
        { stdio: "ignore", shell: "powershell.exe" },
      );
    } else {
      execSync(
        "claude mcp remove token-counter --scope user 2>/dev/null; claude mcp add --scope user token-counter -- npx -y token-counter-mcp",
        { stdio: "ignore", shell: "/bin/bash" },
      );
    }
    return "ok";
  } catch {
    return "fallback";
  }
}

function writeStopHookBash() {
  // Build the bash script without using TS template literals for the bash variables
  // to avoid conflicts between bash $VAR syntax and TS template literal ${VAR}.
  const D = "$";  // shorthand to embed $ chars safely
  const lines = [
    "#!/usr/bin/env bash",
    `INPUT=${D}(cat)`,
    `TRANSCRIPT=${D}(echo "${D}INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('transcript_path',''))" 2>/dev/null || echo "")`,
    `if [[ -n "${D}TRANSCRIPT" && -f "${D}TRANSCRIPT" ]]; then`,
    `  CHARS=${D}(python3 - "${D}TRANSCRIPT" 2>/dev/null << 'PYEOF'`,
    "import json, sys",
    "lines = open(sys.argv[1]).readlines()",
    "for line in reversed(lines):",
    "    try:",
    "        msg = json.loads(line)",
    `        if msg.get("type") == "assistant":`,
    `            print(len(str(msg.get("message", {}).get("content", ""))))`,
    "            break",
    "    except Exception:",
    "        pass",
    "PYEOF",
    ")",
    `  OUT=${D}(( ${D}{CHARS:-0} / 4 ))`,
    `  IN=${D}(( OUT * 4 ))`,
    `  PROJ_DIR=${D}(basename "${D}(dirname "${D}TRANSCRIPT")")`,
    `  PROJECT_PATH=${D}(echo "${D}PROJ_DIR" | sed 's|^-|/|' | sed 's|-|/|g')`,
    `  PORT_FILE="${D}HOME/.claude/token-counter/dashboard-port.txt"`,
    `  DASH_PORT=8899`,
    `  if [[ -f "${D}PORT_FILE" ]]; then DASH_PORT=${D}(cat "${D}PORT_FILE"); fi`,
    `  curl -sf -X POST "http://localhost:${D}DASH_PORT/log" \\`,
    `    -H "Content-Type: application/json" \\`,
    `    -d "{\\"input_tokens\\":${D}IN,\\"output_tokens\\":${D}OUT,\\"model\\":\\"claude-sonnet-4-6\\",\\"description\\":\\"auto\\",\\"project\\":\\"${D}PROJECT_PATH\\"}" \\`,
    "    >/dev/null 2>&1 || true",
    "fi",
    "exit 0",
    "",
  ];
  fs.writeFileSync(STOP_SCRIPT, lines.join("\n"), { encoding: "utf8", mode: 0o755 });
}

function writeStopHookPowershell() {
  // PowerShell stop hook: reads transcript from stdin JSON, estimates tokens, POSTs to dashboard.
  const lines = [
    "$hookInput = [Console]::In.ReadToEnd()",
    "try { $transcript = ($hookInput | ConvertFrom-Json).transcript_path } catch { $transcript = '' }",
    "if ($transcript -and (Test-Path $transcript)) {",
    "    try {",
    "        $lines = Get-Content $transcript -Raw | ConvertFrom-Json -AsHashtable -ErrorAction SilentlyContinue",
    "        if (-not $lines) { $lines = (Get-Content $transcript) | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction SilentlyContinue } | Where-Object { $_ } }",
    "        $last = ($lines | Where-Object { $_.type -eq 'assistant' }) | Select-Object -Last 1",
    "        $chars = ([string]($last.message.content)).Length",
    "        $out = [Math]::Max(1, [int]($chars / 4)); $in = $out * 4",
    '        $portFile = Join-Path $env:USERPROFILE ".claude\\token-counter\\dashboard-port.txt"',
    '        $dashPort = if (Test-Path $portFile) { (Get-Content $portFile -Raw).Trim() } else { "8899" }',
    '        $projDir = Split-Path (Split-Path $transcript) -Leaf',
    "        $projectPath = ($projDir -replace '^-','/' -replace '-','/')",
    '        $body = "{`"input_tokens`":$in,`"output_tokens`":$out,`"model`":`"claude-sonnet-4-6`",`"description`":`"auto`",`"project`":`"$projectPath`"}"',
    '        Invoke-RestMethod -Method Post -Uri "http://localhost:$dashPort/log" -ContentType "application/json" -Body $body -ErrorAction SilentlyContinue | Out-Null',
    "    } catch {}",
    "}",
    "",
  ];
  fs.writeFileSync(STOP_SCRIPT, lines.join("\r\n"), { encoding: "utf8" });
}

function writeStopHook() {
  if (IS_WIN) {
    writeStopHookPowershell();
  } else {
    writeStopHookBash();
  }
}

function addStopHook() {
  ensureDir(CLAUDE_DIR);
  const settings = readJson(GLOBAL_SETTINGS);
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>;

  const stopHookCmd = IS_WIN
    ? `powershell -NoProfile -File "${STOP_SCRIPT}"`
    : `/bin/bash "${STOP_SCRIPT}"`;

  const existing = (hooks.Stop ?? []) as Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
  const alreadyIn = existing.some(h => h.hooks?.some(hh => hh.command === stopHookCmd));
  if (!alreadyIn) {
    existing.push({ matcher: "", hooks: [{ type: "command", command: stopHookCmd }] });
  }

  hooks.Stop = existing;
  settings.hooks = hooks;
  writeJson(GLOBAL_SETTINGS, settings);
}

export async function runSetup(): Promise<void> {
  console.log("\nToken Counter MCP — Setup\n");
  ensureDir(CLAUDE_DIR);

  // 1. Register MCP globally
  process.stdout.write("Registering MCP (scope: user)... ");
  const mcpResult = registerMcp();
  if (mcpResult === "ok") {
    console.log("done.");
  } else {
    console.log("could not run `claude` CLI — add manually:");
    console.log("  claude mcp add --scope user token-counter -- npx -y token-counter-mcp\n");
  }

  // 2. Write global stop hook script
  process.stdout.write("Writing stop hook script... ");
  writeStopHook();
  console.log(`done. (${STOP_SCRIPT})`);

  // 3. Register Stop hook in global settings.json
  process.stdout.write("Adding Stop hook to ~/.claude/settings.json... ");
  addStopHook();
  console.log("done.");

  console.log("\nAll set! Restart Claude Code to activate.\n");
  console.log("Dashboard: http://localhost:8899 (exact port printed at session start)");
  console.log("Usage is logged automatically after each Claude response.\n");
}
