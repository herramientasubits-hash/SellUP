'use client';

import * as React from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, ExternalLink, ArrowRight, RotateCcw } from 'lucide-react';
import { DataTable, DataTableColumnHeader, type DataTableContextMenuItem, type DataTableBulkAction } from '@/components/data-table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { SourceCatalogViewModel, SourceViewModel } from '@/modules/source-catalog/queries';
import type { SourceConnectionLatestViewModel } from '@/modules/source-catalog/history-queries';
import type { SocrataPreviewBatchListViewModel } from '@/modules/source-catalog/socrata-batches-queries';
import {
  OPERATIONAL_STATUS_LABELS,
  AUTOMATION_LEVEL_LABELS,
  TYPE_LABELS,
  PRIORITY_LABELS,
  COUNTRY_LABELS,
  CONNECTION_TEST_STATUS_SHORT_LABELS,
  SELLUP_USE_LABELS,
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
  operationalStatusBadgeClass,
  operationalStatusDotClass,
  connectionTestStatusBadgeClass,
  sellupUseBadgeClass,
  aiFlowStatusBadgeClass,
  connectionModeBadgeClass,
} from '@/modules/source-catalog/labels';
import { SourceDetailDrawer } from './source-detail-drawer';

type Props = {
  viewModel: SourceCatalogViewModel;
  latestTests: Record<string, SourceConnectionLatestViewModel>;
  socrataBatches: SocrataPreviewBatchListViewModel;
};

type Row = SourceViewModel & {
  latest?: SourceConnectionLatestViewModel;
};

type TabId = 'operativas' | 'manuales' | 'todas';

function filterTab(sources: Row[], tab: TabId): Row[] {
  return sources.filter((s) => {
    switch (tab) {
      case 'operativas': {
        if (s.sellupUse === 'technical_container') return false;
        return (
          s.aiFlowStatus === 'connected' ||
          s.aiFlowStatus === 'eligible_not_connected' ||
          s.aiFlowStatus === 'partial_pending_data' ||
          s.aiFlowStatus === 'source_guided'
        );
      }
      case 'manuales': {
        if (s.sellupUse === 'technical_container') return false;
        return (
          s.aiFlowStatus === 'manual_only' ||
          s.sellupUse === 'manual_reference' ||
          s.sellupUse === 'contextual_signal' ||
          (s.sellupUse === 'commercial_signal' && s.connectionMode === 'not_connected')
        );
      }
      case 'todas':
        return true;
    }
  });
}

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

