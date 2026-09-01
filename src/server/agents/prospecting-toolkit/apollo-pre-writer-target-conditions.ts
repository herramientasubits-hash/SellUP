/**
 * apollo-pre-writer-target-conditions.ts
 *
 * AGENT1-APOLLO-FINALIZATION-HARDENING-1 · STABLE-TARGET-WRITER-PARITY §§ 1, 2,
 * 7, 8 y 9.
 *
 * Traduce UN candidato ya construido a las condiciones del contrato canónico
 * (`candidate-completeness-contract.ts`) ANTES de que el writer corra, para que
 * la parada por objetivo del orquestador use la misma semántica que decidirá
 * `complete_valid` y `counts_toward_target`.
 *
 * Lo que este módulo NO es: una segunda implementación de nada. No reimplementa
 * el contrato —lo rellena— ni reimplementa los gates del writer: invoca las
 * MISMAS funciones puras que el writer invoca (`evaluateBusinessFit`,
 * `evaluateCountryEvidence`, `computeEvidencePersistencePolicy`,
 * `evaluateIcpSizeGate`), exactamente como `applyFinalGates` ya hacía con
 * `evaluateCompanyOwnership` desde HARDENING-1 § 5.
 *
 * Puro: sin I/O, sin reloj, sin proveedor, sin Supabase.
 *
 * ── Límite declarado (§ 9 y § 10) ────────────────────────────────────────────
 *
 * Varias comprobaciones del writer no se resuelven aquí: cinco porque dependen
 * de estado que sólo el writer tiene al escribir (tres prefetches de base y dos
 * que exigen el lote entero ya rankeado) y ocho porque, siendo puras, todavía no
 * están cableadas antes del writer. El registro de abajo las enumera una por una
 * con su causa.
 *
 * Ninguna puede volver finalizable a un candidato que este módulo descarta: sólo
 * pueden descartar a uno que aquí pasa. Esa asimetría es la razón de que la
 * métrica PRE-writer sea una proyección y la reconciliación POSTERIOR al writer
 * sea la autoritativa (§ 10/§ 11), y de que las dos NO compartan nombre. Lo que
 * el addendum WRITER-ONLY-ADMISSION-PENDING añade es la otra mitad de esa
 * asimetría: la ausencia de un veredicto deja de contarse como un veredicto
 * favorable.
 */

import {
  evaluateBusinessFit,
  isBlockedByBusinessFit,
} from './business-fit-gate';
import { evaluateCountryEvidence } from './country-evidence-gate';
import { computeEvidencePersistencePolicy } from './evidence-persistence-policy';
import { evaluateIcpSizeGate, resolveIcpSizeGateWriterAction } from './icp-size-gate';
import {
  extractCandidateCompanySize,
  extractHubSpotMatchedEmployees,
  resolveEmployeeSizeForIcpGate,
} from './employee-size-resolver';
// ── ADAPTIVE-EARLY-STOP § 3 — los gates DETERMINISTAS del writer, los mismos ──
import {
  isContentPageName,
  isContentPageUrl,
  isDirectorySourceDomain,
  mapQualityLabelToStatus,
  extractDomain,
  normalizeName,
  compareWriterEligibleRank,
  selectIntraBatchIdentityWinnerIndexes,
  orderByCompleteFirst,
} from './candidate-writer-pure-gates';
import { buildCanonicalCompanyIdentity } from './canonical-company-identity';
import {
  evaluateCountryCompatibility,
  countryCompatibilityRankWeight,
} from './country-compatibility';
import { evaluateContentIntermediaryGate } from './content-intermediary-gate';
import { evaluateExternalPlatformGate } from './external-platform-blocklist';
import {
  classifySourceUrlQuality,
  isBlockedBySourceUrlQuality,
} from './source-url-quality-gate';
import { evaluateCandidateNovelty, type NoveltyIndex } from './novelty-checker';
import {
  checkActiveCandidateDuplicate,
  type ActiveCandidateRecord,
} from './active-candidate-identity-guard';
import { isStrongActiveGuardReason } from './strong-identity-duplicate-match';
import { normalizeDomain } from './normalization';
import type { GateVerdict } from './candidate-completeness-contract';
import type { ProspectingPipelineCandidate } from './types';

/**
 * Umbral de empleados del ICP. Es el mismo literal que el writer pasa a
 * `resolveEmployeeSizeForIcpGate`; vive aquí como constante nombrada para que un
 * cambio no pueda quedarse a medias entre los dos llamadores.
 */
