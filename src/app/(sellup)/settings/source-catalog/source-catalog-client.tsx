'use client';

import * as React from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, ExternalLink, ArrowRight } from "@/icons";
import { DataTable, DataTableColumnHeader, TruncatedCell, type DataTableContextMenuItem } from '@/components/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTablePage } from '@/components/shared/data-table-page';
import { FilterChips } from '@/components/filters/filter-chips';
import type { SourceCatalogViewModel, SourceViewModel, SourceStatusOverrides } from '@/modules/source-catalog/queries';
import type { SourceConnectionLatestViewModel } from '@/modules/source-catalog/history-queries';
import type { SocrataPreviewBatchListViewModel } from '@/modules/source-catalog/socrata-batches-queries';
import {
  OPERATIONAL_STATUS_LABELS,
  COUNTRY_LABELS,
  SELLUP_USE_LABELS,
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
  operationalStatusBadgeClass,
  operationalStatusDotClass,
} from '@/modules/source-catalog/labels';
import { filterTab, type TabId } from '@/modules/source-catalog/filter-tab';
import { getSourceActionPresentation } from '@/modules/source-catalog/action-presentation';
import { SourceDetailDrawer } from './source-detail-drawer';

type Props = {
  viewModel: SourceCatalogViewModel;
  latestTests: Record<string, SourceConnectionLatestViewModel>;
  socrataBatches: SocrataPreviewBatchListViewModel;
  statusOverrides: Record<string, SourceStatusOverrides>;
};

type Row = SourceViewModel & {
  latest?: SourceConnectionLatestViewModel;
};

type OperationalStatus = SourceViewModel['operationalStatus'];
type StatusFilter = OperationalStatus | 'all';

const ALL_STATUSES: StatusFilter = 'all';

/** Cómo se llama cada vista de alcance, sin jerga. */
const SCOPE_TABS: readonly { id: TabId; label: string; description: string }[] = [
  { id: 'operativas', label: 'Usadas por la IA', description: 'Fuentes que la IA puede consultar al buscar empresas.' },
  { id: 'manuales', label: 'De consulta manual', description: 'Fuentes que sirven de referencia y se revisan a mano.' },
  { id: 'todas', label: 'Todas', description: 'Todas las fuentes del catálogo.' },
];

/**
 * Nombres cortos para los filtros rápidos por estado: caben enteros en un chip.
 * Un estado sin nombre corto usa el de la columna.
 */
const STATUS_CHIP_LABELS: Partial<Record<OperationalStatus, string>> = {
  operational_verified: 'Verificadas',
  connection_required: 'Por conectar',
  pending_validation: 'Por validar',
  manual_signal_only: 'Señal manual',
  validation_only: 'Solo validación',
};

/** El orden en que se leen los estados: primero lo que funciona, luego lo que pide trabajo. */
const STATUS_CHIP_ORDER: readonly OperationalStatus[] = [
  'operational_verified',
  'connection_required',
  'pending_validation',
  'manual_signal_only',
  'validation_only',
];

function statusRank(status: OperationalStatus): number {
  const index = STATUS_CHIP_ORDER.indexOf(status);
  return index === -1 ? STATUS_CHIP_ORDER.length : index;
}


function StatusBadge({ status }: { status: SourceViewModel['operationalStatus'] }) {
  return (
    <Badge variant="outline" className={operationalStatusBadgeClass(status)}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${operationalStatusDotClass(status)}`} />
      {OPERATIONAL_STATUS_LABELS[status]}
    </Badge>
  );
}

function SourceTable({ data, title, description, hasQuickFilter, columns, openDetail, onRowClick }: {
  data: Row[];
  title: string;
  description: string;
  /** Hay un filtro rápido por estado puesto: el vacío lo dice. */
  hasQuickFilter: boolean;
  columns: ColumnDef<Row, unknown>[];
  openDetail: (source: SourceViewModel) => void;
  onRowClick: (row: Row) => void;
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
            label: 'Copiar identificador',
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
            label: 'Abrir sitio de la fuente',
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

  return (
    <DataTable
      tableId="source-catalog"
      noun="fuentes"
      nounGender="f"
      getRowLabel={(row) => row.name}
      columns={columns}
      data={data}
      getRowId={(row) => row.key}
      title={title}
      description={description}
      count={data.length}
      contextMenu={contextMenu}
      enableColumnReorder
      rowClickable
      onRowClick={onRowClick}
      initialPageSize={10}
      fillHeight
      emptyState={
        <EmptyState
          variant="plain"
          title="Ninguna fuente coincide"
          description={
            hasQuickFilter
              ? 'No hay fuentes en ese estado dentro de esta vista. Elige «Todas» o cambia de vista.'
              : 'Quita algún filtro de las columnas o cambia de vista para ver más fuentes.'
          }
        />
      }
    />
  );
}

export function SourceCatalogClient({ viewModel, latestTests, socrataBatches, statusOverrides }: Props) {
  const { sources, filters } = viewModel;
  const [detailSource, setDetailSource] = React.useState<SourceViewModel | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<TabId>('operativas');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>(ALL_STATUSES);

  const serverData = React.useMemo(
    () => sources.map((s) => {
      const override = statusOverrides[s.key];
      return {
        ...s,
        operationalStatus: override?.operationalStatus ?? s.operationalStatus,
        aiFlowStatus: override?.aiFlowStatus ?? s.aiFlowStatus,
        connectionMode: override?.connectionMode ?? s.connectionMode,
        latest: latestTests[s.key],
      };
    }),
    [sources, latestTests, statusOverrides],
  );
  // Lo que hay en la vista elegida, antes del filtro rápido: de aquí salen los
  // contadores de los chips, que no deben cambiar al pulsar el propio chip.
  const scopedData = React.useMemo(() => filterTab(serverData, activeTab), [serverData, activeTab]);

  // Las filas de la tabla: la vista, más el filtro rápido si hay uno puesto.
  // (Antes las filas se podían arrastrar, pero ese orden no se guardaba y se
  // perdía al recargar; ahora la lista se ordena desde sus columnas.)
  const data = React.useMemo(
    () =>
      statusFilter === ALL_STATUSES
        ? scopedData
        : scopedData.filter((row) => row.operationalStatus === statusFilter),
    [scopedData, statusFilter],
  );

  const statusChips = React.useMemo(() => {
    const counts = new Map<OperationalStatus, number>();
    for (const row of scopedData) {
      counts.set(row.operationalStatus, (counts.get(row.operationalStatus) ?? 0) + 1);
    }
    const statuses = Array.from(counts.keys()).sort(
      (a, b) => statusRank(a) - statusRank(b) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0),
    );
    return [
      { value: ALL_STATUSES as string, label: 'Todas', count: scopedData.length },
      ...statuses.map((status) => ({
        value: status as string,
        label: STATUS_CHIP_LABELS[status] ?? OPERATIONAL_STATUS_LABELS[status],
        count: counts.get(status) ?? 0,
      })),
    ];
  }, [scopedData]);

  const handleTabChange = React.useCallback((value: unknown) => {
    setActiveTab(value as TabId);
    // El estado elegido puede no existir en la otra vista: se vuelve a «Todas».
    setStatusFilter(ALL_STATUSES);
  }, []);

  const openDetail = React.useCallback((source: SourceViewModel) => {
    setDetailSource(source);
    setDetailOpen(true);
  }, []);

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
            <button
              type="button"
              onClick={() => openDetail(row.original)}
              title={row.original.name}
              className="block w-full truncate rounded-sm text-left text-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              {row.original.name}
            </button>
          </div>
        ),
        size: 260,
        minSize: 200,
        enableHiding: false,
        // Texto libre: se ordena y se busca, no se filtra por valores.
        meta: { label: 'Fuente', popoverTitle: 'Fuente', disableFilter: true },
      },
      {
        id: 'country',
        accessorFn: (row) => row.countryCodes,
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="País" />
        ),
        cell: ({ row }) => {
          const countryText = row.original.countryCodes.length > 0
            ? row.original.countryCodes.map((c) => COUNTRY_LABELS[c] ?? c).join(', ')
            : 'Global';
          return (
            <TruncatedCell className="text-sm text-muted-foreground" title={countryText}>
              {countryText}
            </TruncatedCell>
          );
        },
        size: 140,
        minSize: 120,
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
        id: 'operationalStatus',
        accessorKey: 'operationalStatus',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Estado" />
        ),
        cell: ({ row }) => <StatusBadge status={row.original.operationalStatus} />,
        size: 150,
        minSize: 120,
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
        id: 'nextAction',
        accessorKey: 'nextAction',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Siguiente acción" />
        ),
        cell: ({ row }) => (
          // Se lee entera: es lo que hay que hacer con la fuente. Ancho propio
          // y hasta tres renglones, en vez de una línea cortada.
          <span
            className="block min-w-64 whitespace-normal text-sm leading-snug text-muted-foreground line-clamp-3"
            title={row.original.nextAction}
          >
            {row.original.nextAction}
          </span>
        ),
        size: 340,
        minSize: 260,
        enableColumnFilter: false,
        enableSorting: false,
        meta: { label: 'Siguiente acción', disableFilter: true, disableSort: true },
      },
      {
        id: 'sellupUse',
        accessorKey: 'sellupUse',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Uso en SellUp" />
        ),
        cell: ({ row }) => (
          // Design Refresh v2: texto plano — la única columna con badge de color
          // por fila es "Estado fuente". Categorías (uso/flujo/conexión) van planas.
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {SELLUP_USE_LABELS[row.original.sellupUse]}
          </span>
        ),
        size: 170,
        minSize: 140,
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
          <DataTableColumnHeader column={column} title="Uso por la IA" />
        ),
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {AI_FLOW_STATUS_LABELS[row.original.aiFlowStatus]}
          </span>
        ),
        size: 170,
        minSize: 140,
        meta: {
          label: 'Uso por la IA',
          popoverTitle: 'Uso por la IA',
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
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {CONNECTION_MODE_LABELS[row.original.connectionMode]}
          </span>
        ),
        size: 170,
        minSize: 140,
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
        id: 'action',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Acción" />
        ),
        cell: ({ row }) => {
          const action = getSourceActionPresentation({
            connectionMode: row.original.connectionMode,
            aiFlowStatus: row.original.aiFlowStatus,
          });
          // "Conectar" es la única acción con estilo primario porque inicia una
          // conexión real; el resto son enlaces ghost que abren el detalle
          // (solo lectura). Ninguna dispara una conexión.
          return (
            <Button
              type="button"
              size="xs"
              variant={action.kind === 'connect' ? 'default' : 'ghost'}
              onClick={() => openDetail(row.original)}
            >
              {action.label}
              <ArrowRight aria-hidden="true" />
            </Button>
          );
        },
        size: 120,
        minSize: 100,
        enableColumnFilter: false,
        enableSorting: false,
        meta: { label: 'Acción', disableFilter: true, disableSort: true },
      },
    ],
    [filters, openDetail],
  );

  const tabCounts = React.useMemo(() => ({
    operativas: filterTab(serverData, 'operativas').length,
    manuales: filterTab(serverData, 'manuales').length,
    todas: serverData.length,
  }), [serverData]);

  const activeScope = SCOPE_TABS.find((tab) => tab.id === activeTab) ?? SCOPE_TABS[0];

  return (
    <>
      <DataTablePage
        title="Catálogo de fuentes"
        description="Las fuentes de datos por país que usa SellUp: en qué estado están y qué falta para poder usarlas."
        tabs={
          // Solo la lista de pestañas: la tabla de abajo es una y cambia de datos.
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList aria-label="Qué fuentes ver">
              {SCOPE_TABS.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>
                  {tab.label}
                  <span className="rounded-full bg-surface-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
                    {tabCounts[tab.id]}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
        metrics={
          // Los conteos por estado son a la vez el filtro rápido de la tabla.
          <FilterChips
            wrap
            ariaLabel="Filtrar fuentes por estado"
            value={statusFilter}
            onChange={(value) => setStatusFilter(value as StatusFilter)}
            options={statusChips}
          />
        }
      >
        <SourceTable
          data={data}
          title={activeScope.label}
          description={activeScope.description}
          hasQuickFilter={statusFilter !== ALL_STATUSES}
          columns={columns}
          openDetail={openDetail}
          onRowClick={(row) => openDetail(row)}
        />
      </DataTablePage>

      <SourceDetailDrawer
        source={detailSource}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        socrataBatches={socrataBatches}
      />
    </>
  );
}
