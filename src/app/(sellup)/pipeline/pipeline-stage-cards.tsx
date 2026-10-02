"use client";

import * as React from "react";
import type { ReactNode } from "react";
import {
  Activity,
  Bot,
  Building2,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Globe,
  PanelRight,
  Phone,
  Tag,
  Target,
  UserCheck,
  Users,
} from "@/icons";
import { cn } from "@/lib/utils";
import { formatAppDate, formatAppDateTime } from "@/lib/format-date";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AIButton } from "@/components/ai/ai-button";
import { Heading, Text } from "@/components/typography";
import { SurfaceCard } from "@/components/shared/surface-card";
import { DetailItem, DetailList } from "@/components/shared/detail-list";
import { EmptyCell } from "@/components/shared/table-cells";
import { StatusBadge, Timeline, TimelineItem } from "@/components/data-display";
import {
  resolveAccountRunProviderLabel,
  resolveAccountRunStatusBadge,
} from "@/components/contact-enrichment/account-agents-run-history";
import { SOURCE_LABELS } from "@/modules/accounts/types";
import { STAGE_PHASE_LABELS } from "@/modules/pipeline/stages";
import type { AccountJourney, JourneyEvent, JourneyStage, PipelineStageId } from "@/modules/pipeline/types";
import { SIGNAL_BADGE_VARIANT, STAGE_STATE_BADGE, sourcePrimaryLabel } from "./pipeline-copy";

/** El `id` del ancla de la tarjeta de una etapa (la pista desplaza hasta aquí). */
export function stageAnchorId(stageId: PipelineStageId): string {
  return `etapa-${stageId}`;
}

