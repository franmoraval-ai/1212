'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { normalizePermissions, type CustomPermission } from '@/lib/access-control';

/** Usuario compatible con la interfaz que usaba Firebase (user.uid) */
export interface AppUser {
  uid: string;
  email?: string | null;
  roleLevel: number;
  firstName?: string | null;
  assigned?: string | null;
  customPermissions: CustomPermission[];
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
  const [presenceEmail, setPresenceEmail] = useState<string | null>(null);

  useEffect(() => {
    const mapAuthUser = (u: SupabaseUser | null): AppUser | null =>
      u ? { uid: u.id, email: u.email ?? null, roleLevel: 1, firstName: null, assigned: null, customPermissions: [] } : null;

    const hydrateProfile = async (authUser: SupabaseUser | null) => {
      const mapped = mapAuthUser(authUser);
      if (!mapped) {
        setUser(null);
        return;
      }

      const email = authUser?.email ?? null;
      if (!email) {
        setUser(mapped);
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('first_name, role_level, assigned, custom_permissions')
        .eq('email', email)
        .limit(1)
        .maybeSingle();

      if (error) {
        setUser(mapped);
        setUserError(error);
        return;
      }

      setUser({
        ...mapped,
        firstName: (data?.first_name as string | null | undefined) ?? null,
        roleLevel: Number(data?.role_level ?? 1),
        assigned: (data?.assigned as string | null | undefined) ?? null,
        customPermissions: normalizePermissions(data?.custom_permissions),
      });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextEmail = session?.user?.email ?? null;
      setPresenceEmail(nextEmail);
      void hydrateProfile(session?.user ?? null);
      setUserError(null);
      setIsUserLoading(false);
    });

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      setPresenceEmail(session?.user?.email ?? null);
      void hydrateProfile(session?.user ?? null);
      if (error) setUserError(error);
      setIsUserLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const email = presenceEmail?.trim().toLowerCase() ?? null;
    if (!email) return;

    let cancelled = false;
    let heartbeatTimer: number | null = null;

    const getPresenceHeaders = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      let accessToken = String(sessionData.session?.access_token ?? '').trim();
      if (!accessToken) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        accessToken = String(refreshed.session?.access_token ?? '').trim();
      }

      return {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      };
    };

    const markPresence = async (online: boolean) => {
      try {
        const headers = await getPresenceHeaders();
        const response = await fetch('/api/personnel/presence', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ online }),
        });
        if (!cancelled && !response.ok && response.status !== 401) {
          setUserError(new Error('No se pudo actualizar presencia.'));
        }
      } catch (error) {
        if (!cancelled) {
          setUserError(error instanceof Error ? error : new Error('No se pudo actualizar presencia.'));
        }
      }
    };

    void markPresence(true);
    heartbeatTimer = window.setInterval(() => {
      void markPresence(true);
    }, 60000);

    const onBeforeUnload = () => {
      // Best-effort: si el navegador soporta sendBeacon, evita perder el estado al cerrar.
      if (navigator.sendBeacon) {
        const payload = new Blob([
          JSON.stringify({ email, online: false, at: new Date().toISOString() })
        ], { type: 'application/json' });
        navigator.sendBeacon('/api/personnel/presence-offline', payload);
      } else {
        void markPresence(false);
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      cancelled = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (heartbeatTimer != null) {
        window.clearInterval(heartbeatTimer);
      }
      void markPresence(false);
    };
  }, [presenceEmail]);

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
