import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handlePhone } from "../lib/phone";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });
  let body = req.body;
  if (typeof body === "string") try { body = JSON.parse(body); } catch { body = {}; }
  const out = await handlePhone(body);
  return res.status(out.status).json(out.body);
}
