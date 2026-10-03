import type { AccountAuditEntry, AccountSource, PipelineStatus } from '@/modules/accounts/types';
import type { HubSpotCompanyPresentationStatus } from '@/modules/accounts/hubspot-company-sync-presentation';
import type { AccountContactEnrichmentRun } from '@/modules/contact-enrichment/account-run-history-types';
import type { ClaudeClassificationDisplay } from '@/components/prospect-batches/claude-classification-display';

// ── Etapas ─────────────────────────────────────────────────────

/** Las ocho etapas del proceso de venta, en orden. Modelo fijo (documentos de estrategia). */
export type PipelineStageId =
  | 'prospeccion'
  | 'enriquecimiento'
  | 'inteligencia'
  | 'preparacion'
  | 'reunion'
  | 'cotizacion'
  | 'venta_interna'
  | 'cierre';

/** En qué fase está el agente de la etapa: ya existe en SellUp o está previsto. */
export type PipelineStagePhase = 'hecho' | 'mvp' | 'fase_2' | 'fase_3';

export interface PipelineStage {
  id: PipelineStageId;
  name: string;
  /** Qué pasa en la etapa, en una frase. */
  summary: string;
  /** Rótulo del agente: «Agente 1», «Agente de cotización y propuesta»… */
  agent: string;
  phase: PipelineStagePhase;
  /** Para las previstas: qué hará el agente, en tuteo y sin jerga. */
  plannedText: string | null;
}

/** Cómo se ve una etapa en el recorrido de una empresa concreta. */
export type PipelineStageState = 'complete' | 'current' | 'upcoming' | 'archived';

// ── Señales de atención (doc 20; reglas, sin IA) ───────────────

export type PipelineSignalId =
  | 'sin_movimiento'
  | 'sin_contactos'
  | 'sin_responsable'
  | 'sin_hubspot'
  | 'corrida_fallida'
  | 'decisor_sin_telefono';

export type PipelineSignalSeverity = 'notice' | 'alert' | 'critical';

export interface PipelineSignal {
  id: PipelineSignalId;
  label: string;
  severity: PipelineSignalSeverity;
  /** Etapa sobre la que se muestra. */
  stageId: PipelineStageId;
  /** Detalle corto: «21 días», «3 decisores». */
  detail?: string;
}

/** Lo que las reglas de señales necesitan saber de una empresa. */
export interface PipelineSignalInput {
  pipelineStatus: PipelineStatus;
  currentStageId: PipelineStageId | null;
  /** Días desde el último movimiento de estado (o desde la creación). */
  daysSinceMovement: number;
  contactsTotal: number;
  decisionMakersTotal: number;
  decisionMakersWithPhone: number;
  hasOwner: boolean;
  hubspotSynced: boolean;
  lastRunStatus: string | null;
}

// ── Resumen del pipeline (vista de lista) ──────────────────────

export interface PipelineOverviewAccount {
  id: string;
  name: string;
  domain: string | null;
  countryCode: string | null;
  industry: string | null;
  ownerName: string | null;
  pipelineStatus: PipelineStatus;
  currentStageId: PipelineStageId | null;
  substatusLabel: string;
  daysSinceMovement: number;
  /** Último cambio de estado (o la creación, si nunca cambió), ISO. */
  lastMovementAt: string;
  /** Cuándo entró al pipeline (`created_at`), ISO. */
  createdAt: string;
  signals: PipelineSignal[];
}

export interface PipelineOverview {
  accounts: PipelineOverviewAccount[];
  /** Cuántas empresas tienen cada etapa como actual: las 8 del proceso (0 si ninguna ha llegado). */
  countsByStage: Record<PipelineStageId, number>;
  archivedTotal: number;
  /** Cuántas empresas tienen al menos una señal. */
  withSignalsTotal: number;
  /** Cuántas empresas tiene cada señal. */
  countsBySignal: Record<PipelineSignalId, number>;
}

// ── Recorrido de una empresa ───────────────────────────────────

/** El prospecto del que salió la empresa, ya leído y seguro para la UI. */
export interface OriginCandidate {
  id: string;
  batchId: string | null;
  batchName: string | null;
  batchSource: string | null;
  sourcePrimary: string | null;
  fitScore: number | null;
  confidenceScore: number | null;
  dataCompletenessScore: number | null;
  estimatedCostUsd: number | null;
  taxIdentifier: string | null;
  taxIdentifierType: string | null;
  recordOrigin: string | null;
  commercialFitStatus: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  approvedAt: string | null;
  /** `created` · `linked_existing` · `skipped_*` · `failed` · `not_required`. */
  hubspotAction: string | null;
  hubspotCompanyId: string | null;
  claudeClassification: ClaudeClassificationDisplay | null;
}

export interface JourneyContact {
  id: string;
  fullName: string;
  jobTitle: string | null;
  role: string | null;
  isPrimary: boolean;
  hasRevealedPhone: boolean;
  /** Lo que la ficha dice sobre HubSpot: «Sincronizado», «Sin sincronizar»… */
  hubspotLabel: string;
  hubspotLinked: boolean;
}

export interface JourneyStage {
  stage: PipelineStage;
  state: PipelineStageState;
  /** Las señales que caen sobre esta etapa. */
  signals: PipelineSignal[];
  /** Fecha del hito de la etapa, si existe (ISO). */
  milestoneAt: string | null;
  /**
   * La etapa ya tiene agente en SellUp pero para esta empresa aún no se ha hecho nada: se pinta
   * como una invitación a activarla, no como un acordeón vacío. Hoy solo puede serlo
   * `enriquecimiento` (sin contactos y sin ninguna búsqueda del Agente 2A).
   */
  notStarted: boolean;
}

export type JourneyEventKind = 'audit' | 'approval' | 'run';

export interface JourneyEvent {
  id: string;
  kind: JourneyEventKind;
  at: string;
  title: string;
  description: string | null;
  tone: 'default' | 'primary' | 'positive' | 'negative' | 'warning' | 'info';
}

export interface AccountJourney {
  account: {
    id: string;
    name: string;
    domain: string | null;
    website: string | null;
    linkedinUrl: string | null;
    countryCode: string | null;
    industry: string | null;
    companySize: string | null;
    taxIdentifier: string | null;
    taxIdentifierType: string | null;
    source: AccountSource;
    ownerName: string | null;
    createdByName: string | null;
    createdAt: string;
    pipelineStatus: PipelineStatus;
    hubspotCompanyId: string | null;
    hubspotLabel: string;
    /** El tono del chip de HubSpot (el vocabulario de `StatusBadge`). */
    hubspotStatus: HubSpotCompanyPresentationStatus;
    hubspotSynced: boolean;
    /** La última nota de etapa (el contexto que dejó alguien al mover de etapa), si hay. */
    lastStageNote: { header: string; body: string } | null;
  };
  currentStageId: PipelineStageId | null;
  substatusLabel: string;
  isArchived: boolean;
  daysSinceMovement: number;
  /** Quién marcó «Investigación en curso», si consta. */
  researchMarkedBy: string | null;
  signals: PipelineSignal[];
  stages: JourneyStage[];
  origin: OriginCandidate | null;
  contacts: {
    total: number;
    decisionMakers: number;
    champions: number;
    withPhone: number;
    inHubSpot: number;
    /** Los decisores, para la lista corta. */
    decisionMakerList: JourneyContact[];
  };
  runs: AccountContactEnrichmentRun[];
  audit: AccountAuditEntry[];
  history: JourneyEvent[];
}
