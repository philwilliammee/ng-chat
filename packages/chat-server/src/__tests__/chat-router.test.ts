/**
 * Characterization tests for chat-router.ts — Phase 1.1.
 *
 * These tests PIN CURRENT BEHAVIOR, including known bugs, so that Phase 1.2
 * (extraction) has a regression gate and Phase 1.4 (F1 fix) can flip exactly
 * the assertions that document the broken behavior.
 *
 * F1 bug: estimateMessagesTokens matches AI SDK v4 part shapes
 * (`reasoning` key, `tool-invocation` type) that don't exist in v6.
 * v6 uses `part.text` for reasoning parts and `tool-<name>`/`dynamic-tool`
 * for tool parts — so reasoning and tool tokens are never counted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UIMessage } from 'ai';

// Clear mock call history before every test (implementations are preserved).
beforeEach(() => vi.clearAllMocks());

// ─── Module mocks (hoisted before imports) ──────────────────────────────────

vi.mock('gpt-tokenizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('gpt-tokenizer')>();
  return { ...actual, encode: vi.fn().mockImplementation(actual.encode) };
});

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
    streamText: vi.fn(),
    // Wrap stepCountIs so tests can inspect which round count reached streamText.
    stepCountIs: vi.fn().mockImplementation((n: number) => ({ __steps: n })),
  };
});

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn().mockReturnValue((_modelId: string) => ({
    specificationVersion: 'v3' as const,
    provider: 'test',
    modelId: 'test-model',
    doGenerate: vi.fn(),
    doStream: vi.fn(),
  })),
}));

// ─── Imports (resolved after mocks are applied) ──────────────────────────────

import {
  countTokens,
  estimateMessagesTokens,
  clipHistory,
  createRateLimiter,
  thinkingBudgetFor,
  THINKING_BUDGETS,
  createChatRouter,
} from '../chat-router.js';
import { createStubChatRouter } from '../stub-router.js';
import { encode } from 'gpt-tokenizer';
import { generateText, streamText } from 'ai';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function msg(role: 'user' | 'assistant', parts: Array<Record<string, unknown>>): UIMessage {
  return { id: Math.random().toString(36).slice(2), role, content: '', parts } as unknown as UIMessage;
}

function textPart(text: string) { return { type: 'text', text }; }

/** Shallow-clone a UIMessage array so we can compare object identity. */
const same = (a: UIMessage[], b: UIMessage[]) => a === b;

// ─── countTokens ─────────────────────────────────────────────────────────────

