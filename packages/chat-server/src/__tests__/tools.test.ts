/**
 * Sandbox-boundary tests for the content tools.
 *
 * The case that matters here is the *sibling prefix*: a root of `<tmp>/skills`
 * and a sibling `<tmp>/skills-private`. A bare `startsWith(root)` check treats the
 * sibling as inside the root, so `dir: "../skills-private"` reads files the tool
 * was configured to keep out. These tests pin the boundary rather than the
 * implementation, so they hold whichever helper does the checking.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createSearchFilesTool } from '../tools/search-files.js';
import { createReadFileTool } from '../tools/read-file.js';
import { insideAnyRoot } from '../tools/sandbox.js';

let base: string;
let root: string;
let sibling: string;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'ng-chat-tools-')));
  root = join(base, 'skills');
  sibling = join(base, 'skills-private');
  mkdirSync(join(root, 'nested'), { recursive: true });
  mkdirSync(sibling, { recursive: true });
  writeFileSync(join(root, 'public.md'), 'the needle is here\n');
  writeFileSync(join(root, 'nested', 'deep.md'), 'needle in a nested file\n');
  writeFileSync(join(sibling, 'secret.md'), 'needle in a secret\n');
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

/** `tool()` types execute as optional; every tool here defines it. */
function run(t: unknown, input: Record<string, unknown>) {
  const exec = (t as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute;
  return exec(input, {}) as Promise<Record<string, unknown>>;
}

describe('tools/sandbox — insideAnyRoot', () => {
  it('accepts the root itself and paths under it', () => {
    expect(insideAnyRoot(root, [root])).toBe(true);
    expect(insideAnyRoot(join(root, 'nested', 'deep.md'), [root])).toBe(true);
  });

  it('rejects a sibling whose name merely starts with the root', () => {
    expect(insideAnyRoot(sibling, [root])).toBe(false);
    expect(insideAnyRoot(join(sibling, 'secret.md'), [root])).toBe(false);
  });

  it('rejects a traversal out of the root', () => {
    expect(insideAnyRoot(join(root, '..', 'skills-private'), [root])).toBe(false);
  });
});

describe('tools/search-files — dir boundary', () => {
  it('searches the root and its subdirectories', async () => {
    const res = await run(createSearchFilesTool(root), { query: 'needle' });
    expect(res.error).toBeUndefined();
    const files = (res.matches as Array<{ file: string }>).map(m => m.file).sort();
    expect(files).toEqual(['nested/deep.md', 'public.md']);
  });

  it('accepts a subdirectory of the root', async () => {
    const res = await run(createSearchFilesTool(root), { query: 'needle', dir: 'nested' });
    expect((res.matches as unknown[]).length).toBe(1);
  });

  it('rejects a sibling directory reached by traversal', async () => {
    const res = await run(createSearchFilesTool(root), { query: 'needle', dir: '../skills-private' });
    expect(res.error).toContain('Access denied');
    expect(res.matches).toBeUndefined();
  });

  it('rejects an absolute path outside the root', async () => {
    const res = await run(createSearchFilesTool(root), { query: 'needle', dir: sibling });
    expect(res.error).toContain('Access denied');
  });
});

describe('tools/read-file — path boundary', () => {
  it('reads a file inside the root', async () => {
    const res = await run(createReadFileTool(root), { path: 'public.md' });
    expect(res.error).toBeUndefined();
    expect(String(res.content)).toContain('needle');
  });

  it('rejects a sibling directory reached by traversal', async () => {
    const res = await run(createReadFileTool(root), { path: '../skills-private/secret.md' });
    expect(res.error).toBeTruthy();
    expect(res.content).toBeUndefined();
  });
});
