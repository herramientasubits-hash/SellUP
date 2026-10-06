'use client';

/**
 * Vista de «Búsquedas» del Agente IA (AGENT1-PARALLEL-RUNS-PHASE2-1).
 *
 * Arriba, las búsquedas de ESTE navegador que corren o esperan (las mismas filas
 * que el Centro de procesos, con su etapa en vivo). Abajo, el historial de los
 * últimos 7 días de la persona, con acceso a cada lote. Tabla = DataTable
 * (Foundation § 10), página = DataTablePage (§ 14).
 */

import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { DataTablePage } from '@/components/shared/data-table-page';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatAppDateTime } from '@/lib/format-date';
import { BATCH_STATUS_LABELS, type BatchStatus } from '@/modules/prospect-batches/types';
import { useAgentRuns } from '@/modules/prospect-batches/agent-runs/agent-runs-client';
import type { AgentRunsHistory, AgentRunHistoryRow } from '@/modules/prospect-batches/agent-runs/agent-runs-history.server';
import { RunRow, useLiveProgress } from '@/components/prospect-batches/agent-runs-tray/agent-runs-tray';

const STATUS_VARIANT: Record<string, 'neutral' | 'brand' | 'warning' | 'info' | 'positive' | 'negative'> = {
  draft: 'neutral',
  generating: 'warning',
  ready_for_review: 'brand',
  in_review: 'info',
  completed: 'positive',
  cancelled: 'neutral',
  failed: 'negative',
};

const columns: ColumnDef<AgentRunHistoryRow, unknown>[] = [
  {
    accessorKey: 'createdAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
    cell: ({ row }) => <span className="whitespace-nowrap text-sm">{formatAppDateTime(row.original.createdAt)}</span>,
  },
  {
    accessorKey: 'country',
    header: ({ column }) => <DataTableColumnHeader column={column} title="País" />,
    cell: ({ row }) => row.original.country ?? '—',
  },
  {
    accessorKey: 'industry',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Industria" />,
    cell: ({ row }) => row.original.industry ?? '—',
  },
  {
    accessorKey: 'status',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
    cell: ({ row }) => (
      <Badge variant={STATUS_VARIANT[row.original.status] ?? 'neutral'}>
        {BATCH_STATUS_LABELS[row.original.status as BatchStatus] ?? row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: 'candidateCount',
    header: ({ column }) => <DataTableColumnHeader column={column} title="Empresas" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.candidateCount}</span>,
  },
  {
    id: 'open',
    header: () => <span className="sr-only">Abrir</span>,
    cell: ({ row }) => (
      <Button asChild size="sm" variant="outline">
        <Link href={`/prospect-batches/${row.original.batchId}`}>Ver lote</Link>
      </Button>
    ),
    enableSorting: false,
  },
];

export function AgentRunsView({ history }: { history: AgentRunsHistory }) {
  const runs = useAgentRuns();
  const live = useLiveProgress(runs);
  const current = runs.filter((run) => run.status === 'running' || run.status === 'queued');

  return (
    <DataTablePage
      title="Búsquedas del Agente IA"
      description="Las que corren ahora y las de los últimos 7 días. Puedes cerrar el chat: las búsquedas siguen."
      metrics={
        <SurfaceCard noPadding>
          <SurfaceCardHeader
            className="px-4 pt-4"
            title={current.length > 0 ? `En curso (${current.length})` : 'En curso'}
            description={
              current.length > 0
                ? 'Hasta 3 a la vez; una sola por país e industria. Las demás esperan y arrancan solas.'
                : 'No hay búsquedas corriendo en este navegador.'
            }
          />
          {current.length > 0 && (
            <ul className="mt-2 border-t border-border">
              {current.map((run) => (
                <RunRow key={run.clientRequestId} run={run} live={live[run.clientRequestId]} />
              ))}
            </ul>
          )}
        </SurfaceCard>
      }
    >
      <DataTable
        fillHeight
        tableId="agent-runs-history"
        noun="búsqueda"
        nounGender="f"
        columns={columns}
        data={history.rows}
        getRowId={(row) => row.batchId}
        title="Historial · últimos 7 días"
        emptyState={
          history.failed
            ? 'No se pudo leer el historial. Vuelve a cargar la página.'
            : 'Todavía no hay búsquedas en los últimos 7 días.'
        }
      />
    </DataTablePage>
  );
}
