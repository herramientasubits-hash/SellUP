"use client";

import * as React from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  Building2,
  Check,
  ChevronDown,
  Globe,
  PanelRight,
  Phone,
  PhoneCall,
  Tag,
  Target,
  UserCheck,
  Users,
  Rumbo,
} from "@/icons";
import { cn } from "@/lib/utils";
import { formatAppDate, formatAppDateTime } from "@/lib/format-date";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { FirstCallLauncher } from "@/components/first-call/first-call-launcher";
import { SOURCE_LABELS } from "@/modules/accounts/types";
import { STAGE_PHASE_LABELS } from "@/modules/pipeline/stages";
import { isFirstCallStage } from "@/modules/pipeline/journey-first-call";
import { FIRST_CALL_CHANNELS, FIRST_CALL_CHANNEL_LABELS } from "@/server/agents/first-call/types";
import { buildCoverage, missingSelection } from "@/modules/speech/first-contact-wizard";
import { firstCallHref } from "@/modules/speech/first-call-links";
import type { AccountJourney, JourneyEvent, JourneyFirstCall, JourneyStage, PipelineStageId } from "@/modules/pipeline/types";
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
 * envuelve al botón (patrón de acordeón de WAI-ARIA). El detalle se pliega con
 * `Collapsible`: la altura viaja y las etapas de abajo se deslizan.
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
        <Collapsible open={open} onOpenChange={onToggle}>
          <h3 id={`${anchor}-titulo`} className="m-0">
            <CollapsibleTrigger
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
                className={cn("mt-1 size-4 shrink-0 text-text-muted transition-transform duration-200 ease-out", open && "rotate-180")}
              />
            </CollapsibleTrigger>
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

          <CollapsibleContent id={contentId}>
            <div className="flex flex-col gap-3 border-t border-border/50 px-5 pb-5 pt-4">
              {children}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
    </SurfaceCard>
  );
}

// ── Etapa disponible pero sin empezar: invitación a activarla ───

/**
 * «Preparar primer contacto» dentro de una etapa: al terminar, el recorrido se vuelve a leer.
 * Es un componente aparte para que `useRouter` solo exista cuando el Agente 3 está presente.
 */
function StageFirstCallLauncher(props: Omit<React.ComponentProps<typeof FirstCallLauncher>, "onDone">) {
  const router = useRouter();
  return <FirstCallLauncher {...props} onDone={() => router.refresh()} />;
}

/** La frase de invitación de «Primer contacto» cuando el Agente 3 aún no la ha hecho. */
function firstCallInvitation(accountName: string, archived: boolean): string {
  if (archived) return `No se preparó el primer contacto con ${accountName}: la empresa está archivada.`;
  return `Aún no se ha preparado el primer contacto con ${accountName}. El agente investiga la empresa y a sus decisores (cada dato con su fuente) y prepara qué decirle a cada uno en cada canal.`;
}

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
 * para que la pista siga llevando hasta ella, pero no se pliega.
 */
