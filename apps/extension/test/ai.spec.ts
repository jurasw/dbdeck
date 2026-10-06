import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { cleanQuery, generateQuery, readResponseStream, validateEndpoint } from '../src/ai-client';
import { signInChatGpt, validateIdToken } from '../src/openai-auth';

const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
function stream(text: string, fragment = 7): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(offset, (offset += fragment)));
      },
    }),
  );
}
test('Responses SSE handles fragmented UTF-8 and requires completed inference', async () => {
  const delta = frame({ type: 'response.output_text.delta', delta: 'SELECT "zażółć";' });
  assert.equal(await readResponseStream(stream(delta + frame({ type: 'response.completed', response: { status: 'completed' } }))), 'SELECT "zażółć";');
  await assert.rejects(readResponseStream(stream(delta)), /before completion/);
  await assert.rejects(
    readResponseStream(stream(delta + frame({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }))),
    /usage_limit_exceeded/,
  );
  await assert.rejects(readResponseStream(stream(frame({ type: 'response.incomplete' }))), /incomplete/);
});
test('provider endpoints protect credentials and allow local Ollama', () => {
  assert.equal(validateEndpoint('http://127.0.0.1:11434/v1/'), 'http://127.0.0.1:11434/v1');
  assert.throws(() => validateEndpoint('http://example.com/v1'), /HTTPS/);
  assert.throws(() => validateEndpoint('https://secret@example.com/v1'), /credentials/);
  assert.throws(() => validateEndpoint('https://example.com/v1?key=secret'), /query/);
  assert.equal(cleanQuery('```sql\nSELECT 1;\n```'), 'SELECT 1;');
  assert.throws(() => cleanQuery(' '), /empty/);
});
test('ChatGPT calls public Responses directly with plan-compatible fields', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(((init?.headers ?? {}) as Record<string, string>).Authorization, 'Bearer user-token');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'account-model');
    assert.equal(body.store, false);
    assert.equal(body.stream, true);
    assert.equal(body.max_output_tokens, undefined);
    assert.deepEqual(body.input, [{ role: 'user', content: 'Database schema (metadata only):\nusers(id int)\n\nUser request:\nList users' }]);
    return stream(frame({ type: 'response.output_text.delta', delta: 'SELECT id FROM users;' }) + frame({ type: 'response.completed' }));
  };
  try {
    assert.equal(
      await generateQuery({ provider: 'chatgpt', baseUrl: 'https://untrusted.example', model: 'account-model' }, 'user-token', 'List users', 'users(id int)', 'postgres'),
      'SELECT id FROM users;',
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('Ollama uses a local compatible endpoint without user credentials', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(((init?.headers ?? {}) as Record<string, string>).Authorization, undefined);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'SELECT 1;' } }] }));
  };
  try {
    assert.equal(await generateQuery({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local' }, undefined, 'test', '{}', 'mysql'), 'SELECT 1;');
  } finally {
    globalThis.fetch = original;
  }
});
test('Claude uses the user API key, server-side fallback and returns clean SQL', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.anthropic.com/v1/messages?beta=true');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('x-api-key'), 'user-key');
    assert.equal(headers.get('authorization'), null);
    assert.equal(headers.get('anthropic-beta'), 'server-side-fallback-2026-07-01');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'claude-opus-5-5');
    assert.equal(body.fallbacks, 'default');
    assert.match(body.system, /single postgres SQL query/);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Database schema (metadata only):\nusers(id int)\n\nUser request:\nList users' }]);
    return Response.json({
      id: 'msg',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '```sql\nSELECT id FROM users;\n```' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  };
  try {
    assert.equal(
      await generateQuery({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' }, 'user-key', 'List users', 'users(id int)', 'postgres'),
      'SELECT id FROM users;',
    );
  } finally {
    globalThis.fetch = original;
  }
});
test('Claude refusals and rejected keys become readable errors', async () => {
  const original = globalThis.fetch;
  const options = { provider: 'anthropic' as const, baseUrl: '', model: 'claude-haiku-4-5' };
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(JSON.parse(String(init?.body)).fallbacks, undefined);
      return Response.json({
        id: 'msg',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        stop_reason: 'refusal',
        content: [],
        usage: { input_tokens: 1, output_tokens: 0 },
      });
    };
    await assert.rejects(generateQuery(options, 'user-key', 'x', '{}', 'mysql'), /declined/);
    globalThis.fetch = async () => Response.json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 });
    await assert.rejects(generateQuery(options, 'bad-key', 'x', '{}', 'mysql'), /rejected the API key/);
  } finally {
    globalThis.fetch = original;
  }
});
test('OpenAI identity validates signature, issuer, audience, nonce and expiry', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test' };
  const claims = { iss: 'https://auth.openai.com', aud: 'client', nonce: 'nonce', sub: 'subject', exp: Date.now() / 1000 + 60 };
  const jwt = (payload: object) => {
    const unsigned = [{ alg: 'RS256', kid: 'test' }, payload].map((v) => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
    return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
  };
  assert.equal(validateIdToken(jwt(claims), 'client', 'nonce', [jwk]).sub, 'subject');
  for (const change of [{ iss: 'https://evil.example' }, { aud: 'wrong' }, { nonce: 'wrong' }, { exp: 0 }])
    assert.throws(() => validateIdToken(jwt({ ...claims, ...change }), 'client', 'nonce', [jwk]), /validation/);
  const parts = jwt(claims).split('.');
  parts[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'attacker' })).toString('base64url');
  assert.throws(() => validateIdToken(parts.join('.'), 'client', 'nonce', [jwk]), /signature/);
});
test('sign-in uses fresh PKCE and loopback, rejects missing dynamic client ID', async () => {
  await assert.rejects(
    signInChatGpt(
      'urn:uuid:host',
      async (value) => {
        const url = new URL(value);
        assert.equal(url.origin, 'https://auth.openai.com');
        assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
        assert.equal(url.searchParams.get('agent_name_hint'), 'DBDeck');
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
        assert.ok(url.searchParams.get('nonce'));
        const callback = new URL(url.searchParams.get('redirect_uri')!);
        assert.equal(callback.hostname, '127.0.0.1');
        callback.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'test' }).toString();
        assert.equal((await fetch(callback)).status, 400);
        return true;
      },
      new AbortController().signal,
    ),
    /registration/,
  );
});

