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
import { ChevronDown, ChevronUp, ExternalLink, GripVertical, X } from '@/icons';
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
import { WizardApolloContinuationPanel } from '@/components/prospect-batches/chat-wizard/wizard-apollo-continuation-panel';
import { useDraggableTray } from './use-draggable-tray';
import { useRouter } from 'next/navigation';
import {
  agentRunsFallbackHref,
  requestOpenAgentRunsInChat,
} from '@/modules/prospect-batches/agent-runs/agent-chat-events';
import {
  AGENT_RUNS_TRAY_COPY,
  describeAgentRun,
  isDetachedRunFinished,
} from './agent-runs-tray-copy';

/** Cada cuánto se pregunta por la etapa de las corridas en curso. */
const POLL_MS = 2_000;

type LiveProgress = { stage: RunProgressStage | null; label: string; percent: number };

export function useLiveProgress(runs: readonly AgentRun[]): Record<string, LiveProgress> {
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

export function RunRow({ run, live }: { run: AgentRun; live: LiveProgress | undefined }) {
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

/** Evento para que el chat («Minimizar») despliegue la bandeja. */
export const AGENT_RUNS_TRAY_EXPAND_EVENT = 'sellup:agent-runs-tray:expand';

export function AgentRunsTray() {
  const runs = useAgentRuns();
  const live = useLiveProgress(runs);
  const panelWidth = useAgentPanelWidth();
  const [minimized, setMinimized] = React.useState(false);
  const [continuationActive, setContinuationActive] = React.useState(false);
  const { ref: trayRef, position: dragPosition, dragging, handlers: dragHandlers } = useDraggableTray();
  // En el servidor no hay `document`: el portal sólo se pinta en el navegador.
  const mounted = React.useSyncExternalStore(subscribeNothing, () => true, () => false);

  React.useEffect(() => {
    const expand = () => setMinimized(false);
    window.addEventListener(AGENT_RUNS_TRAY_EXPAND_EVENT, expand);
    return () => window.removeEventListener(AGENT_RUNS_TRAY_EXPAND_EVENT, expand);
  }, []);

  // AGENT1-RUNS-INSIDE-CHAT-1 — «ver todas» abre el CHAT en su pestaña
  // «Búsquedas» (no una pantalla aparte). Si esta pantalla no tiene el asistente,
  // lleva a Empresas y el cajón se abre ahí en esa pestaña.
  const router = useRouter();
  const openRunsInChat = React.useCallback(() => {
    if (!requestOpenAgentRunsInChat()) router.push(agentRunsFallbackHref());
  }, [router]);

  // Una corrida que termina EN PAUSA hace que la continuación vuelva a preguntar.
  const pausedRunSignal = runs.filter((run) => run.continuationPending).length;

  if (!mounted) return null;

  const active = runs.filter((run) => run.status === 'running' || run.status === 'queued').length;
  const allFinished = active === 0;
  const visible = runs.length > 0 || continuationActive;
  const store = getAgentRunsStore();
  const placement = dragPosition
    ? { left: dragPosition.x, top: dragPosition.y, right: 'auto', bottom: 'auto' }
    : panelWidth > 0
      ? { right: `calc(${Math.round(panelWidth)}px + 1.5rem)` }
      : undefined;

  return createPortal(
    <section
      ref={trayRef}
      aria-label={AGENT_RUNS_TRAY_COPY.regionLabel}
      hidden={!visible}
      style={placement}
      data-dragging={dragging || undefined}
      className={cn(
        'fixed bottom-24 right-4 z-40 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-rail',
        'lg:bottom-6 lg:right-6 animate-su-fade-in',
        dragging && 'select-none',
      )}
    >
      <header
        className={cn(
          'flex touch-none items-center gap-2 border-b border-border bg-muted/40 px-3 py-2.5',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        title={AGENT_RUNS_TRAY_COPY.dragHint}
        {...dragHandlers}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {runs.length > 0 ? AGENT_RUNS_TRAY_COPY.title(active, runs.length) : AGENT_RUNS_TRAY_COPY.continuationOnlyTitle}
          </h2>
          {!minimized && <p className="text-xs text-muted-foreground">{AGENT_RUNS_TRAY_COPY.subtitle}</p>}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={AGENT_RUNS_TRAY_COPY.openPage}
          title={AGENT_RUNS_TRAY_COPY.openPage}
          onClick={openRunsInChat}
          data-testid="agent-runs-tray-open-chat"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          aria-label={minimized ? AGENT_RUNS_TRAY_COPY.expand : AGENT_RUNS_TRAY_COPY.minimize}
          title={minimized ? AGENT_RUNS_TRAY_COPY.expand : AGENT_RUNS_TRAY_COPY.minimize}
          aria-expanded={!minimized}
          onClick={() => setMinimized((value) => !value)}
        >
          {minimized ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        {allFinished && runs.length > 0 && (
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            aria-label={AGENT_RUNS_TRAY_COPY.closeAll}
            title={AGENT_RUNS_TRAY_COPY.closeAll}
            onClick={() => store?.dismissFinished()}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </header>
      {/* La continuación se CONDUCE aunque la bandeja esté minimizada u oculta:
          por eso la lista se oculta con `hidden` y no se desmonta. */}
      <ul className="max-h-[50vh] overflow-y-auto" hidden={minimized}>
        <WizardApolloContinuationPanel
          variant="tray"
          pausedRunSignal={pausedRunSignal}
          onActiveChange={setContinuationActive}
        />
        {runs.map((run) => (
          <RunRow key={run.clientRequestId} run={run} live={live[run.clientRequestId]} />
        ))}
      </ul>
    </section>,
    document.body,
  );
}