describe('countTokens', () => {
  it('returns a positive integer for non-empty ASCII text', () => {
    expect(countTokens('hello world')).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('falls back to ceil(length/4) when gpt-tokenizer throws', () => {
    vi.mocked(encode).mockImplementationOnce(() => { throw new Error('encoder fail'); });
    expect(countTokens('hello')).toBe(2);   // ceil(5/4) = 2
    vi.mocked(encode).mockImplementationOnce(() => { throw new Error('encoder fail'); });
    expect(countTokens('abcd')).toBe(1);    // ceil(4/4) = 1
  });
});

// ─── estimateMessagesTokens ───────────────────────────────────────────────────

describe('estimateMessagesTokens', () => {
  it('returns 0 for empty messages array', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it('returns 0 for messages with no parts', () => {
    expect(estimateMessagesTokens([{ id: '1', role: 'user', content: '', parts: [] } as UIMessage])).toBe(0);
  });

  it('counts text parts', () => {
    const msgs = [msg('user', [textPart('hello')])];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0);
  });

  it('counts 1000 tokens per file part', () => {
    const msgs = [msg('assistant', [{ type: 'file', url: 'data:image/png;base64,abc' }])];
    expect(estimateMessagesTokens(msgs)).toBe(1_000);
  });

  it('counts two file parts as 2000', () => {
    const msgs = [msg('assistant', [
      { type: 'file', url: 'data:image/png;base64,abc' },
      { type: 'file', url: 'data:image/png;base64,def' },
    ])];
    expect(estimateMessagesTokens(msgs)).toBe(2_000);
  });

  // ── F1 fix (Phase 1.4): v6 shapes now count correctly ────────────────────

  it('v6 reasoning parts (type:reasoning, .text) count tokens (F1 fixed)', () => {
    // AI SDK v6 reasoning parts: { type: 'reasoning', text: '...' }
    // Fixed: code now checks typeof part['text'] === 'string' for reasoning parts.
    const msgs = [msg('assistant', [{ type: 'reasoning', text: 'step by step analysis' }])];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0);
  });

  it('v4 reasoning parts (.reasoning key) no longer count — dead v4 path removed', () => {
    // AI SDK v4 shape: { type: 'reasoning', reasoning: '...' }
    // After the fix, the code checks .text not .reasoning, so old v4 shapes count 0.
    // This is intentional: v4 clients are no longer supported.
    const msgs = [msg('assistant', [{ type: 'reasoning', reasoning: 'step by step analysis' }])];
    expect(estimateMessagesTokens(msgs)).toBe(0);
  });

  it('v6 tool parts (tool-<name>) count input + output tokens (F1 fixed)', () => {
    // AI SDK v6: { type: 'tool-bash_exec', input: {...}, output: {...} }
    // Fixed: code now matches type.startsWith('tool-') and counts input + output.
    const msgs = [msg('assistant', [
      { type: 'tool-bash_exec', input: { command: 'ls -la' }, output: 'file.txt\ndir/' },
    ])];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0);
  });

  it('v6 dynamic-tool parts count input + output tokens (F1 fixed)', () => {
    const msgs = [msg('assistant', [
      { type: 'dynamic-tool', toolName: 'read_file', input: { path: 'a.md' }, output: 'content' },
    ])];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0);
  });

  it('v4 tool-invocation parts no longer count — dead v4 path removed', () => {
    // After the fix, 'tool-invocation' type does not match startsWith('tool-') check
    // (it would actually match! 'tool-invocation'.startsWith('tool-') === true)
    // So tool-invocation parts now count via the new path (input/output keys).
    // If toolInvocation.args exists but not part.input, the new code finds nothing.
    const msgs = [msg('assistant', [{
      type: 'tool-invocation',
      toolInvocation: { args: { command: 'ls' }, result: 'file.txt' },
    }])];
    // 'tool-invocation'.startsWith('tool-') → true, but part.input and part.output
    // are undefined (the data is nested under toolInvocation) → counts 0
    expect(estimateMessagesTokens(msgs)).toBe(0);
  });

  it('sums tokens across multiple messages and parts', () => {
    const msgs = [
      msg('user', [textPart('hello')]),
      msg('assistant', [textPart('world')]),
    ];
    const total = estimateMessagesTokens(msgs);
    const each =
      estimateMessagesTokens([msg('user', [textPart('hello')])]) +
      estimateMessagesTokens([msg('assistant', [textPart('world')])]);
    expect(total).toBe(each);
  });
});

// ─── clipHistory ──────────────────────────────────────────────────────────────

describe('clipHistory', () => {
  it('returns the same array reference when under budget', () => {
    const msgs = [msg('user', [textPart('hi')])];
    const result = clipHistory(msgs, 1_000_000);
    expect(same(result, msgs)).toBe(true);
  });

  it('returns same reference when exactly at budget', () => {
    const msgs = [msg('user', [textPart('hi')])];
    const tokens = estimateMessagesTokens(msgs);
    const result = clipHistory(msgs, tokens);
    expect(same(result, msgs)).toBe(true);
  });

  it('drops the oldest user turn when over budget', () => {
    const m1 = msg('user', [textPart('first question')]);
    const m2 = msg('assistant', [textPart('first answer')]);
    const m3 = msg('user', [textPart('second question')]);
    const all = [m1, m2, m3];
    // Budget tight enough to force a drop
    const budget = estimateMessagesTokens([m3]) + 1;
    const result = clipHistory(all, budget);
    expect(result).not.toContain(m1);
    expect(result).not.toContain(m2);
    expect(result).toContain(m3);
  });

  it('always retains the last user turn even when still over budget', () => {
    const m1 = msg('user', [textPart('a')]);
    const m2 = msg('user', [textPart('b'.repeat(5000))]);
    const result = clipHistory([m1, m2], 1); // budget=1 → impossible to fit
    expect(result).toContain(m2); // last user turn preserved
  });

  it('returns empty array unchanged', () => {
    const result = clipHistory([], 100);
    expect(result).toEqual([]);
  });

  it('returns single user message unchanged', () => {
    const m = msg('user', [textPart('hi')]);
    const result = clipHistory([m], 1); // budget=1 → can't drop (only turn)
    expect(result).toContain(m);
  });

  it('returns full array when no user messages present', () => {
    // No user messages → userIndices.length = 0 → loop never runs
    const m1 = msg('assistant', [textPart('a'.repeat(500))]);
    const m2 = msg('assistant', [textPart('b'.repeat(500))]);
    const msgs = [m1, m2];
    const result = clipHistory(msgs, 1); // over budget but can't clip
    expect(same(result, msgs)).toBe(true);
  });
});

