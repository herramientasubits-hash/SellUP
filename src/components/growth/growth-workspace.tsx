"use client";

import * as React from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowRight, ClipboardCheck, Search, Users } from "@/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Frame, FramePanel } from "@/components/shared/frame";
import { MetricStrip } from "@/components/shared/metric-strip";
import { IconChip } from "@/components/shared/icon-chip";
import { UrlTabs } from "@/components/navigation/url-tabs";
import type { Tone } from "@/lib/tone";
import { formatAppDate } from "@/lib/format-date";
import { BatchBulkEnrichmentButton } from "@/components/contact-enrichment/batch-bulk-enrichment-button";
import { BulkSearchesSection } from "@/components/prospect-batches/bulk-search/bulk-searches-section";
import type { AssignableUser } from "@/components/assignment/assign-owner-drawer";
import type { BulkSearchView } from "@/modules/prospect-batches/bulk-search/bulk-search-view";

/** Una búsqueda (lote) tal como la lee el equipo de Growth. */
export interface GrowthSearchRow {
  id: string;
  name: string;
  statusLabel: string;
  statusTone: Tone;
  /** De dónde salió: «Búsqueda con IA», «Archivo importado»… */
  originLabel: string;
  country: string | null;
  found: number;
  needsReview: number;
  approved: number;
  /** Ya son empresas en SellUp: de estas se pueden buscar contactos en masa. */
  converted: number;
  createdAt: string;
  createdBy: string | null;
}

export interface GrowthSummary {
  searches: number;
  needsReview: number;
  approved: number;
  inReview: number;
}

export interface GrowthWorkspaceProps {
  summary: GrowthSummary;
  searches: GrowthSearchRow[];
  /** El asistente «Nueva búsqueda con IA», resuelto en el servidor (flags, catálogo, presupuesto). */
  newSearchAction: React.ReactNode;
  /** «Importar archivo»: el drawer de importación con su botón. */
  importAction: React.ReactNode;
  /**
   * Las acciones de la pantalla, las mismas de «Por revisar»: van a la barra de
   * acciones o, con «En la pantalla», a la cabecera. Sin ellas (la galería sin
   * sesión) la cabecera muestra los dos botones sueltos.
   */
  screenActions?: React.ReactNode;
  initialTab?: string;
  /** Adónde lleva una búsqueda. Inyectable para la galería sin sesión. */
  searchHref?: (id: string) => string;
  reviewHref?: string;
  accountsHref?: string;
  /**
   * Puede buscar contactos en masa (capacidad de Growth, la decide el servidor). Sin ella,
   * la pestaña sólo explica el camino desde Empresas.
   */
  canEnrichBulk?: boolean;
  /** GROWTH-BULK-SEARCH-1 — las búsquedas masivas de quien mira (vacío si no aplica). */
  bulkSearches?: BulkSearchView[];
  /** A quién se pueden asignar sus empresas. */
  assignableUsers?: AssignableUser[];
}

const TONE_BADGE: Record<Tone, "brand" | "positive" | "warning" | "negative" | "info" | "neutral"> = {
  brand: "brand",
  positive: "positive",
  warning: "warning",
  negative: "negative",
  info: "info",
  violet: "brand",
  neutral: "neutral",
};

const TABS = [
  { id: "busquedas", label: "Búsquedas" },
  { id: "revision", label: "Por revisar" },
  { id: "contactos", label: "Contactos en masa" },
];

/**
 * Prospección masiva — la mesa de trabajo del equipo de Growth.
 *
 * El BD prospecta a mano desde Empresas; Growth trae empresas en cantidad:
 * búsquedas con IA, archivos importados y búsqueda de contactos para muchas
 * empresas a la vez. Todo lo que entra pasa por «Por revisar» con las mismas
 * validaciones de siempre (duplicados en SellUp y en HubSpot, sitio web,
 * empresa liquidada) antes de crearse en SellUp o en HubSpot: esta pantalla
 * ordena el trabajo, no abre un atajo.
 */
