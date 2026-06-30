import type { Contact, ContactSource } from './types';

// ── ViewModel ────────────────────────────────────────────────────────────────

export interface ContactTraceabilityViewModel {
  // Origen
  originLabel: string;
  sourceLabel: string;
  hasSourceCandidate: boolean;
  sourceCandidateId: string | null;
  // Relevancia / calidad IA
  hasRelevanceData: boolean;
  relevanceLabel: string;
  relevanceScore: number | null;
  // Completion (campos completados por IA)
  hasCompletionData: boolean;
  completedFields: string[];
  hasActionableChannel: boolean | null;
  // Normalización
  isNormalized: boolean;
  normalizedFields: string[];
  // HubSpot (resumen)
  hubspotSyncLabel: string;
  hubspotContactId: string | null;
  hubspotMode: string | null;
  hubspotAssociationStatus: string | null;
}

// ── Helpers internos ─────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<ContactSource, string> = {
  manual: 'Manual',
  hubspot: 'HubSpot',
  apollo: 'Apollo',
  lusha: 'Lusha',
  agent_1: 'Agente 1',
  imported: 'Importado',
  other: 'Otro',
};

const RELEVANCE_STATUS_LABELS: Record<string, string> = {
  high_relevance: 'Alta',
  medium_relevance: 'Media',
  low_relevance: 'Baja',
  not_relevant: 'No relevante',
  insufficient_data: 'Datos insuficientes',
};

const COMPLETED_FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  linkedin_url: 'LinkedIn',
  phone: 'Teléfono',
  mobile_phone: 'Celular',
  full_name: 'Nombre completo',
  first_name: 'Nombre',
  last_name: 'Apellido',
};

function labelField(field: string): string {
  return COMPLETED_FIELD_LABELS[field] ?? field;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildContactTraceabilityViewModel(
  contact: Pick<Contact, 'source' | 'metadata' | 'hubspot_contact_id'>,
): ContactTraceabilityViewModel {
  const meta = asRecord(contact.metadata) ?? {};

  // ── Origen ──────────────────────────────────────────────────────────────
  const sourceCandidateId =
    typeof meta.source_candidate_id === 'string' ? meta.source_candidate_id : null;
  const hasSourceCandidate = sourceCandidateId !== null;
  const originLabel = hasSourceCandidate ? 'Candidato aprobado por IA' : 'Creado manualmente';

  const candidateSource = typeof meta.candidate_source === 'string'
    ? (meta.candidate_source as ContactSource)
    : null;
  const effectiveSource = candidateSource ?? contact.source;
  const sourceLabel = SOURCE_LABELS[effectiveSource] ?? effectiveSource;

  // ── Relevancia ──────────────────────────────────────────────────────────
  const relevance = asRecord(meta.relevance);
  const hasRelevanceData = relevance !== null;
  const relevanceStatusRaw = typeof relevance?.status === 'string' ? relevance.status : null;
  const relevanceLabel = relevanceStatusRaw
    ? (RELEVANCE_STATUS_LABELS[relevanceStatusRaw] ?? relevanceStatusRaw)
    : 'Sin evaluación de IA registrada';
  const relevanceScore =
    typeof relevance?.score === 'number' ? relevance.score :
    typeof relevance?.quality_score === 'number' ? relevance.quality_score :
    null;

  // ── Completion ──────────────────────────────────────────────────────────
  const completion = asRecord(meta.completion);
  const hasCompletionData = completion !== null;
  const rawFields = asStringArray(completion?.completed_fields);
  const completedFields = rawFields.map(labelField);
  const hasActionableChannel =
    typeof completion?.had_actionable_channel === 'boolean'
      ? completion.had_actionable_channel
      : null;

  // ── Normalización ───────────────────────────────────────────────────────
  const normalization = asRecord(meta.normalization);
  const isNormalized = normalization?.status === 'normalized';
  const normalizedFields = isNormalized
    ? asStringArray(normalization?.fields).map(labelField)
    : [];

  // ── HubSpot (resumen) ────────────────────────────────────────────────────
  const hubspotSync = asRecord(meta.hubspot_sync);
  const hubspotContactId = contact.hubspot_contact_id ?? null;
  const isSynced = hubspotContactId !== null;
  const hubspotSyncLabel = isSynced ? 'Sincronizado con HubSpot' : 'No sincronizado con HubSpot';
  const hubspotMode =
    typeof hubspotSync?.mode === 'string' ? hubspotSync.mode : null;
  const hubspotAssociationStatus =
    typeof hubspotSync?.association_status === 'string' ? hubspotSync.association_status : null;

  return {
    originLabel,
    sourceLabel,
    hasSourceCandidate,
    sourceCandidateId,
    hasRelevanceData,
    relevanceLabel,
    relevanceScore,
    hasCompletionData,
    completedFields,
    hasActionableChannel,
    isNormalized,
    normalizedFields,
    hubspotSyncLabel,
    hubspotContactId,
    hubspotMode,
    hubspotAssociationStatus,
  };
}