// ─── createRateLimiter ───────────────────────────────────────────────────────

describe('createRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('allows up to maxRequests within the window', () => {
    const limit = createRateLimiter(3, 60_000);
    expect(limit('ip')).toBe(true);
    expect(limit('ip')).toBe(true);
    expect(limit('ip')).toBe(true);
  });

  it('blocks the N+1 request within the window', () => {
    const limit = createRateLimiter(3, 60_000);
    limit('ip'); limit('ip'); limit('ip');
    expect(limit('ip')).toBe(false);
  });

  it('different IPs have independent buckets', () => {
    const limit = createRateLimiter(1, 60_000);
    expect(limit('ip1')).toBe(true);
    expect(limit('ip2')).toBe(true);
    expect(limit('ip1')).toBe(false);
  });

  it('allows again after the window expires', () => {
    const limit = createRateLimiter(2, 60_000);
    limit('ip'); limit('ip'); // fill the bucket
    vi.advanceTimersByTime(60_001);
    expect(limit('ip')).toBe(true);
  });

  it('evicts stale bucket and re-admits after expiry', () => {
    const limit = createRateLimiter(1, 1_000);
    limit('ip'); // one hit
    vi.advanceTimersByTime(1_001);
    // All prior hits expired → stale bucket evicted, new hit starts fresh
    expect(limit('ip')).toBe(true);
  });
});

// ─── thinkingBudgetFor ───────────────────────────────────────────────────────

describe('thinkingBudgetFor', () => {
  it('returns undefined for undefined input', () => {
    expect(thinkingBudgetFor(undefined)).toBeUndefined();
  });

  it('returns undefined for unknown/disabled levels', () => {
    expect(thinkingBudgetFor('disabled')).toBeUndefined();
    expect(thinkingBudgetFor('unknown')).toBeUndefined();
    expect(thinkingBudgetFor('')).toBeUndefined();
  });

  it('maps low → 2000', () => {
    expect(thinkingBudgetFor('low')).toBe(THINKING_BUDGETS['low']);
    expect(thinkingBudgetFor('low')).toBe(2_000);
  });

  it('maps medium → 8000', () => {
    expect(thinkingBudgetFor('medium')).toBe(THINKING_BUDGETS['medium']);
    expect(thinkingBudgetFor('medium')).toBe(8_000);
  });

  it('maps high → 16000', () => {
    expect(thinkingBudgetFor('high')).toBe(THINKING_BUDGETS['high']);
    expect(thinkingBudgetFor('high')).toBe(16_000);
  });
});

// ─── Endpoint tests ───────────────────────────────────────────────────────────

const BASE_CONFIG = {
  baseURL: 'http://test-gateway/v1',
  defaultModel: 'gpt-4o',
  allowedModels: ['gpt-4o', 'gpt-4o-mini'],
  contextLimit: 128_000,
  maxToolRounds: 8,
  contentDir: '/tmp',
};

const JSON_HEADERS = { 'content-type': 'application/json' };

