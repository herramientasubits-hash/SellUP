'use client';

/**
 * AgentRunsTray — las búsquedas del Agente IA en curso, en una bandeja flotante
 * minimizable tipo «descargas de Google Drive» (AGENT1-PARALLEL-RUNS-TRAY-1).
 *
 * Vive en el shell, no en el chat: cerrar o minimizar el asistente no pierde la
 * corrida. Se monta con portal a `document.body` porque `<main>` entra con una
 * transformación que ancla `position: fixed` (Foundation § 12), y queda en `z-40`,
 * por debajo de drawers (`z-50`), del panel del agente (`z-[51]`) y de diálogos.
 * No es una barra de acciones: no lleva botones de selección ni compite con la
 * barra flotante de la pantalla.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ChevronDown, ChevronUp, X } from '@/icons';
import { Button } from '@/components/ui/button';
import { UploadProgress } from '@/components/upload/UploadProgress';
import { cn } from '@/lib/utils';
import {
  RUN_PROGRESS_FALLBACK_LABEL,
  nextRunProgressPercent,
  type RunProgressStage,
} from '@/modules/prospect-batches/chat-wizard-execution/run-progress';
import type { AgentRun } from '@/modules/prospect-batches/agent-runs/agent-runs-store';
import {
  fetchAgentRunsStatus,
  getAgentRunsStore,
  useAgentRuns,
} from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import {
  AGENT_RUNS_TRAY_COPY,
  describeAgentRun,
  isDetachedRunFinished,
} from './agent-runs-tray-copy';

/** Cada cuánto se pregunta por la etapa de las corridas en curso. */
const POLL_MS = 2_000;

type LiveProgress = { stage: RunProgressStage | null; label: string; percent: number };

function useLiveProgress(runs: readonly AgentRun[]): Record<string, LiveProgress> {
  const [live, setLive] = React.useState<Record<string, LiveProgress>>({});
  const activeIds = runs.filter((run) => run.status === 'running').map((run) => run.clientRequestId);
  const key = activeIds.join(',');

  React.useEffect(() => {
    if (key.length === 0) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ids = key.split(',');

    const tick = async () => {
      try {
        const statuses = await fetchAgentRunsStatus(ids);
        if (cancelled) return;
        setLive((previous) => {
          const next = { ...previous };
          for (const status of statuses) {
            const before = previous[status.clientRequestId];
            const stage = status.progress?.stage ?? null;
            next[status.clientRequestId] = {
              stage,
              label: status.progress?.label ?? before?.label ?? RUN_PROGRESS_FALLBACK_LABEL,
              percent: nextRunProgressPercent(before?.percent ?? 5, stage),
            };
          }
          return next;
        });
        // Corridas lanzadas en una carga anterior de la página: su respuesta ya
        // no llega aquí, así que se cierran cuando su lote deja de generar.
        const store = getAgentRunsStore();
        for (const status of statuses) {
          const run = runs.find((r) => r.clientRequestId === status.clientRequestId);
          if (run?.detached && isDetachedRunFinished(status)) {
            store?.settleDetached(status.clientRequestId, {
              status: status.batch?.status === 'failed' ? 'failed' : 'succeeded',
              batchId: status.batch?.id ?? null,
            });
          }
        }
      } catch {
        // Sin red un momento: se reintenta en el siguiente ciclo.
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // `runs` se lee dentro sólo para cerrar las desligadas; la clave manda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return live;
}

function RunRow({ run, live }: { run: AgentRun; live: LiveProgress | undefined }) {
  const view = describeAgentRun(run, live?.label ?? null);
  const percent = run.status === 'running' ? (live?.percent ?? 5) : run.status === 'queued' ? 0 : 100;
  const store = getAgentRunsStore();

  return (
    <li className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-b-0">
      <UploadProgress
        value={percent}
        status={view.progressStatus}
        label={run.title}
        description={view.description}
        error={view.error}
        showValue={run.status === 'running'}
      />
      {(view.showLink || view.dismissible) && (
        <div className="flex items-center justify-end gap-2">
          {view.showLink && run.redirectPath && (
            <Button asChild size="sm" variant="outline">
              <Link href={run.redirectPath}>{AGENT_RUNS_TRAY_COPY.openBatch}</Link>
            </Button>
          )}
          {view.dismissible && (
            <Button size="sm" variant="ghost" onClick={() => store?.dismiss(run.clientRequestId)}>
              {AGENT_RUNS_TRAY_COPY.dismiss}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

const subscribeNothing = () => () => {};

/**
 * Ancho del panel del Agente IA cuando está abierto: el panel ESTRECHA la página
 * por la derecha, así que la bandeja se corre a su izquierda en vez de taparlo.
 */
function useAgentPanelWidth(): number {
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const slot = document.querySelector<HTMLElement>('[data-slot="shell-agent-panel"]');
    if (!slot || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setWidth(slot.getBoundingClientRect().width));
    // ResizeObserver avisa al empezar a observar: no hace falta medir aparte.
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);
  return width;
}

export function AgentRunsTray() {
  const runs = useAgentRuns();
  const live = useLiveProgress(runs);
  const panelWidth = useAgentPanelWidth();
  const [minimized, setMinimized] = React.useState(false);
  // En el servidor no hay `document`: el portal sólo se pinta en el navegador.
  const mounted = React.useSyncExternalStore(subscribeNothing, () => true, () => false);

  if (!mounted || runs.length === 0) return null;

  const active = runs.filter((run) => run.status === 'running' || run.status === 'queued').length;
  const allFinished = active === 0;
  const store = getAgentRunsStore();

  return createPortal(
    <section
      aria-label={AGENT_RUNS_TRAY_COPY.regionLabel}
      style={panelWidth > 0 ? { right: `calc(${Math.round(panelWidth)}px + 1.5rem)` } : undefined}
      className={cn(
        'fixed bottom-24 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-rail',
        'lg:bottom-6 lg:right-6 animate-su-fade-in',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{AGENT_RUNS_TRAY_COPY.title(active, runs.length)}</h2>
          {!minimized && <p className="text-xs text-muted-foreground">{AGENT_RUNS_TRAY_COPY.subtitle}</p>}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={minimized ? AGENT_RUNS_TRAY_COPY.expand : AGENT_RUNS_TRAY_COPY.minimize}
          aria-expanded={!minimized}
          onClick={() => setMinimized((value) => !value)}
        >
          {minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        {allFinished && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={AGENT_RUNS_TRAY_COPY.closeAll}
            onClick={() => store?.dismissFinished()}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </header>
      {!minimized && (
        <ul className="max-h-[50vh] overflow-y-auto">
          {runs.map((run) => (
            <RunRow key={run.clientRequestId} run={run} live={live[run.clientRequestId]} />
          ))}
        </ul>
      )}
    </section>,
    document.body,
  );
}