export const APOLLO_PRE_WRITER_ICP_EMPLOYEE_THRESHOLD = 200;

// ─── WRITER-ONLY-ADMISSION-PENDING § 1 — la auditoría, como DATO ──────────────
//
// El addendum pedía no dar por supuesto que las comprobaciones que sólo el
// writer resuelve fueran `active_duplicate_guard` y `novelty_index`. No lo son:
// el barrido de los DIECIOCHO puntos de descarte de `candidate-writer.ts`
// —Pass 1 (bucle de gates), Pass 2.5 (dedupe intra-lote), Pass 3 (cupo) y
// Pass 4 (bucle de escritura)— deja tres familias, y sólo la primera estaba
// declarada.
//
// La pregunta de la auditoría es siempre la misma: ¿puede este punto convertir
// un candidato que el evaluador PRE-writer considera finalizable en uno que NO
// cuenta, por algo que no sea un fallo de escritura? Si la respuesta es sí y
// aquí no se resuelve, su ausencia NO puede leerse como un pase.

/** Por qué una comprobación no se puede resolver antes del writer. */
export type ApolloPreWriterUnresolvableCause =
  /** Exige una lectura de base que el orquestador no hace (y § 9 prohíbe añadir). */
  | 'requires_db_prefetch'
  /** Exige el lote completo ya rankeado: no es una propiedad del candidato. */
  | 'requires_full_batch_context'
  /** Es puro y sería resoluble sin I/O, pero HOY nadie lo invoca antes del writer. */
  | 'pure_but_not_wired_pre_writer';

export type ApolloPreWriterAdmissionCheck = {
  /** Nombre estático. Viaja a `writer_only_pending_reasons`. */
  check: string;
  cause: ApolloPreWriterUnresolvableCause;
  /** Función del writer que lo decide, para que la auditoría sea rastreable. */
  writerDecidedBy: string;
};

/**
 * Familia 1 — comprobaciones que SÓLO el writer puede resolver.
 *
 * Tres necesitan una lectura de base (`buildNoveltyIndex`,
 * `buildRecentIdentityKeySet`, `fetchActiveCandidatesForGuard`) y dos necesitan
 * el lote entero ya rankeado. Ninguna es una propiedad del candidato, y ninguna
 * puede resolverse sin violar el § 9 (cero I/O nueva en el orquestador).
 *
 * `target_cap` está aquí y no fuera por una razón que no es obvia: el cupo se
 * aplica sobre el lote ordenado por ENCAJE (`businessFit + sourceUrl +
 * countryCompat`), no por completitud del contrato, así que con el cupo igual al
 * objetivo un candidato completo puede quedar desplazado por uno incompleto
 * mejor rankeado. Es decir: sí puede tumbar a un finalizable.
 */
export const APOLLO_WRITER_ONLY_ADMISSION_CHECK_REGISTRY: readonly ApolloPreWriterAdmissionCheck[] =
  [
    {
      check: 'active_duplicate_guard',
      cause: 'requires_db_prefetch',
      writerDecidedBy: 'checkActiveCandidateDuplicate/fetchActiveCandidatesForGuard',
    },
    {
      check: 'novelty_index',
      cause: 'requires_db_prefetch',
      writerDecidedBy: 'evaluateCandidateNovelty/buildNoveltyIndex',
    },
    {
      check: 'recent_identity_cooldown',
      cause: 'requires_db_prefetch',
      writerDecidedBy: 'buildRecentIdentityKeySet',
    },
    {
      check: 'intra_batch_identity_dedupe',
      cause: 'requires_full_batch_context',
      writerDecidedBy: 'candidate-writer.ts Pass 2.5 (seenBatchIdentityKeys)',
    },
    {
      check: 'target_cap',
      cause: 'requires_full_batch_context',
      writerDecidedBy: 'candidate-writer.ts Pass 3 (targetPersistibleCandidates)',
    },
  ];

/**
 * Familia 2 — gates PUROS del writer que este módulo todavía no invoca.
 *
 * No son writer-only: son deterministas y no tocan la base, así que una futura
 * versión puede resolverlos aquí sin cambiar el perfil de I/O (§ 9). Hasta
 * entonces están SIN RESOLVER, y el § 2 no admite matices: sin resolver no es
 * pase. Se declaran aparte para que el nombre no mienta —llamarlos «writer-only»
 * sería falso— y para que la deuda sea visible y acotada.
 *
 * Lo que este módulo SÍ resuelve, y por eso no aparece aquí: encaje de negocio,
 * política de evidencia de país y tamaño ICP (`evaluateApolloPreWriterQualityGate`),
 * y la propiedad del dominio, que viaja como `ownership_gate`.
 */
