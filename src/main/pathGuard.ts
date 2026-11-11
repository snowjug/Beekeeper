import { isAbsolute, relative, resolve } from 'node:path';

/** True when `target` is inside `root` (or is `root` itself). Both are resolved first. */
export function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Folders the UI may open or reveal files from (screenshots, logs). Anything else is refused. */
export function isAllowedUserPath(target: string, roots: readonly string[]): boolean {
  return roots.some((root) => isPathInside(root, target));
}
