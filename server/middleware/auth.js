import { timingSafeEqual } from "node:crypto";
import { verifyJwt } from "../crypto/jwt.js";
import { LEGACY_USER_ID } from "../config.js";

function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.headers["x-sunnyd-secret"] || null;
}

function secretsEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function legacyAuth(req, res, next, apiSecret) {
  if (!apiSecret) {
    req.userId = LEGACY_USER_ID;
    return next();
  }
  const token = extractToken(req);
  if (!token || !secretsEqual(token, apiSecret)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.userId = LEGACY_USER_ID;
  return next();
}

function jwtAuth(req, res, next, jwtSecret) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = verifyJwt(token, jwtSecret);
    if (!payload.sub) return res.status(401).json({ error: "Unauthorized" });
    req.userId = payload.sub;
    req.userEmail = payload.email || null;
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

/** Protects /api/notes — legacy shared secret or JWT depending on auth mode. */
export function createNotesAuthMiddleware(config) {
  return (req, res, next) => {
    if (config.authMode === "jwt") {
      return jwtAuth(req, res, next, config.jwtSecret);
    }
    return legacyAuth(req, res, next, config.apiSecret);
  };
}

/** Optional JWT for /api/auth/me */
export function requireJwt(config) {
  return (req, res, next) => jwtAuth(req, res, next, config.jwtSecret);
}
