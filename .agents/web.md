# Website

`apps/web` is a Next.js App Router site exported as static HTML (`output: 'export'`) and served by Cloudflare Pages at dbdeck.dev. UI uses shadcn/ui components in `components/ui` with Tailwind CSS v4 tokens in `app/globals.css`. Keep the page static: no server actions, route handlers or runtime data fetching. Screenshots come from `assets/screenshots` and are copied into `public/screenshots`. Run `npm run lint` and `npm run build`, then check `out/` locally with `npm run preview`. `npm run deploy` publishes to Cloudflare and needs an explicit request.
