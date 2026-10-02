'use client';

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { formatAppDateTime } from '@/lib/format-date';
import type { AgentRun, ProviderUsageLog, ResultQualityEvent } from '@/modules/usage-tracking/types';
import { resolveCostDisplay, toCostTruth } from '@/modules/usage-tracking/cost-display';
import { CostValue } from '@/components/shared/cost-value';

type BadgeTone = 'positive' | 'warning' | 'negative' | 'neutral' | 'brand';

/** Cómo se lee cada estado, sin siglas ni anglicismos. */
export const USAGE_STATUS: Record<string, { label: string; variant: BadgeTone }> = {
  completed:      { label: 'Completada',          variant: 'positive' },
  running:        { label: 'En curso',            variant: 'brand' },
  failed:         { label: 'Falló',               variant: 'negative' },
  cancelled:      { label: 'Cancelada',           variant: 'neutral' },
  pending:        { label: 'Pendiente',           variant: 'warning' },
  success:        { label: 'Correcta',            variant: 'positive' },
  error:          { label: 'Falló',               variant: 'negative' },
  rate_limited:   { label: 'Demasiadas seguidas', variant: 'warning' },
  quota_exceeded: { label: 'Cuota agotada',       variant: 'negative' },
};

const EVENT_LABELS: Record<string, { label: string; variant: BadgeTone }> = {
  generated:            { label: 'Generado',            variant: 'brand' },
  normalized:           { label: 'Datos ordenados',     variant: 'neutral' },
  duplicate_detected:   { label: 'Duplicado detectado', variant: 'warning' },
  discarded:            { label: 'Descartado',          variant: 'negative' },
  approved:             { label: 'Aprobado',            variant: 'positive' },
  converted_to_account: { label: 'Convertido en empresa', variant: 'positive' },
  sent_to_hubspot:      { label: 'Enviado a HubSpot',   variant: 'brand' },
  contact_useful:       { label: 'Contacto útil',       variant: 'positive' },
  contact_invalid:      { label: 'Contacto no válido',  variant: 'negative' },
};

const readable = (key: string) => key.replace(/_/g, ' ');

