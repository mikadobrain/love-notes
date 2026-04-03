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
  Logger.debug('sync', 'sendNote: start', {
    recipientId,
    senderName: senderName ?? 'anon',
    messageLength: message.length,
    recipientKeyPrefix: recipientPublicKey.substring(0, 10),
  });

  Logger.debug('sync', 'sendNote: loading key pair from SecureStore...');
  const keyPair = await getKeyPair();
  Logger.debug('sync', 'sendNote: key pair loaded', { hasKeyPair: !!keyPair });

  if (!keyPair) {
    Logger.error('sync', 'sendNote: no key pair found in SecureStore');
    return { success: false, error: 'Schlüsselpaar nicht gefunden. Bitte erneut anmelden.' };
  }

  Logger.debug('sync', 'sendNote: loading session from SecureStore...');
  const { data: { session } } = await supabase.auth.getSession();
  Logger.debug('sync', 'sendNote: session loaded', {
    hasSession: !!session,
    tokenPrefix: session?.access_token?.substring(0, 20),
    expiresAt: session?.expires_at,
  });

  if (!session?.access_token) {
    Logger.warn('sync', 'sendNote: no active session, deferring send');
    return { success: false, error: 'no_session' };
  }

  const accessToken = session.access_token;

  Logger.debug('sync', 'sendNote: encrypting message...');
  let encryptedPayload: string;
  try {
    encryptedPayload = encryptNotePayload(message, senderName, recipientPublicKey, keyPair.secretKey);
    Logger.debug('sync', 'sendNote: encryption OK', { payloadLength: encryptedPayload.length });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    Logger.error('sync', 'sendNote: encryption failed', { detail, recipientId });
    return { success: false, error: `Verschlüsselung fehlgeschlagen: ${detail}` };
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

  Logger.debug('sync', 'sendNote: env vars', {
    hasUrl: !!supabaseUrl,
    hasAnonKey: !!supabaseAnonKey,
    urlPrefix: supabaseUrl?.substring(0, 30),
  });

  Logger.debug('sync', 'sendNote: calling Edge Function...', { recipientId });

  // Use fetch directly to avoid any supabase-js FunctionsClient header issues.
  // Both Authorization (user JWT) and apikey (anon key) headers are required.
  // AbortController gives us a 15-second hard timeout so the UI never hangs.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    Logger.warn('sync', 'sendNote: fetch timeout after 15s, aborting');
    controller.abort();
  }, 15000);

  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/send-note`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ recipient_id: recipientId, encrypted_payload: encryptedPayload }),
      signal: controller.signal,
    });
    Logger.debug('sync', 'sendNote: fetch completed', { status: response.status });
  } catch (fetchErr) {
    const detail = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    const isTimeout = fetchErr instanceof Error && fetchErr.name === 'AbortError';
    Logger.error('sync', isTimeout ? 'sendNote: request timed out' : 'sendNote: network error', {
      detail,
      recipientId,
      isTimeout,
    });
    return {
      success: false,
      error: isTimeout ? 'Zeitüberschreitung – bitte erneut versuchen.' : `Netzwerkfehler: ${detail}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  let responseBody: { success?: boolean; message_id?: string; error?: string } = {};
  try {
    responseBody = await response.json();
    Logger.debug('sync', 'sendNote: response body parsed', { responseBody });
  } catch {
    Logger.warn('sync', 'sendNote: response was not JSON', { status: response.status });
  }

  if (!response.ok) {
    const detail = responseBody.error ?? `HTTP ${response.status}`;
    Logger.error('sync', 'sendNote: Edge Function returned error', {
      status: response.status,
      detail,
      recipientId,
    });
    return { success: false, error: detail };
  }

  Logger.info('sync', 'sendNote: success', { recipientId, messageId: responseBody.message_id });
  return { success: true };
}

/**
 * Fetch and process pending messages from the message queue.
 * Decrypts each message and stores it locally.
 */
