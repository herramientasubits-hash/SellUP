/**
 * Honduras Contrataciones Abiertas — Snapshot Mapper
 *
 * Convierte HnOcdsCandidate → fila de source_company_snapshots.
 *
 * Filtro estricto: solo candidatos con
 *   rtnValid === true
 *   normalizedRtn !== null
 *   legalEntityHint === 'likely_legal_entity'
 *
 * Candidatos unknown_or_person_natural_risk se excluyen completamente.
 * No se envían a source_company_signals ni a ninguna tabla.
 *
 * Guardrails semánticos obligatorios en raw_data:
 *   source_type: 'procurement_signal'
 *   tax_identifier_type: 'RTN'
 *   legal_validation_status: 'not_applicable'
 *   human_review_required: true
 *   post_approval_enabled: false
 *   matching_automatic_enabled: false
 *   legal_entity_hint: 'likely_legal_entity'
 *
 * Hito Centroamérica.8C.4A
 */

import type { HnOcdsCandidate } from './hn-ocds-types';

// ─── Constantes ────────────────────────────────────────────────────────────────

export const HN_SNAPSHOT_SOURCE_KEY = 'hn_contrataciones_abiertas' as const;
export const HN_SNAPSHOT_COUNTRY_CODE = 'HN' as const;

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type HnSnapshotRawData = {
  source_type: 'procurement_signal';
  tax_identifier_type: 'RTN';
  legal_validation_status: 'not_applicable';
  human_review_required: true;
  post_approval_enabled: false;
  matching_automatic_enabled: false;
  legal_entity_hint: 'likely_legal_entity';
  source: 'ocp_registry_jsonl';
};

export type HnSnapshotSignals = {
  awards_count: number;
  tenders_count: number;
  contracts_count: number;
  total_award_amount: number | null;
  latest_date: string | null;
};

export type HnSnapshotRow = {
  source_key: typeof HN_SNAPSHOT_SOURCE_KEY;
  country_code: typeof HN_SNAPSHOT_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string | null;
  normalized_legal_name: string | null;
  sector: null;
  city: null;
  department: null;
  region: null;
  priority_score: number;
  signals: HnSnapshotSignals;
  financials: Record<string, never>;
  raw_data: HnSnapshotRawData;
};

export type HnSnapshotMapResult =
  | { ok: true; row: HnSnapshotRow }
  | { ok: false; reason: 'invalid_rtn' | 'unknown_or_person_natural_risk' | 'null_rtn' };

// ─── Helpers ───────────────────────────────────────────────────────────────────

function normalizeLegalName(name: string): string {
  return name
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/**
 * Calcula un priority_score básico para Honduras.
 * Señal procurement: base 30 + boost por actividad.
 */
function calcPriorityScore(candidate: HnOcdsCandidate): number {
  let score = 30;
  if (candidate.awardsCount > 0) score += 10;
  if (candidate.awardsCount > 5) score += 5;
  if (candidate.totalAwardAmount !== null && candidate.totalAwardAmount > 0) score += 5;
  if (candidate.tendersCount > 0) score += 5;
  return Math.min(score, 80);
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

/**
 * Mapea un candidato OCDS a una fila de source_company_snapshots.
 *
 * Rechaza si:
 *   - rtnValid !== true
 *   - normalizedRtn es null
 *   - legalEntityHint !== 'likely_legal_entity'
 */
export function mapCandidateToSnapshot(
  candidate: HnOcdsCandidate,
  sourceYear: number,
): HnSnapshotMapResult {
  if (!candidate.rtnValid || !candidate.normalizedRtn) {
    return { ok: false, reason: 'invalid_rtn' };
  }

  if (candidate.legalEntityHint !== 'likely_legal_entity') {
    return { ok: false, reason: 'unknown_or_person_natural_risk' };
  }

  const rawData: HnSnapshotRawData = {
    source_type: 'procurement_signal',
    tax_identifier_type: 'RTN',
    legal_validation_status: 'not_applicable',
    human_review_required: true,
    post_approval_enabled: false,
    matching_automatic_enabled: false,
    legal_entity_hint: 'likely_legal_entity',
    source: 'ocp_registry_jsonl',
  };

  const row: HnSnapshotRow = {
    source_key: HN_SNAPSHOT_SOURCE_KEY,
    country_code: HN_SNAPSHOT_COUNTRY_CODE,
    source_year: sourceYear,
    tax_id: candidate.rawRtn,
    normalized_tax_id: candidate.normalizedRtn,
    legal_name: candidate.supplierName || null,
    normalized_legal_name: candidate.supplierName
      ? normalizeLegalName(candidate.supplierName)
      : null,
    sector: null,
    city: null,
    department: null,
    region: null,
    priority_score: calcPriorityScore(candidate),
    signals: {
      awards_count: candidate.awardsCount,
      tenders_count: candidate.tendersCount,
      contracts_count: candidate.contractsCount,
      total_award_amount: candidate.totalAwardAmount,
      latest_date: candidate.latestDate,
    },
    financials: {},
    raw_data: rawData,
  };

  return { ok: true, row };
}

// ─── Batch mapper ──────────────────────────────────────────────────────────────

export type HnSnapshotMapBatchResult = {
  rows: HnSnapshotRow[];
  eligibleLegalEntities: number;
  excludedNaturalPersonRisk: number;
  invalidRtn: number;
};

/**
 * Mapea un batch de candidatos y deduplica por normalized_tax_id.
 * En caso de duplicado, conserva la primera aparición.
 */
export function mapCandidatesToSnapshot(
  candidates: HnOcdsCandidate[],
  sourceYear: number,
): HnSnapshotMapBatchResult {
  let eligibleLegalEntities = 0;
  let excludedNaturalPersonRisk = 0;
  let invalidRtn = 0;

  const seen = new Set<string>();
  const rows: HnSnapshotRow[] = [];

  for (const candidate of candidates) {
    const result = mapCandidateToSnapshot(candidate, sourceYear);
    if (!result.ok) {
      if (result.reason === 'unknown_or_person_natural_risk') {
        excludedNaturalPersonRisk++;
      } else {
        invalidRtn++;
      }
      continue;
    }

    eligibleLegalEntities++;

    // Deduplicate by normalized_tax_id within this batch
    if (seen.has(result.row.normalized_tax_id)) continue;
    seen.add(result.row.normalized_tax_id);
    rows.push(result.row);
  }

  return { rows, eligibleLegalEntities, excludedNaturalPersonRisk, invalidRtn };
}
