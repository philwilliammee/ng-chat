// lib/skill-suggest.ts — the keyword nudge.
//
// This file had 0% coverage. It is worth having tests for a reason that is not
// obvious from its size: its output is prepended to the per-request system
// prompt, so a scoring change silently changes what the model is told on every
// turn, and there is no failing request to notice. The tests below pin the
// scoring rules the doc comment claims, so a "small tidy-up" of the loop shows
// up as a red test rather than as the assistant quietly stopping using a skill.
import { describe, it, expect } from 'vitest';
import { suggestSkills, extractLastUserText } from '../lib/skill-suggest.js';

const SKILLS = ['memory', 'close', 'greeting', 'code-review', 'jira_ticket'];

describe('suggestSkills — matching', () => {
  it('matches a skill named in the message', () => {
    expect(suggestSkills('check your memory for my preferences', SKILLS)).toEqual(['memory']);
  });

  it('is case-insensitive on both sides', () => {
    // The message is lowercased and so is the skill name, so a skill file called
    // `Code-Review.md` still matches "code review" in a sentence.
    expect(suggestSkills('CHECK YOUR MEMORY', SKILLS)).toEqual(['memory']);
    expect(suggestSkills('memory', ['MEMORY'])).toEqual(['MEMORY']);
  });

  it('returns the skill name exactly as given, not the lowercased form', () => {
    // The result is used to load a file by name, so casing has to survive.
    expect(suggestSkills('run a Code-Review please', ['Code-Review'])).toEqual(['Code-Review']);
  });

  it('splits skill names on hyphens and underscores', () => {
    // `code-review` should match a message that says "review" without saying
    // "code" — this is the whole reason for the split.
    expect(suggestSkills('please review this function', SKILLS)).toEqual(['code-review']);
    expect(suggestSkills('open a ticket', SKILLS)).toEqual(['jira_ticket']);
  });

  it('matches on substrings, not word boundaries', () => {
    // Documented rather than praised: "memorywise" matches `memory`. Loose
    // matching is the right trade for a hint that only nudges the model, but if
    // this ever becomes a hard gate on which skills load, it needs tightening.
    expect(suggestSkills('memorywise I forget things', SKILLS)).toEqual(['memory']);
  });

  it('ignores keywords shorter than three characters', () => {
    // The guard that stops `a11y-ui` matching every message containing "ui", and
    // the reason a two-letter skill name can never be suggested at all.
    expect(suggestSkills('what is up', ['up', 'go', 'ui'])).toEqual([]);
  });

  it('scores a three-character keyword, the boundary case', () => {
    expect(suggestSkills('please add a log line', ['log'])).toEqual(['log']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(suggestSkills('what is the weather in Ithaca', SKILLS)).toEqual([]);
  });
});

describe('suggestSkills — ranking', () => {
  it('ranks by summed keyword length, so longer matches win', () => {
    // The doc comment's claim: "Longer exact matches win over short common
    // substrings." `greeting` (8) outscores `close` (5).
    const result = suggestSkills('close the greeting', ['close', 'greeting']);

    expect(result).toEqual(['greeting', 'close']);
  });

  it('adds up multiple matched keywords in one skill name', () => {
    // `code-review` matches both halves for 10, beating `greeting` at 8.
    const result = suggestSkills('code review the greeting', ['greeting', 'code-review']);

    expect(result).toEqual(['code-review', 'greeting']);
  });

  it('counts a keyword once however many times it appears', () => {
    // `includes` is a boolean, so repetition does not inflate the score. Worth
    // pinning: a message that says "memory" five times must not outrank a more
    // specific skill.
    const spammed = suggestSkills('memory memory memory memory', ['memory', 'code-review']);
    const specific = suggestSkills('memory code review', ['memory', 'code-review']);

    expect(spammed).toEqual(['memory']);
    expect(specific).toEqual(['code-review', 'memory']);
  });

  it('defaults to at most three suggestions', () => {
    const many = ['memory', 'greeting', 'close', 'search', 'summary'];

    const result = suggestSkills('memory greeting close search summary', many);

    // The cap keeps the prompt prefix to one short line. Raising it costs input
    // tokens on every single request.
    expect(result).toHaveLength(3);
  });

  it('honours an explicit topN', () => {
    expect(suggestSkills('memory greeting close', SKILLS, 1)).toHaveLength(1);
    expect(suggestSkills('memory greeting close', SKILLS, 10)).toHaveLength(3);
  });

  it('returns nothing for topN of 0', () => {
    expect(suggestSkills('memory', SKILLS, 0)).toEqual([]);
  });
});

describe('suggestSkills — empty input', () => {
  it.each(['', '   ', '\n\t '])('returns [] for whitespace-only text (%o)', (text) => {
    // The early return matters: without it, a keyword could not match anyway,
    // but the loop would run over every skill on every empty turn.
    expect(suggestSkills(text, SKILLS)).toEqual([]);
  });

  it('returns [] when no skills are available', () => {
    // The state of a fresh project with an empty skills/ directory.
    expect(suggestSkills('check your memory', [])).toEqual([]);
  });
});

describe('extractLastUserText', () => {
  const text = (t: string) => ({ type: 'text', text: t });

  it('reads the text parts of the last user message', () => {
    const messages = [
      { role: 'user', parts: [text('first question')] },
      { role: 'assistant', parts: [text('answer')] },
      { role: 'user', parts: [text('second question')] },
    ];

    expect(extractLastUserText(messages)).toBe('second question');
  });

  it('joins multiple text parts with a space', () => {
    const messages = [{ role: 'user', parts: [text('hello'), text('world')] }];

    expect(extractLastUserText(messages)).toBe('hello world');
  });

  it('skips a trailing assistant message', () => {
    // The call site runs before the model replies, but a compaction round can
    // leave an assistant message last.
    const messages = [
      { role: 'user', parts: [text('the question')] },
      { role: 'assistant', parts: [text('the answer')] },
    ];

    expect(extractLastUserText(messages)).toBe('the question');
  });

  it('does not mutate the caller\'s array', () => {
    // `[...messages].reverse()`, not `messages.reverse()`. Getting this wrong
    // would reverse the live conversation on its way to the provider — the model
    // would answer the first message instead of the last, on every request.
    const messages = [
      { role: 'user', parts: [text('one')] },
      { role: 'assistant', parts: [text('two')] },
    ];
    const before = [...messages];

    extractLastUserText(messages);

    expect(messages).toEqual(before);
    expect(messages[0]!.role).toBe('user');
  });

  it('ignores non-text parts', () => {
    // Files, tool calls and reasoning blocks are all parts. Stringifying a file
    // part into the keyword text would match skills on a filename.
    const messages = [
      {
        role: 'user',
        parts: [
          { type: 'file', mediaType: 'image/png', url: 'memory.png' },
          text('what is this'),
          { type: 'tool-read_file', input: { path: 'greeting.md' } },
        ],
      },
    ];

    expect(extractLastUserText(messages)).toBe('what is this');
  });

  it('ignores a text part whose text is not a string', () => {
    const messages = [{ role: 'user', parts: [{ type: 'text', text: 42 }, text('real')] }];

    expect(extractLastUserText(messages)).toBe('real');
  });

  it('returns "" when there is no user message', () => {
    expect(extractLastUserText([{ role: 'assistant', parts: [text('hi')] }])).toBe('');
  });

  it('returns "" for an empty conversation', () => {
    expect(extractLastUserText([])).toBe('');
  });

  it.each([
    ['parts missing', { role: 'user' }],
    ['parts null', { role: 'user', parts: null }],
    ['parts not an array', { role: 'user', parts: 'hello' }],
    ['parts empty', { role: 'user', parts: [] }],
  ])('returns "" when %s', (_label, message) => {
    // Defensive, and reached in practice: a compaction placeholder message can
    // arrive with no parts, and this runs on every request before validation.
    expect(extractLastUserText([message as never])).toBe('');
  });

  it('feeds suggestSkills end to end', () => {
    // The two functions are only ever used together, so one case wires them up.
    const messages = [
      { role: 'assistant', parts: [text('anything to note?')] },
      { role: 'user', parts: [text('save this to memory please')] },
    ];

    expect(suggestSkills(extractLastUserText(messages), SKILLS)).toEqual(['memory']);
  });
});
