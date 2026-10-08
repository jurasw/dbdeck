# Assets

Source materials for the brand, the store listings and the website. Nothing here is shipped directly: each app keeps its own copy of what it needs.

| Path | What | Copied to |
| --- | --- | --- |
| `brand/icon-art.mjs` | Icon source: white glass Data Core on black, drawn as SVG | Not shipped directly |
| `brand/icon.svg` | Vector icon generated from `icon-art.mjs` | `apps/video/public/icon.svg` |
| `brand/icon-128.png`, `icon-256.png`, `icon-512.png` | Icon exports | `apps/extension/media/icon.png` (256), `apps/web/public/icon.png` (256), `apps/web/app/icon.png` (512) |
| `brand/export-icons.mjs` | Reproducible icon export and app asset synchronization | Web favicon and Apple touch icon included |
| `brand/og/og.html`, `og.png` | Social preview source and its 2400×1260 render | `apps/web/public/og.png` (1200×630, under 300 KB) |
| `brand/buy-me-a-coffee/cover.html`, `cover.png`, `profile.md` | Buy Me a Coffee cover (3200×800, 1600×400 at 2×) and DBDeck profile text | Buy Me a Coffee profile |
| `screenshots/*.png` | Real VS Code screenshots on disposable test data | `apps/web/public/screenshots/`, extension README (raw GitHub URLs) |
| `readme/*.gif` | Root README recordings of the real webview bundles (`apps/extension/dist/webview`) with mocked RPC and demo data, framed like dbdeck.dev | Root `README.md` |
| `readme/services-dark.svg`, `services-light.svg` | Animated connection type card, fonts and icons inlined from `apps/web` | Root `README.md` |
| `marketplace/listing.md` | Texts and fields for Visual Studio Marketplace and Open VSX | Paste into the publisher forms |
| `marketplace/publishing.md` | Step-by-step publishing guide | Not applicable |

Regenerate and synchronize the icons after editing `brand/icon-art.mjs`:

```bash
node assets/brand/export-icons.mjs
```

See `brand/README.md` for requirements and outputs.

Re-render the social preview after editing `og.html`:

```bash
node assets/brand/render-social.mjs
```

Screenshots were captured at 1440×900 (2× scale, resized to 1920 px wide) in VS Code with the Default Dark Modern theme, against the services in `apps/extension/test/docker-compose.yml` seeded with a fictional shop database.
