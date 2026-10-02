"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ExternalLink, Search } from "@/icons";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading, Text } from "@/components/typography";
import { SurfaceCard } from "@/components/shared/surface-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { CountryCell, countryFlag, countryName } from "@/components/shared/table-cells";
import { FilterChips } from "@/components/filters/filter-chips";
import { Stepper, type StepperStep } from "@/components/navigation/stepper";
import { ListItem, ListItemGroup, StatusBadge } from "@/components/data-display";
import { PIPELINE_STATUS_LABELS, type PipelineStatus } from "@/modules/accounts/types";
import type {
  AccountJourney,
  PipelineOverview,
  PipelineOverviewAccount,
  PipelineSignalId,
  PipelineStageId,
} from "@/modules/pipeline/types";
import {
  BOARD_COLUMNS,
  SIGNAL_BADGE_VARIANT,
  SIGNAL_FILTER_LABELS,
  STAGE_SHORT_LABELS,
  currentStageBadge,
  daysAgoLabel,
  hasCriticalSignal,
} from "./pipeline-copy";
import { PipelineOverviewPanel } from "./pipeline-overview";
import { PipelineHistory, PipelineStageCards, stageAnchorId } from "./pipeline-stage-cards";
import { PipelineJourneySkeleton } from "./pipeline-skeleton";

/** Lo que devuelve mover una empresa de etapa (la forma de `updateAccount`). */
export type ChangeStageResult = { success: true } | { success: false; error: string };
export type ChangeStageAction = (accountId: string, status: PipelineStatus) => Promise<ChangeStageResult>;

type StageFilter = "all" | "enriquecimiento" | "inteligencia" | "preparacion";

// ── Panel izquierdo: la lista de empresas ───────────────────────

interface AccountListPanelProps {
  overview: PipelineOverview;
  selectedAccountId: string | null;
  onSelectAccount: (accountId: string | null) => void;
  signalFilter: PipelineSignalId | null;
  onSignalFilterChange: (signal: PipelineSignalId | null) => void;
}

function matchesSearch(account: PipelineOverviewAccount, query: string): boolean {
  if (!query) return true;
  const haystack = `${account.name} ${account.domain ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

function AccountListPanel({
  overview,
  selectedAccountId,
  onSelectAccount,
  signalFilter,
  onSignalFilterChange,
}: AccountListPanelProps) {
  const [search, setSearch] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState<StageFilter>("all");
  const query = search.trim().toLowerCase();

  const visible = overview.accounts.filter(
    (account) =>
      matchesSearch(account, query) &&
      (stageFilter === "all" || account.currentStageId === stageFilter) &&
      (!signalFilter || account.signals.some((signal) => signal.id === signalFilter)),
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
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

      <FilterChips
        wrap
        ariaLabel="Filtrar por etapa actual"
        value={stageFilter}
        onChange={(value) => setStageFilter(value as StageFilter)}
        options={[
          { value: "all", label: "Todas", count: overview.accounts.length },
          { value: "enriquecimiento", label: STAGE_SHORT_LABELS.enriquecimiento, count: overview.countsByStage.enriquecimiento },
          { value: "inteligencia", label: STAGE_SHORT_LABELS.inteligencia, count: overview.countsByStage.inteligencia },
          { value: "preparacion", label: STAGE_SHORT_LABELS.preparacion, count: overview.countsByStage.preparacion },
        ]}
      />

      {signalFilter && (
        <div className="flex items-center justify-between gap-2">
          <Badge variant="warning">{SIGNAL_FILTER_LABELS[signalFilter]}</Badge>
          <Button variant="ghost" size="xs" onClick={() => onSignalFilterChange(null)}>
            Quitar filtro
          </Button>
        </div>
      )}

      <Text size="xs" tone="muted" aria-live="polite">
        {visible.length === 1 ? "1 empresa" : `${visible.length} empresas`}
      </Text>

      {visible.length === 0 ? (
        <EmptyState
          variant="plain"
          title="Ninguna empresa coincide"
          description="Prueba con otro nombre o quita los filtros."
        />
      ) : (
        <ListItemGroup aria-label="Empresas del pipeline">
          {visible.map((account) => {
            const stage = currentStageBadge(account.currentStageId);
            const country = countryName(account.countryCode);
            const flag = countryFlag(account.countryCode);
            const needsAttention = account.signals.length > 0;
            return (
              <ListItem
                key={account.id}
                selected={account.id === selectedAccountId}
                onClick={() => onSelectAccount(account.id)}
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
  );
}

// ── Cabecera de la empresa y cambio de etapa ────────────────────

interface JourneyHeaderProps {
  journey: AccountJourney;
  onChangeStage?: ChangeStageAction;
}

function JourneyHeader({ journey, onChangeStage }: JourneyHeaderProps) {
  const { account } = journey;
  const stage = currentStageBadge(journey.currentStageId);
  const [target, setTarget] = React.useState<PipelineStatus | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function confirmChange() {
    if (!target || !onChangeStage || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const result = await onChangeStage(account.id, target);
      if (result.success) setTarget(null);
      else setError(result.error);
    } catch {
      setError("No se pudo mover la empresa. Inténtalo de nuevo.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SurfaceCard className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
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
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/accounts/${account.id}`}>
              Ver empresa
              <ExternalLink aria-hidden="true" />
            </Link>
          </Button>
          {onChangeStage && !journey.isArchived && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" />}>
                Cambiar etapa
                <ChevronDown aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {BOARD_COLUMNS.map((column) => (
                  <DropdownMenuItem
                    key={column.status}
                    disabled={column.status === account.pipelineStatus}
                    onClick={() => {
                      setError(null);
                      setTarget(column.status);
                    }}
                  >
                    {PIPELINE_STATUS_LABELS[column.status]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !isSaving) setTarget(null);
        }}
        title={target ? `¿Mover a «${PIPELINE_STATUS_LABELS[target]}»?` : ""}
        description={`${account.name} cambiará de etapa en el pipeline. Queda anotado en su historial.`}
        confirmLabel="Mover"
        loading={isSaving}
        onConfirm={confirmChange}
      >
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </ConfirmDialog>
    </SurfaceCard>
  );
}