function SourceTable({ data, columns, openDetail, hasManualOrder, handleRowReorder, resetOrder }: {
  data: Row[];
  columns: ColumnDef<Row, unknown>[];
  openDetail: (source: SourceViewModel) => void;
  hasManualOrder: boolean;
  handleRowReorder: (next: Row[]) => void;
  resetOrder: () => void;
}) {
  const contextMenu = React.useMemo(
    () => ({
      items: (row: Row): DataTableContextMenuItem[] => {
        const items: DataTableContextMenuItem[] = [
          {
            id: 'view',
            label: 'Ver detalle',
            icon: ArrowRight,
            onClick: () => openDetail(row),
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
    [openDetail],
  );

  const bulkActions = React.useMemo<DataTableBulkAction<Row>[]>(
    () => [
      {
        id: 'view-detail',
        label: 'Ver detalle',
        icon: ArrowRight,
        disabled: (rows) => rows.length !== 1,
        onClick: (rows) => openDetail(rows[0]),
      },
      {
        id: 'copy-keys',
        label: 'Copiar keys',
        icon: Copy,
        onClick: async (rows) => {
          try {
            await navigator.clipboard.writeText(rows.map((r) => r.key).join(', '));
          } catch {
            // clipboard not available
          }
        },
      },
      {
        id: 'open-urls',
        label: 'Abrir URLs',
        icon: ExternalLink,
        disabled: (rows) => !rows.some((r) => r.url),
        onClick: (rows) => {
          rows.forEach((r) => {
            if (r.url) window.open(r.url, '_blank', 'noopener,noreferrer');
          });
        },
      },
      {
        id: 'reset-order',
        label: 'Restablecer orden',
        icon: RotateCcw,
        disabled: () => !hasManualOrder,
        onClick: () => resetOrder(),
      },
    ],
    [openDetail, hasManualOrder, resetOrder],
  );

  return (
    <DataTable
      columns={columns}
      data={data}
      getRowId={(row) => row.key}
      title="Listado de fuentes"
      description="Fuentes operativas, cobertura, tipo de automatización y estado de salud."
      count={data.length}
      enableRowSelection
      contextMenu={contextMenu}
      bulkActions={bulkActions}
      enableColumnReorder
      enableRowReorder
      onRowReorder={handleRowReorder}
      initialPageSize={20}
      fillHeight
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

export function SourceCatalogClient({ viewModel, latestTests, socrataBatches }: Props) {
  const { sources, filters } = viewModel;
  const [detailSource, setDetailSource] = React.useState<SourceViewModel | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<TabId>('operativas');

  const serverData = React.useMemo(
    () => sources.map((s) => ({ ...s, latest: latestTests[s.key] })),
    [sources, latestTests],
  );
  const [data, setData] = React.useState<Row[]>([]);
  const [hasManualOrder, setHasManualOrder] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(filterTab(serverData, activeTab));
    setHasManualOrder(false);
  }, [serverData, activeTab]);

  const openDetail = React.useCallback((source: SourceViewModel) => {
    setDetailSource(source);
    setDetailOpen(true);
  }, []);

  const handleRowReorder = React.useCallback((next: Row[]) => {
    setData(next);
    setHasManualOrder(true);
  }, []);

  const resetOrder = React.useCallback(() => {
    const filtered = filterTab(serverData, activeTab);
    setData(filtered);
    setHasManualOrder(false);
  }, [serverData, activeTab]);

  const columns: ColumnDef<Row, unknown>[] = React.useMemo(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Fuente" />
        ),
        cell: ({ row }) => (
          <div className="min-w-0 space-y-0.5">
            <p className="truncate text-sm font-medium text-foreground">{row.original.name}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">{row.original.key}</p>
          </div>
        ),
        size: 200,
        minSize: 160,
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
          <span className="truncate text-sm text-muted-foreground">
            {row.original.countryCodes.length > 0
              ? row.original.countryCodes.map((c) => COUNTRY_LABELS[c] ?? c).join(', ')
              : 'Global'}
          </span>
        ),
        size: 110,
        minSize: 80,
        filterFn: 'arrIncludesSome',
        sortingFn: (a, b, columnId) => {
          const av = (a.getValue<string[]>(columnId) ?? []).join(', ');
          const bv = (b.getValue<string[]>(columnId) ?? []).join(', ');
          return av.localeCompare(bv, 'es');
        },
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
        id: 'sellupUse',
        accessorKey: 'sellupUse',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Uso en SellUp" />
        ),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${sellupUseBadgeClass(row.original.sellupUse)}`}
          >
            {SELLUP_USE_LABELS[row.original.sellupUse]}
          </span>
        ),
        size: 150,
        minSize: 120,
        meta: {
          label: 'Uso en SellUp',
          popoverTitle: 'Uso en SellUp',
          filterOptions: Object.entries(SELLUP_USE_LABELS).map(([value, label]) => ({
            label,
            value,
          })),
        },
      },
      {
        id: 'aiFlowStatus',
        accessorKey: 'aiFlowStatus',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Estado flujo IA" />
        ),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${aiFlowStatusBadgeClass(row.original.aiFlowStatus)}`}
          >
            {AI_FLOW_STATUS_LABELS[row.original.aiFlowStatus]}
          </span>
        ),
        size: 150,
        minSize: 120,
        meta: {
          label: 'Estado flujo IA',
          popoverTitle: 'Estado flujo IA',
          filterOptions: Object.entries(AI_FLOW_STATUS_LABELS).map(([value, label]) => ({
            label,
            value,
          })),
        },
      },
      {
        id: 'connectionMode',
        accessorKey: 'connectionMode',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Conexión" />
        ),
        cell: ({ row }) => (
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${connectionModeBadgeClass(row.original.connectionMode)}`}
          >
            {CONNECTION_MODE_LABELS[row.original.connectionMode]}
          </span>
        ),
        size: 140,
        minSize: 110,
        meta: {
          label: 'Conexión',
          popoverTitle: 'Conexión',
          filterOptions: Object.entries(CONNECTION_MODE_LABELS).map(([value, label]) => ({
            label,
            value,
          })),
        },
      },
      {
        id: 'priority',
        accessorKey: 'priority',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Prioridad" />
        ),
        cell: ({ row }) => (
          <span className="truncate text-sm font-medium text-foreground">
            {PRIORITY_LABELS[row.original.priority]}
          </span>
        ),
        size: 90,
        minSize: 70,
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
        id: 'latest',
        accessorFn: (row) => row.latest?.checkedAt,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Última prueba" />
        ),
        cell: ({ row }) => <HealthCell latest={row.original.latest} />,
        size: 120,
        minSize: 100,
        enableColumnFilter: false,
        meta: { label: 'Última prueba' },
      },
      {
        id: 'nextAction',
        accessorKey: 'nextAction',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Siguiente acción" />
        ),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground whitespace-normal line-clamp-2">
            {row.original.nextAction}
          </span>
        ),
        size: 180,
        minSize: 140,
        enableColumnFilter: false,
        enableSorting: false,
        meta: { label: 'Siguiente acción' },
      },
      {
        id: 'operationalStatus',
        accessorKey: 'operationalStatus',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) => <StatusBadge status={row.original.operationalStatus} />,
        size: 130,
        minSize: 110,
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
        id: 'type',
        accessorKey: 'type',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Tipo" />
        ),
        cell: ({ row }) => (
          <span className="truncate text-xs text-muted-foreground">{TYPE_LABELS[row.original.type]}</span>
        ),
        size: 90,
        minSize: 70,
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
          <span className="truncate text-xs text-muted-foreground">
            {AUTOMATION_LEVEL_LABELS[row.original.automationLevel]}
          </span>
        ),
        size: 130,
        minSize: 110,
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
        accessorFn: (row) => row.sectors,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Sectores" />
        ),
        cell: ({ row }) => (
          <span className="line-clamp-2 text-xs text-muted-foreground whitespace-normal">
            {row.original.sectors.length > 0
              ? row.original.sectors.slice(0, 3).join(', ')
              : '—'}
          </span>
        ),
        size: 160,
        minSize: 120,
        filterFn: 'arrIncludesSome',
        sortingFn: (a, b, columnId) => {
          const av = (a.getValue<string[]>(columnId) ?? []).join(', ');
          const bv = (b.getValue<string[]>(columnId) ?? []).join(', ');
          return av.localeCompare(bv, 'es');
        },
        meta: {
          label: 'Sectores',
          popoverTitle: 'Sectores',
          filterOptions: filters.sectors.map((s) => ({ label: s, value: s })),
        },
      },
    ],
    [filters],
  );

  const tabCounts = React.useMemo(() => ({
    operativas: filterTab(serverData, 'operativas').length,
    manuales: filterTab(serverData, 'manuales').length,
    todas: serverData.length,
  }), [serverData]);

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as TabId)}
        className="w-full"
      >
        <TabsList variant="segmented" className="mx-7 mt-1 mb-4">
          <TabsTrigger value="operativas">
            Operativas IA
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full border border-border/40 bg-muted/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {tabCounts.operativas}
            </span>
          </TabsTrigger>
          <TabsTrigger value="manuales">
            Señales manuales
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full border border-border/40 bg-muted/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {tabCounts.manuales}
            </span>
          </TabsTrigger>
          <TabsTrigger value="todas">
            Todas
            <span className="ml-1.5 inline-flex items-center justify-center rounded-full border border-border/40 bg-muted/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {tabCounts.todas}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-0">
          <SourceTable
            data={data}
            columns={columns}
            openDetail={openDetail}
            hasManualOrder={hasManualOrder}
            handleRowReorder={handleRowReorder}
            resetOrder={resetOrder}
          />
        </TabsContent>
      </Tabs>

      <SourceDetailDrawer
        source={detailSource}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        socrataBatches={socrataBatches}
      />
    </>
  );
}
