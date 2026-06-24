import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  createChatRouter,
  ToolRegistry,
  createUseSkillTool,
  getTimeTool,
} from '@ng-chat/server';
import { config } from './app.config.js';

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders({ xFrameOptions: false }));

app.get('/health', (c) =>
  c.json({ status: 200, data: { name: 'ng-chat', uptime: process.uptime() } }),
);

// --- Chat: agentic tool loop over the Cornell AI Gateway ---
const tools = new ToolRegistry()
  .register('use_skill', createUseSkillTool({ skillsDir: config.skillsDir }))
  .register('get_time', getTimeTool);

const systemPrompt = [
  'You are a helpful assistant embedded in the ng-chat base template.',
  'You can call tools to take actions and fetch data.',
  'When a task matches a known skill, call the use_skill tool to load its instructions before proceeding.',
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
    providerName: 'cornell-gateway',
  }),
);

// --- Static client (production / local mode) ---
app.use('/*', serveStatic({ root: './dist/client/browser' }));
app.get('*', serveStatic({ root: './dist/client/browser', path: '/index.html' }));

export { app };
