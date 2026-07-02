import { tool } from 'ai';
import { z } from 'zod';
import { writeFileSync, mkdirSync, realpathSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

/**
 * Creates a `write_file` tool that writes content to a file inside `contentDir`.
 * Path traversal is blocked via the same realpathSync prefix-check used by read_file.
 * Parent directories are created automatically.
 */
export function createWriteFileTool(contentDir: string) {
  const root = realpathSync(resolve(contentDir));

  return tool({
    description: `Write or overwrite a file inside the content directory (${contentDir}). Use this to create or update memory notes and other persistent content. The path must be relative to the content directory. Parent directories are created automatically.`,
    inputSchema: z.object({
      path: z.string().describe('File path relative to the content directory, e.g. "memories/topic.md"'),
      content: z.string().describe('Full file content to write'),
    }),
    execute: async ({ path: filePath, content }) => {
      const abs = resolve(root, filePath);

      // Resolve symlinks for existing paths; for new paths resolve the parent.
      let realAbs: string;
      if (existsSync(abs)) {
        realAbs = realpathSync(abs);
      } else {
        const parent = dirname(abs);
        const realParent = existsSync(parent) ? realpathSync(parent) : parent;
        realAbs = resolve(realParent, filePath.split('/').pop()!);
      }

      if (!realAbs.startsWith(root + '/') && realAbs !== root) {
        return { error: 'Access denied: path is outside the content directory.' };
      }

      try {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, 'utf-8');
        return { path: filePath, written: content.length };
      } catch (e) {
        return { error: `Write failed: ${(e as Error).message}` };
      }
    },
  });
}
