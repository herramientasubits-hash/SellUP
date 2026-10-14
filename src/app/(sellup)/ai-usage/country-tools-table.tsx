'use client';

// «Por país» — matriz país × herramienta: cuántas empresas llegaron a revisión,
// cuántas se aprobaron y convirtieron, con número fiscal y con web, cuántas se
// descartaron y (para quien ve dólares) cuánto costó y el costo por aprobada.

import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Globe } from '@/icons';
import { DataTable, DataTableColumnHeader } from '@/components/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { InfoHint } from '@/components/shared/info-hint';
import { COMPANY_TOOL_LABELS, type CompanyTool } from '@/modules/ai-usage/company-outcomes';
import type { CountryToolRow } from '@/modules/ai-usage/usage-breakdowns';
import { countColumn, filterOptions, moneyColumn } from './breakdown-cells';
import { countryLabel } from './usage-labels';

function toolLabel(tool: CountryToolRow['tool']): string {
  return tool === 'total' ? 'Total del país' : COMPANY_TOOL_LABELS[tool as CompanyTool];
}

export function CountryToolsTable({ rows, moneyVisible }: { rows: CountryToolRow[]; moneyVisible: boolean }) {
  const columns: ColumnDef<CountryToolRow, unknown>[] = React.useMemo(() => {
    const base: ColumnDef<CountryToolRow, unknown>[] = [
      {
        id: 'country',
        accessorFn: (row) => row.countryCode ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="País" />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-sm font-medium text-foreground">
            {countryLabel(row.original.countryCode)}
          </span>
        ),
        size: 170,
        enableHiding: false,
        meta: {
          label: 'País',
          filterOptions: filterOptions(rows.map((r) => r.countryCode ?? ''), (v) => countryLabel(v || null)),
        },
      },
      {
        id: 'tool',
        accessorFn: (row) => row.tool,
        header: ({ column }) => <DataTableColumnHeader column={column} title="Herramienta" />,
        cell: ({ row }) => (
          <span
            className={
              row.original.tool === 'total'
                ? 'whitespace-nowrap text-sm font-semibold text-foreground'
                : 'whitespace-nowrap text-sm text-foreground'
            }
          >
            {toolLabel(row.original.tool)}
          </span>
        ),
        size: 190,
        meta: {
          label: 'Herramienta',
          filterOptions: filterOptions(
            rows.map((r) => r.tool),
            (v) => toolLabel(v as CountryToolRow['tool']),
          ),
        },
      },
      countColumn('reachedReview', 'Llegaron a revisión', (row) => row.reachedReview, 150),
      countColumn('approved', 'Aprobadas', (row) => row.approved),
      countColumn('converted', 'Convertidas en cuenta', (row) => row.converted, 160),
      countColumn('withTaxId', 'Con número fiscal', (row) => row.withTaxId, 150),
      countColumn('withWebsite', 'Con web', (row) => row.withWebsite),
      countColumn('discarded', 'Descartadas', (row) => row.discarded),
    ];
    if (!moneyVisible) return base;
    return [
      ...base,
      moneyColumn('cost', 'Costo estimado', (row) => row.costUsd, (row) => row.hasUnknownCost),
      moneyColumn('costPerApproved', 'Costo por aprobada', (row) => row.costPerApprovedUsd, () => false, 2, 160),
    ];
  }, [rows, moneyVisible]);

  return (
    <DataTable
      tableId="ai-usage-country-tools"
      noun="filas"
      nounGender="f"
      title="Qué entregó cada herramienta en cada país"
      description="Sólo empresas de búsquedas reales: las pruebas y las importaciones no cuentan."
      actions={
        <InfoHint showLabel>
          «Llegaron a revisión» son las empresas que una búsqueda dejó para revisar; «Aprobadas»
          incluye las ya convertidas en cuenta. Tavily y Claude guardan sus empresas igual
          («Web con IA»), así que la fila de Claude sólo trae su costo. El costo es el de las
          consultas hechas para ese país, también en pruebas.
        </InfoHint>
      }
      count={rows.length}
      columns={columns}
      data={rows}
      getRowId={(row) => row.id}
      defaultRowsMode="paged"
      initialPageSize={20}
      emptyState={
        <EmptyState
          variant="plain"
          icon={Globe}
          title="Ninguna búsqueda entregó empresas en este periodo"
          description="Si tienes filtros puestos, prueba a quitarlos."
        />
      }
    />
  );
}