describe('GET /config', () => {
  it('returns model, contextLimit, allowedModels, tools', async () => {
    const app = createChatRouter(BASE_CONFIG);
    const res = await app.request('/config');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.enabled).toBe(true);
    expect(body.model).toBe('gpt-4o');
    expect(body.contextLimit).toBe(128_000);
    expect(body.allowedModels).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(Array.isArray(body.tools)).toBe(true);
  });

  it('defaults allowedModels to [defaultModel] when not provided', async () => {
    const app = createChatRouter({ baseURL: 'http://t', defaultModel: 'gpt-4o-mini' });
    const body = await (await app.request('/config')).json() as Record<string, unknown>;
    expect(body.allowedModels).toEqual(['gpt-4o-mini']);
  });
});

describe('POST /compact', () => {
  beforeEach(() => {
    vi.mocked(generateText).mockResolvedValue({ text: 'Compact summary.' } as never);
  });

  it('returns summary from generateText', async () => {
    const app = createChatRouter(BASE_CONFIG);
    const body = { messages: [msg('user', [textPart('what is 2+2')]), msg('assistant', [textPart('4')])] };
    const res = await app.request('/compact', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).summary).toBe('Compact summary.');
  });

  it('includes only text parts in the transcript passed to generateText', async () => {
    const app = createChatRouter(BASE_CONFIG);
    const body = {
      messages: [
        msg('user', [textPart('hello'), { type: 'tool-bash_exec', input: { command: 'ls' } }]),
        msg('assistant', [textPart('world')]),
      ],
    };
    await app.request('/compact', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
    const callArg = vi.mocked(generateText).mock.calls.at(-1)![0];
    const userContent = (callArg.messages as Array<{ role: string; content: string }>)[0].content as string;
    expect(userContent).toContain('user: hello');
    expect(userContent).toContain('assistant: world');
    expect(userContent).not.toContain('tool-bash_exec');
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(generateText).mockResolvedValue({ text: 'x' } as never);
    const app = createChatRouter({ ...BASE_CONFIG, rateLimit: { maxRequests: 1, windowMs: 60_000 } });
    const payload = { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ messages: [] }) };
    await app.request('/compact', payload);
    const res2 = await app.request('/compact', payload);
    expect(res2.status).toBe(429);
  });

  it('treats missing messages as empty array (no crash)', async () => {
    const app = createChatRouter(BASE_CONFIG);
    const res = await app.request('/compact', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /close', () => {
  it('extracts filesWritten from write_file tool results', async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: '',
      steps: [{
        toolResults: [
          { toolName: 'write_file', output: { path: 'memories/summary.md' } },
          { toolName: 'write_file', output: { path: 'memories/_index.md' } },
          { toolName: 'get_time', output: {} },           // non-write_file → ignored
          { toolName: 'write_file', output: {} },          // missing path → ignored
        ],
      }],
    } as never);

    const app = createChatRouter(BASE_CONFIG);
    const res = await app.request('/close', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ messages: [msg('user', [textPart('hi')])] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { filesWritten: string[] };
    expect(body.filesWritten).toEqual(['memories/summary.md', 'memories/_index.md']);
  });

  it('returns empty filesWritten when no write_file calls', async () => {
    vi.mocked(generateText).mockResolvedValue({ text: '', steps: [] } as never);
    const app = createChatRouter(BASE_CONFIG);
    const res = await app.request('/close', {
      method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ messages: [] }),
    });
    const body = await res.json() as { filesWritten: string[] };
    expect(body.filesWritten).toEqual([]);
  });

  it('returns 429 when rate limited', async () => {
    vi.mocked(generateText).mockResolvedValue({ text: '', steps: [] } as never);
    const app = createChatRouter({ ...BASE_CONFIG, rateLimit: { maxRequests: 1, windowMs: 60_000 } });
    const payload = { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ messages: [] }) };
    await app.request('/close', payload);
    const res2 = await app.request('/close', payload);
    expect(res2.status).toBe(429);
  });
});

