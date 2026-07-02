import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  createChatRouter,
  ToolRegistry,
  createUseSkillTool,
  getTimeTool,
  createReadFileTool,
  createSearchFilesTool,
} from '@ng-chat/server';
import { config } from './app.config.js';

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders({ xFrameOptions: false }));

app.get('/health', (c) =>
  c.json({ status: 200, data: { name: 'ng-chat', uptime: process.uptime() } }),
);

// --- Chat: agentic tool loop ---
const tools = new ToolRegistry()
  .register('use_skill', await createUseSkillTool({ skillsDir: config.skillsDir }))
  .register('get_time', getTimeTool)
  .register('read_file', createReadFileTool(config.contentDir))
  .register('search_files', createSearchFilesTool(config.contentDir));

const systemPrompt = [
  'You are a helpful assistant embedded in the ng-chat base template.',
  'You can call tools to take actions and fetch data.',
  'When a task matches a known skill, call the use_skill tool to load its instructions before proceeding.',
  'Use read_file to read specific files and search_files to find relevant content by keyword.',
  'When the user asks you to think deeply, reason carefully, or analyze complex topics,',
  'use your full reasoning capacity before and after any tool calls.',
].join(' ');

app.route(
  '/api/chat',
  createChatRouter({
    baseURL: config.gatewayBaseUrl,
    apiKey: config.gatewayApiKey,
    defaultModel: config.chatModel,
    contextLimit: config.contextLimit,
    maxToolRounds: config.maxToolRounds,
    systemPrompt,
    tools,
    providerName: 'ai-gateway',
    defaultThinkingLevel: config.thinkingDefaultLevel,
    allowedModels: config.allowedModels,
    rateLimit: config.rateLimit,
    contentDir: config.contentDir,
  }),
);

// --- Static client (production / local mode) ---
app.use('/*', serveStatic({ root: './dist/client/browser' }));
app.get('*', serveStatic({ root: './dist/client/browser', path: '/index.html' }));

export { app };
