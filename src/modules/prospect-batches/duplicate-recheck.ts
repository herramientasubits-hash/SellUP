// «Marcar duplicidad revisada» ya no cambia el estado a ciegas: vuelve a correr la
// revisión de duplicados (SellUp + HubSpot, la misma de la importación) y guarda lo
// que encuentre. Aquí está la decisión, sin base de datos, para poder probarla.

import type { CandidateDuplicateResult } from '@/server/prospect-batches/duplicate-detection';

export type DuplicateRecheckOutcome =
  /** Una fuente no se pudo leer y nada coincidió: no se sabe, no se escribe. */
  | { kind: 'unknown' }
  | {
      kind: 'write';
      duplicateStatus: 'no_match' | 'possible_duplicate' | 'exact_duplicate' | 'insufficient_data';
      matchedAccountId: string | null;
      matchedHubSpotCompanyId: string | null;
      confidenceScore: number;
    };

type RecheckInput = Pick<
  CandidateDuplicateResult,
  'db_duplicate_status' | 'db_matched_account_id' | 'db_matched_hubspot_company_id' | 'db_confidence_score'
>;

export function decideDuplicateRecheck(result: RecheckInput): DuplicateRecheckOutcome {
  if (result.db_duplicate_status === 'unchecked') return { kind: 'unknown' };
  return {
    kind: 'write',
    duplicateStatus: result.db_duplicate_status,
    matchedAccountId: result.db_matched_account_id ?? null,
    matchedHubSpotCompanyId: result.db_matched_hubspot_company_id ?? null,
    confidenceScore: result.db_confidence_score ?? 0,
  };
}

/** Lo que se le dice a quien revisó, según lo que encontró la revisión. */
export const DUPLICATE_RECHECK_MESSAGES = {
  unknown: 'No se pudo consultar SellUp o HubSpot. Intenta de nuevo en unos minutos.',
  no_match: 'Revisado: no hay otra empresa igual en SellUp ni en HubSpot.',
  possible_duplicate: 'La revisión encontró una empresa parecida en SellUp o HubSpot. Revísala antes de aprobar.',
  exact_duplicate: 'La revisión encontró la misma empresa en SellUp o HubSpot: no se puede aprobar.',
  insufficient_data: 'Faltan nombre, dominio o NIT para comprobar si está duplicada.',
} as const;
