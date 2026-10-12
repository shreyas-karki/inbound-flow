import { waitUntil } from "@vercel/functions";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { warmStarbridge } from "../lib/warm";

// GET /api/warm?school=…&email=…&state=… from the Unbounce page's school search. Answers at once; the
// Starbridge lookup finishes in the background.
export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = req.query as Record<string, string | undefined>;
  const work = warmStarbridge({ school: q.school, email: q.email, state: q.state });
  if (work) waitUntil(work);
  return res.status(202).json({ ok: true, warming: Boolean(work) });
}
