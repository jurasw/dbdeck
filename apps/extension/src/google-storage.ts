import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GoogleCredentials } from './google-credentials';

export const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

export interface GoogleIdentity {
  email?: string;
  project?: string;
}

const GCLOUD = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

function onPath(dirs: string[]): string | undefined {
  for (const dir of dirs) {
    const file = path.join(dir, GCLOUD);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

function fromLoginShell(): Promise<string | undefined> {
  if (process.platform === 'win32') return Promise.resolve(undefined);
  return new Promise((resolve) =>
    execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'command -v gcloud'], { timeout: 10000 }, (err, stdout) => {
      const last = stdout?.trim().split('\n').pop()?.trim();
      resolve(!err && last && path.isAbsolute(last) ? last : undefined);
    }),
  );
}

export async function findGcloud(): Promise<string> {
  const home = os.homedir();
  const found =
    onPath((process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) ??
    onPath([
      path.join(home, 'google-cloud-sdk', 'bin'),
      path.join(home, 'Downloads', 'google-cloud-sdk', 'bin'),
      '/opt/homebrew/share/google-cloud-sdk/bin',
      '/usr/local/share/google-cloud-sdk/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/lib/google-cloud-sdk/bin',
      '/snap/bin',
    ]) ??
    (await fromLoginShell());
  if (!found) throw new Error('Google Cloud CLI (gcloud) is not installed. Install it from cloud.google.com/sdk, then sign in again.');
  return found;
}

export async function gcloudLogin(signal: AbortSignal, gcloud?: string): Promise<void> {
  const bin = gcloud ?? (await findGcloud());
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, ['auth', 'application-default', 'login', '--quiet'], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d));
    child.stderr.on('data', (d: Buffer) => (output += d));
    const abort = () => child.kill();
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) return reject(new Error('Google sign-in cancelled.'));
      if (code === 0) return resolve();
      const line = output.trim().split('\n').filter(Boolean).pop();
      reject(new Error(`Google sign-in failed${line ? `: ${line}` : '.'}`));
    });
  });
}

export async function googleIdentity(credentials: GoogleCredentials): Promise<GoogleIdentity> {
  const token = await credentials.token();
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15000) });
  const info = (r.ok ? await r.json() : {}) as { email?: string };
  return { email: info.email, project: credentials.projectId() };
}

async function getJson<T>(url: string, token: string, what: string): Promise<T> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(`Cannot list ${what}: ${body.error?.message ?? `HTTP ${r.status}`}`);
  }
  return (await r.json()) as T;
}

export async function listProjects(token: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let page = '';
  do {
    const q = new URLSearchParams({ filter: 'lifecycleState:ACTIVE', pageSize: '500', ...(page ? { pageToken: page } : {}) });
    const body = await getJson<{ projects?: { projectId: string; name?: string }[]; nextPageToken?: string }>(
      `https://cloudresourcemanager.googleapis.com/v1/projects?${q}`,
      token,
      'Google Cloud projects',
    );
    for (const p of body.projects ?? []) out.push({ id: p.projectId, name: p.name ?? p.projectId });
    page = body.nextPageToken ?? '';
  } while (page && out.length < 5000);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function listBuckets(token: string, project: string, base = 'https://storage.googleapis.com'): Promise<string[]> {
  const names: string[] = [];
  let page = '';
  do {
    const q = new URLSearchParams({ project, maxResults: '1000', fields: 'items(name),nextPageToken', ...(page ? { pageToken: page } : {}) });
    const body = await getJson<{ items?: { name: string }[]; nextPageToken?: string }>(`${base}/storage/v1/b?${q}`, token, `buckets in ${project}`);
    names.push(...(body.items ?? []).map((b) => b.name));
    page = body.nextPageToken ?? '';
  } while (page);
  return names.sort();
}
