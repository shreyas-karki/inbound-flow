// Local server: serves public/, POST /api/submit and POST /api/tier. Run with `npm run dev`.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

try { process.loadEnvFile(".env"); } catch { /* no .env: MOCK_MODE defaults to true */ }
// Local only, so scripts/try-tier.sh works out of the box. Vercel never runs this file; set TIER_SECRET there.
process.env.TIER_SECRET ||= "local-dev-secret";

const PORT = Number(process.env.PORT ?? 3000);
const TYPES: Record<string, string> = { ".html": "text/html", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".js": "text/javascript", ".css": "text/css" };

async function main() {
  const { handleSubmission } = await import("./lib/router.js"); // after env is loaded
  const { config } = await import("./lib/config.js");
  const { listOutbox } = await import("./lib/outbox.js");
  const { handleTier } = await import("./lib/tier.js");
  const { handleVerify } = await import("./lib/verify.js");
  const { warmStarbridge } = await import("./lib/warm.js");

  http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url?.split("?")[0] === "/api/tier") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body: unknown = {};
      try { body = JSON.parse(raw); } catch { /* handled as incomplete form data */ }
      const secret = req.headers["x-inbound-secret"];
      const out = await handleTier(Array.isArray(secret) ? secret[0] : secret, body);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(out.body));
    }
    if (req.method === "POST" && req.url?.split("?")[0] === "/api/submit") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body: unknown = {};
      try { body = JSON.parse(raw); } catch { /* handled as validation error */ }
      const out = await handleSubmission(body); // out.background keeps running after we reply
      res.writeHead(out.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(out.body));
    }
    if (req.method === "POST" && req.url?.split("?")[0] === "/api/verify") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body: unknown = {};
      try { body = JSON.parse(raw); } catch { /* handled as validation error */ }
      const out = await handleVerify(body);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(out.body));
    }
    if (req.method === "GET" && req.url?.split("?")[0] === "/api/warm") {
      const q = new URL(req.url, "http://localhost").searchParams;
      const work = warmStarbridge({ school: q.get("school") ?? undefined, email: q.get("email") ?? undefined, state: q.get("state") ?? undefined });
      res.writeHead(202, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(JSON.stringify({ ok: true, warming: Boolean(work) }));
    }
    if (req.method === "GET" && req.url?.split("?")[0] === "/api/outbox") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(listOutbox()));
    }
    if (req.method === "GET" && req.url?.split("?")[0] === "/inbox") req.url = "/inbox.html";
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname; // ignore ?utm_… query strings
    const file = path.join(process.cwd(), "public", pathname === "/" ? "index.html" : path.normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
    if (file.startsWith(path.join(process.cwd(), "public")) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404).end("Not found");
  }).listen(PORT, () => {
    const live = (on: boolean) => (on ? "mock" : "live");
    console.log(`Router running at http://localhost:${PORT}  (Salesforce ${live(config.mock.salesforce)} / ${config.salesforce.writeMode}, Starbridge ${live(config.mock.starbridge)}, Claude ${live(config.mock.claude)}, actions by ${config.actionsOwner})`);
    console.log(`Lead inbox (AI SDR drafts): http://localhost:${PORT}/inbox`);
  });
}

main();
