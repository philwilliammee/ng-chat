import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tool } from 'ai';
import { z } from 'zod';

export interface UseSkillOptions {
  /** Directory containing `<skill>.md` files. */
  skillsDir: string;
}

async function listSkills(skillsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(skillsDir);
    return entries
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .map((f) => f.replace(/\.md$/i, ''));
  } catch {
    return [];
  }
}

/**
 * Document-based memory: loads a skill's markdown instructions on demand.
 *
 * This is the default "use_skill" tool every ng-chat agent ships with. It lets
 * the model pull in focused guidance (a "skill") from the filesystem instead of
 * carrying everything in the system prompt. Simple, file-backed, no RAG.
 */
export function createUseSkillTool(options: UseSkillOptions) {
  const skillsDir = resolve(options.skillsDir);

  return tool({
    description:
      'Load the full instructions for a named skill (a focused set of guidance or a procedure). ' +
      'Call this before performing a task that matches a skill. Omit "name" to list available skills.',
    inputSchema: z.object({
      name: z
        .string()
        .optional()
        .describe('The skill to load. Leave empty to list all available skills.'),
    }),
    execute: async ({ name }) => {
      const available = await listSkills(skillsDir);
      if (!name) {
        return { available };
      }

      const safe = name.replace(/[^a-z0-9_-]/gi, '');
      if (!safe || !available.includes(safe)) {
        return { error: `Unknown skill "${name}".`, available };
      }

      try {
        const content = await readFile(join(skillsDir, `${safe}.md`), 'utf8');
        return { name: safe, content };
      } catch (err) {
        return { error: `Failed to read skill "${safe}": ${(err as Error).message}` };
      }
    },
  });
}
