export type SearchType = 'function' | 'class' | 'lines' | 'pattern';
export type DiffAlgorithm = 'unified' | 'character' | 'word' | 'line';
export type ValidationType = 'syntax' | 'linter' | 'tests' | 'all';
export type OperationType = 'edit' | 'create' | 'delete' | 'rename';
export type ErrorCategory = 'validation' | 'permission' | 'conflict' | 'syntax' | 'system';

export interface SearchCodeContextParams {
  file_path: string;
  search_type: SearchType;
  search_query: string;
  context_lines?: number;
  include_imports?: boolean;
}

export interface CodeMatch {
  start_line: number;
  end_line: number;
  content: string;
  context: {
    before: string[];
    after: string[];
    imports?: string[];
  };
}

export interface SearchCodeContextResponse {
  file_path: string;
  matches: CodeMatch[];
  file_metadata: {
    total_lines: number;
    encoding: string;
    last_modified: string;
  };
}

export interface EditFileParams {
  file_path: string;
  old_string: string;
  new_string: string;
  create_backup?: boolean;
}

export interface EditFileResponse {
  success: boolean;
  file_path: string;
  backup_path?: string;
}

export interface WriteFileParams {
  file_path: string;
  content: string;
  create_backup?: boolean;
}

export interface WriteFileResponse {
  success: boolean;
  file_path: string;
  type: 'create' | 'update';
  backup_path?: string;
}

export interface BatchEditOperation {
  file_path: string;
  operation: OperationType;
  old_string?: string;
  new_string?: string;
  new_path?: string;
  new_content?: string;
}

export interface BatchEditParams {
  operations: BatchEditOperation[];
  atomic?: boolean;
  validate_all?: boolean;
}

export interface BatchEditResult {
  file_path: string;
  success: boolean;
  error?: string;
  backup_path?: string;
}

export interface BatchEditResponse {
  success: boolean;
  operations_completed: number;
  operations_failed: number;
  results: BatchEditResult[];
  backup_paths?: string[];
}

export interface RollbackChangesParams {
  backup_paths: string[];
}

export interface RollbackChangesResponse {
  success: boolean;
  files_restored: string[];
  errors?: string[];
}

export interface LockInfo {
  filePath: string;
  lockedAt: Date;
  timeout: number;
}
