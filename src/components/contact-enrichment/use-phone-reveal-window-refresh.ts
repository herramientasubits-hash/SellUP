'use client';

import * as React from 'react';
import {
  shouldRefreshOnWindowSignal,
  PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS,
} from './phone-reveal-drawer-sync-core';

export interface UsePhoneRevealWindowRefreshInput {
  /** `true` sólo cuando el drawer está abierto. Cerrado no se suscribe a nada. */
  readonly open: boolean;
  /** Candidato abierto. Sin candidato no hay nada que releer. */
  readonly candidateId: string | null;
  /**
   * Refetch silencioso del candidato ya abierto (`reloadCandidate`). Lectura de la
   * base de SellUp: NO llama a proveedores, NO inicia reveals, NO ejecuta recovery
   * y NO escribe usage logs.
   */
  readonly reload: () => Promise<void>;
}

/**
 * Relee el candidato abierto cuando el usuario VUELVE a la pestaña
 * (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 7).
 *
 * Por qué existe: el refresco acotado de LIVE-REFRESH-1 dura 90 s y Apollo puede
 * tardar más. Quien deja el drawer abierto, se va a otra pestaña y vuelve diez
 * minutos después estaba viendo un estado congelado — y el reveal ya había
 * terminado en la base. Volver a la pestaña es la señal natural de "mírame otra
 * vez", así que es el momento correcto para una única lectura.
 *
 * Lo que NO es: polling. No hay timers ni intervalos aquí. Sólo reacciona a dos
 * eventos del navegador (`focus` y `visibilitychange`) y cada disparo pasa por la
 * ventana mínima de `shouldRefreshOnWindowSignal`, así que un cambio de pestaña
 * —que suele emitir las dos señales casi a la vez— produce UNA lectura, no una
 * ráfaga. La decisión vive en el núcleo puro; aquí sólo están los listeners.
 *
 * Seguridad de estado: el guard de "ya hay uno en vuelo" evita solapamientos, y el
 * flag de desmontaje corta cualquier trabajo pendiente para que no se escriba
 * estado después de que el componente desaparezca.
 */
export function usePhoneRevealWindowRefresh({
  open,
  candidateId,
  reload,
}: UsePhoneRevealWindowRefreshInput): void {
  // Marca del último refresco por señal de ventana. En un ref (no en estado):
  // actualizarla no debe provocar un render, y el debounce necesita leer el valor
  // vigente dentro del handler, no el capturado en el render anterior.
  const lastRefreshAtRef = React.useRef<number | null>(null);
  const refreshingRef = React.useRef(false);

  // El callback más reciente sin re-suscribir los listeners en cada render:
  // `reload` es un `useCallback` que cambia de identidad con sus dependencias, y
  // resuscribirse por eso reiniciaría el debounce.
  const reloadRef = React.useRef(reload);
  React.useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  React.useEffect(() => {
    if (!open || !candidateId) return;
    // Cada apertura (u cambio de candidato) arranca con su ventana limpia: la
    // primera señal siempre puede refrescar.
    lastRefreshAtRef.current = null;

    let unmounted = false;

    const handleSignal = () => {
      if (unmounted) return;
      // `visibilitychange` también se emite al OCULTAR la pestaña: ese caso no es
      // "el usuario volvió" y no debe gastar el turno de la ventana mínima.
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'hidden'
      ) {
        return;
      }
      const now = Date.now();
      const allowed = shouldRefreshOnWindowSignal({
        open: true,
        candidateId,
        lastRefreshAtMs: lastRefreshAtRef.current,
        nowMs: now,
      });
      if (!allowed) return;
      if (refreshingRef.current) return;
      // La marca se fija ANTES del await: si no, dos señales en el mismo tick
      // pasarían las dos por el debounce antes de que la primera terminara.
      lastRefreshAtRef.current = now;
      refreshingRef.current = true;
      void (async () => {
        try {
          await reloadRef.current();
        } catch {
          // Silencioso: el refresco es best-effort y nunca rompe el drawer.
        } finally {
          refreshingRef.current = false;
        }
      })();
    };

    window.addEventListener('focus', handleSignal);
    document.addEventListener('visibilitychange', handleSignal);
    return () => {
      unmounted = true;
      window.removeEventListener('focus', handleSignal);
      document.removeEventListener('visibilitychange', handleSignal);
    };
  }, [open, candidateId]);
}

export { PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS };
