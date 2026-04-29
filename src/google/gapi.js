import { getValidAccessToken } from "./auth.js";

/** @returns {Promise<Response>} */
export async function gfetch(url, opts = {}) {
  const token = await getValidAccessToken();
  const headers = new Headers(opts.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...opts, headers });
}