describe('POST /', () => {
  function mockStream() {
    vi.mocked(streamText).mockReturnValue({
      toUIMessageStreamResponse: () => new Response('', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    } as never);
  }

  beforeEach(() => mockStream());

  it('returns 400 when model is not in allowedModels', async () => {
    const app = createChatRouter(BASE_CONFIG);
    const res = await app.request('/', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ messages: [], model: 'not-allowed' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('not-allowed');
  });

  it('accepts a model that is in allowedModels', async () => {
    const app = createChatRouter(BASE_CONFIG);
    const res = await app.request('/', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ messages: [], model: 'gpt-4o-mini' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 429 when rate limited', async () => {
    const app = createChatRouter({ ...BASE_CONFIG, rateLimit: { maxRequests: 1, windowMs: 60_000 } });
    const payload = { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ messages: [] }) };
    await app.request('/', payload);
    const res2 = await app.request('/', payload);
    expect(res2.status).toBe(429);
  });

  it('uses default rounds when maxToolRounds is omitted', async () => {
    const app = createChatRouter(BASE_CONFIG); // maxToolRounds=8
    await app.request('/', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ messages: [] }),
    });
    const callArg = vi.mocked(streamText).mock.calls.at(-1)![0];
    expect((callArg.stopWhen as unknown as { __steps: number }).__steps).toBe(8);
  });

  it('calls streamText once for a valid request', async () => {
    const app = createChatRouter(BASE_CONFIG);
    await app.request('/', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ messages: [] }),
    });
    expect(vi.mocked(streamText)).toHaveBeenCalledOnce();
  });
});

// ─── Request size caps ────────────────────────────────────────────────────────

describe('request size caps', () => {
  const TIGHT = { ...BASE_CONFIG, limits: { maxMessageChars: 10, maxTotalChars: 25, maxMessages: 3 } };
  const post = (body: unknown) => ({ method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
  const long = (n: number) => msg('user', [textPart('x'.repeat(n))]);

  beforeEach(() => {
    vi.mocked(streamText).mockReturnValue({
      toUIMessageStreamResponse: () => new Response('', { headers: { 'content-type': 'text/event-stream' } }),
    } as never);
    vi.mocked(generateText).mockResolvedValue({ text: 'x', steps: [] } as never);
  });

  it('rejects an over-long single message with 400 on POST /', async () => {
    const app = createChatRouter(TIGHT);
    const res = await app.request('/', post({ messages: [long(11)] }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('too long');
  });

  it('rejects an over-long conversation with 413 on POST /', async () => {
    const app = createChatRouter(TIGHT);
    const res = await app.request('/', post({ messages: [long(9), long(9), long(9)] }));
    expect(res.status).toBe(413);
  });

  it('rejects too many messages with 413 on POST /', async () => {
    const app = createChatRouter(TIGHT);
    const res = await app.request('/', post({ messages: [long(1), long(1), long(1), long(1)] }));
    expect(res.status).toBe(413);
  });

  it('rejects before reaching the gateway', async () => {
    const app = createChatRouter(TIGHT);
    await app.request('/', post({ messages: [long(11)] }));
    expect(vi.mocked(streamText)).not.toHaveBeenCalled();
  });

  it('rejects an oversized message before the model allowlist check', async () => {
    // Both would 400; the size cap must win, otherwise an oversized body has
    // already been parsed and measured for nothing.
    const app = createChatRouter(TIGHT);
    const res = await app.request('/', post({ messages: [long(11)], model: 'not-allowed' }));
    expect(((await res.json()) as { error: string }).error).toContain('too long');
  });

  it('applies the caps to POST /compact', async () => {
    const app = createChatRouter(TIGHT);
    const res = await app.request('/compact', post({ messages: [long(11)] }));
    expect(res.status).toBe(400);
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
  });

  it('applies the caps to POST /close', async () => {
    const app = createChatRouter(TIGHT);
    const res = await app.request('/close', post({ messages: [long(9), long(9), long(9)] }));
    expect(res.status).toBe(413);
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
  });

  it('lets a large paste through on the default limits', async () => {
    // Kept modest on purpose: this goes through the real tokenizer, and the
    // generosity of DEFAULT_LIMITS itself is asserted in lib.test.ts where the
    // check is pure. 12k chars is already past any cap worth calling tight.
    const app = createChatRouter(BASE_CONFIG);
    const res = await app.request('/', post({ messages: [long(12_000)] }));
    expect(res.status).toBe(200);
  });
});

// ─── sendReasoning ────────────────────────────────────────────────────────────

describe('sendReasoning', () => {
  function captureStreamOptions() {
    const spy = vi.fn().mockReturnValue(new Response('', { headers: { 'content-type': 'text/event-stream' } }));
    vi.mocked(streamText).mockReturnValue({ toUIMessageStreamResponse: spy } as never);
    return spy;
  }

  const post = { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ messages: [] }) };

  it('defaults to true', async () => {
    const spy = captureStreamOptions();
    await createChatRouter(BASE_CONFIG).request('/', post);
    expect(spy.mock.calls.at(-1)![0]).toMatchObject({ sendReasoning: true });
  });

  it('can be switched off for untrusted callers', async () => {
    const spy = captureStreamOptions();
    await createChatRouter({ ...BASE_CONFIG, sendReasoning: false }).request('/', post);
    expect(spy.mock.calls.at(-1)![0]).toMatchObject({ sendReasoning: false });
  });
});

describe('usage reporting', () => {
  // Drive the onFinish callback streamText was handed, as the SDK would.
  async function finishTurn(config: Partial<Parameters<typeof createChatRouter>[0]>, headers: Record<string, string> = {}) {
    vi.mocked(streamText).mockImplementation(((opts: { onFinish?: (e: unknown) => void }) => {
      opts.onFinish?.({ usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33 }, totalUsage: undefined });
      return { toUIMessageStreamResponse: () => new Response('') } as never;
    }) as never);
    await createChatRouter({ ...BASE_CONFIG, ...config }).request('/', {
      method: 'POST',
      headers: { ...JSON_HEADERS, ...headers },
      body: JSON.stringify({ messages: [] }),
    });
  }

  it('hands a completed turn to onUsage instead of stdout', async () => {
    const onUsage = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await finishTurn({ onUsage }, { 'x-forwarded-for': 'forged, real' });
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ ip: 'real', inputTokens: 11, outputTokens: 22, totalTokens: 33 }),
    );
    expect(log).not.toHaveBeenCalledWith('[chat] usage', expect.anything());
    log.mockRestore();
  });

  it('logs to stdout when no hook is provided', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await finishTurn({});
    expect(log).toHaveBeenCalledWith('[chat] usage', expect.objectContaining({ totalTokens: 33 }));
    log.mockRestore();
  });
});

