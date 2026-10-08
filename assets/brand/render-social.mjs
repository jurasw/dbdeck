import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const brand = dirname(fileURLToPath(import.meta.url));
const root = resolve(brand, "../..");
const require = createRequire(join(root, "apps/desktop/package.json"));
const { chromium } = require("playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const job of [
    { file: "og/og.html", output: "og/og.png", width: 1200, height: 630, scale: 2 },
    { file: "buy-me-a-coffee/cover.html", output: "buy-me-a-coffee/cover.png", width: 1600, height: 400, scale: 1 },
  ]) {
    const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: job.scale });
    await page.goto(pathToFileURL(join(brand, job.file)).href, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const broken = await page.locator("img").evaluateAll(images =>
      images.filter(image => !image.complete || image.naturalWidth === 0).map(image => image.src));
    if (broken.length) throw new Error("Missing social graphic assets: " + broken.join(", "));
    await page.screenshot({ path: join(brand, job.output) });
    await page.close();
  }
  execFileSync("magick", [join(brand, "og/og.png"), "-resize", "1200x630", "-strip",
    "-define", "png:compression-level=9", join(root, "apps/web/public/og.png")]);
  console.log("Rendered OG image and support cover with the current DBDeck icon.");
} finally {
  await browser.close();
}
