import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/shared/dist", { recursive: true });
cpSync("../extension/dist/webview", "dist/shared/dist/webview", {
  recursive: true,
});
cpSync("../extension/media", "dist/shared/media", { recursive: true });
cpSync("../extension/dist/node_modules", "dist/node_modules", {
  recursive: true,
});
cpSync("src/desktop.css", "dist/shared/dist/webview/desktop.css");
cpSync("../../LICENSE", "dist/LICENSE");
cpSync("../../assets/brand/icon.icns", "dist/icon.icns");
cpSync("../../assets/brand/icon-macos-1024.png", "dist/icon.png");
const common = {
  bundle: true,
  sourcemap: true,
  logLevel: "info",
  target: "es2022",
};
await build({
  ...common,
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.cjs",
  platform: "node",
  format: "cjs",
  alias: { vscode: resolve("src/vscode-host.ts") },
  external: [
    "electron",
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
await build({
  ...common,
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.cjs",
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await build({
  ...common,
  entryPoints: ["src/desktop.ts"],
  outfile: "dist/shared/dist/webview/desktop.js",
  platform: "browser",
  format: "iife",
});
