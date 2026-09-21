'use client';

/**
 * wizard-apollo-continuation-panel.tsx — la continuación, CONECTADA a la
 * pantalla.
 *
 * AGENT1-APOLLO-CONTINUATION-WIZARD-WIRING § 2.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * El corte anterior dejó los cuatro estados y la acción de servidor escritos y
 * probados… y sin un solo consumidor. `resolveApolloContinuationUiStatus` no lo
 * llamaba ninguna pantalla y `continueApolloRound` no lo llamaba nadie, así que
 * la única continuación real era el cron DIARIO: una corrida que se pausaba se
 * anunciaba como «no encontramos empresas nuevas» y podía tardar un día en
 * retomarse sin que nada en pantalla lo dijera.
 *
 * Este panel es ese consumidor. Mientras la ventana está abierta CONDUCE la
 * continuación del MISMO lote —una vuelta tras otra, respetando la espera que
 * el servidor indica— y al reabrir RECUPERA el trabajo pendiente en vez de
 * empezar otra corrida.
 *
 * ── Lo que NO hace ───────────────────────────────────────────────────────────
 *
 * 🔴 No inicia búsquedas. Sus dos únicas llamadas son la lectura del estado y
 * `continueApolloRound`, que reanuda trabajo YA pagado y encolado. No hay rama
 * aquí capaz de crear una corrida nueva ni de autorizar gasto.
 *
 * 🔴 No es la autoridad de exclusión mutua. El lease de la cola lo es: si el
 * cron u otra pestaña tienen el trabajo, la acción vuelve sin resolución y esta
 * pantalla se limita a esperar. Por eso las vueltas sin reclamo están ACOTADAS
 * (`MAX_UNCLAIMED_ROUNDS`): insistir contra un trabajo que tiene otro no lo
 * acelera, sólo añade ruido.
 */

import * as React from 'react';
import { AlertCircle, CheckCircle2, Loader2, PauseCircle } from 'lucide-react';

import {
  continueApolloRound,
  findPendingApolloContinuation,
} from '@/modules/prospect-batches/apollo-continuation-actions';
import {
  APOLLO_CONTINUATION_BROWSER_CLOSED_NOTE,
  APOLLO_CONTINUATION_IN_SESSION_NOTE,
  APOLLO_CONTINUATION_PANEL_TITLE,
  APOLLO_CONTINUATION_STATUS_COPY,
  APOLLO_CONTINUATION_TRANSPORT_ERROR_COPY,
  isApolloContinuationTerminal,
  type ApolloContinuationUiStatus,
} from '@/modules/prospect-batches/apollo-continuation-status';

/** Espera por defecto cuando el servidor no indica ninguna. */
const FALLBACK_RETRY_MS = 2_000;

/**
 * Vueltas seguidas SIN reclamar antes de dejar de insistir.
 *
 * Una vuelta sin reclamo significa que el trabajo lo tiene otro. Reintentar
 * indefinidamente no lo acelera: el lease es de quien lo tomó. Se para y se deja
 * el estado guardado a la vista, que es lo honesto.
 */
const MAX_UNCLAIMED_ROUNDS = 5;

type ContinuationView =
  /** Todavía no se sabe nada: no se pinta para no parpadear. */
  | { readonly kind: 'unknown' }
  /** No hay trabajo pendiente que conducir. No se pinta. */
  | { readonly kind: 'inactive' }
  /** Hay —o hubo— trabajo: se pinta el estado. */
  | {
      readonly kind: 'active';
      readonly batchId: string;
      readonly status: ApolloContinuationUiStatus;
      /** El último intento no llegó al servidor. */
      readonly transportError: boolean;
    };

export type WizardApolloContinuationPanelProps = {
  /**
   * La corrida de ESTA sesión acaba de terminar EN PAUSA.
   *
   * 🔴 Es una SEÑAL, no un identificador. El cliente nunca nombra el lote que
   * se va a continuar: lo resuelve el servidor desde la cola durable, que es su
   * única autoridad. Un `batchId` viajando desde el navegador sería una
   * petición de «continúa este otro», y no hay motivo para abrir esa puerta.
   *
   * Al cambiar de `false` a `true`, la pantalla vuelve a preguntar. En cualquier
   * otro momento —abrir el mago, reabrirlo— basta con la pregunta de montaje.
   */
  pausedRunSignal?: boolean;
};

