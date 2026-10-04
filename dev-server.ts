// Local server: serves public/ and POST /api/submit. Run with `npm run dev`.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

try { process.loadEnvFile(".env"); } catch { /* no .env: MOCK_MODE defaults to true */ }

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  const { handleSubmission } = await import("./lib/router"); // after env is loaded
  const { config } = await import("./lib/config");

  http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/submit") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let body: unknown = {};
      try { body = JSON.parse(raw); } catch { /* handled as validation error */ }
      const out = await handleSubmission(body);
      res.writeHead(out.status, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(out.body));
    }
    const file = path.join(process.cwd(), "public", req.url === "/" ? "index.html" : path.normalize(req.url ?? "").replace(/^(\.\.[/\\])+/, ""));
    if (file.startsWith(path.join(process.cwd(), "public")) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html" : "application/octet-stream" });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(404).end("Not found");
  }).listen(PORT, () => {
    console.log(`Router running at http://localhost:${PORT}  (MOCK_MODE=${config.mockMode}, SF_WRITE_MODE=${config.salesforce.writeMode})`);
  });
}

main();
