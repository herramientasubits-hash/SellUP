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
import { SendHorizonal, Ban, Info, ExternalLink, Building2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableContextMenuItem,
  type DataTableBulkAction,
} from '@/components/data-table';
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
  label: `${c.name} (${c.code})`,
  value: c.code,
}));

const DISPOSITION_FILTER_OPTIONS = (
  Object.keys(DISCARD_DISPOSITION_LABELS) as DiscardDispositionCode[]
).map((code) => ({ label: DISCARD_DISPOSITION_LABELS[code], value: code }));

interface DiscardedProspectsDataTableClientProps {
  items: DiscardedProspectItem[];
  scopeFilterOptions?: ScopeFilterOptions;
  currentUserId?: string;
  currentGroupId?: string;
  currentRoleKey?: string;
  /** Deep link desde una operación concreta: oculta los filtros de alcance. */
  sourceId?: string;
}

export function DiscardedProspectsDataTableClient({
  items,
  scopeFilterOptions,
  currentUserId = '',
  currentGroupId = '',
  currentRoleKey = '',
  sourceId,
}: DiscardedProspectsDataTableClientProps) {
  const router = useRouter();
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
      const eligible = selectedRows.filter((item) => item.status !== 'sent_to_review');
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
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSelected(item);
              }}
              className="text-left font-semibold text-foreground hover:text-su-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-su-brand rounded transition-colors text-sm"
            >
              {item.name}
            </button>
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
        cell: ({ row }) => (
          <span className="truncate text-xs text-muted-foreground">
            {row.original.domain ?? '—'}
          </span>
        ),
        size: 170,
        minSize: 130,
        meta: { label: 'Dominio', popoverTitle: 'Dominio', disableFilter: true },
      },
      {
        id: 'countryCode',
        accessorKey: 'countryCode',
        header: ({ column }) => <DataTableColumnHeader column={column} title="País" />,
        cell: ({ row }) => <span className="text-xs">{row.original.countryCode ?? '—'}</span>,
        size: 110,
        minSize: 90,
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
        cell: ({ row }) => (
          <span className="truncate text-xs text-muted-foreground">
            {row.original.industry ?? 'Sin sector'}
          </span>
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
        cell: ({ row }) => (
          <span className="truncate text-xs text-muted-foreground">
            {row.original.sourcePrimary ?? '—'}
          </span>
        ),
        size: 130,
        minSize: 100,
        filterFn: 'arrIncludesSome',
        meta: { label: 'Proveedor', popoverTitle: 'Proveedor', disableFilter: true },
      },
      {
        id: 'roundOrigin',
        accessorKey: 'roundOrigin',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ronda/origen" />,
        cell: ({ row }) => (
          <span className="truncate text-xs text-muted-foreground">
            {row.original.roundOrigin ?? row.original.batchName ?? '—'}
          </span>
        ),
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
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {createdAt ? formatProspectDate(createdAt) : '—'}
              </span>
              {isNew && (
                <Badge className="border-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-semibold px-1.5 py-0.5 shrink-0">
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
        cell: ({ row }) => (
          <Badge variant="outline" className="text-[10px] font-medium">
            {DISCARD_DISPOSITION_LABELS[row.original.disposition] ?? 'Otro motivo'}
          </Badge>
        ),
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
        cell: ({ row }) => (
          <Badge
            className={
              row.original.status === 'sent_to_review'
                ? 'border-0 bg-su-brand-soft text-su-brand text-[10px]'
                : 'border-0 bg-muted text-muted-foreground text-[10px]'
            }
          >
            {row.original.status === 'sent_to_review' ? 'Enviada a revisión' : 'Descartada'}
          </Badge>
        ),
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
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              disabled={item.status === 'sent_to_review' || isPending || bulkPending}
              onClick={(e) => {
                e.stopPropagation();
                void handleSendToReview(item);
              }}
            >
              <SendHorizonal className="h-3 w-3" />
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
          disabled: item.status === 'sent_to_review',
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
          selectedRows.every((item) => item.status === 'sent_to_review'),
        disabledLabel: (selectedRows) =>
          selectedRows.length > 0 &&
          selectedRows.every((item) => item.status === 'sent_to_review')
            ? 'Ya están en revisión'
            : undefined,
        confirm: {
          title: 'Enviar a revisión',
          description: (selectedRows) => {
            const eligible = selectedRows.filter((item) => item.status !== 'sent_to_review');
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

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.itemId}
        title="Empresas descartadas"
        description="Empresas que el pipeline descartó automáticamente o que se descartaron en revisión. Envíalas de vuelta sin volver a buscar."
        count={rows.length}
        enableRowSelection
        bulkActions={bulkActions}
        contextMenu={contextMenu}
        enableColumnReorder
        initialPageSize={20}
        fillHeight
        onRowClick={(row) => setSelected(row)}
        rowClickable
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
        emptyState={
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 rounded-full bg-muted/60 p-3">
              <Building2 className="h-6 w-6 text-muted-foreground/40" />
            </div>
            <p className="text-sm font-medium text-foreground">Sin empresas descartadas</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              Ninguna empresa descartada en el alcance actual.
            </p>
          </div>
        }
      />
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
    default:
      return 'Ocurrió un error inesperado.';
  }
}
