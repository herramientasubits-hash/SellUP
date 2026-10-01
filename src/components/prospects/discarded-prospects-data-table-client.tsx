'use client';

// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — tabla "Descartadas" (issue #389).
//
// Renderiza la lista unificada de `getDiscardedProspectsList` (filas de
// disposición del pipeline + candidatos descartados manualmente). El click en
// la fila abre el detalle; "Enviar a revisión" se ofrece por fila, en el menú
// contextual, en la barra de acciones masivas y dentro del detalle: todos
// delegan en la MISMA server action. Sólo cliente — sin llamadas a proveedor,
// sin escrituras directas, sin consumo de presupuesto.
//
// AGENT1-DISCARDED-TAB-PARITY-1 — paridad con "Candidatos por revisar":
// selección con checkbox, barra flotante de acciones masivas, encabezado con
// título/descripción/conteo, reordenamiento de columnas, filtros por columna,
// filtros de alcance en el cajón de ajustes y badge "Nuevo" en la fecha. Las
// acciones son las de descartadas, no las de la cola de revisión.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { SendHorizonal, Ban, Info, ExternalLink, Building2, Globe, Sparkles, UserRoundX } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableContextMenuItem,
  type DataTableBulkAction,
  type DataTableHandle,
  type DataTableListRowState,
} from '@/components/data-table';
import { ListItem } from '@/components/data-display/list-item';
import {
  QuickFilterChips,
  QuickFilterEmptyState,
  QuickFilterStrip,
  useQuickFilter,
  useWideViewport,
  type QuickFilterDefinition,
} from '@/components/filters/quick-filter-strip';
import {
  CountryCell,
  EmptyCell,
  ExternalLinkCell,
  RowTitleButton,
  countryName,
} from '@/components/shared/table-cells';
import { PROSPECTOS_DISCARDED_TAB_ROUTE } from '@/config/navigation';
import {
  DateRangeColumnHeader,
  type DateRangeFilterValue,
} from '@/components/prospects/prospect-date-range-column-header';
import {
  formatProspectDate,
  isProspectCreatedToday,
  isProspectCreatedWithinDateRange,
} from '@/modules/prospect-batches/prospect-date-utils';
import { LATAM_COUNTRIES, INDUSTRIES } from '@/modules/prospect-batches/types';
import { DISCARD_DISPOSITION_LABELS } from '@/modules/prospect-discards/types';
import type {
  DiscardedProspectItem,
  DiscardDispositionCode,
} from '@/modules/prospect-discards/types';
import { sendDiscardedProspectToReviewAction } from '@/modules/prospect-discards/send-to-review-actions';
import { DiscardedProspectDetailSheet } from '@/components/prospects/discarded-prospect-detail-sheet';
import { ScopeFiltersInDrawer } from '@/components/shared/scope-filters-client';
import type { ScopeFilterOptions } from '@/modules/access/commercial-scope-filter-options';

const COUNTRY_FILTER_OPTIONS = LATAM_COUNTRIES.map((c) => ({
  label: c.name,
  value: c.code,
}));

// ── Indicadores que filtran ────────────────────────────────────
// Eran tarjetas de métricas en la cabecera. Ahora son botones: pulsar uno deja
// en la tabla solo esas empresas, y el número es exactamente lo que se ve.
const DISCARDED_QUICK_FILTERS: readonly QuickFilterDefinition<DiscardedProspectItem>[] = [
  {
    id: 'new_today',
    label: 'Nuevas hoy',
    icon: Sparkles,
    tone: 'positive',
    predicate: (item) => Boolean(item.createdAt) && isProspectCreatedToday(item.createdAt),
  },
  {
    id: 'pipeline',
    label: 'Descartadas por el pipeline',
    icon: Ban,
    tone: 'neutral',
    predicate: (item) => item.disposition !== 'manual_discard',
  },
  {
    id: 'manual',
    label: 'Descartes manuales',
    icon: UserRoundX,
    tone: 'warning',
    predicate: (item) => item.disposition === 'manual_discard',
  },
];

function getStatusBadge(item: DiscardedProspectItem): {
  label: string;
  variant: 'brand' | 'warning' | 'neutral';
} {
  if (item.status === 'sent_to_review') return { label: 'Enviada a revisión', variant: 'brand' };
  if (item.sendToReviewBlockedReason) return { label: 'Duplicada', variant: 'warning' };
  return { label: 'Descartada', variant: 'neutral' };
}

