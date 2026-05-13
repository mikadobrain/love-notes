import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { supabase, Profile } from './supabase';
import { generateAndStoreKeyPair, getPublicKey } from './crypto';
import { Logger } from './logger';
import { getSetting, clearLocalData } from './db';
import { syncConnections, fetchAndProcessMessages } from './sync';
import { scheduleRandomNoteNotification } from './notifications';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  isLoading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithEmail: (email: string, password: string, displayName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: load debug mode from SQLite so it's active from the first log line
  useEffect(() => {
    getSetting('debug_mode').then((val) => {
      Logger.setDebugMode(val === '1');
    }).catch(() => {/* ignore – DB may not be ready yet */});
  }, []);

  // Listen for auth state changes
  useEffect(() => {
    Logger.debug('auth', 'AuthProvider: initializing, loading session...');

    supabase.auth.getSession().then(({ data: { session } }) => {
      Logger.debug('auth', 'AuthProvider: initial session loaded', {
        hasSession: !!session,
        userId: session?.user?.id,
      });
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        Logger.info('auth', 'AuthProvider: no existing session, showing login');
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        Logger.debug('auth', 'onAuthStateChange', { event: _event, userId: session?.user?.id });
        setSession(session);
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
          setIsLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string) {
    Logger.debug('auth', 'fetchProfile', { userId });
    try {
      Logger.setUser(userId);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        Logger.error('auth', 'fetchProfile: Supabase error', {
          error: error.message,
          code: error.code,
          userId,
        });
      }

      if (data) {
        Logger.info('auth', 'fetchProfile: profile loaded', {
          displayName: data.display_name,
          hasPublicKey: !!data.public_key,
        });
        setProfile(data as Profile | null);
        ensureKeyPair(userId);
        // Background startup sync: pull connections + incoming messages
        // so the user's "Postfach" is up to date immediately after login.
        backgroundStartupSync(userId, data.display_name);
      } else {
        Logger.warn('auth', 'fetchProfile: no profile found for user', { userId });
        setProfile(null);
      }
    } catch (err) {
      Logger.error('auth', 'fetchProfile: unexpected error', {
        error: err instanceof Error ? err.message : String(err),
        userId,
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshProfile() {
    if (session?.user) {
      Logger.debug('auth', 'refreshProfile triggered');
      await fetchProfile(session.user.id);
    }
  }

  async function signInWithEmail(email: string, password: string) {
    Logger.info('auth', 'signInWithEmail: attempt', { email });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      Logger.warn('auth', 'signInWithEmail: failed', { error: error.message });
    } else {
      Logger.info('auth', 'signInWithEmail: success', { email });
    }
    return { error: error ? new Error(error.message) : null };
  }

  async function signUpWithEmail(email: string, password: string, displayName: string) {
    Logger.info('auth', 'signUpWithEmail: attempt', { email, displayName });

    // 1. Create auth user – a DB trigger auto-creates the profile row
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });

    if (signUpError) {
      Logger.error('auth', 'signUpWithEmail: auth.signUp failed', { error: signUpError.message });
      return { error: new Error(signUpError.message) };
    }
    if (!data.user) {
      Logger.error('auth', 'signUpWithEmail: no user returned');
      return { error: new Error('Registrierung fehlgeschlagen') };
    }

    Logger.info('auth', 'signUpWithEmail: auth user created', { userId: data.user.id });

    // 2. Generate E2E key pair and store on device
    Logger.debug('auth', 'signUpWithEmail: generating key pair...');
    const publicKey = await generateAndStoreKeyPair();
    Logger.debug('auth', 'signUpWithEmail: key pair generated', {
      keyPrefix: publicKey.substring(0, 10),
    });

    // 3. Hash email for searchability
    const emailHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      email.trim().toLowerCase()
    );
    Logger.debug('auth', 'signUpWithEmail: email hashed');

    // 4. Update the profile (trigger created it) with display_name + public key
    // Retry a couple of times in case the trigger hasn't committed yet
    let updateError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      Logger.debug('auth', `signUpWithEmail: profile update attempt ${attempt + 1}`);
      const { error } = await supabase.from('profiles').update({
        display_name: displayName,
        public_key: publicKey,
        email_hash: emailHash,
      }).eq('id', data.user.id);

      if (!error) {
        updateError = null;
        Logger.info('auth', 'signUpWithEmail: profile updated successfully', {
          attempt: attempt + 1,
          userId: data.user.id,
        });
        break;
      }
      updateError = error;
      Logger.warn('auth', `signUpWithEmail: profile update attempt ${attempt + 1} failed`, {
        error: error.message,
        code: error.code,
      });
      await new Promise(r => setTimeout(r, 500));
    }

    if (updateError) {
      Logger.error('auth', 'signUpWithEmail: all profile update attempts failed', {
        error: updateError.message,
        userId: data.user.id,
      });
      // Non-fatal: user can still log in, key will be uploaded on next login
    }

    return { error: null };
  }

  /**
   * Ensures the device has a valid E2E key pair and that the public key
   * in the database matches the device's key.
   *
   * Handles three cases:
   * 1. First install / fresh signup → generates key, uploads it
   * 2. Reinstall / phone swap → device has no key → generates new key, rotates in DB
   *    (old messages become unreadable – this is unavoidable without cloud key backup)
   * 3. Normal login → device key matches DB → no-op
   */
  async function ensureKeyPair(userId: string) {
    Logger.debug('auth', 'ensureKeyPair: checking device key...', { userId });
    try {
      const deviceKey = await getPublicKey();
      Logger.debug('auth', 'ensureKeyPair: device key status', { hasDeviceKey: !!deviceKey });

      let keyToUpload: string;

      if (!deviceKey) {
        Logger.warn('auth', 'ensureKeyPair: no device key found – generating new key pair (reinstall?)');
        keyToUpload = await generateAndStoreKeyPair();
        Logger.info('auth', 'ensureKeyPair: new key pair generated');
      } else {
        const { data: profile, error: fetchError } = await supabase
          .from('profiles')
          .select('public_key')
          .eq('id', userId)
          .single();

        if (fetchError) {
          Logger.error('auth', 'ensureKeyPair: profile fetch failed', {
            error: fetchError.message,
            userId,
          });
          return;
        }
        if (!profile) {
          Logger.warn('auth', 'ensureKeyPair: no profile row found', { userId });
          return;
        }

        if (profile.public_key && profile.public_key === deviceKey) {
          Logger.debug('auth', 'ensureKeyPair: key in sync, nothing to do');
          return;
        }

        Logger.warn('auth', 'ensureKeyPair: key mismatch – DB has different key, uploading device key', {
          dbKeyPrefix: profile.public_key?.substring(0, 10),
          deviceKeyPrefix: deviceKey.substring(0, 10),
        });
        keyToUpload = deviceKey;
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ public_key: keyToUpload })
        .eq('id', userId);

      if (updateError) {
        Logger.error('auth', 'ensureKeyPair: public key upload failed', {
          error: updateError.message,
          code: updateError.code,
          userId,
        });
      } else {
        Logger.info('auth', 'ensureKeyPair: public key uploaded successfully', {
          keyPrefix: keyToUpload.substring(0, 10),
          userId,
        });
      }
    } catch (e) {
      Logger.error('auth', 'ensureKeyPair: unexpected error', {
        error: e instanceof Error ? e.message : String(e),
        userId,
      });
    }
  }

  /**
   * Runs silently in the background on every login / app resume.
   * 1. Syncs connection cache (so we have sender public keys for decryption)
   * 2. Fetches & decrypts pending messages from the queue
   * 3. Schedules a local notification if new notes arrived
   */
  async function backgroundStartupSync(userId: string, displayName: string) {
    Logger.debug('auth', 'backgroundStartupSync: start', { userId });
    try {
      await syncConnections(userId, displayName);
      const newCount = await fetchAndProcessMessages(userId);
      Logger.info('auth', 'backgroundStartupSync: done', { newMessages: newCount });
      if (newCount > 0) {
        await scheduleRandomNoteNotification();
        Logger.info('auth', 'backgroundStartupSync: notification scheduled for new notes');
      }
    } catch (err) {
      Logger.error('auth', 'backgroundStartupSync: error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function signOut() {
    Logger.info('auth', 'signOut: user signing out');
    Logger.setUser(null);
    await clearLocalData();
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    Logger.debug('auth', 'signOut: complete');
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        isLoading,
        signInWithEmail,
        signUpWithEmail,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
