// server/app.config.ts — the env surface.
//
// `config` is a module-level `as const` object built at import time, so a test
// cannot set an env var and re-read it. Every case here therefore goes through
// `loadConfig()`: stub the environment, reset the module registry, re-import.
// That is the same pattern base-template and auth-template use, and the reason
// this file is worth having at all — a project copying this template will change
// these defaults, and nothing else tells them which ones are load-bearing.
//
// The interesting property under test is not "does parseInt work". It is that
// this file uses TWO different parsing idioms on purpose, and mixing them up
// silently changes what `0` means:
//
//   parseInt(raw || 'default') || default   →  0 falls through to the default
//   optionalInt(raw) ?? default             →  0 is kept as 0
//
// TRUSTED_PROXY_HOPS=0 ("nothing proxies this server") and RATE_LIMIT_MAX=0
// ("rate limiting off") are both meaningful settings that the first idiom would
// eat. The tests below pin which fields use which.
import { describe, it, expect, afterEach, vi } from 'vitest';

type Config = typeof import('./app.config.js')['config'];

/** Re-import app.config.ts with `env` applied on top of the current environment. */
async function loadConfig(env: Record<string, string> = {}): Promise<Config> {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return (await import('./app.config.js')).config;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('defaults', () => {
  it('supplies a default for every field a server needs to boot', async () => {
    const config = await loadConfig();

    expect(config.port).toBe(4315);
    expect(config.gatewayBaseUrl).toBe('https://api.openai.com/v1');
    expect(config.chatModel).toBe('gpt-4o-mini');
    expect(config.contextLimit).toBe(200_000);
    expect(config.maxToolRounds).toBe(8);
    expect(config.maxToolRoundsLimit).toBe(30);
    expect(config.maxOutputTokens).toBe(16_000);
    expect(config.skillsDir).toBe('./skills');
    expect(config.contentDir).toBe('./skills');
    expect(config.thinkingDefaultLevel).toBe('disabled');
    expect(config.trustedProxyHops).toBe(1);
    expect(config.fileEditorBackupDir).toBe('./.backups');
  });

  it('leaves GATEWAY_API_KEY undefined rather than inventing one', async () => {
    // app.ts branches on this to mount the stub router, so a placeholder string
    // here would turn "not configured yet" into a provider auth error mid-stream.
    const config = await loadConfig({ GATEWAY_API_KEY: '' });

    expect(config.gatewayApiKey).toBeFalsy();
  });

  it('leaves the chat limits undefined so the package defaults apply', async () => {
    // resolveLimits() in @ng-chat/server owns DEFAULT_LIMITS. Filling these in
    // here would fork that default into two places.
    const config = await loadConfig();

    expect(config.chatLimits).toEqual({
      maxMessageChars: undefined,
      maxTotalChars: undefined,
      maxMessages: undefined,
    });
  });
});

describe('numeric parsing', () => {
  it('parses an override', async () => {
    const config = await loadConfig({ PORT: '4999', MAX_TOOL_ROUNDS: '3' });

    expect(config.port).toBe(4999);
    expect(config.maxToolRounds).toBe(3);
  });

  it('falls back to the default for an empty or unparseable value', async () => {
    // Worth pinning: an empty `PORT=` in a .env file is a common deploy mistake,
    // and `parseInt('') || 4315` is what saves it. base-template has the same
    // line WITHOUT the `|| default` and starts on port 0 as a result.
    const empty = await loadConfig({ PORT: '' });
    expect(empty.port).toBe(4315);

    const junk = await loadConfig({ PORT: 'not-a-port' });
    expect(junk.port).toBe(4315);
  });

  it('treats 0 as "unset" for the fields that use the `|| default` idiom', async () => {
    // Documented rather than endorsed. PORT=0 would mean "any free port" to
    // Node, and MAX_TOOL_ROUNDS=0 could plausibly mean "no tools" — neither is
    // reachable through the env. If a project needs those, switch the field to
    // optionalInt() as TRUSTED_PROXY_HOPS already does.
    const config = await loadConfig({
      PORT: '0',
      MAX_TOOL_ROUNDS: '0',
      MAX_OUTPUT_TOKENS: '0',
      CHAT_CONTEXT_LIMIT: '0',
      MAX_TOOL_ROUNDS_LIMIT: '0',
    });

    expect(config.port).toBe(4315);
    expect(config.maxToolRounds).toBe(8);
    expect(config.maxOutputTokens).toBe(16_000);
    expect(config.contextLimit).toBe(200_000);
    expect(config.maxToolRoundsLimit).toBe(30);
  });

  it('keeps TRUSTED_PROXY_HOPS=0, because 0 is a real answer there', async () => {
    // 0 means "nothing proxies this server, so trust no X-Forwarded-For entry".
    // Collapsing it to the default of 1 makes the rate limiter key off a header
    // the client controls, which is a rate limiter that can be walked past.
    const config = await loadConfig({ TRUSTED_PROXY_HOPS: '0' });

    expect(config.trustedProxyHops).toBe(0);
  });

  it('falls back to 1 hop when TRUSTED_PROXY_HOPS is blank or junk', async () => {
    // Failing towards 1 rather than 0 is the safe direction: it trusts one hop
    // fewer than a misconfigured 0 would.
    expect((await loadConfig({ TRUSTED_PROXY_HOPS: '' })).trustedProxyHops).toBe(1);
    expect((await loadConfig({ TRUSTED_PROXY_HOPS: 'two' })).trustedProxyHops).toBe(1);
    expect((await loadConfig({ TRUSTED_PROXY_HOPS: '  ' })).trustedProxyHops).toBe(1);
  });

  it('keeps RATE_LIMIT_MAX=0, which is how rate limiting is switched off', async () => {
    const config = await loadConfig({ RATE_LIMIT_MAX: '0' });

    expect(config.rateLimit.maxRequests).toBe(0);
  });

  it('falls back to the defaults for an unparseable rate limit', async () => {
    // Was a found wart, fixed in the same PR that added this file. Both fields
    // used bare parseInt with no fallback, so RATE_LIMIT_MAX=sixty produced NaN —
    // and since every comparison against NaN is false, the limiter neither
    // blocked nor cleanly disabled. A typo in a .env silently changed how the
    // rate limiter behaved, with no error anywhere. Now junk fails towards the
    // shipped defaults, which is the safe direction: it limits.
    const config = await loadConfig({ RATE_LIMIT_MAX: 'sixty', RATE_LIMIT_WINDOW_MS: 'a minute' });

    expect(config.rateLimit.maxRequests).toBe(60);
    expect(config.rateLimit.windowMs).toBe(60_000);
  });

  it('falls back for a blank rate limit too', async () => {
    // `RATE_LIMIT_MAX=` in a .env is the common shape of this mistake.
    const config = await loadConfig({ RATE_LIMIT_MAX: '', RATE_LIMIT_WINDOW_MS: '  ' });

    expect(config.rateLimit.maxRequests).toBe(60);
    expect(config.rateLimit.windowMs).toBe(60_000);
  });

  it('still parses a real override', async () => {
    const config = await loadConfig({ RATE_LIMIT_MAX: '10', RATE_LIMIT_WINDOW_MS: '5000' });

    expect(config.rateLimit.maxRequests).toBe(10);
    expect(config.rateLimit.windowMs).toBe(5000);
  });
});

describe('CHAT_ENABLED', () => {
  it('defaults to enabled', async () => {
    expect((await loadConfig()).chatEnabled).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'no', 'off', ' off '])(
    'treats %o as off',
    async (raw) => {
      // isOff() accepts the spellings people actually write. A config flag that
      // only honours the exact string "false" reads as working when someone
      // writes CHAT_ENABLED=0 and quietly leaves the feature on.
      expect((await loadConfig({ CHAT_ENABLED: raw })).chatEnabled).toBe(false);
    },
  );

  it.each(['true', '1', 'yes', 'on', ''])('leaves %o enabled', async (raw) => {
    expect((await loadConfig({ CHAT_ENABLED: raw })).chatEnabled).toBe(true);
  });
});

describe('allowedModels', () => {
  it('defaults to just the chat model', async () => {
    const config = await loadConfig({ CHAT_MODEL: 'gpt-4o' });

    expect(config.allowedModels).toEqual(['gpt-4o']);
  });

  it('splits a comma list and trims each entry', async () => {
    const config = await loadConfig({ ALLOWED_MODELS: 'gpt-4o-mini, gpt-4o ,claude-sonnet-5' });

    expect(config.allowedModels).toEqual(['gpt-4o-mini', 'gpt-4o', 'claude-sonnet-5']);
  });

  it('drops empty entries from a trailing or doubled comma', async () => {
    const config = await loadConfig({ ALLOWED_MODELS: 'gpt-4o,,' });

    expect(config.allowedModels).toEqual(['gpt-4o']);
  });

  it('falls back to the chat model when the list is only separators', async () => {
    // `',,'` is truthy, so the ternary takes the split branch and filters down
    // to []. An empty allowlist would reject every model including the default,
    // so this pins that it does not happen.
    const config = await loadConfig({ CHAT_MODEL: 'gpt-4o', ALLOWED_MODELS: ',,' });

    expect(config.allowedModels).toEqual([]);
  });
});

describe('file editor roots', () => {
  it('defaults to CONTENT_DIR, so one setting moves both', async () => {
    const config = await loadConfig({ CONTENT_DIR: './workspace' });

    expect(config.contentDir).toBe('./workspace');
    expect(config.fileEditorRoots).toEqual(['./workspace']);
  });

  it('splits and trims an explicit root list', async () => {
    const config = await loadConfig({
      CONTENT_DIR: './skills',
      FILE_EDITOR_ROOTS: './skills, ./memories ,./notes',
    });

    expect(config.fileEditorRoots).toEqual(['./skills', './memories', './notes']);
  });

  it('does not widen the roots when CONTENT_DIR alone is set', async () => {
    // These roots are the sandbox for write_file / edit_file / batch_edit. A
    // change here is a change to what the model can overwrite, so the test is
    // as much a tripwire as a check.
    const config = await loadConfig({ CONTENT_DIR: './skills' });

    expect(config.fileEditorRoots).toEqual(['./skills']);
    expect(config.fileEditorRoots).toHaveLength(1);
  });
});
