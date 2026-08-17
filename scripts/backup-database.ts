import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { CanonicalStore } from "../src/indexer/store.js";
import { loadPoolAbiFixture, reviewPoolAbi } from "../src/starknet/abi.js";
import { mainnetConfig } from "../src/starknet/config.js";

const sourcePath = resolve(process.env.CUTOUT_DB_PATH ?? "data/cutout.sqlite");
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
const abi = reviewPoolAbi(await loadPoolAbiFixture());
const store = new CanonicalStore({ path: sourcePath, config, abi, readOnly: true });
try {
  const pages = await store.backupTo(destinationPath);
  console.log(JSON.stringify({
    event: "database_backup",
    source: sourcePath,
    destination: destinationPath,
    pages,
  }));
} finally {
  store.close();
}
