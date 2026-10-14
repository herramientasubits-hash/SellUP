'use client';

// «Por búsqueda» — una fila por lote: cuándo, quién, país, industria, forma,
// empresas por herramienta y (para quien ve dólares) costo por paso, total y por
// aprobada. Cada fila abre la página del lote.

import * as React from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { Search } from '@/icons';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { formatAppDateTime } from '@/lib/format-date';
import { COMPANY_TOOLS, COMPANY_TOOL_LABELS } from '@/modules/ai-usage/company-outcomes';
import { OTHER_STEP_KEY, type SearchBatchRow } from '@/modules/ai-usage/usage-breakdowns';
import { agentStepLabel, searchModeLabel } from '@/modules/usage-tracking/usage-dimensions';
import { Dash, countColumn, filterOptions, moneyColumn } from './breakdown-cells';
import { countryLabel, formatCount, formatUsd, industryLabel } from './usage-labels';

interface SearchBatchesTableProps {
  rows: SearchBatchRow[];
  personNames: Record<string, string>;
  moneyVisible: boolean;
}

function toolsSummary(row: SearchBatchRow): string {
  const parts = COMPANY_TOOLS.flatMap((tool) => {
    const n = row.companiesByTool[tool] ?? 0;
    return n > 0 ? [`${COMPANY_TOOL_LABELS[tool]} ${formatCount(n)}`] : [];
  });
  return parts.join(' · ');
}

function stepsSummary(row: SearchBatchRow): { label: string; usd: number }[] {
  return Object.entries(row.costByStep)
    .filter(([, usd]) => usd > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([step, usd]) => ({ label: step === OTHER_STEP_KEY ? 'Otro paso' : agentStepLabel(step), usd }));
}

export function SearchBatchesTable({ rows, personNames, moneyVisible }: SearchBatchesTableProps) {
  const columns: ColumnDef<SearchBatchRow, unknown>[] = React.useMemo(() => {
    const person = (id: string | null) => (id ? personNames[id] ?? 'Persona sin nombre' : 'Sin persona');
    const base: ColumnDef<SearchBatchRow, unknown>[] = [
      {
        id: 'createdAt',
        accessorFn: (row) => row.createdAt,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => (
          <Link
            href={`/prospect-batches/${row.original.batchId}`}
            className="whitespace-nowrap text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {formatAppDateTime(row.original.createdAt)}
          </Link>
        ),
        sortDescFirst: true,
        size: 170,
        enableHiding: false,
        meta: { label: 'Fecha', disableFilter: true },
      },
      {
        id: 'person',
        accessorFn: (row) => row.createdBy ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Persona" />,
        cell: ({ row }) => <span className="text-sm text-foreground">{person(row.original.createdBy)}</span>,
        size: 180,
        meta: { label: 'Persona', filterOptions: filterOptions(rows.map((r) => r.createdBy ?? ''), (v) => person(v || null)) },
      },
      {
        id: 'country',
        accessorFn: (row) => row.countryCode ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="País" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-sm text-muted-foreground">{countryLabel(row.original.countryCode)}</span>,
        size: 140,
        meta: { label: 'País', filterOptions: filterOptions(rows.map((r) => r.countryCode ?? ''), (v) => countryLabel(v || null)) },
      },
      {
        id: 'industry',
        accessorFn: (row) => row.macroIndustryKey ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Industria" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{industryLabel(row.original.macroIndustryKey)}</span>,
        size: 180,
        meta: {
          label: 'Industria',
          filterOptions: filterOptions(rows.map((r) => r.macroIndustryKey ?? ''), (v) => industryLabel(v || null)),
        },
      },
      {
        id: 'mode',
        accessorFn: (row) => row.searchMode ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Forma" />,
        cell: ({ row }) => <span className="whitespace-nowrap text-sm text-muted-foreground">{searchModeLabel(row.original.searchMode)}</span>,
        size: 170,
        meta: { label: 'Forma', filterOptions: filterOptions(rows.map((r) => r.searchMode ?? ''), (v) => searchModeLabel(v || null)) },
      },
      {
        id: 'tools',
        accessorFn: (row) => row.reachedReview,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Empresas por herramienta" />,
        cell: ({ row }) =>
          row.original.reachedReview > 0 ? (
            <span className="text-sm text-muted-foreground">{toolsSummary(row.original)}</span>
          ) : (
            <Dash label="Ninguna empresa" />
          ),
        sortDescFirst: true,
        size: 260,
        meta: { label: 'Empresas por herramienta', disableFilter: true },
      },
      countColumn('approved', 'Aprobadas', (row) => row.approved),
      countColumn('calls', 'Consultas', (row) => row.calls),
      countColumn('credits', 'Créditos', (row) => row.credits),
    ];
    if (!moneyVisible) return base;
    return [
      ...base,
      {
        id: 'costBySteps',
        accessorFn: (row) => Object.keys(row.costByStep).length,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Costo por paso" />,
        cell: ({ row }) => {
          const steps = stepsSummary(row.original);
          if (steps.length === 0) return <Dash label="Sin costo" />;
          return (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {steps.map((step) => (
                <li key={step.label} className="flex justify-between gap-3">
                  <span>{step.label}</span>
                  <span className="tabular-nums">{formatUsd(step.usd)}</span>
                </li>
              ))}
            </ul>
          );
        },
        size: 260,
        meta: { label: 'Costo por paso', disableFilter: true, disableSort: true },
      },
      moneyColumn('total', 'Costo total', (row) => row.totalCostUsd, (row) => row.hasUnknownCost),
      moneyColumn('costPerApproved', 'Costo por aprobada', (row) => row.costPerApprovedUsd, () => false, 2, 160),
    ];
  }, [rows, personNames, moneyVisible]);

  return (
    <DataTable
      tableId="ai-usage-by-search"
      noun="búsquedas"
      nounGender="f"
      title="Cada búsqueda"
      description="Una fila por búsqueda del periodo. Abre la búsqueda desde su fecha."
      count={rows.length}
      columns={columns}
      data={rows}
      getRowId={(row) => row.batchId}
      defaultRowsMode="paged"
      initialPageSize={20}
      emptyState={
        <EmptyState
          variant="plain"
          icon={Search}
          title="No hay búsquedas en este periodo"
          description="Si tienes filtros puestos, prueba a quitarlos."
        />
      }
    />
  );
}
