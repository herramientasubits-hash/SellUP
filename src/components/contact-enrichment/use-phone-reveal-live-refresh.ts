'use client';

import * as React from 'react';
import {
  resolveNextLiveRefreshDelayMs,
  PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS,
} from './phone-reveal-live-refresh-core';

export interface UsePhoneRevealLiveRefreshInput {
  /**
   * `true` solo cuando el drawer está abierto, hay candidato cargado, el reveal
   * sigue en vuelo y no hay teléfono ni acción de revisión en curso. La decisión
   * vive en `isPhoneRevealLiveRefreshEligible` (núcleo puro).
   */
  readonly enabled: boolean;
  /** Candidato abierto. Al cambiar, el ciclo anterior se cancela por completo. */
  readonly candidateId: string | null;
  /**
   * Refetch silencioso del candidato ya abierto (`reloadCandidate`). NO debe
   * llamar a proveedores ni iniciar reveals: solo relee la proyección de lectura.
   */
  readonly reload: () => Promise<void>;
}

/**
 * Refresco acotado del candidato mientras un Apollo Phone Reveal está en vuelo
 * (APOLLO-PHONE-REVEAL-LIVE-REFRESH-1).
 *
 * Programa refetch encadenados con `setTimeout` (nunca `setInterval`) mientras
 * `enabled` sea `true`, con un presupuesto total acotado. Devuelve si el refresco
 * sigue activo, para que la UI pueda decirlo sin inventarse su propio estado.
 *
 * Paradas obligatorias — todas cubiertas aquí:
 *  - `enabled` pasa a `false` (estado terminal, teléfono presente, drawer cerrado,
 *    aprobar/rechazar en curso),
 *  - cambia el `candidateId`,
 *  - se agota el presupuesto de tiempo,
 *  - el componente se desmonta (cleanup del efecto).
 *
 * Nunca hay dos refetch simultáneos: si uno sigue en curso cuando vence el timer,
 * ese tick se salta y se reprograma el siguiente.
 */
export function usePhoneRevealLiveRefresh({
  enabled,
  candidateId,
  reload,
}: UsePhoneRevealLiveRefreshInput): boolean {
  // Único estado del hook: si ESTE ciclo ya consumió su presupuesto. Se enciende
  // desde el callback del timer y se apaga en el cleanup (cuando el ciclo termina
  // por cambio de candidato, cierre o estado terminal), nunca en el cuerpo del
  // efecto — así "activo" queda DERIVADO y no hay renders en cascada.
  const [budgetExhausted, setBudgetExhausted] = React.useState(false);

  React.useEffect(() => {
    if (!enabled || !candidateId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let refreshing = false;
    let attempt = 0;
    let elapsedMs = 0;

    const schedule = () => {
      const delay = resolveNextLiveRefreshDelayMs(attempt, elapsedMs);
      // `null` = presupuesto agotado. Es la única salida por tiempo, y no vuelve
      // a programar nada: sin esto el encadenado sería un bucle infinito.
      if (delay === null) {
        if (!cancelled) setBudgetExhausted(true);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        if (cancelled) return;
        elapsedMs += delay;
        attempt += 1;
        void (async () => {
          // Si ya hay un refetch en vuelo (por ejemplo el que dispara el propio
          // reveal o la revisión manual), este tick no abre otro.
          if (!refreshing) {
            refreshing = true;
            try {
              await reload();
            } catch {
              // Silencioso: el refresco es best-effort y nunca rompe el panel.
            } finally {
              refreshing = false;
            }
          }
          if (cancelled) return;
          schedule();
        })();
      }, delay);
    };

    schedule();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      timer = null;
      // El ciclo terminó: el siguiente (otro candidato, o el mismo tras volver a
      // ser elegible) arranca con su presupuesto intacto.
      setBudgetExhausted(false);
    };
  }, [enabled, candidateId, reload]);

  return enabled && !!candidateId && !budgetExhausted;
}

export { PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS };
