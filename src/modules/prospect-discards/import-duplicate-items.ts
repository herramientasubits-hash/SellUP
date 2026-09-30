// AGENT1-IMPORT-DUPLICATES-VISIBLE-1 — los importados que quedaron `duplicate`
// se ven en «Descartadas».
//
// El defecto que cierra (primera importación real, 30-09): las 4 empresas del
// CSV ya existían en HubSpot, la importación las dejó `duplicate` —igual que
// Apollo/Lusha— y desaparecieron: «Candidatos por revisar» sólo lista
// `needs_review` y «Descartadas» sólo `discarded` + el ledger de disposiciones
// (que Apollo/Lusha llenan y la importación no, porque la CHECK de
// `prospect_discarded_dispositions.source_primary` no admite `external_import`).
//
// Esta es la tercera fuente de la pestaña, sin migración: la fila del
// candidato, con el motivo que la importación ya guardó en
// `metadata.import_admission` (o el choque de reclamo global de la 140).
//
// 🔴 De SÓLO LECTURA. «Enviar a revisión» queda bloqueado con su motivo: una
// fila puede estar duplicada porque OTRO vendedor ya tiene la empresa, y
// reactivarla rompería «una empresa, un vendedor». El servidor lo rechaza de
// todas formas (`evaluateSendToReviewEligibility` sólo admite `discarded`).
//
// Pura: sin I/O.

import type { DiscardDispositionCode, DiscardedProspectItem } from './types';

export const IMPORT_DUPLICATE_SEND_TO_REVIEW_BLOCKED =
  'Duplicada al importar: no se puede enviar a revisión desde aquí.';

type ImportDuplicateReason = {
  disposition: DiscardDispositionCode;
  reasonCode: string;
  reasonDetail: string;
};

/** Candidato importado que quedó `duplicate`, con lo que la tabla ya guarda. */
export type ImportDuplicateCandidateRow = {
  id: string;
  batch_id: string;
  batch: { name: string; source: string; created_at: string } | null;
  name: string;
  domain: string | null;
  country_code: string | null;
  industry: string | null;
  source_primary: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown> | null;
};

export function isImportDuplicateCandidate(row: {
  status?: string | null;
  source_primary?: string | null;
}): boolean {
  return row.status === 'duplicate' && row.source_primary === 'external_import';
}

/** El motivo, en el vocabulario de la pestaña, desde lo que la importación guardó. */
export function resolveImportDuplicateReason(
  metadata: Record<string, unknown> | null | undefined,
): ImportDuplicateReason {
  if (metadata?.global_identity_claim_conflict) {
    return {
      disposition: 'sellup_duplicate',
      reasonCode: 'import_claimed_by_other_seller',
      reasonDetail: 'Otro vendedor ya tiene esta empresa en SellUp.',
    };
  }
  const admission = (metadata?.import_admission ?? null) as
    | { reason?: unknown; duplicate_of_row?: unknown }
    | null;
  switch (admission?.reason) {
    case 'existing_in_hubspot':
      return {
        disposition: 'hubspot_duplicate',
        reasonCode: 'import_existing_in_hubspot',
        reasonDetail: 'La empresa ya existe en HubSpot.',
      };
    case 'existing_account':
      return {
        disposition: 'sellup_duplicate',
        reasonCode: 'import_existing_account',
        reasonDetail: 'La empresa ya es una cuenta en SellUp.',
      };
    case 'active_candidate_domain':
      return {
        disposition: 'sellup_duplicate',
        reasonCode: 'import_active_candidate',
        reasonDetail: 'Ya está en revisión en otro lote de SellUp (mismo dominio).',
      };
    case 'intra_file_duplicate': {
      const row = typeof admission.duplicate_of_row === 'number' ? admission.duplicate_of_row : null;
      return {
        disposition: 'other',
        reasonCode: 'import_intra_file_duplicate',
        reasonDetail: row
          ? `Repetida en el mismo archivo (igual a la fila ${row}).`
          : 'Repetida en el mismo archivo.',
      };
    }
    default:
      return {
        disposition: 'other',
        reasonCode: 'import_duplicate',
        reasonDetail: 'Duplicada al importar.',
      };
  }
}

export function importDuplicateToItem(candidate: ImportDuplicateCandidateRow): DiscardedProspectItem {
  const reason = resolveImportDuplicateReason(candidate.metadata);
  return {
    itemId: `candidate:${candidate.id}`,
    itemSource: 'candidate',
    sourceId: candidate.id,
    batchId: candidate.batch_id,
    batchName: candidate.batch?.name ?? null,
    candidateId: candidate.id,
    name: candidate.name,
    domain: candidate.domain,
    countryCode: candidate.country_code,
    industry: candidate.industry,
    sourcePrimary: candidate.source_primary,
    roundOrigin: null,
    disposition: reason.disposition,
    reasonCode: reason.reasonCode,
    reasonDetail: reason.reasonDetail,
    evidence: {},
    status: 'discarded',
    resultingCandidateId: null,
    createdAt: candidate.created_at,
    updatedAt: candidate.updated_at,
    sendToReviewBlockedReason: IMPORT_DUPLICATE_SEND_TO_REVIEW_BLOCKED,
  };
}

/** ¿La fila entra con este filtro de motivo? (sin filtro = siempre). */
export function matchesDispositionFilter(
  item: DiscardedProspectItem,
  disposition: DiscardDispositionCode | undefined,
): boolean {
  return !disposition || item.disposition === disposition;
}
