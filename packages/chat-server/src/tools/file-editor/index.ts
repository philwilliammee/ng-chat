import { tool } from 'ai';
import { z } from 'zod';
import { FileOperationsService } from './file-operations.service.js';
import { FileEditorService } from './file-editor.service.js';
import { ContextSearchService } from './context-search.service.js';

/**
 * Create the five file-editor tools scoped to the given allowed roots.
 * Returned tools are ready to register in a ToolRegistry.
 */
export function createFileEditorTools(allowedRoots: string[], backupDir: string) {
  const fileOps = new FileOperationsService(allowedRoots, backupDir);
  const fileEditor = new FileEditorService(fileOps);
  const contextSearch = new ContextSearchService(fileOps);

  const search_code_context = tool({
    description:
      'Find exact code sections (function / class / line-range / regex) before editing. ' +
      'Always call this before edit_file to get the exact current content including whitespace.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute path to the file (or directory for listing)'),
      search_type: z.enum(['function', 'class', 'lines', 'pattern'])
        .describe('function: by name | class/interface/type: by name | lines: "N" or "N-M" | pattern: regex'),
      search_query: z.string().describe('Function/class name, line range (e.g. "10-20"), or ERE regex pattern'),
      context_lines: z.number().optional().describe('Context lines before/after match. Default: 3'),
      include_imports: z.boolean().optional().describe('Include file imports in results. Default: true'),
    }),
    execute: async (params) => {
      try {
        return await contextSearch.searchCodeContext(params);
      } catch (e: any) {
        return { error: e.message, code: e.code };
      }
    },
  });

  const edit_file = tool({
    description:
      'Replace old_string with new_string in an existing file. ' +
      'Exact match including all whitespace — first occurrence only. ' +
      'Prefer this over write_file for modifying existing files (sends only the changed section). ' +
      'Use search_code_context first to get the exact current content if unsure.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute path to an existing file'),
      old_string: z.string().describe('Exact text to find and replace (whitespace-sensitive)'),
      new_string: z.string().describe('Replacement text'),
      create_backup: z.boolean().optional().describe('Create a backup before editing. Default: false'),
    }),
    execute: async (params) => {
      try {
        return await fileEditor.editFile(params);
      } catch (e: any) {
        return { error: e.message, code: e.code };
      }
    },
  });

  const write_file = tool({
    description:
      'Write full content to a file. Creates the file (and any missing parent directories) if it does not exist; ' +
      'overwrites if it does. ' +
      'Prefer edit_file for modifying existing files — use write_file for new files or complete rewrites.',
    inputSchema: z.object({
      file_path: z.string().describe('Absolute path to the file to write'),
      content: z.string().describe('Full file content to write'),
      create_backup: z.boolean().optional().describe('Create a backup if the file already exists. Default: false'),
    }),
    execute: async (params) => {
      try {
        return await fileEditor.writeFile(params);
      } catch (e: any) {
        return { error: e.message, code: e.code };
      }
    },
  });

  const batch_edit = tool({
    description:
      'Apply multiple file operations atomically. On any failure, all completed operations are rolled back. ' +
      'Supports: edit (old_string→new_string), create (new file), delete, rename. ' +
      'Returns backup_paths for manual rollback_changes if needed.',
    inputSchema: z.object({
      operations: z.array(z.object({
        file_path: z.string().describe('Target file path'),
        operation: z.enum(['edit', 'create', 'delete', 'rename']),
        old_string: z.string().optional().describe('For edit: exact text to replace'),
        new_string: z.string().optional().describe('For edit: replacement text'),
        new_path: z.string().optional().describe('For rename: destination path'),
        new_content: z.string().optional().describe('For create: initial file content'),
      })).describe('Ordered list of operations to apply'),
      atomic: z.boolean().optional().describe('Roll back all on any failure. Default: true'),
      validate_all: z.boolean().optional().describe('Validate all ops before executing any. Default: true'),
    }),
    execute: async (params) => {
      try {
        return await fileEditor.batchEdit(params);
      } catch (e: any) {
        return { error: e.message, code: e.code };
      }
    },
  });

  const rollback_changes = tool({
    description: 'Restore files from backup paths returned by batch_edit (backup_paths field) or create_backup.',
    inputSchema: z.object({
      backup_paths: z.array(z.string()).describe('Backup file paths to restore'),
    }),
    execute: async (params) => {
      try {
        return await fileEditor.rollbackChanges(params);
      } catch (e: any) {
        return { error: e.message };
      }
    },
  });

  return { search_code_context, edit_file, write_file, batch_edit, rollback_changes };
}
