/**
 * AGENT1-CUT3B23 · CUT-3B3 — registro de identidad con ámbito de UN LOTE.
 *
 * Responde una sola pregunta, y sólo dentro de un lote:
 *
 *   ¿este candidato es la MISMA empresa que otro que este lote ya contiene?
 *
 * ── Ámbito: UN lote. Ni global, ni histórico ───────────────────────────────────
 *
 * Este registro NO es la memoria de novedad global (`novelty-checker`,
 * `tax-id-novelty-checker`, `provider_seen`), que siguen existiendo y siguen
 * siendo de otra capa: aquéllas preguntan «¿ya vimos esta empresa alguna vez?».
 * Aquí se pregunta «¿ya está en ESTE lote?». Mezclarlas convertiría un lote
 * legítimo en un lote vacío.
 *
 * ── El orden de las señales es de FUERZA, y el conflicto fiscal manda ─────────
 *
 *   TIER 0  conflicto fuerte  — dos identidades fiscales autoritativas DISTINTAS
 *                               ⇒ NUNCA se fusionan por una señal más débil.
 *   TIER 1  identidad fiscal  — misma clave fiscal (país + canónico) ⇒ duplicado.
 *   TIER 2  dominio           — mismo dominio normalizado ⇒ duplicado, salvo
 *                               conflicto fiscal o países contradictorios.
 *   TIER 3  id nativo del proveedor, DEL MISMO proveedor ⇒ duplicado salvo
 *                               conflicto fiscal.
 *   TIER 4  LinkedIn de empresa ⇒ duplicado salvo conflicto fiscal o países
 *                               contradictorios.
 *   TIER 5  nombre canónico    ⇒ JAMÁS duplicado duro. Sólo posible duplicado.
 *
 * 🔴 TIER 0 existe para proteger a dos personas jurídicas distintas que comparten
 * marca o dominio. Sin él, «mismo dominio» bastaría para declarar la misma
 * empresa a dos NITs diferentes y descartar en silencio un candidato legítimo.
 *
 * 🔴 TIER 5: «Servicios Integrales S.A.S.» existe decenas de veces en Colombia
 * con NITs y dominios distintos. El nombre NO suprime. Es la misma conclusión a
 * la que ya llegaron el registro de corrida de Lusha
 * (`lusha-run-identity-registry`) y el de Apollo (`apollo-two-round/seen-registry`).
 *
 * ── Sobre TIER 3 y el contrato de identidad de Apollo ─────────────────────────
 *
 * `apollo-organizations-identity-contract` prohíbe usar el id de organización de
 * Apollo COMO IDENTIDAD CANÓNICA y prohíbe deducir de él que dos REGISTROS
 * distintos son la misma empresa — y admite explícitamente lo contrario: que la
 * referencia sirve «para reconocer el mismo registro del proveedor entre
 * ejecuciones». TIER 3 hace exactamente eso y nada más: compara un id contra el
 * MISMO id del MISMO proveedor. No compone ninguna `identity_key`, no cruza
 * proveedores, no infiere alias y cede ante el conflicto fiscal de TIER 0.
 * La deduplicación DEFINITIVA (crear o reutilizar una `account`) sigue viviendo
 * en la aprobación, contra identidad legal, intacta.
 *
 * ── Lo que este corte NO resuelve ─────────────────────────────────────────────
 *
 * CUT3_CONCURRENCY_ATOMICITY_SOLVED = NO. Dos procesos que lean el mismo lote a
 * la vez, no vean duplicado y ambos inserten siguen produciendo dos filas. Eso
 * exige atomicidad en base de datos (CUT-3B4) y NO se resuelve aquí.
 *
 * Puro: sin I/O, sin Supabase, sin env, sin reloj. La siembra la inyecta el
 * llamador (`@/server/prospect-batches/batch-identity-registry-store`).
 */

import type { CompanyIdentityEvidence } from './company-identity-evidence';

// ─── Estados que OCUPAN el lote ───────────────────────────────────────────────