const DISPOSITION_FILTER_OPTIONS = (
  Object.keys(DISCARD_DISPOSITION_LABELS) as DiscardDispositionCode[]
).map((code) => ({ label: DISCARD_DISPOSITION_LABELS[code], value: code }));

// AGENT1-IMPORT-DUPLICATES-VISIBLE-1 — una fila puede venir de sólo lectura
// (duplicado importado): se ve, pero no se puede enviar a revisión desde aquí.
function canSendToReview(item: DiscardedProspectItem): boolean {
  return item.status !== 'sent_to_review' && !item.sendToReviewBlockedReason;
}

interface DiscardedProspectsDataTableClientProps {
  items: DiscardedProspectItem[];
  scopeFilterOptions?: ScopeFilterOptions;
  currentUserId?: string;
  currentGroupId?: string;
  currentRoleKey?: string;
  /** Deep link desde una operación concreta: oculta los filtros de alcance. */
  sourceId?: string;
  /**
   * Cierto si la lista llega ya filtrada por la URL (búsqueda, país, sector o
   * alcance): un vacío así no es «no hay descartadas».
   */
  hasUrlFilters?: boolean;
}

export function DiscardedProspectsDataTableClient({
  items,
  scopeFilterOptions,
  currentUserId = '',
  currentGroupId = '',
  currentRoleKey = '',
  sourceId,
  hasUrlFilters = false,
}: DiscardedProspectsDataTableClientProps) {
  const router = useRouter();
  const dataTableRef = React.useRef<DataTableHandle>(null);
  // AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — `items` es la fuente de verdad del
  // servidor; `hiddenItemIds` es sólo una superposición optimista del mismo
  // render (filas recién enviadas a revisión) para que la fila desaparezca al
  // instante sin esperar el round-trip de `router.refresh()`. Derivar `rows`
  // así (sin `useEffect` sincronizando `items` a estado) evita el antipatrón de
  // renders en cascada que marca react-hooks/set-state-in-effect.
  const [hiddenItemIds, setHiddenItemIds] = React.useState<ReadonlySet<string>>(new Set());
  const rows = React.useMemo(
    () => items.filter((item) => !hiddenItemIds.has(item.itemId)),
    [items, hiddenItemIds],
  );
  const quick = useQuickFilter(rows, DISCARDED_QUICK_FILTERS);
  const toggleQuickFilter = React.useCallback(
    (id: string) => {
      // Cambiar de indicador cambia la lista: lo marcado deja de tener sentido.
      dataTableRef.current?.clearSelection();
      quick.toggle(id);
    },
    [quick],
  );
  // En pantalla ancha los indicadores van dentro de la barra de la tabla (no
  // gastan un renglón); en estrecha, en su franja encima.
  const isWide = useWideViewport();
  const quickFilterGroup = {
    label: 'Indicadores de empresas descartadas',
    options: quick.options,
    value: quick.activeId,
    onToggle: toggleQuickFilter,
  };
  const [selected, setSelected] = React.useState<DiscardedProspectItem | null>(null);
  const [pendingItemId, setPendingItemId] = React.useState<string | null>(null);
  const [bulkPending, setBulkPending] = React.useState(false);

  const sendOne = React.useCallback(
    async (
      item: DiscardedProspectItem,
    ): Promise<{ ok: boolean; idempotent: boolean; reason?: string }> => {
      const result = await sendDiscardedProspectToReviewAction(item.itemId);
      if (result.ok) {
        setHiddenItemIds((prev) => new Set(prev).add(item.itemId));
        return { ok: true, idempotent: result.status === 'idempotent_success' };
      }
      return { ok: false, idempotent: false, reason: result.reason };
    },
    [],
  );

  const handleSendToReview = React.useCallback(
    async (item: DiscardedProspectItem) => {
      if (!canSendToReview(item)) return;
      setPendingItemId(item.itemId);
      try {
        const outcome = await sendOne(item);
        if (outcome.ok) {
          setSelected(null);
          toast.success(
            outcome.idempotent
              ? 'Este prospecto ya estaba en revisión.'
              : 'Enviado a revisión — sin nuevas búsquedas ni consumo.',
          );
          router.refresh();
        } else {
          toast.error(describeSendToReviewFailure(outcome.reason ?? ''));
        }
      } finally {
        setPendingItemId(null);
      }
    },
    [router, sendOne],
  );

  /**
   * Envío masivo. `sendDiscardedProspectToReviewAction` es idempotente y no
   * llama a ningún proveedor ni consume presupuesto, así que repetirla por
   * fila es seguro; se ejecuta EN SERIE para no disparar N escrituras
   * concurrentes contra el mismo lote. Un fallo parcial no aborta el resto:
   * el resumen dice exactamente cuántas pasaron y cuántas no.
   */
  const handleBulkSendToReview = React.useCallback(
    async (selectedRows: DiscardedProspectItem[]) => {
      const eligible = selectedRows.filter(canSendToReview);
      if (eligible.length === 0) return;
      setBulkPending(true);
      let sent = 0;
      let already = 0;
      const failures: string[] = [];
      try {
        for (const item of eligible) {
          const outcome = await sendOne(item);
          if (outcome.ok) {
            if (outcome.idempotent) already += 1;
            else sent += 1;
          } else {
            failures.push(describeSendToReviewFailure(outcome.reason ?? ''));
          }
        }
      } finally {
        setBulkPending(false);
      }

      if (sent > 0 || already > 0) {
        const parts = [
          sent > 0 ? `${sent} enviada${sent === 1 ? '' : 's'} a revisión` : null,
          already > 0 ? `${already} ya estaba${already === 1 ? '' : 'n'} en revisión` : null,
        ].filter(Boolean);
        toast.success(`${parts.join(' · ')} — sin nuevas búsquedas ni consumo.`);
      }
      if (failures.length > 0) {
        toast.error(
          `${failures.length} sin enviar: ${Array.from(new Set(failures)).join(' ')}`,
        );
      }
      router.refresh();
    },
    [router, sendOne],
  );

  const columns: ColumnDef<DiscardedProspectItem, unknown>[] = React.useMemo(
    () => [
      {
        id: 'name',
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Empresa" />,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <RowTitleButton onClick={() => setSelected(item)} title={item.name}>
              {item.name}
            </RowTitleButton>
          );
        },
        size: 220,
        minSize: 160,
        meta: { label: 'Empresa', popoverTitle: 'Empresa', disableFilter: true },
      },
      {
        id: 'domain',
        accessorKey: 'domain',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Dominio" />,
        cell: ({ row }) =>
          row.original.domain ? (
            <ExternalLinkCell
              href={row.original.domain}
              icon={Globe}
              label={`Abrir el sitio web de ${row.original.name}`}
            >
              {row.original.domain}
            </ExternalLinkCell>
          ) : (
            <EmptyCell label="Sin dominio" />
          ),
        size: 170,
        minSize: 130,
        meta: { label: 'Dominio', popoverTitle: 'Dominio', disableFilter: true },
      },
      {
        id: 'countryCode',
        accessorKey: 'countryCode',
        header: ({ column }) => <DataTableColumnHeader column={column} title="País" />,
        cell: ({ row }) => <CountryCell code={row.original.countryCode} />,
        size: 130,
        minSize: 110,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'País',
          popoverTitle: 'País',
          filterOptions: COUNTRY_FILTER_OPTIONS,
        },
      },
      {
        id: 'industry',
        accessorKey: 'industry',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Industria" />,
        cell: ({ row }) =>
          row.original.industry ? (
            <span className="block truncate text-xs text-muted-foreground" title={row.original.industry}>
              {row.original.industry}
            </span>
          ) : (
            <EmptyCell label="Sin industria" />
          ),
        size: 150,
        minSize: 120,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Industria',
          popoverTitle: 'Industria',
          filterOptions: INDUSTRIES.map((ind) => ({ label: ind, value: ind })),
        },
      },
      {
        id: 'sourcePrimary',
        accessorKey: 'sourcePrimary',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Proveedor" />,
        cell: ({ row }) =>
          row.original.sourcePrimary ? (
            <span className="block truncate text-xs text-muted-foreground">
              {row.original.sourcePrimary}
            </span>
          ) : (
            <EmptyCell label="Sin proveedor" />
          ),
        size: 130,
        minSize: 100,
        filterFn: 'arrIncludesSome',
        // Enumerable: el embudo ofrece los proveedores que aparecen en la lista.
        meta: { label: 'Proveedor', popoverTitle: 'Proveedor' },
      },
      {
        id: 'roundOrigin',
        accessorKey: 'roundOrigin',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ronda/origen" />,
        cell: ({ row }) => {
          const origin = row.original.roundOrigin ?? row.original.batchName;
          return origin ? (
            <span className="block truncate text-xs text-muted-foreground" title={origin}>
              {origin}
            </span>
          ) : (
            <EmptyCell label="Sin ronda ni origen" />
          );
        },
        size: 180,
        minSize: 140,
        meta: { label: 'Ronda/origen', popoverTitle: 'Ronda/origen', disableFilter: true },
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: ({ column }) => <DateRangeColumnHeader column={column} title="Fecha" />,
        // AGENT1-DISCARDED-TAB-PARITY-1 — mismo badge "Nuevo" que la cola de
        // "Candidatos por revisar": una empresa descartada HOY se distingue a
        // simple vista de las descartadas en corridas anteriores.
        cell: ({ row }) => {
          const createdAt = row.original.createdAt;
          const isNew = createdAt ? isProspectCreatedToday(createdAt) : false;
          return (
            <div className="flex items-center gap-1.5">
              {createdAt ? (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatProspectDate(createdAt)}
                </span>
              ) : (
                <EmptyCell label="Sin fecha" />
              )}
              {isNew && (
                <Badge className="border-0 bg-success/10 text-success text-xs font-semibold px-1.5 py-0.5 shrink-0">
                  Nuevo
                </Badge>
              )}
            </div>
          );
        },
        filterFn: (row, _columnId, filterValue: DateRangeFilterValue) => {
          const { from, to } = (filterValue ?? {}) as DateRangeFilterValue;
          if (!from && !to) return true;
          const createdAt = row.original.createdAt;
          if (!createdAt) return true;
          return isProspectCreatedWithinDateRange(createdAt, from, to);
        },
        size: 150,
        minSize: 120,
        meta: {
          label: 'Fecha',
          popoverTitle: 'Fecha de creación',
          disableFilter: true,
        },
      },
      {
        id: 'disposition',
        accessorKey: 'disposition',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Motivo" />,
        // Un solo chip de color por fila (el estado): el motivo va en texto.
        cell: ({ row }) => {
          const reason = DISCARD_DISPOSITION_LABELS[row.original.disposition] ?? 'Otro motivo';
          return (
            <span className="block truncate text-xs text-foreground" title={reason}>
              {reason}
            </span>
          );
        },
        size: 190,
        minSize: 150,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Motivo',
          popoverTitle: 'Motivo del descarte',
          filterOptions: DISPOSITION_FILTER_OPTIONS,
        },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Estado" />,
        cell: ({ row }) => {
          const status = getStatusBadge(row.original);
          return <Badge variant={status.variant}>{status.label}</Badge>;
        },
        size: 140,
        minSize: 110,
        filterFn: 'arrIncludesSome',
        meta: {
          label: 'Estado',
          popoverTitle: 'Estado',
          filterOptions: [
            { label: 'Descartada', value: 'discarded' },
            { label: 'Enviada a revisión', value: 'sent_to_review' },
          ],
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Acciones</span>,
        cell: ({ row }) => {
          const item = row.original;
          const isPending = pendingItemId === item.itemId;
          return (
            <Button
              type="button"
              size="xs"
              variant="outline"
              aria-busy={isPending || undefined}
              disabled={!canSendToReview(item) || isPending || bulkPending}
              title={item.sendToReviewBlockedReason ?? undefined}
              onClick={(e) => {
                e.stopPropagation();
                void handleSendToReview(item);
              }}
            >
              <SendHorizonal aria-hidden="true" />
              Enviar a revisión
            </Button>
          );
        },
        size: 170,
        minSize: 150,
        enableColumnFilter: false,
        meta: { label: 'Acciones', disableFilter: true },
      },
    ],
    [pendingItemId, bulkPending, handleSendToReview],
  );

  const contextMenu = React.useMemo(
    () => ({
      items: (item: DiscardedProspectItem): DataTableContextMenuItem[] => [
        {
          id: 'view-detail',
          label: 'Ver detalle',
          icon: Info,
          onClick: () => setSelected(item),
        },
        {
          id: 'send-to-review',
          label: 'Enviar a revisión',
          icon: SendHorizonal,
          disabled: !canSendToReview(item),
          onClick: () => void handleSendToReview(item),
        },
        ...(item.domain
          ? [
              {
                id: 'open-website',
                label: 'Abrir sitio web',
                icon: ExternalLink,
                separator: true as const,
                onClick: () => {
                  window.open(
                    item.domain!.startsWith('http') ? item.domain! : `https://${item.domain}`,
                    '_blank',
                    'noopener,noreferrer',
                  );
                },
              },
            ]
          : []),
      ],
    }),
    [handleSendToReview],
  );

  // ── Acciones masivas ─────────────────────────────────────────
  // Misma jerarquía visual que la barra de "Candidatos por revisar", con las
  // acciones propias de descartadas: Ver detalle → Enviar a revisión
  // (principal) → Dejar descartada → Abrir sitios web. "Dejar descartada" es
  // el no-op explícito: confirma la decisión ya persistida y limpia la
  // selección, sin escribir nada.
  const bulkActions = React.useMemo<DataTableBulkAction<DiscardedProspectItem>[]>(
    () => [
      {
        id: 'view-detail',
        // Solo tiene sentido sobre una fila: con varias marcadas sale de la barra.
        scope: ['single'],
        label: 'Ver detalle',
        icon: Info,
        disabled: (selectedRows) => selectedRows.length !== 1,
        onClick: (selectedRows) => setSelected(selectedRows[0]),
      },
      {
        id: 'send-to-review',
        label: 'Enviar a revisión',
        icon: SendHorizonal,
        loading: bulkPending,
        disabled: (selectedRows) =>
          bulkPending ||
          selectedRows.length === 0 ||
          selectedRows.every((item) => !canSendToReview(item)),
        disabledLabel: (selectedRows) =>
          selectedRows.length > 0 && selectedRows.every((item) => item.status === 'sent_to_review')
            ? 'Ya están en revisión'
            : selectedRows.length > 0 && selectedRows.every((item) => !canSendToReview(item))
              ? 'Las seleccionadas no se pueden enviar a revisión'
              : undefined,
        confirm: {
          title: 'Enviar a revisión',
          description: (selectedRows) => {
            const eligible = selectedRows.filter(canSendToReview);
            return `Se ${eligible.length === 1 ? 'devolverá' : 'devolverán'} ${eligible.length} empresa${eligible.length === 1 ? '' : 's'} a la cola de revisión con los datos ya guardados. No se hacen búsquedas nuevas ni se consume presupuesto.`;
          },
          confirmLabel: 'Enviar a revisión',
        },
        onClick: (selectedRows) => handleBulkSendToReview(selectedRows),
      },
      {
        id: 'keep-discarded',
        label: 'Dejar descartada',
        icon: Ban,
        disabled: (selectedRows) => selectedRows.length === 0,
        onClick: () => {
          toast.success('Sin cambios — siguen descartadas.');
        },
      },
      {
        id: 'open-websites',
        label: 'Abrir sitios web',
        icon: ExternalLink,
        disabled: (selectedRows) => !selectedRows.some((item) => item.domain),
        onClick: (selectedRows) => {
          selectedRows
            .filter((item) => item.domain)
            .forEach((item) => {
              window.open(
                item.domain!.startsWith('http') ? item.domain! : `https://${item.domain}`,
                '_blank',
                'noopener,noreferrer',
              );
            });
        },
      },
    ],
    [bulkPending, handleBulkSendToReview],
  );

  // ── Vista de lista ────────────────────────────────────────────
  const renderListItem = React.useCallback(
    (item: DiscardedProspectItem, state: DataTableListRowState) => {
      const status = getStatusBadge(item);
      const isPending = pendingItemId === item.itemId;
      return (
        <ListItem
          selected={state.selected}
          leading={state.checkbox}
          title={
            <RowTitleButton onClick={() => setSelected(item)} title={item.name}>
              {item.name}
            </RowTitleButton>
          }
          description={[
            DISCARD_DISPOSITION_LABELS[item.disposition] ?? 'Otro motivo',
            countryName(item.countryCode),
            item.domain,
          ]
            .filter(Boolean)
            .join(' · ')}
          meta={<Badge variant={status.variant}>{status.label}</Badge>}
          actions={
            state.menu ?? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-busy={isPending || undefined}
                disabled={!canSendToReview(item) || isPending || bulkPending}
                title={item.sendToReviewBlockedReason ?? undefined}
                onClick={() => void handleSendToReview(item)}
              >
                <SendHorizonal aria-hidden="true" />
                Enviar a revisión
              </Button>
            )
          }
        />
      );
    },
    [pendingItemId, bulkPending, handleSendToReview],
  );

  // ── Vacíos: cada uno dice por qué no hay filas y qué hacer ────
  // Sin `emptyState`, la tabla pone su propio aviso de «nada coincide con
  // estos filtros» junto a los chips, que ya traen «Limpiar todo».
  let emptyState: React.ReactNode;
  if (rows.length === 0 && (hasUrlFilters || sourceId)) {
    emptyState = (
      <EmptyState
        variant="plain"
        icon={Building2}
        title="Ninguna descartada con estos filtros"
        description="El enlace por el que llegaste trae filtros que dejan la lista vacía."
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push(PROSPECTOS_DISCARDED_TAB_ROUTE)}
          >
            Limpiar filtros
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    emptyState = (
      <EmptyState
        variant="plain"
        icon={Building2}
        title="No hay empresas descartadas"
        description="Aquí verás las que el pipeline deje fuera y las que descartes al revisar, por si quieres rescatar alguna."
      />
    );
  } else if (quick.rows.length === 0 && quick.activeLabel) {
    emptyState = (
      <QuickFilterEmptyState
        icon={Building2}
        filterLabel={quick.activeLabel}
        noun="empresas descartadas"
        onClear={quick.clear}
      />
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {rows.length > 0 && !isWide && (
          <QuickFilterStrip
            {...quickFilterGroup}
            icon={Building2}
            tone="neutral"
            total={quick.total}
            noun={['empresa descartada', 'empresas descartadas']}
            className="shrink-0"
          />
        )}

        <DataTable
          ref={dataTableRef}
          tableId="prospects-discarded"
          noun="empresas descartadas"
          nounGender="f"
          getRowLabel={(row) => row.name}
          columns={columns}
          data={quick.rows}
          getRowId={(row) => row.itemId}
          title={quick.activeLabel ? `Descartadas · ${quick.activeLabel}` : 'Empresas descartadas'}
          count={quick.rows.length}
          actions={rows.length > 0 && isWide ? <QuickFilterChips {...quickFilterGroup} /> : undefined}
          enableRowSelection
          bulkActions={bulkActions}
          contextMenu={contextMenu}
          enableColumnReorder
          initialPageSize={20}
          fillHeight
          onRowClick={(row) => setSelected(row)}
          rowClickable
          renderListItem={renderListItem}
          settingsExtraSections={
            scopeFilterOptions && !sourceId ? (
              <ScopeFiltersInDrawer
                scopeFilterOptions={scopeFilterOptions}
                currentUserId={currentUserId}
                currentGroupId={currentGroupId}
                currentRoleKey={currentRoleKey}
              />
            ) : undefined
          }
          emptyState={emptyState}
        />
      </div>
      <DiscardedProspectDetailSheet
        item={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onSendToReview={handleSendToReview}
        pending={selected !== null && pendingItemId === selected.itemId}
      />
    </>
  );
}

function describeSendToReviewFailure(reason: string): string {
  switch (reason) {
    case 'not_allowed':
      return 'No tienes permisos para enviar este prospecto a revisión.';
    case 'out_of_scope':
      return 'Este prospecto está fuera de tu alcance comercial.';
    case 'not_found':
      return 'No se encontró el registro descartado.';
    case 'status_conflict':
      return 'El estado del registro cambió — actualiza la lista e inténtalo de nuevo.';
    case 'write_failed':
      return 'No se pudo completar la operación. Intenta de nuevo.';
    case 'claimed_by_other_seller':
      // AGENT1-SEND-TO-REVIEW-RECLAIM-1 — la empresa ya es de otro vendedor.
      return 'Otro vendedor ya tiene esta empresa en SellUp: quedó como duplicada.';
    default:
      return 'Ocurrió un error inesperado.';
  }
}
