import { readFileSync, writeFileSync } from "node:fs";

// The desktop demo follows the extension version without releasing the extension.
const extension = JSON.parse(readFileSync("../extension/package.json", "utf8"));
const desktop = JSON.parse(readFileSync("package.json", "utf8"));
const revision = desktop.version.match(/-demo\.(\d+)$/)?.[1] ?? "1";
const version = `${extension.version}-demo.${revision}`;
if (desktop.version !== version) {
  desktop.version = version;
  writeFileSync("package.json", `${JSON.stringify(desktop, null, 2)}\n`);
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  lock.version = version;
  lock.packages[""].version = version;
  writeFileSync("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);
}
