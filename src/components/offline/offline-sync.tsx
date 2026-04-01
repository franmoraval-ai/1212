"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSupabase } from "@/supabase";
import { useToast } from "@/hooks/use-toast";
import { clearDroppedOfflineQueue, flushOfflineMutations, getDroppedOfflineQueueItems, getDroppedOfflineQueueSize, getDroppedOfflineQueueSummary, getOfflineQueueSize, OFFLINE_MUTATIONS_CHANGED_EVENT, removeDroppedOfflineQueueItem } from "@/lib/offline-mutations";
import { clearDroppedOfflineRoundSessionQueue, flushOfflineRoundSessionOperations, getDroppedOfflineRoundSessionQueueItems, getDroppedOfflineRoundSessionQueueSize, getDroppedOfflineRoundSessionQueueSummary, getOfflineRoundSessionQueueSize, OFFLINE_ROUND_SESSION_OPS_CHANGED_EVENT, removeDroppedOfflineRoundSessionQueueItem } from "@/lib/offline-round-session-ops";

type ReviewQueueItem = {
  id: string;
  source: "mutation" | "round-session";
  title: string;
  droppedAt: string;
  reason: string;
  payload: unknown;
  meta: string;
};

function formatLocalDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Sin fecha" : parsed.toLocaleString();
}

function stringifyPreview(value: unknown) {
  if (value == null) return "Sin payload";
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized.length > 900 ? `${serialized.slice(0, 900)}\n...` : serialized;
  } catch {
    return "Payload no serializable";
  }
}

export function OfflineSync() {
  const { supabase } = useSupabase();
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(() => (typeof window === "undefined" ? true : window.navigator.onLine));
  const [mutationPending, setMutationPending] = useState(() => getOfflineQueueSize());
  const [sessionPending, setSessionPending] = useState(() => getOfflineRoundSessionQueueSize());
  const [droppedPending, setDroppedPending] = useState(() => getDroppedOfflineQueueSize() + getDroppedOfflineRoundSessionQueueSize());
  const [droppedSummary, setDroppedSummary] = useState(() => getDroppedOfflineQueueSummary());
  const [droppedRoundSessionSummary, setDroppedRoundSessionSummary] = useState(() => getDroppedOfflineRoundSessionQueueSummary());
  const [reviewItems, setReviewItems] = useState<ReviewQueueItem[]>(() => []);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const pending = mutationPending + sessionPending;
  const reviewSummaryText = useMemo(() => {
    const mutationItems = droppedSummary.map((item) => `${item.table}:${item.count}`);
    const sessionItems = droppedRoundSessionSummary.map((item) => `session_${item.kind}:${item.count}`);
    return [...mutationItems, ...sessionItems].join(" | ");
  }, [droppedRoundSessionSummary, droppedSummary]);

  const shouldShowBanner = useMemo(() => !isOnline || pending > 0 || droppedPending > 0, [isOnline, pending, droppedPending]);

  useEffect(() => {
    const refreshPending = () => {
      setMutationPending(getOfflineQueueSize());
      setSessionPending(getOfflineRoundSessionQueueSize());
      setDroppedPending(getDroppedOfflineQueueSize() + getDroppedOfflineRoundSessionQueueSize());
      setDroppedSummary(getDroppedOfflineQueueSummary());
      setDroppedRoundSessionSummary(getDroppedOfflineRoundSessionQueueSummary());
      setReviewItems([
        ...getDroppedOfflineQueueItems().map((item) => ({
          id: item.id,
          source: "mutation" as const,
          title: `${item.table} • ${item.action}`,
          droppedAt: item.droppedAt,
          reason: item.dropReason,
          payload: item.payload ?? item.match ?? null,
          meta: item.match ? `Filtro: ${JSON.stringify(item.match)}` : `Creado: ${formatLocalDateTime(item.createdAt)}`,
        })),
        ...getDroppedOfflineRoundSessionQueueItems().map((item) => ({
          id: item.id,
          source: "round-session" as const,
          title: `session_${item.kind}`,
          droppedAt: item.droppedAt,
          reason: item.dropReason,
          payload: item.payload,
          meta: `Sesion: ${item.sessionId}`,
        })),
      ]);
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
        setDroppedRoundSessionSummary(getDroppedOfflineRoundSessionQueueSummary());
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

  const handleRemoveReviewItem = (item: ReviewQueueItem) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(`Se descartará este item local de revisión (${item.title}). Esta acción no se puede deshacer.`);
      if (!confirmed) return;
    }

    if (item.source === "mutation") {
      removeDroppedOfflineQueueItem(item.id);
    } else {
      removeDroppedOfflineRoundSessionQueueItem(item.id);
    }

    toast({
      title: "Item descartado",
      description: `${item.title} se eliminó de la revisión local de este dispositivo.`,
    });
  };

  const handleClearReview = () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Se eliminarán todos los items en revisión local de este dispositivo. Esta acción no se puede deshacer.");
      if (!confirmed) return;
    }

    clearDroppedOfflineQueue();
    clearDroppedOfflineRoundSessionQueue();
    toast({
      title: "Revision local limpiada",
      description: "Se eliminaron los items caídos guardados en este dispositivo.",
    });
    setReviewOpen(false);
  };

  if (!shouldShowBanner) return null;

  return (
    <>
      <div className="fixed bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded border border-white/10 bg-black/85 px-3 py-2 backdrop-blur-md">
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
              {reviewSummaryText ? ` (${reviewSummaryText})` : ""}
            </span>
          )}
        </div>
        {droppedPending > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-white/15 bg-white/5 px-2 text-[10px] font-black uppercase tracking-wider text-white hover:bg-white/10"
            onClick={() => setReviewOpen(true)}
          >
            Revisar
          </Button>
        )}
      </div>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden border-white/10 bg-[#060606] text-white">
          <DialogHeader>
            <DialogTitle>Revision local del dispositivo</DialogTitle>
            <DialogDescription className="text-white/65">
              Estos registros no subieron y quedaron guardados solo en este navegador. Puede inspeccionarlos y descartarlos si ya no hacen falta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 overflow-y-auto pr-1">
            {reviewItems.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                No hay items pendientes en revision local.
              </div>
            ) : (
              reviewItems.map((item) => (
                <div key={`${item.source}-${item.id}`} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black uppercase tracking-wide text-white">{item.title}</p>
                      <p className="text-[11px] uppercase tracking-wide text-white/45">{item.source === "mutation" ? "Mutacion offline" : "Sesion de ronda offline"}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      className="h-8 px-2 text-[10px] font-black uppercase tracking-wider"
                      onClick={() => handleRemoveReviewItem(item)}
                    >
                      Descartar
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-white/70 sm:grid-cols-2">
                    <p><span className="font-semibold text-white/85">Caido:</span> {formatLocalDateTime(item.droppedAt)}</p>
                    <p><span className="font-semibold text-white/85">Detalle:</span> {item.meta}</p>
                  </div>
                  <p className="mt-2 text-xs text-amber-300">{item.reason || "Sin motivo registrado."}</p>
                  <pre className="mt-3 overflow-x-auto rounded-md border border-white/10 bg-black/50 p-3 text-[11px] leading-5 text-white/75">
                    {stringifyPreview(item.payload)}
                  </pre>
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => setReviewOpen(false)}>
              Cerrar
            </Button>
            <Button type="button" variant="destructive" onClick={handleClearReview} disabled={reviewItems.length === 0}>
              Limpiar revision local
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
