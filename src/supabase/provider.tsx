'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';

/** Usuario compatible con la interfaz que usaba Firebase (user.uid) */
export interface AppUser {
  uid: string;
  email?: string | null;
}

interface SupabaseContextValue {
  supabase: typeof supabase;
  user: AppUser | null;
  isUserLoading: boolean;
  userError: Error | null;
}

const SupabaseContext = createContext<SupabaseContextValue | undefined>(undefined);

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);
  const [userError, setUserError] = useState<Error | null>(null);

  useEffect(() => {
    const mapUser = (u: SupabaseUser | null): AppUser | null =>
      u ? { uid: u.id, email: u.email ?? null } : null;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(mapUser(session?.user ?? null));
      setUserError(null);
      setIsUserLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      setUser(mapUser(session?.user ?? null));
      if (error) setUserError(error);
      setIsUserLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const value = useMemo(
    () => ({
      supabase,
      user,
      isUserLoading,
      userError,
    }),
    [user, isUserLoading, userError]
  );

  return (
    <SupabaseContext.Provider value={value}>
      {children}
    </SupabaseContext.Provider>
  );
}

export function useSupabase() {
  const ctx = useContext(SupabaseContext);
  if (ctx === undefined) throw new Error('useSupabase must be used within SupabaseProvider');
  return ctx;
}

export function useUser() {
  const { user, isUserLoading, userError } = useSupabase();
  return { user, isUserLoading, userError };
}
