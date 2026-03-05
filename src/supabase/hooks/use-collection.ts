'use client';

import { useState, useEffect } from 'react';
import { useSupabase } from '@/supabase/provider';

export type WithId<T> = T & { id: string };

export interface UseCollectionOptions {
  orderBy?: string;
  orderDesc?: boolean;
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
  const shouldFetch = Boolean(tableName && user);
  const [data, setData] = useState<WithId<T>[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!shouldFetch || !tableName) return;

    let isActive = true;

    const buildQuery = () => {
      let query = supabase.from(tableName).select('*');
      if (options.orderBy) {
        query = query.order(options.orderBy, { ascending: !options.orderDesc });
      }
      return query;
    };

    /** Convierte filas de Supabase (snake_case) a camelCase; timestamps a { toDate } para compatibilidad */
    const mapRow = (r: Record<string, unknown>): WithId<T> => {
      const out: Record<string, unknown> = {};
      const timestampKeys = ['created_at', 'updated_at', 'entry_time', 'exit_time', 'last_check', 'time'];
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
      if (withLoading) setIsLoading(true);
      setError(null);
      const { data: rows, error: err } = await buildQuery();
      if (!isActive) return;
      if (err) {
        setError(err);
        setData(null);
      } else {
        setData((rows ?? []).map((r: any) => mapRow(r as Record<string, unknown>)));
      }
      if (withLoading) setIsLoading(false);
    };

    fetchData(true);

    const channel = supabase
      .channel(`public:${tableName}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const deletedId = String((payload.old as { id?: string } | null)?.id ?? '');
          if (deletedId) {
            setData((prev) => (prev ? prev.filter((row) => row.id !== deletedId) : prev));
          }
        }

        void fetchData(false);
      })
      .subscribe();

    return () => {
      isActive = false;
      supabase.removeChannel(channel);
    };
  }, [tableName, shouldFetch, supabase, user, options.orderBy, options.orderDesc]);

  return {
    data: shouldFetch ? data : null,
    isLoading: shouldFetch ? isLoading : false,
    error: shouldFetch ? error : null,
  };
}
