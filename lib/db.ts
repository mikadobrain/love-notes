import * as SQLite from 'expo-sqlite';
import { Logger } from './logger';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Get or create the local SQLite database connection.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  Logger.debug('db', 'Opening SQLite database...');
  db = await SQLite.openDatabaseAsync('lovenotes.db');
  await initializeDatabase(db);
  Logger.debug('db', 'Database ready');
  return db;
}

/**
 * Create all local tables if they don't exist.
 */
async function initializeDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
  Logger.debug('db', 'Running schema migrations...');
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS outgoing_notes (
      id TEXT PRIMARY KEY,
      recipient_id TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      message TEXT NOT NULL,
      is_anonymous INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS incoming_notes (
      id TEXT PRIMARY KEY,
      sender_name TEXT,
      message TEXT NOT NULL,
      received_at TEXT NOT NULL,
      last_shown_at TEXT
    );

    CREATE TABLE IF NOT EXISTS connections_cache (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      public_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'accepted',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Default settings
    INSERT OR IGNORE INTO settings (key, value) VALUES ('notification_interval_hours', '8');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('debug_mode', '0');
  `);
  Logger.debug('db', 'Schema migrations complete');
}

// ============================================
// Outgoing Notes (notes I wrote for others)
// ============================================

export type OutgoingNote = {
  id: string;
  recipient_id: string;
  recipient_name: string;
  message: string;
  is_anonymous: boolean;
  created_at: string;
  synced: boolean;
};

export async function insertOutgoingNote(note: Omit<OutgoingNote, 'synced'>): Promise<void> {
  Logger.debug('db', 'insertOutgoingNote', { id: note.id, recipient: note.recipient_name });
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO outgoing_notes (id, recipient_id, recipient_name, message, is_anonymous, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [note.id, note.recipient_id, note.recipient_name, note.message, note.is_anonymous ? 1 : 0, note.created_at]
  );
  Logger.debug('db', 'insertOutgoingNote: done', { id: note.id });
}

export async function getOutgoingNotesForRecipient(recipientId: string): Promise<OutgoingNote[]> {
  Logger.debug('db', 'getOutgoingNotesForRecipient', { recipientId });
  const database = await getDatabase();
  const rows = await database.getAllAsync<{
    id: string;
    recipient_id: string;
    recipient_name: string;
    message: string;
    is_anonymous: number;
    created_at: string;
    synced: number;
  }>(
    'SELECT * FROM outgoing_notes WHERE recipient_id = ? ORDER BY created_at DESC',
    [recipientId]
  );
  Logger.debug('db', 'getOutgoingNotesForRecipient: result', { count: rows.length });
  return rows.map((r) => ({
    ...r,
    is_anonymous: r.is_anonymous === 1,
    synced: r.synced === 1,
  }));
}

export async function markOutgoingNoteSynced(noteId: string): Promise<void> {
  Logger.debug('db', 'markOutgoingNoteSynced', { noteId });
  const database = await getDatabase();
  await database.runAsync('UPDATE outgoing_notes SET synced = 1 WHERE id = ?', [noteId]);
}

export async function getUnsyncedOutgoingNotes(): Promise<OutgoingNote[]> {
  Logger.debug('db', 'getUnsyncedOutgoingNotes');
  const database = await getDatabase();
  const rows = await database.getAllAsync<{
    id: string;
    recipient_id: string;
    recipient_name: string;
    message: string;
    is_anonymous: number;
    created_at: string;
    synced: number;
  }>('SELECT * FROM outgoing_notes WHERE synced = 0');
  Logger.debug('db', 'getUnsyncedOutgoingNotes: result', { count: rows.length });
  return rows.map((r) => ({
    ...r,
    is_anonymous: r.is_anonymous === 1,
    synced: r.synced === 1,
  }));
}

export async function deleteOutgoingNote(noteId: string): Promise<void> {
  Logger.debug('db', 'deleteOutgoingNote', { noteId });
  const database = await getDatabase();
  await database.runAsync('DELETE FROM outgoing_notes WHERE id = ?', [noteId]);
  Logger.debug('db', 'deleteOutgoingNote: done');
}

/**
 * Mark all outgoing notes for a recipient as unsynced.
 * Used when the recipient's public key has rotated (e.g. reinstall),
 * so the existing sync mechanism re-encrypts and re-sends them with the new key.
 */
export async function markNotesUnsyncedForRecipient(recipientId: string): Promise<void> {
  Logger.debug('db', 'markNotesUnsyncedForRecipient', { recipientId });
  const database = await getDatabase();
  await database.runAsync(
    'UPDATE outgoing_notes SET synced = 0 WHERE recipient_id = ?',
    [recipientId]
  );
  Logger.debug('db', 'markNotesUnsyncedForRecipient: done');
}

// ============================================
// Incoming Notes (notes others wrote for me)
// ============================================

export type IncomingNote = {
  id: string;
  sender_name: string | null;
  message: string;
  received_at: string;
  last_shown_at: string | null;
};

export async function insertIncomingNote(note: Omit<IncomingNote, 'last_shown_at'>): Promise<void> {
  Logger.debug('db', 'insertIncomingNote', { id: note.id, sender: note.sender_name ?? 'anon' });
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR IGNORE INTO incoming_notes (id, sender_name, message, received_at)
     VALUES (?, ?, ?, ?)`,
    [note.id, note.sender_name, note.message, note.received_at]
  );
  Logger.debug('db', 'insertIncomingNote: done');
}

