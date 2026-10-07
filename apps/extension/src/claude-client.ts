import Anthropic from '@anthropic-ai/sdk';
import { ChatMessage, ChatReply, ChatTool, parseArguments } from './ai-chat';

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

function claudeMessages(history: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of history) {
    if (m.role === 'user') messages.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant')
      messages.push({
        role: 'assistant',
        content: [
          ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
          ...(m.calls ?? []).map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: safeArguments(c.arguments) })),
        ],
      });
    else {
      const block = { type: 'tool_result' as const, tool_use_id: m.callId, content: m.content };
      const last = messages[messages.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) last.content.push(block);
      else messages.push({ role: 'user', content: [block] });
    }
  }
  return messages;
}

function safeArguments(text: string): Record<string, unknown> {
  try {
    return parseArguments(text);
  } catch {
    return {};
  }
}

export async function claudeChat(apiKey: string, model: string, system: string, history: ChatMessage[], tools: ChatTool[], signal?: AbortSignal): Promise<ChatReply> {
  try {
    const response = await client(apiKey, 180000).beta.messages.create(
      {
        model,
        max_tokens: 16000,
        system,
        messages: claudeMessages(history),
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Beta.BetaTool.InputSchema })),
        ...(FALLBACK_MODELS.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') throw new Error('Claude declined this request. Rephrase it or choose another model.');
    if (response.stop_reason === 'max_tokens') throw new Error('Claude stopped before finishing the answer. Ask a narrower question.');
    return {
      content: response.content.map((block) => (block.type === 'text' ? block.text : '')).join(''),
      calls: response.content.flatMap((block) => (block.type === 'tool_use' ? [{ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }] : [])),
    };
  } catch (e) {
    throw claudeError(e);
  }
}
