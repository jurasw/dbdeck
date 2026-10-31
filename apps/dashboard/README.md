# DBDeck Dashboard

The browser app at `dashboard.dbdeck.dev` uses the actual DBDeck extension code. It shares drivers, connection forms, grids, schema diagrams, query execution, AI panels and commands with the add-on. A small browser platform adapter runs the extension inside a disposable Node.js worker **on the client's computer**. The hosted site serves static files and has no project or credential backend.

## Run locally

Use Node.js 22.22.3 or newer. Install the independent packages from their own folders:

```bash
cd apps/extension
npm ci
cd ../dashboard
npm ci
npm run dev
```

In another terminal:

```bash
cd apps/dashboard
npm run connector -- --dashboard http://localhost:8080
```

Open the paired link printed by the connector. The link carries a random capability in its URL fragment, which is removed before the app loads project data. It is never sent to website hosting as a URL query. Pairing connects the app to your local engine; it is not a login password. Browsers may request local-network permission. Keep the connector running while using database features.

The browser workspace opens without a password by default. Accept the Terms of Use on first use, add a connection and enter a database address. File paths, SSH keys, localhost, cloud credential files and Docker commands refer to this computer. The connector needs the same provider tools and permissions as the desktop extension, including a reachable Docker daemon or Google Cloud CLI when those features require it. Most file dialogs ask for an absolute local path. **Web settings → Connections** exports connections as a browser download and imports a JSON file chosen in the browser, using the same format as the add-on.

`npm run build` rebuilds the extension, bundles the browser adapter and creates `dist/site` with static assets. `npm run preview` serves that build on port 8080. `npm run connector` defaults to pairing with `https://dashboard.dbdeck.dev`; pass `--dashboard <origin>` for local development. There is no code-server deployment or hosted extension process.

## Static hosting

`wrangler.jsonc` serves only `dist/site` on the custom domain `dashboard.dbdeck.dev`, using the same Cloudflare account as the landing page. It has no Worker application code, storage bindings, database or credential API. The local connector bundle stays outside the hosted directory. Security headers are defined in `public/_headers`.

After an explicit deployment request, run `npm run deploy` or manually start `dashboard-prod-deploy.yml` with the existing Cloudflare deployment token. This workflow validates both products before uploading static files. Shared code edits trigger dashboard checks, without automatically deploying. Publish the landing page's Terms and Privacy pages at the same time, after confirming operator details. [Cloudflare static assets documentation](https://developers.cloudflare.com/workers/static-assets/) describes the hosting setup.

## Web settings

- **Projects:** separate connections, credentials and query documents in this browser. Create, rename, export, import or delete projects locally. An unprotected project stores its data without DBDeck encryption. Concealment preferences apply to this browser.
- **Hide after inactivity:** optional timer or tab-background concealment. Locking removes data panels and results, closes local connections and disposes the worker. Unsaved grid edits are discarded; query documents are kept locally. An unprotected project reopens with **Show workspace**.
- **Phrase:** optional AES-256-GCM project encryption. PBKDF2-SHA-256 with a unique salt and 600,000 iterations wraps a random project key. Every encrypted write has a fresh IV. DBDeck never stores the phrase. The password field supports browser password managers.
- **Passkey:** optional WebAuthn PRF key wrapping after required user verification. The OS may use Touch ID, Windows Hello, a security key or a PIN. If the browser/authenticator cannot provide PRF output, setup fails without enabling a weaker substitute. A phrase can be added as a recovery method. Passkeys are scoped to the browser origin, so a localhost credential will not unlock a project on `dashboard.dbdeck.dev`.

Export protected projects to keep an encrypted backup. Save a recovery phrase before losing a passkey or changing origins. No hosted copy or recovery key exists. Credential managers may synchronize passkeys or saved phrases according to your own device settings; DBDeck does not control that synchronization.

These settings are intentionally web-only. Shared behavior lives in `apps/extension`; the dashboard imports its shadcn components and compiles the original webviews. Apply [the shared-app skill](../../.agents/skills/dbdeck-shared-app/SKILL.md) after changing either product.

## Privacy boundary

The connector binds only to `127.0.0.1`, checks the Host header, allows one exact paired web origin and requires a random bearer token. Every unlocked project gets an isolated worker. Context state and secrets are memory-backed; updates are returned to the browser's IndexedDB vault. Project lock, reset or a disconnected-client timeout terminates the worker and removes its temporary directory. Browser exit also attempts a reset, with the timeout as a fallback. Terminal processes and explicit file exports run on the client's computer. Provider tools can maintain their own local credential files.

The hosted dashboard has no analytics and does not receive project data. Static hosting/CDN providers still receive HTTP metadata when serving application assets. The landing site has separate website analytics. AI, database and cloud providers receive the requests you explicitly configure, just as in the add-on. Optional encryption protects stored project data; an unlocked browser or compromised device can still access decrypted data.

Terms and privacy notices are maintained in `apps/web/app/terms` and `apps/web/app/privacy`. The liability limitation preserves mandatory rights and liability that cannot legally be excluded. Before public deployment, confirm the actual operator identity and public contact details in those notices.

## Checks

```bash
npm run check
npm run lint
npm test
npm run build
npm run smoke
```

The smoke test serves the built static app, starts a disposable loopback connector, uses the real extension's SQLite driver/form/grid, exercises failed and successful saves, executes SQL, checks encrypted browser storage, locks and restores a project, and uses Chrome's actual virtual WebAuthn PRF authenticator. Set `BROWSER_EXECUTABLE` when Chrome/Chromium is not detected. No external database or Docker is needed for this test. Run the extension's validation separately after shared code changes.

Protocol references: [W3C WebAuthn PRF](https://www.w3.org/TR/webauthn-3/#prf-extension), [Web Crypto key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey), [Chrome WebAuthn test authenticator](https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/). Legal context: [UOKiK on prohibited liability exclusions](https://www.uokik.gov.pl/public/energia-czysta-ale-umowy-juz-niekoniecznie-prezes-uokik-reaguje-na-niedozwolone-klauzule).
