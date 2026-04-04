import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Secure token storage adapter for Supabase Auth
// Uses expo-secure-store on native, localStorage on web
const SecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key);
    }
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};

// TODO: Replace with your Supabase project credentials
// These should be set via environment variables or a config file
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'YOUR_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // Important for React Native
  },
});

// Type definitions for our Supabase tables
export type Profile = {
  id: string;
  phone_hash: string | null;
  email_hash: string | null;
  display_name: string;
  public_key: string;
  fcm_token: string | null;
  created_at: string;
};

export type Connection = {
  id: string;
  requester_id: string;
  target_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  updated_at: string;
};

export type MessageQueueItem = {
  id: string;
  recipient_id: string;
  encrypted_payload: string;
  sender_public_key: string | null; // stored at send-time so key rotations don't break decryption
  created_at: string;
  delivered: boolean;
};