function UsageStatusBadge({ status }: { status: string }) {
  const config = USAGE_STATUS[status] ?? { label: readable(status), variant: 'neutral' as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(2)}`;
}

function statusOptions(statuses: string[]) {
  return Array.from(new Set(statuses)).map((status) => ({
    label: USAGE_STATUS[status]?.label ?? readable(status),
    value: status,
  }));
}

function valueOptions(values: string[]) {
  return Array.from(new Set(values))
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map((value) => ({ label: value, value }));
}

const dateCell = (iso: string | null) => (
  <span className="whitespace-nowrap text-sm text-muted-foreground">{formatAppDateTime(iso)}</span>
);

const numberCell = (value: number) => (
  <span className="text-sm tabular-nums text-muted-foreground">{value.toLocaleString('es-CO')}</span>
);

// ─── Ejecuciones de agentes ───────────────────────────────────────────────────

export function AgentRunsTable({ runs }: { runs: AgentRun[] }) {
  const columns: ColumnDef<AgentRun, unknown>[] = React.useMemo(
    () => [
      {
        id: 'agent',
        accessorFn: (run) => run.agent_name ?? run.agent_key,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Agente" />,
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-sm font-medium text-foreground">{getValue<string>()}</span>
        ),
        size: 220,
        enableHiding: false,
        meta: { label: 'Agente', filterOptions: valueOptions(runs.map((run) => run.agent_name ?? run.agent_key)) },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: ({ row }) => <UsageStatusBadge status={row.original.status} />,
        size: 150,
        meta: { label: 'Estado', filterOptions: statusOptions(runs.map((run) => run.status)) },
      },
      {
        id: 'generated',
        accessorKey: 'results_generated',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Generados" />,
        cell: ({ row }) => numberCell(row.original.results_generated),
        sortDescFirst: true,
        size: 130,
        meta: { label: 'Generados', disableFilter: true },
      },
      {
        id: 'approved',
        accessorKey: 'results_approved',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Aprobados" />,
        cell: ({ row }) => numberCell(row.original.results_approved),
        sortDescFirst: true,
        size: 130,
        meta: { label: 'Aprobados', disableFilter: true },
      },
      {
        id: 'cost',
        accessorFn: (run) => Number(run.estimated_cost_usd),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Costo estimado" />,
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
            {formatCost(getValue<number>())}
          </span>
        ),
        sortDescFirst: true,
        size: 150,
        meta: { label: 'Costo estimado', disableFilter: true },
      },
      {
        id: 'createdAt',
        accessorFn: (run) => run.created_at ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => dateCell(row.original.created_at),
        sortDescFirst: true,
        size: 180,
        meta: { label: 'Fecha', disableFilter: true },
      },
    ],
    [runs],
  );

  return (
    <DataTable
      tableId="settings-usage-agent-runs"
      noun="ejecuciones"
      nounGender="f"
      title="Lo que hicieron los agentes"
      description="Las ejecuciones más recientes: cuánto generaron, cuánto se aprobó y cuánto costó."
      count={runs.length}
      columns={columns}
      data={runs}
      getRowId={(run) => run.id}
      defaultRowsMode="paged"
      initialPageSize={10}
    />
  );
}

// ─── Consultas a proveedores ──────────────────────────────────────────────────

export function ProviderLogsTable({ logs }: { logs: ProviderUsageLog[] }) {
  const columns: ColumnDef<ProviderUsageLog, unknown>[] = React.useMemo(
    () => [
      {
        id: 'provider',
        accessorKey: 'provider_key',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Proveedor" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm font-medium capitalize text-foreground">
            {readable(row.original.provider_key)}
          </span>
        ),
        size: 160,
        enableHiding: false,
        meta: {
          label: 'Proveedor',
          filterOptions: Array.from(new Set(logs.map((log) => log.provider_key))).map((key) => ({
            label: readable(key),
            value: key,
          })),
        },
      },
      {
        id: 'operation',
        accessorKey: 'operation_key',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Qué se pidió" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {readable(row.original.operation_key)}
          </span>
        ),
        size: 220,
        meta: {
          label: 'Qué se pidió',
          filterOptions: Array.from(new Set(logs.map((log) => log.operation_key))).map((key) => ({
            label: readable(key),
            value: key,
          })),
        },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: ({ row }) => <UsageStatusBadge status={row.original.status} />,
        size: 170,
        meta: { label: 'Estado', filterOptions: statusOptions(logs.map((log) => log.status)) },
      },
      {
        id: 'results',
        accessorKey: 'results_returned',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Resultados" />,
        cell: ({ row }) => numberCell(row.original.results_returned),
        sortDescFirst: true,
        size: 130,
        meta: { label: 'Resultados', disableFilter: true },
      },
      {
        id: 'cost',
        // Sin costo conocido va al final al ordenar.
        accessorFn: (log) => log.estimated_cost_usd ?? -1,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Costo estimado" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
            <CostValue
              display={resolveCostDisplay({
                valueUsd: row.original.estimated_cost_usd ?? 0,
                costTruth: toCostTruth(row.original.estimated_cost_usd == null),
                formatUsd: formatCost,
              })}
            />
          </span>
        ),
        sortDescFirst: true,
        size: 150,
        meta: { label: 'Costo estimado', disableFilter: true },
      },
      {
        id: 'createdAt',
        accessorKey: 'created_at',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => dateCell(row.original.created_at),
        sortDescFirst: true,
        size: 180,
        meta: { label: 'Fecha', disableFilter: true },
      },
    ],
    [logs],
  );

  return (
    <DataTable
      tableId="settings-usage-provider-logs"
      noun="consultas"
      nounGender="f"
      title="Consultas a proveedores"
      description="Las consultas más recientes a proveedores externos, con su resultado y su costo."
      count={logs.length}
      columns={columns}
      data={logs}
      getRowId={(log) => log.id}
      defaultRowsMode="paged"
      initialPageSize={10}
    />
  );
}

// ─── Qué pasó con cada resultado ──────────────────────────────────────────────

export function QualityEventsTable({ events }: { events: ResultQualityEvent[] }) {
  const columns: ColumnDef<ResultQualityEvent, unknown>[] = React.useMemo(
    () => [
      {
        id: 'event',
        accessorKey: 'event_type',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Qué pasó" />,
        cell: ({ row }) => {
          const config = EVENT_LABELS[row.original.event_type];
          return (
            <Badge variant={config?.variant ?? 'neutral'}>
              {config?.label ?? readable(row.original.event_type)}
            </Badge>
          );
        },
        size: 200,
        enableHiding: false,
        meta: {
          label: 'Qué pasó',
          filterOptions: Array.from(new Set(events.map((event) => event.event_type))).map((type) => ({
            label: EVENT_LABELS[type]?.label ?? readable(type),
            value: type,
          })),
        },
      },
      {
        id: 'resultType',
        accessorKey: 'result_type',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Sobre qué" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm capitalize text-muted-foreground">
            {readable(row.original.result_type)}
          </span>
        ),
        size: 150,
        meta: {
          label: 'Sobre qué',
          filterOptions: Array.from(new Set(events.map((event) => event.result_type))).map((type) => ({
            label: readable(type),
            value: type,
          })),
        },
      },
      {
        id: 'source',
        accessorFn: (event) => event.source_key ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fuente" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {row.original.source_key ? readable(row.original.source_key) : '—'}
          </span>
        ),
        size: 170,
        meta: {
          label: 'Fuente',
          filterOptions: Array.from(new Set(events.map((event) => event.source_key ?? ''))).map((key) => ({
            label: key ? readable(key) : 'Sin fuente',
            value: key,
          })),
        },
      },
      {
        id: 'notes',
        accessorFn: (event) => event.notes ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Notas" />,
        cell: ({ row }) => (
          <span
            className="block min-w-48 whitespace-normal text-sm leading-snug text-muted-foreground line-clamp-2"
            title={row.original.notes ?? undefined}
          >
            {row.original.notes ?? '—'}
          </span>
        ),
        size: 280,
        enableSorting: false,
        meta: { label: 'Notas', disableFilter: true, disableSort: true },
      },
      {
        id: 'createdAt',
        accessorKey: 'created_at',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => dateCell(row.original.created_at),
        sortDescFirst: true,
        size: 180,
        meta: { label: 'Fecha', disableFilter: true },
      },
    ],
    [events],
  );

  return (
    <DataTable
      tableId="settings-usage-quality-events"
      noun="eventos"
      nounGender="m"
      title="Qué pasó con cada resultado"
      description="Si lo que encontraron los agentes se aprobó, se descartó o resultó duplicado."
      count={events.length}
      columns={columns}
      data={events}
      getRowId={(event) => event.id}
      defaultRowsMode="paged"
      initialPageSize={10}
    />
  );
}
