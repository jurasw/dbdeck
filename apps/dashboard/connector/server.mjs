import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const allowedMethods = new Set([
  "command",
  "tree",
  "panel-message",
  "panel-ready",
  "panel-close",
  "respond",
  "picker-change",
  "picker-accept",
  "picker-close",
  "editor-change",
  "editor-close",
  "editor-completions",
  "editor-lenses",
  "terminal-input",
  "terminal-close",
  "snapshot",
]);

export async function createConnector({
  port = 4319,
  origin = "https://dashboard.dbdeck.dev",
  idleMs = 120000,
} = {}) {
  const parsed = new URL(origin);
  if (
    parsed.origin !== origin ||
    !(
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(parsed.hostname))
    )
  )
    throw new Error(
      "Use the HTTPS dashboard origin or a loopback development origin.",
    );
  const token = randomBytes(32).toString("base64url");
  let worker,
    tempPath,
    sessionId,
    ready = false,
    events = [],
    sequence = 0,
    rpcId = 0,
    lastSeen = Date.now();
  const pending = new Map();
  let resetScheduled = false;
  const scheduleReset = () => {
    if (resetScheduled) return;
    resetScheduled = true;
    const job = serial.then(reset);
    serial = job
      .catch(() => {})
      .finally(() => {
        resetScheduled = false;
      });
  };
  const queue = (event) => {
    events.push({ sequence: ++sequence, ...event });
    if (events.length > 1000) scheduleReset();
  };
  function call(method, params) {
    if (!worker)
      return Promise.reject(
        new Error("Open a project before using the local connector."),
      );
    const id = ++rpcId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Local operation timed out."));
      }, 120000);
      pending.set(id, { resolve, reject, timeout });
      worker.postMessage({ id, method, params });
    });
  }
  async function reset() {
    const old = worker;
    worker = undefined;
    sessionId = undefined;
    ready = false;
    events = [];
    for (const { reject, timeout } of pending.values()) {
      clearTimeout(timeout);
      reject(new Error("The project was locked or disconnected."));
    }
    pending.clear();
    if (old) {
      old.postMessage({ id: 0, method: "dispose", params: {} });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await old.terminate();
    }
    if (tempPath) {
      await rm(tempPath, { recursive: true, force: true });
      tempPath = undefined;
    }
  }
  let serial = Promise.resolve();
  async function start(snapshot) {
    await reset();
    sessionId = randomBytes(16).toString("base64url");
    tempPath = await mkdtemp(join(tmpdir(), "dbdeck-local-"));
    const manifest = JSON.parse(
      await readFile(join(root, "public/extension/manifest.json"), "utf8"),
    );
    worker = new Worker(join(root, "dist/host-worker.cjs"), {
      workerData: {
        snapshot,
        origin,
        tempPath,
        extensionPath: join(root, "public/extension"),
        themePath: join(root, "src/theme.css"),
        version: manifest.version,
        configuration: manifest.configuration?.properties,
      },
    });
    const current = worker;
    worker.on("message", (message) => {
      if (worker !== current) return;
      if (message.type === "event") queue(message.event);
      if (message.type === "response") {
        const result = pending.get(message.id);
        if (!result) return;
        pending.delete(message.id);
        clearTimeout(result.timeout);
        if (message.error) result.reject(new Error(message.error));
        else result.resolve(message.result);
      }
    });
    worker.on("error", (error) => {
      if (worker === current) {
        queue({ type: "notice", error: true, message: error.message });
        scheduleReset();
      }
    });
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("The local extension did not start.")),
          20000,
        );
        const started = (message) => {
          if (message.type === "ready") {
            clearTimeout(timeout);
            current.off("message", started);
            resolve();
          }
        };
        current.on("message", started);
        current.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        current.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error(`Local extension exited (${code}).`));
        });
      });
    } catch (error) {
      await reset();
      throw error;
    }
    ready = true;
    lastSeen = Date.now();
    return { sessionId, version: manifest.version };
  }
  const server = createServer(async (req, res) => {
    const headers = {
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Authorization, Content-Type, X-DBDeck-Session",
      "Access-Control-Allow-Private-Network": "true",
    };
    const reply = (code, body) => {
      res.writeHead(code, headers);
      res.end(JSON.stringify(body));
    };
    // Check Host before CORS to resist DNS rebinding. No untrusted web origin
    // may query even the health endpoint or preflight private-network access.
    if (
      !new Set([
        `127.0.0.1:${server.address()?.port}`,
        `localhost:${server.address()?.port}`,
      ]).has(req.headers.host) ||
      req.headers.origin !== origin
    )
      return reply(403, {
        error: "This origin is not paired with the local connector.",
      });
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    const supplied = Buffer.from(
      req.headers.authorization?.replace(/^Bearer /, "") ?? "",
    );
    const expected = Buffer.from(token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return reply(401, {
        error: "Pair this browser with your local connector.",
      });
    const url = new URL(req.url, "http://localhost");
    lastSeen = Date.now();
    try {
      if (req.method === "GET" && url.pathname === "/health")
        return reply(200, { local: true });
      if (req.method === "POST") {
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return reply(415, { error: "Use application/json." });
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 20 * 1024 * 1024)
            return reply(413, { error: "Request too large." });
          chunks.push(chunk);
        }
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (url.pathname === "/session") {
          const job = serial.then(() => start(body.snapshot));
          serial = job.catch(() => {});
          return reply(200, await job);
        }
        if (url.pathname === "/reset") {
          scheduleReset();
          await serial;
          return reply(200, {});
        }
        if (req.headers["x-dbdeck-session"] !== sessionId || !sessionId)
          return reply(409, {
            error: "The local project session ended. Reopen the project.",
          });
        if (url.pathname === "/rpc") {
          if (!allowedMethods.has(body.method))
            return reply(400, { error: "Unknown operation." });
          return reply(200, { result: await call(body.method, body.params) });
        }
      }
      if (req.method === "GET" && url.pathname === "/events") {
        if (req.headers["x-dbdeck-session"] !== sessionId || !sessionId)
          return reply(409, {
            error: "The local project session ended. Reopen the project.",
          });
        const after = Number(url.searchParams.get("after") ?? 0);
        events = events.filter((event) => event.sequence > after);
        return reply(200, { events });
      }
      reply(404, { error: "Not found." });
    } catch (error) {
      reply(400, { error: error.message });
    }
  });
  server.requestTimeout = 125000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const timeout = setInterval(
    () => {
      if (worker && ready && Date.now() - lastSeen > idleMs) {
        scheduleReset();
      }
    },
    Math.min(idleMs, 10000),
  );
  timeout.unref();
  return {
    token,
    url: `http://127.0.0.1:${server.address().port}`,
    origin,
    async close() {
      clearInterval(timeout);
      await serial;
      await reset();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const origin =
    process.argv[process.argv.indexOf("--dashboard") + 1] &&
    process.argv.includes("--dashboard")
      ? process.argv[process.argv.indexOf("--dashboard") + 1]
      : "https://dashboard.dbdeck.dev";
  const connector = await createConnector({ origin });
  const link = `${origin}/#connector=${encodeURIComponent(connector.url)}&token=${connector.token}`;
  console.log(
    `DBDeck local connector listens on ${connector.url}. Database credentials stay on this computer.\nOpen this paired link in your browser:\n${link}`,
  );
  if (!process.argv.includes("--no-open")) {
    const command =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "rundll32"
          : "xdg-open";
    const args =
      process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", link]
        : [link];
    spawn(command, args, { stdio: "ignore" }).on("error", () => {});
  }
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      await connector.close();
      process.exit(0);
    });
}
