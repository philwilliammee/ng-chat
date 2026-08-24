// ModelPreferenceService — the "which model did I pick last time" signal.
//
// No TestBed: the environment is `node`, so `Injector.create` with the service
// as its own provider is how a `providedIn: 'root'` service gets instantiated.
// See README → Testing for what else is reachable.
//
// The subject is small but it has a real seam worth pinning: the signal's initial
// value comes from a FIELD INITIALIZER that reads localStorage, so it is read
// exactly once per instance at construction. Anything that stubs storage after
// the injector resolves the service is testing nothing.
import '@angular/compiler';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector } from '@angular/core';
import { ModelPreferenceService } from './model-preference.service';

const STORAGE_KEY = 'ng-chat:model';

/** Minimal in-memory Storage, installed as the global before construction. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void map.set(k, v)),
    removeItem: vi.fn((k: string) => void map.delete(k)),
    get size() {
      return map.size;
    },
  };
}

/** Construct the service against `storage`, or against no storage at all. */
function create(storage?: ReturnType<typeof fakeStorage>) {
  if (storage) vi.stubGlobal('localStorage', storage);
  const injector = Injector.create({ providers: [{ provide: ModelPreferenceService }] });
  return injector.get(ModelPreferenceService);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('without localStorage', () => {
  beforeEach(() => {
    // node has no localStorage, so this is the default state of the suite and
    // also the real state under SSR and in a sandboxed iframe.
    expect(globalThis.localStorage).toBeUndefined();
  });

  it('starts with no selection instead of throwing', () => {
    // `readFromStorage()` runs inside the field initializer. If its try/catch
    // were removed, constructing the service — which for a root-provided service
    // means the first component that injects it — would throw a ReferenceError
    // and take the whole page down.
    const service = create();

    expect(service.selected()).toBeUndefined();
  });

  it('still tracks a selection in memory', () => {
    // The signal is the source of truth for the UI; persistence is best-effort.
    // Losing storage must not cost the user their current session's choice.
    const service = create();

    service.setModel('claude-sonnet-5');

    expect(service.selected()).toBe('claude-sonnet-5');
  });

  it('swallows the write failure rather than surfacing it', () => {
    const service = create();

    expect(() => service.setModel('gpt-4o')).not.toThrow();
    expect(() => service.setModel(undefined)).not.toThrow();
  });
});

describe('with localStorage', () => {
  it('restores a previously stored model', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: 'gpt-4o' });

    expect(create(storage).selected()).toBe('gpt-4o');
    expect(storage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('normalises a missing key to undefined, not null', () => {
    // `getItem` returns null; the signal's type is `string | undefined`. The
    // `?? undefined` in readFromStorage is what keeps a null out of a template
    // that does `@if (selected())` — harmless — and out of a request body, where
    // a null model is not the same as an absent one.
    const service = create(fakeStorage());

    expect(service.selected()).toBeUndefined();
    expect(service.selected()).not.toBeNull();
  });

  it('persists a selection', () => {
    const storage = fakeStorage();
    const service = create(storage);

    service.setModel('claude-sonnet-5');

    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, 'claude-sonnet-5');
  });

  it('removes the key when the selection is cleared', () => {
    // Not the same as storing an empty string: an empty value would restore as
    // '' next load, which is truthy enough to be sent to the server as a model
    // name. `setModel(undefined)` has to mean "no preference, use the default".
    const storage = fakeStorage({ [STORAGE_KEY]: 'gpt-4o' });
    const service = create(storage);

    service.setModel(undefined);

    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(storage.size).toBe(0);
    expect(service.selected()).toBeUndefined();
  });

  it('round-trips through a fresh instance', () => {
    // The behaviour the service exists for, asserted end to end: set, reload,
    // still there.
    const storage = fakeStorage();
    create(storage).setModel('gpt-4o-mini');

    expect(create(storage).selected()).toBe('gpt-4o-mini');
  });

  it('reads storage once per instance, not on every signal read', () => {
    const storage = fakeStorage({ [STORAGE_KEY]: 'gpt-4o' });
    const service = create(storage);
    storage.getItem.mockClear();

    service.selected();
    service.selected();

    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('does not write on construction', () => {
    // A read-only construction path matters: two tabs open, one idle, and a
    // construction-time write would clobber the other tab's newer choice.
    const storage = fakeStorage();

    create(storage);

    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
