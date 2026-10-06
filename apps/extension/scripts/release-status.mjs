import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const id = `${pkg.publisher}.${pkg.name}`;
const version = pkg.version;
const tag = `extension-v${version}`;
const json = process.argv.includes('--json');

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).trim();
  } catch {
    return undefined;
  }
}

async function marketplace() {
  const response = await fetch('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json;api-version=3.0-preview.1' },
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: id }] }], flags: 0x1 | 0x10 | 0x200 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const extension = (await response.json()).results?.[0]?.extensions?.[0];
  const latest = extension?.versions?.[0];
  return latest ? { version: latest.version, date: latest.lastUpdated, note: latest.flags } : { version: undefined };
}

async function openVsx() {
  const response = await fetch(`https://open-vsx.org/api/${pkg.publisher}/${pkg.name}`, { signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return { version: undefined };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return { version: body.version, date: body.timestamp };
}

async function githubRelease() {
  const raw = run('gh', ['release', 'list', '-R', 'jurasw/dbdeck', '--json', 'tagName,publishedAt', '-L', '20']);
  if (raw === undefined) throw new Error('gh CLI unavailable or not signed in');
  const release = JSON.parse(raw).find((r) => r.tagName.startsWith('extension-v') || /^v\d/.test(r.tagName));
  return release ? { version: release.tagName.replace(/^(extension-)?v/, ''), date: release.publishedAt } : { version: undefined };
}

function installed(dir) {
  try {
    const list = JSON.parse(readFileSync(join(homedir(), dir, 'extensions', 'extensions.json'), 'utf8'));
    return { version: list.find((e) => e.identifier?.id === id)?.version };
  } catch {
    return { version: undefined };
  }
}

async function check(name, load) {
  try {
    return { name, ...(await load()) };
  } catch (e) {
    return { name, error: e.message };
  }
}

const targets = await Promise.all([
  check('VS Marketplace', marketplace),
  check('Open VSX', openVsx),
  check('GitHub Release', githubRelease),
  check('Installed in Cursor', async () => installed('.cursor')),
  check('Installed in VS Code', async () => installed('.vscode')),
]);

const git = (...args) => run('git', ['-C', new URL('..', import.meta.url).pathname, ...args]);
const lines = (out) => (out ?? '').split('\n').filter(Boolean);
git('fetch', '--quiet', '--tags', 'origin');
const hasTag = !!git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`);
const commits = hasTag ? lines(git('log', '--oneline', `${tag}..HEAD`, '--', '.')) : [];
const dirty = lines(git('status', '--porcelain', '--', '.'));
const unpushed = lines(git('log', '--oneline', '@{upstream}..HEAD', '--', '.'));
const mainVersion = git('show', 'origin/main:apps/extension/package.json')?.match(/"version":\s*"([^"]+)"/)?.[1];
const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const unreleasedNotes = (changelog.split(/^## Unreleased\s*$/m)[1]?.split(/^## /m)[0] ?? '').split('\n').filter((l) => l.startsWith('- ')).length;
const publish = run('gh', ['run', 'list', '-R', 'jurasw/dbdeck', '--workflow', 'extension-publish.yml', '-L', '1', '--json', 'status,conclusion,createdAt,url']);
const lastPublish = publish ? JSON.parse(publish)[0] : undefined;

const stores = targets.slice(0, 3);
const published = stores.filter((t) => t.version === version).map((t) => t.name);
const unreleased = commits.length > 0 || dirty.length > 0 || unreleasedNotes > 0;
const verdict = !published.length
  ? `${version} is not published yet`
  : unreleased
    ? `${version} is published, but this checkout has unreleased extension changes. Bump the version to release them.`
    : `${version} is published and matches this checkout`;

if (json) {
  console.log(
    JSON.stringify(
      {
        id,
        version,
        targets,
        tag: hasTag ? tag : undefined,
        commitsSinceTag: commits,
        unpushedCommits: unpushed,
        dirtyFiles: dirty,
        unreleasedNotes,
        mainVersion,
        lastPublish,
        verdict,
      },
      null,
      2,
    ),
  );
} else {
  const mark = (t) => (t.error ? `? ${t.error}` : !t.version ? '✗ not found' : t.version === version ? `✓ ${t.version}` : `✗ ${t.version}`);
  console.log(`DBDeck ${id} · local package.json ${version}${mainVersion ? ` · origin/main ${mainVersion}` : ''}\n`);
  for (const t of targets) console.log(`  ${t.name.padEnd(22)} ${mark(t)}${t.date ? `  ${t.date.slice(0, 10)}` : ''}${t.note ? `  (${t.note})` : ''}`);
  console.log('');
  console.log(`  Commits in apps/extension since ${hasTag ? tag : 'release tag (missing)'}: ${commits.length}`);
  console.log(`  Commits not pushed to origin: ${unpushed.length}`);
  console.log(`  Uncommitted files in apps/extension: ${dirty.length}`);
  console.log(`  CHANGELOG "## Unreleased" entries: ${unreleasedNotes}`);
  if (lastPublish)
    console.log(
      `  Last publish workflow: ${lastPublish.status}${lastPublish.conclusion ? ` · ${lastPublish.conclusion}` : ''} · ${lastPublish.createdAt.slice(0, 10)} · ${lastPublish.url}`,
    );
  console.log(`\n${verdict}`);
}
