'use client';

import * as React from 'react';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Check, ExternalLink, ArrowRight, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, DataTableColumnHeader, type DataTableContextMenuItem } from '@/components/data-table';
import type { SourceCatalogViewModel, SourceViewModel } from '@/modules/source-catalog/queries';
import type { SourceConnectionLatestViewModel } from '@/modules/source-catalog/history-queries';
import {
  OPERATIONAL_STATUS_LABELS,
  AUTOMATION_LEVEL_LABELS,
  TYPE_LABELS,
  PRIORITY_LABELS,
  COUNTRY_LABELS,
  CONNECTION_TEST_STATUS_SHORT_LABELS,
  operationalStatusBadgeClass,
  operationalStatusDotClass,
  connectionTestStatusBadgeClass,
} from '@/modules/source-catalog/labels';

type Props = {
  viewModel: SourceCatalogViewModel;
  latestTests: Record<string, SourceConnectionLatestViewModel>;
};

type Row = SourceViewModel & {
  latest?: SourceConnectionLatestViewModel;
};

function StatusBadge({ status }: { status: SourceViewModel['operationalStatus'] }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${operationalStatusBadgeClass(status)}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${operationalStatusDotClass(status)}`} />
      {OPERATIONAL_STATUS_LABELS[status]}
    </span>
  );
}

function CopyKeyButton({ sourceKey }: { sourceKey: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(sourceKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
      title="Copiar key"
      aria-label="Copiar key"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </Button>
  );
}

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(iso));
}

function HealthCell({ latest }: { latest: SourceConnectionLatestViewModel | undefined }) {
  if (!latest) {
    return (
      <div className="space-y-0.5">
        <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground whitespace-nowrap">
          Sin pruebas
        </span>
        <p className="text-[10px] text-muted-foreground/50">—</p>
      </div>
    );
  }

  const label = CONNECTION_TEST_STATUS_SHORT_LABELS[latest.status];
  const badgeClass = connectionTestStatusBadgeClass(latest.status);
  const date = formatShortDate(latest.checkedAt);
  const ms = latest.responseTimeMs != null ? `${latest.responseTimeMs} ms` : null;

  return (
    <div className="space-y-0.5">
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${badgeClass}`}
      >
        {label}
      </span>
      <p className="text-[10px] text-muted-foreground">
        {date}{ms ? ` · ${ms}` : ''}
      </p>
    </div>
  );
}

