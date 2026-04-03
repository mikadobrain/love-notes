import { supabase, MessageQueueItem } from './supabase';
import { decryptNotePayload, getKeyPair } from './crypto';
import {
  insertIncomingNote,
  getUnsyncedOutgoingNotes,
  markOutgoingNoteSynced,
  getConnectionByUserId,
  markNotesUnsyncedForRecipient,
} from './db';
import { encryptNotePayload } from './crypto';
import { Logger } from './logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Send a note to a recipient via the Supabase Edge Function.
 * The Edge Function validates the connection and rate limits.
 */
export async function sendNote(
  recipientId: string,
  recipientPublicKey: string,
  message: string,
  senderName: string | null // null = anonymous
): Promise<{ success: boolean; error?: string }> {
  const keyPair = await getKeyPair();
  if (!keyPair) {
    Logger.error('sync', 'sendNote: no key pair found');
    return { success: false, error: 'Schlüsselpaar nicht gefunden. Bitte erneut anmelden.' };
  }

  // Get the current session and pass the access token explicitly.
  // We cannot rely on the client's internal FunctionsClient headers because
  // they may not yet reflect the session that was just loaded from SecureStore
  // (race condition on app startup), leading to "Invalid JWT" from the server.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    Logger.warn('sync', 'sendNote: no active session, deferring send');
    return { success: false, error: 'no_session' };
  }

  let encryptedPayload: string;
  try {
    encryptedPayload = encryptNotePayload(message, senderName, recipientPublicKey, keyPair.secretKey);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    Logger.error('sync', 'sendNote: encryption failed', { detail, recipientId });
    return { success: false, error: `Verschlüsselung fehlgeschlagen: ${detail}` };
  }

  Logger.debug('sync', 'sendNote: invoking Edge Function', { recipientId });

  const { data, error } = await supabase.functions.invoke('send-note', {
    body: { recipient_id: recipientId, encrypted_payload: encryptedPayload },
    // Pass token explicitly – avoids race condition where FunctionsClient
    // headers haven't yet been updated after session load from SecureStore
    headers: { Authorization: `Bearer ${session.access_token}` },
  });

  if (error) {
    // Extract the real response body from FunctionsHttpError
    let detail = error.message;
    try {
      // supabase-js wraps the response; try to read the JSON body
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        const text = await ctx.text();
        const parsed = JSON.parse(text);
        detail = parsed.error ?? parsed.message ?? text;
      }
    } catch {
      // ignore parse errors, use original message
    }
    Logger.error('sync', 'sendNote: Edge Function error', { detail, recipientId });
    return { success: false, error: detail };
  }

  Logger.info('sync', 'sendNote: success', { recipientId, messageId: data?.message_id });
  return { success: true };
}

/**
 * Fetch and process pending messages from the message queue.
 * Decrypts each message and stores it locally.
 */
