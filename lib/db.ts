import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * Get or create the local SQLite database connection.
 */
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('lovenotes.db');
  await initializeDatabase(db);
  return db;
}

/**
 * Create all local tables if they don't exist.
 */
async function initializeDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
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
  `);
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
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO outgoing_notes (id, recipient_id, recipient_name, message, is_anonymous, created_at, synced)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [note.id, note.recipient_id, note.recipient_name, note.message, note.is_anonymous ? 1 : 0, note.created_at]
  );
}

export async function getOutgoingNotesForRecipient(recipientId: string): Promise<OutgoingNote[]> {
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
  return rows.map((r) => ({
    ...r,
    is_anonymous: r.is_anonymous === 1,
    synced: r.synced === 1,
  }));
}

export async function markOutgoingNoteSynced(noteId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('UPDATE outgoing_notes SET synced = 1 WHERE id = ?', [noteId]);
}

export async function getUnsyncedOutgoingNotes(): Promise<OutgoingNote[]> {
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
  return rows.map((r) => ({
    ...r,
    is_anonymous: r.is_anonymous === 1,
    synced: r.synced === 1,
  }));
}

export async function deleteOutgoingNote(noteId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync('DELETE FROM outgoing_notes WHERE id = ?', [noteId]);
}

/**
 * Mark all outgoing notes for a recipient as unsynced.
 * Used when the recipient's public key has rotated (e.g. reinstall),
 * so the existing sync mechanism re-encrypts and re-sends them with the new key.
 */
export async function markNotesUnsyncedForRecipient(recipientId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    'UPDATE outgoing_notes SET synced = 0 WHERE recipient_id = ?',
    [recipientId]
  );
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
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR IGNORE INTO incoming_notes (id, sender_name, message, received_at)
     VALUES (?, ?, ?, ?)`,
    [note.id, note.sender_name, note.message, note.received_at]
  );
}

export async function getAllIncomingNotes(): Promise<IncomingNote[]> {
  const database = await getDatabase();
  return database.getAllAsync<IncomingNote>(
    'SELECT * FROM incoming_notes ORDER BY received_at DESC'
  );
}

export async function getRandomIncomingNote(): Promise<IncomingNote | null> {
  const database = await getDatabase();
  const result = await database.getFirstAsync<IncomingNote>(
    'SELECT * FROM incoming_notes ORDER BY RANDOM() LIMIT 1'
  );
  return result ?? null;
}

export async function markNoteShown(noteId: string): Promise<void> {
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
  const database = await getDatabase();
  await database.runAsync(
    `INSERT OR REPLACE INTO connections_cache (id, user_id, display_name, public_key, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conn.id, conn.user_id, conn.display_name, conn.public_key, conn.status, conn.updated_at]
  );
}

export async function getAcceptedConnections(): Promise<CachedConnection[]> {
  const database = await getDatabase();
  return database.getAllAsync<CachedConnection>(
    "SELECT * FROM connections_cache WHERE status = 'accepted' ORDER BY display_name"
  );
}

export async function getConnectionByUserId(userId: string): Promise<CachedConnection | null> {
  const database = await getDatabase();
  const result = await database.getFirstAsync<CachedConnection>(
    'SELECT * FROM connections_cache WHERE user_id = ?',
    [userId]
  );
  return result ?? null;
}

export async function removeConnectionCache(connectionId: string): Promise<void> {
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
  const database = await getDatabase();
  await database.runAsync(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, value]
  );
}
