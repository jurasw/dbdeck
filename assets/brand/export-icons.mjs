import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { iconSvg, markBounds, markSvg } from "./icon-art.mjs";

const brand = dirname(fileURLToPath(import.meta.url));
const root = resolve(brand, "../..");
const { chromium } = createRequire(join(root, "apps/desktop/package.json"))("playwright");
const run = (command, args) => execFileSync(command, args, { stdio: ["ignore", "pipe", "inherit"] });
const work = mkdtempSync(join(tmpdir(), "dbdeck-brand-"));
const copy = (from, to) => {
  const target = join(root, to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(from, target);
};
const svg = iconSvg();
writeFileSync(join(brand, "icon.svg"), svg);
const pad = 40;
const side = Math.max(markBounds.width, markBounds.height) + pad * 2;
const viewBox = [markBounds.x + markBounds.width / 2 - side / 2, markBounds.y + markBounds.height / 2 - side / 2, side, side].join(" ");
writeFileSync(join(brand, "logo-monochrome.svg"), markSvg());
writeFileSync(join(root, "apps/extension/media/activity.svg"), markSvg(viewBox));

const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const render = async (output, size, { tile = size, shadow = "none" } = {}) => {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0;display:grid;place-items:center;width:${size}px;height:${size}px;background:transparent"><img src="${source}" style="width:${tile}px;height:${tile}px;filter:${shadow}"></body>`);
  await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  await page.screenshot({ path: output, omitBackground: true });
  await page.close();
  run("magick", [output, "-strip", "-define", "png:compression-level=9", output]);
};
try {
  for (const size of [128, 256, 512, 1024]) await render(join(brand, `icon-${size}.png`), size);
  copy(join(brand, "icon-256.png"), "apps/extension/media/icon.png");
  copy(join(brand, "icon-256.png"), "apps/web/public/icon.png");
  copy(join(brand, "icon-512.png"), "apps/web/app/icon.png");
  copy(join(brand, "icon-512.png"), "apps/video/public/icon.png");
  copy(join(brand, "icon.svg"), "apps/video/public/icon.svg");
  copy(join(brand, "icon-256.png"), "apps/desktop/assets/icon.png");
  const touch = join(work, "apple-icon.png");
  await render(touch, 180);
  copy(touch, "apps/web/app/apple-icon.png");

  const frames = [];
  for (const size of [16, 32, 48]) {
    const file = join(work, `favicon-${size}.png`);
    await render(file, size);
    frames.push({ size, data: readFileSync(file) });
  }
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, data }, index) => {
    const start = 6 + index * 16;
    header[start] = size;
    header[start + 1] = size;
    header.writeUInt16LE(1, start + 4);
    header.writeUInt16LE(32, start + 6);
    header.writeUInt32LE(data.length, start + 8);
    header.writeUInt32LE(offset, start + 12);
    offset += data.length;
  });
  writeFileSync(join(root, "apps/web/app/favicon.ico"), Buffer.concat([header, ...frames.map(f => f.data)]));

  const dock = join(brand, "icon-macos-1024.png");
  await render(dock, 1024, { tile: 824, shadow: "drop-shadow(0 10px 14px rgba(0,0,0,.32))" });
  const iconset = join(work, "dbdeck.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const target = join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`);
      run("sips", ["-z", String(size * scale), String(size * scale), dock, "--out", target]);
    }
  }
  run("iconutil", ["-c", "icns", iconset, "-o", join(brand, "icon.icns")]);
  copy(join(brand, "icon.icns"), "apps/desktop/assets/dbdeck.icns");
  console.log("Exported icon.svg, PNG sizes, favicon, Apple touch icon, monochrome mark and macOS ICNS.");
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