export const APOLLO_UNRESOLVED_PRE_WRITER_ADMISSION_CHECKS: readonly ApolloPreWriterAdmissionCheck[] =
  [
    {
      check: 'quality_label_discard',
      cause: 'pure_but_not_wired_pre_writer',
      writerDecidedBy: 'mapQualityLabelToStatus',
    },
    {
      check: 'canonical_identity_gate',
      cause: 'pure_but_not_wired_pre_writer',
      writerDecidedBy: 'buildCanonicalCompanyIdentity (isNonCompanyPhrase)',
    },
    {
      check: 'non_official_source_domain',
      cause: 'pure_but_not_wired_pre_writer',
      writerDecidedBy: 'isDirectorySourceDomain',
    },
    {
      check: 'country_compatibility_gate',
      cause: 'pure_but_not_wired_pre_writer',
      writerDecidedBy: 'evaluateCountryCompatibility',
    },
    {
      check: 'content_page_gate',
      cause: 'pure_but_not_wired_pre_writer',
      writerDecidedBy: 'isContentPageUrl/isContentPageName',
    },
    {
      check: 'content_intermediary_gate',
      cause: 'pure_but_not_wired_pre_writer',
      writerDecidedBy: 'evaluateContentIntermediaryGate',
    },
    {
      check: 'external_platform_gate',
      cause: 'pure_but_not_wired_pre_writer',
      writerDecidedBy: 'evaluateExternalPlatformGate',
    },
    {
      check: 'source_url_quality_gate',
      cause: 'pure_but_not_wired_pre_writer',
      writerDecidedBy: 'classifySourceUrlQuality',
    },
  ];

/**
 * Comprobaciones que SÓLO el writer resuelve. Vocabulario estático: viaja a
 * metadata de observabilidad.
 *
 * Sigue siendo la constante del hito anterior; lo que cambió es que ahora dice
 * la verdad completa. Eran dos porque nadie había barrido Pass 2.5, Pass 3 ni el
 * cooldown de identidad.
 */
export const APOLLO_WRITER_ONLY_ADMISSION_CHECKS: readonly string[] =
  APOLLO_WRITER_ONLY_ADMISSION_CHECK_REGISTRY.map((entry) => entry.check);

/**
 * § 2 — TODO lo que un consumidor PRE-writer debe declarar pendiente: las dos
 * familias juntas.
 *
 * Es lo que producción pasa a `evaluateCandidateTargetEligibility`. Consecuencia
 * declarada y aceptada por el § 4: mientras esta lista no esté vacía, ningún
 * candidato puede ser `stable` antes del writer, así que la parada temprana por
 * objetivo queda DESACTIVADA de hecho en producción. Los topes absolutos
 * (2 búsquedas / 5 enrichments / 25 créditos) siguen acotando el gasto, y la
 * reconciliación posterior al writer sigue siendo la cifra autoritativa.
 */
export const APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS: readonly string[] = [
  ...APOLLO_WRITER_ONLY_ADMISSION_CHECK_REGISTRY,
  ...APOLLO_UNRESOLVED_PRE_WRITER_ADMISSION_CHECKS,
].map((entry) => entry.check);

export type ApolloPreWriterQualityGate = {
  verdict: GateVerdict;
  /** Causa concreta cuando el veredicto es `fail`. `null` cuando pasa. */
  blockingReason: string | null;
};

/**
 * § 7 — el gate de CALIDAD del contrato, evaluado con los gates propios del
 * writer que sólo dependen del candidato.
 *
 * Orden idéntico al del writer: encaje de negocio → evidencia de país y política
 * de persistencia → tamaño ICP. El orden importa para la CAUSA que se reporta,
 * no para el veredicto: cualquiera de los tres bloquea por sí solo.
 */
