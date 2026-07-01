import { createHmac, timingSafeEqual } from "node:crypto";

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function signJwt(payload, secret, expiresSec) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresSec,
  };
  const payloadPart = b64url(JSON.stringify(body));
  const data = `${header}.${payloadPart}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyJwt(token, secret) {
  if (!token || typeof token !== "string") throw new Error("Invalid token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");

  const [headerPart, payloadPart, sigPart] = parts;
  const data = `${headerPart}.${payloadPart}`;
  const expected = createHmac("sha256", secret).update(data).digest();
  const actual = b64urlDecode(sigPart);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Invalid signature");
  }

  const payload = JSON.parse(b64urlDecode(payloadPart).toString("utf8"));
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }
  return payload;
}
