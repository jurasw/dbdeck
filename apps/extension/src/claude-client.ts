import Anthropic from '@anthropic-ai/sdk';

const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

function client(apiKey: string, timeout: number): Anthropic {
  return new Anthropic({ apiKey, timeout, maxRetries: 1 });
}

function claudeError(e: unknown): Error {
  if (e instanceof Anthropic.APIUserAbortError) return new Error('Generation cancelled.');
  if (e instanceof Anthropic.AuthenticationError) return new Error('Claude rejected the API key. Check it in Claude Console.');
  if (e instanceof Anthropic.RateLimitError) return new Error('Claude rate limit reached. Try again later.');
  if (e instanceof Anthropic.APIError) return new Error(`Claude API returned HTTP ${e.status ?? 'error'}. Check your API key, model and usage limits.`);
  return e instanceof Error ? e : new Error(String(e));
}

export async function listClaudeModels(apiKey: string): Promise<{ id: string; name: string }[]> {
  try {
    const models: { id: string; name: string }[] = [];
    for await (const model of client(apiKey, 20000).models.list()) models.push({ id: model.id, name: model.display_name });
    return models;
  } catch (e) {
    throw claudeError(e);
  }
}

export async function generateClaudeText(apiKey: string, model: string, system: string, input: string, signal?: AbortSignal): Promise<string> {
  try {
    const response = await client(apiKey, 120000).beta.messages.create(
      {
        model,
        max_tokens: 16000,
        system,
        messages: [{ role: 'user', content: input }],
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') throw new Error('Claude declined this request. Rephrase it or choose another model.');
    if (response.stop_reason === 'max_tokens') throw new Error('Claude stopped before finishing the query. Choose fewer tables.');
    return response.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
  } catch (e) {
    throw claudeError(e);
  }
}
