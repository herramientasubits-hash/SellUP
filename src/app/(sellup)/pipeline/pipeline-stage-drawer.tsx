"use client";

import Link from "next/link";
import { Activity, ExternalLink, FileSearch, Tag, Target, UserCheck, Users } from "@/icons";
import { formatAppDate, formatAppDateTime } from "@/lib/format-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { AIButton } from "@/components/ai/ai-button";
import { Text } from "@/components/typography";
import { DrawerShell } from "@/components/shared/drawer-shell";
import { DrawerSection } from "@/components/shared/drawer-section";
import { DetailItem, DetailList } from "@/components/shared/detail-list";
import { EmptyCell } from "@/components/shared/table-cells";
import { ListItem, ListItemGroup, StatusBadge } from "@/components/data-display";
import { AccountAgentsRunHistory } from "@/components/contact-enrichment/account-agents-run-history";
import { SOURCE_LABELS } from "@/modules/accounts/types";
import type { AccountJourney, PipelineStageId } from "@/modules/pipeline/types";
import { STAGE_STATE_BADGE, formatUsd, hubspotApprovalLabel, sourcePrimaryLabel } from "./pipeline-copy";
import { orEmpty, percent } from "./pipeline-stage-cards";

const LINK_CLASSES =
  "rounded-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40";

// Dentro de una sección ningún par lleva icono (el icono va en el encabezado de la sección):
// así todas las etiquetas y valores arrancan en la misma columna.

function TodaySection({ journey }: { journey: AccountJourney }) {
  const { account } = journey;
  return (
    <DrawerSection title="Hoy" hint="Quién la lleva y cómo está en HubSpot ahora." icon={Activity} tone="neutral">
      <DetailList aria-label="Seguimiento de la empresa">
        <DetailItem label="Responsable">{orEmpty(account.ownerName, "Sin responsable")}</DetailItem>
        <DetailItem label="HubSpot hoy">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusBadge status={account.hubspotStatus} label={account.hubspotLabel} />
            {account.hubspotCompanyId && (
              <span className="text-xs tabular-nums text-muted-foreground">Ficha n.º {account.hubspotCompanyId}</span>
            )}
          </span>
        </DetailItem>
      </DetailList>
    </DrawerSection>
  );
}

function ProspeccionDetail({ journey }: { journey: AccountJourney }) {
  const { account, origin } = journey;
  const sourceLabel = SOURCE_LABELS[account.source];

  if (!origin) {
    return (
      <>
        <DrawerSection title="Origen" hint="Cómo llegó la empresa a SellUp." icon={Tag} tone="neutral">
          {account.source === "manual" ? (
            <Text tone="secondary">
              Creada a mano por {account.createdByName ?? "alguien del equipo"} el {formatAppDate(account.createdAt)}.
            </Text>
          ) : (
            <EmptyState
              variant="plain"
              icon={FileSearch}
              title="No hay rastro del origen"
              description={`La empresa llegó por «${sourceLabel}» el ${formatAppDate(account.createdAt)}, pero no quedó enlazada a ningún prospecto.`}
            />
          )}
        </DrawerSection>
        <TodaySection journey={journey} />
      </>
    );
  }

  const fit = percent(origin.fitScore);
  const confidence = percent(origin.confidenceScore);
  const classification = origin.claudeClassification;
  const classificationText = classification
    ? [classification.sector?.label, classification.employeeRange?.label].filter(Boolean).join(" · ") ||
      classification.outcomeLabel
    : null;
  const approvedAt = origin.approvedAt ?? origin.reviewedAt;
  const taxId = origin.taxIdentifier ?? account.taxIdentifier;
  const taxIdType = origin.taxIdentifierType ?? account.taxIdentifierType;

  return (
    <>
      <DrawerSection
        title="Origen"
        hint="De dónde salió el prospecto y cuánto costó encontrarlo."
        icon={Tag}
        tone="neutral"
      >
        <DetailList aria-label="Origen de la empresa">
          <DetailItem label="Fuente">{sourceLabel}</DetailItem>
          <DetailItem label="Proveedor">{orEmpty(sourcePrimaryLabel(origin.sourcePrimary), "Sin proveedor")}</DetailItem>
          <DetailItem label="Lote">
            {origin.batchId ? (
              <Link href={`/prospect-batches/${origin.batchId}`} className={LINK_CLASSES}>
                {origin.batchName ?? "Ver lote"}
              </Link>
            ) : (
              <EmptyCell label="Sin lote" />
            )}
          </DetailItem>
          <DetailItem label="Costo">
            {origin.estimatedCostUsd !== null ? (
              <span className="tabular-nums">
                {formatUsd(origin.estimatedCostUsd)} <span className="text-muted-foreground">(estimado)</span>
              </span>
            ) : (
              <EmptyCell label="Sin costo registrado" />
            )}
          </DetailItem>
        </DetailList>
      </DrawerSection>

      <DrawerSection
        title="Encaje y clasificación"
        hint="Qué tan bien encaja con el cliente ideal."
        icon={Target}
        tone="neutral"
      >
        <DetailList aria-label="Encaje y clasificación">
          <DetailItem label="Encaje ICP">
            {orEmpty(fit ? <span className="tabular-nums">{fit}</span> : null, "Sin puntaje")}
          </DetailItem>
          <DetailItem label="Confianza">
            {orEmpty(confidence ? <span className="tabular-nums">{confidence}</span> : null, "Sin confianza")}
          </DetailItem>
          <DetailItem label="Clasificación de Claude">
            {classificationText ? (
              <span className="flex flex-col gap-0.5">
                <span>{classificationText}</span>
                {classification?.sector && (
                  <span className="text-xs text-muted-foreground">{classification.sector.verificationLabel}</span>
                )}
              </span>
            ) : (
              <EmptyCell label="Sin clasificación" />
            )}
          </DetailItem>
          <DetailItem label="Identificador fiscal">
            {taxId ? (
              <span className="tabular-nums">
                {taxIdType && taxIdType !== "other" ? `${taxIdType} ` : ""}
                {taxId}
              </span>
            ) : (
              <EmptyCell label="Sin identificador" />
            )}
          </DetailItem>
        </DetailList>
      </DrawerSection>

      <DrawerSection
        title="Aprobación"
        hint="Quién aprobó el prospecto y qué pasó en HubSpot."
        icon={UserCheck}
        tone="neutral"
      >
        <DetailList aria-label="Aprobación del prospecto">
          <DetailItem label="Aprobado por">{orEmpty(origin.reviewerName, "Sin registro de quién aprobó")}</DetailItem>
          <DetailItem label="Fecha">
            {approvedAt ? (
              <span className="tabular-nums">{formatAppDateTime(approvedAt)}</span>
            ) : (
              <EmptyCell label="Sin fecha" />
            )}
          </DetailItem>
          <DetailItem label="HubSpot al aprobar">
            {orEmpty(hubspotApprovalLabel(origin.hubspotAction), "Sin registro")}
          </DetailItem>
        </DetailList>
      </DrawerSection>

      <TodaySection journey={journey} />
    </>
  );
}

