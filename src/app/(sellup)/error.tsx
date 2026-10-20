'use client';

/**
 * Error de una pantalla de SellUp. Reemplaza el «This page couldn't load» de Next.
 *
 * Caso más común (dueña 19-10): la página se abrió antes de un deploy y después llamó
 * al servidor nuevo. Ese caso se arregla recargando, así que se recarga sola una vez.
 * La marca en sessionStorage evita que se recargue en bucle si el error es otro.
 */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { AlertTriangle, RefreshCw } from '@/icons';
import { isVersionSkewError } from '@/lib/version-skew';

const AUTO_RELOAD_KEY = 'sellup:auto-reload-after-deploy';
const AUTO_RELOAD_WINDOW_MS = 60_000;

function reloadedRecently(nowMs: number): boolean {
  try {
    const at = Number(window.sessionStorage.getItem(AUTO_RELOAD_KEY));
    return Number.isFinite(at) && nowMs - at < AUTO_RELOAD_WINDOW_MS;
  } catch {
    return true;
  }
}

export default function SellUpError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const skew = isVersionSkewError(error);

  React.useEffect(() => {
    console.error('[sellup] error de pantalla:', error);
    const now = Date.now();
    if (!skew || reloadedRecently(now)) return;
    try {
      window.sessionStorage.setItem(AUTO_RELOAD_KEY, String(now));
    } catch {
      return;
    }
    window.location.reload();
  }, [error, skew]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl items-center p-6">
      <EmptyState
        icon={AlertTriangle}
        title={skew ? 'Hay una versión nueva de SellUp' : 'No pudimos cargar esta pantalla'}
        description={
          skew
            ? 'Recargamos la página para traer la versión nueva. Lo que estaba en curso sigue guardado.'
            : 'Puede ser un problema momentáneo. Vuelve a intentarlo; si sigue pasando, avísanos.'
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => window.location.reload()}>
              <RefreshCw />
              Recargar
            </Button>
            {!skew && (
              <Button variant="outline" onClick={() => reset()}>
                Intentar de nuevo
              </Button>
            )}
          </div>
        }
      />
    </main>
  );
}
