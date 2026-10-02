/**
 * Agente 1 · Rescate con Claude — descartes por sector YA decididos que encajan
 * con UBITS (puro).
 *
 * Decisión de la dueña (01-10): una empresa de OTRA macroindustria del catálogo
 * con tamaño UBITS no se descarta; vuelve a «Candidatos por revisar» del mismo
 * vendedor con la industria corregida (sin contar para la meta). Las que ya se
 * descartaron antes de esta regla se recuperan con la clasificación GUARDADA:
 * no se vuelve a llamar a Claude (costo cero) y se exige lo mismo que en vivo
 * (macro del catálogo, cita que superó el filtro de descarte, tamaño ≥ umbral).
 */

import type { SendToReviewOrigin } from '@/modules/prospect-discards/send-to-review-core';
import type { RescueDecision } from './rescue-decision';
import {
  buildReassignedCompleteness,
  buildReassignReviewNote,
  buildRescueMetadata,
  CLAUDE_EMPLOYEE_COUNT_SOURCE,
  CLAUDE_RESCUE_METADATA_KEY,
  reassignedIndustryColumns,
  type CandidateRescuePatch,
} from './rescue-patch';

type ReassignDecision = Extract<RescueDecision, { kind: 'reassign' }>;

type Metadata = Record<string, unknown>;

export const SECTOR_MISMATCH_DISCARD_REASON = 'claude_sector_mismatch';

function asObject(value: unknown): Metadata | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Metadata) : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export type StoredReassignInput = {
  /** `metadata` del candidato o `evidence` de la fila de Descartadas. */
  stored: Metadata | null;
  requestedIndustryName: string | null;
  icpMinEmployees: number;
  /** El filtro ICP del asistente ya dejó pasar la fila por tamaño. */
  sizePassedIcpGate: boolean;
};

/** ¿Es un descarte de Claude por sector? (lo único que esta regla reabre). */
export function isStoredSectorMismatchDiscard(stored: Metadata | null): boolean {
  const rescue = asObject(stored?.[CLAUDE_RESCUE_METADATA_KEY]);
  return rescue?.decision === 'discard' && rescue.discard_reason === SECTOR_MISMATCH_DISCARD_REASON;
}

/** La reasignación que corresponde, o `null` si la fila debe seguir descartada. */
export function decideStoredReassignment(input: StoredReassignInput): ReassignDecision | null {
  if (!isStoredSectorMismatchDiscard(input.stored)) return null;
  const classification = asObject(input.stored?.claude_classification);
  const sector = asObject(classification?.sector);
  const industryId = str(sector?.industry_id);
  const industryName = str(sector?.industry_name);
  // Sin macro del catálogo (medios) no hay industria a la que pasarla.
  if (!sector || !industryId || !industryName || sector.matches_current_industry !== false) return null;

  const range = asObject(classification?.employee_range);
  const rangeMin = num(range?.min);
  const sizeConfirmed = rangeMin !== null && rangeMin >= input.icpMinEmployees;
  if (!sizeConfirmed && !input.sizePassedIcpGate) return null;

  const quote = str(sector.quote) ?? '';
  const from = input.requestedIndustryName ? `Buscada en ${input.requestedIndustryName}, ` : '';
  return {
    kind: 'reassign',
    industryId,
    industryName,
    detail: `${from}según Claude es ${industryName}: «${quote.slice(0, 160)}»`,
    sourceUrl: str(sector.source_url) ?? '',
    sizeConfirmed,
    linkedinConfirmed: false,
  };
}

/** `icp_size_gate.decision === 'pass'` en la metadata del candidato. */
export function icpGatePassed(metadata: Metadata | null): boolean {
  return asObject(metadata?.icp_size_gate)?.decision === 'pass';
}

/** Columnas de tamaño desde la clasificación guardada (sólo si superó el umbral). */
function storedSizeColumns(stored: Metadata | null, decision: ReassignDecision): Metadata {
  if (!decision.sizeConfirmed) return {};
  const range = asObject(asObject(stored?.claude_classification)?.employee_range);
  const min = num(range?.min);
  const confidence = num(range?.confidence);
  if (min === null) return {};
  return {
    employee_count: min,
    employee_count_status: 'estimated_100_plus',
    employee_count_source: CLAUDE_EMPLOYEE_COUNT_SOURCE,
    ...(confidence !== null ? { employee_count_confidence: Math.round(confidence * 100) } : {}),
  };
}

function storedRescueMetadata(decision: ReassignDecision, decidedAt: string): Metadata {
  return { ...buildRescueMetadata(decision, [], decidedAt), reopened_from_discard: true };
}

/** Candidato descartado por sector → vuelve a revisión con la industria corregida. */
export function buildStoredReassignCandidatePatch(
  metadata: Metadata | null,
  decision: ReassignDecision,
  decidedAt: string,
): CandidateRescuePatch {
  return {
    status: 'needs_review',
    review_notes: buildReassignReviewNote(decision),
    ...reassignedIndustryColumns(decision),
    ...(storedSizeColumns(metadata, decision) as Partial<CandidateRescuePatch>),
    metadata: {
      ...(metadata ?? {}),
      target_completeness: buildReassignedCompleteness(asObject(metadata?.target_completeness)),
      [CLAUDE_RESCUE_METADATA_KEY]: storedRescueMetadata(decision, decidedAt),
    },
  };
}

/** Fila de Descartadas descartada por sector → origen para `sendDispositionToReviewCore`. */
export function buildStoredReassignDispositionOrigin(
  evidence: Metadata | null,
  decision: ReassignDecision,
  decidedAt: string,
): SendToReviewOrigin {
  return {
    kind: 'claude_rescue',
    reviewNote: buildReassignReviewNote(decision),
    metadata: {
      ...(evidence?.claude_classification ? { claude_classification: evidence.claude_classification } : {}),
      [CLAUDE_RESCUE_METADATA_KEY]: storedRescueMetadata(decision, decidedAt),
      target_completeness: buildReassignedCompleteness(null),
    },
    columns: { ...reassignedIndustryColumns(decision), ...storedSizeColumns(evidence, decision) },
  };
}
