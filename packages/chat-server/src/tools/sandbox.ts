import { realpathSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Returns true if `p` resolves (via realpath) inside any of the allowed roots.
 * For non-existent paths (new files), walks up to the nearest existing parent
 * before checking — handles both existing files and planned new paths.
 */
export function insideAnyRoot(p: string, roots: string[]): boolean {
  const abs = resolve(p);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    let current = abs;
    while (!existsSync(current)) {
      const parent = resolve(current, '..');
      if (parent === current) return false;
      current = parent;
    }
    real = realpathSync(current);
  }
  return roots.some(root => real === root || real.startsWith(root + '/'));
}
