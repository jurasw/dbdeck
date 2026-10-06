import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from 'node:crypto';
import { createServer } from 'node:http';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
export interface ChatGptAccount {
  clientId: string;
  subject: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
  scopes: string[];
}
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export async function authMetadata(): Promise<{ jwks_uri: string; revocation_endpoint: string }> {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error('Cannot load OpenAI sign-in configuration.');
  const meta = (await response.json()) as { issuer: string; jwks_uri: string; revocation_endpoint: string };
  if (meta.issuer !== issuer || [meta.jwks_uri, meta.revocation_endpoint].some((url) => new URL(url).origin !== issuer)) throw new Error('Invalid OpenAI sign-in configuration.');
  return meta;
}

export function validateIdToken(token: string, clientId: string, nonce: string, keys: (JsonWebKey & { kid?: string })[]): { sub: string; email?: string } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid OpenAI identity token.');
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    if (!header || !claims) throw new Error();
  } catch {
    throw new Error('Invalid OpenAI identity token.');
  }
  const key = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (header.alg !== 'RS256' || !key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url')))
    throw new Error('OpenAI identity signature verification failed.');
  const now = Date.now() / 1000;
  if (
    claims.iss !== issuer ||
    !(Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId) ||
    claims.nonce !== nonce ||
    typeof claims.exp !== 'number' ||
    claims.exp <= now ||
    (claims.nbf !== undefined && claims.nbf > now) ||
    typeof claims.sub !== 'string' ||
    !claims.sub
  )
    throw new Error('OpenAI identity validation failed.');
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId) throw new Error('OpenAI identity audience validation failed.');
  return { sub: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined };
}

async function exchange(params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${issuer}/api/accounts/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, resource }),
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`OpenAI sign-in failed (HTTP ${response.status}). Sign in again.`);
  const token = (await response.json()) as TokenResponse;
  if (
    !token.access_token ||
    token.token_type?.toLowerCase() !== 'bearer' ||
    !Number.isFinite(token.expires_in) ||
    token.expires_in <= 0 ||
    !token.scope?.split(' ').includes('chatgpt.tokens.use.direct')
  )
    throw new Error('ChatGPT plan usage was not granted. Enable it when signing in.');
  return token;
}

export async function signInChatGpt(hostId: string, openBrowser: (url: string) => Promise<boolean>, signal: AbortSignal, account?: ChatGptAccount): Promise<ChatGptAccount> {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Cannot start local sign-in listener.');
  }
  const redirectUri = `http://127.0.0.1:${address.port}/auth/callback`;
  let finish: (value: { code: string; clientId: string }) => void;
  let fail: (error: Error) => void;
  const callback = new Promise<{ code: string; clientId: string }>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Attach a rejection handler while the browser is being opened.
  void callback.catch(() => undefined);
  let received = false;
  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', redirectUri);
    const send = (status: number, message: string) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(message);
    };
    if (url.pathname !== '/auth/callback' || req.method !== 'GET') return send(404, 'Not found');
    if (received || url.searchParams.get('state') !== state) return send(400, 'Invalid sign-in state.');
    received = true;
    if (url.searchParams.has('error')) {
      send(400, 'Sign-in was not authorized. Return to DBDeck.');
      fail(new Error('OpenAI sign-in was not authorized.'));
      return;
    }
    const clientId = url.searchParams.get('client_id') ?? account?.clientId;
    const code = url.searchParams.get('code');
    if (!code || !clientId || clientId === 'dynamic_agent_client' || (account && clientId !== account.clientId)) {
      send(400, 'Invalid sign-in registration.');
      fail(new Error('Invalid OpenAI registration.'));
      return;
    }
    send(200, 'Authorization received. Return to DBDeck to finish sign-in.');
    finish({ code, clientId });
  });
  const abort = () => fail(new Error('OpenAI sign-in cancelled.'));
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => fail(new Error('OpenAI sign-in timed out. Try again.')), 180000);
  try {
    if (signal.aborted) throw new Error('OpenAI sign-in cancelled.');
    const url = new URL(`${issuer}/api/accounts/authorize`);
    url.search = new URLSearchParams({
      client_id: account?.clientId ?? 'dynamic_agent_client',
      ...(account ? {} : { agent_name_hint: 'DBDeck' }),
      ext_agent_host_id: hostId,
      ...(account?.idToken ? { id_token_hint: account.idToken } : {}),
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
      resource,
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }).toString();
    if (!(await openBrowser(url.toString()))) throw new Error('Could not open the browser for OpenAI sign-in.');
    const { code, clientId } = await callback;
    const token = await exchange({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri });
    if (!token.id_token || !token.refresh_token) throw new Error('OpenAI did not return the required sign-in credentials.');
    const meta = await authMetadata();
    const response = await fetch(meta.jwks_uri, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok) throw new Error('Cannot verify OpenAI identity.');
    const keys = (await response.json()) as { keys: (JsonWebKey & { kid?: string })[] };
    const identity = validateIdToken(token.id_token, clientId, nonce, keys.keys);
    if (account && account.subject !== identity.sub) throw new Error('Signed-in account does not match the selected account.');
    return {
      clientId,
      subject: identity.sub,
      email: identity.email,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      idToken: token.id_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      scopes: token.scope.split(' '),
    };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    server.close();
    server.closeAllConnections();
  }
}

export async function refreshChatGpt(account: ChatGptAccount): Promise<ChatGptAccount> {
  if (!account.refreshToken) throw new Error('Sign in with ChatGPT first.');
  const token = await exchange({ grant_type: 'refresh_token', client_id: account.clientId, refresh_token: account.refreshToken });
  if (!token.refresh_token) throw new Error('OpenAI did not return a replacement refresh token. Sign in again.');
  return { ...account, accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, scopes: token.scope.split(' ') };
}

export async function revokeChatGpt(account: ChatGptAccount): Promise<void> {
  if (!account.refreshToken) return;
  const meta = await authMetadata();
  const response = await fetch(meta.revocation_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: account.refreshToken, token_type_hint: 'refresh_token', client_id: account.clientId }),
    signal: AbortSignal.timeout(15000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('Remote sign-out could not be confirmed. Disconnect DBDeck in ChatGPT Settings.');
}
