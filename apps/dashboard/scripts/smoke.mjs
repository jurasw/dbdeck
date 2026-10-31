import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";
import { preview } from "vite";
import { createConnector } from "../connector/server.mjs";

const executablePath =
  process.env.BROWSER_EXECUTABLE ||
  [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find(existsSync);
assert.ok(
  executablePath,
  "Set BROWSER_EXECUTABLE to an installed Chrome/Chromium.",
);
const site = await preview({
  configFile: false,
  preview: {
    host: "127.0.0.1",
    port: 0,
    headers: Object.fromEntries(
      readFileSync(new URL("../public/_headers", import.meta.url), "utf8")
        .split("\n")
        .filter((line) => line.startsWith("  "))
        .map((line) => {
          const split = line.indexOf(":");
          return [line.slice(0, split).trim(), line.slice(split + 1).trim()];
        }),
    ),
  },
  build: { outDir: "dist/site" },
});
const origin = `http://localhost:${site.httpServer.address().port}`;
const connector = await createConnector({ port: 0, origin });
const temp = mkdtempSync(join(tmpdir(), "dbdeck-web-smoke-"));
const file = join(temp, "smoke.sqlite");
const fixture = new DatabaseSync(file);
fixture.exec(
  "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT CHECK (name <> 'Rejected')); INSERT INTO customers VALUES (1, 'Local browser customer');",
);
fixture.close();
let browser, page;
try {
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  const traffic = [];
  page.on("request", (request) => traffic.push(request.url()));
  await page.goto(
    `${origin}/#connector=${encodeURIComponent(connector.url)}&token=${connector.token}`,
  );
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await page.getByText("Local engine connected", { exact: false }).waitFor();
  assert.equal(new URL(page.url()).hash, "");
  assert.equal(
    await page.getByLabel("Project phrase", { exact: true }).count(),
    0,
  );
  console.log(
    "Passed: optional protection, local pairing and shared extension activation.",
  );
  async function frameWith(selector) {
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const frame of page.frames())
        if (
          frame !== page.mainFrame() &&
          (await frame
            .locator(selector)
            .first()
            .isVisible()
            .catch(() => false))
        )
          return frame;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`The shared webview did not render ${selector}.`);
  }
  await page.getByLabel("Add connection", { exact: true }).click();
  const form = await frameWith("input#name");
  await form.getByRole("button", { name: "SQLite", exact: true }).click();
  await form.getByLabel("Name", { exact: true }).fill("Browser local SQLite");
  await form.getByLabel("Database file", { exact: true }).fill(file);
  await form
    .getByRole("button", { name: "Test connection", exact: true })
    .click();
  await form.getByRole("status").filter({ hasText: "Connected in" }).waitFor();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Browser local SQLite", { exact: true }).click();
  await page
    .getByRole("button", { name: "Expand customers", exact: true })
    .click();
  await page.getByText("id", { exact: true }).waitFor();
  await page.getByText("customers", { exact: true }).click();
  const grid = await frameWith(".grid");
  await grid.getByText("Local browser customer", { exact: true }).dblclick();
  await grid.locator("input.grid-editor").fill("Rejected");
  await grid.locator("input.grid-editor").press("Enter");
  await grid.getByRole("button", { name: /Save/ }).click();
  await grid.getByText("Save failed", { exact: true }).waitFor();
  await grid.getByRole("button", { name: "OK", exact: true }).click();
  await grid.getByText("1 pending", { exact: true }).waitFor();
  await grid.getByText("Rejected", { exact: true }).dblclick();
  await grid.locator("input.grid-editor").fill("Edited locally");
  await grid
    .locator("input.grid-editor")
    .press(`${process.platform === "darwin" ? "Meta" : "Control"}+s`);
  await grid.getByText("Saved · 1 row(s) affected", { exact: true }).waitFor();
  await grid
    .getByText("1 pending", { exact: true })
    .waitFor({ state: "hidden" });
  console.log(
    "Passed: original connection form, SQLite driver, grid, rejected save and corrected save.",
  );
  await page.getByRole("button", { name: "New query", exact: true }).click();
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press(
    `${process.platform === "darwin" ? "Meta" : "Control"}+A`,
  );
  await page.keyboard.insertText(
    "SELECT 'Browser SQL result' AS browser_result;",
  );
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const results = await frameWith(".tabs .tab");
  await results.getByText("Browser SQL result", { exact: true }).waitFor();
  await page.locator(".monaco-editor .view-lines").first().click();
  await page
    .locator(".codelens-decoration")
    .filter({ hasText: "Run" })
    .first()
    .waitFor();
  await page.screenshot({ path: "/tmp/dbdeck-dashboard.png" });
  console.log(
    "Passed: local Monaco editor and original query execution/results panel.",
  );
  await page.getByRole("button", { name: "Web settings", exact: true }).click();
  await page.getByRole("button", { name: "Set phrase", exact: true }).click();
  await page
    .getByLabel("New project phrase", { exact: true })
    .fill("a local recovery phrase");
  await page
    .getByLabel("Repeat project phrase", { exact: true })
    .fill("a local recovery phrase");
  await page
    .getByRole("button", { name: "Enable protection", exact: true })
    .click();
  await page
    .getByText("This project is encrypted with your phrase.", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide and lock project", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Project locked", exact: true })
    .waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  const saved = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("dbdeck-local", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new Promise((resolve, reject) => {
      const r = db.transaction("projects").objectStore("projects").getAll();
      r.onsuccess = () => resolve(JSON.stringify(r.result));
      r.onerror = () => reject(r.error);
    });
  });
  assert.ok(
    !saved.includes("Browser local SQLite") &&
      !saved.includes("recovery phrase") &&
      !saved.includes("Browser SQL result"),
  );
  await page
    .getByLabel("Project phrase", { exact: true })
    .fill("the wrong recovery phrase");
  await page
    .getByRole("button", { name: "Unlock with phrase", exact: true })
    .click();
  await page
    .getByText("The phrase could not unlock this project.", { exact: true })
    .waitFor();
  await page
    .getByLabel("Project phrase", { exact: true })
    .fill("a local recovery phrase");
  await page
    .getByRole("button", { name: "Unlock with phrase", exact: true })
    .click();
  await page.getByText("Browser local SQLite", { exact: true }).waitFor();
  assert.equal(await page.locator(".monaco-editor").count(), 1);
  await page.getByText("Browser local SQLite", { exact: true }).click();
  await page.getByText("customers", { exact: true }).click();
  await page.getByRole("button", { name: "New query", exact: true }).click();
  await page.locator(".monaco-editor").nth(1).waitFor();
  console.log(
    "Passed: encrypted IndexedDB, cleared lock screen, wrong-phrase rejection and project restoration.",
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  });
  await page.getByRole("button", { name: "Web settings", exact: true }).click();
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await page
    .getByText("Passkey protection enabled on this browser origin.", {
      exact: true,
    })
    .waitFor();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Hide and lock project", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Unlock with passkey", exact: true })
    .click();
  await page.getByText("Browser local SQLite", { exact: true }).waitFor();
  await page.clock.install();
  await page.getByRole("button", { name: "Web settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Hide data after inactivity", exact: true })
    .click();
  await page.getByRole("option", { name: "30 seconds", exact: true }).click();
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page.clock.fastForward(31000);
  await page
    .getByRole("heading", { name: "Project locked", exact: true })
    .waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  await page
    .getByRole("button", { name: "Unlock with passkey", exact: true })
    .click();
  await page.getByText("Browser local SQLite", { exact: true }).waitFor();
  console.log(
    "Passed: inactivity timer removes data and requires project verification again.",
  );
  await page.getByRole("button", { name: "Web settings", exact: true }).click();
  await page
    .getByLabel("Current project name", { exact: true })
    .fill("My local workspace");
  await page.getByLabel("Current project name", { exact: true }).press("Tab");
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .getByText("My local workspace", { exact: true })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Web settings", exact: true }).click();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({ path: "/tmp/dbdeck-dashboard-mobile-settings.png" });
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  console.log(
    "Passed: actual WebAuthn PRF registration and encrypted project unlock with a virtual authenticator.",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await page
    .getByRole("heading", { name: "Project locked", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Unlock with passkey", exact: true })
    .click();
  await page.getByText("Browser local SQLite", { exact: true }).waitFor();
  assert.ok(
    traffic.every(
      (url) =>
        url.startsWith(origin) ||
        url.startsWith(connector.url) ||
        url.startsWith("blob:"),
    ),
    "Dashboard traffic must stay on the static origin and local connector.",
  );
  assert.deepEqual(failures, []);
  console.log(
    "Passed: protected reload, passkey persistence and no third-party dashboard requests.",
  );
} catch (error) {
  console.error(String(error).replaceAll(connector.token, "[pairing token]"));
  if (page && !page.isClosed())
    await page
      .screenshot({ path: "/tmp/dbdeck-dashboard-smoke-failure.png" })
      .catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close();
  await connector.close();
  await new Promise((resolve) => site.httpServer.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}
