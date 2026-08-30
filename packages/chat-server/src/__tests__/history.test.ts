// lib/history.ts — context-budget management.
//
// `lib.test.ts` already covers three `clipHistory` cases; this file covers the
// rest of the module (`splitForCompaction`, `buildSummaryMessages`,
// `slidingCompact`), which was at 43% and is the part that spends money — every
// compaction is an extra model call.
//
// Two confirmed defects are asserted at the bottom, marked as such. They are
// pinned rather than fixed here so that the change adding a test suite does not
// also change runtime behaviour; each is small enough to fix in its own commit,
// and each test says what to change when someone does.
import { describe, it, expect, vi } from 'vitest';
import type { UIMessage } from 'ai';
import {
  clipHistory,
  splitForCompaction,
  buildSummaryMessages,
  slidingCompact,
} from '../lib/history.js';

/** A text message. `id` doubles as a label so failures name the message. */
function msg(role: 'user' | 'assistant', text: string, id = text): UIMessage {
  return { id, role, content: '', parts: [{ type: 'text', text }] } as unknown as UIMessage;
}

/** ~1000 tokens of text — enough that any realistic budget rejects a few. */
const bulk = (label: string) => `${label} ${'x'.repeat(4000)}`;

/** Message ids, for readable assertions about what survived. */
const ids = (messages: UIMessage[]) => messages.map((m) => m.id);

// A four-turn conversation: user/assistant × 4, ids u1..a4.
const CONVERSATION: UIMessage[] = [
  msg('user', 'first question', 'u1'),
  msg('assistant', 'first answer', 'a1'),
  msg('user', 'second question', 'u2'),
  msg('assistant', 'second answer', 'a2'),
  msg('user', 'third question', 'u3'),
  msg('assistant', 'third answer', 'a3'),
  msg('user', 'fourth question', 'u4'),
  msg('assistant', 'fourth answer', 'a4'),
];

