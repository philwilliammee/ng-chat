export interface EnvVars {
  PORT?: string;
  GATEWAY_BASE_URL?: string;
  GATEWAY_API_KEY?: string;
  CHAT_MODEL?: string;
  CHAT_CONTEXT_LIMIT?: string;
  MAX_TOOL_ROUNDS?: string;
  SKILLS_DIR?: string;
  THINKING_DEFAULT_LEVEL?: string;
}

const typedEnv = process.env as unknown as EnvVars;

export const config = {
  port: parseInt(typedEnv.PORT || '4315', 10) || 4315,
  gatewayBaseUrl: typedEnv.GATEWAY_BASE_URL ?? 'https://api.openai.com/v1',
  gatewayApiKey: typedEnv.GATEWAY_API_KEY,
  chatModel: typedEnv.CHAT_MODEL ?? 'gpt-4o-mini',
  contextLimit: parseInt(typedEnv.CHAT_CONTEXT_LIMIT || '200000', 10) || 200_000,
  maxToolRounds: parseInt(typedEnv.MAX_TOOL_ROUNDS || '8', 10) || 8,
  skillsDir: typedEnv.SKILLS_DIR ?? './skills',
  thinkingDefaultLevel: typedEnv.THINKING_DEFAULT_LEVEL ?? 'disabled',
} as const;
