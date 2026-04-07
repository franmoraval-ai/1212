'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useMemo, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import type { Session as SupabaseSession, User as SupabaseUser } from '@supabase/supabase-js';
import { normalizePermissions, type CustomPermission } from '@/lib/access-control';
import { fetchInternalApi } from '@/lib/internal-api';

const SESSION_BACKUP_STORAGE_KEY = 'ho_auth_session_backup_v1';
const USER_CACHE_STORAGE_KEY = 'ho_auth_user_cache_v1';

type StoredSessionBackup = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
  updatedAt: string;
};

function readStoredSessionBackup(): StoredSessionBackup | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(SESSION_BACKUP_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredSessionBackup>;
    const accessToken = String(parsed.accessToken ?? '').trim();
    const refreshToken = String(parsed.refreshToken ?? '').trim();
    if (!accessToken || !refreshToken) return null;

    return {
      accessToken,
      refreshToken,
      expiresAt: Number.isFinite(parsed.expiresAt) ? Number(parsed.expiresAt) : null,
      updatedAt: String(parsed.updatedAt ?? '').trim() || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function persistStoredSessionBackup(session: SupabaseSession | null) {
  if (typeof window === 'undefined') return;

  const accessToken = String(session?.access_token ?? '').trim();
  const refreshToken = String(session?.refresh_token ?? '').trim();
  if (!accessToken || !refreshToken) return;

  try {
    window.localStorage.setItem(SESSION_BACKUP_STORAGE_KEY, JSON.stringify({
      accessToken,
      refreshToken,
      expiresAt: Number.isFinite(session?.expires_at) ? Number(session?.expires_at) : null,
      updatedAt: new Date().toISOString(),
    } satisfies StoredSessionBackup));
  } catch {
    // Ignorar fallos de almacenamiento local para no bloquear el flujo auth.
  }
}

function clearStoredSessionBackup() {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(SESSION_BACKUP_STORAGE_KEY);
  } catch {
    // Nada adicional que hacer si el navegador bloquea localStorage.
  }
}

function readCachedUser(): AppUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AppUser>;
    const uid = String(parsed.uid ?? '').trim();
    if (!uid) return null;
    return {
      uid,
      email: parsed.email ?? null,
      roleLevel: Number(parsed.roleLevel ?? 1),
      firstName: parsed.firstName ?? null,
      assigned: parsed.assigned ?? null,
      customPermissions: normalizePermissions(parsed.customPermissions),
    };
  } catch {
    return null;
  }
}

function writeCachedUser(user: AppUser) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(USER_CACHE_STORAGE_KEY, JSON.stringify(user));
  } catch { /* ignore */ }
}

