/**
 * AGENT1-GLOBAL-COMPANY-IDENTITY-CLAIMS-1 — el ÚNICO punto que llama a
 * `claim_company_identities` (migración 140).
 *
 * Puro cableado de I/O: el llamador ya tiene la `CompanyIdentityEvidence` de
 * cada candidato (la misma que usa para el registro de lote), la convierte con
 * `deriveGlobalIdentityClaimEnvelope` y esta función sólo la envía. Ningún módulo
 * reconstruye la evidencia dos veces.
 *
 * Degrada CERRADO: si la migración 140 no está aplicada (`PGRST202`/`42883`) o
 * la llamada falla, NINGÚN candidato se marca duplicado — el mismo principio
 * que `batch-identity-registry-store.ts` ya sigue para la 126. Un fallo de
 * infraestructura nunca se convierte en «esta empresa ya existía».
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deriveGlobalIdentityClaimEnvelope,
  isGlobalIdentityClaimableStatus,
  type GlobalIdentityClaim,
} from '@/server/agents/prospecting-toolkit/global-identity-claims';
import {
  toRegisteredBatchIdentity,
  type BatchIdentitySeedRow,
} from './batch-identity-registry-store';

export const CLAIM_COMPANY_IDENTITIES_RPC = 'claim_company_identities';

export type GlobalIdentityClaimCandidateInput = {
  candidateId: string;
  claims: readonly GlobalIdentityClaim[];
  /**
   * AGENT1-CLAIMS-IDENTITY-DOMAIN-CROSSCHECK-1 — señales de CRUCE de la 152
   * (dominio y LinkedIn de identidad), se reclamen en exclusiva o no. Opcionales:
   * sin la 152 aplicada, la función SQL de la 140 ignora campos que no conoce.
   */
  identityDomain?: string | null;
  identityLinkedIn?: string | null;
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
    ...(c.identityDomain ? { identityDomain: c.identityDomain } : {}),
    ...(c.identityLinkedIn ? { identityLinkedIn: c.identityLinkedIn } : {}),
  }));

  try {
    const { data, error } = await client.rpc(CLAIM_COMPANY_IDENTITIES_RPC, {
      p_candidates: payload,
    });

    if (error) {
      // Ausente o cualquier otro fallo REAL de escritura: degrada cerrado. No se
      // inventa un choque desde una llamada que no se pudo completar.
      // AGENT1-CLAIMS-DEGRADED-OBSERVABLE-1 — pero ya no en silencio: sólo el
      // código (el mensaje puede citar los argumentos).
      console.error('[agent1-global-claims] degraded: rpc error', {
        batchId,
        candidates: candidates.length,
        code: typeof error.code === 'string' ? error.code : null,
      });
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
    console.error('[agent1-global-claims] degraded: rpc threw', {
      batchId,
      candidates: candidates.length,
    });
    return { ...EMPTY_OUTCOME, attempted: false, degraded: true };
  }
}

/** Convierte la evidencia en la entrada del reclamo, con sus señales de cruce. */
export function toGlobalIdentityClaimCandidateInput(
  candidateId: string,
  envelope: ReturnType<typeof deriveGlobalIdentityClaimEnvelope>,
): GlobalIdentityClaimCandidateInput {
  return {
    candidateId,
    claims: envelope.claims,
    identityDomain: envelope.identityDomain,
    identityLinkedIn: envelope.identityLinkedIn,
  };
}

// ─── AGENT1-LUSHA-GLOBAL-IDENTITY-CLAIMS-1 — reclamar lo que YA se guardó ────

/**
 * Las MISMAS columnas que siembra el registro de lote (`SEED_COLUMNS` de
 * `batch-identity-registry-store`), para que la evidencia se reconstruya
 * exactamente igual que allí. `linkedin_url` queda fuera por la misma razón.
 */