export function evaluateApolloPreWriterQualityGate(input: {
  name: string;
  website: string | null;
  domain: string | null;
  sourceSnippet: string | null;
  sourceTitle: string | null;
  queryText: string | null;
  targetCountryCode: string | null;
  subindustries: readonly string[];
  additionalCriteria: string | null;
  /** Candidato completo: de él salen el tamaño declarado y el match de HubSpot. */
  candidate: unknown;
  matchedHubspotRaw?: unknown;
}): ApolloPreWriterQualityGate {
  const businessFit = evaluateBusinessFit({
    name: input.name,
    website: input.website,
    domain: input.domain,
    sourceSnippet: input.sourceSnippet,
    sourceTitle: input.sourceTitle,
    subindustries: [...input.subindustries],
    additionalCriteria: input.additionalCriteria,
  });
  if (isBlockedByBusinessFit(businessFit)) {
    return { verdict: 'fail', blockingReason: `business_fit:${businessFit.fit}` };
  }

  const countryEvidence = evaluateCountryEvidence({
    website: input.website,
    domain: input.domain,
    sourceSnippet: input.sourceSnippet,
    sourceTitle: input.sourceTitle,
    queryText: input.queryText,
    targetCountryCode: input.targetCountryCode,
  });
  const evidencePolicy = computeEvidencePersistencePolicy({ countryEvidence, businessFit });
  if (evidencePolicy.decision === 'blocked') {
    return {
      verdict: 'fail',
      blockingReason: `evidence_policy:${evidencePolicy.primaryReason}`,
    };
  }

  // § 7 — el gate que de verdad rechazó en la corrida `bdc51c49`
  // (`writer_summary.quality_rejected_count = 1`). Se evalúa SIN el perfil
  // enriquecido del writer: esa fuente sólo puede afinar el rango, y afinarlo
  // nunca convierte un bloqueo en un pase — vuelve a evaluarse con el rango real
  // en el writer, que es quien decide de verdad.
  const resolvedSize = resolveEmployeeSizeForIcpGate({
    richProfileSize: null,
    candidateCompanySize: extractCandidateCompanySize(input.candidate),
    matchedHubspotEmployees: extractHubSpotMatchedEmployees(input.matchedHubspotRaw),
    threshold: APOLLO_PRE_WRITER_ICP_EMPLOYEE_THRESHOLD,
  });
  const icpAction = resolveIcpSizeGateWriterAction(evaluateIcpSizeGate(resolvedSize.icpInput));
  if (icpAction.action === 'skip') {
    return {
      verdict: 'fail',
      blockingReason: icpAction.skipReason ?? 'icp_size_below_threshold',
    };
  }

  return { verdict: 'pass', blockingReason: null };
}

/**
 * § 7 — envoltura sobre un `ProspectingPipelineCandidate` ya construido.
 *
 * Lee exactamente los mismos campos que el writer lee de ese candidato. El
 * `nameForFit` con recuperación por dominio del writer (v1.16K-K) NO se replica:
 * es una recuperación de RECALL —puede rescatar a un candidato, nunca descartar
 * a uno— así que su ausencia sólo puede hacer este veredicto más estricto, que
 * es la dirección segura.
 */
export function evaluateApolloPreWriterQualityGateForCandidate(
  candidate: ProspectingPipelineCandidate,
  context: {
    targetCountryCode: string | null;
    subindustries: readonly string[];
    additionalCriteria?: string | null;
  },
): ApolloPreWriterQualityGate {
  const hubspotMatch = candidate.duplicateCheck?.matches.find((m) => m.source === 'hubspot');
  return evaluateApolloPreWriterQualityGate({
    name: candidate.name,
    website: candidate.website ?? null,
    domain: candidate.domain ?? null,
    sourceSnippet: candidate.sourceSnippet ?? null,
    sourceTitle: candidate.sourceTitle ?? null,
    queryText: candidate.searchTrace?.query_text ?? null,
    targetCountryCode: context.targetCountryCode,
    subindustries: context.subindustries,
    additionalCriteria: context.additionalCriteria ?? null,
    candidate,
    matchedHubspotRaw: hubspotMatch?.raw,
  });
}

// ═══ ADAPTIVE-EARLY-STOP §§ 2, 3, 4, 5 y 6 — pipeline canónico de admisión ═════
//
// Lo que este bloque cambia respecto del addendum anterior: las trece
// comprobaciones dejan de ser una lista de deuda y pasan a RESOLVERSE, cada una
// con la función del writer que la decide. Lo que NO cambia, y es el invariante
// que el § 1 exige conservar: sin resolver sigue sin ser un pase. Una
// comprobación que aquí no se puede evaluar —porque su contexto no llegó, o
// porque el candidato quedó fuera de la cobertura del prefetch— se declara
// `pending`, y un `pending` nunca cuenta hacia el objetivo.

