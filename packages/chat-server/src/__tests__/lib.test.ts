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
  const ctx = (headers: Record<string, string>) => ({
    req: { header: (n: string) => headers[n] },
  });

  it('takes the last x-forwarded-for entry with the default single hop', () => {
    // The rightmost entry is the one our own proxy appended; 1.2.3.4 could be
    // anything the caller typed.
    expect(getClientIp(ctx({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('5.6.7.8');
  });

  it('ignores forged left-hand entries however many are sent', () => {
    const forged = ctx({ 'x-forwarded-for': '9.9.9.9, 9.9.9.8, 9.9.9.7, 5.6.7.8' });
    expect(getClientIp(forged)).toBe('5.6.7.8');
  });

  // Chain as the app sees it behind CDN→ALB, where the caller pre-forged two
  // entries: the CDN appended the real client IP, then the ALB appended the CDN's.
  const cdnThenAlb = () => ctx({ 'x-forwarded-for': 'forged-a, forged-b, real-client, cdn' });

  it('finds the real client two hops back behind two trusted proxies', () => {
    expect(getClientIp(cdnThenAlb(), 2)).toBe('real-client');
  });

  it('trusts a caller-supplied entry when the hop count is set too high', () => {
    // Not a bug — the documented failure mode of over-counting. TRUSTED_PROXY_HOPS
    // has to match the deployment; nothing in the header can prove the true depth.
    expect(getClientIp(cdnThenAlb(), 3)).toBe('forged-b');
  });

  it('tolerates whitespace and empty entries', () => {
    expect(getClientIp(ctx({ 'x-forwarded-for': ' 1.2.3.4 ,, 5.6.7.8 ' }))).toBe('5.6.7.8');
  });

  it('falls through when the chain is shorter than the hop count', () => {
    // Nothing in a 1-entry chain is provably proxy-appended at 2 hops.
    const c = ctx({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '9.0.0.1' });
    expect(getClientIp(c, 2)).toBe('9.0.0.1');
  });

  it('reads no forwarding header at all when hops is 0', () => {
    const c = ctx({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8', 'x-real-ip': '9.0.0.1' });
    expect(getClientIp(c, 0)).toBe('unknown');
  });

  it('falls back to x-real-ip', () => {
    expect(getClientIp(ctx({ 'x-real-ip': '9.0.0.1' }))).toBe('9.0.0.1');
  });

  it('falls back to "unknown"', () => {
    expect(getClientIp(ctx({}))).toBe('unknown');
  });
});

// ─── lib/limits.ts ────────────────────────────────────────────────────────────

import { DEFAULT_LIMITS, checkRequestLimits, resolveLimits, textLength } from '../lib/limits.js';

describe('lib/limits — resolveLimits', () => {
  it('returns the defaults untouched with no overrides', () => {
    expect(resolveLimits()).toEqual(DEFAULT_LIMITS);
    expect(resolveLimits({})).toEqual(DEFAULT_LIMITS);
  });

  it('applies only the keys given', () => {
    expect(resolveLimits({ maxMessages: 5 })).toEqual({ ...DEFAULT_LIMITS, maxMessages: 5 });
  });

  it('ignores explicit undefined instead of erasing the cap', () => {
    // A plain spread would set maxMessages to undefined here, and every
    // `n > undefined` comparison is false — the cap would silently disappear.
    const resolved = resolveLimits({ maxMessages: undefined, maxTotalChars: 42 });
    expect(resolved.maxMessages).toBe(DEFAULT_LIMITS.maxMessages);
    expect(resolved.maxTotalChars).toBe(42);
  });

  it('ignores NaN, which is what a bad env value parses to', () => {
    expect(resolveLimits({ maxMessageChars: NaN }).maxMessageChars)
      .toBe(DEFAULT_LIMITS.maxMessageChars);
  });

  it('accepts 0 as a real value, not a missing one', () => {
    expect(resolveLimits({ maxMessages: 0 }).maxMessages).toBe(0);
  });
});

describe('lib/limits — textLength', () => {
  const msg = (parts: Array<Record<string, unknown>>) =>
    ({ id: '1', role: 'user', parts } as unknown as UIMessage);

  it('sums text parts', () => {
    expect(textLength(msg([{ type: 'text', text: 'abc' }, { type: 'text', text: 'de' }]))).toBe(5);
  });

  it('ignores tool and file parts', () => {
    const m = msg([
      { type: 'text', text: 'hi' },
      { type: 'file', url: 'x'.repeat(1000) },
      { type: 'tool-read_file', input: { path: 'x'.repeat(1000) }, output: 'y'.repeat(1000) },
    ]);
    expect(textLength(m)).toBe(2);
  });

  it('returns 0 when parts is missing or not an array', () => {
    expect(textLength({ id: '1', role: 'user' } as unknown as UIMessage)).toBe(0);
    expect(textLength({ id: '1', role: 'user', parts: 'nope' } as unknown as UIMessage)).toBe(0);
  });
});

describe('lib/limits — checkRequestLimits', () => {
  const text = (n: number) =>
    ({ id: Math.random().toString(36).slice(2), role: 'user', parts: [{ type: 'text', text: 'x'.repeat(n) }] } as unknown as UIMessage);
  const limits = { maxMessageChars: 10, maxTotalChars: 25, maxMessages: 3 };

  it('returns null when everything is within budget', () => {
    expect(checkRequestLimits([text(10), text(10)], limits)).toBeNull();
  });

  it('allows exactly the limit, rejects one over (per message)', () => {
    expect(checkRequestLimits([text(10)], limits)).toBeNull();
    expect(checkRequestLimits([text(11)], limits)).toMatchObject({ status: 400 });
  });

  it('rejects an over-long conversation with 413', () => {
    expect(checkRequestLimits([text(9), text(9), text(9)], limits)).toMatchObject({ status: 413 });
  });

  it('rejects too many messages with 413, before measuring characters', () => {
    const v = checkRequestLimits([text(1), text(1), text(1), text(1)], limits);
    expect(v).toMatchObject({ status: 413 });
    expect(v!.error).toContain('too many messages');
  });

  it('does not charge tool output against the budget', () => {
    const big = {
      id: 'a', role: 'assistant',
      parts: [{ type: 'tool-read_file', input: {}, output: 'x'.repeat(10_000) }],
    } as unknown as UIMessage;
    expect(checkRequestLimits([big], limits)).toBeNull();
  });

  it('ships defaults generous enough to paste a source file', () => {
    expect(checkRequestLimits([text(50_000)], DEFAULT_LIMITS)).toBeNull();
  });

  it('accepts an empty conversation', () => {
    expect(checkRequestLimits([], limits)).toBeNull();
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