export function WizardApolloContinuationPanel({
  pausedRunSignal = false,
}: WizardApolloContinuationPanelProps) {
  const [view, setView] = React.useState<ContinuationView>({ kind: 'unknown' });

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, ms));
      });

    async function drive(): Promise<void> {
      // §§ 2, 3 — la MISMA pregunta sirve para las dos situaciones: la corrida
      // que acaba de pausarse en esta sesión y la que quedó a medias en otra.
      // Devuelve un lote que YA tiene trabajo encolado; nunca crea uno.
      const pending = await findPendingApolloContinuation();
      if (cancelled) return;
      if (pending === null) {
        // Sin trabajo pendiente no se estrena ningún cartel: una corrida normal
        // no tiene por qué enterarse de que esto existe.
        setView({ kind: 'inactive' });
        return;
      }

      const target = pending.batchId;
      setView({ kind: 'active', batchId: target, status: pending.status, transportError: false });
      if (isApolloContinuationTerminal(pending.status)) return;

      let unclaimedRounds = 0;
      while (!cancelled) {
        let outcome: Awaited<ReturnType<typeof continueApolloRound>>;
        try {
          outcome = await continueApolloRound(target);
        } catch {
          // El servidor no contestó. NO es un trabajo agotado: el trabajo sigue
          // en la cola. Se para —un bucle apretado contra un servidor caído es
          // una tormenta— y se dice exactamente eso.
          if (!cancelled) {
            setView({ kind: 'active', batchId: target, status: 'failed', transportError: true });
          }
          return;
        }
        if (cancelled) return;

        if (outcome.status === 'forbidden') {
          setView({ kind: 'inactive' });
          return;
        }

        setView({
          kind: 'active',
          batchId: target,
          status: outcome.status,
          transportError: false,
        });
        if (isApolloContinuationTerminal(outcome.status)) return;

        // Sin reclamo el trabajo lo tiene otro: se cuenta y se acota.
        const unclaimed =
          outcome.status === 'pending_continuation' && outcome.pendingOrganizationCount === 0;
        unclaimedRounds = unclaimed ? unclaimedRounds + 1 : 0;
        if (unclaimedRounds >= MAX_UNCLAIMED_ROUNDS) return;

        await sleep(outcome.retryAfterMs ?? FALLBACK_RETRY_MS);
      }
    }

    void drive();

    return () => {
      // Cerrar la ventana no cancela el trabajo: cancela esta pantalla. La cola
      // es durable y el cron sigue siendo la red de seguridad.
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [pausedRunSignal]);

  if (view.kind !== 'active') return null;

  const isFailure = view.status === 'failed';
  const isFinished = view.status === 'finished';
  const body = view.transportError
    ? APOLLO_CONTINUATION_TRANSPORT_ERROR_COPY
    : APOLLO_CONTINUATION_STATUS_COPY[view.status];

  const tone = isFailure
    ? 'border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/10'
    : isFinished
      ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-900/10'
      : 'border-border bg-card';

  return (
    <section
      className={`space-y-2 rounded-xl border px-5 py-4 ${tone}`}
      data-testid="wizard-apollo-continuation"
      data-continuation-status={view.status}
      data-continuation-batch-id={view.batchId}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <ContinuationIcon status={view.status} />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {isFinished ? 'Corrida completada' : APOLLO_CONTINUATION_PANEL_TITLE}
          </p>
          <p
            className="text-xs text-muted-foreground"
            data-testid="wizard-apollo-continuation-body"
          >
            {body}
          </p>
        </div>
      </div>

      {!isFinished && !isFailure && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          {APOLLO_CONTINUATION_IN_SESSION_NOTE}
        </p>
      )}
      {!isFinished && (
        <p
          className="text-[10px] leading-snug text-muted-foreground"
          data-testid="wizard-apollo-continuation-browser-note"
        >
          {APOLLO_CONTINUATION_BROWSER_CLOSED_NOTE}
        </p>
      )}
    </section>
  );
}

function ContinuationIcon({ status }: { status: ApolloContinuationUiStatus }) {
  if (status === 'finished') {
    return (
      <CheckCircle2
        className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
        aria-hidden
      />
    );
  }
  if (status === 'failed') {
    return (
      <AlertCircle
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
    );
  }
  if (status === 'processing') {
    return <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-su-brand" aria-hidden />;
  }
  return <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />;
}
