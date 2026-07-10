import {
  EditFileParams,
  EditFileResponse,
  WriteFileParams,
  WriteFileResponse,
  BatchEditParams,
  BatchEditResponse,
  RollbackChangesParams,
  RollbackChangesResponse,
} from './file-editor.types.js';
import { FileOperationsService } from './file-operations.service.js';

function editorError(code: string, message: string): Error {
  const e = new Error(message);
  (e as any).code = code;
  return e;
}

export class FileEditorService {
  private fileOps: FileOperationsService;

  constructor(fileOps: FileOperationsService) {
    this.fileOps = fileOps;
  }

  /**
   * Stateless string-replacement edit: find old_string in file and replace with new_string.
   * Replaces only the first occurrence — consistent with Claude Code Edit tool behaviour.
   */
  async editFile(params: EditFileParams): Promise<EditFileResponse> {
    const { file_path, old_string, new_string, create_backup = false } = params;

    let content: string;
    try {
      content = await this.fileOps.readFile(file_path);
    } catch (e: any) {
      if (e.code === 'ENOENT' || e.code === 'FILE_NOT_FOUND') {
        throw editorError('FILE_NOT_FOUND', `File not found: ${file_path}`);
      }
      throw e;
    }

    if (!content.includes(old_string)) {
      // Handle LF/CRLF mismatch: LLM sends \n but file uses \r\n
      if (content.includes('\r\n') && !old_string.includes('\r\n')) {
        const adaptedOld = old_string.replace(/\n/g, '\r\n');
        const adaptedNew = new_string.replace(/\n/g, '\r\n');
        if (content.includes(adaptedOld)) {
          const newContent = content.replace(adaptedOld, adaptedNew);
          let backupPath = '';
          if (create_backup) backupPath = await this.fileOps.createBackup(file_path, 'edit');
          await this.fileOps.writeFile(file_path, newContent, false);
          return { success: true, file_path, backup_path: backupPath || undefined };
        }
      }

      const preview = old_string.length > 120 ? old_string.substring(0, 120) + '...' : old_string;
      throw editorError(
        'STRING_NOT_FOUND',
        `old_string not found in file.\nSearched for: ${JSON.stringify(preview)}\nTip: use search_code_context to get exact current content.`
      );
    }

    const newContent = content.replace(old_string, new_string);
    let backupPath = '';
    if (create_backup) backupPath = await this.fileOps.createBackup(file_path, 'edit');
    await this.fileOps.writeFile(file_path, newContent, false);

    return { success: true, file_path, backup_path: backupPath || undefined };
  }

  /**
   * Write full content to a file, creating it (and parent dirs) if it doesn't exist.
   */
  async writeFile(params: WriteFileParams): Promise<WriteFileResponse> {
    const { file_path, content, create_backup = false } = params;
    const exists = await this.fileOps.fileExists(file_path);
    let backupPath = '';
    if (exists && create_backup) backupPath = await this.fileOps.createBackup(file_path, 'write');
    await this.fileOps.writeFile(file_path, content, false);
    return { success: true, file_path, type: exists ? 'update' : 'create', backup_path: backupPath || undefined };
  }

  /**
   * Apply multiple file operations atomically.
   * On failure, rolls back all completed operations (if atomic=true).
   */
  async batchEdit(params: BatchEditParams): Promise<BatchEditResponse> {
    const { operations, atomic = true, validate_all = true } = params;

    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      throw new Error('operations must be a non-empty array');
    }

    const response: BatchEditResponse = {
      success: false,
      operations_completed: 0,
      operations_failed: 0,
      results: [],
    };

    const backupPaths: string[] = [];
    const createdPaths: string[] = [];

