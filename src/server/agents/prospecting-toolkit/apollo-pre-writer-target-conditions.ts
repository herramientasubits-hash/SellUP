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
