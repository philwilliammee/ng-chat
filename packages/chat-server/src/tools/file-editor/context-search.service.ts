import { execFile } from 'child_process';
import { promisify } from 'util';
import { SearchType, SearchCodeContextParams, SearchCodeContextResponse, CodeMatch } from './file-editor.types.js';
import { FileOperationsService } from './file-operations.service.js';

const execFileAsync = promisify(execFile);

// Bounds for the JS-fallback regex path (used when `grep` is unavailable). An
// LLM/tool-supplied `pattern` is run through `new RegExp(...)` against raw
// file content, so an unbounded pattern/input pair can trigger catastrophic
// backtracking and hang the event loop. Cap both sides of that equation.
const PATTERN_SCAN_LINE_CAP = 4_096; // max chars of a line fed into the fallback regex
const MAX_FALLBACK_PATTERN_LENGTH = 500; // reject overly long/complex patterns outright

export class ContextSearchService {
  private fileOps: FileOperationsService;

  constructor(fileOps: FileOperationsService) {
    this.fileOps = fileOps;
  }

  async searchCodeContext(params: SearchCodeContextParams): Promise<SearchCodeContextResponse> {
    const { file_path, search_type, search_query, context_lines = 3, include_imports = true } = params;

    let content: string;
    try {
      content = await this.fileOps.readFile(file_path);
    } catch (err: any) {
      if (err.code === 'EISDIR') return this.handleDirectorySearch(file_path);
      throw err;
    }

    const metadata = await this.fileOps.getFileMetadata(file_path);
    const lines = content.split('\n');
    const imports = include_imports ? this.extractImports(lines) : [];

    let matches: CodeMatch[] = [];
    switch (search_type) {
      case 'function': matches = await this.searchFunction(file_path, lines, search_query, context_lines, imports); break;
      case 'class':    matches = await this.searchClass(file_path, lines, search_query, context_lines, imports); break;
      case 'lines':    matches = this.searchLines(lines, search_query, context_lines, imports); break;
      case 'pattern':  matches = await this.searchPattern(file_path, lines, search_query, context_lines, imports); break;
    }

    return {
      file_path,
      matches,
      file_metadata: {
        total_lines: metadata.total_lines,
        encoding: metadata.encoding,
        last_modified: metadata.last_modified,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Directory listing fallback
  // ---------------------------------------------------------------------------

  private async handleDirectorySearch(dirPath: string): Promise<SearchCodeContextResponse> {
    const entries = await this.fileOps.listDirectory(dirPath);
    const listing = entries.map(e => `  ${e.name}${e.type === 'directory' ? '/' : ''}`);
    const dirs = entries.filter(e => e.type === 'directory').length;
    const files = entries.filter(e => e.type === 'file').length;

    return {
      file_path: dirPath,
      matches: [{
        start_line: 0,
        end_line: 0,
        content: `Path is a directory. Contents of ${dirPath}:\n\n${listing.join('\n')}\n\n${dirs} directories, ${files} files`,
        context: { before: [], after: [], imports: [] },
      }],
      file_metadata: { total_lines: 0, encoding: 'utf-8', last_modified: new Date().toISOString() },
    };
  }

  // ---------------------------------------------------------------------------
  // Grep helper
  // ---------------------------------------------------------------------------

  /**
   * Run grep -nEi and return 0-indexed line numbers of matches.
   * Returns null if grep is unavailable; exit code 1 (no matches) → empty array.
   */
  private async grepLines(filePath: string, pattern: string): Promise<number[] | null> {
    try {
      const { stdout } = await execFileAsync('grep', ['-nEi', pattern, filePath]);
      return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => parseInt(line.split(':')[0], 10) - 1);
    } catch (err: any) {
      if (err.code === 1) return [];
      return null; // grep unavailable — fall back to JS
    }
  }

  // ---------------------------------------------------------------------------
  // Search implementations
  // ---------------------------------------------------------------------------

  private async searchFunction(filePath: string, lines: string[], name: string, contextLines: number, imports: string[]): Promise<CodeMatch[]> {
    const n = this.escapeForGrep(name);
    const pattern =
      `(function[[:space:]]+${n}` +
      `|const[[:space:]]+${n}[[:space:]]*=` +
      `|${n}[[:space:]]*:[[:space:]]*(async[[:space:]]+)?\\(` +
      `|(public[[:space:]]+|private[[:space:]]+|protected[[:space:]]+|static[[:space:]]+|async[[:space:]]+|override[[:space:]]+|abstract[[:space:]]+)*${n}[[:space:]]*\\(` +
      `)`;

    const result = await this.grepLines(filePath, pattern);
    const indices = result ?? this.jsMatchLines(lines, this.buildFunctionRegex(name));

    return indices.flatMap(i => {
      const match = this.extractBlock(lines, i, contextLines);
      return match ? [{ ...match, context: { ...match.context, imports } }] : [];
    });
  }

  private async searchClass(filePath: string, lines: string[], name: string, contextLines: number, imports: string[]): Promise<CodeMatch[]> {
    const n = this.escapeForGrep(name);
    const result = await this.grepLines(filePath, `(class|interface|type)[[:space:]]+${n}`);
    const indices = result ?? this.jsMatchLines(lines, new RegExp(`(?:class|interface|type)\\s+${this.escapeRegex(name)}`, 'i'));

    return indices.flatMap(i => {
      const match = this.extractBlock(lines, i, contextLines);
      return match ? [{ ...match, context: { ...match.context, imports } }] : [];
    });
  }

  private async searchPattern(filePath: string, lines: string[], pattern: string, contextLines: number, imports: string[]): Promise<CodeMatch[]> {
    const result = await this.grepLines(filePath, pattern);

    let indices: number[];
    if (result !== null) {
      indices = result;
    } else {
      if (pattern.length > MAX_FALLBACK_PATTERN_LENGTH) {
        throw new Error(
          `Pattern too long for fallback search (max ${MAX_FALLBACK_PATTERN_LENGTH} chars; grep is unavailable on this host)`
        );
      }
      let regex: RegExp;
      try { regex = new RegExp(pattern, 'i'); } catch { regex = new RegExp(this.escapeRegex(pattern), 'i'); }
      indices = this.jsMatchLines(lines, regex);
    }

    return indices.map(i => {
      const start = Math.max(0, i - contextLines);
      const end = Math.min(lines.length, i + contextLines + 1);
      return {
        start_line: i + 1,
        end_line: i + 1,
        content: lines[i],
        context: { before: lines.slice(start, i), after: lines.slice(i + 1, end), imports },
      };
    });
  }

  private searchLines(lines: string[], query: string, contextLines: number, imports: string[]): CodeMatch[] {
    const range = this.parseLineRange(query);
    if (!range) return [];
    const start = Math.max(0, range.start - contextLines - 1);
    const end = Math.min(lines.length, range.end + contextLines);
    return [{
      start_line: range.start,
      end_line: range.end,
      content: lines.slice(range.start - 1, range.end).join('\n'),
      context: { before: lines.slice(start, range.start - 1), after: lines.slice(range.end, end), imports },
    }];
  }

  // ---------------------------------------------------------------------------
  // Block extraction (brace counting)
  // ---------------------------------------------------------------------------

  private extractBlock(lines: string[], startIndex: number, contextLines: number): CodeMatch | null {
    let braceCount = 0;
    let foundStart = false;
    let endIndex = startIndex;

    for (let i = startIndex; i < lines.length; i++) {
      const open = (lines[i].match(/\{/g) || []).length;
      const close = (lines[i].match(/\}/g) || []).length;
      braceCount += open - close;
      if (!foundStart && open > 0) foundStart = true;
      if (foundStart && braceCount === 0) { endIndex = i; break; }
    }

    if (!foundStart || braceCount !== 0) return null;

    return {
      start_line: startIndex + 1,
      end_line: endIndex + 1,
      content: lines.slice(startIndex, endIndex + 1).join('\n'),
      context: {
        before: lines.slice(Math.max(0, startIndex - contextLines), startIndex),
        after: lines.slice(endIndex + 1, Math.min(lines.length, endIndex + 1 + contextLines)),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // JS fallbacks
  // ---------------------------------------------------------------------------

  private jsMatchLines(lines: string[], regex: RegExp): number[] {
    return lines.reduce<number[]>((acc, line, i) => {
      // Cap the scanned length so a pathological line (e.g. a minified/huge
      // single line) can't blow up an already-untrusted regex's runtime.
      const probe = line.length > PATTERN_SCAN_LINE_CAP ? line.slice(0, PATTERN_SCAN_LINE_CAP) : line;
      if (regex.test(probe)) acc.push(i);
      return acc;
    }, []);
  }

  private buildFunctionRegex(name: string): RegExp {
    const n = this.escapeRegex(name);
    return new RegExp(
      `(?:function\\s+${n}` +
      `|const\\s+${n}\\s*=\\s*(?:async\\s*)?\\(` +
      `|${n}\\s*:\\s*(?:async\\s*)?\\(` +
      `|(?:(?:public|private|protected|static|async|override|abstract)\\s+)*${n}\\s*\\()`,
      'i'
    );
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  private extractImports(lines: string[]): string[] {
    const imports: string[] = [];
    const importRegex = /^(import|export|require)/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (importRegex.test(line.trim())) {
        imports.push(line);
      } else if (line.trim() && imports.length > 0) {
        const lastIdx = lines.indexOf(imports[imports.length - 1]);
        if (i - lastIdx > 2) break;
      }
    }
    return imports;
  }

  private parseLineRange(query: string): { start: number; end: number } | null {
    const parts = query.split('-').map(p => parseInt(p.trim(), 10));
    if (parts.length === 1 && !isNaN(parts[0])) return { start: parts[0], end: parts[0] };
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return { start: parts[0], end: parts[1] };
    return null;
  }

  private escapeForGrep(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
