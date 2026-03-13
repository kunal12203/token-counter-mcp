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
        { stdio: "ignore", shell: "bash" },
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
    `  USAGE=${D}(python3 - "${D}TRANSCRIPT" 2>/dev/null << 'PYEOF'`,
    "import json, sys",
    "input_tokens = cache_create = cache_read = output_tokens = 0",
    'model = ""',
    "with open(sys.argv[1]) as f:",
    "    for line in f:",
    "        try:",
    "            msg = json.loads(line)",
    "        except Exception:",
    "            continue",
    '        if msg.get("type") != "assistant":',
    "            continue",
    '        m = msg.get("message", {})',
    "        if not model:",
    '            model = m.get("model", "")',
    '        u = m.get("usage", {})',
    "        if not u:",
    "            continue",
    '        input_tokens += u.get("input_tokens", 0)',
    '        cache_create += u.get("cache_creation_input_tokens", 0)',
    '        cache_read += u.get("cache_read_input_tokens", 0)',
    '        output_tokens += u.get("output_tokens", 0)',
    "total_input = input_tokens + cache_create + cache_read",
    "if total_input > 0 or output_tokens > 0:",
    "    print(json.dumps({",
    '        "input_tokens": total_input,',
    '        "output_tokens": output_tokens,',
    '        "cache_creation_input_tokens": cache_create,',
    '        "cache_read_input_tokens": cache_read,',
    '        "raw_input_tokens": input_tokens,',
    '        "model": model or "claude-sonnet-4-6",',
    "    }))",
    "PYEOF",
    ")",
    `  if [[ -n "${D}USAGE" ]]; then`,
    `    PROJ_DIR=${D}(basename "${D}(dirname "${D}TRANSCRIPT")")`,
    `    PROJECT_PATH=${D}(echo "${D}PROJ_DIR" | sed 's|^-|/|' | sed 's|-|/|g')`,
    `    BODY=${D}(echo "${D}USAGE" | python3 -c "import sys,json; d=json.load(sys.stdin); d['description']='auto'; d['project']='${D}PROJECT_PATH'; print(json.dumps(d))" 2>/dev/null)`,
    `    PORT_FILE="${D}HOME/.claude/token-counter/dashboard-port.txt"`,
    `    DASH_PORT=8899`,
    `    if [[ -f "${D}PORT_FILE" ]]; then DASH_PORT=${D}(cat "${D}PORT_FILE"); fi`,
    `    curl -sf -X POST "http://localhost:${D}DASH_PORT/log" \\`,
    `      -H "Content-Type: application/json" \\`,
    `      -d "${D}BODY" \\`,
    "      >/dev/null 2>&1 || true",
    "  fi",
    "fi",
    "exit 0",
    "",
  ];
  fs.writeFileSync(STOP_SCRIPT, lines.join("\n"), { encoding: "utf8", mode: 0o755 });
}

function writeStopHookPowershell() {
  // PowerShell stop hook: reads real API usage from transcript JSONL, POSTs to dashboard.
  const lines = [
    "$hookInput = [Console]::In.ReadToEnd()",
    "try { $transcript = ($hookInput | ConvertFrom-Json).transcript_path } catch { $transcript = '' }",
    "if ($transcript -and (Test-Path $transcript)) {",
    "    try {",
    "        $inputTok = 0; $cacheCreate = 0; $cacheRead = 0; $outputTok = 0; $model = ''",
    "        foreach ($line in (Get-Content $transcript)) {",
    "            try { $msg = $line | ConvertFrom-Json -ErrorAction SilentlyContinue } catch { continue }",
    "            if ($msg.type -ne 'assistant') { continue }",
    "            $m = $msg.message",
    "            if (-not $model -and $m.model) { $model = $m.model }",
    "            $u = $m.usage",
    "            if (-not $u) { continue }",
    "            $inputTok += [int]($u.input_tokens -as [int])",
    "            $cacheCreate += [int]($u.cache_creation_input_tokens -as [int])",
    "            $cacheRead += [int]($u.cache_read_input_tokens -as [int])",
    "            $outputTok += [int]($u.output_tokens -as [int])",
    "        }",
    "        $totalInput = $inputTok + $cacheCreate + $cacheRead",
    "        if ($totalInput -gt 0 -or $outputTok -gt 0) {",
    "            if (-not $model) { $model = 'claude-sonnet-4-6' }",
    '            $portFile = Join-Path $env:USERPROFILE ".claude\\token-counter\\dashboard-port.txt"',
    '            $dashPort = if (Test-Path $portFile) { (Get-Content $portFile -Raw).Trim() } else { "8899" }',
    '            $projDir = Split-Path (Split-Path $transcript) -Leaf',
    "            $projectPath = ($projDir -replace '^-','/' -replace '-','/')",
    '            $body = "{`"input_tokens`":$totalInput,`"output_tokens`":$outputTok,`"cache_creation_input_tokens`":$cacheCreate,`"cache_read_input_tokens`":$cacheRead,`"raw_input_tokens`":$inputTok,`"model`":`"$model`",`"description`":`"auto`",`"project`":`"$projectPath`"}"',
    '            Invoke-RestMethod -Method Post -Uri "http://localhost:$dashPort/log" -ContentType "application/json" -Body $body -ErrorAction SilentlyContinue | Out-Null',
    "        }",
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
    : `bash "${STOP_SCRIPT}"`;

  const existing = (hooks.Stop ?? []) as Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
  // Also match old /bin/bash variant so we don't duplicate hooks after upgrade
  const alreadyIn = existing.some(h => h.hooks?.some(hh => hh.command === stopHookCmd || hh.command === `/bin/bash "${STOP_SCRIPT}"`));
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