const PERSISTED_CLAIM_COLUMNS =
  'id, name, domain, website, country_code, tax_id, tax_identifier, status, metadata, source_trace';

function readProviderCompanyId(row: BatchIdentitySeedRow): string | null {
  const trace = row.source_trace;
  const value = trace && typeof trace === 'object' ? trace['providerCompanyId'] : null;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export type PersistedClaimConflict = {
  candidateId: string;
  /**
   * Id nativo del proveedor TAL COMO se guardó (`source_trace.providerCompanyId`).
   * Crudo a propósito: el llamador lo compara con el suyo por igualdad, sin
   * normalizar identidad por su cuenta (guarda CUT-3B2 § 6).
   */
  providerCompanyId: string | null;
};

export type PersistedGlobalIdentityClaimOutcome = {
  claimedElsewhere: PersistedClaimConflict[];
  /** `true` ⇒ no se pudo completar (lectura, migración ausente o RPC): nadie se marcó. */
  degraded: boolean;
};

/**
 * Reclama las señales globales de filas YA insertadas, leyéndolas de vuelta
 * por su id.
 *
 * Existe para los escritores que insertan un BLOQUE y sólo reciben los ids de
 * vuelta (Lusha). Releer por id evita suponer que el orden de `RETURNING id`
 * coincide con el de entrada: la evidencia sale de lo que la base guardó, con
 * el mismo constructor que usa el registro de lote.
 *
 * Degrada CERRADO igual que `claimGlobalCompanyIdentities`.
 */
export type PersistedGlobalIdentityClaimOptions = {
  /**
   * AGENT1-CLAIMS-OWN-RECLAIM-1 — para los caminos que RE-reclaman una fila que
   * puede tener ya reclamos activos (rescate `idempotent`, NIT agregado después,
   * reintento tras degradar). Se quitan del envío los reclamos que esa MISMA fila
   * ya tiene: sin la 152 aplicada, volver a enviarlos chocaba con ella misma y la
   * fila válida quedaba `duplicate`. Con la 152 es redundante, nunca dañino.
   */
  excludeClaimsAlreadyHeld?: boolean;
};

type HeldClaimRow = { candidate_id: string; claim_type: string; claim_key: string };

/** Reclamos ACTIVOS que ya tienen estas filas, por id. `null` ⇒ no se pudo leer. */
async function readClaimsAlreadyHeld(
  client: SupabaseClient,
  candidateIds: readonly string[],
): Promise<Map<string, Set<string>> | null> {
  try {
    const { data, error } = await client
      .from(GLOBAL_IDENTITY_CLAIMS_TABLE)
      .select('candidate_id, claim_type, claim_key')
      .in('candidate_id', [...candidateIds])
      .is('released_at', null);
    if (error || !Array.isArray(data)) return null;
    const held = new Map<string, Set<string>>();
    for (const row of data as HeldClaimRow[]) {
      const set = held.get(row.candidate_id) ?? new Set<string>();
      set.add(`${row.claim_type}\u0000${row.claim_key}`);
      held.set(row.candidate_id, set);
    }
    return held;
  } catch {
    return null;
  }
}

export const GLOBAL_IDENTITY_CLAIMS_TABLE = 'agent1_company_identity_claims';

export async function claimGlobalIdentitiesForPersistedCandidates(
  client: SupabaseClient,
  batchId: string,
  candidateIds: readonly string[],
  options: PersistedGlobalIdentityClaimOptions = {},
): Promise<PersistedGlobalIdentityClaimOutcome> {
  if (candidateIds.length === 0) return { claimedElsewhere: [], degraded: false };

  let rows: BatchIdentitySeedRow[];
  try {
    const { data, error } = await client
      .from('prospect_candidates')
      .select(PERSISTED_CLAIM_COLUMNS)
      .eq('batch_id', batchId)
      .in('id', [...candidateIds]);
    if (error || !Array.isArray(data)) return { claimedElsewhere: [], degraded: true };
    rows = data as unknown as BatchIdentitySeedRow[];
  } catch {
    return { claimedElsewhere: [], degraded: true };
  }

  // 🔴 AGENT1-CLAIMS-ONLY-LIVE-CANDIDATES-1 — sólo las filas VIVAS reclaman
  // (ver `isGlobalIdentityClaimableStatus`). Una fila ya `duplicate` no puede
  // además «perder» la carrera: no se le reclama nada.
  const claimable = rows.filter((row) =>
    isGlobalIdentityClaimableStatus((row as { status?: unknown }).status),
  );
  if (claimable.length === 0) return { claimedElsewhere: [], degraded: false };

  let inputs = claimable.map((row) =>
    toGlobalIdentityClaimCandidateInput(
      row.id,
      deriveGlobalIdentityClaimEnvelope(toRegisteredBatchIdentity(row).evidence),
    ),
  );
  if (options.excludeClaimsAlreadyHeld) {
    const held = await readClaimsAlreadyHeld(
      client,
      inputs.map((input) => input.candidateId),
    );
    // Sin poder leer lo que ya tienen no se reenvía nada: degradar CERRADO es
    // no marcar a nadie, nunca arriesgar el choque consigo misma.
    if (held === null) return { claimedElsewhere: [], degraded: true };
    inputs = inputs
      .map((input) => {
        const own = held.get(input.candidateId);
        if (!own) return input;
        return {
          ...input,
          claims: input.claims.filter((claim) => !own.has(`${claim.type}\u0000${claim.key}`)),
        };
      })
      .filter((input) => input.claims.length > 0);
    if (inputs.length === 0) return { claimedElsewhere: [], degraded: false };
  }

  const outcome = await claimGlobalCompanyIdentities(client, batchId, inputs);
  if (outcome.degraded) return { claimedElsewhere: [], degraded: true };

  return {
    claimedElsewhere: claimable
      .filter((row) => outcome.claimedElsewhereCandidateIds.has(row.id))
      .map((row) => ({ candidateId: row.id, providerCompanyId: readProviderCompanyId(row) })),
    degraded: false,
  };
}

// ─── AGENT1-CLAIMS-DEGRADED-RECONCILE-1 — reclamar lo que quedó sin reclamar ────

export type UnclaimedReconciliationOutcome = {
  /** Ids que en el segundo intento resultaron ser de OTRO vendedor (ya quedaron `duplicate`). */
  claimedElsewhereCandidateIds: string[];
  /** `true` ⇒ el segundo intento tampoco se pudo completar. */
  degraded: boolean;
};

/**
 * Segundo intento para las filas VIVAS cuyo reclamo degradó al insertarlas (RPC
 * caída, red, plazo). Sin esto la fila quedaba admitida SIN reclamo y otro
 * vendedor podía recibir la misma empresa.
 *
 * Relee las filas y reclama con la misma evidencia que el registro de lote; con
 * la 152 un reclamo propio ya activo cuenta como reclamado, así que repetirlo es
 * inocuo. Nunca lanza.
 */
export async function claimUnclaimedLiveCandidates(
  client: SupabaseClient,
  batchId: string,
  candidateIds: readonly string[],
): Promise<UnclaimedReconciliationOutcome> {
  const unique = [...new Set(candidateIds.filter((id) => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return { claimedElsewhereCandidateIds: [], degraded: false };
  const outcome = await claimGlobalIdentitiesForPersistedCandidates(client, batchId, unique, {
    excludeClaimsAlreadyHeld: true,
  });
  if (outcome.degraded) {
    console.error('[agent1-global-claims] reconcile degraded: rows remain unclaimed', {
      batchId,
      candidateIds: unique,
    });
  }
  return {
    claimedElsewhereCandidateIds: outcome.claimedElsewhere.map((c) => c.candidateId),
    degraded: outcome.degraded,
  };
}
