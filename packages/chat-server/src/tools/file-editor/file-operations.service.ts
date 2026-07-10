import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { realpathSync } from 'fs';
import { LockInfo } from './file-editor.types.js';
import { insideAnyRoot } from '../sandbox.js';

const MAX_FILE_SIZE = 10_485_760; // 10 MB
const EXCLUDED_PATTERNS = ['node_modules', '.git', 'dist', 'build'];
const ALLOWED_EXTENSIONS = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.json', '.md', '.py',
  '.java', '.cpp', '.c', '.h', '.hpp',
  '.css', '.scss', '.sass', '.less',
  '.html', '.xml', '.yaml', '.yml', '.toml',
  '.env', '.sh', '.sql', '.graphql', '.svg',
]);

export class FileOperationsService {
  private readonly allowedRoots: string[];
  private readonly backupDir: string;
  private locks: Map<string, LockInfo> = new Map();

  constructor(allowedRoots: string[], backupDir: string) {
    this.allowedRoots = allowedRoots.map(r => {
      try { return realpathSync(r); } catch { return path.resolve(r); }
    });
    this.backupDir = path.resolve(backupDir);
  }

  async validatePath(filePath: string): Promise<string> {
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
    const normalized = path.normalize(absolute);

    if (!insideAnyRoot(normalized, this.allowedRoots)) {
      const e = new Error(`File path outside allowed workspace: ${normalized}`);
      (e as any).code = 'PATH_NOT_ALLOWED';
      throw e;
    }

    for (const excluded of EXCLUDED_PATTERNS) {
      if (normalized.split(path.sep).includes(excluded)) {
        throw new Error(`Path matches excluded pattern: ${excluded}`);
      }
    }

    const ext = path.extname(normalized);
    if (ext && !ALLOWED_EXTENSIONS.has(ext)) {
      const e = new Error(`File extension not allowed: ${ext}`);
      (e as any).code = 'EXTENSION_NOT_ALLOWED';
      throw e;
    }

    return normalized;
  }

