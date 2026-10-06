'use client';

/**
 * Las búsquedas del Agente IA en curso (AGENT1-PARALLEL-RUNS-TRAY-1): el Centro
 * de procesos de la cabecera, el sondeo de su avance y la fila que también usa la
 * página «Búsquedas».
 */

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Queue } from '@/icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Text } from '@/components/typography';
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
import {
  AGENT_RUNS_PAGE_PATH,
  AGENT_RUNS_TRAY_COPY,
  agentRunProcessState,
  describeAgentRun,
  isDetachedRunFinished,
  processCenterSummary,
  type ProcessState,
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

/** La baldosa dice el estado sin leer: con color si corre, verde si acabó, rojo si falló, gris si espera. */
const TILE_TONE: Record<ProcessState, string> = {
  running: 'bg-primary/10 text-primary',
  waiting: 'bg-surface-muted text-text-muted',
  done: 'bg-success/15 text-success',
  failed: 'bg-destructive/10 text-destructive',
};

const TILE_ICON: Record<ProcessState, React.ComponentType<{ className?: string }>> = {
  running: Queue,
  waiting: Queue,
  done: CheckCircle2,
  failed: AlertCircle,
};

function ProcessRow({ run, live, onAfterAction }: { run: AgentRun; live: LiveProgress | undefined; onAfterAction: () => void }) {
  const state = agentRunProcessState(run);
  const view = describeAgentRun(run, live?.label ?? null);
  const meta = view.error ?? view.description;
  const percent = live?.percent ?? 5;
  const Icon = TILE_ICON[state];

  return (
    <li className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', TILE_TONE[state])}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <Text size="sm" weight="medium" truncate title={run.title}>
          {run.title}
        </Text>
        {state === 'running' ? (
          // El detalle a la izquierda, el porcentaje a la derecha y el avance
          // debajo. El color de marca queda sólo aquí: significa progreso.
          <>
            <div className="flex items-baseline justify-between gap-2">
              <Text size="xs" tone="secondary" truncate title={meta}>
                {meta}
              </Text>
              <Text size="xs" weight="medium" tabular className="shrink-0">
                {Math.round(percent)}%
              </Text>
            </div>
            <Progress value={percent} aria-label={AGENT_RUNS_TRAY_COPY.progressOf(run.title)} className="h-1.5" />
          </>
        ) : (
          <Text size="xs" tone={state === 'failed' ? 'negative' : 'secondary'} className="line-clamp-2" title={meta}>
            {meta}
          </Text>
        )}
      </div>
      {/* La acción tiene columna propia: el título puede truncar sin moverla. */}
      {view.showLink && run.redirectPath && (
        <Button asChild size="sm" variant="outline" className="shrink-0 self-center">
          <Link href={run.redirectPath} onClick={onAfterAction}>
            {AGENT_RUNS_TRAY_COPY.openBatch}
          </Link>
        </Button>
      )}
    </li>
  );
}

/** Evento para que el chat («Minimizar») abra el Centro de procesos. */
export const AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT = 'sellup:agent-runs:open-process-center';

/**
 * AgentRunsProcessCenter — el Centro de procesos de la cabecera (port de Thema
 * `app-shell/ProcessCenter`): las búsquedas del Agente IA que siguen trabajando
 * aunque se cierre el chat o se cambie de pantalla, con su avance, y las que ya
 * terminaron. Sustituye a la bandeja flotante (AGENT1-PARALLEL-RUNS-TRAY-1).
 *
 * Vive en la cabecera del shell, no en el chat: cerrar el asistente no pierde la
 * corrida. El botón lleva un punto mientras algo corre, para saberlo sin abrirlo.
 * El contenido se queda montado con el popover cerrado (`keepMounted`): la
 * continuación de una corrida a medias se CONDUCE aunque no se vea.
 */
export function AgentRunsProcessCenter({ className }: { className?: string }) {
  const runs = useAgentRuns();
  const live = useLiveProgress(runs);
  const [open, setOpen] = React.useState(false);
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [continuationActive, setContinuationActive] = React.useState(false);

  React.useEffect(() => {
    const openCenter = () => {
      setIsCollapsed(false);
      setOpen(true);
    };
    window.addEventListener(AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT, openCenter);
    return () => window.removeEventListener(AGENT_RUNS_PROCESS_CENTER_OPEN_EVENT, openCenter);
  }, []);

  // Una corrida que termina EN PAUSA hace que la continuación vuelva a preguntar.
  const pausedRunSignal = runs.filter((run) => run.continuationPending).length;

  const counts: Record<ProcessState, number> = { running: 0, waiting: 0, done: 0, failed: 0 };
  for (const run of runs) counts[agentRunProcessState(run)] += 1;
  // La corrida a medias también es trabajo en curso.
  if (continuationActive) counts.running += 1;
  const running = counts.running;
  const finished = counts.done + counts.failed;
  const isEmpty = runs.length === 0 && !continuationActive;
  const summary = processCenterSummary(counts);
  const store = getAgentRunsStore();
  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title={AGENT_RUNS_TRAY_COPY.processCenter}
            aria-label={
              running > 0
                ? `${AGENT_RUNS_TRAY_COPY.processCenter}, ${AGENT_RUNS_TRAY_COPY.running(running)}`
                : AGENT_RUNS_TRAY_COPY.processCenter
            }
            data-testid="shell-processes"
            className={cn(
              'relative flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-text-muted transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              open && 'bg-surface-muted text-foreground',
              className,
            )}
          >
            <Queue className="size-4" />
            {running > 0 && (
              <span
                aria-hidden
                data-slot="process-running-dot"
                className="absolute right-1.5 top-1 size-2 rounded-full border-2 border-card bg-primary animate-su-pulse"
              />
            )}
          </button>
        }
      />
      <PopoverContent
        keepMounted
        align="end"
        sideOffset={8}
        aria-label={AGENT_RUNS_TRAY_COPY.processCenter}
        className="flex w-[min(340px,calc(100vw-1rem))] flex-col overflow-hidden p-0"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-muted-foreground">
            <Queue className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <Text weight="semibold" className="leading-tight">
              {AGENT_RUNS_TRAY_COPY.processCenter}
            </Text>
            {/* Sin truncar: con algo terminado y algo fallido el resumen pasa a dos líneas antes que cortarse. */}
            <Text size="sm" tone="secondary" aria-live="polite" className="leading-snug">
              {summary}
            </Text>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed ? AGENT_RUNS_TRAY_COPY.expand : AGENT_RUNS_TRAY_COPY.collapse}
            title={isCollapsed ? AGENT_RUNS_TRAY_COPY.expand : AGENT_RUNS_TRAY_COPY.collapse}
            onClick={() => setIsCollapsed((value) => !value)}
          >
            {isCollapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>

        {!isCollapsed && isEmpty && (
          <div className="flex flex-col items-center gap-1 border-t border-dashed border-border/70 px-6 py-8 text-center">
            <span className="mb-2 grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Queue className="size-6" />
            </span>
            <Text weight="semibold">{AGENT_RUNS_TRAY_COPY.emptyTitle}</Text>
            <Text size="sm" tone="secondary">
              {AGENT_RUNS_TRAY_COPY.emptyHint}
            </Text>
          </div>
        )}

        {/* La continuación se CONDUCE aunque el centro esté plegado o cerrado:
            por eso la lista se oculta con `hidden` y no se desmonta. */}
        <ul
          className="max-h-[min(360px,55vh)] overflow-y-auto border-t border-border/60"
          hidden={isCollapsed || isEmpty}
        >
          <WizardApolloContinuationPanel
            variant="tray"
            pausedRunSignal={pausedRunSignal}
            onActiveChange={setContinuationActive}
          />
          {runs.map((run) => (
            <ProcessRow key={run.clientRequestId} run={run} live={live[run.clientRequestId]} onAfterAction={close} />
          ))}
        </ul>

        {!isCollapsed && (
          <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-surface-subtle px-4 py-2">
            {/* Sólo mientras algo corre, y puede pasar a dos líneas: con «Limpiar»
                al lado no cabe en una y cortado no se entiende. */}
            <Text size="xs" tone="muted" className="min-w-0 leading-snug">
              {running > 0 ? AGENT_RUNS_TRAY_COPY.keepRunning : ''}
            </Text>
            <div className="-mr-2 flex shrink-0 items-center gap-1">
              {finished > 0 && (
                <Button variant="ghost" size="sm" title={AGENT_RUNS_TRAY_COPY.closeAll} onClick={() => store?.dismissFinished()}>
                  {AGENT_RUNS_TRAY_COPY.clearFinished}
                </Button>
              )}
              <Button asChild variant="ghost" size="sm">
                <Link href={AGENT_RUNS_PAGE_PATH} onClick={close} title={AGENT_RUNS_TRAY_COPY.openPage}>
                  {AGENT_RUNS_TRAY_COPY.history}
                </Link>
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
