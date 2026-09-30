/**
 * AGENT1-IMPORT-PARITY-1 — «una empresa, un vendedor» también al IMPORTAR.
 *
 * El defecto que cierra: `create-import-batch` insertaba cada fila tal cual, sin
 * `identity_key`, sin mirar si la MISMA empresa venía dos veces en el archivo,
 * sin mirar si otro vendedor ya la tenía activa y sin reclamarla en la tabla
 * global (migración 140). Un duplicado exacto contra SellUp o HubSpot quedaba
 * `needs_review` con un aviso, cuando Apollo/Lusha lo dejan `duplicate`.
 *
 * Este módulo NO inventa identidad. Compone las MISMAS autoridades que usan los
 * escritores de Apollo y Lusha:
 *   · `buildCompanyIdentityEvidence`       — evidencia fiscal/dominio/nombre
 *   · `evaluateCandidateIdentity`          — la decisión TIER 0-5 del lote
 *   · `checkActiveCandidateDuplicate`      — la guarda contra candidatos activos
 *   · `buildProspectCandidateIdentityKey`  — la columna `identity_key`
 *
 * Diferencia deliberada con el writer: Apollo OMITE el duplicado (no lo
 * escribe). La importación lo ESCRIBE como `duplicate` con su motivo, porque la
 * vendedora subió esa fila y tiene que poder ver por qué no entró.
 *
 * Puro: sin I/O. Quien llama trae los candidatos activos ya leídos.
 */

import {
  buildCompanyIdentityEvidence,
  type CompanyIdentityEvidence,
} from '@/server/agents/prospecting-toolkit/company-identity-evidence';
import {
  acceptIdentity,
  createBatchIdentityRegistry,
  evaluateCandidateIdentity,
  isBatchIdentityHardDuplicate,
  type BatchIdentityMatchSignal,
} from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import {
  checkActiveCandidateDuplicate,
  type ActiveCandidateRecord,
} from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import { isStrongActiveGuardReason } from '@/server/agents/prospecting-toolkit/strong-identity-duplicate-match';
import { buildProspectCandidateIdentityKey } from '@/server/agents/prospecting-toolkit/prospect-candidate-identity-key';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';

/** Clave de metadata donde queda la decisión de admisión de cada fila importada. */
export const IMPORT_ADMISSION_METADATA_KEY = 'import_admission';

export type ImportIdentityRowInput = {
  /** 1-based, igual que el resto del flujo de importación. */
  rowNumber: number;
  name: string;
  website: string | null;
  domain: string | null;
  countryCode: string | null;
  taxIdentifier: string | null;
  linkedinUrl: string | null;
};

export type ImportDuplicateReason =
  | 'intra_file_duplicate'
  | 'active_candidate_domain'
  | 'existing_account'
  | 'existing_in_hubspot';

export type ImportRowAdmission =
  | { rowNumber: number; identityKey: string | null; kind: 'admitted' }
  | {
      rowNumber: number;
      identityKey: string | null;
      kind: 'duplicate';
      reason: 'intra_file_duplicate';
      signal: BatchIdentityMatchSignal | null;
      duplicateOfRowNumber: number;
    }
  | {
      rowNumber: number;
      identityKey: string | null;
      kind: 'duplicate';
      reason: 'active_candidate_domain';
      matchedCandidateId: string;
    };

/** Prefijo de los ids provisionales con que el registro recuerda qué fila ganó. */
const ROW_REF_PREFIX = 'import-row:';

function toEvidence(row: ImportIdentityRowInput): CompanyIdentityEvidence {
  return buildCompanyIdentityEvidence({
    countryCode: row.countryCode,
    taxIdentifier: row.taxIdentifier,
    domain: row.domain,
    website: row.website,
    linkedinUrl: row.linkedinUrl,
    name: row.name,
  });
}

function readRowNumber(ref: string | undefined): number | null {
  if (!ref || !ref.startsWith(ROW_REF_PREFIX)) return null;
  const n = Number(ref.slice(ROW_REF_PREFIX.length));
  return Number.isInteger(n) ? n : null;
}

/**
 * Dominios canónicos del archivo, para leer una sola vez los candidatos activos
 * que los comparten (`fetchActiveCandidatesForGuard`).
 */