export function GrowthWorkspace({
  summary,
  searches,
  newSearchAction,
  importAction,
  screenActions,
  initialTab,
  searchHref = (id) => `/prospect-batches/${id}`,
  reviewHref = "/accounts?tab=prospectos",
  accountsHref = "/accounts",
  canEnrichBulk = false,
  bulkSearches = [],
  assignableUsers = [],
}: GrowthWorkspaceProps) {
  // Las rondas de una búsqueda masiva se ven en su fila, no como 20–40 búsquedas sueltas.
  const roundBatchIds = React.useMemo(() => new Set(bulkSearches.flatMap((search) => search.batchIds)), [bulkSearches]);
  const tableSearches = React.useMemo(
    () => searches.filter((row) => !roundBatchIds.has(row.id)),
    [searches, roundBatchIds],
  );
  const withCompanies = React.useMemo(() => searches.filter((row) => row.converted > 0), [searches]);
  const enrichColumns = React.useMemo<ColumnDef<GrowthSearchRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Búsqueda",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={searchHref(row.original.id)}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
            <p className="text-xs text-muted-foreground">
              {row.original.originLabel}
              {row.original.country ? ` · ${row.original.country}` : ""}
            </p>
          </div>
        ),
      },
      {
        id: "converted",
        accessorKey: "converted",
        header: "Empresas creadas",
        cell: ({ row }) => <span className="tabular-nums">{row.original.converted}</span>,
      },
      {
        id: "enrich",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            <BatchBulkEnrichmentButton batchId={row.original.id} convertedCount={row.original.converted} />
          </div>
        ),
      },
    ],
    [searchHref],
  );

  const columns = React.useMemo<ColumnDef<GrowthSearchRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Búsqueda",
        cell: ({ row }) => (
          <div className="min-w-0">
            <Link
              href={searchHref(row.original.id)}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {row.original.name}
            </Link>
            <p className="text-xs text-muted-foreground">
              {row.original.originLabel}
              {row.original.country ? ` · ${row.original.country}` : ""}
            </p>
          </div>
        ),
      },
      {
        id: "status",
        accessorKey: "statusLabel",
        header: "Estado",
        cell: ({ row }) => (
          <Badge variant={TONE_BADGE[row.original.statusTone]}>{row.original.statusLabel}</Badge>
        ),
      },
      {
        id: "found",
        accessorKey: "found",
        header: "Encontradas",
        cell: ({ row }) => <span className="tabular-nums">{row.original.found}</span>,
      },
      {
        id: "needsReview",
        accessorKey: "needsReview",
        header: "Por revisar",
        cell: ({ row }) =>
          row.original.needsReview > 0 ? (
            <Badge variant="warning">{row.original.needsReview}</Badge>
          ) : (
            <span className="text-muted-foreground tabular-nums">0</span>
          ),
      },
      {
        id: "approved",
        accessorKey: "approved",
        header: "Aprobadas",
        cell: ({ row }) => <span className="tabular-nums">{row.original.approved}</span>,
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: "Fecha",
        cell: ({ row }) => (
          <div className="text-sm">
            <p>{formatAppDate(row.original.createdAt)}</p>
            {row.original.createdBy && (
              <p className="text-xs text-muted-foreground">{row.original.createdBy}</p>
            )}
          </div>
        ),
      },
    ],
    [searchHref],
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Prospección masiva"
        description="Trae empresas en cantidad con búsquedas de IA o archivos, y revisa lo que llega antes de que pase a SellUp y a HubSpot."
        actions={
          screenActions ?? (
            <>
              {importAction}
              {newSearchAction}
            </>
          )
        }
      />

      <MetricStrip
        aria-label="Resumen de la prospección masiva"
        items={[
          { label: "Búsquedas", value: summary.searches, description: "Con IA o por archivo" },
          { label: "Por revisar", value: summary.needsReview, description: "Esperan una decisión" },
          { label: "En revisión", value: summary.inReview, description: "Búsquedas abiertas" },
          { label: "Aprobadas", value: summary.approved, description: "Ya son empresas" },
        ]}
      />

      <UrlTabs ariaLabel="Prospección masiva" initialTab={initialTab} tabs={TABS}>
        <TabsContent value="busquedas">
          <BulkSearchesSection searches={bulkSearches} users={assignableUsers} reviewHref={reviewHref} />
          {tableSearches.length === 0 && bulkSearches.length > 0 ? null : tableSearches.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Lanza tu primera búsqueda"
              description="Pide empresas por país e industria a la IA, o importa un archivo. Lo que encuentre llega a «Por revisar»."
              action={<div className="flex flex-wrap justify-center gap-2">{newSearchAction}{importAction}</div>}
            />
          ) : (
            <DataTable
              tableId="growth-searches"
              title="Búsquedas"
              noun="búsquedas"
              nounGender="f"
              columns={columns}
              data={tableSearches}
              getRowId={(row) => row.id}
              getRowLabel={(row) => row.name}
              enableColumnReorder={false}
            />
          )}
        </TabsContent>

        <TabsContent value="revision">
          <GuideCard
            icon={ClipboardCheck}
            tone="warning"
            title={
              summary.needsReview > 0
                ? `${summary.needsReview} ${summary.needsReview === 1 ? "empresa espera" : "empresas esperan"} tu decisión`
                : "No hay empresas por revisar"
            }
            steps={[
              "Abre cada empresa y revisa su web, su NIT y si ya existe en SellUp o en HubSpot.",
              "Aprueba las que encajan: se crean en SellUp y, si no existen, en HubSpot.",
              "Las que un BD trae y son posibles duplicados también llegan aquí para que decidas.",
            ]}
            action={
              <Button asChild>
                <Link href={reviewHref}>
                  Ir a «Por revisar»
                  <ArrowRight />
                </Link>
              </Button>
            }
          />
        </TabsContent>

        <TabsContent value="contactos" className="flex flex-col gap-4">
          {canEnrichBulk && withCompanies.length > 0 && (
            <DataTable
              tableId="growth-enrich-searches"
              title="Búsquedas con empresas creadas"
              noun="búsquedas"
              nounGender="f"
              columns={enrichColumns}
              data={withCompanies}
              getRowId={(row) => row.id}
              getRowLabel={(row) => row.name}
              enableColumnReorder={false}
            />
          )}
          <GuideCard
            icon={Users}
            tone="violet"
            title="Busca los contactos de muchas empresas a la vez"
            steps={[
              "Desde una búsqueda: «Buscar contactos de las aprobadas» toma las empresas que ya creó.",
              "O en Empresas, marca las que quieras y elige «Buscar contactos» en la barra de acciones.",
              "Los contactos que lleguen esperan revisión antes de ir a HubSpot.",
            ]}
            action={
              <Button asChild variant="outline">
                <Link href={accountsHref}>
                  Elegir empresas
                  <ArrowRight />
                </Link>
              </Button>
            }
          />
        </TabsContent>
      </UrlTabs>
    </div>
  );
}

function GuideCard({
  icon,
  tone,
  title,
  steps,
  action,
}: {
  icon: typeof Search;
  tone: Tone;
  title: string;
  steps: string[];
  action: React.ReactNode;
}) {
  return (
    <Frame>
      <FramePanel>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <IconChip icon={icon} tone={tone} size="lg" />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
            <ol className="mt-3 grid gap-2 text-sm text-muted-foreground">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-2">
                  <span className="font-semibold tabular-nums text-foreground">{index + 1}.</span>
                  {step}
                </li>
              ))}
            </ol>
            <div className="mt-5">{action}</div>
          </div>
        </div>
      </FramePanel>
    </Frame>
  );
}