test('successful OAuth validates identity, keeps issued client and rotates refresh token', async () => {
  const original = globalThis.fetch;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'oauth-test' };
  let nonce = '';
  let redirectUri = '';
  let accountTokens = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('http://127.0.0.1:')) return original(url, init);
    if (String(url).endsWith('/.well-known/openid-configuration'))
      return Response.json({
        issuer: 'https://auth.openai.com',
        jwks_uri: 'https://auth.openai.com/.well-known/jwks.json',
        revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke',
      });
    if (String(url).endsWith('/.well-known/jwks.json')) return Response.json({ keys: [jwk] });
    const params = init?.body as URLSearchParams;
    assert.equal(params.get('client_id'), 'issued-client');
    assert.equal(params.get('resource'), 'https://api.openai.com/v1');
    accountTokens++;
    if (params.get('grant_type') === 'refresh_token') {
      assert.equal(params.get('refresh_token'), 'refresh-1');
      assert.equal(params.get('scope'), null);
      return Response.json({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600, token_type: 'Bearer', scope: 'chatgpt.tokens.use.direct' });
    }
    assert.equal(params.get('grant_type'), 'authorization_code');
    assert.equal(params.get('redirect_uri'), redirectUri);
    assert.ok(params.get('code_verifier'));
    const unsigned = [
      { alg: 'RS256', kid: 'oauth-test' },
      { iss: 'https://auth.openai.com', aud: 'issued-client', sub: 'user', nonce, exp: Date.now() / 1000 + 60 },
    ]
      .map((v) => Buffer.from(JSON.stringify(v)).toString('base64url'))
      .join('.');
    return Response.json({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      id_token: `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`,
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid chatgpt.tokens.use.direct',
    });
  };
  try {
    const account = await signInChatGpt(
      'urn:uuid:host',
      async (value) => {
        const url = new URL(value);
        nonce = url.searchParams.get('nonce')!;
        redirectUri = url.searchParams.get('redirect_uri')!;
        const callback = new URL(redirectUri);
        callback.search = new URLSearchParams({ state: 'wrong-state', code: 'ignored' }).toString();
        assert.equal((await fetch(callback)).status, 400);
        callback.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'valid-code', client_id: 'issued-client' }).toString();
        assert.equal((await fetch(callback)).status, 200);
        return true;
      },
      new AbortController().signal,
    );
    assert.equal(account.clientId, 'issued-client');
    assert.equal(account.subject, 'user');
    assert.equal(account.accessToken, 'access-1');
    const { refreshChatGpt } = await import('../src/openai-auth');
    const refreshed = await refreshChatGpt(account);
    assert.equal(refreshed.refreshToken, 'refresh-2');
    assert.equal(refreshed.accessToken, 'access-2');
    assert.equal(accountTokens, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('OAuth credential lock serializes editor windows and releases after errors', async () => {
  const { withLocalLock } = await import('../src/local-lock');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = await mkdtemp(join(tmpdir(), 'dbdeck-ai-lock-'));
  const lock = join(directory, 'credentials.lock');
  const order: string[] = [];
  try {
    await Promise.all([
      withLocalLock(lock, async () => {
        order.push('first-start');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('first-end');
      }),
      withLocalLock(lock, async () => {
        order.push('second-start');
        order.push('second-end');
      }),
    ]);
    assert.ok(order.indexOf('first-end') < order.indexOf('second-start') || order.indexOf('second-end') < order.indexOf('first-start'));
    await assert.rejects(
      withLocalLock(lock, async () => {
        throw new Error('test failure');
      }),
      /test failure/,
    );
    assert.equal(await withLocalLock(lock, async () => 'released'), 'released');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AI filters request a WHERE expression and return it without executing SQL', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.messages[0].content, /SQL WHERE expression/);
    assert.match(body.messages[1].content, /users\(id int\)/);
    return Response.json({ choices: [{ message: { content: '```sql\nid > 10\n```' } }] });
  };
  try {
    assert.equal(
      await generateQuery({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local' }, undefined, 'IDs above ten', 'users(id int)', 'postgres', undefined, true),
      'id > 10',
    );
  } finally {
    globalThis.fetch = original;
  }
});
