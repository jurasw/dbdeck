# Assets

Source materials for the brand, the store listings and the website. Nothing here is shipped directly: each app keeps its own copy of what it needs.

| Path | What | Copied to |
| --- | --- | --- |
| `brand/icon.svg` | Icon source | — |
| `brand/icon-128.png`, `icon-256.png`, `icon-512.png` | Icon exports | `apps/extension/media/icon.png` (256), `apps/web/public/icon.png` (256), `apps/web/app/icon.png` (512) |
| `screenshots/*.png` | Real VS Code screenshots on disposable test data | `apps/web/public/screenshots/`, extension README (raw GitHub URLs) |
| `marketplace/listing.md` | Texts and fields for Visual Studio Marketplace and Open VSX | Paste into the publisher forms |
| `marketplace/publishing.md` | Step-by-step publishing guide | — |

Regenerate the PNG icons after editing the SVG:

```bash
for s in 128 256 512; do rsvg-convert -w $s -h $s assets/brand/icon.svg -o assets/brand/icon-$s.png; done
cp assets/brand/icon-256.png apps/extension/media/icon.png
cp assets/brand/icon-256.png apps/web/public/icon.png
cp assets/brand/icon-512.png apps/web/app/icon.png
```

Screenshots were captured at 1440×900 (2× scale, resized to 1920 px wide) in VS Code with the Default Dark Modern theme, against the services in `apps/extension/test/docker-compose.yml` seeded with a fictional shop database.