/** § 6 — estado de UNA comprobación de admisión. `pending` NO es `passed`. */
export type ApolloPreWriterAdmissionState = 'passed' | 'failed' | 'pending';

export type ApolloPreWriterAdmissionCheckResult = {
  check: string;
  state: ApolloPreWriterAdmissionState;
  /** Causa concreta. `null` sólo cuando el estado es `passed`. */
  reason: string | null;
};

/**
 * § 2 — lo que UNA sola lectura de base, hecha una vez por corrida, deja
 * disponible para las tres comprobaciones que la necesitan.
 *
 * `coveredDomains` es la parte que no se puede omitir. Las tres estructuras del
 * writer contestan «no hay nada» tanto cuando de verdad no hay nada como cuando
 * el dominio nunca se consultó, y esa segunda respuesta leída como pase es
 * exactamente el defecto de este hilo con otro disfraz. Un candidato cuyo
 * dominio no esté aquí conserva sus tres comprobaciones PENDIENTES.
 */
export type ApolloPreWriterDbAdmissionContext = {
  /** Dominios normalizados que el prefetch consultó de verdad. */
  coveredDomains: ReadonlySet<string>;
  noveltyIndex: NoveltyIndex;
  recentIdentityKeys: ReadonlySet<string>;
  activeCandidates: readonly ActiveCandidateRecord[];
  /**
   * El prefetch degradó (el writer opera fail-open con `[]`). Aquí no se puede
   * hacer lo mismo: fail-open sirve para no bloquear una escritura, no para
   * autorizar una parada de gasto. Degradado ⇒ las tres quedan pendientes.
   */
  degraded: boolean;
};

/**
 * §§ 4 y 5 — lo que exige el LOTE entero y no es una propiedad del candidato.
 *
 * `intraBatchIdentityWinners` mapea identidad canónica → clave del candidato que
 * el writer conservaría; `targetCapAdmittedKeys` es el conjunto que sobrevive al
 * cupo COMPLETE-FIRST. `null` en cualquiera de los dos ⇒ su comprobación queda
 * pendiente, nunca aprobada por omisión.
 */
export type ApolloPreWriterBatchAdmissionContext = {
  intraBatchIdentityWinners: ReadonlyMap<string, string>;
  targetCapAdmittedKeys: ReadonlySet<string> | null;
};

/**
 * § 2 — las TRES comprobaciones que dependen del prefetch de base, en el orden
 * en que el evaluador las emite.
 *
 * Son las únicas que pueden quedar pendientes cuando el contexto de lote sí está
 * disponible: sin cliente, con el prefetch degradado o con el dominio fuera de su
 * cobertura. Existe como constante porque hay dos consumidores que necesitan
 * nombrarlas —la observabilidad y las suites— y deducirlas de la diferencia entre
 * dos listas era exactamente el tipo de derivación implícita que este hilo evita.
 */
export const APOLLO_DB_BACKED_PRE_WRITER_ADMISSION_CHECKS: readonly string[] = [
  'recent_identity_cooldown',
  'novelty_index',
  'active_duplicate_guard',
];

export type ApolloPreWriterGateContext = {
  targetCountryCode: string | null;
  subindustries: readonly string[];
  additionalCriteria?: string | null;
};

/** Dominio efectivo tal como lo resuelve el writer en Pass 1. */
export function resolveApolloPreWriterEffectiveDomain(
  candidate: ProspectingPipelineCandidate,
): string | null {
  return candidate.domain ?? extractDomain(candidate.website ?? null);
}

function passed(check: string): ApolloPreWriterAdmissionCheckResult {
  return { check, state: 'passed', reason: null };
}
function failed(check: string, reason: string): ApolloPreWriterAdmissionCheckResult {
  return { check, state: 'failed', reason };
}
function pending(check: string, reason: string): ApolloPreWriterAdmissionCheckResult {
  return { check, state: 'pending', reason };
}

/**
 * § 3 — las OCHO comprobaciones puras del writer, resueltas antes del writer.
 *
 * Mismo orden que Pass 1 de `candidate-writer.ts`, porque el orden decide qué
 * causa se reporta cuando más de una bloquea. Ninguna se reimplementa: cada una
 * invoca la función que el writer invoca.
 *
 * `country_compatibility_gate` es la única que puede quedar PENDIENTE aquí, y
 * sólo cuando la corrida no declaró código de país: el writer, en ese caso,
 * descarta con `missing_country_code`, así que declararlo pendiente es la
 * lectura conservadora (no cuenta) sin afirmar un rechazo que depende de una
 * configuración y no del candidato.
 */
