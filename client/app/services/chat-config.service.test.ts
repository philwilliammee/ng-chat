// ChatConfigService — the client's bootstrap fetch of GET /api/chat/config.
//
// A `providedIn: 'root'` service with one dependency, so the pattern is
// `Injector.create` with a fake HttpClient. No HttpTestingController: that lives
// in `@angular/common/http/testing` and expects a TestBed, which needs a DOM.
// A fake with `get()` returning a caller-chosen observable covers the same ground
// and is easier to read.
//
// The behaviour under test is the `loaded` latch, which has to hold two things at
// once: two components injecting this service must not produce two requests, and a
// first load that fails must not leave the service permanently empty. It used to
// do only the first — the latch was irreversible and there was no error handler at
// all. Both halves are asserted below, since a fix to either can break the other.
import '@angular/compiler';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { of, throwError, Subject, config as rxjsConfig } from 'rxjs';
import { ChatConfigService } from './chat-config.service';

const CONFIG = {
  model: 'gpt-4o-mini',
  contextLimit: 200_000,
  allowedModels: ['gpt-4o-mini', 'gpt-4o'],
  tools: ['use_skill', 'get_time'],
};

/** Build the service against an HttpClient whose `get` returns `response`. */
function create(response: unknown = of(CONFIG)) {
  const get = vi.fn(() => response);
  const injector = Injector.create({
    providers: [{ provide: HttpClient, useValue: { get } }, { provide: ChatConfigService }],
  });
  return { service: injector.get(ChatConfigService), get };
}