function clearCachedUser() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(USER_CACHE_STORAGE_KEY);
  } catch { /* ignore */ }
}

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
  const cachedUser = useRef<AppUser | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [isUserLoading, setIsUserLoading] = useState(true);
  const [userError, setUserError] = useState<Error | null>(null);
  const [presenceEmail, setPresenceEmail] = useState<string | null>(null);
  const hasInitialUserRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    let syncRunId = 0;
    const bootCachedUser = readCachedUser();
    if (bootCachedUser) {
      cachedUser.current = bootCachedUser;
      hasInitialUserRef.current = true;
      setUser(bootCachedUser);
      setIsUserLoading(false);
    }

    const mapAuthUser = (u: SupabaseUser | null): AppUser | null =>
      u ? { uid: u.id, email: u.email ?? null, roleLevel: 1, firstName: null, assigned: null, customPermissions: [] } : null;

    const hydrateProfile = async (authUser: SupabaseUser | null) => {
      const mapped = mapAuthUser(authUser);
      if (!mapped) {
        return null;
      }

      const email = authUser?.email?.trim().toLowerCase() ?? null;
      if (!email) {
        return mapped;
      }

      try {
        const response = await fetchInternalApi(
          supabase,
          '/api/auth/profile',
          { method: 'GET' },
          { refreshIfMissingToken: false, retryOnUnauthorized: false }
        );
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          user?: {
            firstName?: string | null;
            roleLevel?: number;
            assigned?: string | null;
            customPermissions?: CustomPermission[];
          };
        };

        if (!response.ok) {
          if (isMounted) {
            setUserError(new Error(String(body.error ?? 'No se pudo cargar el perfil operativo.')));
          }
          return cachedUser.current ?? mapped;
        }

        const enriched = {
          ...mapped,
          firstName: body.user?.firstName ?? null,
          roleLevel: Number(body.user?.roleLevel ?? 1),
          assigned: body.user?.assigned ?? null,
          customPermissions: normalizePermissions(body.user?.customPermissions),
        };
        writeCachedUser(enriched);
        return enriched;
      } catch {
        // Network error (offline) — return cached profile or basic mapped user
        return cachedUser.current ?? mapped;
      }
    };

    const recoverSessionUser = async () => {
      try {
        const { data: currentSession } = await supabase.auth.getSession();
        if (currentSession.session?.user) {
          persistStoredSessionBackup(currentSession.session);
          return currentSession.session.user;
        }
      } catch {
        // Continuar al refresh explicito si la lectura actual de sesion falla.
      }

      const storedBackup = readStoredSessionBackup();
      if (storedBackup) {
        try {
          const { data: restoredSession, error: restoreError } = await supabase.auth.setSession({
            access_token: storedBackup.accessToken,
            refresh_token: storedBackup.refreshToken,
          });

          if (!restoreError && restoredSession.session?.user) {
            persistStoredSessionBackup(restoredSession.session);
            return restoredSession.session.user;
          }
        } catch {
          // Si falla la restauracion local, intentamos refresh explicito abajo.
        }
      }

      try {
        const { data: refreshedSession } = await supabase.auth.refreshSession();
        if (refreshedSession.session) {
          persistStoredSessionBackup(refreshedSession.session);
        }
        return refreshedSession.session?.user ?? null;
      } catch {
        clearStoredSessionBackup();
        return null;
      }
    };

    const syncSessionUser = async (sessionUser: SupabaseUser | null) => {
      const currentRunId = ++syncRunId;
      setUserError(null);

      if (!sessionUser) {
        // Only show loading spinner on first bootstrap, never on re-validations
        // (re-validations happen on visibilitychange / camera return and must NOT
        // unmount the dashboard or the user loses all in-progress form state).
        if (!hasInitialUserRef.current && !cachedUser.current && isMounted) {
          setIsUserLoading(true);
        }
        sessionUser = await recoverSessionUser();
      }

      setPresenceEmail(sessionUser?.email?.trim().toLowerCase() ?? null);

      if (!sessionUser) {
        if (!isMounted || currentRunId !== syncRunId) return;
        // Offline with cached user — keep the cached user active instead of clearing
        if (cachedUser.current && !navigator.onLine) {
          hasInitialUserRef.current = true;
          setUser(cachedUser.current);
          setIsUserLoading(false);
          return;
        }
        hasInitialUserRef.current = true;
        setUser(null);
        clearCachedUser();
        setIsUserLoading(false);
        return;
      }

      if (!hasInitialUserRef.current && !cachedUser.current && isMounted) {
        setIsUserLoading(true);
      }

      const hydratedUser = await hydrateProfile(sessionUser);
      if (!isMounted || currentRunId !== syncRunId) return;

      hasInitialUserRef.current = true;
      setUser(hydratedUser);
      if (hydratedUser) {
        cachedUser.current = hydratedUser;
        // Ask service worker to prefetch dashboard routes for offline use
        if (navigator.serviceWorker?.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'PREFETCH_DASHBOARD' });
        }
      }
      setIsUserLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        persistStoredSessionBackup(session);
      } else if (event === 'SIGNED_OUT') {
        clearStoredSessionBackup();
        clearCachedUser();
        cachedUser.current = null;
      }

      void syncSessionUser(session?.user ?? null);
    });

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void supabase.auth.getSession().then(async ({ data: { session }, error }) => {
        if (error && isMounted) setUserError(error);
        if (session?.user) {
          persistStoredSessionBackup(session);
          return;
        }
        await syncSessionUser(null);
      }).catch(() => {
        // Offline during visibility change — keep current state.
      });
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    void supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error && isMounted) setUserError(error);
      if (session) {
        persistStoredSessionBackup(session);
      }
      await syncSessionUser(session?.user ?? null);
    }).catch(async () => {
      // getSession itself failed (offline or corrupted storage)
      // If we have a cached user, keep it; otherwise syncSessionUser(null) handles fallback.
      if (isMounted) {
        await syncSessionUser(null);
      }
    });

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const email = presenceEmail?.trim().toLowerCase() ?? null;
    if (!email) return;

    let cancelled = false;
    let heartbeatTimer: number | null = null;

    const markPresence = async (online: boolean) => {
      try {
        const response = await fetchInternalApi(supabase, '/api/personnel/presence', {
          method: 'POST',
          body: JSON.stringify({ online }),
        }, {
          refreshIfMissingToken: false,
          retryOnUnauthorized: false,
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
      if (document.visibilityState !== 'visible') return;
      void markPresence(true);
    }, 300000);

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