export function evaluateApolloPreWriterDeterministicGates(
  candidate: ProspectingPipelineCandidate,
  context: ApolloPreWriterGateContext,
): ApolloPreWriterAdmissionCheckResult[] {
  const results: ApolloPreWriterAdmissionCheckResult[] = [];
  const effectiveDomain = resolveApolloPreWriterEffectiveDomain(candidate);
  const urlOrDomain =
    candidate.website ?? (effectiveDomain ? `https://${effectiveDomain}` : null);

  results.push(
    mapQualityLabelToStatus(candidate.scoring.qualityLabel) === null
      ? failed('quality_label_discard', 'qualityLabel=discard')
      : passed('quality_label_discard'),
  );

  const identity = buildCanonicalCompanyIdentity(candidate.name);
  results.push(
    identity.isNonCompanyPhrase
      ? failed('canonical_identity_gate', 'non_company_phrase')
      : passed('canonical_identity_gate'),
  );

  results.push(
    isDirectorySourceDomain(effectiveDomain)
      ? failed('non_official_source_domain', 'non_official_source_domain')
      : passed('non_official_source_domain'),
  );

  if (!context.targetCountryCode) {
    results.push(pending('country_compatibility_gate', 'missing_country_code'));
  } else {
    const compat = evaluateCountryCompatibility(urlOrDomain, context.targetCountryCode);
    results.push(
      compat.compatible
        ? passed('country_compatibility_gate')
        : failed('country_compatibility_gate', `country_incompatible:${compat.reason}`),
    );
  }

  results.push(
    isContentPageUrl(candidate.website ?? null) || isContentPageName(candidate.name)
      ? failed('content_page_gate', 'content_page')
      : passed('content_page_gate'),
  );

  const intermediary = evaluateContentIntermediaryGate({
    name: candidate.name,
    domain: effectiveDomain,
    title: candidate.sourceTitle ?? undefined,
    snippet: candidate.sourceSnippet ?? undefined,
    companySize: typeof candidate.companySize === 'string' ? candidate.companySize : undefined,
  });
  results.push(
    intermediary.blocked
      ? failed(
          'content_intermediary_gate',
          intermediary.reasons[0] ?? 'content_or_intermediary_site',
        )
      : passed('content_intermediary_gate'),
  );

  const externalPlatform = evaluateExternalPlatformGate(urlOrDomain, candidate.name);
  results.push(
    externalPlatform.allowed
      ? passed('external_platform_gate')
      : failed(
          'external_platform_gate',
          `external_platform:${externalPlatform.platformType ?? 'unknown'}`,
        ),
  );

  const sourceUrlQuality = classifySourceUrlQuality(urlOrDomain, candidate.name);
  results.push(
    isBlockedBySourceUrlQuality(sourceUrlQuality)
      ? failed('source_url_quality_gate', `source_url_quality:${sourceUrlQuality.quality}`)
      : passed('source_url_quality_gate'),
  );

  return results;
}

/** § 4 — señales de ranking del writer para UN candidato, con sus gates puros. */
export function buildApolloPreWriterRankSignals(
  candidate: ProspectingPipelineCandidate,
  context: ApolloPreWriterGateContext,
): {
  businessFitRankingBonus: number;
  sourceUrlRankingBonus: number;
  countryCompatWeight: number;
  confidenceScore: number | null;
  website: string | null;
} {
  const effectiveDomain = resolveApolloPreWriterEffectiveDomain(candidate);
  const urlOrDomain =
    candidate.website ?? (effectiveDomain ? `https://${effectiveDomain}` : null);
  const businessFit = evaluateBusinessFit({
    name: candidate.name,
    website: candidate.website ?? null,
    domain: effectiveDomain,
    sourceSnippet: candidate.sourceSnippet ?? null,
    sourceTitle: candidate.sourceTitle ?? null,
    subindustries: [...context.subindustries],
    additionalCriteria: context.additionalCriteria ?? null,
  });
  return {
    businessFitRankingBonus: businessFit.rankingBonus,
    sourceUrlRankingBonus: classifySourceUrlQuality(urlOrDomain, candidate.name).rankingBonus,
    countryCompatWeight: context.targetCountryCode
      ? countryCompatibilityRankWeight(
          evaluateCountryCompatibility(urlOrDomain, context.targetCountryCode),
        )
      : 0,
    confidenceScore: candidate.scoring.confidenceScore ?? null,
    website: candidate.website ?? null,
  };
}

