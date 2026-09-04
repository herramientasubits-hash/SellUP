'use client';

// AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — "Descartadas" table (issue #389).
//
// Renders the unified list from `getDiscardedProspectsList` (both the
// pipeline-auto-reject disposition rows and manually-discarded candidate
// rows). Row click opens the detail sheet; "Enviar a revisión" is offered
// per row and inside the detail sheet, both delegating to the same server
// action. Client-side table only — no provider calls, no direct writes.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { SendHorizonal, Ban } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  DataTable,
  DataTableColumnHeader,
  type DataTableContextMenuItem,
} from '@/components/data-table';
import { formatProspectDate } from '@/modules/prospect-batches/prospect-date-utils';
import { DISCARD_DISPOSITION_LABELS } from '@/modules/prospect-discards/types';
import type { DiscardedProspectItem } from '@/modules/prospect-discards/types';
import { sendDiscardedProspectToReviewAction } from '@/modules/prospect-discards/send-to-review-actions';
import { DiscardedProspectDetailSheet } from '@/components/prospects/discarded-prospect-detail-sheet';

interface DiscardedProspectsDataTableClientProps {
  items: DiscardedProspectItem[];
}

export function DiscardedProspectsDataTableClient({
  items,
}: DiscardedProspectsDataTableClientProps) {
  const router = useRouter();
  // AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — `items` is the source of truth from
  // the server; `hiddenItemIds` is purely a same-render optimistic overlay
  // (rows just sent to review) so the row disappears instantly without
  // waiting for `router.refresh()`'s server round-trip. Deriving `rows` this
  // way (no `useEffect` syncing `items` into state) avoids the cascading-render
  // anti-pattern react-hooks/set-state-in-effect flags.
  const [hiddenItemIds, setHiddenItemIds] = React.useState<ReadonlySet<string>>(new Set());
  const rows = React.useMemo(
    () => items.filter((item) => !hiddenItemIds.has(item.itemId)),
    [items, hiddenItemIds],
  );
  const [selected, setSelected] = React.useState<DiscardedProspectItem | null>(null);
  const [pendingItemId, setPendingItemId] = React.useState<string | null>(null);

  const handleSendToReview = React.useCallback(
    async (item: DiscardedProspectItem) => {
      setPendingItemId(item.itemId);
      try {
        const result = await sendDiscardedProspectToReviewAction(item.itemId);
        if (result.ok) {
          setHiddenItemIds((prev) => new Set(prev).add(item.itemId));
          setSelected(null);
          toast.success(
            result.status === 'idempotent_success'
              ? 'Este prospecto ya estaba en revisión.'
              : 'Enviado a revisión — sin nuevas búsquedas ni consumo.',
          );
          router.refresh();
        } else {
          toast.error(describeSendToReviewFailure(result.reason));
        }
      } finally {
        setPendingItemId(null);
      }
    },
    [router],
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
              onClick={() => setSelected(item)}
              className="text-left font-semibold text-foreground hover:text-su-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-su-brand rounded transition-colors text-sm"
            >
              {item.name}
            </button>
          );
        },
      },
      {
        id: 'domain',
        accessorKey: 'domain',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Dominio" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.domain ?? '—'}</span>
        ),
      },
      {
        id: 'countryCode',
        accessorKey: 'countryCode',
        header: ({ column }) => <DataTableColumnHeader column={column} title="País" />,
        cell: ({ row }) => (
          <span className="text-xs">{row.original.countryCode ?? '—'}</span>
        ),
      },
      {
        id: 'industry',
        accessorKey: 'industry',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Industria" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">{row.original.industry ?? '—'}</span>
        ),
      },
      {
        id: 'sourcePrimary',
        accessorKey: 'sourcePrimary',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Proveedor" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.sourcePrimary ?? '—'}
          </span>
        ),
      },
      {
        id: 'roundOrigin',
        accessorKey: 'roundOrigin',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Ronda/origen" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.roundOrigin ?? row.original.batchName ?? '—'}
          </span>
        ),
      },
      {
        id: 'createdAt',
        accessorKey: 'createdAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Fecha" />,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {formatProspectDate(row.original.createdAt)}
          </span>
        ),
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
              disabled={item.status === 'sent_to_review' || isPending}
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
      },
    ],
    [pendingItemId, handleSendToReview],
  );

  const contextMenu = {
    items: (item: DiscardedProspectItem): DataTableContextMenuItem[] => [
      {
        id: 'view-detail',
        label: 'Ver detalle',
        onClick: () => setSelected(item),
      },
      {
        id: 'send-to-review',
        label: 'Enviar a revisión',
        icon: SendHorizonal,
        disabled: item.status === 'sent_to_review',
        onClick: () => void handleSendToReview(item),
      },
      {
        id: 'keep-discarded',
        label: 'Dejar descartada',
        icon: Ban,
        onClick: () => setSelected(null),
      },
    ],
  };

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.itemId}
        onRowClick={(row) => setSelected(row)}
        rowClickable
        contextMenu={contextMenu}
        fillHeight
        emptyState={
          <div className="py-10 text-center text-sm text-muted-foreground">
            Ninguna empresa descartada en el alcance actual.
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
