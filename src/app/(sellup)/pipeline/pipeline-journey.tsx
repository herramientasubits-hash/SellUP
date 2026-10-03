"use client";

import * as React from "react";
import { ArrowLeft, LayoutDashboard, Search } from "@/icons";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/typography";
import { SurfaceCard } from "@/components/shared/surface-card";
import { CountryCell, countryFlag, countryName } from "@/components/shared/table-cells";
import { Stepper, type StepperStep } from "@/components/navigation/stepper";
import { ListItem, ListItemGroup, StatusBadge } from "@/components/data-display";
import {
  EMPTY_PIPELINE_FILTERS,
  applyPipelineFilters,
  countActiveFilters,
  isSignalFiltered,
  toggleSignalFilter,
  type PipelineFilters,
} from "@/modules/pipeline/pipeline-filters";
import type {
  AccountJourney,
  PipelineOverview,
  PipelineOverviewAccount,
  PipelineStageId,
} from "@/modules/pipeline/types";
import {
  SIGNAL_BADGE_VARIANT,
  STAGE_SHORT_LABELS,
  currentStageBadge,
  daysAgoLabel,
  hasCriticalSignal,
} from "./pipeline-copy";
import { PipelineFilterBar } from "./pipeline-filters-panel";
import { PipelineOverviewPanel } from "./pipeline-overview";
import { PipelineHistory, PipelineStageCards, type StageFocusRequest } from "./pipeline-stage-cards";
import { PipelineStageDrawer } from "./pipeline-stage-drawer";
import { PipelineJourneySkeleton } from "./pipeline-skeleton";

export type { ChangeStageAction, ChangeStageResult, StageMoveContext } from "./pipeline-stage-move";

// ── Panel izquierdo: el resumen y la lista de empresas ──────────

interface AccountListPanelProps {
  overview: PipelineOverview;
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string | null) => void;
  filters: PipelineFilters;
  onFiltersChange: (next: PipelineFilters) => void;
  now: Date;
}

