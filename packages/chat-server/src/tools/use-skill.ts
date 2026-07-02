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
  } catch (err) {
    console.error('[use-skill] Failed to read skills directory:', err);
    return [];
  }
}

/**
 * Document-based memory: loads a skill's markdown instructions on demand.
 *
 * This is the default "use_skill" tool every ng-chat agent ships with. It lets
 * the model pull in focused guidance (a "skill") from the filesystem instead of
 * carrying everything in the system prompt. Simple, file-backed, no RAG.
 *
 * Skills are pre-listed in the tool description at startup so the model never
 * needs a speculative "list" call — it already knows what's available.
 */
export async function createUseSkillTool(options: UseSkillOptions) {
  const skillsDir = resolve(options.skillsDir);

  // Read skill names once at startup and bake them into the description.
  const available = await listSkills(skillsDir);
  const skillList = available.length
    ? `Available skills: ${available.join(', ')}.`
    : 'No skills are currently loaded.';

  return tool({
    description:
      `Load the full instructions for a named skill. ${skillList} ` +
      'Only call this when the user request clearly matches one of the listed skill names. ' +
      'Do NOT call this for general knowledge, analysis, or questions you can answer directly.',
    inputSchema: z.object({
      name: z
        .string()
        .describe('The skill to load. Must be one of the listed available skills.'),
    }),
    execute: async ({ name }) => {
      const current = await listSkills(skillsDir);
      const safe = name.replace(/[^a-z0-9_-]/gi, '');
      if (!safe || !current.includes(safe)) {
        return { error: `Unknown skill "${name}".`, available: current };
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
