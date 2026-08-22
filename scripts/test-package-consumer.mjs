import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "cutout-guard-consumer-"));
const repositoryManifest = JSON.parse(readFileSync(
  resolve(repositoryRoot, "package.json"),
  "utf8",
));

try {
  execFileSync("npm", [
    "pack",
    resolve(repositoryRoot, "packages/guard"),
    "--pack-destination",
    temporaryRoot,
    "--silent",
  ], { cwd: repositoryRoot, stdio: "pipe" });
  const tarball = readdirSync(temporaryRoot).find((file) => file.endsWith(".tgz"));
  assert.ok(tarball, "package tarball was not produced");

  writeFileSync(join(temporaryRoot, "package.json"), JSON.stringify({
    name: "cutout-guard-consumer-test",
    private: true,
    type: "module",
    dependencies: {
      react: repositoryManifest.dependencies.react,
    },
    devDependencies: {
      "@types/react": repositoryManifest.devDependencies["@types/react"],
    },
  }, null, 2));
  copyFileSync(
    resolve(repositoryRoot, "examples/guard-consumer/index.ts"),
    join(temporaryRoot, "index.ts"),
  );
  copyFileSync(
    resolve(repositoryRoot, "examples/guard-consumer/evidence-panel.tsx"),
    join(temporaryRoot, "evidence-panel.tsx"),
  );
  copyFileSync(
    resolve(repositoryRoot, "examples/guard-consumer/tsconfig.json"),
    join(temporaryRoot, "tsconfig.json"),
  );
  execFileSync("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    resolve(temporaryRoot, tarball),
  ], { cwd: temporaryRoot, stdio: "pipe" });

  const typescript = resolve(repositoryRoot, "node_modules/typescript/bin/tsc");
  execFileSync(process.execPath, [typescript, "-p", "tsconfig.json"], {
    cwd: temporaryRoot,
    stdio: "pipe",
  });
  const output = execFileSync(process.execPath, ["dist/index.js"], {
    cwd: temporaryRoot,
    encoding: "utf8",
  });
  const result = JSON.parse(output);
  assert.equal(result.packageApi, "CUTOUT_GUARD_API-v1");
  assert.equal(result.model, "CUTOUT-v1.4");
  assert.equal(result.replayModel, "CUTOUT-v1.3");
  assert.equal(result.action.type, "deposit");

  const manifest = JSON.parse(readFileSync(
    join(temporaryRoot, "node_modules/@cutout/guard/package.json"),
    "utf8",
  ));
  assert.equal(manifest.name, "@cutout/guard");
  assert.deepEqual(Object.keys(manifest.exports), [".", "./react"]);

  console.log(JSON.stringify({
    status: "PASS",
    package: `${manifest.name}@${manifest.version}`,
    exports: Object.keys(manifest.exports),
    consumer: result,
  }, null, 2));
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
