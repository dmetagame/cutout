import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";

import { mainnetConfig } from "../src/starknet/config.js";

const sourcePath = resolve(process.env.CUTOUT_DB_PATH ?? "data/cutout.sqlite");
if (!existsSync(sourcePath)) throw new Error("CUTOUT_DB_PATH does not exist.");
const destinationValue = process.env.CUTOUT_BACKUP_PATH;
if (destinationValue === undefined || destinationValue.trim() === "") {
  throw new Error("CUTOUT_BACKUP_PATH must name a new backup file.");
}
const destinationPath = resolve(destinationValue);
if (existsSync(destinationPath)) {
  throw new Error("Refusing to overwrite an existing database backup.");
}
mkdirSync(dirname(destinationPath), { recursive: true });

const config = mainnetConfig();
const database = new DatabaseSync(sourcePath, {
  timeout: 5_000,
  readOnly: true,
});
try {
  database.exec("PRAGMA query_only = ON; PRAGMA foreign_keys = ON;");
  const schema = database
    .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
    .get() as { readonly value?: unknown } | undefined;
  if (typeof schema?.value !== "string") {
    throw new Error("CUTOUT_DB_PATH is not an initialized Cutout database.");
  }
  const columns = database.prepare("PRAGMA table_info(indexer_state)").all() as Array<{
    readonly name?: unknown;
  }>;
  const hasModelVersion = columns.some((column) => column.name === "model_version");
  const state = database.prepare(`
    SELECT chain_id, pool_address, abi_fixture_version${hasModelVersion ? ", model_version" : ""}
    FROM indexer_state
    WHERE singleton = 1
  `).get() as {
    readonly chain_id?: unknown;
    readonly pool_address?: unknown;
    readonly abi_fixture_version?: unknown;
    readonly model_version?: unknown;
  } | undefined;
  if (state?.chain_id !== config.chainId || state.pool_address !== config.poolAddress) {
    throw new Error("CUTOUT_DB_PATH belongs to another chain or STRK20 pool.");
  }
  const modelVersion = hasModelVersion ? state.model_version : "CUTOUT-v1.3";
  if (modelVersion !== "CUTOUT-v1.3" && modelVersion !== "CUTOUT-v1.4") {
    throw new Error("CUTOUT_DB_PATH has an unsupported model identity.");
  }
  const pages = await sqliteBackup(database, destinationPath);
  console.log(JSON.stringify({
    event: "database_backup",
    source: sourcePath,
    destination: destinationPath,
    pages,
    schemaVersion: schema.value,
    modelVersion,
    abiFixtureVersion: state.abi_fixture_version,
  }));
} finally {
  database.close();
}
