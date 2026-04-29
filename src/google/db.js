import { GOOGLE_DB, GOOGLE_DB_VERSION } from "./constants.js";

/** @typedef {{ refresh_token?: string, access_token?: string, expires_at?: number }} GoogleTokens */

export function openGoogleDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(GOOGLE_DB, GOOGLE_DB_VERSION);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
    r.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("tokens")) db.createObjectStore("tokens");
      if (!db.objectStoreNames.contains("jobs")) db.createObjectStore("jobs", { keyPath: "jobId" });
      if (!db.objectStoreNames.contains("idem")) db.createObjectStore("idem", { keyPath: "key" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
  });
}

/** @param {GoogleTokens | null} t */
export async function saveGoogleTokens(t) {
  const db = await openGoogleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tokens", "readwrite");
    const st = tx.objectStore("tokens");
    if (!t || (!t.refresh_token && !t.access_token)) st.delete("default");
    else st.put(t, "default");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** @returns {Promise<GoogleTokens | null>} */
export async function loadGoogleTokens() {
  const db = await openGoogleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tokens", "readonly");
    const req = tx.objectStore("tokens").get("default");
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function getMeta(key) {
  const db = await openGoogleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readonly");
    const req = tx.objectStore("meta").get(key);
    req.onsuccess = () => resolve(req.result?.value ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(key, value) {
  const db = await openGoogleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key, value });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function hasIdempotency(key) {
  const db = await openGoogleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("idem", "readonly");
    const req = tx.objectStore("idem").get(key);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setIdempotency(key) {
  const db = await openGoogleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("idem", "readwrite");
    tx.objectStore("idem").put({ key, ts: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** @typedef {{ jobId: string, type?: string, status: string, step?: string, createdAt: number, noteId?: string, title?: string, webViewLink?: string, driveFileId?: string, error?: string, payload?: object, noteContext?: string }} WorkspaceJob */

/** @param {WorkspaceJob} job */
export async function saveJob(job) {
  const db = await openGoogleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("jobs", "readwrite");
    tx.objectStore("jobs").put(job);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** @returns {Promise<WorkspaceJob[]>} */
export async function listJobs(limit = 50) {
  const db = await openGoogleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("jobs", "readonly");
    const req = tx.objectStore("jobs").getAll();
    req.onsuccess = () => {
      const arr = (req.result || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
      resolve(arr);
    };
    req.onerror = () => reject(req.error);
  });
}

/** @returns {Promise<WorkspaceJob | null>} */
export async function getJob(jobId) {
  const db = await openGoogleDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("jobs", "readonly");
    const req = tx.objectStore("jobs").get(jobId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
