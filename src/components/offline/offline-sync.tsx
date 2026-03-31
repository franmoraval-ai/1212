"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useSupabase } from "@/supabase";
import { useToast } from "@/hooks/use-toast";
import { flushOfflineMutations, getDroppedOfflineQueueSize, getDroppedOfflineQueueSummary, getOfflineQueueSize, OFFLINE_MUTATIONS_CHANGED_EVENT } from "@/lib/offline-mutations";
import { flushOfflineRoundSessionOperations, getDroppedOfflineRoundSessionQueueSize, getDroppedOfflineRoundSessionQueueSummary, getOfflineRoundSessionQueueSize, OFFLINE_ROUND_SESSION_OPS_CHANGED_EVENT } from "@/lib/offline-round-session-ops";

export function OfflineSync() {
  const { supabase } = useSupabase();
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(() => (typeof window === "undefined" ? true : window.navigator.onLine));
  const [mutationPending, setMutationPending] = useState(() => getOfflineQueueSize());
  const [sessionPending, setSessionPending] = useState(() => getOfflineRoundSessionQueueSize());
  const [droppedPending, setDroppedPending] = useState(() => getDroppedOfflineQueueSize() + getDroppedOfflineRoundSessionQueueSize());
  const [droppedSummary, setDroppedSummary] = useState(() => getDroppedOfflineQueueSummary());
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const pending = mutationPending + sessionPending;

  const shouldShowBanner = useMemo(() => !isOnline || pending > 0 || droppedPending > 0, [isOnline, pending, droppedPending]);

  useEffect(() => {
    const refreshPending = () => {
      setMutationPending(getOfflineQueueSize());
      setSessionPending(getOfflineRoundSessionQueueSize());
      setDroppedPending(getDroppedOfflineQueueSize() + getDroppedOfflineRoundSessionQueueSize());
      setDroppedSummary(getDroppedOfflineQueueSummary());
    };

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
    window.addEventListener(OFFLINE_MUTATIONS_CHANGED_EVENT, refreshPending);
    window.addEventListener(OFFLINE_ROUND_SESSION_OPS_CHANGED_EVENT, refreshPending);
    const timer = window.setInterval(refreshPending, 15000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener(OFFLINE_MUTATIONS_CHANGED_EVENT, refreshPending);
      window.removeEventListener(OFFLINE_ROUND_SESSION_OPS_CHANGED_EVENT, refreshPending);
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
        const sessionResult = await flushOfflineRoundSessionOperations(supabase);
        const mutationResult = await flushOfflineMutations(supabase);
        if (cancelled) return;
        setMutationPending(mutationResult.pending);
        setSessionPending(sessionResult.pending);
        setDroppedPending(getDroppedOfflineQueueSize() + getDroppedOfflineRoundSessionQueueSize());
        setDroppedSummary(getDroppedOfflineQueueSummary());
        if (sessionResult.synced + mutationResult.synced > 0) {
          toast({
            title: "Sincronizacion completada",
            description: `${sessionResult.synced + mutationResult.synced} operación(es) sincronizadas desde modo offline.`,
          });
        }
        if (sessionResult.dropped + mutationResult.dropped > 0) {
          const summaryText = [
            ...getDroppedOfflineQueueSummary().map((item) => `${item.table}: ${item.count}`),
            ...getDroppedOfflineRoundSessionQueueSummary().map((item) => `session_${item.kind}: ${item.count}`),
          ].join(" | ");
          toast({
            title: "Items movidos a revisión",
            description: summaryText
              ? `${sessionResult.dropped + mutationResult.dropped} registro(s) no pudieron sincronizarse. ${summaryText}`
              : `${sessionResult.dropped + mutationResult.dropped} registro(s) no pudieron sincronizarse y quedaron guardados para revisión local.`,
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
        {isOnline && droppedPending > 0 && (
          <span>
            En revisión local: {droppedPending}
            {droppedSummary.length > 0 ? ` (${droppedSummary.map((item) => `${item.table}:${item.count}`).join(" | ")})` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
