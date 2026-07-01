const buckets = new Map();

const SWEEP_INTERVAL_MS = 60 * 1000;
let lastSweep = Date.now();

function sweep(now) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.start >= bucket.windowMs) buckets.delete(key);
  }
  lastSweep = now;
}

function clientIp(req) {
  // X-Forwarded-For is client-supplied and trivially spoofable — only honor it
  // when the operator has declared a trusted reverse proxy in front of us.
  if (process.env.SUNNYD_TRUST_PROXY === "1") {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length) return fwd.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

/** Simple in-memory sliding-window rate limiter (single-process). */
export function rateLimit({ windowMs, max, keyPrefix = "", keyFn, ignoreIp = false }) {
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep >= SWEEP_INTERVAL_MS) sweep(now);

    const extra = keyFn ? `:${keyFn(req)}` : "";
    const key = `${keyPrefix}:${ignoreIp ? "" : clientIp(req)}${extra}`;
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0, windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ error: "Too many requests — try again later" });
    }
    return next();
  };
}
