/**
 * fiscal-claim-recanonicalization.ts — poner al día las claves de los reclamos
 * fiscales ACTIVOS que se guardaron con la forma vieja del NIT/RUT/RUC.
 *
 * AUDIT-HARDENING-1 (decisión de la dueña, 16-10): el cambio de
 * `fiscal-identity.ts` hace que un NIT colombiano con el dígito de verificación
 * pegado (`8909039388`), un RUT chileno de persona jurídica sin dígito y un RUC
 * paraguayo `80xxxxxx` sin dígito tengan la MISMA clave canónica que su variante
 * con dígito (`CO:890903938`, `CL:<cuerpo+DV>`, `PY:<cuerpo+DV>`). Los reclamos
 * que ya están en Producción se guardaron con la forma vieja: sin este paso, la
 * misma empresa podría reclamarse dos veces (una con cada forma) y llegarle a dos
 * vendedores.
 *
 * La fuente de verdad NO es la clave vieja sino lo que el candidato dueño tiene
 * guardado (`tax_id` / `tax_identifier` + país), pasado por la MISMA función que
 * usa el escritor (`resolveStoredFiscalIdentity`). Así este módulo no es una
 * segunda autoridad de identidad: sólo vuelve a preguntarle a la primera.
 *
 * Puro: sin red, sin base. Quien aplica inyecta la escritura.
 */

import {
  buildFiscalIdentityKey,
  resolveFiscalCountryScope,
  resolveStoredFiscalIdentity,
} from '@/server/agents/prospecting-toolkit/fiscal-identity';

/** Un reclamo fiscal activo tal como está en `agent1_company_identity_claims`. */
export type ActiveFiscalClaim = {
  id: string;
  candidateId: string;
  claimKey: string;
};

/** Lo que el candidato dueño tiene guardado. */
export type ClaimCandidateFacts = {
  id: string;
  countryCode: string | null;
  taxId: string | null;
  taxIdentifier: string | null;
};

export type RecanonicalizationSkipReason =
  | 'candidate_not_found'
  | 'no_country_scope'
  | 'country_mismatch'
  | 'fiscal_columns_conflict'
  | 'no_fiscal_identity';

export type RecanonicalizationItem =
  /** La clave guardada es la canónica de hoy: nada que hacer. */
  | { action: 'unchanged'; claimId: string; candidateId: string; claimKey: string }
  /** La clave guardada es la forma vieja: se reescribe con la canónica de hoy. */
  | { action: 'update'; claimId: string; candidateId: string; from: string; to: string }
  /**
   * La clave nueva ya la tiene OTRO reclamo activo. Si es de otro candidato, esa
   * empresa ya está reclamada dos veces (dos vendedores): se informa, NO se
   * resuelve sola. Si es del mismo candidato, el reclamo viejo sobra.
   */
  | {
      action: 'collision';
      claimId: string;
      candidateId: string;
      from: string;
      to: string;
      heldByCandidateId: string;
      sameCandidate: boolean;
    }
  | { action: 'skip'; claimId: string; candidateId: string; claimKey: string; reason: RecanonicalizationSkipReason };

export type RecanonicalizationPlan = {
  items: RecanonicalizationItem[];
  summary: {
    total: number;
    unchanged: number;
    update: number;
    collision: number;
    collisionOtherCandidate: number;
    skip: number;
    skipByReason: Partial<Record<RecanonicalizationSkipReason, number>>;
  };
};

/** País de una clave fiscal (`CO:900123456` → `CO`). */
export function fiscalClaimKeyCountry(claimKey: string): string | null {
  const idx = claimKey.indexOf(':');
  return idx > 0 ? claimKey.slice(0, idx).toUpperCase() : null;
}

/**
 * Arma el plan. No toca nada: cada `update` es una propuesta.
 *
 * Una clave nueva que dos reclamos distintos querrían a la vez cuenta como
 * colisión para el SEGUNDO (el primero la toma): el índice único activo no admite
 * dos filas con la misma clave.
 */
