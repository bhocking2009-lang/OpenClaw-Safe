/**
 * Tests for src/core/paths.ts
 *
 * Uses Jest module mocking and process.platform/env overrides to exercise
 * platform-specific path resolution without touching the real filesystem.
 */

import * as os from 'os';
import * as path from 'path';

// We import the module under test after resetting the cache so each test
// group starts from a clean state.
import { getAppPaths, ensureAppPaths, _resetPathsCache, AppPaths } from '../src/core/paths';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Temporarily override process.platform (read-only in Node, use Object.defineProperty). */
function setPlatform(platform: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  return () => {
    if (original) {
      Object.defineProperty(process, 'platform', original);
    }
  };
}

beforeEach(() => {
  _resetPathsCache();
});

/** Subdirectory keys whose values should all be under `base`. */
const SUBDIR_KEYS = ['logs', 'artifacts', 'replay', 'plugins'] as const;

/** All expected keys on the AppPaths object. */
const ALL_PATH_KEYS: (keyof AppPaths)[] = ['base', 'data', 'logs', 'artifacts', 'replay', 'plugins', 'db'];

// ---------------------------------------------------------------------------
// getAppPaths — shape
// ---------------------------------------------------------------------------

describe('getAppPaths() — shape', () => {
  it('returns an object with all required keys', () => {
    const paths = getAppPaths();
    for (const key of ALL_PATH_KEYS) {
      expect(paths).toHaveProperty(key);
      expect(typeof paths[key]).toBe('string');
    }
  });

  it('db is inside the data directory', () => {
    const paths = getAppPaths();
    expect(paths.db.startsWith(paths.data)).toBe(true);
  });

  it('all paths are absolute', () => {
    const paths = getAppPaths();
    for (const key of Object.keys(paths) as (keyof AppPaths)[]) {
      expect(path.isAbsolute(paths[key])).toBe(true);
    }
  });

  it('data is inside base', () => {
    const paths = getAppPaths();
    expect(paths.data.startsWith(paths.base)).toBe(true);
  });

  it('logs, artifacts, replay, plugins are inside base', () => {
    const paths = getAppPaths();
    for (const key of SUBDIR_KEYS) {
      expect(paths[key].startsWith(paths.base)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// getAppPaths — platform resolution
// ---------------------------------------------------------------------------

describe('getAppPaths() — Windows platform', () => {
  it('base is under APPDATA when process.platform is win32', () => {
    const restore = setPlatform('win32');
    const testAppDataPath = path.join(os.homedir(), 'FakeAppData', 'Roaming');
    process.env['APPDATA'] = testAppDataPath;
    try {
      const paths = getAppPaths();
      expect(paths.base).toBe(path.join(testAppDataPath, 'OpenClaw-Safe'));
    } finally {
      restore();
      delete process.env['APPDATA'];
    }
  });

  it('falls back to ~/AppData/Roaming when APPDATA is unset on win32', () => {
    const restore = setPlatform('win32');
    const savedAppData = process.env['APPDATA'];
    delete process.env['APPDATA'];
    try {
      const paths = getAppPaths();
      const expected = path.join(os.homedir(), 'AppData', 'Roaming', 'OpenClaw-Safe');
      expect(paths.base).toBe(expected);
    } finally {
      restore();
      if (savedAppData !== undefined) process.env['APPDATA'] = savedAppData;
    }
  });
});

describe('getAppPaths() — Unix/macOS platform', () => {
  it('base is ~/.openclaw on linux', () => {
    const restore = setPlatform('linux');
    try {
      const paths = getAppPaths();
      expect(paths.base).toBe(path.join(os.homedir(), '.openclaw'));
    } finally {
      restore();
    }
  });

  it('base is ~/.openclaw on darwin', () => {
    const restore = setPlatform('darwin');
    try {
      const paths = getAppPaths();
      expect(paths.base).toBe(path.join(os.homedir(), '.openclaw'));
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// getAppPaths — caching
// ---------------------------------------------------------------------------

describe('getAppPaths() — caching', () => {
  it('returns the same object reference on successive calls', () => {
    const first = getAppPaths();
    const second = getAppPaths();
    expect(second).toBe(first);
  });

  it('_resetPathsCache() causes a new object to be created', () => {
    const first = getAppPaths();
    _resetPathsCache();
    const second = getAppPaths();
    expect(second).not.toBe(first);
  });
});

// ---------------------------------------------------------------------------
// ensureAppPaths — directory creation
// ---------------------------------------------------------------------------

describe('ensureAppPaths()', () => {
  it('calls fs.mkdirSync for every directory', () => {
    const fs = require('fs');
    const mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);

    try {
      const paths = ensureAppPaths();
      const expectedDirs = [
        paths.base,
        paths.data,
        paths.logs,
        paths.artifacts,
        paths.replay,
        paths.plugins,
      ];

      for (const dir of expectedDirs) {
        expect(mkdirSyncSpy).toHaveBeenCalledWith(dir, { recursive: true });
      }
    } finally {
      mkdirSyncSpy.mockRestore();
    }
  });

  it('returns an AppPaths object with all required keys', () => {
    const fs = require('fs');
    const mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);

    try {
      const paths = ensureAppPaths();
      const keys: (keyof AppPaths)[] = ALL_PATH_KEYS;
      for (const key of keys) {
        expect(paths).toHaveProperty(key);
      }
    } finally {
      mkdirSyncSpy.mockRestore();
    }
  });

  it('does not actually create directories on disk during testing', () => {
    // Verify the spy approach prevents real disk writes by checking the
    // mocked implementation was used.
    const fs = require('fs');
    const mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);

    try {
      ensureAppPaths();
      // All calls went through the mock — no real fs.mkdirSync was invoked.
      expect(mkdirSyncSpy).toHaveBeenCalled();
    } finally {
      mkdirSyncSpy.mockRestore();
    }
  });
});
