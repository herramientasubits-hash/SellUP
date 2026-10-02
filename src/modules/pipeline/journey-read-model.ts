import {
  AUDIT_ACTION_LABELS,
  PIPELINE_STATUS_LABELS,
  type AccountAuditEntry,
  type AccountListItem,
  type AccountWithOwner,
  type PipelineStatus,
} from '@/modules/accounts/types';
import type { Contact } from '@/modules/contacts/types';
import { readHubSpotSyncState, resolveHubSpotSyncPresentation, readHubSpotSyncBaselineSource } from '@/modules/contacts/contact-hubspot-sync-state';
import type { AccountContactEnrichmentRun } from '@/modules/contact-enrichment/account-run-history-types';
import {
  isAccountHubSpotSynced,
  resolveHubSpotPresentation,
  safeAccountMetadata,
} from '@/modules/accounts/hubspot-company-sync-presentation';
import { PIPELINE_STAGES, resolveCurrentStage, resolveStageStates } from './stages';
import { computeSignals, daysBetween, highestSeverity, severityRank, SIGNAL_IDS } from './signals';
import type {
  AccountJourney,
  JourneyContact,
  JourneyEvent,
  JourneyStage,
  OriginCandidate,
  PipelineOverview,
  PipelineOverviewAccount,
  PipelineSignal,
  PipelineSignalId,
  PipelineStageId,
} from './types';

/**
 * Read model del Pipeline: funciones PURAS que componen el resumen y el
 * recorrido a partir de lo que ya existe en SellUp (cuenta, prospecto de
 * origen, contactos, corridas de Agente 2A y audit). Sin red, sin reloj
 * propio: `now` entra como parámetro para que las pruebas sean deterministas.
 */

// ── Movimiento ─────────────────────────────────────────────────

/** Fecha del último cambio de estado del audit; si no hay, la de creación. */
export function resolveLastMovementAt(
  audit: readonly Pick<AccountAuditEntry, 'action_type' | 'created_at'>[],
  createdAt: string,
): string {
  const statusChanges = audit
    .filter((entry) => entry.action_type === 'account_status_changed')
    .map((entry) => entry.created_at)
    .sort();
  return statusChanges[statusChanges.length - 1] ?? createdAt;
}

/** Quién marcó «Investigación en curso» por última vez, si consta en el audit. */
export function resolveResearchMarkedBy(audit: readonly AccountAuditEntry[]): string | null {
  const entry = [...audit]
    .filter(
      (candidate) =>
        candidate.action_type === 'account_status_changed' &&
        (candidate.details as { to?: unknown })?.to === 'research_in_progress',
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!entry?.actor) return null;
  return entry.actor.full_name ?? entry.actor.email ?? null;
}

// ── Contactos ──────────────────────────────────────────────────

export function isDecisionMaker(contact: Pick<Contact, 'role_in_account'>): boolean {
  return contact.role_in_account === 'decision_maker';
}

function toJourneyContact(contact: Contact): JourneyContact {
  const metadata = safeAccountMetadata(contact.metadata);
  const presentation = resolveHubSpotSyncPresentation({
    state: readHubSpotSyncState(metadata),
    baselineSource: readHubSpotSyncBaselineSource(metadata),
    hubspotContactId: contact.hubspot_contact_id,
  });
  return {
    id: contact.id,
    fullName: contact.full_name,
    jobTitle: contact.job_title,
    role: contact.role_in_account,
    isPrimary: contact.is_primary,
    hasRevealedPhone: Boolean(contact.phone_revealed_at),
    hubspotLabel: presentation.label,
    hubspotLinked: Boolean(contact.hubspot_contact_id),
  };
}

// ── Origen ─────────────────────────────────────────────────────