function EnriquecimientoDetail({ journey }: { journey: AccountJourney }) {
  const { contacts } = journey;
  return (
    <>
      {/* El mismo historial de búsquedas que la pestaña «Agentes» de la empresa. */}
      <AccountAgentsRunHistory runs={journey.runs} />
      <DrawerSection
        title="Decisores"
        hint="Los contactos marcados como decisores de esta empresa."
        icon={Users}
        tone="neutral"
        badge={contacts.decisionMakerList.length}
      >
        {contacts.decisionMakerList.length === 0 ? (
          <Text size="xs" tone="muted">
            {contacts.total === 0
              ? "Esta empresa aún no tiene contactos."
              : "Ninguno de sus contactos está marcado como decisor."}
          </Text>
        ) : (
          <ListItemGroup aria-label="Decisores de la empresa">
            {contacts.decisionMakerList.map((contact) => (
              <ListItem
                key={contact.id}
                size="sm"
                title={contact.fullName}
                // Las insignias van bajo el cargo y no al lado: dos insignias en la
                // misma fila dejan el nombre sin sitio en un drawer estrecho.
                description={
                  <span className="flex flex-col gap-1.5 whitespace-normal">
                    <span>{contact.jobTitle ?? "Sin cargo"}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={contact.hasRevealedPhone ? "positive" : "neutral"}>
                        {contact.hasRevealedPhone ? "Con teléfono" : "Sin teléfono"}
                      </Badge>
                      <Badge variant={contact.hubspotLinked ? "info" : "neutral"}>{contact.hubspotLabel}</Badge>
                    </span>
                  </span>
                }
              />
            ))}
          </ListItemGroup>
        )}
      </DrawerSection>
    </>
  );
}

interface PipelineStageDrawerProps {
  journey: AccountJourney;
  /** La etapa cuyo detalle se muestra; `null` = cerrado. */
  stageId: PipelineStageId | null;
  onClose: () => void;
  /** Abre el buscador de contactos del Agente 2A (lo único que el drawer ejecuta). */
  onSearchContacts?: () => void;
}

/**
 * El detalle de una etapa, en un drawer: el acordeón resume y «Ver más» trae
 * aquí todo lo demás, organizado en secciones como el detalle de la empresa y
 * del prospecto. Es de solo lectura salvo «Buscar contactos con IA».
 */
export function PipelineStageDrawer({ journey, stageId, onClose, onSearchContacts }: PipelineStageDrawerProps) {
  const index = journey.stages.findIndex((entry) => entry.stage.id === stageId);
  const entry = index >= 0 ? journey.stages[index] : null;
  const { account, origin } = journey;
  const stateBadge = entry ? STAGE_STATE_BADGE[entry.state] : null;
  const canSearch = Boolean(onSearchContacts) && !journey.isArchived;

  return (
    <DrawerShell
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="lg"
      title={entry ? `${index + 1}. ${entry.stage.name} · ${account.name}` : ""}
      description={entry?.stage.summary}
      titleBadge={stateBadge ? <StatusBadge status={stateBadge.status} label={stateBadge.label} /> : undefined}
      footer={
        entry?.stage.id === "enriquecimiento" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/accounts/${account.id}?tab=contactos`}>
                Ver todos los contactos
                <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
            {canSearch && (
              <AIButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  // Un solo drawer a la vez: este se cierra antes de abrir el buscador.
                  onClose();
                  onSearchContacts?.();
                }}
              >
                Buscar más contactos con IA
              </AIButton>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {origin?.batchId && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/prospect-batches/${origin.batchId}`}>Ver lote</Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={`/accounts/${account.id}`}>
                Ver empresa
                <ExternalLink aria-hidden="true" />
              </Link>
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {entry?.stage.id === "prospeccion" && <ProspeccionDetail journey={journey} />}
        {entry?.stage.id === "enriquecimiento" && <EnriquecimientoDetail journey={journey} />}
      </div>
    </DrawerShell>
  );
}