export async function getAllIncomingNotes(): Promise<IncomingNote[]> {
  Logger.debug('db', 'getAllIncomingNotes');
  const database = await getDatabase();
  const rows = await database.getAllAsync<IncomingNote>(
    'SELECT * FROM incoming_notes ORDER BY received_at DESC'
  );
  Logger.debug('db', 'getAllIncomingNotes: result', { count: rows.length });
  return rows;
}

export async function getRandomIncomingNote(): Promise<IncomingNote | null> {
  Logger.debug('db', 'getRandomIncomingNote');
  const database = await getDatabase();
  const result = await database.getFirstAsync<IncomingNote>(
    'SELECT * FROM incoming_notes ORDER BY RANDOM() LIMIT 1'
  );
  Logger.debug('db', 'getRandomIncomingNote: result', { found: !!result });
  return result ?? null;
}

export async function markNoteShown(noteId: string): Promise<void> {
  Logger.debug('db', 'markNoteShown', { noteId });
  const database = await getDatabase();
  await database.runAsync(
    'UPDATE incoming_notes SET last_shown_at = ? WHERE id = ?',
    [new Date().toISOString(), noteId]
  );
}

// ============================================
// Connections Cache (local cache of accepted connections)
// ============================================

export type CachedConnection = {
  id: string;
  user_id: string;
  display_name: string;
  public_key: string;
  status: string;
  updated_at: string;
};

export async function upsertConnectionCache(conn: CachedConnection): Promise<void> {
  Logger.debug('db', 'upsertConnectionCache', {
    userId: conn.user_id,
    displayName: conn.display_name,
    hasKey: !!conn.public_key,
  });
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO connections_cache (id, user_id, display_name, public_key, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conn.id, conn.user_id, conn.display_name, conn.public_key, conn.status, conn.updated_at]
  );
}

export async function getAcceptedConnections(): Promise<CachedConnection[]> {
  Logger.debug('db', 'getAcceptedConnections');
  const database = await getDatabase();
  const rows = await database.getAllAsync<CachedConnection>(
    "SELECT * FROM connections_cache WHERE status = 'accepted' ORDER BY display_name"
  );
  Logger.debug('db', 'getAcceptedConnections: result', { count: rows.length });
  return rows;
}

export async function getConnectionByUserId(userId: string): Promise<CachedConnection | null> {
  Logger.debug('db', 'getConnectionByUserId', { userId });
  const database = await getDatabase();
  const result = await database.getFirstAsync<CachedConnection>(
    'SELECT * FROM connections_cache WHERE user_id = ?',
    [userId]
  );
  Logger.debug('db', 'getConnectionByUserId: result', { found: !!result });
  return result ?? null;
}

export async function removeConnectionCache(connectionId: string): Promise<void> {
  Logger.debug('db', 'removeConnectionCache', { connectionId });
  const database = await getDatabase();
  await database.runAsync('DELETE FROM connections_cache WHERE id = ?', [connectionId]);
}

// ============================================
// Settings
// ============================================

export async function getSetting(key: string): Promise<string | null> {
  const database = await getDatabase();
  const result = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return result?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  Logger.debug('db', 'setSetting', { key, value });
  const database = await getDatabase();
  await database.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value]
  );
}

export async function clearLocalData(): Promise<void> {
  Logger.info('db', 'clearLocalData: wiping all user data from local DB');
  const database = await getDatabase();
  await database.execAsync(`
    DELETE FROM outgoing_notes;
    DELETE FROM incoming_notes;
    DELETE FROM connections_cache;
  `);
  Logger.info('db', 'clearLocalData: done');
}