/** Lo que `metadata.approval` del prospecto dice del momento de aprobar. */
export function readApprovalMetadata(metadata: unknown): {
  approvedAt: string | null;
  hubspotAction: string | null;
  hubspotCompanyId: string | null;
} {
  const raw = safeAccountMetadata(metadata).approval;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { approvedAt: null, hubspotAction: null, hubspotCompanyId: null };
  }
  const approval = raw as Record<string, unknown>;
  const hubspot =
    approval.hubspot && typeof approval.hubspot === 'object' && !Array.isArray(approval.hubspot)
      ? (approval.hubspot as Record<string, unknown>)
      : {};
  return {
    approvedAt: typeof approval.approved_at === 'string' ? approval.approved_at : null,
    hubspotAction: typeof hubspot.action === 'string' ? hubspot.action : null,
    hubspotCompanyId: typeof hubspot.company_id === 'string' ? hubspot.company_id : null,
  };
}

// ── Historial unificado ────────────────────────────────────────

const AUDIT_TONE: Record<string, JourneyEvent['tone']> = {
  account_created: 'positive',
  account_updated: 'default',
  account_status_changed: 'primary',
  account_archived: 'warning',
  account_owner_changed: 'info',
};

function statusLabel(value: unknown): string | null {
  return typeof value === 'string' && value in PIPELINE_STATUS_LABELS
    ? PIPELINE_STATUS_LABELS[value as PipelineStatus]
    : null;
}