// ── Pista de etapas ─────────────────────────────────────────────

function scrollToStage(stageId: PipelineStageId) {
  document.getElementById(stageAnchorId(stageId))?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function StageTrack({ journey }: { journey: AccountJourney }) {
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
        onStepClick={(index) => scrollToStage(journey.stages[index].stage.id)}
      />
    </SurfaceCard>
  );
}

// ── Recorrido de una empresa ────────────────────────────────────

interface JourneyDetailProps {
  journey: AccountJourney;
  onChangeStage?: ChangeStageAction;
  onSearchContacts?: () => void;
}

export function JourneyDetail({ journey, onChangeStage, onSearchContacts }: JourneyDetailProps) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <JourneyHeader journey={journey} onChangeStage={onChangeStage} />
      <StageTrack journey={journey} />
      <PipelineStageCards journey={journey} onSearchContacts={onSearchContacts} />
      <PipelineHistory history={journey.history} />
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
  /** Mueve la empresa de etapa. Sin ella no se ofrece «Cambiar etapa». */
  onChangeStage?: ChangeStageAction;
  onSearchContacts?: () => void;
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
  onChangeStage,
  onSearchContacts,
}: PipelineJourneyProps) {
  const [signalFilter, setSignalFilter] = React.useState<PipelineSignalId | null>(null);
  const activeAccountId = pendingAccountId ?? selectedAccountId;
  const hasSelection = activeAccountId !== null;
  const isLoading = pendingAccountId !== null && pendingAccountId !== journey?.account.id;
  const hasAccounts = overview.accounts.length > 0;

  let detail: React.ReactNode;
  if (isLoading) {
    detail = <PipelineJourneySkeleton />;
  } else if (selectedAccountId && journey) {
    detail = <JourneyDetail journey={journey} onChangeStage={onChangeStage} onSearchContacts={onSearchContacts} />;
  } else if (selectedAccountId) {
    detail = (
      <Alert variant="warning">
        <AlertTitle>No encontramos esa empresa</AlertTitle>
        <AlertDescription>Puede que ya no exista o que no esté entre las empresas que puedes ver.</AlertDescription>
      </Alert>
    );
  } else {
    detail = (
      <PipelineOverviewPanel overview={overview} signalFilter={signalFilter} onSignalFilterChange={setSignalFilter} />
    );
  }

  if (!hasAccounts && !hasSelection) return <div className="flex min-h-0 flex-1 flex-col">{detail}</div>;

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[21.25rem_minmax(0,1fr)] lg:items-start">
      <aside
        aria-label="Empresas"
        data-slot="pipeline-list"
        data-collapsed-on-mobile={hasSelection || undefined}
        className={cn("min-w-0", hasSelection && "hidden lg:block")}
      >
        <AccountListPanel
          overview={overview}
          selectedAccountId={activeAccountId}
          onSelectAccount={onSelectAccount}
          signalFilter={signalFilter}
          onSignalFilterChange={setSignalFilter}
        />
      </aside>

      <div
        data-slot="pipeline-detail"
        data-collapsed-on-mobile={!hasSelection || undefined}
        className={cn("flex min-w-0 flex-col gap-3", !hasSelection && "hidden lg:flex")}
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
