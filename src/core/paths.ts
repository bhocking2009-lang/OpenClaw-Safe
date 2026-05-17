/**
 * Centralized application paths module.
 *
 * Resolves platform-appropriate directories for OpenClaw-Safe data, logs,
 * artifacts, replay packs, plugins, and the SQLite database.
 *
 * Windows : %APPDATA%\OpenClaw-Safe\  (fallback ~/AppData/Roaming/OpenClaw-Safe)
 * Unix/macOS : ~/.openclaw/
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface AppPaths {
  /** Root application data directory */
  base: string;
  /** Persistent structured data (e.g. SQLite) */
  data: string;
  /** Log files */
  logs: string;
  /** Artifact blobs */
  artifacts: string;
  /** Replay packs */
  replay: string;
  /** Plugin packages */
  plugins: string;
  /** Main SQLite database file */
  db: string;
}

let _cache: AppPaths | null = null;

function resolveBase(): string {
  if (process.platform === 'win32') {
    const appdata =
      process.env['APPDATA'] ??
      path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appdata, 'OpenClaw-Safe');
  }
  return path.join(os.homedir(), '.openclaw');
}

/** Returns resolved AppPaths. Result is cached after the first call. */
export function getAppPaths(): AppPaths {
  if (_cache) return _cache;

  const base = resolveBase();
  const data = path.join(base, 'data');

  _cache = {
    base,
    data,
    logs: path.join(base, 'logs'),
    artifacts: path.join(base, 'artifacts'),
    replay: path.join(base, 'replay'),
    plugins: path.join(base, 'plugins'),
    db: path.join(data, 'gateway.db'),
  };

  return _cache;
}

/**
 * Ensures all application directories exist, then returns paths.
 * Safe to call multiple times (uses recursive mkdirSync).
 */
export function ensureAppPaths(): AppPaths {
  const paths = getAppPaths();
  const dirs = [paths.base, paths.data, paths.logs, paths.artifacts, paths.replay, paths.plugins];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

/** Test helper — resets the cached singleton so tests can re-exercise resolution. */
export function _resetPathsCache(): void {
  _cache = null;
}