function auditDescription(entry: AccountAuditEntry): string | null {
  const parts: string[] = [];
  if (entry.action_type === 'account_status_changed') {
    const from = statusLabel((entry.details as { from?: unknown }).from);
    const to = statusLabel((entry.details as { to?: unknown }).to);
    if (from && to) parts.push(`De «${from}» a «${to}»`);
    else if (to) parts.push(`A «${to}»`);
  }
  if (entry.actor) parts.push(`Por ${entry.actor.full_name ?? entry.actor.email}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

const RUN_TONE: Record<string, JourneyEvent['tone']> = {
  completed: 'positive',
  ready_for_review: 'positive',
  failed: 'negative',
  superseded: 'default',
};

function runProviderLabel(run: AccountContactEnrichmentRun): string {
  const used = run.providersUsed[0] ?? run.intendedProvider ?? null;
  if (!used) return 'sin proveedor';
  return used === 'apollo' ? 'Apollo' : used === 'lusha' ? 'Lusha' : used;
}

export function buildHistory(args: {
  audit: readonly AccountAuditEntry[];
  runs: readonly AccountContactEnrichmentRun[];
  origin: OriginCandidate | null;
}): JourneyEvent[] {
  const events: JourneyEvent[] = [];

  for (const entry of args.audit) {
    events.push({
      id: `audit-${entry.id}`,
      kind: 'audit',
      at: entry.created_at,
      title: AUDIT_ACTION_LABELS[entry.action_type] ?? 'Cambio registrado',
      description: auditDescription(entry),
      tone: AUDIT_TONE[entry.action_type] ?? 'default',
    });
  }

  const approvedAt = args.origin?.approvedAt ?? args.origin?.reviewedAt ?? null;
  if (args.origin && approvedAt) {
    events.push({
      id: `approval-${args.origin.id}`,
      kind: 'approval',
      at: approvedAt,
      title: 'Prospecto aprobado',
      description: [
        args.origin.reviewerName ? `Por ${args.origin.reviewerName}` : null,
        args.origin.batchName ? `Lote «${args.origin.batchName}»` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
      tone: 'positive',
    });
  }

  for (const run of args.runs) {
    const isFailed = run.status === 'failed';
    events.push({
      id: `run-${run.id}`,
      kind: 'run',
      at: run.createdAt,
      title: isFailed ? 'Búsqueda de contactos fallida' : 'Búsqueda de contactos (Agente 2A)',
      description: isFailed
        ? `${runProviderLabel(run)}${run.summaryError ? ` · ${run.summaryError}` : ''}`
        : `${runProviderLabel(run)} · ${run.candidateCount} candidatos · ${run.approvedCount} aprobados`,
      tone: RUN_TONE[run.status] ?? 'info',
    });
  }

  return events.sort((a, b) => b.at.localeCompare(a.at));
}

// ── Hitos por etapa ────────────────────────────────────────────

function resolveMilestones(args: {
  origin: OriginCandidate | null;
  createdAt: string;
  runs: readonly AccountContactEnrichmentRun[];
  audit: readonly AccountAuditEntry[];
}): Partial<Record<PipelineStageId, string | null>> {
  const latestRun = [...args.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const researchAt = [...args.audit]
    .filter(
      (entry) =>
        entry.action_type === 'account_status_changed' &&
        ['ready_for_research', 'research_in_progress'].includes(
          String((entry.details as { to?: unknown }).to),
        ),
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const outreachAt = [...args.audit]
    .filter(
      (entry) =>
        entry.action_type === 'account_status_changed' &&
        (entry.details as { to?: unknown }).to === 'ready_for_outreach',
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return {
    prospeccion: args.origin?.approvedAt ?? args.origin?.reviewedAt ?? args.createdAt,
    enriquecimiento: latestRun?.createdAt ?? null,
    inteligencia: researchAt?.created_at ?? null,
    preparacion: outreachAt?.created_at ?? null,
  };
}

// ── Recorrido ──────────────────────────────────────────────────

export interface AccountJourneyInput {
  account: AccountWithOwner;
  origin: OriginCandidate | null;
  contacts: readonly Contact[];
  runs: readonly AccountContactEnrichmentRun[];
  audit: readonly AccountAuditEntry[];
  now: Date;
}

export function buildAccountJourney(input: AccountJourneyInput): AccountJourney {
  const { account } = input;
  const metadata = safeAccountMetadata(account.metadata);
  const status = account.pipeline_status;
  const isArchived = status === 'archived' || Boolean(account.archived_at);
  const effectiveStatus: PipelineStatus = isArchived ? 'archived' : status;
  const { stageId: currentStageId, substatusLabel } = resolveCurrentStage(effectiveStatus);
  const stageStates = resolveStageStates(effectiveStatus);

  const runs = [...input.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const contacts = input.contacts.map(toJourneyContact);
  const decisionMakers = input.contacts.filter(isDecisionMaker);
  const decisionMakerList = contacts.filter((contact) => contact.role === 'decision_maker');

  const lastMovementAt = resolveLastMovementAt(input.audit, account.created_at);
  const daysSinceMovement = daysBetween(lastMovementAt, input.now);
  const hubspotSynced = isAccountHubSpotSynced(account.hubspot_company_id, metadata);
  const hubspotPresentation = resolveHubSpotPresentation(account.hubspot_company_id, metadata);

  const signals = computeSignals({
    pipelineStatus: effectiveStatus,
    currentStageId,
    daysSinceMovement,
    contactsTotal: input.contacts.length,
    decisionMakersTotal: decisionMakers.length,
    decisionMakersWithPhone: decisionMakers.filter((contact) => Boolean(contact.phone_revealed_at)).length,
    hasOwner: Boolean(account.owner_id),
    hubspotSynced,
    lastRunStatus: runs[0]?.status ?? null,
  });

  const milestones = resolveMilestones({
    origin: input.origin,
    createdAt: account.created_at,
    runs,
    audit: input.audit,
  });

  const stages: JourneyStage[] = PIPELINE_STAGES.map((stage) => ({
    stage,
    state: stageStates[stage.id],
    signals: signals.filter((signal) => signal.stageId === stage.id),
    milestoneAt: milestones[stage.id] ?? null,
  }));

  return {
    account: {
      id: account.id,
      name: account.name,
      domain: account.domain,
      website: account.website,
      linkedinUrl: account.linkedin_url ?? null,
      countryCode: account.country_code,
      industry: account.industry,
      companySize: account.company_size,
      taxIdentifier: account.tax_identifier,
      taxIdentifierType: account.tax_identifier_type,
      source: account.source,
      ownerName: account.owner?.full_name ?? account.owner?.email ?? null,
      createdByName: account.created_by_user?.full_name ?? null,
      createdAt: account.created_at,
      pipelineStatus: effectiveStatus,
      hubspotCompanyId: account.hubspot_company_id,
      hubspotLabel: hubspotPresentation.label,
      hubspotSynced,
    },
    currentStageId,
    substatusLabel,
    isArchived,
    daysSinceMovement,
    researchMarkedBy:
      effectiveStatus === 'research_in_progress'
        ? resolveResearchMarkedBy(input.audit) ?? account.owner?.full_name ?? account.owner?.email ?? null
        : null,
    signals,
    stages,
    origin: input.origin,
    contacts: {
      total: input.contacts.length,
      decisionMakers: decisionMakers.length,
      champions: input.contacts.filter((contact) => contact.role_in_account === 'champion').length,
      withPhone: input.contacts.filter((contact) => Boolean(contact.phone_revealed_at)).length,
      inHubSpot: input.contacts.filter((contact) => Boolean(contact.hubspot_contact_id)).length,
      decisionMakerList,
    },
    runs,
    audit: [...input.audit].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    history: buildHistory({ audit: input.audit, runs, origin: input.origin }),
  };
}

// ── Resumen ────────────────────────────────────────────────────

/** Lo que el resumen sabe de cada cuenta, ya leído por lotes. */
export interface OverviewAccountFacts {
  /** Fecha del último `account_status_changed`; `null` si no hay. */
  lastStatusChangeAt: string | null;
  contactsTotal: number;
  decisionMakersTotal: number;
  decisionMakersWithPhone: number;
  hubspotSynced: boolean;
  lastRunStatus: string | null;
}

export const EMPTY_ACCOUNT_FACTS: OverviewAccountFacts = {
  lastStatusChangeAt: null,
  contactsTotal: 0,
  decisionMakersTotal: 0,
  decisionMakersWithPhone: 0,
  hubspotSynced: false,
  lastRunStatus: null,
};

export interface PipelineOverviewInput {
  accounts: readonly AccountListItem[];
  facts: ReadonlyMap<string, OverviewAccountFacts>;
  archivedTotal: number;
  now: Date;
}

/** Señales críticas primero; después, las que llevan más días sin moverse. */
export function sortOverviewAccounts(accounts: readonly PipelineOverviewAccount[]): PipelineOverviewAccount[] {
  return [...accounts].sort((a, b) => {
    const rank = severityRank(highestSeverity(b.signals)) - severityRank(highestSeverity(a.signals));
    if (rank !== 0) return rank;
    if (b.daysSinceMovement !== a.daysSinceMovement) return b.daysSinceMovement - a.daysSinceMovement;
    return a.name.localeCompare(b.name, 'es');
  });
}

export function buildPipelineOverview(input: PipelineOverviewInput): PipelineOverview {
  const countsBySignal = Object.fromEntries(SIGNAL_IDS.map((id) => [id, 0])) as Record<PipelineSignalId, number>;
  const countsByStage = { enriquecimiento: 0, inteligencia: 0, preparacion: 0 };
  let withSignalsTotal = 0;

  const accounts = input.accounts.map((account): PipelineOverviewAccount => {
    const facts = input.facts.get(account.id) ?? EMPTY_ACCOUNT_FACTS;
    const { stageId, substatusLabel } = resolveCurrentStage(account.pipeline_status);
    const daysSinceMovement = daysBetween(facts.lastStatusChangeAt ?? account.created_at, input.now);
    const signals: PipelineSignal[] = computeSignals({
      pipelineStatus: account.pipeline_status,
      currentStageId: stageId,
      daysSinceMovement,
      contactsTotal: facts.contactsTotal,
      decisionMakersTotal: facts.decisionMakersTotal,
      decisionMakersWithPhone: facts.decisionMakersWithPhone,
      hasOwner: Boolean(account.owner_id),
      hubspotSynced: facts.hubspotSynced,
      lastRunStatus: facts.lastRunStatus,
    });

    if (stageId && stageId in countsByStage) countsByStage[stageId as keyof typeof countsByStage] += 1;
    if (signals.length > 0) withSignalsTotal += 1;
    for (const signal of signals) countsBySignal[signal.id] += 1;

    return {
      id: account.id,
      name: account.name,
      domain: account.domain,
      countryCode: account.country_code,
      industry: account.industry,
      ownerName: account.owner_name,
      pipelineStatus: account.pipeline_status,
      currentStageId: stageId,
      substatusLabel,
      daysSinceMovement,
      signals,
    };
  });

  return {
    accounts: sortOverviewAccounts(accounts),
    countsByStage,
    archivedTotal: input.archivedTotal,
    withSignalsTotal,
    countsBySignal,
  };
}
