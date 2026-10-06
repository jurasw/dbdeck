# Publishing

Status: GitHub Release `v0.1.0` is live. Visual Studio Marketplace and Open VSX are not published yet. dbdeck.dev runs on Cloudflare Workers.

Listing texts and form fields: [listing.md](listing.md).

## 1. Build the VSIX

```bash
cd apps/extension
npm ci
npm run validate
npm run package:check
npm run package          # dbdeck-<version>.vsix
```

Install it in VS Code and Cursor (`code --install-extension dbdeck-<version>.vsix --force`) and smoke-test connections, SSH, read-only mode, staged edits and exports against `test/docker-compose.yml`. The automated specs do not launch an editor or databases.

## 2. Visual Studio Marketplace (browser upload, no token)

1. Sign in at https://marketplace.visualstudio.com/manage with a Microsoft account.
2. **Create publisher** with the values in [listing.md](listing.md). The ID must be `dbdeck`; if it is taken, change `publisher` in `apps/extension/package.json` and rebuild.
3. **+ New extension → Visual Studio Code**, drag the VSIX, **Upload**.
4. Wait for the scan (a few minutes). The listing appears at https://marketplace.visualstudio.com/items?itemName=dbdeck.dbdeck.

Updates: bump `version`, rebuild, then on the extension row choose **… → Update** and upload the new VSIX.

Command-line publishing (`npx @vscode/vsce publish`) needs an Azure DevOps Personal Access Token with **Marketplace: Manage** on **All accessible organizations**. Microsoft retires these global tokens on 1 December 2026; after that use `az login` and `npx @vscode/vsce publish --azure-credential`.

## 3. Open VSX (Cursor, VSCodium, Windsurf)

1. Create an Eclipse account at https://accounts.eclipse.org/user/register and enter your GitHub username.
2. Sign in at https://open-vsx.org with GitHub, link the Eclipse account in https://open-vsx.org/user-settings/profile and accept the Publisher Agreement.
3. Create a token at https://open-vsx.org/user-settings/tokens.
4. Publish:

```bash
npx ovsx create-namespace dbdeck -p <token>
npx ovsx publish apps/extension/dbdeck-<version>.vsix -p <token>
```

The listing appears at https://open-vsx.org/extension/dbdeck/dbdeck.

## 4. Automatic releases

`.github/workflows/extension-publish.yml` runs on every push to `main` that changes `apps/extension/package.json`, and by hand from the Actions tab. To release, bump the version and its CHANGELOG section, then push:

```bash
cd apps/extension && npm version minor --no-git-tag-version
```

The workflow checks each target and only publishes what is missing for that version:

- VS Code Marketplace, when the `VSCE_PAT` repository secret exists.
- Open VSX, when the `OVSX_PAT` repository secret exists.
- GitHub release `extension-v<version>` with the VSIX and the CHANGELOG section.

A store without its token is skipped with a warning. After adding the token, run the workflow by hand to publish the current version there. Store the tokens as repository secrets, never in the repository:

```bash
gh secret set VSCE_PAT
gh secret set OVSX_PAT
```

## 5. Website

```bash
cd apps/web
npm run deploy           # next build + wrangler deploy → dbdeck.dev, www.dbdeck.dev
```

`wrangler.jsonc` holds the Worker name, account and custom domains. Run `npx wrangler login` first if the token has expired.

CI deploys on every push to `main` that touches `apps/web` (`.github/workflows/web-prod-deploy.yml`, also runnable by hand from the Actions tab). It needs one repository secret, `CLOUDFLARE_API_TOKEN`: create it at https://dash.cloudflare.com/profile/api-tokens from the **Edit Cloudflare Workers** template, limited to this account and the `dbdeck.dev` zone, then:

```bash
gh secret set CLOUDFLARE_API_TOKEN
```

Never commit publishing tokens.