    try {
      // Phase 1: Validate all ops before executing any.
      // A virtual overlay tracks the state as operations would be applied
      // so that rename→edit-of-destination is accepted (F7 fix).
      if (validate_all) {
        const overlay = {
          created: new Set<string>(),
          deleted: new Set<string>(),
        };

        for (const op of operations) {
          if (!op.file_path) throw editorError('INVALID_PARAMS', 'Operation missing required field: file_path');
          if (!op.operation) throw editorError('INVALID_PARAMS', 'Operation missing required field: operation');

          if (op.operation === 'edit') {
            if (!op.old_string) throw editorError('INVALID_PARAMS', `Edit op on ${op.file_path} missing old_string`);
            if (op.new_string === undefined) throw editorError('INVALID_PARAMS', `Edit op on ${op.file_path} missing new_string`);
            const existsOnDisk = await this.fileOps.fileExists(op.file_path);
            const existsInOverlay = overlay.created.has(op.file_path) && !overlay.deleted.has(op.file_path);
            if (!existsOnDisk && !existsInOverlay) {
              throw editorError('FILE_NOT_FOUND', `File not found: ${op.file_path}`);
            }
          }

          // Update overlay so later ops see the projected state
          switch (op.operation) {
            case 'create':
              overlay.created.add(op.file_path);
              overlay.deleted.delete(op.file_path);
              break;
            case 'delete':
              overlay.deleted.add(op.file_path);
              overlay.created.delete(op.file_path);
              break;
            case 'rename':
              if (op.new_path) {
                overlay.deleted.add(op.file_path);
                overlay.created.add(op.new_path);
              }
              break;
          }
        }
      }

      // Phase 2: Create backups for rollback (atomic only)
      if (atomic) {
        for (const op of operations) {
          if (op.operation !== 'create' && await this.fileOps.fileExists(op.file_path)) {
            backupPaths.push(await this.fileOps.createBackup(op.file_path, op.operation));
          }
        }
        if (backupPaths.length > 0) response.backup_paths = backupPaths;
      }

      // Phase 3: Execute
      for (const op of operations) {
        try {
          switch (op.operation) {
            case 'edit':
              await this.editFile({ file_path: op.file_path, old_string: op.old_string!, new_string: op.new_string!, create_backup: false });
              break;
            case 'create':
              if (!op.new_content) throw new Error(`Create op missing new_content`);
              await this.fileOps.writeFile(op.file_path, op.new_content, false);
              if (atomic) createdPaths.push(op.file_path);
              break;
            case 'delete':
              await this.fileOps.deleteFile(op.file_path, false);
              break;
            case 'rename': {
              if (!op.new_path) throw new Error(`Rename op missing new_path`);
              const content = await this.fileOps.readFile(op.file_path);
              await this.fileOps.writeFile(op.new_path, content, false);
              await this.fileOps.deleteFile(op.file_path, false);
              if (atomic) createdPaths.push(op.new_path);
              break;
            }
            default:
              throw new Error(`Unknown operation: ${op.operation}`);
          }
          response.results.push({ file_path: op.file_path, success: true });
          response.operations_completed++;
        } catch (error: any) {
          response.operations_failed++;
          const msg = error?.message ?? String(error);
          response.results.push({ file_path: op.file_path, success: false, error: msg });

          if (atomic) {
            if (backupPaths.length > 0) {
              try { await this.rollbackChanges({ backup_paths: backupPaths }); } catch { /* best effort */ }
            }
            for (const p of createdPaths) {
              try { await this.fileOps.deleteFile(p, false); } catch { /* best effort */ }
            }
            throw new Error(`Batch failed at ${op.file_path}: ${msg}`);
          }
        }
      }

      response.success = response.operations_failed === 0;
    } catch (error: any) {
      response.success = false;
      throw error;
    }

    return response;
  }

  async rollbackChanges(params: RollbackChangesParams): Promise<RollbackChangesResponse> {
    const { backup_paths } = params;
    if (!backup_paths || backup_paths.length === 0) throw new Error('backup_paths must not be empty');

    const result: RollbackChangesResponse = { success: true, files_restored: [], errors: [] };

    for (const backupPath of backup_paths) {
      try {
        await this.fileOps.restoreFromBackup(backupPath);
        result.files_restored.push(backupPath);
      } catch (e: any) {
        result.errors!.push(`Failed to restore ${backupPath}: ${e.message}`);
        result.success = false;
      }
    }

    return result;
  }
}
