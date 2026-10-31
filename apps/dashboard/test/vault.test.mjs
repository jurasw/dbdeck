import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newKey,
  wrapPhrase,
  unlockPhrase,
  encryptProject,
  decryptProject,
  seal,
} from "../src/vault.mjs";

test("phrase encryption persists no plaintext, rejects wrong phrases and restores actual data", async () => {
  const key = await newKey();
  const data = {
    globals: { name: "Production project" },
    secrets: { password: "sensitive-database-password" },
  };
  const record = await encryptProject(
    {
      id: "project",
      lock: { phrase: await wrapPhrase(key, "a long recovery phrase") },
    },
    key,
    data,
  );
  assert.ok(!JSON.stringify(record).includes("sensitive-database-password"));
  assert.ok(!JSON.stringify(record).includes("Production project"));
  await assert.rejects(unlockPhrase(record, "another recovery phrase"));
  const unlocked = await unlockPhrase(record, "a long recovery phrase");
  assert.deepEqual(await decryptProject(record, unlocked), data);
});

test("every write uses a fresh nonce and authenticated ciphertext rejects tampering", async () => {
  const key = await newKey();
  const first = await seal(key, "database credentials");
  const second = await seal(key, "database credentials");
  assert.notEqual(first.iv, second.iv);
  const record = await encryptProject({ id: "project" }, key, {
    secrets: "data",
  });
  const original = record.encrypted.ciphertext;
  record.encrypted.ciphertext =
    (original[0] === "A" ? "B" : "A") + original.slice(1);
  await assert.rejects(decryptProject(record, key));
});
