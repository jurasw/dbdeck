import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const extension = fileURLToPath(new URL("../../extension/", import.meta.url));
execFileSync("npm", ["run", "build"], { cwd: extension, stdio: "inherit" });
mkdirSync(`${root}/public/extension`, { recursive: true });
cpSync(`${extension}/dist/webview`, `${root}/public/extension/dist/webview`, {
  recursive: true,
});
cpSync(`${extension}/media`, `${root}/public/extension/media`, {
  recursive: true,
});
const manifest = JSON.parse(readFileSync(`${extension}/package.json`, "utf8"));
writeFileSync(
  `${root}/public/extension/manifest.json`,
  JSON.stringify({ version: manifest.version, ...manifest.contributes }),
);
await build({
  entryPoints: [`${root}/connector/host-worker.ts`],
  outfile: `${root}/dist/host-worker.cjs`,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  alias: { vscode: `${root}/connector/vscode-adapter.ts` },
  external: [
    "node-pty",
    "oracledb",
    "cpu-features",
    "pg-native",
    "kerberos",
    "@mongodb-js/zstd",
    "@aws-sdk/credential-providers",
    "gcp-metadata",
    "snappy",
    "socks",
    "aws4",
    "mongodb-client-encryption",
  ],
  loader: { ".node": "empty" },
});
mkdirSync(`${root}/dist/node_modules`, { recursive: true });
cpSync(
  `${extension}/dist/node_modules/oracledb`,
  `${root}/dist/node_modules/oracledb`,
  { recursive: true },
);
if (!process.argv.includes("--prepare")) await viteBuild({ root });
