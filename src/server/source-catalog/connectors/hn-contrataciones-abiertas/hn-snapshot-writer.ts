/**
 * Honduras Contrataciones Abiertas — Snapshot Writer
 *
 * Prepara y (en hitos futuros) escribe filas en source_company_snapshots.
 *
 * En 8C.4A: dryRun=true por defecto. rowsWritten=0 siempre.
 * El branch de apply existe en código pero no se activa en este hito.
 *
 * Conflict key: (source_key, country_code, source_year, normalized_tax_id)
 *
 * Hito Centroamérica.8C.4A
 */

import type { HnOcdsCandidate } from './hn-ocds-types';
import { mapCandidatesToSnapshot } from './hn-snapshot-mapper';
import type { HnSnapshotRow } from './hn-snapshot-mapper';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type HnSnapshotWriterOptions = {
  sourceYear: number;
  dryRun?: boolean;
};

export type HnSnapshotWriterResult = {
  sourceKey: 'hn_contrataciones_abiertas';
  countryCode: 'HN';
  sourceYear: number;
  dryRun: boolean;
  candidatesInput: number;
  eligibleLegalEntities: number;
  excludedNaturalPersonRisk: number;
  invalidRtn: number;
  rowsPrepared: number;
  rowsWritten: number;
  conflictsTarget: string;
  coverageSummaryWritten: boolean;
};

// ─── Writer ───────────────────────────────────────────────────────────────────

/**
 * Prepara snapshots a partir de candidatos OCDS Honduras.
 *
 * En dry-run (default):
 *   - Valida filas y calcula conflict key
 *   - NO crea cliente Supabase
 *   - NO llama .upsert()
 *   - NO escribe coverage summary
 *   - rowsWritten = 0
 *
 * Apply (8C.4B+):
 *   - No implementado en este hito
 *   - Retorna error guard si se intenta activar
 */
export async function runHnSnapshotWriter(
  candidates: HnOcdsCandidate[],
  options: HnSnapshotWriterOptions,
): Promise<HnSnapshotWriterResult> {
  const { sourceYear, dryRun = true } = options;

  const mapped = mapCandidatesToSnapshot(candidates, sourceYear);

  const result: HnSnapshotWriterResult = {
    sourceKey: 'hn_contrataciones_abiertas',
    countryCode: 'HN',
    sourceYear,
    dryRun,
    candidatesInput: candidates.length,
    eligibleLegalEntities: mapped.eligibleLegalEntities,
    excludedNaturalPersonRisk: mapped.excludedNaturalPersonRisk,
    invalidRtn: mapped.invalidRtn,
    rowsPrepared: mapped.rows.length,
    rowsWritten: 0,
    conflictsTarget: 'source_key,country_code,source_year,normalized_tax_id',
    coverageSummaryWritten: false,
  };

  if (!dryRun) {
    // Apply branch — gated at script level in 8C.4A (never reaches here in this milestone)
    throw new Error(
      'apply_not_enabled_in_8c4a: el apply de snapshots Honduras se habilitará en 8C.4B. ' +
        'No se escribieron filas en Supabase.',
    );
  }

  return result;
}

// ─── Helpers de validación (para dry-run reporting) ───────────────────────────

/** Verifica invariantes sobre filas preparadas. No lanza excepciones. */
export function validateSnapshotRows(rows: HnSnapshotRow[]): {
  allSourceKeyCorrect: boolean;
  allCountryCodeCorrect: boolean;
  allNormalizedTaxId14Digits: boolean;
  allHumanReviewRequired: boolean;
  allPostApprovalDisabled: boolean;
  allMatchingDisabled: boolean;
} {
  return {
    allSourceKeyCorrect: rows.every((r) => r.source_key === 'hn_contrataciones_abiertas'),
    allCountryCodeCorrect: rows.every((r) => r.country_code === 'HN'),
    allNormalizedTaxId14Digits: rows.every((r) => /^\d{14}$/.test(r.normalized_tax_id)),
    allHumanReviewRequired: rows.every((r) => r.raw_data.human_review_required === true),
    allPostApprovalDisabled: rows.every((r) => r.raw_data.post_approval_enabled === false),
    allMatchingDisabled: rows.every((r) => r.raw_data.matching_automatic_enabled === false),
  };
}
