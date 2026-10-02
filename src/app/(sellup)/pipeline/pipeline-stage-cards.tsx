"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  Bot,
  Building2,
  Check,
  FileSearch,
  Globe,
  Phone,
  Tag,
  User,
  UserCheck,
  Users,
  XCircle,
} from "@/icons";
import { cn } from "@/lib/utils";
import { formatAppDate, formatAppDateTime } from "@/lib/format-date";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { AIButton } from "@/components/ai/ai-button";
import { Heading, Text } from "@/components/typography";
import { SurfaceCard } from "@/components/shared/surface-card";
import { DetailItem, DetailList } from "@/components/shared/detail-list";
import { MetricCard } from "@/components/shared/metric-card";
import { countryName } from "@/components/shared/table-cells";
import {
  ListItem,
  ListItemGroup,
  StatusBadge,
  Timeline,
  TimelineItem,
  type TimelineTone,
} from "@/components/data-display";
import {
  resolveAccountRunProviderLabel,
  resolveAccountRunStatusBadge,
} from "@/components/contact-enrichment/account-agents-run-history";
import { SOURCE_LABELS } from "@/modules/accounts/types";
import { STAGE_PHASE_LABELS } from "@/modules/pipeline/stages";
import type { AccountJourney, JourneyEvent, JourneyStage, PipelineStageId } from "@/modules/pipeline/types";
import {
  SIGNAL_BADGE_VARIANT,
  STAGE_STATE_BADGE,
  formatUsd,
  hubspotApprovalLabel,
  sourcePrimaryLabel,
} from "./pipeline-copy";

const LINK_CLASSES =
  "rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

/** Cuántas corridas y decisores se enseñan antes de mandar a la ficha de la empresa. */
const SHORT_LIST_LIMIT = 5;

/** El `id` del ancla de la tarjeta de una etapa (la pista desplaza hasta aquí). */
export function stageAnchorId(stageId: PipelineStageId): string {
  return `etapa-${stageId}`;
}

function percent(value: number | null): string | null {
  return value === null ? null : `${Math.round(value)}%`;
}

// ── Marco común de una tarjeta de etapa ─────────────────────────

interface StageCardFrameProps {
  entry: JourneyStage;
  index: number;
  children: ReactNode;
}

