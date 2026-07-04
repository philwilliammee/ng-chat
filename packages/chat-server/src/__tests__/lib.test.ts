/**
 * Isolation tests for the lib/ modules (Phase 1.3).
 * These complement the characterization tests — they test the extracted modules
 * directly (via their own imports) rather than through chat-router.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UIMessage } from 'ai';

beforeEach(() => vi.clearAllMocks());

// ─── lib/tokens.ts ────────────────────────────────────────────────────────────

vi.mock('gpt-tokenizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('gpt-tokenizer')>();
  return { ...actual, encode: vi.fn().mockImplementation(actual.encode) };
});

import { countTokens, estimateMessagesTokens } from '../lib/tokens.js';
import { encode } from 'gpt-tokenizer';

describe('lib/tokens — countTokens', () => {
  it('returns a positive integer for non-empty text', () => {
    expect(countTokens('hello world')).toBeGreaterThan(0);
  });

  it('returns 0 for empty string', () => {
    expect(countTokens('')).toBe(0);
  });

  it('falls back to ceil(length/4) when encoder throws', () => {
    vi.mocked(encode).mockImplementationOnce(() => { throw new Error('fail'); });
    expect(countTokens('hello')).toBe(2); // ceil(5/4) = 2
  });
});

describe('lib/tokens — estimateMessagesTokens', () => {
  function msg(role: 'user' | 'assistant', parts: Array<Record<string, unknown>>): UIMessage {
    return { id: '1', role, content: '', parts } as unknown as UIMessage;
  }

  it('counts text parts', () => {
    expect(estimateMessagesTokens([msg('user', [{ type: 'text', text: 'hi' }])])).toBeGreaterThan(0);
  });

  it('counts 1000 per file part', () => {
    expect(estimateMessagesTokens([msg('user', [{ type: 'file', url: '' }])])).toBe(1_000);
  });

  it('returns 0 for empty messages', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });
});

// ─── lib/history.ts ───────────────────────────────────────────────────────────

import { clipHistory } from '../lib/history.js';

describe('lib/history — clipHistory', () => {
  function msg(role: 'user' | 'assistant', text: string): UIMessage {
    return { id: Math.random().toString(36).slice(2), role, content: '', parts: [{ type: 'text', text }] } as unknown as UIMessage;
  }

  it('returns same reference when under budget', () => {
    const msgs = [msg('user', 'hi')];
    expect(clipHistory(msgs, 1_000_000)).toBe(msgs);
  });

  it('drops oldest user turn when over budget', () => {
    const m1 = msg('user', 'first');
    const m2 = msg('assistant', 'reply');
    const m3 = msg('user', 'second');
    // Use a very small budget so m1+m2 tokens definitely exceed it
    const result = clipHistory([m1, m2, m3], 1);
    // clipHistory can't drop the last user turn (m3), so it keeps [m3]
    expect(result).not.toContain(m1);
    expect(result).toContain(m3);
  });

  it('never drops the last user turn', () => {
    const last = msg('user', 'x'.repeat(5000));
    const result = clipHistory([msg('user', 'old'), last], 1);
    expect(result).toContain(last);
  });
})

// ─── lib/rate-limit.ts ────────────────────────────────────────────────────────

import { createRateLimiter, getClientIp } from '../lib/rate-limit.js';

describe('lib/rate-limit — createRateLimiter', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('allows N requests, blocks N+1', () => {
    const limit = createRateLimiter(2, 60_000);
    expect(limit('ip')).toBe(true);
    expect(limit('ip')).toBe(true);
    expect(limit('ip')).toBe(false);
  });

  it('re-admits after window expires', () => {
    const limit = createRateLimiter(1, 1_000);
    limit('ip');
    vi.advanceTimersByTime(1_001);
    expect(limit('ip')).toBe(true);
  });
});

describe('lib/rate-limit — getClientIp', () => {
  it('uses x-forwarded-for first', () => {
    const c = { req: { header: (n: string) => n === 'x-forwarded-for' ? '1.2.3.4, 5.6.7.8' : undefined } };
    expect(getClientIp(c)).toBe('1.2.3.4');
  });

  it('falls back to x-real-ip', () => {
    const c = { req: { header: (n: string) => n === 'x-real-ip' ? '9.0.0.1' : undefined } };
    expect(getClientIp(c)).toBe('9.0.0.1');
  });

  it('falls back to "unknown"', () => {
    const c = { req: { header: () => undefined } };
    expect(getClientIp(c)).toBe('unknown');
  });
});

// ─── lib/thinking.ts ─────────────────────────────────────────────────────────

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn().mockReturnValue((modelId: string) => ({ modelId })),
}));

import { thinkingBudgetFor, THINKING_BUDGETS, createProviderFactory } from '../lib/thinking.js';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

describe('lib/thinking — thinkingBudgetFor', () => {
  it('returns undefined for undefined/disabled/unknown', () => {
    expect(thinkingBudgetFor(undefined)).toBeUndefined();
    expect(thinkingBudgetFor('disabled')).toBeUndefined();
    expect(thinkingBudgetFor('unknown')).toBeUndefined();
  });

  it('maps low/medium/high correctly', () => {
    expect(thinkingBudgetFor('low')).toBe(THINKING_BUDGETS['low']);
    expect(thinkingBudgetFor('medium')).toBe(THINKING_BUDGETS['medium']);
    expect(thinkingBudgetFor('high')).toBe(THINKING_BUDGETS['high']);
  });
});

describe('lib/thinking — createProviderFactory', () => {
  it('returns default provider (no transformRequestBody) when budget is undefined', () => {
    vi.mocked(createOpenAICompatible).mockClear();
    const getProvider = createProviderFactory({ name: 'gw', baseURL: 'http://t' });
    getProvider(undefined);
    // Only one call (the default provider created at factory init)
    expect(vi.mocked(createOpenAICompatible)).toHaveBeenCalledTimes(1);
    const initCall = vi.mocked(createOpenAICompatible).mock.calls[0][0];
    expect(initCall).not.toHaveProperty('transformRequestBody');
  });

  it('creates a new provider with transformRequestBody when budget is set', () => {
    vi.mocked(createOpenAICompatible).mockClear();
    const getProvider = createProviderFactory({ name: 'gw', baseURL: 'http://t' });
    getProvider(8_000);
    // Two calls: default + thinking
    expect(vi.mocked(createOpenAICompatible)).toHaveBeenCalledTimes(2);
    const thinkingCall = vi.mocked(createOpenAICompatible).mock.calls[1][0];
    expect(typeof thinkingCall.transformRequestBody).toBe('function');
    // Check the transformRequestBody injects the budget_tokens
    const body = { model: 'x' };
    const transformed = thinkingCall.transformRequestBody!(body);
    expect(transformed).toMatchObject({ thinking: { type: 'enabled', budget_tokens: 8_000 } });
  });
});

// ─── lib/transcript.ts ────────────────────────────────────────────────────────

import { buildTranscript } from '../lib/transcript.js';

describe('lib/transcript — buildTranscript', () => {
  function msg(role: 'user' | 'assistant', parts: Array<Record<string, unknown>>): UIMessage {
    return { id: '1', role, content: '', parts } as unknown as UIMessage;
  }

  it('builds text-only transcript by default', () => {
    const msgs = [
      msg('user', [{ type: 'text', text: 'hello' }]),
      msg('assistant', [{ type: 'text', text: 'world' }]),
    ];
    expect(buildTranscript(msgs)).toBe('user: hello\nassistant: world');
  });

  it('omits messages with no text parts', () => {
    const msgs = [
      msg('user', [{ type: 'text', text: 'hi' }]),
      msg('assistant', [{ type: 'file', url: '' }]),
    ];
    expect(buildTranscript(msgs)).toBe('user: hi');
  });

  it('skips tool parts by default (text-only mode)', () => {
    const msgs = [
      msg('user', [{ type: 'text', text: 'run ls' }]),
      msg('assistant', [
        { type: 'text', text: 'sure' },
        { type: 'tool-bash_exec', input: { command: 'ls' }, output: 'a.ts' },
      ]),
    ];
    const t = buildTranscript(msgs);
    expect(t).toContain('assistant: sure');
    expect(t).not.toContain('tool-bash_exec');
  });

  it('includes tool lines when includeTools: true', () => {
    const msgs = [
      msg('assistant', [
        { type: 'text', text: 'ok' },
        { type: 'tool-bash_exec', toolName: 'bash_exec', input: { command: 'ls' }, output: 'a.ts' },
      ]),
    ];
    const t = buildTranscript(msgs, { includeTools: true });
    expect(t).toContain('[tool] bash_exec');
    expect(t).toContain('ls');
  });

  it('caps tool output at toolOutputCap characters', () => {
    const longOutput = 'x'.repeat(500);
    const msgs = [
      msg('assistant', [{ type: 'tool-bash_exec', toolName: 'bash_exec', input: {}, output: longOutput }]),
    ];
    const t = buildTranscript(msgs, { includeTools: true, toolOutputCap: 50 });
    // tool output in transcript should not exceed cap
    expect(t.length).toBeLessThan(300);
  });

  it('returns empty string for empty messages', () => {
    expect(buildTranscript([])).toBe('');
  });
});
