import * as sqlite from "./sqlite.js";
import * as postgres from "./postgres.js";

/** @type {typeof sqlite} */
let adapter = sqlite;

export async function initDb(config) {
  adapter = config.databaseUrl ? postgres : sqlite;
  await adapter.initDb(config);
}

export function getDbDriver() {
  return adapter === postgres ? "postgres" : "sqlite";
}

export const createUser = (...args) => adapter.createUser(...args);
export const findUserByEmail = (...args) => adapter.findUserByEmail(...args);
export const findUserById = (...args) => adapter.findUserById(...args);
export const readWorkspace = (...args) => adapter.readWorkspace(...args);
export const writeWorkspace = (...args) => adapter.writeWorkspace(...args);
export const closeDb = (...args) => adapter.closeDb(...args);
