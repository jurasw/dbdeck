import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import Module from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const directory = mkdtempSync(join(tmpdir(), "dbdeck-desktop-test-"));
process.env.NODE_PATH = resolve("../extension/node_modules");
Module._initPaths();
const file = join(directory, "shared.cjs");
await build({
  stdin: {
    contents: `export { DesktopStorage } from './src/storage'; export { createDemoDatabase } from './src/demo'; export { runQuery } from './src/query'; export { ConnectionStore, ConnectionManager } from '../extension/src/connections';`,
    resolveDir: resolve("."),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: file,
  alias: { vscode: resolve("test/vscode.mjs") },
  external: [
    "oracledb",
    "cpu-features",
    "pg-native",
    "kerberos",
    "@mongodb-js/zstd",
    "snappy",
    "socks",
    "aws4",
    "mongodb-client-encryption",
    "@aws-sdk/credential-providers",
    "gcp-metadata",
  ],
  loader: { ".node": "empty" },
});
const {
  DesktopStorage,
  createDemoDatabase,
  runQuery,
  ConnectionStore,
  ConnectionManager,
} = createRequire(import.meta.url)(file);
const key = randomBytes(32);
const encryption = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final()]);
  },
  decryptString(value) {
    const decipher = createDecipheriv(
      "aes-256-cbc",
      key,
      value.subarray(0, 16),
    );
    return Buffer.concat([
      decipher.update(value.subarray(16)),
      decipher.final(),
    ]).toString("utf8");
  },
};

test("shared connection store persists encrypted secrets and keeps session credentials out of disk", async () => {
  const path = join(directory, "connections.json");
  const storage = new DesktopStorage(path, encryption);
  const store = new ConnectionStore(storage);
  await store.save({
    id: "saved",
    name: "Saved",
    type: "postgres",
    password: "saved-password",
    uri: "mongodb://private",
    ssh: { password: "ssh-private" },
  });
  const disk = readFileSync(path, "utf8");
  for (const secret of ["saved-password", "mongodb://private", "ssh-private"])
    assert.ok(!disk.includes(secret));
  const restarted = new ConnectionStore(new DesktopStorage(path, encryption));
  assert.equal((await restarted.full("saved")).password, "saved-password");
  await store.save({
    id: "session",
    name: "Session",
    type: "postgres",
    savePassword: false,
    password: "session-password",
  });
  assert.equal((await store.full("session")).password, "session-password");
  assert.ok(!readFileSync(path, "utf8").includes("session-password"));
  assert.equal(
    (
      await new ConnectionStore(new DesktopStorage(path, encryption)).full(
        "session",
      )
    ).password,
    undefined,
  );
  await store.save({
    id: "saved",
    name: "Saved",
    type: "postgres",
    savePassword: false,
    password: "replacement",
  });
  assert.equal(
    (
      await new ConnectionStore(new DesktopStorage(path, encryption)).full(
        "saved",
      )
    ).password,
    undefined,
  );
  await store.remove("session");
  assert.equal(store.get("session"), undefined);
});

test("missing Keychain never falls back to plaintext", async () => {
  const storage = new DesktopStorage(join(directory, "no-keychain.json"), {
    ...encryption,
    isEncryptionAvailable: () => false,
  });
  await assert.rejects(
    storage.secrets.store("key", "private"),
    /Keychain is unavailable/,
  );
  assert.equal(await storage.secrets.get("key"), undefined);
});

test("desktop uses shared SQLite driver for queries, paging, edits, schema and read-only enforcement", async () => {
  const database = createDemoDatabase(directory);
  const store = new ConnectionStore(
    new DesktopStorage(join(directory, "sqlite.json"), encryption),
  );
  await store.save({
    id: "demo",
    name: "Demo",
    type: "sqlite",
    database,
    readonly: true,
    savePassword: false,
  });
  const manager = new ConnectionManager(store);
  try {
    const driver = await manager.get("demo");
    assert.deepEqual(await driver.databases(), ["main"]);
    const results = await runQuery(
      driver,
      "SELECT name FROM customers ORDER BY id; SELECT COUNT(*) AS total FROM orders;",
      "main",
    );
    assert.equal(results.length, 2);
    assert.equal(results[0].rows[0][0], "Alex Morgan");
    assert.equal(results[1].rows[0][0], 4);
    const blocked = await runQuery(
      driver,
      "DELETE FROM orders; SELECT * FROM orders;",
      "main",
    );
    assert.equal(blocked.length, 1);
    assert.match(blocked[0].error, /read-only/);
    assert.equal(
      (
        await driver.page(
          { database: "main", table: "orders" },
          { limit: 2, offset: 0 },
        )
      ).rows.length,
      2,
    );
    assert.equal((await driver.foreignKeys("main"))[0].target, "customers");
    await manager.disconnect("demo");
    await store.save({
      id: "demo",
      name: "Demo",
      type: "sqlite",
      database,
      savePassword: false,
    });
    const writable = await manager.get("demo");
    const changes = {
      updates: [{ key: { id: 1002 }, values: { status: "paid" } }],
      inserts: [],
      deletes: [],
    };
    await writable.apply({ database: "main", table: "orders" }, changes);
    assert.equal(
      (
        await runQuery(
          writable,
          "SELECT status FROM orders WHERE id = 1002",
          "main",
        )
      )[0].rows[0][0],
      "paid",
    );
    const stopped = await runQuery(
      writable,
      "SELECT * FROM missing_table; DELETE FROM orders;",
      "main",
    );
    assert.equal(stopped.length, 1);
    assert.ok(stopped[0].error);
    assert.equal(
      await writable.count({ database: "main", table: "orders" }),
      4,
    );
  } finally {
    await manager.disconnect("demo");
  }
});

process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