describe('initial state', () => {
  it('starts empty and issues no request until load() is called', () => {
    // Construction must not fetch. This service is injected by components, and a
    // fetch in the constructor would fire on first render with no way to control
    // when — including during SSR, where there is no origin to resolve against.
    const { service, get } = create();

    expect(service.defaultModel()).toBe('');
    expect(service.allowedModels()).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('load()', () => {
  it('fetches /config under the default api base', () => {
    const { service, get } = create();

    service.load();

    expect(get).toHaveBeenCalledWith('/api/chat/config');
  });

  it('respects an explicit api base', () => {
    // The server mounts the router at /api/chat, but a project embedding ng-chat
    // behind a path prefix passes its own base. The template has to append
    // '/config' to it, not replace it.
    const { service, get } = create();

    service.load('/embedded/chat');

    expect(get).toHaveBeenCalledWith('/embedded/chat/config');
  });

  it('populates both signals from the response', () => {
    const { service } = create();

    service.load();

    expect(service.defaultModel()).toBe('gpt-4o-mini');
    expect(service.allowedModels()).toEqual(['gpt-4o-mini', 'gpt-4o']);
  });

  it('falls back to a single-model list when allowedModels is absent', () => {
    // `?? [cfg.model]`. An empty allowedModels would leave the model picker with
    // nothing selectable even though the server would happily accept the default.
    const { service } = create(of({ ...CONFIG, allowedModels: undefined }));

    service.load();

    expect(service.allowedModels()).toEqual(['gpt-4o-mini']);
  });

  it('honours an explicitly empty allowedModels', () => {
    // `??` not `||`, so `[]` is kept rather than replaced. That matters: a server
    // that reports no allowed models is making a statement, and turning it into
    // a one-item list would offer the user a model the server may reject.
    const { service } = create(of({ ...CONFIG, allowedModels: [] }));

    service.load();

    expect(service.allowedModels()).toEqual([]);
  });
});

describe('the loaded latch', () => {
  it('issues exactly one request across repeated calls', () => {
    // The reason the latch exists. app.config.ts calls load() from an
    // APP_INITIALIZER, and components call it too; without the guard every
    // navigation would re-fetch.
    const { service, get } = create();

    service.load();
    service.load();
    service.load('/some/other/base');

    expect(get).toHaveBeenCalledTimes(1);
  });

  it('latches before the response arrives, so concurrent calls do not race', () => {
    // `this.loaded = true` runs before `.subscribe()`, so two synchronous callers
    // in the same tick still produce one request. Setting it in the `next`
    // handler instead would let both through.
    const pending = new Subject();
    const { service, get } = create(pending);

    service.load();
    service.load();

    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('failure handling', () => {
  // The service now has an `error` handler, so nothing reaches rxjs's global
  // unhandled-error hook. The hook is still captured here, and asserted NOT to
  // fire: without a handler rxjs rethrows on a macrotask, which is window.onerror
  // in a browser and an uncaught exception that fails the run under Vitest even
  // when every assertion passes. That is the regression this guards against.
  //
  // Typed `(err: unknown) => void` rather than a bare `vi.fn()`, which infers a
  // signature rxjs's `((err: any) => void) | null` will not accept.
  let unhandled: ReturnType<typeof vi.fn<(err: unknown) => void>>;
  let original: typeof rxjsConfig.onUnhandledError;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    original = rxjsConfig.onUnhandledError;
    unhandled = vi.fn<(err: unknown) => void>();
    rxjsConfig.onUnhandledError = unhandled;
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rxjsConfig.onUnhandledError = original;
    error.mockRestore();
  });

  /** rxjs reports unhandled errors on a macrotask. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('leaves the signals at their defaults when the request fails', async () => {
    const { service } = create(throwError(() => new Error('network')));

    expect(() => service.load()).not.toThrow();
    expect(service.defaultModel()).toBe('');
    expect(service.allowedModels()).toEqual([]);

    await flush();
    // Handled, not escaping. A chat surface with an empty model picker is a
    // degraded state the caller can recover from; an uncaught error is not.
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('says which URL failed, so the reason is not silent', async () => {
    // The failure is otherwise invisible: signals stay at their defaults and the
    // picker is simply empty. The base URL is included because `load()` takes one
    // — an embedded host passing `/embedded/chat` needs to know which it was.
    const { service } = create(throwError(() => new Error('network')));

    service.load('/embedded/chat');
    await flush();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('/embedded/chat/config'),
      expect.objectContaining({ message: 'network' }),
    );
  });

  it('releases the latch so a later call retries', async () => {
    // Was a found defect, fixed in the same PR: the latch is set before the
    // request (so two synchronous callers still make one) but released on error,
    // so a user who loads the app during a brief server restart is not stuck with
    // an empty picker for the life of the page.
    let calls = 0;
    const get = vi.fn(() => {
      calls++;
      return throwError(() => new Error('server restarting'));
    });
    const service = Injector.create({
      providers: [{ provide: HttpClient, useValue: { get } }, { provide: ChatConfigService }],
    }).get(ChatConfigService);

    service.load();
    await flush();
    service.load();
    await flush();

    expect(calls).toBe(2);
  });

  it('still coalesces synchronous callers while a request is in flight', async () => {
    // The other half of the contract, and the part the fix could plausibly break:
    // releasing the latch must not turn every APP_INITIALIZER + component pair
    // into two requests. The latch is only released once the error arrives.
    const pending = new Subject();
    const { service, get } = create(pending);

    service.load();
    service.load();

    expect(get).toHaveBeenCalledTimes(1);

    pending.error(new Error('too late'));
    await flush();

    // And once it has failed, the next call is allowed through.
    service.load();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('recovers with real config on the retry', async () => {
    // End to end: fail, then succeed. This is the user-visible payoff — the
    // picker fills in without a page reload.
    let attempt = 0;
    const get = vi.fn(() => {
      attempt++;
      return attempt === 1
        ? throwError(() => new Error('server restarting'))
        : of({ model: 'gpt-4o-mini', contextLimit: 200_000, allowedModels: ['gpt-4o-mini'], tools: [] });
    });
    const service = Injector.create({
      providers: [{ provide: HttpClient, useValue: { get } }, { provide: ChatConfigService }],
    }).get(ChatConfigService);

    service.load();
    await flush();
    service.load();
    await flush();

    expect(service.defaultModel()).toBe('gpt-4o-mini');
    expect(service.allowedModels()).toEqual(['gpt-4o-mini']);
  });
});