/**
 * Estados de `prospect_candidates.status` cuya fila ocupa el lote como candidato
 * y por tanto puede ser duplicada por uno nuevo.
 *
 * Resueltos contra el CHECK REAL de la migración 040, cuyo vocabulario completo
 * es: `generated`, `normalized`, `needs_review`, `approved`, `discarded`,
 * `duplicate`, `converted_to_account`.
 *
 * 🔴 `discarded` NO bloquea, y `duplicate` tampoco: los dos son RESULTADOS de
 * revisión sobre una fila que ya perdió su sitio. Bloquear por ellos haría que
 * un descarte previo impidiera la llegada del candidato legítimo — el defecto
 * que CUT-3A advirtió explícitamente al reutilizar un conjunto de estados que
 * incluía `discarded`.
 *
 * 🔴 Este conjunto NO es el de `DURABLE_PROSPECT_CANDIDATE_STATUSES` (CUT-1), y
 * la diferencia es deliberada: allí la pregunta es «¿esta fila existe y no está
 * borrada?» —y ninguna lo está, así que son los siete—; aquí es «¿esta fila
 * ocupa el lote como candidato?».
 *
 * Fail-closed: un estado desconocido NO bloquea.
 */
export const BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES = [
  'generated',
  'normalized',
  'needs_review',
  'approved',
  'converted_to_account',
] as const;

export type BatchIdentityBlockingCandidateStatus =
  (typeof BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES)[number];

const BLOCKING_STATUS_SET: ReadonlySet<string> = new Set(
  BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES,
);

/** ¿Una fila con este estado ocupa el lote a efectos del registro? */
export function isBatchIdentityBlockingStatus(
  status: unknown,
): status is BatchIdentityBlockingCandidateStatus {
  return typeof status === 'string' && BLOCKING_STATUS_SET.has(status);
}

// ─── Contrato del registro ────────────────────────────────────────────────────

/** Una identidad ya presente en el lote. */
export type RegisteredBatchIdentity = {
  /** Id de la fila persistida cuando se conoce; `null` para una aceptada en memoria sin id. */
  candidateId: string | null;
  evidence: CompanyIdentityEvidence;
};

export type BatchIdentityRegistry = {
  /** El lote al que pertenece. Un registro NUNCA se comparte entre lotes. */
  batchId: string | null;
  entries: ReadonlyArray<RegisteredBatchIdentity>;
};

/** Señal por la que dos candidatos coincidieron. */
export type BatchIdentityMatchSignal =
  | 'fiscal_identity'
  | 'normalized_domain'
  | 'provider_entity_key'
  | 'linkedin_company'
  | 'canonical_name';

/** Nivel de la señal que decidió. `0` es el conflicto fuerte. */
export type BatchIdentityTier = 0 | 1 | 2 | 3 | 4 | 5;

export type BatchIdentityAction =
  | 'accepted_unique'
  | 'hard_duplicate'
  | 'possible_duplicate'
  | 'distinct_strong_conflict';

/** Por qué una coincidencia NO se convirtió en duplicado duro. */
export type BatchIdentitySoftReason =
  | 'fiscal_identity_conflict'
  | 'country_mismatch'
  | 'name_only';

export type BatchIdentityDecision = {
  action: BatchIdentityAction;
  /** Señal que decidió. `null` en `accepted_unique`. */
  matchedSignal: BatchIdentityMatchSignal | null;
  matchedTier: BatchIdentityTier | null;
  /** Ids de las filas del lote con las que coincidió. Sin PII. */
  matchedCandidateIds: ReadonlyArray<string>;
  /** Presente cuando la coincidencia no bastó para suprimir. */
  softReason: BatchIdentitySoftReason | null;
  /** Resumen booleano de la evidencia evaluada. Nunca valores fiscales ni nombres. */
  evidenceSummary: {
    hasFiscalIdentity: boolean;
    hasDomain: boolean;
    hasProviderEntityKey: boolean;
    hasLinkedInCompany: boolean;
    hasCanonicalName: boolean;
  };
};

// ─── Construcción y siembra ───────────────────────────────────────────────────

export function createBatchIdentityRegistry(batchId: string | null): BatchIdentityRegistry {
  return { batchId, entries: [] };
}

/**
 * Añade identidades ya persistidas al registro y devuelve uno NUEVO.
 *
 * El llamador es quien lee la base de datos: aquí sólo entran filas ya filtradas
 * por `batch_id` y por estado bloqueante.
 */
