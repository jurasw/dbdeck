const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const random = (size) => crypto.getRandomValues(new Uint8Array(size));
export function base64(value) {
  const array = new Uint8Array(value);
  let text = "";
  for (let offset = 0; offset < array.length; offset += 32768)
    text += String.fromCharCode(...array.subarray(offset, offset + 32768));
  return btoa(text);
}
export function bytes(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
const rawKey = (value) =>
  crypto.subtle.importKey("raw", value, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
export const newKey = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
export async function seal(key, value) {
  const iv = random(12);
  const plaintext = typeof value === "string" ? encoder.encode(value) : value;
  return {
    iv: base64(iv),
    ciphertext: base64(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
    ),
  };
}
export async function unseal(key, payload) {
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes(payload.iv) },
      key,
      bytes(payload.ciphertext),
    ),
  );
}
async function phraseKey(phrase, salt) {
  const input = await crypto.subtle.importKey(
    "raw",
    encoder.encode(phrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytes(salt), iterations: 600000, hash: "SHA-256" },
    input,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function wrapPhrase(key, phrase) {
  if (phrase.length < 12)
    throw new Error("Use a phrase with at least 12 characters.");
  const salt = base64(random(16));
  return {
    salt,
    key: await seal(
      await phraseKey(phrase, salt),
      new Uint8Array(await crypto.subtle.exportKey("raw", key)),
    ),
  };
}
export async function unlockPhrase(record, phrase) {
  try {
    const wrapping = await phraseKey(phrase, record.lock.phrase.salt);
    return await rawKey(await unseal(wrapping, record.lock.phrase.key));
  } catch {
    throw new Error("The phrase could not unlock this project.");
  }
}
export async function encryptProject(record, key, data) {
  const result = {
    ...record,
    encrypted: await seal(key, JSON.stringify(data)),
    updatedAt: Date.now(),
  };
  delete result.data;
  return result;
}
export async function decryptProject(record, key) {
  return JSON.parse(decoder.decode(await unseal(key, record.encrypted)));
}
async function prfKey(output) {
  const input = await crypto.subtle.importKey("raw", output, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: encoder.encode("DBDeck local vault v1"),
      info: encoder.encode("project key wrapping"),
      hash: "SHA-256",
    },
    input,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function registerPasskey(
  key,
  name,
  credentials = navigator.credentials,
) {
  if (!globalThis.PublicKeyCredential || !isSecureContext)
    throw new Error("Passkeys require HTTPS and a supported browser.");
  if (/^[\d.]+$/.test(location.hostname) || location.hostname.includes(":"))
    throw new Error(
      "Passkeys need a hostname. Open the app on localhost or dashboard.dbdeck.dev, rather than an IP address.",
    );
  const salt = random(32);
  const credential = await credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: "DBDeck" },
      user: { id: random(32), name, displayName: name },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
      attestation: "none",
      timeout: 60000,
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  if (!credential?.getClientExtensionResults().prf?.enabled)
    throw new Error(
      "This passkey cannot encrypt local data (PRF is unavailable). Use a phrase or another supported authenticator.",
    );
  const id = base64(credential.rawId);
  let output = credential.getClientExtensionResults().prf?.results?.first;
  if (!output)
    output = (
      await credentials.get({
        publicKey: {
          challenge: random(32),
          allowCredentials: [{ type: "public-key", id: credential.rawId }],
          userVerification: "required",
          extensions: { prf: { eval: { first: salt } } },
        },
      })
    )?.getClientExtensionResults().prf?.results?.first;
  if (!output)
    throw new Error(
      "The authenticator did not provide an encryption key. No project settings were changed.",
    );
  return {
    id,
    salt: base64(salt),
    key: await seal(
      await prfKey(output),
      new Uint8Array(await crypto.subtle.exportKey("raw", key)),
    ),
  };
}
export async function unlockPasskey(
  record,
  credentials = navigator.credentials,
) {
  const saved = record.lock.passkey;
  const result = await credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: "public-key", id: bytes(saved.id) }],
      userVerification: "required",
      timeout: 60000,
      extensions: { prf: { eval: { first: bytes(saved.salt) } } },
    },
  });
  const output = result?.getClientExtensionResults().prf?.results?.first;
  if (!output)
    throw new Error(
      "The passkey could not unlock this project. Use its recovery phrase if one is configured.",
    );
  try {
    return await rawKey(await unseal(await prfKey(output), saved.key));
  } catch {
    throw new Error("This passkey does not match the local project.");
  }
}
let database;
async function db() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("dbdeck-local", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("projects", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
async function transaction(mode, operation) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction("projects", mode);
    const request = operation(tx.objectStore("projects"));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export const listProjects = () =>
  transaction("readonly", (store) => store.getAll());
export const saveProject = (project) =>
  transaction("readwrite", (store) => store.put(project));
export const deleteProject = (id) =>
  transaction("readwrite", (store) => store.delete(id));
