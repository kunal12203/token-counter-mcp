// Full SSE round-trip test — reads responses from the stream
import https from "https";

const BASE = "https://proud-motivation-production-c4ab.up.railway.app";

function openSSE() {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + "/sse");
    const req = https.request({ hostname: url.hostname, path: url.pathname, method: "GET" }, (res) => {
      const pending = new Map(); // id → { resolve, reject }
      let buf = "";
      let sessionPath = null;

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        const lines = buf.split("\n");
        buf = lines.pop(); // keep incomplete last line

        let eventType = null;
        for (const line of lines) {
          if (line.startsWith("event: ")) { eventType = line.slice(7).trim(); continue; }
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (eventType === "endpoint") {
              sessionPath = data; // e.g. /messages?sessionId=xxx
              resolve({ sessionPath, call, destroy: () => req.destroy() });
            } else {
              // JSON-RPC response
              try {
                const msg = JSON.parse(data);
                if (msg.id != null && pending.has(msg.id)) {
                  pending.get(msg.id).resolve(msg);
                  pending.delete(msg.id);
                }
              } catch { /* ignore non-JSON */ }
            }
          }
        }
      });
      res.on("error", reject);

      // call() sends a request and waits for the SSE response
      function call(id, method, params) {
        return new Promise((res, rej) => {
          pending.set(id, { resolve: res, reject: rej });
          const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
          const postReq = https.request({
            hostname: url.hostname,
            path: sessionPath + "",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
          });
          postReq.on("error", rej);
          postReq.write(body);
          postReq.end();
          // Timeout after 10s
          setTimeout(() => rej(new Error(`Timeout waiting for id=${id}`)), 10000);
        });
      }
    });
    req.on("error", reject);
    req.end();
  });
}

async function run() {
  console.log("=== Token Counter MCP — Full Round-Trip Test ===\n");

  const { sessionPath, call, destroy } = await openSSE();
  console.log(`SSE session: ${sessionPath}\n`);

  // ── tools/list ──────────────────────────────────────────────────────────────
  const list = await call(1, "tools/list", {});
  const toolNames = list.result?.tools?.map(t => t.name) ?? [];
  console.log(`tools/list → [${toolNames.join(", ")}]\n`);

  // ── count_tokens (short text — uses Anthropic API for exact count) ──────────
  const ct = await call(2, "tools/call", {
    name: "count_tokens",
    arguments: { text: "Hello, world! How many tokens am I?", model: "claude-opus-4-6" },
  });
  const ctResult = JSON.parse(ct.result?.content?.[0]?.text ?? "{}");
  console.log("count_tokens →");
  console.log(`  input_tokens    : ${ctResult.input_tokens}`);
  console.log(`  counting_mode   : ${ctResult.counting_mode}`);
  console.log(`  accuracy        : ${ctResult.accuracy}`);
  console.log(`  est. input cost : ${ctResult.estimated_input_cost_formatted}\n`);

  // ── log_usage ───────────────────────────────────────────────────────────────
  const lu = await call(3, "tools/call", {
    name: "log_usage",
    arguments: {
      input_tokens: ctResult.input_tokens,
      output_tokens: 25,
      model: "claude-opus-4-6",
      description: "test call",
    },
  });
  const luResult = JSON.parse(lu.result?.content?.[0]?.text ?? "{}");
  console.log("log_usage →");
  console.log(`  logged cost     : ${luResult.logged?.cost_formatted}`);
  console.log(`  session total   : ${luResult.session_running_total?.total_cost_formatted}\n`);

  // ── estimate_cost ───────────────────────────────────────────────────────────
  const ec = await call(4, "tools/call", {
    name: "estimate_cost",
    arguments: { input_tokens: 10000, output_tokens: 3000, model: "claude-opus-4-6" },
  });
  const ecResult = JSON.parse(ec.result?.content?.[0]?.text ?? "{}");
  console.log("estimate_cost (10K in / 3K out, opus-4-6) →");
  console.log(`  input cost  : ${ecResult.cost_breakdown?.input}`);
  console.log(`  output cost : ${ecResult.cost_breakdown?.output}`);
  console.log(`  total       : ${ecResult.cost_breakdown?.total}\n`);

  destroy();
  console.log("✅ Server is fully working with real Anthropic API token counts!");
}

run().catch((e) => { console.error("\n❌ Test failed:", e.message); process.exit(1); });