export function seedBatchIdentityRegistry(
  registry: BatchIdentityRegistry,
  seeds: ReadonlyArray<RegisteredBatchIdentity>,
): BatchIdentityRegistry {
  if (seeds.length === 0) return registry;
  return { batchId: registry.batchId, entries: [...registry.entries, ...seeds] };
}

/**
 * Registra una identidad ACEPTADA y devuelve un registro NUEVO.
 *
 * Se llama DESPUÉS de que la fila exista de verdad: registrar antes de escribir
 * haría que un fallo de inserción bloqueara al siguiente candidato legítimo.
 */
export function acceptIdentity(
  registry: BatchIdentityRegistry,
  evidence: CompanyIdentityEvidence,
  candidateId: string | null = null,
): BatchIdentityRegistry {
  return {
    batchId: registry.batchId,
    entries: [...registry.entries, { candidateId, evidence }],
  };
}

// ─── Comparación ──────────────────────────────────────────────────────────────

/**
 * TIER 0. Dos identidades fiscales autoritativas y DISTINTAS.
 *
 * Cubre los dos casos que importan: distinto identificador en el mismo país, y
 * el mismo identificador desnudo en países distintos (la clave de CUT-3B1 lleva
 * el país dentro, así que `CO:900123456` y `MX:900123456` son claves distintas y
 * por tanto entidades distintas).
 */
function hasFiscalIdentityConflict(
  a: CompanyIdentityEvidence,
  b: CompanyIdentityEvidence,
): boolean {
  return (
    a.fiscalIdentityKey !== null &&
    b.fiscalIdentityKey !== null &&
    a.fiscalIdentityKey !== b.fiscalIdentityKey
  );
}

/** Países presentes en las dos partes y distintos. Ausencia NUNCA es contradicción. */
function hasCountryContradiction(
  a: CompanyIdentityEvidence,
  b: CompanyIdentityEvidence,
): boolean {
  return (
    a.countryNamespace !== null &&
    b.countryNamespace !== null &&
    a.countryNamespace !== b.countryNamespace
  );
}

function summarize(evidence: CompanyIdentityEvidence): BatchIdentityDecision['evidenceSummary'] {
  return {
    hasFiscalIdentity: evidence.fiscalIdentityKey !== null,
    hasDomain: evidence.normalizedDomain !== null,
    hasProviderEntityKey: evidence.providerEntityKey !== null,
    hasLinkedInCompany: evidence.normalizedLinkedInCompany !== null,
    hasCanonicalName: evidence.canonicalName !== null,
  };
}

type SoftFinding = {
  signal: BatchIdentityMatchSignal;
  tier: BatchIdentityTier;
  reason: BatchIdentitySoftReason;
  candidateId: string | null;
};

/**
 * Decide si un candidato es único, duplicado, posible duplicado o distinto por
 * conflicto fuerte, DENTRO del lote del registro.
 *
 * No muta el registro: aceptar es un paso aparte (`acceptIdentity`), para que el
 * llamador pueda decidir entre saber y comprometerse.
 *
 * Un duplicado es un RESULTADO de admisión, no una avería: esta función nunca
 * lanza.
 */
