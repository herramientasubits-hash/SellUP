'use client';

/**
 * Agente 1 · «Competidores» — calidad por fuente y por referencia (auditoría 21-10,
 * Fase D). Aprobadas sobre lo ya decidido: lo que rinde y lo que conviene apagar.
 */

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Target } from '@/icons';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import {
  COMPETITOR_QUALITY_SOURCE_LABELS,
  competitorApprovalRate,
  type CompetitorQualityCounts,
  type CompetitorQualityReferenceRow,
  type CompetitorQualitySourceRow,
} from '@/modules/prospect-batches/competitor-search/competitor-quality';

function rate(counts: CompetitorQualityCounts): string {
  const value = competitorApprovalRate(counts);
  return value === null ? '—' : `${Math.round(value * 100)} %`;
}

function countColumns<T extends CompetitorQualityCounts>(): ColumnDef<T>[] {
  const num = (key: keyof CompetitorQualityCounts, title: string): ColumnDef<T> => ({
    id: key,
    accessorFn: (row) => row[key],
    header: ({ column }) => <DataTableColumnHeader column={column} title={title} />,
    cell: ({ getValue }) => <span className="text-sm tabular-nums">{String(getValue())}</span>,
    size: 110,
    meta: { label: title, disableFilter: true },
  });
  return [
    num('found', 'Encontradas'),
    num('approved', 'Aprobadas'),
    num('notCompetitor', 'No compiten'),
    num('small', 'Pequeñas'),
    num('inReview', 'Por revisar'),
    {
      id: 'rate',
      accessorFn: (row) => competitorApprovalRate(row) ?? -1,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Aciertos" />,
      cell: ({ row }) => <span className="text-sm tabular-nums">{rate(row.original)}</span>,
      size: 110,
      meta: { label: 'Aciertos', disableFilter: true },
    },
  ];
}

export function CompetitorQualityTables({
  bySource,
  byReference,
}: {
  bySource: CompetitorQualitySourceRow[];
  byReference: CompetitorQualityReferenceRow[];
}) {
  const sourceColumns = React.useMemo<ColumnDef<CompetitorQualitySourceRow>[]>(
    () => [
      {
        id: 'source',
        accessorFn: (row) => COMPETITOR_QUALITY_SOURCE_LABELS[row.source],
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fuente" />,
        cell: ({ getValue }) => <span className="text-sm font-medium text-foreground">{String(getValue())}</span>,
        size: 180,
        enableHiding: false,
        meta: { label: 'Fuente', disableFilter: true },
      },
      ...countColumns<CompetitorQualitySourceRow>(),
    ],
    [],
  );
  const referenceColumns = React.useMemo<ColumnDef<CompetitorQualityReferenceRow>[]>(
    () => [
      {
        id: 'reference',
        accessorFn: (row) => row.referenceName,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Referencia" />,
        cell: ({ getValue }) => <span className="text-sm font-medium text-foreground">{String(getValue())}</span>,
        size: 220,
        enableHiding: false,
        meta: { label: 'Referencia', disableFilter: true },
      },
      {
        id: 'searches',
        accessorFn: (row) => row.searches,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Búsquedas" />,
        cell: ({ getValue }) => <span className="text-sm tabular-nums">{String(getValue())}</span>,
        size: 110,
        meta: { label: 'Búsquedas', disableFilter: true },
      },
      ...countColumns<CompetitorQualityReferenceRow>(),
    ],
    [],
  );
  const empty = <EmptyState icon={Target} title="Sin búsquedas de competidores" description="Aún no hay datos en el periodo." />;
  return (
    <div className="space-y-6">
      <DataTable
        tableId="ai-usage-competitor-quality-by-source"
        noun="fuentes"
        nounGender="f"
        title="Competidores · calidad por fuente"
        description="De lo que trajo cada fuente, cuánto aprobó el vendedor y cuánto no compite."
        count={bySource.length}
        columns={sourceColumns}
        data={bySource}
        getRowId={(row) => row.source}
        defaultRowsMode="paged"
        initialPageSize={10}
        emptyState={empty}
      />
      <DataTable
        tableId="ai-usage-competitor-quality-by-reference"
        noun="referencias"
        nounGender="f"
        title="Competidores · calidad por referencia"
        description="Una fila por empresa de referencia, con todas sus búsquedas."
        count={byReference.length}
        columns={referenceColumns}
        data={byReference}
        getRowId={(row) => row.referenceName}
        defaultRowsMode="paged"
        initialPageSize={10}
        emptyState={empty}
      />
    </div>
  );
}
