import { serve } from '@hono/node-server';
import { config } from './app.config.js';
import { app } from './app.js';

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[ng-chat] listening on http://localhost:${info.port}`);
});