export function evaluateCandidateIdentity(
  registry: BatchIdentityRegistry,
  evidence: CompanyIdentityEvidence,
): BatchIdentityDecision {
  const evidenceSummary = summarize(evidence);
  const soft: SoftFinding[] = [];

  const hardMatches: Array<{
    signal: BatchIdentityMatchSignal;
    tier: BatchIdentityTier;
    candidateId: string | null;
  }> = [];

  for (const entry of registry.entries) {
    const other = entry.evidence;
    const fiscalConflict = hasFiscalIdentityConflict(evidence, other);

    // TIER 1 — identidad fiscal. Si las claves son iguales no puede haber
    // conflicto fiscal con esta misma entrada, así que decide directamente.
    if (
      evidence.fiscalIdentityKey !== null &&
      evidence.fiscalIdentityKey === other.fiscalIdentityKey
    ) {
      hardMatches.push({ signal: 'fiscal_identity', tier: 1, candidateId: entry.candidateId });
      continue;
    }

    // TIER 2 — dominio normalizado.
    if (
      evidence.normalizedDomain !== null &&
      evidence.normalizedDomain === other.normalizedDomain
    ) {
      if (fiscalConflict) {
        soft.push({
          signal: 'normalized_domain',
          tier: 0,
          reason: 'fiscal_identity_conflict',
          candidateId: entry.candidateId,
        });
      } else if (hasCountryContradiction(evidence, other)) {
        soft.push({
          signal: 'normalized_domain',
          tier: 2,
          reason: 'country_mismatch',
          candidateId: entry.candidateId,
        });
      } else {
        hardMatches.push({
          signal: 'normalized_domain',
          tier: 2,
          candidateId: entry.candidateId,
        });
      }
      continue;
    }

    // TIER 3 — id nativo del MISMO proveedor. El namespace va dentro de la
    // clave, así que `apollo:7` y `lusha:7` NO pueden compararse iguales.
    if (
      evidence.providerEntityKey !== null &&
      evidence.providerEntityKey === other.providerEntityKey
    ) {
      if (fiscalConflict) {
        soft.push({
          signal: 'provider_entity_key',
          tier: 0,
          reason: 'fiscal_identity_conflict',
          candidateId: entry.candidateId,
        });
      } else {
        hardMatches.push({
          signal: 'provider_entity_key',
          tier: 3,
          candidateId: entry.candidateId,
        });
      }
      continue;
    }

    // TIER 4 — LinkedIn de EMPRESA.
    if (
      evidence.normalizedLinkedInCompany !== null &&
      evidence.normalizedLinkedInCompany === other.normalizedLinkedInCompany
    ) {
      if (fiscalConflict) {
        soft.push({
          signal: 'linkedin_company',
          tier: 0,
          reason: 'fiscal_identity_conflict',
          candidateId: entry.candidateId,
        });
      } else if (hasCountryContradiction(evidence, other)) {
        soft.push({
          signal: 'linkedin_company',
          tier: 4,
          reason: 'country_mismatch',
          candidateId: entry.candidateId,
        });
      } else {
        hardMatches.push({
          signal: 'linkedin_company',
          tier: 4,
          candidateId: entry.candidateId,
        });
      }
      continue;
    }

    // TIER 5 — nombre canónico. NUNCA duro.
    if (evidence.canonicalName !== null && evidence.canonicalName === other.canonicalName) {
      soft.push({
        signal: 'canonical_name',
        tier: 5,
        reason: fiscalConflict ? 'fiscal_identity_conflict' : 'name_only',
        candidateId: entry.candidateId,
      });
    }
  }

  // ── Precedencia entre ENTRADAS, no dentro de una sola ───────────────────────
  //
  // 🔴 Cada iteración de arriba respeta el conflicto fiscal DE SU PROPIA entrada,
  // pero el registro tiene MUCHAS. Con dos filas del mismo dominio —una sin
  // identificador fiscal y otra con uno CONTRADICTORIO— la primera producía
  // coincidencia dura por dominio y la segunda un conflicto TIER 0, y ganaba la
  // dura: una persona jurídica legítima quedaba suprimida por la fila muda de al
  // lado. La precedencia se decide aquí, sobre el conjunto entero:
  //
  //   · TIER 1 (misma clave fiscal, exacta) manda SIEMPRE. Es identidad legal
  //     afirmativa: ninguna otra entrada puede desmentirla.
  //   · Sin TIER 1, un conflicto fiscal TIER 0 IMPIDE que TIER 2/3/4 supriman.
  //     Dominio, id de proveedor y LinkedIn son señales de infraestructura o de
  //     marca, no de personalidad jurídica: no pueden fusionar dos NITs.
  //   · Sólo entonces deciden las coincidencias duras más débiles.
  //
  // Esto NO desactiva la deduplicación por dominio/proveedor/LinkedIn: sin un
  // conflicto fiscal en el lote, siguen suprimiendo exactamente igual que antes.
  const hasExactFiscalMatch = hardMatches.some((m) => m.tier === 1);
  const strongFiscalConflict = soft.find((s) => s.tier === 0);

  if (!hasExactFiscalMatch && strongFiscalConflict) {
    return {
      action: 'distinct_strong_conflict',
      matchedSignal: strongFiscalConflict.signal,
      matchedTier: 0,
      matchedCandidateIds: soft
        .filter((s) => s.tier === 0)
        .map((s) => s.candidateId)
        .filter((id): id is string => id !== null),
      softReason: 'fiscal_identity_conflict',
      evidenceSummary,
    };
  }

  if (hardMatches.length > 0) {
    // La señal más fuerte que coincidió es la que se reporta, para que la
    // telemetría nombre siempre la razón más defendible.
    const strongest = hardMatches.reduce((best, m) => (m.tier < best.tier ? m : best));
    return {
      action: 'hard_duplicate',
      matchedSignal: strongest.signal,
      matchedTier: strongest.tier,
      matchedCandidateIds: hardMatches
        .map((m) => m.candidateId)
        .filter((id): id is string => id !== null),
      softReason: null,
      evidenceSummary,
    };
  }

  const conflict = soft.find((s) => s.reason === 'fiscal_identity_conflict');
  if (conflict) {
    return {
      action: 'distinct_strong_conflict',
      matchedSignal: conflict.signal,
      matchedTier: 0,
      matchedCandidateIds: soft
        .filter((s) => s.reason === 'fiscal_identity_conflict')
        .map((s) => s.candidateId)
        .filter((id): id is string => id !== null),
      softReason: 'fiscal_identity_conflict',
      evidenceSummary,
    };
  }

  if (soft.length > 0) {
    const first = soft[0];
    return {
      action: 'possible_duplicate',
      matchedSignal: first.signal,
      matchedTier: first.tier,
      matchedCandidateIds: soft
        .map((s) => s.candidateId)
        .filter((id): id is string => id !== null),
      softReason: first.reason,
      evidenceSummary,
    };
  }

  return {
    action: 'accepted_unique',
    matchedSignal: null,
    matchedTier: null,
    matchedCandidateIds: [],
    softReason: null,
    evidenceSummary,
  };
}

