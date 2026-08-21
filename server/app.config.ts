export interface EnvVars {
  PORT?: string;
  GATEWAY_BASE_URL?: string;
  GATEWAY_API_KEY?: string;
  CHAT_MODEL?: string;
  CHAT_CONTEXT_LIMIT?: string;
  MAX_TOOL_ROUNDS?: string;
  /** Hard ceiling for per-request maxToolRounds override. Default: 30. */
  MAX_TOOL_ROUNDS_LIMIT?: string;
  /** Max output tokens per model call. Default: 16000. */
  MAX_OUTPUT_TOKENS?: string;
  SKILLS_DIR?: string;
  THINKING_DEFAULT_LEVEL?: string;
  /** Comma-separated list of allowed model ids (e.g. "gpt-4o-mini,gpt-4o"). Defaults to CHAT_MODEL. */
  ALLOWED_MODELS?: string;
  /** Max requests per IP per window. Set to 0 to disable. Default: 60. */
  RATE_LIMIT_MAX?: string;
  /** Rate limit window in milliseconds. Default: 60000 (1 minute). */
  RATE_LIMIT_WINDOW_MS?: string;
  /**
   * Reverse proxies you control in front of this server, used to pick a
   * non-forgeable entry out of X-Forwarded-For when keying the rate limiter.
   * Default: 1. Set 0 when nothing proxies this server.
   */
  TRUSTED_PROXY_HOPS?: string;
  /** Set to "false" to mount the stub chat router and switch the feature off. */
  CHAT_ENABLED?: string;
  /** Max characters of text in one message. Default: 100000. */
  CHAT_MAX_MESSAGE_CHARS?: string;
  /** Max characters of text across the conversation. Default: 1000000. */
  CHAT_MAX_TOTAL_CHARS?: string;
  /** Max messages in the conversation. Default: 500. */
  CHAT_MAX_MESSAGES?: string;
  /** Root directory for read_file / search_files / write_file tools. Default: ./skills */
  CONTENT_DIR?: string;
  /** Comma-separated allowed roots for file-editor tools. Defaults to CONTENT_DIR. */
  FILE_EDITOR_ROOTS?: string;
  /** Directory for batch_edit/rollback backups. Default: ./.backups */
  FILE_EDITOR_BACKUP_DIR?: string;
}

const typedEnv = process.env as unknown as EnvVars;

const defaultModel = typedEnv.CHAT_MODEL ?? 'gpt-4o-mini';
const rawAllowedModels = typedEnv.ALLOWED_MODELS;
const contentDir = typedEnv.CONTENT_DIR ?? './skills';

/**
 * Parse an optional integer, leaving it `undefined` when unset or unparseable so
 * the consuming default applies. Deliberately not the `parseInt(x || 'd') || d`
 * idiom used above: that turns a legitimate `0` into the default, which matters
 * for TRUSTED_PROXY_HOPS where 0 is a meaningful setting.
 */
function optionalInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Unset keys stay `undefined`; `resolveLimits` falls those through to DEFAULT_LIMITS. */
const chatLimits = {
  maxMessageChars: optionalInt(typedEnv.CHAT_MAX_MESSAGE_CHARS),
  maxTotalChars: optionalInt(typedEnv.CHAT_MAX_TOTAL_CHARS),
  maxMessages: optionalInt(typedEnv.CHAT_MAX_MESSAGES),
};

/** Accepts the spellings people actually write, not just the exact string `false`. */
function isOff(raw: string | undefined): boolean {
  return raw !== undefined && ['false', '0', 'no', 'off'].includes(raw.trim().toLowerCase());
}

export const config = {
  port: parseInt(typedEnv.PORT || '4315', 10) || 4315,
  gatewayBaseUrl: typedEnv.GATEWAY_BASE_URL ?? 'https://api.openai.com/v1',
  gatewayApiKey: typedEnv.GATEWAY_API_KEY,
  chatModel: defaultModel,
  contextLimit: parseInt(typedEnv.CHAT_CONTEXT_LIMIT || '200000', 10) || 200_000,
  maxToolRounds: parseInt(typedEnv.MAX_TOOL_ROUNDS || '8', 10) || 8,
  maxToolRoundsLimit: parseInt(typedEnv.MAX_TOOL_ROUNDS_LIMIT || '30', 10) || 30,
  maxOutputTokens: parseInt(typedEnv.MAX_OUTPUT_TOKENS || '16000', 10) || 16_000,
  skillsDir: typedEnv.SKILLS_DIR ?? './skills',
  contentDir,
  thinkingDefaultLevel: typedEnv.THINKING_DEFAULT_LEVEL ?? 'disabled',
  allowedModels: rawAllowedModels
    ? rawAllowedModels.split(',').map(s => s.trim()).filter(Boolean)
    : [defaultModel],
  rateLimit: {
    maxRequests: parseInt(typedEnv.RATE_LIMIT_MAX || '60', 10),
    windowMs: parseInt(typedEnv.RATE_LIMIT_WINDOW_MS || '60000', 10),
  },
  trustedProxyHops: optionalInt(typedEnv.TRUSTED_PROXY_HOPS) ?? 1,
  chatEnabled: !isOff(typedEnv.CHAT_ENABLED),
  chatLimits,
  fileEditorRoots: typedEnv.FILE_EDITOR_ROOTS
    ? typedEnv.FILE_EDITOR_ROOTS.split(',').map(s => s.trim()).filter(Boolean)
    : [contentDir],
  fileEditorBackupDir: typedEnv.FILE_EDITOR_BACKUP_DIR ?? './.backups',
} as const;
