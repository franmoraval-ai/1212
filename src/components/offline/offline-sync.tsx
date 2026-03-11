"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useSupabase } from "@/supabase";
import { useToast } from "@/hooks/use-toast";
import { flushOfflineMutations, getOfflineQueueSize } from "@/lib/offline-mutations";

export function OfflineSync() {
  const { supabase } = useSupabase();
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(() => (typeof window === "undefined" ? true : window.navigator.onLine));
  const [pending, setPending] = useState(() => getOfflineQueueSize());
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const shouldShowBanner = useMemo(() => !isOnline || pending > 0, [isOnline, pending]);

  useEffect(() => {
    const refreshPending = () => setPending(getOfflineQueueSize());

    const handleOnline = () => {
      setIsOnline(true);
      refreshPending();
    };
    const handleOffline = () => {
      setIsOnline(false);
      refreshPending();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    const timer = window.setInterval(refreshPending, 3000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    if (pending <= 0) return;

    let cancelled = false;
    const syncOnce = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      try {
        const result = await flushOfflineMutations(supabase);
        if (cancelled) return;
        setPending(result.pending);
        if (result.synced > 0) {
          toast({
            title: "Sincronizacion completada",
            description: `${result.synced} registro(s) sincronizados desde modo offline.`,
          });
        }
        if (result.dropped > 0) {
          toast({
            title: "Items descartados de cola",
            description: `${result.dropped} registro(s) no pudieron sincronizarse tras varios intentos.`,
            variant: "destructive",
          });
        }
      } catch {
        if (cancelled) return;
        toast({
          title: "Error de sincronizacion",
          description: "Reintentaremos automaticamente en unos segundos.",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) {
          setSyncing(false);
        }
        syncingRef.current = false;
      }
    };

    void syncOnce();
    const retryTimer = window.setInterval(() => {
      void syncOnce();
    }, 8000);

    return () => {
      cancelled = true;
      syncingRef.current = false;
      window.clearInterval(retryTimer);
    };
  }, [isOnline, pending, supabase, toast]);

  if (!shouldShowBanner) return null;

  return (
    <div className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded border border-white/10 bg-black/85 px-3 py-2 backdrop-blur-md">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-white">
        {isOnline ? <Wifi className="h-3.5 w-3.5 text-green-400" /> : <WifiOff className="h-3.5 w-3.5 text-red-400" />}
        {!isOnline && <span>Sin senal: guardando en cola local</span>}
        {isOnline && pending > 0 && (
          <>
            <RefreshCw className={`h-3.5 w-3.5 text-primary ${syncing ? "animate-spin" : ""}`} />
            <span>{syncing ? "Sincronizando" : "Pendientes por sincronizar"}: {pending}</span>
          </>
        )}
      </div>
    </div>
  );
}