  async readFile(filePath: string): Promise<string> {
    const validated = await this.validatePath(filePath);

    try {
      await fs.access(validated, fs.constants.F_OK);
    } catch {
      const e = new Error(`File not found: ${validated}`);
      (e as any).code = 'FILE_NOT_FOUND';
      throw e;
    }

    try {
      await fs.access(validated, fs.constants.R_OK);
    } catch {
      throw new Error(`No read permission: ${validated}`);
    }

    const stats = await fs.stat(validated);
    if (stats.isDirectory()) {
      const e = new Error(`Path is a directory: ${validated}`);
      (e as any).code = 'EISDIR';
      throw e;
    }
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${stats.size} bytes (max: ${MAX_FILE_SIZE})`);
    }

    const lstat = await fs.lstat(validated);
    if (lstat.isSymbolicLink()) {
      throw new Error(`Symbolic links not allowed: ${validated}`);
    }

    return fs.readFile(validated, 'utf-8');
  }

  async getFileMetadata(filePath: string): Promise<{ total_lines: number; encoding: string; last_modified: string }> {
    const content = await this.readFile(filePath);
    const stats = await fs.stat(await this.validatePath(filePath));
    return {
      total_lines: content.split('\n').length,
      encoding: 'utf-8',
      last_modified: stats.mtime.toISOString(),
    };
  }

  async acquireLock(filePath: string, timeout: number = 30_000): Promise<boolean> {
    const validated = await this.validatePath(filePath);
    const existing = this.locks.get(validated);
    if (existing) {
      if (Date.now() - existing.lockedAt.getTime() < existing.timeout) return false;
      this.locks.delete(validated);
    }
    this.locks.set(validated, { filePath: validated, lockedAt: new Date(), timeout });
    return true;
  }

  async releaseLock(filePath: string): Promise<void> {
    const validated = await this.validatePath(filePath);
    this.locks.delete(validated);
  }

  isLocked(filePath: string): boolean {
    const lock = this.locks.get(filePath);
    if (!lock) return false;
    if (Date.now() - lock.lockedAt.getTime() >= lock.timeout) {
      this.locks.delete(filePath);
      return false;
    }
    return true;
  }

  private async readManifest(): Promise<Record<string, string>> {
    try {
      const raw = await fs.readFile(path.join(this.backupDir, 'manifest.json'), 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private async writeManifest(manifest: Record<string, string>): Promise<void> {
    const manifestPath = path.join(this.backupDir, 'manifest.json');
    const tmpPath = manifestPath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
    await fs.rename(tmpPath, manifestPath);
  }

  private async pruneAndWriteManifest(manifest: Record<string, string>): Promise<void> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const entries = Object.entries(manifest);

    const withStats = await Promise.all(
      entries.map(async ([filename, origPath]) => {
        try {
          const stat = await fs.stat(path.join(this.backupDir, filename));
          return { filename, origPath, mtime: stat.mtimeMs };
        } catch {
          return { filename, origPath, mtime: 0 };
        }
      }),
    );

    withStats.sort((a, b) => b.mtime - a.mtime);
    const toKeep = withStats.slice(0, 200).filter(e => e.mtime > cutoff);
    const keepSet = new Set(toKeep.map(e => e.filename));

    for (const e of withStats) {
      if (!keepSet.has(e.filename) && e.mtime > 0) {
        try { await fs.unlink(path.join(this.backupDir, e.filename)); } catch { /* ignore */ }
      }
    }

    const pruned: Record<string, string> = {};
    for (const e of toKeep) pruned[e.filename] = e.origPath;
    await this.writeManifest(pruned);
  }

  async createBackup(filePath: string, operationType: string = 'edit'): Promise<string> {
    const validated = await this.validatePath(filePath);
    try {
      const content = await this.readFile(validated);
      await fs.mkdir(this.backupDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const pathHash = createHash('sha256').update(validated).digest('hex').slice(0, 8);
      const base = path.basename(validated);
      const filename = `${timestamp}-${pathHash}-${base}.bak`;
      const backupPath = path.join(this.backupDir, filename);

      await fs.writeFile(backupPath, content, 'utf-8');

      const manifest = await this.readManifest();
      manifest[filename] = validated;
      await this.pruneAndWriteManifest(manifest);

      return backupPath;
    } catch (error: any) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  async writeFile(filePath: string, content: string, createBackup: boolean = false): Promise<void> {
    const validated = await this.validatePath(filePath);

    if (this.isLocked(validated)) throw new Error(`File is locked: ${validated}`);

    const locked = await this.acquireLock(validated);
    if (!locked) throw new Error(`Failed to acquire lock: ${validated}`);

    try {
      if (createBackup) {
        try {
          await this.createBackup(validated, 'edit');
        } catch (err: any) {
          console.warn(`Backup failed: ${err.message}`);
        }
      }
      await fs.mkdir(path.dirname(validated), { recursive: true });
      await fs.writeFile(validated, content, 'utf-8');
    } finally {
      await this.releaseLock(validated);
    }
  }

  async restoreFromBackup(backupPath: string): Promise<void> {
    const normalized = path.normalize(path.resolve(backupPath));
    if (!insideAnyRoot(normalized, [this.backupDir])) {
      throw new Error(`Backup path is outside the backup directory: ${backupPath}`);
    }
    try {
      await fs.access(normalized, fs.constants.F_OK);
    } catch {
      throw new Error(`Backup file not found: ${backupPath}`);
    }

    const filename = path.basename(normalized);
    const manifest = await this.readManifest();
    const originalPath = manifest[filename];
    if (!originalPath) throw new Error(`No manifest entry for backup: ${filename}`);

    const content = await fs.readFile(normalized, 'utf-8');
    await this.writeFile(originalPath, content, false);
  }

  async listDirectory(dirPath: string): Promise<{ name: string; type: 'file' | 'directory'; size: number }[]> {
    const validated = await this.validatePath(dirPath);
    const entries = await fs.readdir(validated, { withFileTypes: true });
    const results: { name: string; type: 'file' | 'directory'; size: number }[] = [];

    for (const entry of entries) {
      if (EXCLUDED_PATTERNS.includes(entry.name) || entry.name.startsWith('.')) continue;
      try {
        const stat = await fs.stat(path.join(validated, entry.name));
        results.push({ name: entry.name, type: entry.isDirectory() ? 'directory' : 'file', size: stat.size });
      } catch { /* skip */ }
    }

    return results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      const validated = await this.validatePath(filePath);
      await fs.access(validated, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(filePath: string, createBackupFirst: boolean = false): Promise<void> {
    const validated = await this.validatePath(filePath);
    if (createBackupFirst) await this.createBackup(validated, 'delete');
    await fs.unlink(validated);
  }
}
