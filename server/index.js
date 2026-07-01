import express from "express";
import cors from "cors";
import { loadEnvFile } from "./env.js";
import { getConfig, validateStartupConfig } from "./config.js";
import { initDb, getDbDriver } from "./db/index.js";
import { createNotesAuthMiddleware } from "./middleware/auth.js";
import { createAuthRouter } from "./routes/auth.js";
import notesRouter from "./routes/notes.js";

loadEnvFile();

const config = getConfig();
validateStartupConfig(config);

const app = express();

app.use(cors({ origin: config.corsOrigin }));
// Slightly above the 5 MB workspace cap in routes/notes.js so the body parser
// rejects oversized payloads before they are buffered and JSON.parsed.
app.use(express.json({ limit: "6mb" }));

await initDb(config);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sunnyd-sync" });
});

app.use("/api/auth", createAuthRouter(config));

const notesAuth = createNotesAuthMiddleware(config);
app.use("/api/notes", notesAuth, notesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(config.port, config.host, () => {
  const authLabel =
    config.authMode === "jwt"
      ? "jwt (per-user accounts)"
      : config.apiSecret
        ? "legacy shared secret"
        : "legacy — localhost only";
  process.stdout.write(
    `SunnyD sync server on http://${config.host}:${config.port} (auth: ${authLabel}, db: ${getDbDriver()})\n`,
  );
  if (config.authMode === "legacy" && !config.apiSecret) {
    process.stderr.write(
      "Warning: SUNNYD_API_SECRET is unset. Anyone who can reach this port can read/write the legacy workspace.\n",
    );
  }
  if (config.authMode === "jwt") {
    process.stdout.write("Register/login: POST /api/auth/register | POST /api/auth/login\n");
  }
});
