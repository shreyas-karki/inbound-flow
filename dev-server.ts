// Local server: serves public/ and POST /api/submit. Run with `npm run dev`.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

try { process.loadEnvFile(".env"); } catch { /* no .env: MOCK_MODE defaults to true */ }

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  const { handleSubmission } = await import("./lib/router.js"); // after env is loaded
  const { config } = await import("./lib/config.js");
  const { listOutbox } = await import("./lib/outbox.js");

  http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url?.split("?")[0] === "/api/submit") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body: unknown = {};
      try { body = JSON.parse(raw); } catch { /* handled as validation error */ }
      const out = await handleSubmission(body); // out.background keeps running after we reply
      res.writeHead(out.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(out.body));
    }
    if (req.method === "GET" && req.url?.split("?")[0] === "/api/outbox") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(listOutbox()));
    }
    if (req.method === "GET" && req.url?.split("?")[0] === "/inbox") req.url = "/inbox.html";
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname; // ignore ?utm_… query strings
    const file = path.join(process.cwd(), "public", pathname === "/" ? "index.html" : path.normalize(pathname).replace(/^(\.\.[/\\])+/, ""));
    if (file.startsWith(path.join(process.cwd(), "public")) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html" : "application/octet-stream" });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404).end("Not found");
  }).listen(PORT, () => {
    const live = (on: boolean) => (on ? "mock" : "live");
    console.log(`Router running at http://localhost:${PORT}  (Salesforce ${live(config.mock.salesforce)} / ${config.salesforce.writeMode}, Starbridge ${live(config.mock.starbridge)}, Claude ${live(config.mock.claude)})`);
    console.log(`Lead inbox (AI SDR drafts): http://localhost:${PORT}/inbox`);
  });
}

main();
