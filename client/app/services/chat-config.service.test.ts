// ChatConfigService — the client's bootstrap fetch of GET /api/chat/config.
//
// A `providedIn: 'root'` service with one dependency, so the pattern is
// `Injector.create` with a fake HttpClient. No HttpTestingController: that lives
// in `@angular/common/http/testing` and expects a TestBed, which needs a DOM.
// A fake with `get()` returning a caller-chosen observable covers the same ground
// and is easier to read.
//
// The behaviour under test is the `loaded` latch. It is right — two components
// injecting this service must not produce two requests — but it is also
// irreversible, and the service has NO error handler, so a failed first load
// latches the service permanently empty. That is asserted below as a defect, not
// as intent.
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
  // `subscribe({ next })` with no `error` callback does not throw at the call
  // site — rxjs routes the error to its global unhandled-error hook, which
  // defaults to rethrowing on a macrotask. In a browser that lands on
  // window.onerror; under Vitest it is an uncaught exception that fails the run
  // even though every assertion passed. So the hook is captured here rather than
  // suppressed, which turns the noise into the assertion: the error genuinely
  // escapes the service.
  // Typed `(err: unknown) => void` rather than a bare `vi.fn()`, which infers a
  // signature rxjs's `((err: any) => void) | null` will not accept.
  let unhandled: ReturnType<typeof vi.fn<(err: unknown) => void>>;
  let original: typeof rxjsConfig.onUnhandledError;

  beforeEach(() => {
    original = rxjsConfig.onUnhandledError;
    unhandled = vi.fn<(err: unknown) => void>();
    rxjsConfig.onUnhandledError = unhandled;
  });

  afterEach(() => {
    rxjsConfig.onUnhandledError = original;
  });

  /** rxjs reports unhandled errors on a macrotask. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('leaves the signals at their defaults when the request fails', async () => {
    const { service } = create(throwError(() => new Error('network')));

    expect(() => service.load()).not.toThrow();
    expect(service.defaultModel()).toBe('');
    expect(service.allowedModels()).toEqual([]);

    await flush();
    // Nothing in the app handles this. The user sees an empty model picker and
    // an error in the console with no context.
    expect(unhandled).toHaveBeenCalledWith(expect.objectContaining({ message: 'network' }));
  });

  it('never retries after a failed load — a found defect', async () => {
    // The latch is set before the request, and nothing ever clears it, so one
    // failed bootstrap fetch leaves the service permanently empty for the life
    // of the page. In practice: a user who loads the app during a brief server
    // restart gets an empty model picker and no way to recover but a reload,
    // with nothing logged to explain it.
    //
    // The fix is small — add an `error` handler that resets `this.loaded = false`
    // (and ideally logs) — but it is a behaviour change, so it belongs in its own
    // commit rather than buried in the change that adds this suite. When that
    // lands, this test should be rewritten to assert the retry.
    let calls = 0;
    const get = vi.fn(() => {
      calls++;
      return throwError(() => new Error('server restarting'));
    });
    const service = Injector.create({
      providers: [{ provide: HttpClient, useValue: { get } }, { provide: ChatConfigService }],
    }).get(ChatConfigService);

    service.load();
    service.load();
    await flush();

    expect(calls).toBe(1);
    expect(service.defaultModel()).toBe('');
  });
});