/** Entrada del lote para construir el contexto de §§ 4 y 5. */
export type ApolloPreWriterBatchCandidate = {
  candidateKey: string;
  candidate: ProspectingPipelineCandidate;
  /**
   * Proyección de completitud del contrato canónico para ESTE candidato, tal
   * como la calcula quien conoce su precisión de subindustria. Es lo que hace
   * COMPLETE-FIRST al cupo (§ 5); este módulo no la deduce, la recibe.
   */
  completeValidIfPersisted: boolean;
};

/**
 * §§ 4 y 5 — contexto de lote, construido con el MISMO orden, la MISMA dedupe y
 * el MISMO cupo complete-first que aplicará el writer.
 *
 * Antes de ordenar se descartan los candidatos que no superan los gates
 * deterministas, porque el writer tampoco los mete en el ranking: incluirlos
 * cambiaría quién gana una identidad repetida y quién entra en el cupo.
 */
export function buildApolloPreWriterBatchAdmissionContext(input: {
  candidates: readonly ApolloPreWriterBatchCandidate[];
  context: ApolloPreWriterGateContext;
  /** Cupo del lote. `null` ⇒ no hay cupo y `target_cap` no puede descartar a nadie. */
  targetCap: number | null;
}): ApolloPreWriterBatchAdmissionContext {
  const rankable = input.candidates
    .filter((entry) =>
      evaluateApolloPreWriterDeterministicGates(entry.candidate, input.context).every(
        (check) => check.state !== 'failed',
      ),
    )
    .map((entry) => ({
      entry,
      signals: buildApolloPreWriterRankSignals(entry.candidate, input.context),
      identityKey: buildCanonicalCompanyIdentity(entry.candidate.name).identityKey ?? null,
    }))
    .sort((a, b) => compareWriterEligibleRank(a.signals, b.signals));

  const dedupe = selectIntraBatchIdentityWinnerIndexes(rankable.map((e) => e.identityKey));
  const winners = dedupe.winners.map((index) => rankable[index]);

  const intraBatchIdentityWinners = new Map<string, string>();
  for (const winner of winners) {
    if (winner.identityKey) {
      intraBatchIdentityWinners.set(winner.identityKey, winner.entry.candidateKey);
    }
  }

  const capOrdered = orderByCompleteFirst(winners, (w) => w.entry.completeValidIfPersisted);
  const targetCapAdmittedKeys =
    input.targetCap === null
      ? new Set(capOrdered.map((w) => w.entry.candidateKey))
      : new Set(
          capOrdered
            .slice(0, Math.max(0, input.targetCap))
            .map((w) => w.entry.candidateKey),
        );

  return { intraBatchIdentityWinners, targetCapAdmittedKeys };
}

/**
 * § 6 — evaluación canónica de admisión PRE-writer para UN candidato.
 *
 * Devuelve el estado de LAS TRECE comprobaciones. Lo que un consumidor tiene que
 * hacer con el resultado está fijado por el § 2 y no admite matices: sólo
 * `pendingChecks.length === 0 && failedChecks.length === 0` habilita a ese
 * candidato a sostener una parada por objetivo, y esa condición se combina
 * además con la elegibilidad canónica del contrato (`countsTowardTargetIfPersisted`).
 */