export function percent(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}%`;
}

/** Un dato o, si falta, la raya apagada del sistema (con nombre para lector de pantalla). */
export function orEmpty(value: ReactNode, emptyLabel: string): ReactNode {
  return value === null || value === undefined || value === "" ? <EmptyCell label={emptyLabel} /> : value;
}

// ── Marco común de una tarjeta de etapa ─────────────────────────

interface StageCardFrameProps {
  entry: JourneyStage;
  index: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Una etapa es un acordeón: la cabecera (nombre, agente, estado, qué pasa en la
 * etapa y la fecha del hito) es el botón que abre y cierra el detalle, y los
 * avisos se quedan a la vista aunque esté plegada. El título es el `h3` que
 * envuelve al botón (patrón de acordeón de WAI-ARIA).
 */
function StageCardFrame({ entry, index, open, onToggle, children }: StageCardFrameProps) {
  const { stage, state, signals, milestoneAt } = entry;
  const isPlanned = stage.phase !== "hecho";
  const stateBadge = STAGE_STATE_BADGE[state];
  const anchor = stageAnchorId(stage.id);
  const contentId = `${anchor}-detalle`;

  return (
    <SurfaceCard className={cn("p-0", isPlanned && "bg-surface-subtle shadow-none")}>
      <section
        id={anchor}
        className="scroll-mt-6"
        aria-labelledby={`${anchor}-titulo`}
        data-stage={stage.id}
        data-state={state}
        data-open={open}
      >
        <h3 id={`${anchor}-titulo`} className="m-0">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? contentId : undefined}
            onClick={onToggle}
            className="flex w-full items-start gap-3 rounded-2xl p-5 text-left outline-none transition-colors hover:bg-surface-muted/50 focus-visible:ring-3 focus-visible:ring-ring/40"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "text-base font-semibold tracking-tight",
                    isPlanned ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {index + 1}. {stage.name}
                </span>
                <Badge variant={isPlanned ? "neutral" : "brand"}>
                  {isPlanned ? STAGE_PHASE_LABELS[stage.phase] : stage.agent}
                </Badge>
                <StatusBadge status={stateBadge.status} label={stateBadge.label} />
              </span>
              <span className="block max-w-3xl text-xs font-normal leading-relaxed text-muted-foreground">
                {stage.summary}
              </span>
            </span>
            {milestoneAt && (
              <span className="shrink-0 pt-0.5 text-xs font-normal tabular-nums text-text-muted">
                {formatAppDate(milestoneAt)}
              </span>
            )}
            <ChevronDown
              aria-hidden
              className={cn("mt-1 size-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")}
            />
          </button>
        </h3>

        {signals.length > 0 && (
          <ul aria-label={`Avisos de ${stage.name}`} className="flex flex-wrap gap-1.5 px-5 pb-4">
            {signals.map((signal) => (
              <li key={signal.id}>
                <Badge variant={SIGNAL_BADGE_VARIANT[signal.severity]}>{signal.label}</Badge>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <div id={contentId} className="flex flex-col gap-3 border-t border-border/50 px-5 pb-5 pt-4">
            {children}
          </div>
        )}
      </section>
    </SurfaceCard>
  );
}

// ── Etapa disponible pero sin empezar: invitación a activarla ───

interface StageInvitationProps {
  entry: JourneyStage;
  index: number;
  journey: AccountJourney;
  onSearchContacts?: () => void;
}

/**
 * Una etapa cuyo agente ya existe y que para esta empresa aún no tiene nada no
 * es un acordeón (no hay nada que desplegar): es UNA fila, con la misma altura,
 * padding y anatomía que la cabecera de una etapa plegada, que invita a
 * activarla. Donde iría la descripción va la frase de invitación; donde irían la
 * fecha y la flecha, el accionador de IA secundario. La fila no es un botón: solo
 * el accionador es interactivo. Conserva el ancla y los `data-*` de la etapa
 * para que la pista siga llevando hasta ella, pero no se pliega ni cuenta para
 * «Expandir/Contraer todas».
 */
function StageInvitation({ entry, index, journey, onSearchContacts }: StageInvitationProps) {
  const { stage, state, signals } = entry;
  const stateBadge = STAGE_STATE_BADGE[state];
  const anchor = stageAnchorId(stage.id);
  const canActivate = Boolean(onSearchContacts) && !journey.isArchived;

  return (
    <SurfaceCard className="border-dashed bg-surface-subtle p-0 shadow-none">
      <section
        id={anchor}
        className="scroll-mt-6"
        aria-labelledby={`${anchor}-titulo`}
        data-stage={stage.id}
        data-state={state}
        data-invitation
      >
        <div className="flex flex-wrap items-start gap-3 p-5">
          <div className="flex min-w-0 flex-1 basis-64 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`${anchor}-titulo`} className="m-0 text-base font-semibold tracking-tight text-foreground">
                {index + 1}. {stage.name}
              </h3>
              <Badge variant="brand">{stage.agent}</Badge>
              <StatusBadge status={stateBadge.status} label={stateBadge.label} />
            </div>
            <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
              {journey.isArchived
                ? `No se buscaron los contactos de ${journey.account.name}: la empresa está archivada.`
                : `Aún no se han buscado los contactos de ${journey.account.name}.`}
            </p>
          </div>
          {canActivate && (
            <AIButton variant="secondary" size="sm" className="shrink-0" onClick={onSearchContacts}>
              Buscar contactos con IA
            </AIButton>
          )}
        </div>

        {signals.length > 0 && (
          <ul aria-label={`Avisos de ${stage.name}`} className="flex flex-wrap gap-1.5 px-5 pb-4">
            {signals.map((signal) => (
              <li key={signal.id}>
                <Badge variant={SIGNAL_BADGE_VARIANT[signal.severity]}>{signal.label}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SurfaceCard>
  );
}

// ── Cuerpo de una etapa: SOLO lo esencial ───────────────────────
//
// El acordeón resume; el drawer detalla. Abierta, una etapa enseña lo que se
// lee de una pasada (una fila de datos clave o de cifras) y «Ver más» abre el
// drawer con todo lo demás (`PipelineStageDrawer`). Nada se repite aquí.

/** La fila de datos clave, con la pieza del detalle de la empresa: todos los pares con icono. */
function StageSummary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DetailList columns={4} aria-label={label}>
      {children}
    </DetailList>
  );
}

function ProspeccionBody({ journey }: { journey: AccountJourney }) {
  const { account, origin } = journey;
  const sourceLabel = SOURCE_LABELS[account.source];

  if (!origin) {
    return account.source === "manual" ? (
      <Text tone="secondary">
        Creada a mano por {account.createdByName ?? "alguien del equipo"} el {formatAppDate(account.createdAt)}.
      </Text>
    ) : (
      <Text tone="secondary">
        No hay rastro del origen: llegó por «{sourceLabel}» el {formatAppDate(account.createdAt)}, sin quedar enlazada a
        ningún prospecto.
      </Text>
    );
  }

  const provider = sourcePrimaryLabel(origin.sourcePrimary);
  const fit = percent(origin.fitScore);
  const approvedAt = origin.approvedAt ?? origin.reviewedAt;

  return (
    <StageSummary label="Datos clave de la prospección">
      <DetailItem icon={Tag} label="Origen">
        {[sourceLabel, provider].filter(Boolean).join(" · ")}
      </DetailItem>
      <DetailItem icon={Target} label="Encaje ICP">
        {orEmpty(fit ? <span className="tabular-nums">{fit}</span> : null, "Sin puntaje")}
      </DetailItem>
      <DetailItem icon={UserCheck} label="Aprobado por">
        {orEmpty(
          origin.reviewerName || approvedAt
            ? [origin.reviewerName, approvedAt ? formatAppDate(approvedAt) : null].filter(Boolean).join(" · ")
            : null,
          "Sin registro de aprobación",
        )}
      </DetailItem>
      <DetailItem icon={Globe} label="HubSpot">
        <StatusBadge status={account.hubspotStatus} label={account.hubspotLabel} />
      </DetailItem>
    </StageSummary>
  );
}

/** Una cifra de la fila de datos clave: el número manda, sin caja propia. */
function Figure({ value }: { value: number }) {
  return <span className="text-base font-semibold tabular-nums text-foreground">{value}</span>;
}

function EnriquecimientoBody({ journey }: { journey: AccountJourney }) {
  const { contacts } = journey;
  return (
    <StageSummary label="Cifras de contactos">
      <DetailItem icon={Users} label="Contactos">
        <Figure value={contacts.total} />
      </DetailItem>
      <DetailItem icon={UserCheck} label="Decisores">
        <Figure value={contacts.decisionMakers} />
      </DetailItem>
      <DetailItem icon={Phone} label="Con teléfono">
        <Figure value={contacts.withPhone} />
      </DetailItem>
      <DetailItem icon={Globe} label="En HubSpot">
        <Figure value={contacts.inHubSpot} />
      </DetailItem>
    </StageSummary>
  );
}

/** La última búsqueda del agente, en una línea. */
function LastRunLine({ journey }: { journey: AccountJourney }) {
  const lastRun = journey.runs[0];
  return (
    <Text size="xs" tone="secondary" data-slot="stage-last-run" className="min-w-0 flex-1">
      {lastRun ? (
        <>
          <span className="font-medium text-foreground">Última búsqueda:</span>{" "}
          {[
            resolveAccountRunStatusBadge(lastRun.status).label,
            resolveAccountRunProviderLabel(lastRun),
            formatAppDate(lastRun.createdAt),
            lastRun.status === "failed" ? null : `${lastRun.approvedCount} aprobados`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </>
      ) : (
        "Aún no hay búsquedas del agente."
      )}
    </Text>
  );
}

function PlannedBody({ entry, journey }: { entry: JourneyStage; journey: AccountJourney }) {
  const { stage } = entry;
  const isResearching = stage.id === "inteligencia" && journey.account.pipelineStatus === "research_in_progress";

  return (
    <>
      {isResearching && (
        <Alert variant="info">
          <AlertTitle>Investigación en curso</AlertTitle>
          <AlertDescription>
            {journey.researchMarkedBy
              ? `Marcada por ${journey.researchMarkedBy}. Hoy la investigación la hace una persona.`
              : "Hoy la investigación la hace una persona."}
          </AlertDescription>
        </Alert>
      )}
      <Text tone="secondary" className="max-w-3xl leading-relaxed">
        {stage.plannedText}
      </Text>
    </>
  );
}

/** Las etapas con detalle que enseñar en el drawer: las que ya tienen agente. */
export function stageHasDetail(entry: JourneyStage): boolean {
  return entry.stage.phase === "hecho" && !entry.notStarted;
}

// ── Las ocho tarjetas ───────────────────────────────────────────

export interface StageFocusRequest {
  stageId: PipelineStageId;
  /** Cambia en cada petición, para que pedir dos veces la misma etapa vuelva a abrirla y llevar hasta ella. */
  nonce: number;
}

interface PipelineStageCardsProps {
  journey: AccountJourney;
  /** Abre el buscador de contactos del Agente 2A (el único agente que se ejecuta desde aquí). */
  onSearchContacts?: () => void;
  /** La pista de etapas pide una etapa: se abre y se lleva la vista hasta ella. */
  focusRequest?: StageFocusRequest | null;
  /** «Ver más»: abre el drawer de detalle de esa etapa. Sin ella no se ofrece. */
  onOpenStageDetail?: (stageId: PipelineStageId) => void;
}

/** De entrada solo está abierta la etapa en la que está la empresa; el resto se abre al pulsar su cabecera. */
function initialOpenStages(journey: AccountJourney): ReadonlySet<PipelineStageId> {
  const current = journey.stages.find((entry) => entry.state === "current" && !entry.notStarted);
  return new Set(current ? [current.stage.id] : []);
}

export function PipelineStageCards({
  journey,
  onSearchContacts,
  focusRequest = null,
  onOpenStageDetail,
}: PipelineStageCardsProps) {
  // El estado de abierto/cerrado es de la empresa mostrada: al elegir otra empresa vuelve a la configuración inicial.
  return (
    <StageAccordion
      key={journey.account.id}
      journey={journey}
      onSearchContacts={onSearchContacts}
      focusRequest={focusRequest}
      onOpenStageDetail={onOpenStageDetail}
    />
  );
}

function StageAccordion({ journey, onSearchContacts, focusRequest, onOpenStageDetail }: PipelineStageCardsProps) {
  const [openStages, setOpenStages] = React.useState<ReadonlySet<PipelineStageId>>(() => initialOpenStages(journey));
  // Una etapa-invitación no se pliega: no cuenta para «Expandir/Contraer todas».
  const allIds = React.useMemo(
    () => journey.stages.filter((entry) => !entry.notStarted).map((entry) => entry.stage.id),
    [journey.stages],
  );
  const allOpen = allIds.every((id) => openStages.has(id));

  const toggle = React.useCallback((stageId: PipelineStageId) => {
    setOpenStages((current) => {
      const next = new Set(current);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
  }, []);

  // La pista de etapas pide una etapa: se abre y, ya pintada, se lleva la vista hasta ella.
  const lastNonce = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!focusRequest || lastNonce.current === focusRequest.nonce) return;
    lastNonce.current = focusRequest.nonce;
    setOpenStages((current) => new Set(current).add(focusRequest.stageId));
    const frame = requestAnimationFrame(() => {
      document.getElementById(stageAnchorId(focusRequest.stageId))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setOpenStages(allOpen ? new Set() : new Set(allIds))}
        >
          <ChevronsUpDown aria-hidden />
          {allOpen ? "Contraer todas" : "Expandir todas"}
        </Button>
      </div>
      {journey.stages.map((entry, index) =>
        entry.notStarted ? (
          <StageInvitation
            key={entry.stage.id}
            entry={entry}
            index={index}
            journey={journey}
            onSearchContacts={onSearchContacts}
          />
        ) : (
        <StageCardFrame
          key={entry.stage.id}
          entry={entry}
          index={index}
          open={openStages.has(entry.stage.id)}
          onToggle={() => toggle(entry.stage.id)}
        >
          {entry.stage.id === "prospeccion" ? (
            <ProspeccionBody journey={journey} />
          ) : entry.stage.id === "enriquecimiento" ? (
            <EnriquecimientoBody journey={journey} />
          ) : (
            <PlannedBody entry={entry} journey={journey} />
          )}
          {(entry.stage.id === "enriquecimiento" || (onOpenStageDetail && stageHasDetail(entry))) && (
            // En escritorio, la línea y los botones comparten renglón (los botones, a la derecha); en
            // estrecho los botones bajan a su propio renglón.
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {entry.stage.id === "enriquecimiento" ? <LastRunLine journey={journey} /> : <span aria-hidden />}
              <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                {entry.stage.id === "enriquecimiento" && onSearchContacts && !journey.isArchived && (
                  // Secundario: el agente primario de la pantalla vive en la barra de acciones.
                  <AIButton variant="secondary" size="sm" onClick={onSearchContacts}>
                    Buscar más contactos con IA
                  </AIButton>
                )}
                {onOpenStageDetail && stageHasDetail(entry) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Ver más de ${entry.stage.name}`}
                    onClick={() => onOpenStageDetail(entry.stage.id)}
                  >
                    <PanelRight aria-hidden />
                    Ver más
                  </Button>
                )}
              </div>
            </div>
          )}
        </StageCardFrame>
        ),
      )}
    </div>
  );
}

// ── Historial unificado ─────────────────────────────────────────

const EVENT_ICON: Record<JourneyEvent["kind"], ReactNode> = {
  audit: <Building2 />,
  approval: <Check />,
  run: <Bot />,
};

export function PipelineHistory({ history }: { history: readonly JourneyEvent[] }) {
  return (
    <SurfaceCard className="p-5">
      <section aria-labelledby="pipeline-historial-titulo">
        <header className="mb-4 flex flex-col gap-1">
          <Heading level={6} as="h3" id="pipeline-historial-titulo">
            Historial
          </Heading>
          <Text size="xs" tone="secondary">
            Cambios de la empresa, aprobación del prospecto y búsquedas de contactos, de lo más reciente a lo más antiguo.
          </Text>
        </header>
        {history.length === 0 ? (
          <EmptyState variant="plain" icon={Activity} title="Aún no hay movimientos registrados" />
        ) : (
          <Timeline>
            {history.map((event) => (
              <TimelineItem
                key={event.id}
                tone={event.tone}
                icon={EVENT_ICON[event.kind]}
                title={event.title}
                time={formatAppDateTime(event.at)}
                description={event.description ?? undefined}
              />
            ))}
          </Timeline>
        )}
      </section>
    </SurfaceCard>
  );
}
