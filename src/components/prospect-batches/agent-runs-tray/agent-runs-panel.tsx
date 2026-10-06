'use client';

/**
 * AgentRunsPanel — la pestaña «Búsquedas» DENTRO del cajón del chat del Agente IA
 * (AGENT1-RUNS-INSIDE-CHAT-1).
 *
 * La dueña (06-10, sobre la página aparte de #605): «no debe ser una pantalla
 * completa; debe ser dentro del mismo drawer del chat, como una parte interna,
 * navegando con botones o tabs». Arriba lo que corre en este navegador (las mismas
 * filas de la bandeja, con su etapa en vivo); abajo los últimos 7 días, con
 * acceso a cada lote. Lista y no tabla: el cajón es estrecho.
 */

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatAppDateTime } from '@/lib/format-date';
import { BATCH_STATUS_LABELS, type BatchStatus } from '@/modules/prospect-batches/types';
import { fetchAgentRunsHistory, useAgentRuns } from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import type { AgentRunsHistory } from '@/modules/prospect-batches/agent-runs/agent-runs-history.server';
import { RunRow, useLiveProgress } from './agent-runs-tray';

const STATUS_VARIANT: Record<string, 'neutral' | 'brand' | 'warning' | 'info' | 'positive' | 'negative'> = {
  draft: 'neutral',
  generating: 'warning',
  ready_for_review: 'brand',
  in_review: 'info',
  completed: 'positive',
  cancelled: 'neutral',
  failed: 'negative',
};

type HistoryState = { kind: 'loading' } | { kind: 'ready'; history: AgentRunsHistory } | { kind: 'error' };

function useHistory(reloadKey: number): HistoryState {
  const [state, setState] = React.useState<HistoryState>({ kind: 'loading' });
  React.useEffect(() => {
    let cancelled = false;
    fetchAgentRunsHistory()
      .then((history) => {
        if (!cancelled) setState({ kind: 'ready', history });
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);
  return state;
}

export function AgentRunsPanel() {
  const runs = useAgentRuns();
  const live = useLiveProgress(runs);
  const current = runs.filter((run) => run.status === 'running' || run.status === 'queued');
  // El historial se vuelve a pedir cuando una corrida de aquí termina.
  const finishedCount = runs.length - current.length;
  const history = useHistory(finishedCount);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4" data-testid="agent-runs-panel">
      <section aria-labelledby="agent-runs-current">
        <h3 id="agent-runs-current" className="text-sm font-semibold text-foreground">
          {current.length > 0 ? `En curso (${current.length})` : 'En curso'}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {current.length > 0
            ? 'Hasta 3 a la vez; una sola por país e industria. Las demás esperan y arrancan solas.'
            : 'No hay búsquedas corriendo en este navegador.'}
        </p>
        {current.length > 0 && (
          <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
            {current.map((run) => (
              <RunRow key={run.clientRequestId} run={run} live={live[run.clientRequestId]} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="agent-runs-history">
        <h3 id="agent-runs-history" className="text-sm font-semibold text-foreground">
          Últimos 7 días
        </h3>
        {history.kind === 'loading' && (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        )}
        {(history.kind === 'error' || (history.kind === 'ready' && history.history.failed)) && (
          <p className="mt-2 text-xs text-destructive">No se pudo leer el historial. Vuelve a abrir esta pestaña.</p>
        )}
        {history.kind === 'ready' && !history.history.failed && history.history.rows.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">Todavía no hay búsquedas en los últimos 7 días.</p>
        )}
        {history.kind === 'ready' && history.history.rows.length > 0 && (
          <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-card" data-testid="agent-runs-history-list">
            {history.history.rows.map((row) => (
              <li key={row.batchId} className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {[row.country, row.industry].filter(Boolean).join(' · ') || 'Búsqueda'}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatAppDateTime(row.createdAt)}</span>
                    <span aria-hidden>·</span>
                    <span className="tabular-nums">
                      {row.candidateCount === 1 ? '1 empresa' : `${row.candidateCount} empresas`}
                    </span>
                    <Badge variant={STATUS_VARIANT[row.status] ?? 'neutral'}>
                      {BATCH_STATUS_LABELS[row.status as BatchStatus] ?? row.status}
                    </Badge>
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/prospect-batches/${row.batchId}`}>Ver lote</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
