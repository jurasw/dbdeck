import { test } from "node:test";
import assert from "node:assert/strict";
import { createConnector } from "../connector/server.mjs";
import { request } from "node:http";

const origin = "http://127.0.0.1:8080";
const snapshot = (secret) => ({
  globals: {},
  workspace: {},
  config: {},
  secrets: secret ? { example: secret } : {},
  meta: { name: "Test project" },
});
function client(connector) {
  let session = "";
  return {
    async request(path, body, overrides = {}) {
      const response = await fetch(`${connector.url}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          Authorization: `Bearer ${connector.token}`,
          "X-DBDeck-Session": session,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...overrides,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, value: await response.json() };
    },
    async open(value) {
      const response = await this.request("/session", { snapshot: value });
      assert.equal(response.status, 200);
      session = response.value.sessionId;
      return session;
    },
  };
}

test("the loopback connector rejects unpaired origins, rebinding Hosts and missing capabilities", async () => {
  const connector = await createConnector({ port: 0, origin });
  try {
    const api = client(connector);
    assert.equal(
      (
        await api.request("/health", undefined, {
          Origin: "https://untrusted.example",
        })
      ).status,
      403,
    );
    const rebinding = await new Promise((resolve, reject) => {
      const req = request(
        `${connector.url}/health`,
        {
          headers: {
            Origin: origin,
            Host: "untrusted.example",
            Authorization: `Bearer ${connector.token}`,
          },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(rebinding, 403);
    assert.equal(
      (await api.request("/health", undefined, { Authorization: "" })).status,
      401,
    );
    assert.equal((await api.request("/health")).status, 200);
  } finally {
    await connector.close();
  }
});

test("the actual extension activates locally and locking invalidates its secret-bearing session", async () => {
  const connector = await createConnector({ port: 0, origin });
  try {
    const first = client(connector);
    const firstId = await first.open(snapshot("local-test-secret"));
    assert.deepEqual(
      (await first.request("/rpc", { method: "tree" })).value.result,
      [],
    );
    assert.equal(
      (await first.request("/rpc", { method: "snapshot" })).value.result.secrets
        .example,
      "local-test-secret",
    );
    assert.equal(
      (await first.request("/rpc", { method: "arbitrary-code" })).status,
      400,
    );
    const second = client(connector);
    assert.notEqual(await second.open(snapshot()), firstId);
    assert.equal(
      (await first.request("/rpc", { method: "snapshot" })).status,
      409,
    );
    assert.deepEqual(
      (await second.request("/rpc", { method: "snapshot" })).value.result
        .secrets,
      {},
    );
    assert.equal((await second.request("/reset", {})).status, 200);
    assert.equal(
      (await second.request("/rpc", { method: "snapshot" })).status,
      409,
    );
  } finally {
    await connector.close();
  }
});

test("a disconnected client times out and cannot recover its previous live session", async () => {
  const connector = await createConnector({ port: 0, origin, idleMs: 80 });
  try {
    const api = client(connector);
    await api.open(snapshot("short-lived-secret"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(
      (await api.request("/rpc", { method: "snapshot" })).status,
      409,
    );
  } finally {
    await connector.close();
  }
});

test("connections export as a browser download and import from a browser file", async () => {
  const connector = await createConnector({ port: 0, origin });
  try {
    const api = client(connector);
    await api.open(snapshot());
    let after = 0;
    const next = async (type, kind) => {
      for (;;) {
        const { events } = (await api.request(`/events?after=${after}`)).value;
        for (const event of events) {
          after = event.sequence;
          if (event.type === type && (!kind || event.kind === kind))
            return event;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    const respond = (id, value) =>
      api.request("/rpc", { method: "respond", params: { id, value } });
    const command = (name) =>
      api.request("/rpc", { method: "command", params: { command: name } });

    const imported = command("dbdeck.importConnections");
    const open = await next("request", "open-file");
    assert.ok(open.options.filters);
    const file = [{ id: "browser-file", name: "Browser file", type: "sqlite" }];
    await respond(open.id, {
      uploads: [
        {
          name: "connections.json",
          data: Buffer.from(JSON.stringify(file)).toString("base64"),
        },
      ],
    });
    assert.equal((await imported).status, 200);
    const tree = (await api.request("/rpc", { method: "tree" })).value.result;
    assert.deepEqual(
      tree.map((row) => row.node.label ?? row.id),
      ["Browser file"],
    );

    const exported = command("dbdeck.exportConnections");
    await respond((await next("request", "pick")).id, 0);
    await respond((await next("request", "save-file")).id, { download: true });
    const download = await next("download");
    assert.equal((await exported).status, 200);
    assert.match(download.name, /\.json$/);
    assert.deepEqual(
      JSON.parse(Buffer.from(download.data, "base64").toString("utf8")).map(
        (c) => c.name,
      ),
      ["Browser file"],
    );
  } finally {
    await connector.close();
  }
});
