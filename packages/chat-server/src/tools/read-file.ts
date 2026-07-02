import { tool } from 'ai';
import { z } from 'zod';
import { readFileSync, realpathSync } from 'fs';
import { resolve } from 'path';

/**
 * Creates a `read_file` tool that returns the contents of a single file.
 * All paths are resolved against `contentDir` and validated to prevent
 * path traversal outside it.
 */
export function createReadFileTool(contentDir: string) {
  const root = realpathSync(resolve(contentDir));

  return tool({
    description: `Read a file from the content directory (${contentDir}). Returns the file contents as a string. Use this to read documentation, skill files, or any text file in the content area.`,
    inputSchema: z.object({
      path: z.string().describe('Path relative to the content directory, e.g. "my-skill.md" or "subfolder/notes.md"'),
    }),
    execute: async ({ path }) => {
      const absolute = resolve(root, path);
      // Guard against path traversal
      let real: string;
      try {
        real = realpathSync(absolute);
      } catch {
        real = absolute; // file may not exist yet; validate prefix anyway
      }
      if (!real.startsWith(root + '/') && real !== root) {
        return { error: `Access denied: path is outside the content directory.` };
      }
      try {
        const content = readFileSync(absolute, 'utf-8');
        return { path, content };
      } catch (err) {
        return { error: `Could not read file: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });
}