// ─── Stub router ──────────────────────────────────────────────────────────────

describe('createStubChatRouter', () => {
  const CONFIG = { message: 'Set GATEWAY_API_KEY in .env.', contextLimit: 4_000, tools: ['get_time'] };
  const post = { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ messages: [] }) };

  it('reports the same /config shape as the real router', async () => {
    const real = await (await createChatRouter(BASE_CONFIG).request('/config')).json() as Record<string, unknown>;
    const stub = await (await createStubChatRouter(CONFIG).request('/config')).json() as Record<string, unknown>;
    expect(Object.keys(stub).sort()).toEqual(Object.keys(real).sort());
  });

  it('reports enabled:true by default — configured wrong, not switched off', async () => {
    const body = await (await createStubChatRouter(CONFIG).request('/config')).json() as Record<string, unknown>;
    expect(body).toMatchObject({ enabled: true, model: null, contextLimit: 4_000, allowedModels: [], tools: ['get_time'] });
  });

  it('reports enabled:false when the feature is switched off', async () => {
    const app = createStubChatRouter({ ...CONFIG, enabled: false });
    const body = await (await app.request('/config')).json() as Record<string, unknown>;
    expect(body.enabled).toBe(false);
  });

  it('streams the message as a real UI message stream', async () => {
    const res = await createStubChatRouter(CONFIG).request('/', post);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('text-delta');
    expect(text).toContain('Set GATEWAY_API_KEY');
  });

  it('never calls a model provider', async () => {
    await createStubChatRouter(CONFIG).request('/', post);
    expect(vi.mocked(streamText)).not.toHaveBeenCalled();
    expect(vi.mocked(generateText)).not.toHaveBeenCalled();
  });

  it('answers /compact and /close with 503 and the reason', async () => {
    const app = createStubChatRouter(CONFIG);
    for (const path of ['/compact', '/close']) {
      const res = await app.request(path, post);
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: string }).error).toBe(CONFIG.message);
    }
  });
});
