import { _electron as electron } from "playwright";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const directory = mkdtempSync(join(tmpdir(), "dbdeck-desktop-smoke-"));
const application = await electron.launch({
  ...(process.env.DBDECK_SMOKE_EXECUTABLE
    ? { executablePath: process.env.DBDECK_SMOKE_EXECUTABLE, args: [] }
    : { args: [resolve(".")] }),
  env: { ...process.env, DBDECK_SMOKE_DATA: directory },
});
const errors = [];
application.process().stderr.on("data", (data) => process.stderr.write(data));
application.on("window", (page) =>
  page.on("pageerror", (error) => errors.push(error.message)),
);
try {
  const home = await application.firstWindow();
  await home.getByRole("heading", { name: "Your databases." }).waitFor();
  await home.getByRole("button", { name: "Demo shop", exact: true }).click();
  await home
    .getByRole("button", { name: "demo-shop.sqlite", exact: true })
    .click();
  await home.getByRole("button", { name: "Tables", exact: true }).click();
  const [data] = await Promise.all([
    application.waitForEvent("window"),
    home.getByRole("button", { name: "orders", exact: true }).click(),
  ]);
  await data.getByText("1001", { exact: true }).first().waitFor();
  assert.equal(
    await data.locator(".ai-filter-button, .ai-chat-open").count(),
    0,
  );
  mkdirSync("out/screenshots", { recursive: true });
  await home.screenshot({ path: "out/screenshots/desktop-home.png" });
  await data.screenshot({ path: "out/screenshots/desktop-data.png" });
  const [schema] = await Promise.all([
    application.waitForEvent("window"),
    home.getByTitle("Diagram demo-shop.sqlite", { exact: true }).click(),
  ]);
  await schema.getByText("customers", { exact: true }).first().waitFor();
  const [query] = await Promise.all([
    application.waitForEvent("window"),
    home.getByTitle("Try a query", { exact: true }).click(),
  ]);
  const [results] = await Promise.all([
    application.waitForEvent("window"),
    query.getByTitle("Run query", { exact: true }).click(),
  ]);
  await results.getByText("Alex Morgan", { exact: true }).first().waitFor();
  await query
    .getByRole("textbox", { name: "Query" })
    .fill("DELETE FROM orders;");
  await query.getByTitle("Run query", { exact: true }).click();
  await results.getByText(/Only read-only/).waitFor();
  const [form] = await Promise.all([
    application.waitForEvent("window"),
    home.getByTitle("Add connection", { exact: true }).first().click(),
  ]);
  await form.getByText("PostgreSQL", { exact: true }).first().waitFor();
  await form.screenshot({ path: "out/screenshots/desktop-connection.png" });
  const isolated = await home.evaluate(() => ({
    require: typeof window.require,
    process: typeof window.process,
  }));
  assert.deepEqual(isolated, { require: "undefined", process: "undefined" });
  const titles = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((window) => window.getTitle()),
  );
  assert.ok(titles.every((title) => title.includes("DBDeck Demo")));
  assert.deepEqual(errors, []);
  console.log(
    "Desktop smoke passed: tree, shared grid, schema, queries, read-only enforcement, connection form, isolated renderer.",
  );
} catch (error) {
  console.error(
    "Open windows:",
    await Promise.all(
      application.windows().map(async (page) => ({
        title: await page.title(),
        body: (await page.locator("body").innerText()).slice(-2500),
      })),
    ),
  );
  throw error;
} finally {
  await application.close();
  rmSync(directory, { recursive: true, force: true });
}