/** Sólo `hard_duplicate` impide persistir. Todo lo demás se admite. */
export function isBatchIdentityHardDuplicate(decision: BatchIdentityDecision): boolean {
  return decision.action === 'hard_duplicate';
}

// ─── Conteo (CUT-2: la verdad del lote) ───────────────────────────────────────

/**
 * Contadores del corte. Un duplicado NO es un error y NO consume el objetivo.
 *
 * 🔴 «Admitido» y «persistido» son DOS COSAS DISTINTAS, y colapsarlas es cómo un
 * candidato que pasó la admisión pero cuya inserción falló terminaba contando
 * contra el objetivo del lote como si existiera. Por eso hay dos campos:
 *
 *   · `identityAdmittedUnique` — la admisión de identidad no lo retiró. Es un
 *     permiso para INTENTAR escribir, nunca una fila.
 *   · `persistedUnique`        — la fila EXISTE. Es el ÚNICO conteo que puede
 *     contar contra el objetivo global del lote y el único que puede recortar el
 *     hueco residual.
 *
 * `rawDiscovered` es lo que el descubrimiento entregó. Confundir los tres es cómo
 * un lote de 10 se llena con 10 filas de tres empresas —o con ninguna.
 */
export type BatchIdentityCounters = {
  rawDiscovered: number;
  identityAdmittedUnique: number;
  persistedUnique: number;
  duplicateSkipped: number;
  possibleDuplicateAllowed: number;
  distinctStrongConflict: number;
  errors: number;
};

export function createBatchIdentityCounters(): BatchIdentityCounters {
  return {
    rawDiscovered: 0,
    identityAdmittedUnique: 0,
    persistedUnique: 0,
    duplicateSkipped: 0,
    possibleDuplicateAllowed: 0,
    distinctStrongConflict: 0,
    errors: 0,
  };
}

/**
 * Aplica una decisión de ADMISIÓN a los contadores y devuelve unos NUEVOS.
 *
 * `rawDiscovered` sube SIEMPRE (el candidato llegó). `errors` NO se toca nunca
 * aquí: un duplicado no es un fallo de escritura. `persistedUnique` TAMPOCO se
 * toca: la admisión no escribe nada, y afirmarlo aquí sería exactamente la
 * mentira que este corte tiene que evitar.
 */