function StageInvitation({ entry, index, journey, onSearchContacts }: StageInvitationProps) {
  const { stage, state, signals } = entry;
  const stateBadge = STAGE_STATE_BADGE[state];
  const anchor = stageAnchorId(stage.id);
  // Las etapas del Agente 3 se activan con su propio botón; la de contactos, con el buscador del 2A.
  const firstCall = isFirstCallStage(stage.id) ? journey.agent3 ?? null : null;
  const canActivate = firstCall ? !journey.isArchived : Boolean(onSearchContacts) && !journey.isArchived;
  const invitation = firstCall
    ? firstCallInvitation(journey.account.name, journey.isArchived)
    : journey.isArchived
      ? `No se buscaron los contactos de ${journey.account.name}: la empresa está archivada.`
      : `Aún no se han buscado los contactos de ${journey.account.name}.`;

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
            <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{invitation}</p>
          </div>
          {canActivate && firstCall && (
            <div className="shrink-0">
              <StageFirstCallLauncher
                accountId={journey.account.id}
                accountName={journey.account.name}
                contacts={firstCall.contacts}
                hasFreshBrief={firstCall.freshBrief}
                variant="outline"
              />
            </div>
          )}
          {canActivate && !firstCall && (
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
  const isResearching = stage.id === "primer_contacto" && journey.account.pipelineStatus === "research_in_progress";

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

const BRIEF_STATUS_LABEL = { sufficient: "Suficiente para contactar", partial: "Parcial", failed: "No terminó" } as const;
const BRIEF_STATUS_BADGE = { sufficient: "completed", partial: "warning", failed: "error" } as const;
const PACK_STATUS_LABEL = { draft: "Lista", needs_review: "Revisar", used: "Usada" } as const;
const PACK_STATUS_BADGE = { draft: "info", needs_review: "warning", used: "completed" } as const;

/** «Primer contacto», la investigación: qué encontró el Agente 3, con qué y qué falta. */
function InteligenciaBody({ journey, firstCall }: { journey: AccountJourney; firstCall: JourneyFirstCall }) {
  const brief = firstCall.brief;
  if (!brief) return null;
  return (
    <>
      <StageSummary label="Cifras de la investigación">
        <DetailItem icon={Check} label="Estado">
          <StatusBadge status={BRIEF_STATUS_BADGE[brief.status]} label={BRIEF_STATUS_LABEL[brief.status]} />
        </DetailItem>
        <DetailItem icon={Tag} label="Datos con fuente">
          <Figure value={brief.factsCount} />
        </DetailItem>
        <DetailItem icon={Globe} label="Fuentes consultadas">
          <Figure value={brief.sourcesCount} />
        </DetailItem>
        <DetailItem icon={Activity} label="Vigente hasta">
          {brief.expiresAt ? (
            <Text size="sm" className="tabular-nums">
              {formatAppDate(brief.expiresAt)}
              {!firstCall.freshBrief && <span className="text-muted-foreground"> · vencida</span>}
            </Text>
          ) : (
            <EmptyCell />
          )}
        </DetailItem>
      </StageSummary>

      {brief.summary && (
        <Text tone="secondary" className="max-w-3xl leading-relaxed">
          {brief.summary}
        </Text>
      )}

      {brief.topics.length > 0 && (
        <section aria-label="Qué encontró" className="flex flex-col gap-1.5">
          <Text size="xs" tone="secondary">Qué encontró</Text>
          <ul className="flex flex-wrap gap-1.5">
            {brief.topics.map((topic) => (
              <li key={topic.label}>
                <Badge variant="outline">
                  {topic.label} · <span className="tabular-nums">{topic.count}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {brief.hypotheses.length > 0 && (
        <section aria-label="Hipótesis para UBITS" className="flex flex-col gap-1.5">
          <Text size="xs" tone="secondary">Hipótesis para UBITS (confírmalas en la conversación)</Text>
          <ul className="flex flex-col gap-1.5">
            {brief.hypotheses.map((h) => (
              <li key={h.text} className="flex flex-wrap items-start gap-2 text-sm text-foreground">
                <Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">{h.text}</span>
                {h.productName && <Badge variant="brand">{h.productName}</Badge>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {brief.gapsCount > 0 && (
        <Text size="xs" tone="secondary">
          {brief.gapsCount === 1 ? "1 pregunta quedó sin respuesta" : `${brief.gapsCount} preguntas quedaron sin respuesta`}: buenas para la primera conversación.
        </Text>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={firstCallHref(journey.account.id)}>Abrir la investigación</Link>
        </Button>
      </div>
    </>
  );
}

/** «Primer contacto», la preparación: lo preparado por decisor y canal, y lo que falta. */
function PreparacionBody({ journey, firstCall }: { journey: AccountJourney; firstCall: JourneyFirstCall }) {
  const coverage = buildCoverage(firstCall.packs, firstCall.contacts);
  const missing = missingSelection(coverage);
  const withPacks = coverage.filter((row) => FIRST_CALL_CHANNELS.some((c) => row.cells[c] !== null));
  const used = firstCall.packs.filter((p) => p.status === "used").length;
  const toReview = firstCall.packs.filter((p) => p.status === "needs_review").length;
  const launcherBase = {
    accountId: journey.account.id,
    accountName: journey.account.name,
    contacts: firstCall.contacts,
    hasFreshBrief: firstCall.freshBrief,
  };
  return (
    <>
      <StageSummary label="Cifras de la preparación">
        <DetailItem icon={Users} label="Decisores preparados">
          <Text size="sm" className="tabular-nums">
            {withPacks.filter((r) => r.contactId !== null).length} de {firstCall.contacts.length}
          </Text>
        </DetailItem>
        <DetailItem icon={PhoneCall} label="Preparaciones">
          <Figure value={firstCall.packs.length} />
        </DetailItem>
        <DetailItem icon={Check} label="Usadas">
          <Figure value={used} />
        </DetailItem>
        <DetailItem icon={Tag} label="Para revisar">
          <Figure value={toReview} />
        </DetailItem>
      </StageSummary>

      <ul aria-label="Preparaciones por decisor" className="flex flex-col divide-y divide-border/50">
        {withPacks.map((row) => {
          const products = [
            ...new Set(firstCall.packs.filter((p) => (p.contactId ?? null) === row.contactId).flatMap((p) => p.productNames)),
          ];
          return (
            <li key={row.contactId ?? "sin-decisor"} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Text size="sm" weight="medium">
                  {row.name}
                  {row.title && <span className="font-normal text-muted-foreground"> · {row.title}</span>}
                </Text>
                {products.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {products.map((name) => (
                      <Badge key={name} variant="outline">
                        {name}
                      </Badge>
                    ))}
                  </span>
                )}
              </div>
              <ul className="flex flex-wrap gap-1.5" aria-label={`Canales de ${row.name}`}>
                {FIRST_CALL_CHANNELS.map((channel) => {
                  const cell = row.cells[channel];
                  return (
                    <li key={channel}>
                      {cell ? (
                        <StatusBadge
                          status={PACK_STATUS_BADGE[cell.status as keyof typeof PACK_STATUS_BADGE] ?? "info"}
                          label={`${FIRST_CALL_CHANNEL_LABELS[channel]}: ${PACK_STATUS_LABEL[cell.status as keyof typeof PACK_STATUS_LABEL] ?? "Lista"}`}
                        />
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {FIRST_CALL_CHANNEL_LABELS[channel]}: falta
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      {missing && (
        <Text size="xs" tone="secondary">
          Falta preparar a {missing.contactIds.length === 1 ? "1 decisor" : `${missing.contactIds.length} decisores`} en algún canal.
        </Text>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {!journey.isArchived && missing && (
          <StageFirstCallLauncher
            {...launcherBase}
            variant="outline"
            label="Preparar lo que falta"
            initialSelection={{ contactIds: missing.contactIds, channels: missing.channels }}
          />
        )}
        {!journey.isArchived && <StageFirstCallLauncher {...launcherBase} variant="outline" label="Preparar otro" />}
        <Button asChild variant="outline" size="sm">
          <Link href={firstCallHref(journey.account.id)}>
            <PhoneCall aria-hidden />
            Ver las preparaciones
          </Link>
        </Button>
      </div>
    </>
  );
}

/** Las etapas con detalle que enseñar en el drawer: las que ya tienen agente y su propio detalle. */
export function stageHasDetail(entry: JourneyStage): boolean {
  // Las del Agente 3 se abren en la ficha de la empresa (pestaña «Primer contacto»).
  return entry.stage.phase === "hecho" && !entry.notStarted && !isFirstCallStage(entry.stage.id);
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

/** De entrada está abierta la etapa en la que está la empresa; el resto se abre al pulsar su cabecera. */
function initialOpenStage(journey: AccountJourney): PipelineStageId | null {
  const current = journey.stages.find((entry) => entry.state === "current" && !entry.notStarted);
  return current ? current.stage.id : null;
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
  // Un solo acordeón abierto a la vez: abrir una etapa cierra la que estuviera abierta.
  const [openStage, setOpenStage] = React.useState<PipelineStageId | null>(() => initialOpenStage(journey));

  const toggle = React.useCallback((stageId: PipelineStageId) => {
    setOpenStage((current) => (current === stageId ? null : stageId));
  }, []);

  // La pista de etapas pide una etapa: se abre y, ya pintada, se lleva la vista hasta ella.
  const lastNonce = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!focusRequest || lastNonce.current === focusRequest.nonce) return;
    lastNonce.current = focusRequest.nonce;
    setOpenStage(focusRequest.stageId);
    const frame = requestAnimationFrame(() => {
      document.getElementById(stageAnchorId(focusRequest.stageId))?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  return (
    <div className="flex flex-col gap-3">
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
          open={openStage === entry.stage.id}
          onToggle={() => toggle(entry.stage.id)}
        >
          {entry.stage.id === "prospeccion" ? (
            <ProspeccionBody journey={journey} />
          ) : entry.stage.id === "enriquecimiento" ? (
            <EnriquecimientoBody journey={journey} />
          ) : entry.stage.id === "primer_contacto" && journey.agent3 ? (
            // Una sola etapa: el agente investiga y prepara en la misma corrida (dueña 21-10).
            <>
              <InteligenciaBody journey={journey} firstCall={journey.agent3} />
              {journey.agent3.packs.length > 0 && <PreparacionBody journey={journey} firstCall={journey.agent3} />}
            </>
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
  run: <Rumbo />,
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
