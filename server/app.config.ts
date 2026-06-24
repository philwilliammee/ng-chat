export interface EnvVars {
  PORT?: string;
  GATEWAY_BASE_URL?: string;
  GATEWAY_API_KEY?: string;
  CHAT_MODEL?: string;
  CHAT_CONTEXT_LIMIT?: string;
  MAX_TOOL_ROUNDS?: string;
  SKILLS_DIR?: string;
}

const typedEnv = process.env as unknown as EnvVars;

export const config = {
  port: Number(typedEnv.PORT ?? 4315),
  gatewayBaseUrl: typedEnv.GATEWAY_BASE_URL ?? 'https://api.ai.it.cornell.edu/v1',
  gatewayApiKey: typedEnv.GATEWAY_API_KEY,
  chatModel: typedEnv.CHAT_MODEL ?? 'anthropic.claude-3-7-sonnet',
  contextLimit: Number(typedEnv.CHAT_CONTEXT_LIMIT ?? 200_000),
  maxToolRounds: Number(typedEnv.MAX_TOOL_ROUNDS ?? 8),
  skillsDir: typedEnv.SKILLS_DIR ?? './skills',
} as const;