export function tallyBatchIdentityDecision(
  counters: BatchIdentityCounters,
  decision: BatchIdentityDecision,
): BatchIdentityCounters {
  return {
    rawDiscovered: counters.rawDiscovered + 1,
    identityAdmittedUnique:
      counters.identityAdmittedUnique + (decision.action === 'hard_duplicate' ? 0 : 1),
    persistedUnique: counters.persistedUnique,
    duplicateSkipped:
      counters.duplicateSkipped + (decision.action === 'hard_duplicate' ? 1 : 0),
    possibleDuplicateAllowed:
      counters.possibleDuplicateAllowed + (decision.action === 'possible_duplicate' ? 1 : 0),
    distinctStrongConflict:
      counters.distinctStrongConflict +
      (decision.action === 'distinct_strong_conflict' ? 1 : 0),
    errors: counters.errors,
  };
}

/**
 * Una fila que EXISTE de verdad. Se llama después de que la escritura funcione,
 * nunca antes.
 *
 * `count` permite reconciliar una inserción en bloque contra el número real de
 * filas que el motor confirmó (`insertedCount`), en vez de suponer que se
 * escribió todo lo admitido.
 */
export function tallyBatchIdentityPersisted(
  counters: BatchIdentityCounters,
  count = 1,
): BatchIdentityCounters {
  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return { ...counters, persistedUnique: counters.persistedUnique + safe };
}

/** Un error de escritura real. Separado del conteo de duplicados a propósito. */
export function tallyBatchIdentityError(
  counters: BatchIdentityCounters,
): BatchIdentityCounters {
  return { ...counters, errors: counters.errors + 1 };
}

/** Vista serializable para metadata. Sólo números: sin PII, sin valores fiscales. */
export function toBatchIdentityCountersMetadata(
  counters: BatchIdentityCounters,
): Record<string, number> {
  return {
    raw_discovered: counters.rawDiscovered,
    identity_admitted_unique: counters.identityAdmittedUnique,
    persisted_unique: counters.persistedUnique,
    duplicate_skipped: counters.duplicateSkipped,
    possible_duplicate_allowed: counters.possibleDuplicateAllowed,
    distinct_strong_conflict: counters.distinctStrongConflict,
    errors: counters.errors,
  };
}

// ─── Admisión de un conjunto en un paso ───────────────────────────────────────

export type BatchIdentityAdmission<T> = {
  admitted: ReadonlyArray<{ item: T; decision: BatchIdentityDecision }>;
  rejected: ReadonlyArray<{ item: T; decision: BatchIdentityDecision }>;
  registry: BatchIdentityRegistry;
  counters: BatchIdentityCounters;
};

/**
 * Filtra un conjunto de candidatos por identidad de lote, encadenando el
 * registro: cada aceptado queda registrado en cuanto se acepta, así que un
 * duplicado DENTRO del propio conjunto se resuelve igual que uno que ya estaba
 * persistido. No hay un segundo mecanismo para el caso intra-conjunto.
 *
 * Para los escritores que intercalan inserciones fila a fila existe la API por
 * pasos (`evaluateCandidateIdentity` + `acceptIdentity`), que registra sólo
 * después de que la escritura haya funcionado de verdad.
 *
 * 🔴 Esta función NO escribe: los contadores que devuelve traen `persistedUnique`
 * en 0 SIEMPRE. Quien inserte en bloque debe reconciliarlos después con el número
 * de filas que el motor confirmó (`tallyBatchIdentityPersisted`).
 */
export function admitByBatchIdentity<T>(
  registry: BatchIdentityRegistry,
  items: readonly T[],
  toEvidence: (item: T) => CompanyIdentityEvidence,
  counters: BatchIdentityCounters = createBatchIdentityCounters(),
): BatchIdentityAdmission<T> {
  const admitted: Array<{ item: T; decision: BatchIdentityDecision }> = [];
  const rejected: Array<{ item: T; decision: BatchIdentityDecision }> = [];
  let current = registry;
  let tally = counters;

  for (const item of items) {
    const evidence = toEvidence(item);
    const decision = evaluateCandidateIdentity(current, evidence);
    tally = tallyBatchIdentityDecision(tally, decision);
    if (isBatchIdentityHardDuplicate(decision)) {
      rejected.push({ item, decision });
      continue;
    }
    current = acceptIdentity(current, evidence, null);
    admitted.push({ item, decision });
  }

  return { admitted, rejected, registry: current, counters: tally };
}