function matchesSearch(account: PipelineOverviewAccount, query: string): boolean {
  if (!query) return true;
  const haystack = `${account.name} ${account.domain ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

/**
 * Arriba, fijo: la entrada «Resumen del pipeline», el buscador y los filtros.
 * Debajo, la lista de empresas con su propio scroll (en escritorio; en pantalla
 * estrecha la página es la que se desplaza).
 */
function AccountListPanel({
  overview,
  selectedAccountId,
  onSelectAccount,
  filters,
  onFiltersChange,
  now,
}: AccountListPanelProps) {
  const [search, setSearch] = React.useState("");
  const query = search.trim().toLowerCase();

  const visible = applyPipelineFilters(overview.accounts, filters, now).filter((account) =>
    matchesSearch(account, query),
  );
  const hasAnyFilter = countActiveFilters(filters) > 0 || query !== "";

  return (
    <div className="flex min-h-0 flex-col gap-3 lg:flex-1">
      <div className="flex shrink-0 flex-col gap-3">
        {/* El resumen solo existe como «una cosa a la vez» en escritorio; en móvil se llega con «Volver». */}
        <ListItemGroup aria-label="Resumen" className="hidden lg:flex">
          <ListItem
            size="sm"
            selected={selectedAccountId === null}
            onClick={() => onSelectAccount(null)}
            leading={<LayoutDashboard aria-hidden className="size-4 shrink-0 text-text-muted" />}
            title="Resumen del pipeline"
            description={
              overview.withSignalsTotal > 0
                ? `${overview.accounts.length} empresas · ${overview.withSignalsTotal} requieren atención`
                : `${overview.accounts.length} empresas`
            }
          />
        </ListItemGroup>

        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            aria-label="Buscar empresa por nombre o dominio"
            placeholder="Buscar por nombre o dominio"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>

        <PipelineFilterBar
          accounts={overview.accounts}
          filters={filters}
          onChange={onFiltersChange}
          visibleCount={visible.length}
        />
      </div>

      <div className="min-h-0 lg:-mx-1 lg:flex-1 lg:overflow-y-auto lg:px-1 lg:pb-1">
        {visible.length === 0 ? (
          <EmptyState
            variant="plain"
            title="Ninguna empresa coincide"
            description="Prueba con otro nombre o quita los filtros."
            action={
              hasAnyFilter ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    onFiltersChange({ ...EMPTY_PIPELINE_FILTERS, dateField: filters.dateField });
                  }}
                >
                  Limpiar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ListItemGroup aria-label="Empresas del pipeline">
            {visible.map((account) => {
              const stage = currentStageBadge(account.currentStageId);
              const country = countryName(account.countryCode);
              const flag = countryFlag(account.countryCode);
              const needsAttention = account.signals.length > 0;
              const isSelected = account.id === selectedAccountId;
              return (
                <ListItem
                  key={account.id}
                  selected={isSelected}
                  // Pulsar la empresa ya elegida vuelve al resumen.
                  onClick={() => onSelectAccount(isSelected ? null : account.id)}
                  title={account.name}
                  description={[country ? `${flag} ${country}`.trim() : null, daysAgoLabel(account.daysSinceMovement)]
                    .filter(Boolean)
                    .join(" · ")}
                  meta={
                    <span className="flex items-center gap-1.5">
                      {needsAttention && (
                        <span
                          role="img"
                          aria-label="Requiere atención"
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            hasCriticalSignal(account.signals) ? "bg-destructive" : "bg-warning",
                          )}
                        />
                      )}
                      <StatusBadge status={stage.status} label={stage.label} />
                    </span>
                  }
                />
              );
            })}
          </ListItemGroup>
        )}
      </div>
    </div>
  );
}

// ── Cabecera de la empresa y cambio de etapa ────────────────────

/**
 * Quién es la empresa y dónde está. Sin botones: «Cambiar etapa», «Ver empresa»
 * y el agente de IA viven en la barra de acciones de la pantalla
 * (`PipelineScreenActions`), para no duplicarlos.
 */
function JourneyHeader({ journey }: { journey: AccountJourney }) {
  const { account } = journey;
  const stage = currentStageBadge(journey.currentStageId);

  return (
    <SurfaceCard className="p-5">
      <div className="flex min-w-0 flex-col gap-2">
        <Heading level={5} as="h2" truncate>
          {account.name}
        </Heading>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <CountryCell code={account.countryCode} />
          {account.industry && <span>{account.industry}</span>}
          <span>{account.ownerName ? `Responsable: ${account.ownerName}` : "Sin responsable"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            status={stage.status}
            label={journey.isArchived ? stage.label : `${stage.label} · ${journey.substatusLabel}`}
          />
          {journey.signals.map((signal) => (
            <Badge key={signal.id} variant={SIGNAL_BADGE_VARIANT[signal.severity]}>
              {signal.label}
            </Badge>
          ))}
        </div>
        {account.lastStageNote && (
          // El contexto que dejó alguien al mover de etapa: lo último que sabe SellUp de la empresa.
          <p data-slot="last-stage-note" className="mt-1 line-clamp-2 border-t border-border/50 pt-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Última nota · {account.lastStageNote.header}:</span>{" "}
            {account.lastStageNote.body}
          </p>
        )}
      </div>
    </SurfaceCard>
  );
}

// ── Pista de etapas ─────────────────────────────────────────────

function StageTrack({ journey, onSelectStage }: { journey: AccountJourney; onSelectStage: (stageId: PipelineStageId) => void }) {
  const currentIndex = journey.stages.findIndex((entry) => entry.state === "current");
  const steps: StepperStep[] = journey.stages.map((entry) => ({
    id: entry.stage.id,
    label: STAGE_SHORT_LABELS[entry.stage.id],
    status:
      entry.state === "current"
        ? hasCriticalSignal(entry.signals)
          ? "error"
          : "current"
        : entry.state === "complete"
          ? "complete"
          : "upcoming",
  }));

  return (
    <SurfaceCard className="overflow-x-auto p-5">
      <Stepper
        aria-label="Etapas del proceso de venta"
        size="sm"
        className="min-w-180"
        steps={steps}
        current={currentIndex}
        clickableUpcoming
        onStepClick={(index) => onSelectStage(journey.stages[index].stage.id)}
      />
    </SurfaceCard>
  );
}

// ── Recorrido de una empresa ────────────────────────────────────

interface JourneyDetailProps {
  journey: AccountJourney;
  onSearchContacts?: () => void;
  /** Avisa de que el drawer de detalle de una etapa se abrió o se cerró (la barra se bloquea mientras). */
  onStageDetailOpenChange?: (open: boolean) => void;
}

export function JourneyDetail({ journey, onSearchContacts, onStageDetailOpenChange }: JourneyDetailProps) {
  const [detailStage, setDetailStage] = React.useState<PipelineStageId | null>(null);
  const setDetail = React.useCallback(
    (stageId: PipelineStageId | null) => {
      setDetailStage(stageId);
      onStageDetailOpenChange?.(stageId !== null);
    },
    [onStageDetailOpenChange],
  );
  const [focusRequest, setFocusRequest] = React.useState<StageFocusRequest | null>(null);
  const nonce = React.useRef(0);
  const selectStage = React.useCallback((stageId: PipelineStageId) => {
    nonce.current += 1;
    setFocusRequest({ stageId, nonce: nonce.current });
  }, []);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <JourneyHeader journey={journey} />
      <StageTrack journey={journey} onSelectStage={selectStage} />
      <PipelineStageCards
        journey={journey}
        onSearchContacts={onSearchContacts}
        focusRequest={focusRequest}
        onOpenStageDetail={setDetail}
      />
      <PipelineHistory history={journey.history} />
      <PipelineStageDrawer
        journey={journey}
        stageId={detailStage}
        onClose={() => setDetail(null)}
        onSearchContacts={onSearchContacts}
      />
    </div>
  );
}

// ── Vista «Recorrido» ───────────────────────────────────────────

export interface PipelineJourneyProps {
  overview: PipelineOverview;
  /** La empresa de `?account=`. */
  selectedAccountId: string | null;
  /** Su recorrido; `null` si no hay empresa elegida, o si no existe o está fuera de alcance. */
  journey: AccountJourney | null;
  /** Elegir una empresa (o `null` para volver al resumen): quien lo monta lo lleva a la URL. */
  onSelectAccount: (accountId: string | null) => void;
  /** La empresa hacia la que se está navegando: mientras llega, se pinta el esqueleto. */
  pendingAccountId?: string | null;
  onSearchContacts?: () => void;
  /** La barra flotante de acciones está abajo: el panel pegado le deja sitio. */
  railAtBottom?: boolean;
  /** El drawer de detalle de una etapa se abrió o se cerró. */
  onStageDetailOpenChange?: (open: boolean) => void;
  /** Los filtros de la lista, cuando los lleva quien monta la vista (la URL). Sin ellos, son estado local. */
  filters?: PipelineFilters;
  onFiltersChange?: (next: PipelineFilters) => void;
  /** «Ahora», para los filtros de fecha. Por defecto, el momento de montar la vista. */
  now?: Date;
}

/**
 * La vista principal del Pipeline: a la izquierda todas las empresas; a la
 * derecha, el resumen (sin empresa elegida) o el recorrido de la elegida por
 * las ocho etapas. En pantalla estrecha se ve una cosa cada vez: la lista, y
 * al elegir, el recorrido con «Volver».
 */
export function PipelineJourney({
  overview,
  selectedAccountId,
  journey,
  onSelectAccount,
  pendingAccountId = null,
  onSearchContacts,
  railAtBottom = false,
  onStageDetailOpenChange,
  filters: controlledFilters,
  onFiltersChange,
  now: nowProp,
}: PipelineJourneyProps) {
  // Los filtros los lleva quien monta la vista (a la URL); sin él, viven aquí.
  const [localFilters, setLocalFilters] = React.useState<PipelineFilters>(EMPTY_PIPELINE_FILTERS);
  const filters = controlledFilters ?? localFilters;
  const setFilters = onFiltersChange ?? setLocalFilters;
  const [mountedAt] = React.useState(() => new Date());
  const now = nowProp ?? mountedAt;
  const activeAccountId = pendingAccountId ?? selectedAccountId;
  const hasSelection = activeAccountId !== null;
  const isLoading = pendingAccountId !== null && pendingAccountId !== journey?.account.id;
  const hasAccounts = overview.accounts.length > 0;

  let detail: React.ReactNode;
  if (isLoading) {
    detail = <PipelineJourneySkeleton />;
  } else if (selectedAccountId && journey) {
    detail = <JourneyDetail
        key={journey.account.id}
        journey={journey}
        onSearchContacts={onSearchContacts}
        onStageDetailOpenChange={onStageDetailOpenChange}
      />;
  } else if (selectedAccountId) {
    detail = (
      <Alert variant="warning">
        <AlertTitle>No encontramos esa empresa</AlertTitle>
        <AlertDescription>Puede que ya no exista o que no esté entre las empresas que puedes ver.</AlertDescription>
      </Alert>
    );
  } else {
    detail = (
      <PipelineOverviewPanel
        overview={overview}
        isSignalFiltered={(signal) => isSignalFiltered(filters, signal)}
        onToggleSignal={(signal) => setFilters(toggleSignalFilter(filters, signal))}
        hasFilters={countActiveFilters(filters) > 0}
        onSelectAccount={onSelectAccount}
      />
    );
  }

  if (!hasAccounts && !hasSelection) return <div className="flex min-h-0 flex-1 flex-col">{detail}</div>;

  return (
    // Solo se desplaza la PÁGINA y, dentro del panel izquierdo, la lista de empresas: el panel va
    // pegado (`sticky`) bajo la cabecera de la app con su propio scroll, y el recorrido fluye con la
    // página. En pantalla estrecha todo fluye y se ve una cosa a la vez.
    <div className="grid min-w-0 gap-4 lg:grid-cols-[21.25rem_minmax(0,1fr)] lg:items-start">
      <aside
        aria-label="Empresas"
        data-slot="pipeline-list"
        data-collapsed-on-mobile={hasSelection || undefined}
        className={cn(
          "flex min-w-0 flex-col lg:sticky lg:top-4",
          // Con la barra flotante abajo, el panel pegado acaba antes para que no le tape las últimas
          // empresas, tampoco con la página sin desplazar (cuando aún tiene encima la cabecera de la página).
          railAtBottom ? "lg:max-h-[calc(100dvh-14.5rem)]" : "lg:max-h-[calc(100dvh-5.5rem)]",
          hasSelection && "hidden lg:flex",
        )}
      >
        <AccountListPanel
          overview={overview}
          selectedAccountId={activeAccountId}
          onSelectAccount={onSelectAccount}
          filters={filters}
          onFiltersChange={setFilters}
          now={now}
        />
      </aside>

      <div
        data-slot="pipeline-detail"
        data-collapsed-on-mobile={!hasSelection || undefined}
        className={cn(
          "flex min-w-0 flex-col gap-3",
          !hasSelection && "hidden lg:flex",
        )}
      >
        {hasSelection && (
          <div className="lg:hidden">
            <Button variant="ghost" size="sm" onClick={() => onSelectAccount(null)}>
              <ArrowLeft aria-hidden="true" />
              Volver
            </Button>
          </div>
        )}
        {detail}
      </div>
    </div>
  );
}
