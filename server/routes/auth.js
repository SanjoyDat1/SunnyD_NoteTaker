import { Router } from "express";
import { hashPassword, verifyPassword, validatePassword } from "../crypto/password.js";
import { signJwt } from "../crypto/jwt.js";
import { createUser, findUserByEmail, findUserById } from "../db/index.js";
import { requireJwt } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DUMMY_HASH = hashPassword("__sunnyd_login_dummy__");

// Two independent login buckets: per-IP stops one host spraying many accounts;
// per-email stops a distributed attack hammering one account.
const emailKey = req =>
  typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
const loginIpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, keyPrefix: "login-ip" });
const loginEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyPrefix: "login-email",
  keyFn: emailKey,
  ignoreIp: true,
});
const loginLimiter = [loginIpLimiter, loginEmailLimiter];
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: "register" });

function validateEmail(email) {
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return "Valid email is required";
  }
  if (email.length > 254) return "Email is too long";
  return null;
}

export function createAuthRouter(config) {
  const router = Router();

  router.get("/config", (_req, res) => {
    res.json({
      authMode: config.authMode,
      registerEnabled: config.authMode === "jwt",
    });
  });

  if (config.authMode !== "jwt") {
    return router;
  }

  router.post("/register", registerLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr });
    const passErr = validatePassword(password);
    if (passErr) return res.status(400).json({ error: passErr });

    try {
      const passwordHash = hashPassword(password);
      const user = await createUser(email, passwordHash);
      const token = signJwt({ sub: user.id, email: user.email }, config.jwtSecret, config.jwtExpiresSec);
      res.status(201).json({
        token,
        user: { id: user.id, email: user.email },
      });
    } catch (err) {
      if (err.code === "EMAIL_TAKEN") {
        return res.status(409).json({ error: "Email already registered" });
      }
      res.status(500).json({ error: "Registration failed" });
    }
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    const emailErr = validateEmail(email);
    if (emailErr) return res.status(400).json({ error: emailErr });
    if (typeof password !== "string" || !password) {
      return res.status(400).json({ error: "Password is required" });
    }

    const user = await findUserByEmail(email);
    const valid = user
      ? verifyPassword(password, user.password_hash)
      : verifyPassword(password, DUMMY_HASH);
    if (!user || !valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signJwt({ sub: user.id, email: user.email }, config.jwtSecret, config.jwtExpiresSec);
    res.json({
      token,
      user: { id: user.id, email: user.email },
    });
  });

  router.get("/me", requireJwt(config), async (req, res) => {
    const user = await findUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: { id: user.id, email: user.email } });
  });

  return router;
}
