/**
 * Centralized logger for LoveNotes.
 *
 * Log levels:
 *   debug – everything including verbose trace logs (very noisy)
 *   info  – normal operation milestones (default)
 *   warn  – unexpected but recoverable situations
 *   error – failures that affect the user
 *
 * Two controls:
 *  1. EXPO_PUBLIC_LOG_LEVEL env var (build-time minimum level for console output)
 *  2. Runtime debug mode (toggled in Settings → written to SQLite)
 *     When debug mode is on, ALL levels are written to console AND Supabase.
 *
 * Remote (Supabase app_logs):
 *   - warn/error → always (production monitoring)
 *   - debug/info → only when debug mode is on OR LOG_LEVEL=debug
 */

import { supabase } from './supabase';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Build-time minimum level (console output gate)
const buildLevel = ((process.env.EXPO_PUBLIC_LOG_LEVEL as LogLevel) ?? 'info');

// Runtime state
let _userId: string | null = null;
let _debugMode: boolean = false;

/** Set after login to attach user context to all remote log entries. */
export function setLogUser(userId: string | null): void {
  _userId = userId;
}

/**
 * Toggle verbose debug mode at runtime (controlled from Settings screen).
 * When true, ALL log levels are written to console and Supabase app_logs.
 */
export function setDebugMode(enabled: boolean): void {
  _debugMode = enabled;
  // Log the mode change itself so it's visible in Metro and in Supabase
  const tag = '[INFO][logger]';
  console.log(tag, `Debug mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
  if (enabled) {
    writeRemote('info', 'logger', `Debug mode enabled`, undefined);
  }
}

export function isDebugMode(): boolean {
  return _debugMode;
}

// ─── Remote write (fire-and-forget, never throws) ───────────────────────────

async function writeRemote(
  level: LogLevel,
  module: string,
  message: string,
  meta: object | undefined
): Promise<void> {
  try {
    await supabase.from('app_logs').insert({
      user_id: _userId ?? null,
      level,
      module,
      message,
      metadata: meta ?? null,
    });
  } catch {
    // Logging must never crash the app
  }
}

// ─── Core log function ───────────────────────────────────────────────────────

function log(
  level: LogLevel,
  module: string,
  message: string,
  meta?: object
): void {
  // In debug mode: always print everything. Otherwise respect build-time level.
  const effectiveMinLevel = _debugMode ? 'debug' : buildLevel;
  if (PRIORITY[level] < PRIORITY[effectiveMinLevel]) return;

  // Console output
  const tag = `[${level.toUpperCase()}][${module}]`;
  const args: unknown[] = meta ? [tag, message, meta] : [tag, message];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);

  // Remote write:
  //   - warn/error → always (production monitoring)
  //   - debug/info → only in debug mode or when LOG_LEVEL=debug at build time
  const writeRemotely =
    level === 'error' ||
    level === 'warn' ||
    _debugMode ||
    buildLevel === 'debug';

  if (writeRemotely) {
    writeRemote(level, module, message, meta);
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export const Logger = {
  debug: (module: string, message: string, meta?: object) =>
    log('debug', module, message, meta),
  info: (module: string, message: string, meta?: object) =>
    log('info', module, message, meta),
  warn: (module: string, message: string, meta?: object) =>
    log('warn', module, message, meta),
  error: (module: string, message: string, meta?: object) =>
    log('error', module, message, meta),

  /** Call after login / logout to attach user context to remote logs. */
  setUser: setLogUser,

  /**
   * Enable/disable verbose debug mode at runtime.
   * Call this after reading the 'debug_mode' setting from SQLite.
   */
  setDebugMode,
  isDebugMode,
};
