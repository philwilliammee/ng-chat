import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  createChatRouter,
  createStubChatRouter,
  ToolRegistry,
  createUseSkillTool,
  getTimeTool,
  createReadFileTool,
  createSearchFilesTool,
  createFileEditorTools,
} from '@ng-chat/server';
import { config } from './app.config.js';

const app = new Hono();

app.use('*', logger());
app.use('*', secureHeaders({ xFrameOptions: false }));

app.get('/health', (c) =>
  c.json({ status: 200, data: { name: 'ng-chat', uptime: process.uptime() } }),
);

// --- Chat: agentic tool loop ---
const fileEditorTools = createFileEditorTools([...config.fileEditorRoots], config.fileEditorBackupDir);

const tools = new ToolRegistry()
  .register('use_skill', await createUseSkillTool({ skillsDir: config.skillsDir }))
  .register('get_time', getTimeTool)
  .register('read_file', createReadFileTool(config.contentDir))
  .register('search_files', createSearchFilesTool(config.contentDir))
  .register('write_file', fileEditorTools.write_file)
  .register('search_code_context', fileEditorTools.search_code_context)
  .register('edit_file', fileEditorTools.edit_file)
  .register('batch_edit', fileEditorTools.batch_edit)
  .register('rollback_changes', fileEditorTools.rollback_changes);

const systemPrompt = [
  'You are a helpful assistant embedded in the ng-chat base template.',
  'You can call tools to take actions and fetch data.',
  'When a task matches a known skill, call the use_skill tool to load its instructions before proceeding.',
  'Use read_file to read specific files and search_files to find relevant content by keyword.',
  'Use write_file to save notes, facts, or summaries to the memories/ directory.',
  'If the user references past context or preferences, call use_skill with "memory" to check saved memories.',
  'At the end of a session call the close skill (use_skill: close) to persist what you learned.',
  'When the user asks you to think deeply, reason carefully, or analyze complex topics,',
  'use your full reasoning capacity before and after any tool calls.',
].join(' ');

// Two ways the chat feature can be unavailable, and both need to say so on the
// first turn rather than as a provider auth error mid-stream: the operator turned
// it off, or they have not filled in GATEWAY_API_KEY yet.
const chatRouter = !config.chatEnabled
  ? createStubChatRouter({
      enabled: false,
      message: 'Chat is switched off on this server (CHAT_ENABLED=false).',
      contextLimit: config.contextLimit,
      tools: tools.names(),
    })
  : !config.gatewayApiKey
    ? createStubChatRouter({
        message:
          'The assistant is not configured yet — set GATEWAY_API_KEY in .env (see .env.example) and restart the server.',
        contextLimit: config.contextLimit,
        tools: tools.names(),
      })
    : createChatRouter({
        baseURL: config.gatewayBaseUrl,
        apiKey: config.gatewayApiKey,
        defaultModel: config.chatModel,
        contextLimit: config.contextLimit,
        maxToolRounds: config.maxToolRounds,
        maxToolRoundsLimit: config.maxToolRoundsLimit,
        maxOutputTokens: config.maxOutputTokens,
        systemPrompt,
        tools,
        providerName: 'ai-gateway',
        defaultThinkingLevel: config.thinkingDefaultLevel,
        allowedModels: config.allowedModels,
        rateLimit: config.rateLimit,
        trustedProxyHops: config.trustedProxyHops,
        limits: config.chatLimits,
        contentDir: config.contentDir,
      });

if (!config.chatEnabled) {
  console.warn('[chat] disabled by CHAT_ENABLED=false — serving the stub router.');
} else if (!config.gatewayApiKey) {
  console.warn('[chat] GATEWAY_API_KEY is not set — serving the stub router.');
}

app.route('/api/chat', chatRouter);

// --- Static client (production / local mode) ---
app.use('/*', serveStatic({ root: './dist/client/browser' }));
app.get('*', serveStatic({ root: './dist/client/browser', path: '/index.html' }));

export { app };
