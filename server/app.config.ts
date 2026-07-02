export interface EnvVars {
  PORT?: string;
  GATEWAY_BASE_URL?: string;
  GATEWAY_API_KEY?: string;
  CHAT_MODEL?: string;
  CHAT_CONTEXT_LIMIT?: string;
  MAX_TOOL_ROUNDS?: string;
  SKILLS_DIR?: string;
  THINKING_DEFAULT_LEVEL?: string;
  /** Comma-separated list of allowed model ids (e.g. "gpt-4o-mini,gpt-4o"). Defaults to CHAT_MODEL. */
  ALLOWED_MODELS?: string;
  /** Max requests per IP per window. Set to 0 to disable. Default: 60. */
  RATE_LIMIT_MAX?: string;
  /** Rate limit window in milliseconds. Default: 60000 (1 minute). */
  RATE_LIMIT_WINDOW_MS?: string;
}

const typedEnv = process.env as unknown as EnvVars;

const defaultModel = typedEnv.CHAT_MODEL ?? 'gpt-4o-mini';
const rawAllowedModels = typedEnv.ALLOWED_MODELS;

export const config = {
  port: parseInt(typedEnv.PORT || '4315', 10) || 4315,
  gatewayBaseUrl: typedEnv.GATEWAY_BASE_URL ?? 'https://api.openai.com/v1',
  gatewayApiKey: typedEnv.GATEWAY_API_KEY,
  chatModel: defaultModel,
  contextLimit: parseInt(typedEnv.CHAT_CONTEXT_LIMIT || '200000', 10) || 200_000,
  maxToolRounds: parseInt(typedEnv.MAX_TOOL_ROUNDS || '8', 10) || 8,
  skillsDir: typedEnv.SKILLS_DIR ?? './skills',
  thinkingDefaultLevel: typedEnv.THINKING_DEFAULT_LEVEL ?? 'disabled',
  allowedModels: rawAllowedModels
    ? rawAllowedModels.split(',').map(s => s.trim()).filter(Boolean)
    : [defaultModel],
  rateLimit: {
    maxRequests: parseInt(typedEnv.RATE_LIMIT_MAX || '60', 10),
    windowMs: parseInt(typedEnv.RATE_LIMIT_WINDOW_MS || '60000', 10),
  },
} as const;