export function collectImportDomains(rows: readonly ImportIdentityRowInput[]): string[] {
  const domains = new Set<string>();
  for (const row of rows) {
    const d = normalizeDomain(row.domain ?? '') ?? normalizeDomain(row.website ?? '');
    if (d) domains.add(d);
  }
  return [...domains];
}

/**
 * Decide, fila por fila y en el orden del archivo, qué entra y qué es duplicado.
 *
 * 1. Dominio de un candidato ACTIVO de cualquier lote → duplicado (la misma
 *    regla fuerte del writer; el nombre sólo es evidencia débil y lo sigue
 *    marcando `detectCandidateDuplicates` como posible duplicado).
 * 2. Misma empresa que una fila ANTERIOR del archivo (fiscal, dominio,
 *    LinkedIn…) → duplicado; gana la primera.
 *
 * Una fila duplicada no se registra: no puede «ganarle» a una posterior.
 */
export function planImportIdentityAdmission(
  rows: readonly ImportIdentityRowInput[],
  activeCandidates: readonly ActiveCandidateRecord[],
): ImportRowAdmission[] {
  let registry = createBatchIdentityRegistry(null);
  const plan: ImportRowAdmission[] = [];

  for (const row of rows) {
    const identityKey = buildProspectCandidateIdentityKey({
      name: row.name,
      domain: row.domain,
      website: row.website,
      taxIdentifier: row.taxIdentifier,
      countryCode: row.countryCode,
    });

    const guard = checkActiveCandidateDuplicate(
      { name: row.name, domain: row.domain ?? row.website, website: row.website },
      [...activeCandidates],
    );
    if (guard.matched && isStrongActiveGuardReason(guard.reason) && guard.matchedCandidateId) {
      plan.push({
        rowNumber: row.rowNumber,
        identityKey,
        kind: 'duplicate',
        reason: 'active_candidate_domain',
        matchedCandidateId: guard.matchedCandidateId,
      });
      continue;
    }

    const evidence = toEvidence(row);
    const decision = evaluateCandidateIdentity(registry, evidence);
    if (isBatchIdentityHardDuplicate(decision)) {
      const winner = readRowNumber(decision.matchedCandidateIds[0]);
      if (winner !== null) {
        plan.push({
          rowNumber: row.rowNumber,
          identityKey,
          kind: 'duplicate',
          reason: 'intra_file_duplicate',
          signal: decision.matchedSignal,
          duplicateOfRowNumber: winner,
        });
        continue;
      }
    }

    registry = acceptIdentity(registry, evidence, `${ROW_REF_PREFIX}${row.rowNumber}`);
    plan.push({ rowNumber: row.rowNumber, identityKey, kind: 'admitted' });
  }

  return plan;
}

/** Forma mínima de `detectCandidateDuplicates` que decide el estado. */
export type ImportExistingCompanyCheck = {
  sellup_duplicate_check: { status: string; matched_source?: string | null };
  hubspot_duplicate_check: { status: string };
};

/**
 * Paridad con `candidate-scorer` (Apollo/Tavily): una empresa que YA existe en
 * SellUp como cuenta o en HubSpot como empresa (coincidencia exacta) es
 * `duplicate`, no una fila para revisar.
 *
 * Una coincidencia con OTRO candidato no decide aquí: eso lo resuelven la
 * guarda de activos y los reclamos globales, con el cliente administrativo que
 * sí ve los lotes de todos los vendedores.
 */
export function resolveImportExistingCompanyDuplicate(
  check: ImportExistingCompanyCheck,
): 'existing_account' | 'existing_in_hubspot' | null {
  if (
    check.sellup_duplicate_check.status === 'duplicate' &&
    check.sellup_duplicate_check.matched_source === 'account'
  ) {
    return 'existing_account';
  }
  if (check.hubspot_duplicate_check.status === 'match') return 'existing_in_hubspot';
  return null;
}

/** Metadata que se guarda en la fila bajo `IMPORT_ADMISSION_METADATA_KEY`. */
export function toImportAdmissionMetadata(
  admission: ImportRowAdmission,
): Record<string, unknown> {
  if (admission.kind === 'admitted') return { decision: 'admitted' };
  if (admission.reason === 'intra_file_duplicate') {
    return {
      decision: 'duplicate',
      reason: admission.reason,
      signal: admission.signal,
      duplicate_of_row: admission.duplicateOfRowNumber,
    };
  }
  return {
    decision: 'duplicate',
    reason: admission.reason,
    matched_candidate_id: admission.matchedCandidateId,
  };
}