export async function fetchAndProcessMessages(): Promise<number> {
  Logger.debug('sync', 'fetchAndProcessMessages: start');

  const keyPair = await getKeyPair();
  if (!keyPair) {
    Logger.warn('sync', 'fetchAndProcessMessages: no key pair, skipping');
    return 0;
  }
  Logger.debug('sync', 'fetchAndProcessMessages: key pair available');

  Logger.debug('sync', 'fetchAndProcessMessages: querying message_queue...');
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
  Logger.info('sync', `fetchAndProcessMessages: ${queue.length} message(s) in queue`);

  let processedCount = 0;

  for (const msg of queue) {
    Logger.debug('sync', 'fetchAndProcessMessages: processing message', { id: msg.id });
    try {
      const decrypted = await tryDecryptFromConnections(msg.encrypted_payload, keyPair.secretKey);

      if (decrypted) {
        Logger.debug('sync', 'fetchAndProcessMessages: decryption OK', {
          id: msg.id,
          sender: decrypted.senderName ?? 'anon',
        });
        await insertIncomingNote({
          id: msg.id,
          sender_name: decrypted.senderName,
          message: decrypted.message,
          received_at: new Date().toISOString(),
        });
        await supabase.from('message_queue').delete().eq('id', msg.id);
        processedCount++;
        Logger.info('sync', 'fetchAndProcessMessages: message processed and stored', { id: msg.id });
      } else {
        Logger.warn('sync', 'fetchAndProcessMessages: could not decrypt message (no matching key)', {
          id: msg.id,
        });
      }
    } catch (err) {
      Logger.error('sync', 'fetchAndProcessMessages: error processing message', {
        id: msg.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  Logger.info('sync', `fetchAndProcessMessages: done, processed ${processedCount}/${queue.length}`);
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
  const { getAcceptedConnections } = await import('./db');
  const connections = await getAcceptedConnections();
  Logger.debug('sync', 'tryDecryptFromConnections: trying keys', { count: connections.length });

  for (const conn of connections) {
    try {
      const decrypted = decryptNotePayload(
        encryptedPayload,
        conn.public_key,
        recipientSecretKey
      );
      Logger.debug('sync', 'tryDecryptFromConnections: decrypted with key', {
        userId: conn.user_id,
        displayName: conn.display_name,
      });
      return decrypted;
    } catch {
      // Wrong key, try next connection
      continue;
    }
  }

  Logger.debug('sync', 'tryDecryptFromConnections: no matching key found');
  return null;
}

/**
 * Sync unsynced outgoing notes to the server.
 * Uses the connection's current public key from local cache,
 * so this automatically handles key-rotated recipients correctly.
 */
export async function syncOutgoingNotes(senderDisplayName?: string | null): Promise<void> {
  Logger.debug('sync', 'syncOutgoingNotes: start', { senderDisplayName: senderDisplayName ?? 'anon' });
  const unsyncedNotes = await getUnsyncedOutgoingNotes();
  Logger.info('sync', `syncOutgoingNotes: ${unsyncedNotes.length} unsynced note(s)`);

  for (const note of unsyncedNotes) {
    Logger.debug('sync', 'syncOutgoingNotes: processing note', {
      noteId: note.id,
      recipientId: note.recipient_id,
    });

    const conn = await getConnectionByUserId(note.recipient_id);
    if (!conn) {
      Logger.warn('sync', 'syncOutgoingNotes: no connection found for recipient, skipping', {
        recipientId: note.recipient_id,
        noteId: note.id,
      });
      continue;
    }

    if (!conn.public_key) {
      Logger.warn('sync', 'syncOutgoingNotes: recipient has no public key yet, skipping', {
        recipientId: note.recipient_id,
        displayName: conn.display_name,
        noteId: note.id,
      });
      continue;
    }

    const senderName = note.is_anonymous ? null : (senderDisplayName ?? null);
    Logger.debug('sync', 'syncOutgoingNotes: sending note', {
      noteId: note.id,
      recipientId: note.recipient_id,
      recipientName: conn.display_name,
      isAnonymous: note.is_anonymous,
    });

    const result = await sendNote(
      note.recipient_id,
      conn.public_key,
      note.message,
      senderName
    );

    if (result.success) {
      await markOutgoingNoteSynced(note.id);
      Logger.info('sync', 'syncOutgoingNotes: note synced', { noteId: note.id });
    } else {
      Logger.warn('sync', 'syncOutgoingNotes: note send failed', {
        noteId: note.id,
        error: result.error,
      });
    }
  }

  Logger.debug('sync', 'syncOutgoingNotes: done');
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
  Logger.debug('sync', 'syncConnections: start', { currentUserId, senderDisplayName });
  const { upsertConnectionCache, getConnectionByUserId } = await import('./db');

  Logger.debug('sync', 'syncConnections: fetching connections from Supabase...');
  const { data: connections, error } = await supabase
    .from('connections')
    .select('id, requester_id, target_id, status, updated_at')
    .or(`requester_id.eq.${currentUserId},target_id.eq.${currentUserId}`)
    .eq('status', 'accepted');

  if (error) {
    Logger.error('sync', 'syncConnections: fetch failed', { error: error.message });
    return;
  }
  if (!connections) {
    Logger.warn('sync', 'syncConnections: no connections returned');
    return;
  }

  Logger.info('sync', `syncConnections: ${connections.length} accepted connection(s) found`);

  for (const conn of connections) {
    const otherUserId = conn.requester_id === currentUserId
      ? conn.target_id
      : conn.requester_id;

    Logger.debug('sync', 'syncConnections: fetching profile for connection', { otherUserId });

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('display_name, public_key')
      .eq('id', otherUserId)
      .single();

    if (profileError || !profile) {
      Logger.warn('sync', 'syncConnections: could not fetch profile', {
        otherUserId,
        error: profileError?.message,
      });
      continue;
    }

    Logger.debug('sync', 'syncConnections: profile fetched', {
      otherUserId,
      displayName: profile.display_name,
      hasPublicKey: !!profile.public_key,
      keyPrefix: profile.public_key?.substring(0, 10),
    });

    // Check if the other user's public key has changed since our last sync
    const cached = await getConnectionByUserId(otherUserId);
    const keyRotated =
      cached &&
      cached.public_key &&
      profile.public_key &&
      cached.public_key !== profile.public_key;

    if (keyRotated) {
      Logger.warn('sync', 'syncConnections: KEY ROTATION detected!', {
        userId: otherUserId,
        displayName: profile.display_name,
        oldKeyPrefix: cached.public_key?.substring(0, 10),
        newKeyPrefix: profile.public_key?.substring(0, 10),
      });
    }

    // Update local cache with latest data
    await upsertConnectionCache({
      id: conn.id,
      user_id: otherUserId,
      display_name: profile.display_name,
      public_key: profile.public_key ?? '',
      status: conn.status,
      updated_at: conn.updated_at,
    });
    Logger.debug('sync', 'syncConnections: cache updated', { otherUserId });

    // Key rotation → mark all notes unsynced for re-delivery with new key
    if (keyRotated) {
      await markNotesUnsyncedForRecipient(otherUserId);
      Logger.info('sync', 'syncConnections: notes marked unsynced for re-delivery', {
        userId: otherUserId,
      });
    }
  }

  Logger.debug('sync', 'syncConnections: all connections processed, running syncOutgoingNotes...');

  // Re-send any notes that were marked unsynced (covers key rotation and offline cases)
  await syncOutgoingNotes(senderDisplayName ?? null);

  Logger.info('sync', `syncConnections: complete, synced ${connections.length} connection(s)`);
}
