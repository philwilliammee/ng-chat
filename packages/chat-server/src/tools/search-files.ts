import { tool } from 'ai';
import { z } from 'zod';
import { readdirSync, readFileSync, statSync, realpathSync } from 'fs';
import { resolve, relative } from 'path';

const MAX_RESULTS = 20;
const CONTEXT_LINES = 2;

/** Recursively collect all files with the given extensions under `dir`. */
function walkFiles(dir: string, exts: string[], root: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const full = resolve(dir, entry);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...walkFiles(full, exts, root));
      } else if (exts.some(ext => entry.endsWith(ext))) {
        results.push(full);
      }
    } catch { /* skip unreadable */ }
  }
  return results;
}

/**
 * Creates a `search_files` tool that does a case-insensitive grep across
 * markdown and text files in `contentDir`, returning matching file paths and
 * the surrounding lines for each match.
 */
export function createSearchFilesTool(contentDir: string) {
  const root = realpathSync(resolve(contentDir));

  return tool({
    description: `Search for text across markdown and text files in the content directory (${contentDir}). Returns file paths and matching lines with context. Use this to find relevant documentation, skill files, or notes.`,
    inputSchema: z.object({
      query: z.string().describe('Search term or phrase (case-insensitive)'),
      dir: z.string().optional().describe('Subdirectory to restrict the search to (relative to content dir). Omit to search everywhere.'),
    }),
    execute: async ({ query, dir }) => {
      const searchRoot = dir ? resolve(root, dir) : root;
      // Validate the search root is inside contentDir
      let realSearch: string;
      try { realSearch = realpathSync(searchRoot); } catch { realSearch = searchRoot; }
      if (!realSearch.startsWith(root)) {
        return { error: 'Access denied: search directory is outside the content directory.' };
      }

      const files = walkFiles(realSearch, ['.md', '.txt', '.mdx'], root);
      const lowerQuery = query.toLowerCase();
      const matches: Array<{ file: string; lines: Array<{ lineNumber: number; text: string }> }> = [];

      for (const file of files) {
        if (matches.length >= MAX_RESULTS) break;
        let content: string;
        try { content = readFileSync(file, 'utf-8'); } catch { continue; }
        const lines = content.split('\n');
        const hitLines: Array<{ lineNumber: number; text: string }> = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(lowerQuery)) {
            const start = Math.max(0, i - CONTEXT_LINES);
            const end = Math.min(lines.length - 1, i + CONTEXT_LINES);
            for (let j = start; j <= end; j++) {
              if (!hitLines.some(h => h.lineNumber === j + 1)) {
                hitLines.push({ lineNumber: j + 1, text: lines[j] });
              }
            }
          }
        }

        if (hitLines.length > 0) {
          matches.push({ file: relative(root, file), lines: hitLines });
        }
      }

      return {
        query,
        totalFiles: files.length,
        matches,
        truncated: matches.length >= MAX_RESULTS,
      };
    },
  });
}
