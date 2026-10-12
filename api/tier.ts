import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleTier } from "../lib/tier";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });
  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  const secret = req.headers["x-inbound-secret"];
  const out = await handleTier(Array.isArray(secret) ? secret[0] : secret, body);
  return res.status(out.status).json(out.body);
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return {}; }
}
