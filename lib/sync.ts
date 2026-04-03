import { supabase, MessageQueueItem } from './supabase';
import { decryptNotePayload, getKeyPair } from './crypto';
import {
  insertIncomingNote,
  getUnsyncedOutgoingNotes,
  markOutgoingNoteSynced,
  getConnectionByUserId,
} from './db';
import { encryptNotePayload } from './crypto';
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
    return { success: false, error: 'Schlüsselpaar nicht gefunden. Bitte erneut anmelden.' };
  }

  // Encrypt the note payload with authenticated encryption
  const encryptedPayload = encryptNotePayload(
    message,
    senderName,
    recipientPublicKey,
    keyPair.secretKey
  );

  // Send via Edge Function (not directly to DB!)
  const { data, error } = await supabase.functions.invoke('send-note', {
    body: {
      recipient_id: recipientId,
      encrypted_payload: encryptedPayload,
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Fetch and process pending messages from the message queue.
 * Decrypts each message and stores it locally.
 */
export async function fetchAndProcessMessages(): Promise<number> {
  const keyPair = await getKeyPair();
  if (!keyPair) return 0;

  // Fetch undelivered messages
  const { data: messages, error } = await supabase
    .from('message_queue')
    .select('*')
    .eq('delivered', false)
    .order('created_at', { ascending: true });

  if (error || !messages) {
    console.error('Error fetching messages:', error);
    return 0;
  }

  let processedCount = 0;

  for (const msg of messages as MessageQueueItem[]) {
    try {
      // We need the sender's public key to decrypt.
      // The sender_id is not stored in message_queue for privacy,
      // so we try each connection's public key until one works.
      // In practice, we could add sender_id to message_queue (it's not sensitive).
      const decrypted = await tryDecryptFromConnections(
        msg.encrypted_payload,
        keyPair.secretKey
      );

      if (decrypted) {
        await insertIncomingNote({
          id: msg.id,
          sender_name: decrypted.senderName,
          message: decrypted.message,
          received_at: new Date().toISOString(),
        });

        // Mark as delivered and delete from queue
        await supabase
          .from('message_queue')
          .delete()
          .eq('id', msg.id);

        processedCount++;
      }
    } catch (err) {
      console.error('Error processing message:', msg.id, err);
    }
  }

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
 * Called periodically or when the app comes to foreground.
 */
export async function syncOutgoingNotes(): Promise<void> {
  const unsyncedNotes = await getUnsyncedOutgoingNotes();

  for (const note of unsyncedNotes) {
    const conn = await getConnectionByUserId(note.recipient_id);
    if (!conn) continue;

    const result = await sendNote(
      note.recipient_id,
      conn.public_key,
      note.message,
      note.is_anonymous ? null : 'pending' // Will be replaced with actual name
    );

    if (result.success) {
      await markOutgoingNoteSynced(note.id);
    }
  }
}

/**
 * Sync connections from Supabase to local cache.
 */
export async function syncConnections(currentUserId: string): Promise<void> {
  const { upsertConnectionCache } = await import('./db');

  // Fetch all accepted connections where I'm involved
  const { data: connections, error } = await supabase
    .from('connections')
    .select(`
      id,
      requester_id,
      target_id,
      status,
      updated_at
    `)
    .or(`requester_id.eq.${currentUserId},target_id.eq.${currentUserId}`)
    .eq('status', 'accepted');

  if (error || !connections) {
    console.error('Error syncing connections:', error);
    return;
  }

  // For each connection, fetch the other user's profile
  for (const conn of connections) {
    const otherUserId = conn.requester_id === currentUserId
      ? conn.target_id
      : conn.requester_id;

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, public_key')
      .eq('id', otherUserId)
      .single();

    if (profile) {
      await upsertConnectionCache({
        id: conn.id,
        user_id: otherUserId,
        display_name: profile.display_name,
        public_key: profile.public_key,
        status: conn.status,
        updated_at: conn.updated_at,
      });
    }
  }
}
