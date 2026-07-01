import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  if (!stored?.startsWith("scrypt$")) return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], "base64");
  const expected = Buffer.from(parts[2], "base64");
  const actual = scryptSync(password, salt, expected.length, SCRYPT_PARAMS);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function validatePassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (password.length > 256) return "Password is too long";
  return null;
}
