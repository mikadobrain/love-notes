import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
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
    // 1. Create auth user
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password });
    if (signUpError) return { error: new Error(signUpError.message) };
    if (!data.user) return { error: new Error('Registrierung fehlgeschlagen') };

    // 2. Generate E2E key pair and store locally
    const publicKey = await generateAndStoreKeyPair();

    // 3. Create profile with public key
    const { error: profileError } = await supabase.from('profiles').insert({
      id: data.user.id,
      display_name: displayName,
      public_key: publicKey,
      email_hash: null, // Will be set via Edge Function for privacy
    });

    if (profileError) {
      console.error('Profile creation error:', profileError);
      return { error: new Error('Profil konnte nicht erstellt werden: ' + profileError.message) };
    }

    return { error: null };
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
