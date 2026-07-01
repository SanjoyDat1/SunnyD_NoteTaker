/** @returns {'legacy' | 'jwt'} */
export function getAuthMode() {
  return process.env.SUNNYD_JWT_SECRET ? "jwt" : "legacy";
}

export function getConfig() {
  const authMode = getAuthMode();
  const jwtSecret = process.env.SUNNYD_JWT_SECRET || "";
  const bind = process.env.SUNNYD_BIND || "127.0.0.1";
  const isLocalBind = bind === "127.0.0.1" || bind === "localhost";

  return {
    port: Number(process.env.PORT) || 3001,
    host: bind,
    corsOrigin: process.env.SUNNYD_CORS_ORIGIN || "http://localhost:5173",
    authMode,
    jwtSecret,
    apiSecret: process.env.SUNNYD_API_SECRET || "",
    databaseUrl: process.env.DATABASE_URL || "",
    sqlitePath: process.env.SUNNYD_DB_PATH || "",
    isLocalBind,
    jwtExpiresSec: Number(process.env.SUNNYD_JWT_EXPIRES_SEC) || 60 * 60 * 24 * 7,
  };
}

export const LEGACY_USER_ID = "__legacy__";

export function validateStartupConfig(config) {
  if (!config.isLocalBind && config.authMode === "legacy" && !config.apiSecret) {
    process.stderr.write(
      "Refusing to start: SUNNYD_API_SECRET is required when binding to a non-localhost address in legacy auth mode.\n",
    );
    process.exit(1);
  }
  if (!config.isLocalBind && config.authMode === "jwt" && !config.jwtSecret) {
    process.stderr.write(
      "Refusing to start: SUNNYD_JWT_SECRET is required when binding to a non-localhost address.\n",
    );
    process.exit(1);
  }
  if (config.databaseUrl && config.authMode === "legacy") {
    process.stderr.write(
      "Refusing to start: DATABASE_URL (PostgreSQL) requires jwt auth mode — set SUNNYD_JWT_SECRET.\n",
    );
    process.exit(1);
  }
  if (config.authMode === "jwt" && config.jwtSecret.length < 32) {
    process.stderr.write(
      "Refusing to start: SUNNYD_JWT_SECRET must be at least 32 characters in jwt auth mode.\n",
    );
    process.exit(1);
  }
}
