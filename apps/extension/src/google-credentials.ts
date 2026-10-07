import { createSign } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expandHome } from './util';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface CredentialsFile {
  type?: string;
  project_id?: string;
  quota_project_id?: string;
  client_email?: string;
  private_key?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
}

export function defaultCredentialsPath(): string {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const base = process.platform === 'win32' ? path.join(process.env.APPDATA ?? os.homedir(), 'gcloud') : path.join(os.homedir(), '.config', 'gcloud');
  return path.join(base, 'application_default_credentials.json');
}

export class GoogleCredentials {
  private file?: CredentialsFile;
  private cached?: { token: string; expiresAt: number };
  private pending?: Promise<string>;

  constructor(
    private readonly keyFile: string | undefined,
    private readonly scope: string,
    private readonly tokenUrl = TOKEN_URL,
  ) {}

  private read(): CredentialsFile {
    if (this.file) return this.file;
    const p = this.keyFile?.trim() ? expandHome(this.keyFile.trim()) : defaultCredentialsPath();
    let raw: string;
    try {
      raw = fs.readFileSync(p, 'utf8');
    } catch {
      throw new Error(
        this.keyFile?.trim()
          ? `Cannot read the credentials file ${p}.`
          : 'No Google credentials found. Run `gcloud auth application-default login` or choose a service account key file.',
      );
    }
    try {
      this.file = JSON.parse(raw) as CredentialsFile;
    } catch {
      throw new Error(`${p} is not a Google credentials JSON file.`);
    }
    return this.file;
  }

  projectId(): string | undefined {
    const f = this.read();
    return f.project_id ?? f.quota_project_id;
  }

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt > Date.now() + 60000) return this.cached.token;
    this.pending ??= this.fetchToken().finally(() => (this.pending = undefined));
    return this.pending;
  }

  private async fetchToken(): Promise<string> {
    const f = this.read();
    let params: Record<string, string>;
    let url = this.tokenUrl;
    if (f.type === 'service_account') {
      if (!f.client_email || !f.private_key) throw new Error('The service account key file has no client_email or private_key.');
      url = f.token_uri ?? url;
      params = { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountJwt(f.client_email, f.private_key, this.scope, url) };
    } else if (f.type === 'authorized_user') {
      if (!f.client_id || !f.client_secret || !f.refresh_token) throw new Error('The Google credentials file has no refresh token.');
      params = { grant_type: 'refresh_token', client_id: f.client_id, client_secret: f.client_secret, refresh_token: f.refresh_token };
    } else {
      throw new Error(`Google credentials of type "${f.type ?? 'unknown'}" are not supported. Use a service account key or gcloud application-default login.`);
    }
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(20000),
    });
    const body = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!r.ok || !body.access_token) {
      if (body.error === 'invalid_grant' && f.type === 'authorized_user') throw new Error('Google credentials expired. Run `gcloud auth application-default login` again.');
      throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? `HTTP ${r.status}`}`);
    }
    this.cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}

function serviceAccountJwt(email: string, key: string, scope: string, aud: string): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: email, scope, aud, iat: now, exp: now + 3600 })}`;
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(key, 'base64url')}`;
}
