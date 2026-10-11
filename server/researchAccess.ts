import { timingSafeEqual } from 'node:crypto';

const requests = new Map<string, { start: number; count: number }>();
/** Fail closed: a provider credential alone never enables public spending. */
export function authorizeResearch(req: any, res: any): boolean {
  const expected = process.env.NFL_RESEARCH_ACCESS_KEY?.trim();
  if (!expected) { res.status(503).json({ error: 'Paid research is locked until the owner configures a research access key.' }); return false; }
  const supplied = req.headers?.['x-research-key'];
  if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    res.status(401).json({ error: 'Enter the owner’s research access key to run paid research.' }); return false;
  }
  const now = Date.now();
  for (const [key, value] of requests) if (now - value.start >= 60_000) requests.delete(key);
  const bucket = requests.get(expected) || { start: now, count: 0 };
  if (++bucket.count > 10) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: 'Research request limit reached. Try again in a minute.' }); return false; }
  requests.set(expected, bucket);
  return true;
}