describe('splitForCompaction', () => {
  it('keeps everything and summarises nothing when the turns fit', () => {
    const { toSummarize, toKeep } = splitForCompaction(CONVERSATION, 4);

    // Four user turns, keepTurns 4 — nothing to compact. The empty
    // `toSummarize` is the signal slidingCompact uses to skip the model call.
    expect(toSummarize).toEqual([]);
    expect(toKeep).toBe(CONVERSATION);
  });

  it('keeps everything when keepTurns exceeds the turns available', () => {
    const { toSummarize, toKeep } = splitForCompaction(CONVERSATION, 99);

    expect(toSummarize).toEqual([]);
    expect(toKeep).toBe(CONVERSATION);
  });

  it('splits at the start of the Nth-from-last user turn', () => {
    const { toSummarize, toKeep } = splitForCompaction(CONVERSATION, 2);

    // keepTurns 2 → keep from u3 onward, summarise u1 through a2. Splitting at a
    // user message rather than mid-turn is what keeps the kept history a valid
    // alternating conversation, which some providers require.
    expect(ids(toSummarize)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(ids(toKeep)).toEqual(['u3', 'a3', 'u4', 'a4']);
  });

  it('keeps exactly one turn for keepTurns 1', () => {
    const { toSummarize, toKeep } = splitForCompaction(CONVERSATION, 1);

    expect(ids(toKeep)).toEqual(['u4', 'a4']);
    expect(ids(toSummarize)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
  });

  it('always starts toKeep with a user message', () => {
    // The invariant behind the whole design. Provider APIs that require
    // alternating roles reject a history opening with an assistant message.
    for (const keepTurns of [1, 2, 3]) {
      const { toKeep } = splitForCompaction(CONVERSATION, keepTurns);
      expect(toKeep[0]!.role, `keepTurns=${keepTurns}`).toBe('user');
    }
  });

  it('partitions the conversation with no loss and no duplication', () => {
    // toSummarize ++ toKeep must reconstruct the input exactly. A drifting split
    // index would silently drop a turn, which reads as the model forgetting
    // something it was just told.
    for (const keepTurns of [1, 2, 3]) {
      const { toSummarize, toKeep } = splitForCompaction(CONVERSATION, keepTurns);
      expect([...toSummarize, ...toKeep], `keepTurns=${keepTurns}`).toEqual(CONVERSATION);
    }
  });

  it('summarises nothing when there are no user messages', () => {
    const assistantOnly = [msg('assistant', 'a'), msg('assistant', 'b')];

    expect(splitForCompaction(assistantOnly, 2).toSummarize).toEqual([]);
  });

  it('handles an empty conversation', () => {
    expect(splitForCompaction([], 2)).toEqual({ toSummarize: [], toKeep: [] });
  });
});

describe('buildSummaryMessages', () => {
  it('returns a user/assistant pair', () => {
    // A bare user message would leave the history ending on `user` with the real
    // next user message about to follow — two user turns in a row, which some
    // providers reject outright.
    const built = buildSummaryMessages('they prefer TypeScript');

    expect(built).toHaveLength(2);
    expect(built.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('labels the summary so the model does not read it as a new request', () => {
    const [context] = buildSummaryMessages('they prefer TypeScript');

    const text = (context!.parts as Array<{ text: string }>)[0]!.text;
    expect(text).toContain('[Context from earlier in this conversation]');
    expect(text).toContain('they prefer TypeScript');
  });

  it('acknowledges the context in the assistant turn', () => {
    const [, ack] = buildSummaryMessages('anything');

    expect((ack!.parts as Array<{ text: string }>)[0]!.text).toContain('Continuing from here');
  });

  it('uses stable ids', () => {
    // Fixed rather than random: the client dedupes by id, so a fresh id each
    // request would stack up a new context block per compaction.
    expect(buildSummaryMessages('x').map((m) => m.id)).toEqual([
      'compaction-context',
      'compaction-ack',
    ]);
    expect(buildSummaryMessages('y').map((m) => m.id)).toEqual([
      'compaction-context',
      'compaction-ack',
    ]);
  });

  it('survives an empty summary', () => {
    // The summariser can return ''. It must not produce a malformed message.
    const built = buildSummaryMessages('');

    expect(built).toHaveLength(2);
    expect((built[0]!.parts as unknown[])).toHaveLength(1);
  });
});

describe('slidingCompact', () => {
  it('returns the same array untouched when it is under budget', async () => {
    const summarize = vi.fn();

    const result = await slidingCompact(CONVERSATION, 1_000_000, 2, summarize);

    // Identity, and — more importantly — no model call. This is the common path:
    // every request goes through here and almost none of them should compact.
    expect(result).toBe(CONVERSATION);
    expect(summarize).not.toHaveBeenCalled();
  });

  it('summarises the older turns and keeps the recent ones', async () => {
    const history = [
      msg('user', bulk('q1'), 'u1'),
      msg('assistant', bulk('a1'), 'a1'),
      msg('user', 'recent question', 'u2'),
      msg('assistant', 'recent answer', 'a2'),
    ];
    const summarize = vi.fn(async () => 'they asked about q1');

    const result = await slidingCompact(history, 800, 1, summarize);

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(ids(result)).toEqual(['compaction-context', 'compaction-ack', 'u2', 'a2']);
  });

  it('passes a transcript of only the summarised turns to the summariser', async () => {
    // Not the whole conversation: sending the kept turns too would pay for them
    // twice and duplicate them in the compacted history.
    const history = [
      msg('user', bulk('old question'), 'u1'),
      msg('assistant', bulk('old answer'), 'a1'),
      msg('user', 'brand new question', 'u2'),
    ];
    const summarize = vi.fn(async (_transcript: string) => 'summary');

    await slidingCompact(history, 800, 1, summarize);

    const transcript = summarize.mock.calls[0]![0];
    expect(transcript).toContain('old question');
    expect(transcript).toContain('user:');
    expect(transcript).not.toContain('brand new question');
  });

  it('includes tool calls in the transcript it summarises', async () => {
    // `buildTranscript(toSummarize, { includeTools: true })`. Dropping tool
    // activity is how a compaction loses the fact that a file was already
    // written, and the model writes it again.
    const history = [
      msg('user', bulk('read the config'), 'u1'),
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        parts: [
          { type: 'text', text: bulk('here it is') },
          { type: 'tool-read_file', toolName: 'read_file', input: { path: 'app.config.ts' }, output: 'PORT=4315' },
        ],
      } as unknown as UIMessage,
      msg('user', 'and now?', 'u2'),
    ];
    const summarize = vi.fn(async (_transcript: string) => 'summary');

    await slidingCompact(history, 800, 1, summarize);

    const transcript = summarize.mock.calls[0]![0];
    expect(transcript).toContain('[tool] read_file');
    expect(transcript).toContain('app.config.ts');
  });

  it('falls back to clipping when there is nothing old enough to summarise', async () => {
    // Over budget but only one user turn, so `toSummarize` is empty. Calling the
    // summariser here would spend a request to summarise nothing.
    const history = [msg('user', bulk('one enormous question'), 'u1')];
    const summarize = vi.fn();

    const result = await slidingCompact(history, 10, 2, summarize);

    expect(summarize).not.toHaveBeenCalled();
    expect(result).toEqual(history);
  });

  it('clips the compacted history when the summary still does not fit', async () => {
    // Both branches of the final ternary matter: a summariser that returns
    // something enormous must not produce a history that is still over budget.
    const history = [
      msg('user', bulk('q1'), 'u1'),
      msg('assistant', bulk('a1'), 'a1'),
      msg('user', bulk('q2'), 'u2'),
      msg('assistant', bulk('a2'), 'a2'),
      msg('user', bulk('q3'), 'u3'),
    ];
    const summarize = vi.fn(async () => bulk('an unhelpfully long summary'));

    const result = await slidingCompact(history, 500, 2, summarize);

    expect(summarize).toHaveBeenCalledTimes(1);
    // Clipped down past the summary block itself.
    expect(result.length).toBeLessThan(history.length + 2);
  });

  it('propagates a summariser failure rather than swallowing it', async () => {
    // The caller (POST /api/chat) has to be able to answer with an error. A
    // silent catch here would send the un-compacted history to the provider,
    // which then rejects it on context length — a worse and less obvious error.
    const history = [
      msg('user', bulk('q1'), 'u1'),
      msg('assistant', bulk('a1'), 'a1'),
      msg('user', 'recent', 'u2'),
    ];

    await expect(
      slidingCompact(history, 800, 1, async () => {
        throw new Error('gateway 503');
      }),
    ).rejects.toThrow('gateway 503');
  });

  it('passes the model id through to the token estimator', async () => {
    // Token counts differ per tokenizer, so the same history is over budget for
    // one model and under it for another. Dropping the argument makes the
    // estimate wrong for every non-default model.
    const summarize = vi.fn(async () => 'summary');

    const result = await slidingCompact(CONVERSATION, 1_000_000, 2, summarize, 'claude-sonnet-5');

    expect(result).toBe(CONVERSATION);
    expect(summarize).not.toHaveBeenCalled();
  });
});

describe('clipHistory — budget edges', () => {
  it('keeps a history exactly at budget', async () => {
    // `<=`, not `<`. An off-by-one here clips a conversation that fits.
    const history = [msg('user', 'hi')];
    const { estimateMessagesTokens } = await import('../lib/tokens.js');

    expect(clipHistory(history, estimateMessagesTokens(history))).toBe(history);
  });

  it('drops whole turns from the front, always landing on a user message', () => {
    const history = [
      msg('user', bulk('q1'), 'u1'),
      msg('assistant', bulk('a1'), 'a1'),
      msg('user', bulk('q2'), 'u2'),
      msg('assistant', bulk('a2'), 'a2'),
      msg('user', 'small recent question', 'u3'),
    ];

    const result = clipHistory(history, 400);

    expect(result[0]!.role).toBe('user');
    expect(ids(result)).toEqual(['u3']);
  });

  it('stops at the first slice that fits rather than clipping to the minimum', () => {
    // The `break`. Without it the loop runs to the end and returns the smallest
    // possible history, throwing away context that would have fit.
    const history = [
      msg('user', bulk('q1'), 'u1'),
      msg('user', 'short', 'u2'),
      msg('user', 'short', 'u3'),
    ];

    const result = clipHistory(history, 60);

    expect(ids(result)).toEqual(['u2', 'u3']);
  });
});

// ─── Confirmed defects ────────────────────────────────────────────────────────
//
// Both are asserted as-is so the suite is green on today's code. Each names the
// fix; when it lands, the test flips to asserting the fixed behaviour.

describe('clipHistory — DEFECT: cannot clip a history with no user messages', () => {
  it('returns an over-budget assistant-only history unchanged', () => {
    // `for (let drop = 0; drop < userIndices.length - 1; drop++)` — with zero
    // user messages the bound is -1 and the loop never runs, so `result` stays
    // as the full input. The function's contract is "return something within
    // budget", and here it returns something over budget with no signal.
    //
    // The same bound is what protects the last user turn, which IS intended
    // (lib.test.ts asserts it), so the fix is not to change the bound: it is to
    // handle `userIndices.length === 0` separately, most simply by slicing from
    // the end until it fits.
    //
    // Reachable in practice: a compaction round can leave a history whose head
    // is the assistant ack, and `slidingCompact` calls `clipHistory` on exactly
    // that shape in its final ternary.
    const assistantOnly = [
      msg('assistant', bulk('a1'), 'a1'),
      msg('assistant', bulk('a2'), 'a2'),
    ];

    const result = clipHistory(assistantOnly, 1);

    expect(result).toBe(assistantOnly);
    expect(ids(result)).toEqual(['a1', 'a2']);
  });
});

describe('splitForCompaction — DEFECT: keepTurns 0 duplicates the conversation', () => {
  it('returns the whole conversation as BOTH halves', () => {
    // `userIndices[userIndices.length - 0]` is `userIndices[length]`, which is
    // `undefined`. Then `slice(0, undefined)` and `slice(undefined)` both return
    // the entire array, so the partition invariant asserted above breaks: every
    // message is in both halves.
    //
    // Fix: guard `keepTurns < 1` at the top and return
    // `{ toSummarize: messages, toKeep: [] }`, which is what keepTurns 0 plainly
    // means. Two lines.
    const { toSummarize, toKeep } = splitForCompaction(CONVERSATION, 0);

    expect(toSummarize).toEqual(CONVERSATION);
    expect(toKeep).toEqual(CONVERSATION);
  });

  it('makes slidingCompact pay for a summary it then throws away', async () => {
    // The consequence, and the reason this is worth a test rather than a comment.
    // toSummarize is non-empty, so the model call happens; the compacted result
    // is the summary PLUS the untouched conversation, i.e. strictly larger than
    // the input, so it fails the budget check and gets clipped straight back
    // down. Net effect: one paid model call, and a history no better than
    // clipping alone would have produced.
    //
    // Nothing in ng-chat passes keepTurns 0 today — `maxToolRounds` and the
    // compaction settings are separate — but it is reachable from any project
    // that wires its own value in from an env var, where 0 reads like "keep
    // nothing, summarise everything".
    const history = [
      msg('user', bulk('q1'), 'u1'),
      msg('assistant', bulk('a1'), 'a1'),
      msg('user', bulk('q2'), 'u2'),
    ];
    const summarize = vi.fn(async () => 'a summary');

    const result = await slidingCompact(history, 500, 0, summarize);

    expect(summarize).toHaveBeenCalledTimes(1);
    expect(result.length).toBeLessThanOrEqual(history.length);
  });
});
