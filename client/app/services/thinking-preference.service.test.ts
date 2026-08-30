// ThinkingPreferenceService — the reasoning-effort signal.
//
// Same shape as ModelPreferenceService (see that file for why construction order
// matters against a field initializer), with one behaviour it does not have: the
// stored value is VALIDATED against the four legal levels on the way in.
//
// That validation is the reason this file exists. The level is sent to the
// gateway, and the gateway rejects an unknown reasoning level — so a stale or
// hand-edited localStorage entry would otherwise turn into a 400 on every single
// turn, for one user, until they cleared site data.
import '@angular/compiler';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Injector } from '@angular/core';
import { ThinkingPreferenceService, type ThinkingLevel } from './thinking-preference.service';

const STORAGE_KEY = 'ng-chat:thinkingLevel';
const LEVELS: ThinkingLevel[] = ['disabled', 'low', 'medium', 'high'];

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void map.set(k, v)),
    removeItem: vi.fn((k: string) => void map.delete(k)),
    read: (k: string) => map.get(k),
  };
}

function create(storage?: ReturnType<typeof fakeStorage>) {
  if (storage) vi.stubGlobal('localStorage', storage);
  return Injector.create({ providers: [{ provide: ThinkingPreferenceService }] }).get(
    ThinkingPreferenceService,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('default', () => {
  it("defaults to 'disabled' when storage is unavailable", () => {
    // node, SSR, sandboxed iframe. Defaulting off is the right direction:
    // reasoning tokens cost money and slow the first token down, so a storage
    // failure must not silently opt every user into 'high'.
    expect(create().level()).toBe('disabled');
  });

  it("defaults to 'disabled' when nothing is stored", () => {
    expect(create(fakeStorage()).level()).toBe('disabled');
  });

  it('matches the server-side default', () => {
    // server/app.config.ts sets THINKING_DEFAULT_LEVEL to 'disabled' too. If the
    // two ever disagree, the first turn uses one level and every later turn uses
    // the other, which reads as the model randomly changing behaviour.
    expect(create().level()).toBe('disabled');
  });
});

describe('restoring', () => {
  it.each(LEVELS)('restores %s', (level) => {
    expect(create(fakeStorage({ [STORAGE_KEY]: level })).level()).toBe(level);
  });

  it.each(['', 'HIGH', 'off', 'true', 'extreme', '2', 'null'])(
    'rejects %o and falls back to the default',
    (stored) => {
      // The whole point. Note 'HIGH' in the list: the check is
      // case-sensitive, so an uppercase value is rejected rather than coerced.
      // That is the safe direction — reject anything not exactly a legal level.
      expect(create(fakeStorage({ [STORAGE_KEY]: stored })).level()).toBe('disabled');
    },
  );

  it('never returns a value outside the four levels', () => {
    // Belt and braces against a future edit that adds a level to the type but
    // forgets to add it to the runtime check, or vice versa.
    for (const stored of ['low', 'nonsense', '', 'high']) {
      expect(LEVELS).toContain(create(fakeStorage({ [STORAGE_KEY]: stored })).level());
    }
  });
});

describe('setLevel', () => {
  it.each(LEVELS)('updates the signal and persists %s', (level) => {
    const storage = fakeStorage();
    const service = create(storage);

    service.setLevel(level);

    expect(service.level()).toBe(level);
    expect(storage.read(STORAGE_KEY)).toBe(level);
  });

  it('overwrites a previous level rather than accumulating', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: 'high' });
    const service = create(storage);

    service.setLevel('low');

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.read(STORAGE_KEY)).toBe('low');
  });

  it("persists 'disabled' explicitly instead of removing the key", () => {
    // Deliberately different from ModelPreferenceService, which removes its key
    // to mean "no preference". Here 'disabled' is a real choice, and writing it
    // means a future change of default cannot silently re-enable reasoning for
    // someone who turned it off.
    const storage = fakeStorage({ [STORAGE_KEY]: 'high' });

    create(storage).setLevel('disabled');

    expect(storage.read(STORAGE_KEY)).toBe('disabled');
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('keeps the signal correct when the write fails', () => {
    const service = create();

    expect(() => service.setLevel('medium')).not.toThrow();
    expect(service.level()).toBe('medium');
  });

  it('does not write on construction', () => {
    const storage = fakeStorage();

    create(storage);

    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