export async function fetchAndProcessMessages(): Promise<number> {
  const keyPair = await getKeyPair();
  if (!keyPair) {
    Logger.warn('sync', 'fetchAndProcessMessages: no key pair, skipping');
    return 0;
  }

  const { data: messages, error } = await supabase
    .from('message_queue')
    .select('*')
    .eq('delivered', false)
    .order('created_at', { ascending: true });

  if (error) {
    Logger.error('sync', 'fetchAndProcessMessages: fetch failed', { error: error.message });
    return 0;
  }

  const queue = (messages ?? []) as MessageQueueItem[];
  Logger.debug('sync', `fetchAndProcessMessages: ${queue.length} message(s) in queue`);

  let processedCount = 0;

  for (const msg of queue) {
    try {
      const decrypted = await tryDecryptFromConnections(msg.encrypted_payload, keyPair.secretKey);

      if (decrypted) {
        await insertIncomingNote({
          id: msg.id,
          sender_name: decrypted.senderName,
          message: decrypted.message,
          received_at: new Date().toISOString(),
        });
        await supabase.from('message_queue').delete().eq('id', msg.id);
        processedCount++;
        Logger.debug('sync', 'fetchAndProcessMessages: message processed', { id: msg.id });
      } else {
        Logger.warn('sync', 'fetchAndProcessMessages: could not decrypt message', { id: msg.id });
      }
    } catch (err) {
      Logger.error('sync', 'fetchAndProcessMessages: error processing message', {
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  Logger.info('sync', `fetchAndProcessMessages: processed ${processedCount} message(s)`);
  return processedCount;
}

/**
 * Try to decrypt a message by testing against all connection public keys.
 * Returns the decrypted payload if successful, null otherwise.
 */
async function tryDecryptFromConnections(
  encryptedPayload: string,
  recipientSecretKey: string
): Promise<{ message: string; senderName: string | null; timestamp: string } | null> {
  // Get all accepted connections from local cache
  const { getAcceptedConnections } = await import('./db');
  const connections = await getAcceptedConnections();

  for (const conn of connections) {
    try {
      const decrypted = decryptNotePayload(
        encryptedPayload,
        conn.public_key,
        recipientSecretKey
      );
      return decrypted;
    } catch {
      // Wrong key, try next connection
      continue;
    }
  }

  return null;
}

/**
 * Sync unsynced outgoing notes to the server.
 * Uses the connection's current public key from local cache,
 * so this automatically handles key-rotated recipients correctly.
 */
export async function syncOutgoingNotes(senderDisplayName?: string | null): Promise<void> {
  const unsyncedNotes = await getUnsyncedOutgoingNotes();

  for (const note of unsyncedNotes) {
    const conn = await getConnectionByUserId(note.recipient_id);
    if (!conn) continue;

    // Skip if recipient has no public key yet (they haven't opened the app)
    if (!conn.public_key) {
      console.log(`Skipping note for ${conn.display_name} – no public key yet`);
      continue;
    }

    const senderName = note.is_anonymous ? null : (senderDisplayName ?? null);
    const result = await sendNote(
      note.recipient_id,
      conn.public_key,
      note.message,
      senderName
    );

    if (result.success) {
      await markOutgoingNoteSynced(note.id);
    }
  }
}

/**
 * Sync connections from Supabase to local cache.
 *
 * If a connection's public key has changed (e.g. recipient reinstalled the app),
 * all outgoing notes for that recipient are automatically re-encrypted and re-sent
 * using the new key, so the recipient regains access to all notes.
 *
 * @param currentUserId - The logged-in user's ID
 * @param senderDisplayName - The logged-in user's display name (for non-anonymous re-sends)
 */
export async function syncConnections(
  currentUserId: string,
  senderDisplayName?: string
): Promise<void> {
  const { upsertConnectionCache, getConnectionByUserId } = await import('./db');

  // Fetch all accepted connections where I'm involved
  const { data: connections, error } = await supabase
    .from('connections')
    .select('id, requester_id, target_id, status, updated_at')
    .or(`requester_id.eq.${currentUserId},target_id.eq.${currentUserId}`)
    .eq('status', 'accepted');

  if (error) {
    Logger.error('sync', 'syncConnections: fetch failed', { error: error.message });
    return;
  }
  if (!connections) return;

  for (const conn of connections) {
    const otherUserId = conn.requester_id === currentUserId
      ? conn.target_id
      : conn.requester_id;

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, public_key')
      .eq('id', otherUserId)
      .single();

    if (!profile) continue;

    // Check if the other user's public key has changed since our last sync
    const cached = await getConnectionByUserId(otherUserId);
    const keyRotated =
      cached &&
      cached.public_key &&
      profile.public_key &&
      cached.public_key !== profile.public_key;

    // Update local cache with latest data (even if public_key is empty –
    // the contact will be visible; sending is blocked until they have a key)
    await upsertConnectionCache({
      id: conn.id,
      user_id: otherUserId,
      display_name: profile.display_name,
      public_key: profile.public_key ?? '',
      status: conn.status,
      updated_at: conn.updated_at,
    });

    // Key rotation detected → mark all notes as unsynced so the existing
    // sync mechanism re-encrypts and re-delivers them with the new key
    if (keyRotated) {
      Logger.warn('sync', `syncConnections: key rotation detected for ${profile.display_name}`, {
        userId: otherUserId,
      });
      await markNotesUnsyncedForRecipient(otherUserId);
    }
  }

  Logger.debug('sync', `syncConnections: synced ${connections.length} connection(s)`);

  // Re-send any notes that were marked unsynced (covers key rotation and offline cases)
  await syncOutgoingNotes(senderDisplayName ?? null);
}
