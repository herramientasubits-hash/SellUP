/**
 * AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 — el ÚNICO punto que llama a
 * `claim_company_identities` (migración 140).
 *
 * Puro cableado de I/O: el llamador ya tiene la `CompanyIdentityEvidence` de
 * cada candidato (la misma que usa para el registro de lote), la convierte con
 * `deriveGlobalIdentityClaims` y esta función sólo la envía. Ningún módulo
 * reconstruye la evidencia dos veces.
 *
 * Degrada CERRADO: si la migración 140 no está aplicada (`PGRST202`/`42883`) o
 * la llamada falla, NINGÚN candidato se marca duplicado — el mismo principio
 * que `batch-identity-registry-store.ts` ya sigue para la 126. Un fallo de
 * infraestructura nunca se convierte en «esta empresa ya existía».
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GlobalIdentityClaim } from '@/server/agents/prospecting-toolkit/global-identity-claims';

export const CLAIM_COMPANY_IDENTITIES_RPC = 'claim_company_identities';

export type GlobalIdentityClaimCandidateInput = {
  candidateId: string;
  claims: readonly GlobalIdentityClaim[];
};

export type GlobalIdentityClaimOutcome = {
  /** `true` sólo cuando la llamada se completó (con o sin choques). */
  attempted: boolean;
  /** Ids que reclamaron sus señales sin choque, o que no tenían nada que reclamar. */
  claimedCandidateIds: ReadonlySet<string>;
  /** Ids que chocaron con un reclamo activo de OTRO candidato: ya quedaron `duplicate` en la base. */
  claimedElsewhereCandidateIds: ReadonlySet<string>;
  /**
   * `true` cuando la 140 no está aplicada o la llamada falló: degradación
   * CERRADA, ningún candidato se trata como duplicado por esto.
   */
  degraded: boolean;
};

function asSet(value: unknown): ReadonlySet<string> {
  return new Set(
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [],
  );
}

const EMPTY_OUTCOME: GlobalIdentityClaimOutcome = {
  attempted: true,
  claimedCandidateIds: new Set(),
  claimedElsewhereCandidateIds: new Set(),
  degraded: false,
};

/**
 * Reclama las señales globales de un bloque de candidatos YA insertados en
 * `prospect_candidates`. `batchId` es el mismo para todo el bloque.
 *
 * Un candidato sin reclamos (`claims: []`, sin ninguna señal fuerte) viaja
 * igual — la función SQL lo ignora sin intentar nada— y siempre queda
 * "reclamado" (nada que chocar).
 */
export async function claimGlobalCompanyIdentities(
  client: SupabaseClient,
  batchId: string,
  candidates: readonly GlobalIdentityClaimCandidateInput[],
): Promise<GlobalIdentityClaimOutcome> {
  if (candidates.length === 0) return EMPTY_OUTCOME;

  const canCallRpc = typeof (client as { rpc?: unknown }).rpc === 'function';
  if (!canCallRpc) {
    return { ...EMPTY_OUTCOME, attempted: false, degraded: true };
  }

  const payload = candidates.map((c) => ({
    candidateId: c.candidateId,
    batchId,
    claims: c.claims,
  }));

  try {
    const { data, error } = await client.rpc(CLAIM_COMPANY_IDENTITIES_RPC, {
      p_candidates: payload,
    });

    if (error) {
      // Ausente o cualquier otro fallo REAL de escritura: degrada cerrado. No se
      // inventa un choque desde una llamada que no se pudo completar.
      return { ...EMPTY_OUTCOME, attempted: false, degraded: true };
    }

    const record = data as
      | { claimed_candidate_ids?: unknown; claimed_elsewhere_candidate_ids?: unknown }
      | null;
    return {
      attempted: true,
      claimedCandidateIds: asSet(record?.claimed_candidate_ids),
      claimedElsewhereCandidateIds: asSet(record?.claimed_elsewhere_candidate_ids),
      degraded: false,
    };
  } catch {
    return { ...EMPTY_OUTCOME, attempted: false, degraded: true };
  }
}