export function evaluateCandidatePreWriterAdmission(input: {
  candidateKey: string;
  candidate: ProspectingPipelineCandidate;
  context: ApolloPreWriterGateContext;
  dbContext?: ApolloPreWriterDbAdmissionContext | null;
  batchContext?: ApolloPreWriterBatchAdmissionContext | null;
}): {
  checks: ApolloPreWriterAdmissionCheckResult[];
  passedChecks: string[];
  failedChecks: string[];
  pendingChecks: string[];
} {
  const checks = evaluateApolloPreWriterDeterministicGates(input.candidate, input.context);

  const identity = buildCanonicalCompanyIdentity(input.candidate.name);
  const effectiveDomain = resolveApolloPreWriterEffectiveDomain(input.candidate);
  const normalizedDomain = effectiveDomain ? normalizeDomain(effectiveDomain) : null;

  // ── §§ 2 — las tres respaldadas por el prefetch único ─────────────────────
  const db = input.dbContext ?? null;
  const dbUsable = db !== null && !db.degraded;
  // Un candidato SIN dominio no participa de las consultas por dominio: el
  // writer lo evalúa igual, con el índice que tenga. Con dominio, la cobertura
  // es obligatoria.
  const dbCoversCandidate =
    dbUsable && (normalizedDomain === null || db!.coveredDomains.has(normalizedDomain));

  const dbPendingReason =
    db === null
      ? 'db_prefetch_unavailable'
      : db.degraded
        ? 'db_prefetch_degraded'
        : 'domain_outside_prefetch_coverage';

  if (!dbCoversCandidate) {
    checks.push(pending('recent_identity_cooldown', dbPendingReason));
    checks.push(pending('novelty_index', dbPendingReason));
    checks.push(pending('active_duplicate_guard', dbPendingReason));
  } else {
    const prefetch = db!;
    checks.push(
      identity.identityKey && prefetch.recentIdentityKeys.has(identity.identityKey)
        ? failed('recent_identity_cooldown', 'seen_identity_key_recently')
        : passed('recent_identity_cooldown'),
    );

    const novelty = evaluateCandidateNovelty(
      {
        name: input.candidate.name,
        domain: input.candidate.domain ?? null,
        website: input.candidate.website ?? null,
      },
      prefetch.noveltyIndex,
    );
    checks.push(
      novelty.shouldSkip
        ? failed('novelty_index', novelty.skipReason ?? 'novelty_skip')
        : passed('novelty_index'),
    );

    // Misma entrada de guard que construye Pass 4 del writer. El nombre inferido
    // desde dominio sólo se aplica cuando la normalización lo sustituyó, igual
    // que allí; sin sustitución, el nombre crudo.
    const guardName = input.candidate.name;
    const guardMatch = checkActiveCandidateDuplicate(
      {
        name: guardName,
        domain: effectiveDomain,
        website: input.candidate.website ?? null,
        inferredCompanyName: guardName,
        normalizedName: normalizeName(guardName),
      },
      [...prefetch.activeCandidates],
    );
    // AGENT1-LUSHA-CUT-L7 § 21 — mismo criterio que Pass 4 del writer: sólo el
    // DOMINIO activo es identidad fuerte. La igualdad de nombre inferido dejó de
    // reprobar esta condición.
    const isStrongMatch = guardMatch.matched && isStrongActiveGuardReason(guardMatch.reason);
    checks.push(
      isStrongMatch
        ? failed('active_duplicate_guard', `duplicate_guard:${guardMatch.reason}`)
        : passed('active_duplicate_guard'),
    );
  }

  // ── §§ 4 y 5 — las dos que exigen el lote entero ──────────────────────────
  //
  // Un candidato que ya cae por un gate determinista nunca entra en el ranking
  // del writer, así que preguntarle por el cupo o por la dedupe no tiene
  // respuesta: se declara pendiente con esa causa en vez de inventar un
  // «duplicado intra-lote» que no ocurrió. No cambia nada económico —ya no
  // podía ser estable— y evita un motivo falso en la observabilidad.
  const excludedBeforeRanking = checks.some((c) => c.state === 'failed');
  const batch = input.batchContext ?? null;
  if (excludedBeforeRanking) {
    checks.push(pending('intra_batch_identity_dedupe', 'excluded_before_ranking'));
    checks.push(pending('target_cap', 'excluded_before_ranking'));
  } else if (batch === null) {
    checks.push(pending('intra_batch_identity_dedupe', 'batch_context_unavailable'));
    checks.push(pending('target_cap', 'batch_context_unavailable'));
  } else {
    const winnerKey = identity.identityKey
      ? batch.intraBatchIdentityWinners.get(identity.identityKey) ?? null
      : null;
    checks.push(
      identity.identityKey === null || winnerKey === input.candidateKey
        ? passed('intra_batch_identity_dedupe')
        : failed('intra_batch_identity_dedupe', 'intra_batch_identity_duplicate'),
    );

    checks.push(
      batch.targetCapAdmittedKeys === null
        ? pending('target_cap', 'target_cap_unknown')
        : batch.targetCapAdmittedKeys.has(input.candidateKey)
          ? passed('target_cap')
          : failed('target_cap', 'target_cap'),
    );
  }

  return {
    checks,
    passedChecks: checks.filter((c) => c.state === 'passed').map((c) => c.check),
    failedChecks: checks.filter((c) => c.state === 'failed').map((c) => c.check),
    pendingChecks: checks.filter((c) => c.state === 'pending').map((c) => c.check),
  };
}
