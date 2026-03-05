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
  const [data, setData] = useState<WithId<T>[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!tableName || !user) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    let query = supabase.from(tableName).select('*');
    if (options.orderBy) {
      query = query.order(options.orderBy, { ascending: !options.orderDesc });
    }

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

    const fetchData = async () => {
      const { data: rows, error: err } = await query;
      if (err) {
        setError(err);
        setData(null);
      } else {
        setData((rows ?? []).map((r: any) => mapRow(r as Record<string, unknown>)));
      }
      setIsLoading(false);
    };

    fetchData();

    const channel = supabase
      .channel(`public:${tableName}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: tableName }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tableName, user?.uid, options.orderBy, options.orderDesc]);

  return { data, isLoading, error };
}
