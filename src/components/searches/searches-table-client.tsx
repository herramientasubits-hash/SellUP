"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { ClipboardCheck, Eye, Pause, Play, Search, UserPlus, X } from "@/icons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { DataTable, type DataTableContextMenuItem } from "@/components/data-table";
import { MetricStrip } from "@/components/shared/metric-strip";
import { formatAppDate } from "@/lib/format-date";
import { TONE_BADGE, type Tone } from "@/lib/tone";
import { BatchBulkEnrichmentButton } from "@/components/contact-enrichment/batch-bulk-enrichment-button";
import { BulkSearchAssignDrawer } from "@/components/prospect-batches/bulk-search/bulk-search-assign-drawer";
import type { AssignableUser } from "@/components/assignment/assign-owner-drawer";
import type { BulkSearchView } from "@/modules/prospect-batches/bulk-search/bulk-search-view";
import {
  BULK_SEARCH_STARTED_EVENT,
  controlBulkSearchViaRoute,
} from "@/modules/prospect-batches/bulk-search/bulk-search-client";
import { getSearchPendingCandidatesAction } from "@/modules/prospect-batches/searches/search-assign-actions";
import {
  markBulkRounds,
  searchReviewHref,
  summarizeSearches,
  type SearchRow,
} from "@/modules/prospect-batches/searches/search-rows";

export interface SearchesTableClientProps {
  searches: SearchRow[];
  /** Las búsquedas masivas de quien mira (vacío si no aplica). */
  bulkSearches?: BulkSearchView[];
  /** A quién se le pueden asignar empresas; vacío = no puede asignar. */
  assignableUsers?: AssignableUser[];
  /** Puede buscar contactos de muchas empresas a la vez (lo decide el servidor). */
  canEnrichBulk?: boolean;
  /** La búsqueda que se pidió ver (`?focus=`), resaltada arriba. */
  focusSearchId?: string | null;
  /** Lo que se ofrece cuando no hay ninguna búsqueda (Rumbo, importar). */
  emptyActions?: React.ReactNode;
  /** Adónde lleva una búsqueda. Inyectable para pruebas. */
  searchHref?: (id: string) => string;
}

/**
 * Empresas › Búsquedas (dueña 28-10): todas las búsquedas de quien mira, venga de
 * Rumbo (las cinco formas), de un archivo o de una fuente oficial. Cada uno ve lo que
 * buscó o le asignaron (el líder, su equipo); de una búsqueda ajena con empresas
 * asignadas, sólo esa parte. Cada lote es su propia fila —también las rondas de una
 * búsqueda masiva, que dicen de qué masiva salieron—: se revisan aparte y no se
 * mezclan. No hay una sección aparte para las masivas.
 */
