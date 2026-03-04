import readline from "readline/promises";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const CLAUDE_CONFIG = path.join(os.homedir(), ".claude.json");

export async function runSetup(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => rl.question(q);

  console.log("\nToken Counter MCP — Setup\n");

  // Read existing Claude config
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(CLAUDE_CONFIG, "utf8")) as Record<string, unknown>;
  } catch {
    config = {};
  }

  const mcpServers = (config.mcpServers as Record<string, unknown>) ?? {};
  const existing = mcpServers["token-counter"] as Record<string, unknown> | undefined;
  const existingEnv = (existing?.env as Record<string, string> | undefined) ?? {};

  if (existing) {
    const ans = await ask("token-counter is already configured. Update it? (y/N): ");
    if (ans.trim().toLowerCase() !== "y") {
      console.log("Nothing changed.");
      rl.close();
      return;
    }
  }

  const remoteInput = await ask("Hosted dashboard URL (press Enter to skip): ");
  const remoteUrl = remoteInput.trim();

  let token = "";
  let dashboardUrl = "http://localhost:8899";

  if (remoteUrl) {
    // Reuse existing token so old localStorage history still works
    token = existingEnv.DASHBOARD_TOKEN || crypto.randomBytes(12).toString("hex");
    dashboardUrl = `${remoteUrl.replace(/\/$/, "")}/?token=${token}`;
    console.log(`\nYour token: ${token}`);
    console.log("Keep this — it's your personal dashboard key.\n");
  }

  const env: Record<string, string> = {};
  if (remoteUrl) {
    env.REMOTE_DASHBOARD_URL = remoteUrl;
    env.DASHBOARD_TOKEN = token;
  }

  mcpServers["token-counter"] = {
    command: "npx",
    args: ["-y", "token-counter-mcp"],
    ...(Object.keys(env).length ? { env } : {}),
  };

  config.mcpServers = mcpServers;
  fs.writeFileSync(CLAUDE_CONFIG, JSON.stringify(config, null, 2) + "\n", "utf8");

  console.log("Written to ~/.claude.json");
  console.log("\nDone! Restart Claude Code to activate.\n");
  console.log(`Dashboard: ${dashboardUrl}`);
  if (remoteUrl) {
    console.log(
      "Bookmark this URL — it loads your history from localStorage even when offline.\n",
    );
  }

  rl.close();
}
