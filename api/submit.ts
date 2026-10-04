import { waitUntil } from "@vercel/functions";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleSubmission } from "../lib/router";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });
  const body = typeof req.body === "string" ? safeJson(req.body) : req.body;
  const out = await handleSubmission(body);
  if (out.background) waitUntil(out.background);
  return res.status(out.status).json(out.body);
}

function safeJson(s: string) {
  try { return JSON.parse(s); } catch { return {}; }
}
