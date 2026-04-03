import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { supabase, Profile } from './supabase';
import { generateAndStoreKeyPair, getPublicKey } from './crypto';

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

  // Listen for auth state changes
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setIsLoading(false);
      }
    });

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
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
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching profile:', error);
      }
      setProfile(data as Profile | null);

      // Always verify key pair is present and in sync on every login
      if (data) {
        ensureKeyPair(userId);
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshProfile() {
    if (session?.user) {
      await fetchProfile(session.user.id);
    }
  }

  async function signInWithEmail(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? new Error(error.message) : null };
  }

  async function signUpWithEmail(email: string, password: string, displayName: string) {
    // 1. Create auth user – a DB trigger auto-creates the profile row
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    });
    if (signUpError) return { error: new Error(signUpError.message) };
    if (!data.user) return { error: new Error('Registrierung fehlgeschlagen') };

    // 2. Generate E2E key pair and store on device
    const publicKey = await generateAndStoreKeyPair();

    // 3. Hash email for searchability
    const emailHash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      email.trim().toLowerCase()
    );

    // 4. Update the profile (trigger created it) with display_name + public key
    // Retry a couple of times in case the trigger hasn't committed yet
    let updateError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { error } = await supabase.from('profiles').update({
        display_name: displayName,
        public_key: publicKey,
        email_hash: emailHash,
      }).eq('id', data.user.id);
      if (!error) { updateError = null; break; }
      updateError = error;
      await new Promise(r => setTimeout(r, 500));
    }

    if (updateError) {
      console.error('Profile update error:', updateError);
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
    try {
      const deviceKey = await getPublicKey();
      console.log('[ensureKeyPair] deviceKey present:', !!deviceKey);

      let keyToUpload: string;

      if (!deviceKey) {
        // Key lost (reinstall / phone swap) → generate new key pair
        keyToUpload = await generateAndStoreKeyPair();
        console.log('[ensureKeyPair] Generated new key pair');
      } else {
        // Check if DB matches device key
        const { data: profile, error: fetchError } = await supabase
          .from('profiles')
          .select('public_key')
          .eq('id', userId)
          .single();

        if (fetchError) {
          console.error('[ensureKeyPair] profile fetch error:', fetchError);
          return;
        }
        if (!profile) return;

        if (profile.public_key && profile.public_key === deviceKey) {
          console.log('[ensureKeyPair] Key already in sync, nothing to do');
          return; // already in sync
        }
        keyToUpload = deviceKey;
        console.log('[ensureKeyPair] DB key out of sync, uploading device key');
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ public_key: keyToUpload })
        .eq('id', userId);

      if (updateError) {
        console.error('[ensureKeyPair] UPDATE failed:', JSON.stringify(updateError));
      } else {
        console.log('[ensureKeyPair] Public key uploaded successfully');
      }
    } catch (e) {
      console.error('[ensureKeyPair] unexpected error:', e);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
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
