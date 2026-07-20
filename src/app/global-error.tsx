"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <div className="min-h-screen flex items-center justify-center bg-[#030303]">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-white mb-4">Error</h1>
            <p className="text-muted-foreground mb-6">Algo salió mal</p>
            <button
              onClick={() => reset()}
              className="px-4 py-2 bg-primary text-black rounded hover:bg-primary/90"
            >
              Intentar nuevamente
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
