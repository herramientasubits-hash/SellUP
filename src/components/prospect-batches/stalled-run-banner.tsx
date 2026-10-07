'use client';

/**
 * StalledRunBanner — aviso en la página del lote cuando su corrida quedó a medias
 * (AGENT1-STUCK-RUNS-CLOSE-1). Dueña 07-10: «que dentro del lote tenga un botón
 * de continuar o terminar».
 *
 *   · `paused`  — hay una continuación en cola: «Continuar» (abre el Centro de
 *     procesos, que la conduce) o «Terminar».
 *   · `stalled` — «generando» sin movimiento y sin continuación: sólo «Terminar».
 *
 * «Terminar» no llama a ningún proveedor: cierra la cola del lote y deja lo
 * encontrado listo para revisar.
 */

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  APOLLO_CONTINUATION_RETRY_EVENT,
  finishAgentRunViaRoute,
} from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import { AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray';

export const STALLED_RUN_BANNER_COPY = {
  pausedTitle: 'Esta búsqueda quedó a medias',
  pausedBody:
    'Encontró empresas pero no terminó. Puedes continuar con lo que falta (puede usar créditos de Apollo) o terminarla y quedarte con lo encontrado.',
  stalledTitle: 'Esta búsqueda se detuvo',
  stalledBody: 'Lleva más de 30 minutos sin avanzar. Termínala para revisar lo que encontró; no gasta créditos.',
  resume: 'Continuar',
  finish: 'Terminar lote',
  finishing: 'Terminando…',
  error: 'No se pudo terminar. Inténtalo de nuevo.',
} as const;

export function StalledRunBanner({ batchId, attention }: { batchId: string; attention: 'paused' | 'stalled' }) {
  const router = useRouter();
  const [finishing, setFinishing] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const finish = async () => {
    setFinishing(true);
    setFailed(false);
    try {
      await finishAgentRunViaRoute(batchId);
      window.dispatchEvent(new Event(APOLLO_CONTINUATION_RETRY_EVENT));
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setFinishing(false);
    }
  };

  const resume = () => {
    window.dispatchEvent(new Event(APOLLO_CONTINUATION_RETRY_EVENT));
    window.dispatchEvent(new Event(AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT));
  };

  const paused = attention === 'paused';
  return (
    <Alert variant="warning" className="animate-su-fade-in motion-reduce:animate-none" data-testid="stalled-run-banner">
      <AlertTitle className="text-sm">
        {paused ? STALLED_RUN_BANNER_COPY.pausedTitle : STALLED_RUN_BANNER_COPY.stalledTitle}
      </AlertTitle>
      <AlertDescription className="space-y-3 text-xs">
        <p>{paused ? STALLED_RUN_BANNER_COPY.pausedBody : STALLED_RUN_BANNER_COPY.stalledBody}</p>
        <div className="flex flex-wrap items-center gap-2">
          {paused && (
            <Button size="sm" variant="outline" onClick={resume} data-testid="stalled-run-resume">
              {STALLED_RUN_BANNER_COPY.resume}
            </Button>
          )}
          <Button size="sm" onClick={() => void finish()} disabled={finishing} data-testid="stalled-run-finish">
            {finishing ? STALLED_RUN_BANNER_COPY.finishing : STALLED_RUN_BANNER_COPY.finish}
          </Button>
        </div>
        {failed && (
          <p className="text-destructive" role="alert">
            {STALLED_RUN_BANNER_COPY.error}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
