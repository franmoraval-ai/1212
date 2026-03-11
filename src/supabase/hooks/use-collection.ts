'use client';

import { useState, useEffect, useRef } from 'react';
import { useSupabase } from '@/supabase/provider';

export type WithId<T> = T & { id: string };

export interface UseCollectionOptions {
  orderBy?: string;
  orderDesc?: boolean;
  select?: string;
  realtime?: boolean;
  pollingMs?: number;
}

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: Error | null;
}

export function useCollection<T = Record<string, unknown>>(
  tableName: string | null | undefined,
  options: UseCollectionOptions = {}
): UseCollectionResult<T> {
  const { supabase, user } = useSupabase();
  const userUid = user?.uid ?? null;
  const shouldFetch = Boolean(tableName && userUid);
  const [data, setData] = useState<WithId<T>[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    if (!shouldFetch || !tableName) return;

    let isActive = true;
    let requestInFlight = false;
    let realtimeRefreshTimer: number | null = null;
    const realtimeEnabled = options.realtime !== false;
    const pollingMs = Math.max(0, Number(options.pollingMs ?? 60000));

    const buildQuery = () => {
      let query = supabase.from(tableName).select(options.select ?? '*');
      if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: !options.orderDesc });
      }
      return query;
    };

    /** Convierte filas de Supabase (snake_case) a camelCase; timestamps a { toDate } para compatibilidad */
    const mapRow = (r: Record<string, unknown>): WithId<T> => {
      const out: Record<string, unknown> = {};
      const timestampKeys = ['created_at', 'updated_at', 'entry_time', 'exit_time', 'last_check', 'time', 'timestamp', 'synced_at'];
      for (const [k, v] of Object.entries(r)) {
        const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
        if (timestampKeys.includes(k) && v) {
          out[camel] = { toDate: () => new Date(v as string) };
        } else {
          out[camel] = v;
        }
      }
      out.id = r.id;
      return out as WithId<T>;
    };

    const fetchData = async (withLoading = false) => {
      if (requestInFlight) return;
      requestInFlight = true;
      if (withLoading) setIsLoading(true);
      setError(null);
      const { data: rows, error: err } = await buildQuery();
      if (!isActive) {
        requestInFlight = false;
        return;
      }
      if (err) {
        setError(err);
        setData(null);
      } else {
        setData((rows ?? []).map((r: any) => mapRow(r as Record<string, unknown>)));
      }
      hasLoadedOnceRef.current = true;
      if (withLoading) setIsLoading(false);
      requestInFlight = false;
    };

    // Solo mostrar loading fuerte en la primera carga real del hook.
    void fetchData(!hasLoadedOnceRef.current);

    const channel = realtimeEnabled
      ? supabase
          .channel(`public:${tableName}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, (payload) => {
            if (payload.eventType === 'DELETE') {
              const deletedId = String((payload.old as { id?: string } | null)?.id ?? '');
              if (deletedId) {
                setData((prev) => (prev ? prev.filter((row) => row.id !== deletedId) : prev));
              }
            }

            if (realtimeRefreshTimer !== null) {
              window.clearTimeout(realtimeRefreshTimer);
            }
            realtimeRefreshTimer = window.setTimeout(() => {
              realtimeRefreshTimer = null;
              void fetchData(false);
            }, 250);
          })
          .subscribe()
      : null;

    // Respaldo: refresco periódico cuando Realtime no entrega eventos.
    // Evitamos polling agresivo para reducir la sensacion de recarga continua.
    const pollInterval = pollingMs > 0
      ? window.setInterval(() => {
          if (document.visibilityState !== 'visible') return;
          void fetchData(false);
        }, pollingMs)
      : null;

    return () => {
      isActive = false;
      if (realtimeRefreshTimer !== null) {
        window.clearTimeout(realtimeRefreshTimer);
      }
      if (pollInterval !== null) {
        window.clearInterval(pollInterval);
      }
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [
    tableName,
    shouldFetch,
    supabase,
    userUid,
    options.orderBy,
    options.orderDesc,
    options.select,
    options.realtime,
    options.pollingMs,
  ]);

  return {
    data: shouldFetch ? data : null,
    isLoading: shouldFetch ? isLoading : false,
    error: shouldFetch ? error : null,
  };
}