export function SourceCatalogClient({ viewModel, latestTests }: Props) {
  const { sources, filters } = viewModel;

  const data: Row[] = React.useMemo(
    () => sources.map((s) => ({ ...s, latest: latestTests[s.key] })),
    [sources, latestTests],
  );

  const columns: ColumnDef<Row, unknown>[] = React.useMemo(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Fuente" />
        ),
        cell: ({ row }) => (
          <div className="space-y-0.5 min-w-[180px]">
            <p className="text-sm font-medium text-foreground">{row.original.name}</p>
            <p className="font-mono text-[10px] text-muted-foreground">{row.original.key}</p>
          </div>
        ),
        enableHiding: false,
        meta: { label: 'Fuente', popoverTitle: 'Fuente' },
      },
      {
        id: 'country',
        accessorFn: (row) => row.countryCodes,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="País" />
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.countryCodes.length > 0
              ? row.original.countryCodes.map((c) => COUNTRY_LABELS[c] ?? c).join(', ')
              : 'Global'}
          </span>
        ),
        enableSorting: false,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'País',
          popoverTitle: 'País',
          filterOptions: filters.countries.map((c) => ({
            label: COUNTRY_LABELS[c] ?? c,
            value: c,
          })),
        },
      },
      {
        id: 'operationalStatus',
        accessorKey: 'operationalStatus',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) => <StatusBadge status={row.original.operationalStatus} />,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Estado',
          popoverTitle: 'Estado',
          filterOptions: filters.operationalStatuses.map((s) => ({
            label: OPERATIONAL_STATUS_LABELS[s],
            value: s,
          })),
        },
      },
      {
        id: 'latest',
        accessorFn: (row) => row.latest?.checkedAt,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Última prueba" />
        ),
        cell: ({ row }) => <HealthCell latest={row.original.latest} />,
        enableColumnFilter: false,
        meta: { label: 'Última prueba' },
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Prioridad" />
        ),
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground">
            {PRIORITY_LABELS[row.original.priority]}
          </span>
        ),
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Prioridad',
          popoverTitle: 'Prioridad',
          filterOptions: filters.priorities.map((p) => ({
            label: PRIORITY_LABELS[p],
            value: p,
          })),
        },
      },
      {
        id: 'type',
        accessorKey: 'type',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tipo" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{TYPE_LABELS[row.original.type]}</span>
        ),
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Tipo',
          popoverTitle: 'Tipo',
          filterOptions: filters.types.map((t) => ({
            label: TYPE_LABELS[t],
            value: t,
          })),
        },
      },
      {
        id: 'automationLevel',
        accessorKey: 'automationLevel',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Automatización" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {AUTOMATION_LEVEL_LABELS[row.original.automationLevel]}
          </span>
        ),
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Automatización',
          popoverTitle: 'Automatización',
          filterOptions: filters.automationLevels.map((a) => ({
            label: AUTOMATION_LEVEL_LABELS[a],
            value: a,
          })),
        },
      },
      {
        id: 'sectors',
        accessorFn: (row) => row.sectors.join(', '),
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Sectores" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground line-clamp-2 max-w-[200px] whitespace-normal">
            {row.original.sectors.length > 0
              ? row.original.sectors.slice(0, 3).join(', ')
              : '—'}
          </span>
        ),
        enableSorting: false,
        meta: { label: 'Sectores' },
      },
      {
        id: 'actions',
        header: () => (
          <span className="text-[11px] font-semibold tracking-wider uppercase text-muted-foreground">
            Acciones
          </span>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-0.5 justify-end">
            <Link
              href={`/settings/source-catalog/${row.original.key}`}
              aria-label={`Ver detalle de ${row.original.name}`}
            >
              <Button variant="ghost" size="icon-sm" title="Ver detalle">
                <ArrowRight className="h-3 w-3" />
              </Button>
            </Link>
            <CopyKeyButton sourceKey={row.original.key} />
            {row.original.url && (
              <Link href={row.original.url} target="_blank" rel="noopener noreferrer">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Abrir URL"
                  aria-label={`Abrir URL de ${row.original.name}`}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </Link>
            )}
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
        size: 120,
        meta: { label: 'Acciones' },
      },
    ],
    [filters],
  );

  const contextMenu = React.useMemo(
    () => ({
      items: (row: Row): DataTableContextMenuItem[] => {
        const items: DataTableContextMenuItem[] = [
          {
            id: 'view',
            label: 'Ver detalle',
            icon: ArrowRight,
            onClick: () => {
              window.location.href = `/settings/source-catalog/${row.key}`;
            },
          },
          {
            id: 'copy-key',
            label: 'Copiar key',
            icon: Copy,
            onClick: () => {
              navigator.clipboard.writeText(row.key).catch(() => {});
            },
          },
        ];
        if (row.url) {
          const url = row.url;
          items.push({
            id: 'open-url',
            label: 'Abrir URL',
            icon: ExternalLink,
            separator: true,
            onClick: () => {
              window.open(url, '_blank', 'noopener,noreferrer');
            },
          });
        }
        return items;
      },
    }),
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      getRowId={(row) => row.key}
      title="Catálogo de fuentes"
      description="Fuentes de prospección operativas, su cobertura, tipo de automatización y estado de salud."
      count={data.length}
      actions={
        <Button size="sm" className="h-8 px-3 text-xs rounded-lg" asChild>
          <a href="/api/source-catalog/export.csv" download>
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </a>
        </Button>
      }
      enableRowSelection
      contextMenu={contextMenu}
      enableColumnReorder
      initialPageSize={20}
      emptyState={
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <p className="text-sm font-medium text-foreground">Sin resultados</p>
          <p className="text-xs text-muted-foreground mt-1">
            Ajusta los filtros para ver fuentes.
          </p>
        </div>
      }
    />
  );
}
