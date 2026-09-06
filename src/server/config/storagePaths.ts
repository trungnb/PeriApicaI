import fs from 'fs';
import os from 'os';
import path from 'path';

const TEST_STORAGE_ROOT_PREFIX = 'periapicai-storage-';

let testStorageRoot: string | null = null;
let testOfflineMode = false;

export interface StoragePaths {
  root: string;
  cacheFile: string;
  uploadsDir: string;
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertHarnessOwnedTestRoot(candidate: string): string {
  const resolved = path.resolve(candidate);
  const realTempRoot = fs.realpathSync(os.tmpdir());
  const stats = fs.lstatSync(resolved);

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('R17 test storage root must be a real directory, not a symlink.');
  }

  const realCandidate = fs.realpathSync(resolved);
  if (
    path.dirname(realCandidate) !== realTempRoot ||
    !path.basename(realCandidate).startsWith(TEST_STORAGE_ROOT_PREFIX)
  ) {
    throw new Error('R17 test storage root must be a harness-created direct child of the OS temp directory.');
  }

  return realCandidate;
}

export function getStorageRoot(): string {
  return testStorageRoot || path.resolve(process.cwd());
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

/**
 * Test-only seam. Permanent callers must use createStorageSandbox(), which
 * owns creation and cleanup of the supplied root.
 */
export function configureStorageRootForTests(root: string): StoragePaths {
  testStorageRoot = assertHarnessOwnedTestRoot(root);
  testOfflineMode = true;
  return {
    root: testStorageRoot,
    cacheFile: path.join(testStorageRoot, 'temp_cache.json'),
    uploadsDir: path.join(testStorageRoot, 'runtime', 'uploads'),
  };
}

export function resetStorageRootForTests(expectedRoot: string): void {
  if (!testStorageRoot || fs.realpathSync(expectedRoot) !== testStorageRoot) {
    throw new Error('Cannot reset an R17 storage root that is not currently active.');
  }
  testStorageRoot = null;
  testOfflineMode = false;
}

export function isStorageTestOfflineMode(): boolean {
  return testOfflineMode;
}

export function assertStoragePathSafe(target: string): string {
  const root = path.resolve(getStorageRoot());
  const resolvedTarget = path.resolve(target);
  if (!isPathInside(root, resolvedTarget)) {
    throw new Error(`Storage path escapes configured root: ${resolvedTarget}`);
  }

  // Test roots are harness-owned. Reject any symlink introduced below them so
  // local destructive tests cannot redirect a cache or upload outside root.
  if (testStorageRoot) {
    const relative = path.relative(root, resolvedTarget);
    let cursor = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, segment);
      if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`Symlink escape rejected inside R17 storage root: ${cursor}`);
      }
    }
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
