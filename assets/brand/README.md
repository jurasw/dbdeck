# DBDeck brand

The default identity is Data Core: three frosted white glass slabs on a black tile. Light and dark system appearances retain the black base. The earlier blue concepts are retained under `apple-icon-concepts/` as references.

## Source

`icon-art.mjs` is the source of the full-color icon and the flat mark. It draws the tile, the three slabs, their glass shading, bevels, contact shadows and the soft aura as plain SVG from one set of geometry constants, so the icon, `logo-monochrome.svg` and the extension activity icon always share the same shapes. `icon.svg` is its vector output and is safe to use directly in a browser.

`dbdeck.icon` is an earlier Apple Icon Composer (Liquid Glass) draft of the same motif; `icon-dark-1024.png` and `icon-tinted-1024.png` are its exports. They are not shipped and the export script does not read them.

## Export and sync

Install ImageMagick and Google Chrome on macOS, run `npm ci` in `apps/desktop` for Playwright, use Node 22, then run from the repository root:

```bash
node assets/brand/export-icons.mjs
```

The script writes `icon.svg`, renders it with Chrome into PNG sizes, the favicon and the Apple touch icon, renders a macOS dock image with the classic safe area and shadow, builds the ICNS, writes the flat mark, and copies app-owned assets into the extension, web, desktop and video packages. To change the branding, edit `icon-art.mjs` and rerun the script.

| File | Use |
| --- | --- |
| `icon.svg` | Vector icon; video package |
| `icon-128.png`, `icon-256.png`, `icon-512.png`, `icon-1024.png` | Website, README, extension and store logo |
| `icon-macos-1024.png` | macOS dock image with safe area and shadow; desktop build |
| `icon.icns` | Electron app and DMG icon, compatible with macOS 12+ |
| `logo-monochrome.svg` | Flat filled mark without the background |
| `og/og.html`, `buy-me-a-coffee/cover.html` | Social graphics; rerender after exporting icons |

Rerender both social graphics with `node assets/brand/render-social.mjs`. It uses the desktop package's Playwright dependency and installed Chrome, verifies that the source images loaded, then writes the OG and support cover exports.

Publication and website deployment remain separate operations.