export function planFiscalClaimRecanonicalization(
  claims: readonly ActiveFiscalClaim[],
  candidates: ReadonlyMap<string, ClaimCandidateFacts>,
): RecanonicalizationPlan {
  // Quién tiene hoy cada clave activa.
  const holderByKey = new Map<string, { claimId: string; candidateId: string }>();
  for (const claim of claims) holderByKey.set(claim.claimKey, { claimId: claim.id, candidateId: claim.candidateId });

  const items: RecanonicalizationItem[] = [];
  // Claves nuevas ya prometidas por este mismo plan.
  const promisedKeys = new Map<string, { claimId: string; candidateId: string }>();

  for (const claim of claims) {
    const base = { claimId: claim.id, candidateId: claim.candidateId };
    const candidate = candidates.get(claim.candidateId);
    if (!candidate) {
      items.push({ action: 'skip', ...base, claimKey: claim.claimKey, reason: 'candidate_not_found' });
      continue;
    }
    const scope = resolveFiscalCountryScope(candidate.countryCode);
    if (!scope) {
      items.push({ action: 'skip', ...base, claimKey: claim.claimKey, reason: 'no_country_scope' });
      continue;
    }
    if (fiscalClaimKeyCountry(claim.claimKey) !== scope.namespace) {
      // El reclamo y el candidato no coinciden en país: no se adivina cuál manda.
      items.push({ action: 'skip', ...base, claimKey: claim.claimKey, reason: 'country_mismatch' });
      continue;
    }
    const stored = resolveStoredFiscalIdentity(
      { tax_id: candidate.taxId, tax_identifier: candidate.taxIdentifier },
      candidate.countryCode,
    );
    if (stored.kind === 'conflict') {
      items.push({ action: 'skip', ...base, claimKey: claim.claimKey, reason: 'fiscal_columns_conflict' });
      continue;
    }
    if (stored.kind === 'absent') {
      items.push({ action: 'skip', ...base, claimKey: claim.claimKey, reason: 'no_fiscal_identity' });
      continue;
    }
    const target = buildFiscalIdentityKey({ canonical: stored.canonical, countryCode: candidate.countryCode });
    if (!target || target === claim.claimKey) {
      items.push({ action: 'unchanged', ...base, claimKey: claim.claimKey });
      continue;
    }
    const heldNow = holderByKey.get(target);
    const promised = promisedKeys.get(target);
    const holder = heldNow ?? promised;
    if (holder) {
      items.push({
        action: 'collision',
        ...base,
        from: claim.claimKey,
        to: target,
        heldByCandidateId: holder.candidateId,
        sameCandidate: holder.candidateId === claim.candidateId,
      });
      continue;
    }
    promisedKeys.set(target, { claimId: claim.id, candidateId: claim.candidateId });
    items.push({ action: 'update', ...base, from: claim.claimKey, to: target });
  }

  const skipByReason: Partial<Record<RecanonicalizationSkipReason, number>> = {};
  for (const item of items) {
    if (item.action === 'skip') skipByReason[item.reason] = (skipByReason[item.reason] ?? 0) + 1;
  }
  const collisions = items.filter((item) => item.action === 'collision');
  return {
    items,
    summary: {
      total: items.length,
      unchanged: items.filter((item) => item.action === 'unchanged').length,
      update: items.filter((item) => item.action === 'update').length,
      collision: collisions.length,
      collisionOtherCandidate: collisions.filter((item) => item.action === 'collision' && !item.sameCandidate).length,
      skip: items.filter((item) => item.action === 'skip').length,
      skipByReason,
    },
  };
}

export type ClaimKeyUpdateOutcome = 'updated' | 'unique_violation' | 'not_found' | 'error';

export type ApplyRecanonicalizationResult = {
  updated: number;
  uniqueViolation: number;
  notFound: number;
  failed: number;
};

/**
 * Aplica SÓLO los `update` del plan, de uno en uno. La escritura la inyecta quien
 * llama y debe estar vallada por `(id, claim_key = from, released_at IS NULL)`:
 * si entre el plan y la escritura alguien liberó o cambió el reclamo, no se toca.
 * Nunca lanza.
 */
export async function applyFiscalClaimRecanonicalization(
  plan: RecanonicalizationPlan,
  writeClaimKey: (input: { claimId: string; from: string; to: string }) => Promise<ClaimKeyUpdateOutcome>,
): Promise<ApplyRecanonicalizationResult> {
  const result: ApplyRecanonicalizationResult = { updated: 0, uniqueViolation: 0, notFound: 0, failed: 0 };
  for (const item of plan.items) {
    if (item.action !== 'update') continue;
    let outcome: ClaimKeyUpdateOutcome;
    try {
      outcome = await writeClaimKey({ claimId: item.claimId, from: item.from, to: item.to });
    } catch {
      outcome = 'error';
    }
    if (outcome === 'updated') result.updated += 1;
    else if (outcome === 'unique_violation') result.uniqueViolation += 1;
    else if (outcome === 'not_found') result.notFound += 1;
    else result.failed += 1;
  }
  return result;
}
