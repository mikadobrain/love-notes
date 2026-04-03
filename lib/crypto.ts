import nacl from 'tweetnacl';
import {
  decodeUTF8,
  encodeUTF8,
  encodeBase64,
  decodeBase64,
} from 'tweetnacl-util';
import * as SecureStore from 'expo-secure-store';

const KEY_PAIR_PUBLIC = 'lovenotes_public_key';
const KEY_PAIR_SECRET = 'lovenotes_secret_key';

export type KeyPair = {
  publicKey: string; // Base64 encoded
  secretKey: string; // Base64 encoded
};

/**
 * Generate a new NaCl key pair and store it securely.
 * Returns the public key (base64) for uploading to the server.
 */
export async function generateAndStoreKeyPair(): Promise<string> {
  const keyPair = nacl.box.keyPair();
  const publicKeyB64 = encodeBase64(keyPair.publicKey);
  const secretKeyB64 = encodeBase64(keyPair.secretKey);

  await SecureStore.setItemAsync(KEY_PAIR_PUBLIC, publicKeyB64);
  await SecureStore.setItemAsync(KEY_PAIR_SECRET, secretKeyB64);

  return publicKeyB64;
}

/**
 * Get the stored key pair. Returns null if not yet generated.
 */
export async function getKeyPair(): Promise<KeyPair | null> {
  const publicKey = await SecureStore.getItemAsync(KEY_PAIR_PUBLIC);
  const secretKey = await SecureStore.getItemAsync(KEY_PAIR_SECRET);

  if (!publicKey || !secretKey) return null;
  return { publicKey, secretKey };
}

/**
 * Get just the public key (for sharing with the server).
 */
export async function getPublicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_PAIR_PUBLIC);
}

/**
 * Encrypt a message for a specific recipient using authenticated encryption.
 * Uses NaCl crypto_box: sender's secret key + recipient's public key.
 *
 * The recipient can verify the sender's identity because only the sender's
 * secret key could have produced this ciphertext for the recipient's public key.
 *
 * @param message - Plaintext message to encrypt
 * @param recipientPublicKeyB64 - Recipient's public key (base64)
 * @param senderSecretKeyB64 - Sender's secret key (base64)
 * @returns Base64-encoded encrypted payload (nonce + ciphertext)
 */
export function encryptMessage(
  message: string,
  recipientPublicKeyB64: string,
  senderSecretKeyB64: string
): string {
  const messageBytes = decodeUTF8(message);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const recipientPublicKey = decodeBase64(recipientPublicKeyB64);
  const senderSecretKey = decodeBase64(senderSecretKeyB64);

  const encrypted = nacl.box(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderSecretKey
  );

  if (!encrypted) {
    throw new Error('Encryption failed');
  }

  // Combine nonce + ciphertext for transport
  const fullMessage = new Uint8Array(nonce.length + encrypted.length);
  fullMessage.set(nonce);
  fullMessage.set(encrypted, nonce.length);

  return encodeBase64(fullMessage);
}

/**
 * Decrypt a message from a specific sender using authenticated encryption.
 * Uses NaCl crypto_box.open: recipient's secret key + sender's public key.
 *
 * @param encryptedPayloadB64 - Base64-encoded encrypted payload (nonce + ciphertext)
 * @param senderPublicKeyB64 - Sender's public key (base64)
 * @param recipientSecretKeyB64 - Recipient's secret key (base64)
 * @returns Decrypted plaintext message
 */
export function decryptMessage(
  encryptedPayloadB64: string,
  senderPublicKeyB64: string,
  recipientSecretKeyB64: string
): string {
  const fullMessage = decodeBase64(encryptedPayloadB64);
  const nonce = fullMessage.slice(0, nacl.box.nonceLength);
  const ciphertext = fullMessage.slice(nacl.box.nonceLength);
  const senderPublicKey = decodeBase64(senderPublicKeyB64);
  const recipientSecretKey = decodeBase64(recipientSecretKeyB64);

  const decrypted = nacl.box.open(
    ciphertext,
    nonce,
    senderPublicKey,
    recipientSecretKey
  );

  if (!decrypted) {
    throw new Error(
      'Decryption failed – message may be tampered with or wrong sender key'
    );
  }

  return encodeUTF8(decrypted);
}

/**
 * Encrypt a message payload for transport.
 * Includes metadata (sender name, anonymity flag) in the encrypted payload.
 */
export function encryptNotePayload(
  message: string,
  senderName: string | null, // null = anonymous
  recipientPublicKeyB64: string,
  senderSecretKeyB64: string
): string {
  const payload = JSON.stringify({
    message,
    senderName,
    timestamp: new Date().toISOString(),
  });

  return encryptMessage(payload, recipientPublicKeyB64, senderSecretKeyB64);
}

/**
 * Decrypt a note payload and extract the message and metadata.
 */
export function decryptNotePayload(
  encryptedPayloadB64: string,
  senderPublicKeyB64: string,
  recipientSecretKeyB64: string
): { message: string; senderName: string | null; timestamp: string } {
  const json = decryptMessage(
    encryptedPayloadB64,
    senderPublicKeyB64,
    recipientSecretKeyB64
  );
  return JSON.parse(json);
}
