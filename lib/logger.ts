/**
 * Centralized logger for LoveNotes.
 *
 * Log levels (set via EXPO_PUBLIC_LOG_LEVEL in .env):
 *   debug – everything including verbose trace logs
 *   info  – normal operation milestones (default)
 *   warn  – unexpected but recoverable situations
 *   error – failures that affect the user
 *
 * All warn/error entries are always written to Supabase app_logs so they
 * can be searched centrally across all users in the Supabase dashboard.
 * debug/info entries are only written to Supabase when LOG_LEVEL=debug.
 */

import { supabase } from './supabase';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const configuredLevel = (
  (process.env.EXPO_PUBLIC_LOG_LEVEL as LogLevel) ?? 'info'
);

// Set once after login so remote logs include the user ID
let _userId: string | null = null;

export function setLogUser(userId: string | null): void {
  _userId = userId;
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
  // Respect configured minimum level for console output
  if (PRIORITY[level] < PRIORITY[configuredLevel]) return;

  // Console output
  const tag = `[${level.toUpperCase()}][${module}]`;
  const args: unknown[] = meta ? [tag, message, meta] : [tag, message];
  if (level === 'error') console.error(...args);
  else if (level === 'warn') console.warn(...args);
  else console.log(...args);

  // Remote write:
  //   - warn/error → always (for production monitoring)
  //   - debug/info → only when LOG_LEVEL=debug (verbose sessions)
  const writeRemotely =
    level === 'error' ||
    level === 'warn' ||
    configuredLevel === 'debug';

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

  /** Call after login / logout to attach user context to remote logs */
  setUser: setLogUser,
};