function StageCardFrame({ entry, index, children }: StageCardFrameProps) {
  const { stage, state, signals, milestoneAt } = entry;
  const isPlanned = stage.phase !== "hecho";
  const stateBadge = STAGE_STATE_BADGE[state];

  return (
    <SurfaceCard className={cn("p-5", isPlanned && "bg-surface-subtle shadow-none")}>
      <section id={stageAnchorId(stage.id)} className="scroll-mt-6" aria-labelledby={`${stageAnchorId(stage.id)}-titulo`} data-stage={stage.id} data-state={state}>
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Heading
                level={6}
                as="h3"
                id={`${stageAnchorId(stage.id)}-titulo`}
                tone={isPlanned ? "muted" : "default"}
              >
                {index + 1}. {stage.name}
              </Heading>
              <Badge variant={isPlanned ? "neutral" : "brand"}>
                {isPlanned ? STAGE_PHASE_LABELS[stage.phase] : stage.agent}
              </Badge>
              <StatusBadge status={stateBadge.status} label={stateBadge.label} />
            </div>
            <Text size="xs" tone="secondary" className="max-w-3xl leading-relaxed">
              {stage.summary}
            </Text>
          </div>
          {milestoneAt && (
            <Text as="span" size="xs" tone="muted" tabular className="shrink-0">
              {formatAppDate(milestoneAt)}
            </Text>
          )}
        </header>

        {signals.length > 0 && (
          <ul aria-label={`Avisos de ${stage.name}`} className="mt-3 flex flex-wrap gap-1.5">
            {signals.map((signal) => (
              <li key={signal.id}>
                <Badge variant={SIGNAL_BADGE_VARIANT[signal.severity]}>{signal.label}</Badge>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex flex-col gap-4">{children}</div>
      </section>
    </SurfaceCard>
  );
}

// ── Prospección ─────────────────────────────────────────────────

function ProspeccionBody({ journey }: { journey: AccountJourney }) {
  const { account, origin } = journey;
  const tracking = (
    <DetailList aria-label="Seguimiento de la empresa">
      <DetailItem icon={User} label="Responsable" emptyLabel="Sin asignar">
        {account.ownerName}
      </DetailItem>
      <DetailItem icon={Globe} label="HubSpot hoy">
        {account.hubspotLabel}
        {account.hubspotCompanyId && (
          <span className="ml-1 text-xs tabular-nums text-muted-foreground">· ficha n.º {account.hubspotCompanyId}</span>
        )}
      </DetailItem>
    </DetailList>
  );

  if (!origin) {
    return (
      <>
        {account.source === "manual" ? (
          <Text tone="secondary">
            Creada a mano por {account.createdByName ?? "alguien del equipo"} el {formatAppDate(account.createdAt)}.
          </Text>
        ) : (
          <EmptyState
            variant="plain"
            icon={FileSearch}
            title="No hay rastro del origen"
            description={`La empresa llegó por «${SOURCE_LABELS[account.source]}» el ${formatAppDate(account.createdAt)}, pero no quedó enlazada a ningún prospecto.`}
          />
        )}
        {tracking}
      </>
    );
  }

  const provider = sourcePrimaryLabel(origin.sourcePrimary);
  const fit = percent(origin.fitScore);
  const confidence = percent(origin.confidenceScore);
  const classification = origin.claudeClassification;
  const hubspotAtApproval = hubspotApprovalLabel(origin.hubspotAction);
  const approvedAt = origin.approvedAt ?? origin.reviewedAt;
  const taxId = origin.taxIdentifier ?? account.taxIdentifier;
  const taxIdType = origin.taxIdentifierType ?? account.taxIdentifierType;

  return (
    <>
      <DetailList aria-label="Origen de la empresa">
        <DetailItem icon={Tag} label="Origen">
          {SOURCE_LABELS[account.source]}
          {provider && <span className="text-muted-foreground"> · {provider}</span>}
        </DetailItem>
        <DetailItem label="Lote" emptyLabel="Sin lote">
          {origin.batchId ? (
            <Link href={`/prospect-batches/${origin.batchId}`} className={LINK_CLASSES}>
              {origin.batchName ?? "Ver lote"}
            </Link>
          ) : null}
        </DetailItem>
        <DetailItem label="Encaje ICP" emptyLabel="Sin puntaje">
          {fit || confidence
            ? [fit ? `Encaje ${fit}` : null, confidence ? `confianza ${confidence}` : null].filter(Boolean).join(" · ")
            : null}
        </DetailItem>
        <DetailItem label="Clasificación de Claude" emptyLabel="Sin clasificación">
          {classification ? (
            <span className="flex flex-col gap-0.5">
              <span>
                {[classification.sector?.label, classification.employeeRange?.label].filter(Boolean).join(" · ") ||
                  classification.outcomeLabel}
              </span>
              {classification.sector && (
                <span className="text-xs text-muted-foreground">{classification.sector.verificationLabel}</span>
              )}
            </span>
          ) : null}
        </DetailItem>
        <DetailItem label="Identificador fiscal" emptyLabel="Sin identificador">
          {taxId ? (
            <span className="tabular-nums">
              {taxIdType && taxIdType !== "other" ? `${taxIdType} ` : ""}
              {taxId}
            </span>
          ) : null}
        </DetailItem>
        <DetailItem icon={UserCheck} label="Aprobado por" emptyLabel="Sin registro de aprobación">
          {origin.reviewerName || approvedAt
            ? [origin.reviewerName, approvedAt ? formatAppDateTime(approvedAt) : null].filter(Boolean).join(" · ")
            : null}
        </DetailItem>
        <DetailItem label="HubSpot al aprobar" emptyLabel="Sin registro">
          {hubspotAtApproval}
        </DetailItem>
        <DetailItem label="Costo" emptyLabel="Sin costo registrado">
          {origin.estimatedCostUsd !== null ? (
            <span className="tabular-nums">{formatUsd(origin.estimatedCostUsd)} (estimado)</span>
          ) : null}
        </DetailItem>
      </DetailList>
      <div className="border-t border-border/60 pt-4">{tracking}</div>
    </>
  );
}

// ── Enriquecimiento de contactos ────────────────────────────────

const RUN_TONE: Record<string, TimelineTone> = {
  positive: "positive",
  negative: "negative",
  brand: "primary",
  neutral: "default",
};

function EnriquecimientoBody({
  journey,
  onSearchContacts,
}: {
  journey: AccountJourney;
  onSearchContacts?: () => void;
}) {
  const { account, contacts, runs } = journey;
  const shownRuns = runs.slice(0, SHORT_LIST_LIMIT);
  const shownDecisionMakers = contacts.decisionMakerList.slice(0, SHORT_LIST_LIMIT);
  const contactsHref = `/accounts/${account.id}?tab=contactos`;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard compact title="Contactos" value={contacts.total} tone="brand" icon={<Users />} />
        <MetricCard compact title="Decisores" value={contacts.decisionMakers} tone="info" icon={<UserCheck />} />
        <MetricCard compact title="Con teléfono" value={contacts.withPhone} tone="positive" icon={<Phone />} />
        <MetricCard compact title="En HubSpot" value={contacts.inHubSpot} tone="neutral" icon={<Globe />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Búsquedas del Agente 2A" className="flex min-w-0 flex-col gap-3">
          <Heading level={6} as="h4" weight="medium" className="text-sm">
            Búsquedas del Agente 2A
          </Heading>
          {runs.length === 0 ? (
            <Text size="xs" tone="muted">
              Todavía no se han buscado contactos para esta empresa.
            </Text>
          ) : (
            <>
              <Timeline>
                {shownRuns.map((run) => {
                  const badge = resolveAccountRunStatusBadge(run.status);
                  const isFailed = run.status === "failed";
                  const cost = run.realCostUsd ?? run.estimatedCostUsd;
                  return (
                    <TimelineItem
                      key={run.id}
                      density="compact"
                      tone={RUN_TONE[badge.variant] ?? "default"}
                      icon={isFailed ? <XCircle /> : <Bot />}
                      title={`${badge.label} · ${resolveAccountRunProviderLabel(run)}`}
                      time={formatAppDateTime(run.createdAt)}
                      description={
                        isFailed && run.summaryError
                          ? `No se completó: ${run.summaryError}`
                          : `${run.candidateCount} encontrados · ${run.approvedCount} aprobados · ${formatUsd(cost)}`
                      }
                    />
                  );
                })}
              </Timeline>
              {runs.length > shownRuns.length && (
                <Link href={`/accounts/${account.id}?tab=agentes`} className={cn(LINK_CLASSES, "text-xs")}>
                  Ver las {runs.length} búsquedas
                </Link>
              )}
            </>
          )}
        </section>

        <section aria-label="Decisores" className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Heading level={6} as="h4" weight="medium" className="text-sm">
              Decisores
            </Heading>
            {contacts.total > 0 && (
              <Link href={contactsHref} className={cn(LINK_CLASSES, "text-xs")}>
                Ver todos
              </Link>
            )}
          </div>
          {shownDecisionMakers.length === 0 ? (
            <Text size="xs" tone="muted">
              {contacts.total === 0
                ? "Esta empresa aún no tiene contactos."
                : "Ninguno de sus contactos está marcado como decisor."}
            </Text>
          ) : (
            <ListItemGroup aria-label="Decisores de la empresa">
              {shownDecisionMakers.map((contact) => (
                <ListItem
                  key={contact.id}
                  size="sm"
                  title={contact.fullName}
                  description={contact.jobTitle ?? "Sin cargo"}
                  meta={
                    <span className="flex items-center gap-1.5">
                      <Badge variant={contact.hasRevealedPhone ? "positive" : "neutral"}>
                        {contact.hasRevealedPhone ? "Con teléfono" : "Sin teléfono"}
                      </Badge>
                      <Badge variant={contact.hubspotLinked ? "info" : "neutral"}>{contact.hubspotLabel}</Badge>
                    </span>
                  }
                />
              ))}
            </ListItemGroup>
          )}
        </section>
      </div>

      {onSearchContacts && !journey.isArchived && (
        <div>
          <AIButton size="sm" onClick={onSearchContacts}>
            Buscar contactos con IA
          </AIButton>
        </div>
      )}
    </>
  );
}

// ── Etapas previstas ────────────────────────────────────────────

/** Los datos REALES que SellUp ya tiene y que alimentarán la etapa. Nada inventado. */
function plannedFacts(stageId: PipelineStageId, journey: AccountJourney): { label: string; value: ReactNode }[] {
  const { account, contacts } = journey;
  const taxId = account.taxIdentifier
    ? `${account.taxIdentifierType && account.taxIdentifierType !== "other" ? `${account.taxIdentifierType} ` : ""}${account.taxIdentifier}`
    : null;

  switch (stageId) {
    case "inteligencia":
      return [
        { label: "País", value: countryName(account.countryCode) },
        { label: "Sector", value: account.industry },
        { label: "Tamaño", value: account.companySize },
        { label: "Dominio", value: account.domain },
        { label: "LinkedIn", value: account.linkedinUrl?.replace(/^https?:\/\/(www\.)?/i, "") ?? null },
        { label: "Decisores", value: contacts.decisionMakers },
      ];
    case "preparacion":
      return [
        { label: "Decisores", value: contacts.decisionMakers },
        { label: "Contactos con teléfono", value: contacts.withPhone },
        { label: "Sector", value: account.industry },
      ];
    case "reunion":
      return [
        { label: "Contactos", value: contacts.total },
        { label: "Contactos en HubSpot", value: contacts.inHubSpot },
      ];
    case "cotizacion":
      return [
        { label: "Tamaño", value: account.companySize },
        { label: "País", value: countryName(account.countryCode) },
        { label: "Identificador fiscal", value: taxId },
      ];
    case "venta_interna":
      return [
        { label: "Champions", value: contacts.champions },
        { label: "Decisores", value: contacts.decisionMakers },
        { label: "Sector", value: account.industry },
      ];
    case "cierre":
      return [
        { label: "HubSpot", value: account.hubspotLabel },
        { label: "Responsable", value: account.ownerName },
      ];
    default:
      return [];
  }
}

function PlannedBody({ entry, journey }: { entry: JourneyStage; journey: AccountJourney }) {
  const { stage } = entry;
  const facts = plannedFacts(stage.id, journey);
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
      <div className="flex flex-col gap-1">
        <Text size="xs" weight="medium" tone="secondary">
          {stage.agent}
        </Text>
        <Text tone="secondary" className="max-w-3xl leading-relaxed">
          {stage.plannedText}
        </Text>
      </div>
      {facts.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border/60 pt-4">
          <Text size="xs" weight="medium" tone="secondary">
            Lo que ya tiene SellUp para esta etapa
          </Text>
          <DetailList columns={3} aria-label={`Datos disponibles para ${stage.name}`}>
            {facts.map((fact) => (
              <DetailItem key={fact.label} label={fact.label}>
                {typeof fact.value === "number" ? <span className="tabular-nums">{fact.value}</span> : fact.value}
              </DetailItem>
            ))}
          </DetailList>
        </div>
      )}
    </>
  );
}

// ── Las ocho tarjetas ───────────────────────────────────────────

interface PipelineStageCardsProps {
  journey: AccountJourney;
  /** Abre el buscador de contactos del Agente 2A (el único agente que se ejecuta desde aquí). */
  onSearchContacts?: () => void;
}

export function PipelineStageCards({ journey, onSearchContacts }: PipelineStageCardsProps) {
  return (
    <div className="flex flex-col gap-3">
      {journey.stages.map((entry, index) => (
        <StageCardFrame key={entry.stage.id} entry={entry} index={index}>
          {entry.stage.id === "prospeccion" ? (
            <ProspeccionBody journey={journey} />
          ) : entry.stage.id === "enriquecimiento" ? (
            <EnriquecimientoBody journey={journey} onSearchContacts={onSearchContacts} />
          ) : (
            <PlannedBody entry={entry} journey={journey} />
          )}
        </StageCardFrame>
      ))}
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
