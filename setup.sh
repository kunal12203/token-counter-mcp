#!/usr/bin/env bash
# Sets up the Token Counter MCP server in Claude Code settings.
# Run with: bash setup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS="$HOME/.claude/settings.json"
SERVER_PATH="$SCRIPT_DIR/dist/index.js"

echo "Token Counter MCP — Setup"
echo "========================="
echo ""
echo "Server: $SERVER_PATH"
echo "Settings: $SETTINGS"
echo ""

# Ensure the project is built
if [ ! -f "$SERVER_PATH" ]; then
  echo "Building project..."
  cd "$SCRIPT_DIR"
  npm run build
fi

# Merge MCP server config into settings.json using Node
node --input-type=module <<EOF
import { readFileSync, writeFileSync } from 'fs';

const settingsPath = '$SETTINGS';
const serverPath = '$SERVER_PATH';

let settings = {};
try {
  const raw = readFileSync(settingsPath, 'utf8');
  settings = JSON.parse(raw);
} catch {
  settings = {};
}

settings.mcpServers = settings.mcpServers || {};
settings.mcpServers['token-counter'] = {
  command: 'node',
  args: [serverPath],
};

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\\n', 'utf8');
console.log('✓ Registered token-counter MCP server in', settingsPath);
console.log('');
console.log('Restart Claude Code to pick up the new server.');
console.log('');
console.log('Available tools:');
console.log('  count_tokens      — Count tokens in text or a conversation (uses Anthropic API)');
console.log('  log_usage         — Record actual token usage from an API call');
console.log('  get_session_stats — View cumulative tokens + USD cost for current session');
console.log('  get_usage_history — Browse recent usage entries across sessions');
console.log('  reset_session     — Start a new session (clears running totals)');
console.log('  estimate_cost     — Estimate cost without making an API call');
EOF
