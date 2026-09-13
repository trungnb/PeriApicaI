import fs from 'fs';
import path from 'path';

export interface StoragePaths {
  root: string;
  cacheFile: string;
  uploadsDir: string;
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function getStorageRoot(): string {
  return path.resolve(process.cwd());
}

export function getCacheFilePath(): string {
  return path.join(getStorageRoot(), 'temp_cache.json');
}

export function getUploadsDirectory(): string {
  return path.join(getStorageRoot(), 'runtime', 'uploads');
}

export function getStoragePaths(): StoragePaths {
  return {
    root: getStorageRoot(),
    cacheFile: getCacheFilePath(),
    uploadsDir: getUploadsDirectory(),
  };
}

export function assertStoragePathSafe(target: string): string {
  const root = path.resolve(getStorageRoot());
  const resolvedTarget = path.resolve(target);
  if (!isPathInside(root, resolvedTarget)) {
    throw new Error(`Storage path escapes configured root: ${resolvedTarget}`);
  }

  return resolvedTarget;
}

export function ensureUploadsDirectory(): string {
  const uploadsDir = getUploadsDirectory();
  assertStoragePathSafe(path.dirname(uploadsDir));
  assertStoragePathSafe(uploadsDir);
  fs.mkdirSync(uploadsDir, { recursive: true });
  return assertStoragePathSafe(uploadsDir);
}

export function resolveUploadFilePath(filename: string): string {
  if (path.basename(filename) !== filename || !filename) {
    throw new Error('Upload filename must be a single contained path segment.');
  }
  return assertStoragePathSafe(path.join(getUploadsDirectory(), filename));
}