export function SearchesTableClient({
  searches,
  bulkSearches = [],
  assignableUsers = [],
  canEnrichBulk = false,
  focusSearchId = null,
  emptyActions,
  searchHref = (id) => `/prospect-batches/${id}`,
}: SearchesTableClientProps) {
  const router = useRouter();
  const [assignRow, setAssignRow] = React.useState<SearchRow | null>(null);
  const [controlError, setControlError] = React.useState<string | null>(null);
  const canAssign = assignableUsers.length > 0;

  // Cada lote es su fila; las rondas de una masiva dicen de cuál salieron.
  const rows = React.useMemo(() => {
    const all = markBulkRounds(searches, bulkSearches);
    // La búsqueda pedida desde «Ver búsqueda» va primero.
    if (!focusSearchId) return all;
    const focused = all.find((row) => row.id === focusSearchId);
    return focused ? [focused, ...all.filter((row) => row.id !== focusSearchId)] : all;
  }, [searches, bulkSearches, focusSearchId]);
  const summary = React.useMemo(() => summarizeSearches(rows), [rows]);

  const controlBulk = React.useCallback(
    async (id: string, action: "pause" | "resume" | "cancel") => {
      setControlError(null);
      const response = await controlBulkSearchViaRoute(id, action);
      if (!response.ok) {
        setControlError("message" in response ? response.message : "No se pudo cambiar la búsqueda.");
        return;
      }
      // El Centro de procesos conduce sus rondas: al continuar, que la retome ya.
      if (action === "resume") window.dispatchEvent(new CustomEvent(BULK_SEARCH_STARTED_EVENT, { detail: { id } }));
      router.refresh();
    },
    [router],
  );

  const columns = React.useMemo<ColumnDef<SearchRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Búsqueda",
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href={searchHref(row.original.id)}
                className="truncate font-medium text-primary underline-offset-4 hover:underline"
              >
                {row.original.name}
              </Link>
              {row.original.id === focusSearchId && <Badge variant="brand">La que buscabas</Badge>}
            </div>
            {(row.original.visibility === "assigned" || row.original.bulkSearch) && (
              <p className="truncate text-xs text-muted-foreground">
                {row.original.bulkSearch
                  ? `De una búsqueda masiva de hasta ${row.original.bulkSearch.targetCount} empresas`
                  : "Sólo las que te asignaron"}
                {row.original.bulkSearch && row.original.visibility === "assigned" ? " · Sólo las que te asignaron" : ""}
              </p>
            )}
          </div>
        ),
        meta: { label: "Búsqueda", disableFilter: true },
      },
      {
        id: "form",
        accessorKey: "formLabel",
        header: "Forma",
        enableHiding: true,
        cell: ({ row }) => <span className="text-sm">{row.original.formLabel}</span>,
        meta: {
          label: "Forma",
          filterOptions: [...new Set(rows.map((row) => row.formLabel))].map((value) => ({ value, label: value })),
        },
      },
      {
        id: "status",
        accessorKey: "statusLabel",
        header: "Estado",
        cell: ({ row }) => (
          <Badge variant={TONE_BADGE[row.original.statusTone as Tone]}>{row.original.statusLabel}</Badge>
        ),
        meta: { label: "Estado" },
      },
      {
        id: "found",
        accessorKey: "found",
        header: "Encontradas",
        cell: ({ row }) => <span className="tabular-nums">{row.original.found}</span>,
        meta: { label: "Encontradas", disableFilter: true },
      },
      {
        id: "needsReview",
        accessorKey: "needsReview",
        header: "Por revisar",
        cell: ({ row }) =>
          row.original.needsReview > 0 ? (
            <Link href={searchReviewHref(row.original.id)} aria-label={`Ver las ${row.original.needsReview} por revisar`}>
              <Badge variant="warning" className="tabular-nums">
                {row.original.needsReview}
              </Badge>
            </Link>
          ) : (
            <span className="tabular-nums text-muted-foreground">0</span>
          ),
        meta: { label: "Por revisar", disableFilter: true },
      },
      {
        id: "approved",
        accessorKey: "approved",
        header: "Aprobadas",
        cell: ({ row }) => <span className="tabular-nums">{row.original.approved}</span>,
        meta: { label: "Aprobadas", disableFilter: true },
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: "Fecha",
        cell: ({ row }) => (
          <div className="text-sm">
            <p>{formatAppDate(row.original.createdAt)}</p>
            {row.original.createdBy && <p className="text-xs text-muted-foreground">{row.original.createdBy}</p>}
          </div>
        ),
        meta: { label: "Fecha", disableFilter: true },
      },
      ...(canEnrichBulk
        ? [
            {
              id: "contacts",
              header: () => <span className="sr-only">Contactos</span>,
              enableSorting: false,
              cell: ({ row }) =>
                row.original.converted > 0 ? (
                  <div className="flex justify-end">
                    <BatchBulkEnrichmentButton batchId={row.original.id} convertedCount={row.original.converted} />
                  </div>
                ) : null,
              meta: { label: "Contactos", disableFilter: true },
            } satisfies ColumnDef<SearchRow, unknown>,
          ]
        : []),
    ],
    [rows, searchHref, focusSearchId, canEnrichBulk],
  );

  const contextMenu = React.useMemo(
    () => ({
      items: (row: SearchRow): DataTableContextMenuItem[] => [
        { id: "view", label: "Ver detalle", icon: Eye, onClick: () => router.push(searchHref(row.id)) },
        {
          id: "review",
          label: "Ver por revisar",
          icon: ClipboardCheck,
          disabled: row.needsReview === 0,
          onClick: () => router.push(searchReviewHref(row.id)),
        },
        ...(canAssign && row.visibility === "full"
          ? [
              {
                id: "assign",
                label: "Asignar a…",
                icon: UserPlus,
                disabled: row.needsReview === 0,
                onClick: () => setAssignRow(row),
              },
            ]
          : []),
        // La búsqueda masiva de la que salió esta ronda, mientras siga viva.
        ...(row.bulkSearch?.status === "running"
          ? [{ id: "pause", label: "Pausar búsqueda masiva", icon: Pause, onClick: () => void controlBulk(row.bulkSearch!.id, "pause") }]
          : []),
        ...(row.bulkSearch?.status === "paused"
          ? [{ id: "resume", label: "Continuar búsqueda masiva", icon: Play, onClick: () => void controlBulk(row.bulkSearch!.id, "resume") }]
          : []),
        ...(row.bulkSearch && (row.bulkSearch.status === "running" || row.bulkSearch.status === "paused")
          ? [{ id: "cancel", label: "Cancelar búsqueda masiva", icon: X, onClick: () => void controlBulk(row.bulkSearch!.id, "cancel") }]
          : []),
      ],
    }),
    [router, searchHref, canAssign, controlBulk],
  );

  if (searches.length === 0 && bulkSearches.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="Todavía no hay búsquedas"
        description="Pídele empresas a Rumbo o importa un archivo. Cada búsqueda aparece aquí con lo que encontró y lo que falta por revisar."
        action={emptyActions}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-6">
      <MetricStrip
        aria-label="Resumen de tus búsquedas"
        items={[
          { label: "Búsquedas", value: summary.searches, description: "Las tuyas o con empresas asignadas" },
          { label: "Por revisar", value: summary.needsReview, description: "Esperan una decisión" },
          { label: "Abiertas", value: summary.open, description: "Con empresas por revisar" },
          { label: "Aprobadas", value: summary.approved, description: "Ya son empresas" },
        ]}
      />

      <DataTable
        tableId="empresas-busquedas"
        title="Búsquedas"
        noun="búsquedas"
        nounGender="f"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        getRowLabel={(row) => row.name}
        contextMenu={contextMenu}
        enableColumnReorder={false}
      />

      {controlError && (
        <p role="status" className="text-xs text-destructive">
          {controlError}
        </p>
      )}

      {assignRow && (
        <BulkSearchAssignDrawer
          open
          onOpenChange={(open) => !open && setAssignRow(null)}
          loadCandidates={() => getSearchPendingCandidatesAction([assignRow.id])}
          label={assignRow.name}
          users={assignableUsers}
          onAssigned={() => {
            setAssignRow(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
