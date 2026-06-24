import { tool } from 'ai';
import { z } from 'zod';

/**
 * Demo tool — proves the agentic tool loop end to end with zero external deps.
 * Replace or remove in real deployments.
 */
export const getTimeTool = tool({
  description: 'Get the current date and time, optionally for a specific IANA timezone.',
  inputSchema: z.object({
    timezone: z
      .string()
      .optional()
      .describe('IANA timezone, e.g. "America/New_York". Defaults to UTC.'),
  }),
  execute: async ({ timezone }) => {
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || 'UTC',
        dateStyle: 'full',
        timeStyle: 'long',
      }).format(now);
      return { iso: now.toISOString(), timezone: timezone || 'UTC', formatted };
    } catch (err) {
      return { error: `Invalid timezone "${timezone}": ${(err as Error).message}` };
    }
  },
});
