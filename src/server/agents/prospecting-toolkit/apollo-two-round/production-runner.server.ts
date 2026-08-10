/**
 * production-runner.server.ts — Adaptador de PRODUCCIÓN de la modalidad Apollo
 * de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX · § 1, § 2, § 3, § 5, § 6, § 7, § 8, § 9.
 *
 * Es la costura que convierte el paquete puro en la ruta real de ejecución del
 * Agente 1. El orquestador (`runApolloTwoRoundDiscovery`) sigue sin conocer
 * Apollo, Supabase ni `process.env`: este archivo le inyecta funciones que
 * apuntan a las implementaciones que YA existen en producción.
 *
 *   búsqueda por ronda        → runApolloOrganizationsSearch (provider real)
 *   gates baratos             → evaluateApolloEnrichmentEligibility
 *   veredicto sectorial       → evaluateApolloSectorRelevanceForPaidOperation
 *   duplicado SellUp/HubSpot  → buildProspectingPipelineCandidate
 *                               (checkCompanyDuplicate, la misma del pipeline)
 *   cooldown / sugerencia     → loadDiscoveryNegativeMemory
 *   enrichment                → runApolloOrganizationEnrichmentCascade
 *   usage logging enrichment  → logApolloOrganizationEnrichmentUsage (§ 1)
 *   persistencia              → writeProspectingCandidates
 *   checkpoint durable        → writeTwoRoundCheckpoint (§ 3, § 7)
 *
 * Ninguna de esas funciones se reimplementa aquí. Lo único propio del archivo es
 * la traducción entre vocabularios y el orden en que se invocan.
 *
 * Cuatro huecos que este archivo cierra respecto de la versión anterior:
 *
 *   § 1  el enrichment de esta ruta NO dejaba fila en `provider_usage_logs`. La
 *        escribía sólo el bucle del provider legacy, que esta ruta no atraviesa.
 *   § 3  el estado se persistía UNA vez, al final. Un fallo a mitad perdía todo
 *        lo ya pagado.
 *   § 8  después de cada enrichment se reconstruía el candidato entero, lo que
 *        repetía la verificación HTTP del sitio y la consulta de duplicados en
 *        SellUp/HubSpot sin que ninguna de las dos pudiera cambiar de resultado.
 *   § 9  la contabilidad de gasto se armaba a mano aquí en vez de usar el
 *        constructor único de `budget.ts`.
 *
 * Server-only. No importar desde componentes de cliente.
 */

import type {
  ProspectingPipelineCandidate,
  ProspectingPipelineOutput,
  WebSearchInput,
  WebSearchOutput,
  WebSearchResult,
} from '../types';
import type { IncrementalSearchOutput } from '../incremental-search-types';
import { getCatalogContext } from '../catalog-context-retriever';
import {
  buildProspectingPipelineCandidate,
  buildSummary,
} from '../prospecting-pipeline';
import {
  runApolloOrganizationsSearch,
  type ApolloOrgsSearchOptions,
} from '../web-search-providers/apollo-organizations-search-provider';
// QUERY-QUALITY-2-FIX § 1/§ 2 — constructor ÚNICO del request efectivo. El mismo
// que gobierna la llamada real decide si la ronda 2 vale un crédito.
import {
  buildApolloOrganizationsEffectiveRequest,
  type ApolloEffectiveRequest,
} from '../apollo-organizations-effective-request';
import { resolveApolloMaxResultsPerQuery } from '../apollo-cost-guardrails';
import {
  evaluateApolloEnrichmentEligibility,
  type ApolloEnrichmentIneligibilityReason,
} from '../apollo-enrichment-eligibility-gate';
import { evaluateApolloSectorRelevanceForPaidOperationAnyOf } from '../apollo-sector-relevance-gate';
import {
  evaluateApolloFreeSectorContradictionAnyOf,
  resolveAllApolloSubindustrySearchMappings,
  type ApolloFreeSectorEvidence,
} from '../apollo-subindustry-search-mapping';
import { toApolloSubindustryQueryCoverageMetadata } from '../apollo-subindustry-query-terms';
import { runApolloOrganizationEnrichmentCascade } from '../apollo-organization-enrichment-cascade';
import { enrichApolloOrganization } from '@/server/integrations/apollo-client';
import { loadActiveApolloOrganizationEnrichmentPricing } from '@/modules/usage-tracking/provider-pricing';
import { writeProspectingCandidates } from '../candidate-writer';
import type { CandidatePersistenceOutcome } from '../prospect-candidate-persistence-readiness';
import {
  loadDiscoveryNegativeMemory,
  emptyNegativeMemory,
  type DiscoveryNegativeMemory,
} from '../discovery-negative-memory';
import { normalizeDomain } from '../normalization';
import {
  captureApolloCompanyFields,
  mergeCompanyLinkedInCapture,
  mergeEmployeeCountCapture,
} from '../apollo-company-fields-mapping';
import {
  buildApolloEnrichmentUsageKey,
  classifyApolloEnrichmentBillingOutcome,
  classifyApolloEnrichmentOutcomeFromCascadeEntry,
  logApolloOrganizationEnrichmentUsage,
  resolveApolloEnrichmentUsageAccounting,
  type ApolloEnrichmentBillingOutcome,
} from '../apollo-organization-enrichment-usage-log';

import type { ApolloTwoRoundQueryHypothesis } from './query-hypothesis';
import {
  createApolloTwoRoundProductionOrchestratorDeps,
  runApolloTwoRoundDiscovery,
  toApolloTwoRoundResumeState,
  type ApolloTwoRoundCheckpointSnapshot,
  type ApolloTwoRoundProductionOrchestratorDeps,
  type ApolloTwoRoundResumeState,
  type ApolloTwoRoundRunResult,
  type CheapAssessment,
  type CheapRejectionReason,
  type EnrichmentResult,
  type RawDiscoveredOrganization,
  type ResumedCandidate,
} from './orchestrator';
import {
  toApolloTwoRoundOperationContextMetadata,
  type ApolloTwoRoundOperationContext,
  type ApolloTwoRoundRunCorrelation,
} from './idempotency';
import {
  APOLLO_TWO_ROUND_OBSERVABILITY_KEY,
  toRoundMetricsMetadata,
  toRound2PageDecisionMetadata,
  toRunMetricsMetadata,
} from './observability';
import {
  estimateApolloTwoRoundBudget,
  buildApolloTwoRoundSpendAccounting,
  toApolloTwoRoundBudgetMetadata,
} from './budget';
import {
  toApolloTwoRoundConfigDiagnostics,
  type ApolloTwoRoundDiscoveryConfig,
} from './config';
import { resolveApolloTwoRoundConfigFromEnv } from './env.server';
// MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § D — invariantes de consistencia
// entre las fuentes del estado final. Observacional: nunca lanza.
import {
  evaluateApolloTwoRoundFinalStateConsistency,
  toFinalStateConsistencyMetadata,
} from './run-final-state-consistency';
import type { CandidateSectorEvidenceState } from './enrichment-ranking';
import {
  APOLLO_TWO_ROUND_CHECKPOINT_CONTRACT_VERSION,
  APOLLO_TWO_ROUND_CHECKPOINT_KEY,
  fromCandidateEvidenceSnapshot,
  toCandidateEvidenceSnapshot,
  toSeenOrganizationKeys,
  type ApolloTwoRoundCandidateEvidenceSnapshot,
  type ApolloTwoRoundCandidateSnapshot,
  type ApolloTwoRoundCheckpointReason,
  type ApolloTwoRoundCheckpointV1,
  type ApolloTwoRoundEnrichmentSnapshot,
  type ApolloTwoRoundEnrichmentStatus,
  type ApolloTwoRoundPendingOrganizationSnapshot,
  type ApolloTwoRoundRecordedOperationCredit,
} from './checkpoint';
import {
  hasUnknownOperationBilling,
  mergeApolloTwoRoundCheckpoints,
  mergeRecordedOperationCredits,
  sumRecordedOperationCredits,
  verifyDurableCheckpointContainsOperation,
} from './checkpoint-merge';
import { APOLLO_TWO_ROUND_BILLING_CONTRACT } from '../apollo-usage-operation-context';
// A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 §§ 3, 4 y 5 — precisión de
// subindustria, captura persistible del enrichment y gate final de ownership.
import {
  assessApolloSubindustryPrecisionForRequest,
  type ApolloSubindustryPrecisionAssessment,
} from '../apollo-subindustry-precision';
import { captureApolloEnrichmentForPersistence } from '../apollo-enrichment-persistence-capture';
// CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM §§ 3 y 9 — versión del catálogo que redactó
// la consulta, y el invariante que la ata a la versión de la selección.
import {
  evaluateApolloCatalogVersionCoherence,
  toApolloCatalogVersionCoherenceMetadata,
  toApolloSubindustryCatalogTermsMetadata,
  type ApolloSubindustryCatalogTermsResolution,
} from '../apollo-subindustry-catalog-terms-resolution';
import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
} from '../company-ownership-gate';
import {
  readTwoRoundCheckpoint,
  writeTwoRoundCheckpoint,
  type CheckpointWriteOutcome,
} from './checkpoint.server';

// ─── Entrada ──────────────────────────────────────────────────────────────────

export type ApolloTwoRoundWizardRunInput = {
  country: string;
  countryCode: string;
  industry: string;
  subindustries: string[];
  /**
   * CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 2 (CASO B) — términos de
   * `subindustry_search_terms` de la versión publicada, resueltos UNA vez en la
   * frontera del wizard con el mismo cliente que resolvió la selección.
   *
   * Viajan resueltos porque la redacción de la consulta es pura: el runner no
   * consulta el catálogo, lo transporta. Ausentes con subindustrias pedidas, el gate
   * del § 3 bloquea antes de gastar en vez de buscar con un respaldo estático.
   */
  subindustryCatalogTerms?: ApolloSubindustryCatalogTermsResolution | null;
  /**
   * § 3 — versión del catálogo con la que se resolvió la SELECCIÓN
   * (`resolved.catalog.version`). Lado izquierdo del invariante
   * `selection_catalog_version == search_term_catalog_version`.
   */
  selectionCatalogVersion?: string | null;
  additionalCriteria: string | null;
  /** Lote ya reservado. La modalidad NUNCA crea un segundo lote. */
  reservedBatchId: string;
  triggeredByUserId: string;
  ownerId: string;
  correlation: ApolloTwoRoundRunCorrelation;
  /** Metadata de correlación que viaja a `provider_usage_logs`. */
  runCorrelationMetadata?: Record<string, unknown> | null;
  /** Metadata aditiva del lote (routing observacional, selección de proveedor). */
  extraBatchMetadata?: Record<string, unknown> | null;
  /**
   * Créditos que la reserva sostiene. § 2 — la aserción defensiva compara el
   * gasto REGISTRADO contra este número, no contra la estimación.
   */
  reservedCredits: number;
};

/**
 * Anomalía de presupuesto del § 2.
 *
 * `recorded_usage_exceeds_reservation` reutiliza deliberadamente el mismo código
 * que la reconciliación del wizard: una anomalía con dos nombres se lee como dos
 * problemas distintos.
 */
export const TWO_ROUND_BUDGET_ANOMALY = 'recorded_usage_exceeds_reservation' as const;

/**
 * Anomalía del § 4 — hay una operación cuyo cobro no se confirmó, así que la
 * corrida no puede declararse conciliada de forma automática.
 */
export const TWO_ROUND_INDETERMINATE_ANOMALY = 'apollo_operation_indeterminate' as const;

/** Aviso del § 3 — un checkpoint no se pudo persistir. */
export const TWO_ROUND_CHECKPOINT_WARNING = 'two_round_checkpoint_persist_failed' as const;

/**
 * CAS-CLOSE § 1 — otro proceso del MISMO run ganó el compare-and-swap y su
 * checkpoint YA contenía esta operación, probada campo a campo.
 *
 * Es la ÚNICA forma en que un `stale_rejected` puede considerarse durable. Se
 * emite como aviso para que la corrida deje rastro de que hubo concurrencia real,
 * no porque haya algo que conciliar.
 */
export const TWO_ROUND_CONCURRENT_DURABILITY_SOURCE =
  'concurrent_checkpoint_already_contains_operation' as const;

/**
 * Intentos de fusionar sobre el ganador y reintentar el CAS antes de rendirse.
 *
 * Acotado a propósito: no es un candado distribuido. Agotarlo NO repite ninguna
 * llamada al proveedor — degrada la operación a indeterminada, que es el único
 * desenlace honesto cuando el estado no se pudo dejar recuperable.
 */
const MAX_STALE_RESOLUTION_ATTEMPTS = 3;

// ─── Dependencias (inyectables sólo para tests) ───────────────────────────────

export type ApolloTwoRoundProductionDeps = {
  searchApollo: typeof runApolloOrganizationsSearch;
  buildCandidate: typeof buildProspectingPipelineCandidate;
  enrichCascade: typeof runApolloOrganizationEnrichmentCascade;
  /**
   * § 1 — transporte del enrichment. Se inyecta al cascade para poder OBSERVAR el
   * desenlace del transporte (éxito con match, éxito sin match, error definitivo,
   * timeout) sin tener que adivinarlo desde un mensaje de error.
   */
  enrichOrganization: typeof enrichApolloOrganization;
  persistCandidates: typeof writeProspectingCandidates;
  /** § 1 — escritor de la fila económica del enrichment. */
  logEnrichmentUsage: typeof logApolloOrganizationEnrichmentUsage;
  /**
   * Costo unitario vivo de `organization_enrichment`. `null` ⇒ sin pricing activo:
   * el enrichment queda prohibido para toda la corrida, igual que en la ruta
   * legacy, en vez de registrar un costo fabricado.
   */
  loadEnrichmentUnitCostUsd: () => Promise<number | null>;
  /** Memoria negativa (dominios ya sugeridos). Vacía cuando no hay cliente. */
  loadNegativeMemory: (scope: {
    countryCode: string;
    industryName: string;
    subindustryNames: string[];
    lookbackDays: number;
  }) => Promise<DiscoveryNegativeMemory>;
  /** § 5 — checkpoint del intento anterior de la MISMA corrida. Null si no hay. */
  loadCheckpoint: (
    batchId: string,
    identity: { idempotencyKey: string; requestFingerprint: string },
  ) => Promise<ApolloTwoRoundCheckpointV1 | null>;
  /** § 3 — persiste el checkpoint tras cada transición recuperable. */
  saveCheckpoint: (
    batchId: string,
    checkpoint: ApolloTwoRoundCheckpointV1,
  ) => Promise<CheckpointWriteOutcome>;
  resolveConfig: () => ApolloTwoRoundDiscoveryConfig;
};

const NEGATIVE_MEMORY_LOOKBACK_DAYS = 30;

// ─── Traducción de vocabularios ───────────────────────────────────────────────

/**
 * Traduce el motivo del gate de elegibilidad al vocabulario del orquestador.
 *
 * Es una traducción, no una segunda política: cada motivo del gate tiene un
 * único destino y ninguno se inventa aquí.
 */
export function toCheapRejectionReason(
  reason: ApolloEnrichmentIneligibilityReason,
): CheapRejectionReason {
  switch (reason) {
    case 'country_mismatch':
    case 'tld_country_mismatch':
      return 'country_incompatible';
    case 'invalid_domain':
    case 'generic_or_mail_provider_domain':
      return 'invalid_domain';
    case 'inferred_domain_ownership_mismatch':
      return 'ownership_mismatch';
    case 'external_platform_domain':
      return 'external_platform_domain';
    case 'cooldown_active':
    case 'organization_already_processed':
      return 'cooldown_or_prior_suggestion';
    case 'preliminary_duplicate':
      return 'seen_in_previous_round';
    case 'sector_not_mapped':
      return 'sector_not_mapped';
    case 'sector_relevance_contradicted':
      return 'sector_evidence_contradictory';
  }
}

/** Traduce el veredicto sectorial pagado al estado del § 5. */
export function toSectorEvidenceState(
  decision:
    | 'relevant'
    | 'sector_not_mapped'
    | 'sector_relevance_contradicted'
    | 'sector_evidence_missing_needs_enrichment',
): CandidateSectorEvidenceState {
  switch (decision) {
    case 'relevant':
      return 'sector_evidence_confirmed';
    case 'sector_not_mapped':
      return 'sector_not_mapped';
    case 'sector_relevance_contradicted':
      return 'sector_evidence_contradictory';
    case 'sector_evidence_missing_needs_enrichment':
      return 'sector_evidence_missing_needs_enrichment';
  }
}

/**
 * Lee el veredicto de duplicado que el pipeline ya calculó.
 *
 * NO vuelve a consultar SellUp ni HubSpot: `buildProspectingPipelineCandidate`
 * ejecuta `checkCompanyDuplicate` una sola vez por organización, y de ahí salen
 * ambas señales. Una organización = una evaluación = como máximo diez por
 * corrida, que es el tope de resultados crudos del § 2.
 */
/**
 * HARDENING-1 § 3 — pliega el veredicto de SUBINDUSTRIA sobre el veredicto de
 * sector.
 *
 * El gate sectorial declara «relevante» en cuanto un término del conjunto
 * aparece en cualquier texto del candidato, y para «Supermercados e
 * Hipermercados» ese conjunto incluye `grocery`. Así se confirmaron —y se
 * persistieron— una app de domicilios de mercado y un distribuidor B2B de
 * alimentos. La confirmación de sector ya no basta por sí sola: hace falta
 * además evidencia positiva y trazable de la subindustria pedida.
 *
 * Sin subindustria mapeada el pliegue es la identidad. Esa búsqueda no pide
 * precisión de subindustria y aplicarle una política que no tiene rechazaría a
 * todo el mundo.
 *
 * El pliegue sólo puede DEGRADAR. Una subindustria confirmada no rescata a un
 * candidato cuya industria declarada contradice el sector: la contradicción es
 * evidencia en contra y no se compensa con una coincidencia de palabra.
 */
/**
 * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 1 — `primarySubindustryForQueryDrafting`
 * ya no existe.
 *
 * Era el último consumidor de un solo valor del runner y estaba declarado como
 * legítimo con este argumento: «que la hipótesis se redacte sobre una sola NO
 * recorta el alcance de la búsqueda, porque el effective request arma el ANY-OF de
 * keywords con la lista completa». La corrida live `ce957e2f` demostró que esa
 * premisa era falsa: el effective request armaba el ANY-OF con
 * `resolveFirstApolloSubindustrySearchMapping`, que también se quedaba con la
 * primera. Dos cuellos de botella FIRST-ONLY en fila, y el segundo invalidaba la
 * justificación del primero.
 *
 * La redacción de la consulta SÍ decide alcance: es lo que se le pregunta al
 * proveedor. Ahora el contexto de consulta lleva `subindustries[]` y el reparto lo
 * hace `interleaveApolloSubindustryTerms`.
 */

export function foldSubindustryPrecisionIntoSectorState(
  base: CandidateSectorEvidenceState,
  precision: ApolloSubindustryPrecisionAssessment,
): CandidateSectorEvidenceState {
  if (!precision.subindustryMapped) return base;
  if (precision.subindustryMatch === 'rejected') return 'sector_evidence_contradictory';
  if (precision.subindustryMatch === 'ambiguous' && base === 'sector_evidence_confirmed') {
    // Ambigua NO cuenta para el objetivo, pero sigue siendo el único estado que
    // puede competir por un enrichment: resolver esa duda es para lo que existe.
    return 'sector_evidence_missing_needs_enrichment';
  }
  return base;
}

export function readDuplicateVerdict(
  candidate: ProspectingPipelineCandidate,
): { sellUpDuplicate: boolean; hubSpotDuplicate: boolean } {
  const matches = candidate.duplicateCheck?.matches ?? [];
  const isDuplicateStatus = (status: string): boolean =>
    status === 'existing_in_sellup' ||
    status === 'existing_in_hubspot' ||
    status === 'possible_duplicate';

  return {
    sellUpDuplicate: matches.some(
      (m) => m.source === 'sellup' && isDuplicateStatus(m.status),
    ),
    hubSpotDuplicate: matches.some(
      (m) => m.source === 'hubspot' && isDuplicateStatus(m.status),
    ),
  };
}

/** Convierte un resultado de búsqueda en la organización que el orquestador ve. */
export function toRawDiscoveredOrganization(
  result: WebSearchResult,
  providerRank: number,
): RawDiscoveredOrganization {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const readString = (key: string): string | null => {
    const value = meta[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };
  const profile = (meta['apollo_profile'] ?? {}) as Record<string, unknown>;
  const declaredIndustry =
    readString('industry') ??
    (typeof profile['industry'] === 'string' ? (profile['industry'] as string) : null);

  return {
    providerOrganizationId: readString('apollo_organization_id') ?? readString('organization_id'),
    name: result.title,
    domain: readString('domain') ?? normalizeDomain(result.url),
    linkedinUrl: readString('linkedin_url'),
    providerRank,
    declaredIndustry,
  };
}

/**
 * § 4 — ¿la búsqueda dejó su resultado o su cobro sin confirmar?
 *
 * Lee señales que el provider YA produce, sin inventar ninguna: páginas cuyo
 * desenlace quedó indeterminado, y un error terminal cuya taxonomía declara el
 * cobro como desconocido. Cualquiera de las dos basta.
 */
export function readSearchIndeterminacy(output: WebSearchOutput): boolean {
  const metadata = (output.metadata ?? {}) as Record<string, unknown>;
  const pagination = metadata['apollo_pagination'] as
    | { indeterminate_pages?: unknown }
    | undefined;
  const indeterminatePages = pagination?.indeterminate_pages;
  if (Array.isArray(indeterminatePages) && indeterminatePages.length > 0) return true;

  const error = metadata['apollo_error'] as { billing_state?: unknown } | undefined;
  return error?.billing_state === 'unknown';
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export type ApolloTwoRoundWizardRunOutcome = IncrementalSearchOutput & {
  /** § 2 / § 4 — visible cuando el gasto no cuadra o no se pudo confirmar. */
  budgetAnomalies?: readonly string[];
  /**
   * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 § 1 — lo que el ORQUESTADOR había
   * proyectado antes de escribir.
   *
   * `targetReached` pasa a decidirse sobre filas reales, y esta cifra conserva la
   * proyección para poder compararlas. Una divergencia entre las dos no es ruido:
   * significa que un gate posterior al ranking rechazó a alguien ya contado, y
   * ése es exactamente el defecto que la corrida `be181d2d` dejó ver.
   */
  projectedTargetReached?: boolean;
};

/**
 * Ejecuta una corrida completa de dos rondas contra Apollo real y persiste los
 * candidatos en el lote ya reservado.
 *
 * `depsOverride` existe SÓLO para tests: la suite de integración lo usa para
 * atravesar esta misma función sin una llamada real ni un crédito gastado.
 * Producción nunca lo pasa.
 */
export async function runApolloTwoRoundWizardDiscovery(
  input: ApolloTwoRoundWizardRunInput,
  depsOverride?: Partial<ApolloTwoRoundProductionDeps>,
): Promise<ApolloTwoRoundWizardRunOutcome> {
  const deps: ApolloTwoRoundProductionDeps = {
    searchApollo: runApolloOrganizationsSearch,
    buildCandidate: buildProspectingPipelineCandidate,
    enrichCascade: runApolloOrganizationEnrichmentCascade,
    enrichOrganization: enrichApolloOrganization,
    persistCandidates: writeProspectingCandidates,
    logEnrichmentUsage: logApolloOrganizationEnrichmentUsage,
    loadEnrichmentUnitCostUsd: async () => {
      try {
        const pricing = await loadActiveApolloOrganizationEnrichmentPricing();
        return pricing?.unitCostUsd ?? null;
      } catch {
        return null;
      }
    },
    loadNegativeMemory: async (scope) => {
      const { tryGetAdminClientForTwoRound } = await import('./checkpoint.server');
      const client = tryGetAdminClientForTwoRound();
      if (!client) return emptyNegativeMemory(scope);
      return loadDiscoveryNegativeMemory(client, scope).catch(() =>
        emptyNegativeMemory(scope),
      );
    },
    loadCheckpoint: (batchId, identity) => readTwoRoundCheckpoint(batchId, identity),
    saveCheckpoint: (batchId, checkpoint) => writeTwoRoundCheckpoint(batchId, checkpoint),
    resolveConfig: () => resolveApolloTwoRoundConfigFromEnv().config,
    ...depsOverride,
  };

  const config = deps.resolveConfig();
  const budget = estimateApolloTwoRoundBudget(config);
  const runIdentity = {
    idempotencyKey: input.correlation.idempotencyKey,
    requestFingerprint: input.correlation.requestFingerprint,
  };

  const catalogContext = getCatalogContext({
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    searchDepth: 'standard',
  });

  // QUERY-QUALITY-2 § 2 / § 7 — mappings explícitos de las subindustrias elegidas.
  // Vacío cuando ninguna está en el catálogo: sin términos declarados no hay
  // contradicción que afirmar.
  //
  // MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 1 — antes era UNA mapping, la de la
  // primera subindustria con entrada, y con ella se juzgaba la contradicción de
  // todos los candidatos. Ese era el último gate de gasto FIRST-ONLY: con
  // `[A, B]` las señales positivas de A no podían desactivar una contradicción, y
  // permutar la solicitud podía cambiar el veredicto.
  const subindustryMappings = resolveAllApolloSubindustrySearchMappings(
    input.subindustries,
  ).map((resolved) => resolved.mapping);

  const negativeMemoryScope = {
    countryCode: input.countryCode,
    industryName: input.industry,
    subindustryNames: input.subindustries,
    lookbackDays: NEGATIVE_MEMORY_LOOKBACK_DAYS,
  };
  const negativeMemory = await deps
    .loadNegativeMemory(negativeMemoryScope)
    .catch(() => emptyNegativeMemory(negativeMemoryScope));

  // § 1 — sin pricing activo no se ejecuta ningún enrichment. Es la misma regla
  // que la ruta legacy aplica desde Q3F-5AU.16: mejor cero enrichments que una
  // fila con un costo inventado.
  const enrichmentUnitCostUsd = await deps.loadEnrichmentUnitCostUsd().catch(() => null);
  const enrichmentAllowed = enrichmentUnitCostUsd !== null;

  // § 5 — checkpoint del intento anterior, si lo hay y si es de ESTA corrida.
  const restored = await deps
    .loadCheckpoint(input.reservedBatchId, runIdentity)
    .catch(() => null);

  const warnings: string[] = [];
  let budgetAnomalyRaised = false;
  let checkpointVersion = restored?.checkpoint_version ?? 0;
  const checkpointFailures: string[] = [...(restored?.checkpoint_write_failures ?? [])];

  /**
   * CAS-CLOSE § 2 — el gasto de la corrida, DESGLOSADO por operación.
   *
   * Antes era un escalar acumulado, y un escalar no se puede fusionar: ante dos
   * checkpoints concurrentes, sumarlos duplica el gasto y quedarse con el mayor lo
   * esconde. Con la atribución por `operation_id` la unión es exacta — una
   * operación se cobró una vez, aparezca en uno o en los dos documentos.
   */
  const recordedCreditsByOperation = new Map<string, ApolloTwoRoundRecordedOperationCredit>();
  for (const entry of restored?.recorded_operation_credits ?? []) {
    recordedCreditsByOperation.set(entry.operation_id, { ...entry });
  }
  /**
   * Suelo de gasto heredado de un checkpoint SIN desglose (escrito antes de que
   * el desglose existiera).
   *
   * Sin él, un reintento sobre un checkpoint antiguo empezaría a contar desde cero
   * y el guard de presupuesto autorizaría llamadas que la reserva ya no sostiene.
   * Cero cuando el desglose sí está: ahí el detalle ya lo explica todo.
   */
  const inheritedCreditFloor =
    recordedCreditsByOperation.size === 0
      ? (restored?.spend_accounting.recorded_usage_credits ?? 0)
      : 0;

  const recordOperationCredits = (
    operationContext: ApolloTwoRoundOperationContext,
    observation: { credits: number; billingUnknown: boolean; usageKey: string | null },
  ): void => {
    const existing = recordedCreditsByOperation.get(operationContext.operationId) ?? null;
    // Una operación no se cobra dos veces: si ya está registrada, se conserva la
    // lectura más restrictiva (crédito mayor, y `billing_unknown` en cuanto
    // cualquiera de las dos observaciones lo levante).
    recordedCreditsByOperation.set(operationContext.operationId, {
      operation_id: operationContext.operationId,
      operation_key: operationContext.operationKey,
      round_number: operationContext.roundNumber,
      usage_key: observation.usageKey ?? existing?.usage_key ?? null,
      credits: Math.max(existing?.credits ?? 0, observation.credits),
      billing_unknown: (existing?.billing_unknown ?? false) || observation.billingUnknown,
    });
  };

  const recordedUsageCreditsNow = (): number =>
    inheritedCreditFloor + sumRecordedOperationCredits([...recordedCreditsByOperation.values()]);

  // Evidencia mínima por candidato: la del checkpoint más la que las rondas
  // vayan produciendo. Es lo único que se guarda del resultado del proveedor.
  const evidenceByKey = new Map<string, ApolloTwoRoundCandidateEvidenceSnapshot>();
  for (const snapshot of restored?.candidate_snapshots ?? []) {
    if (snapshot.evidence !== null) evidenceByKey.set(snapshot.candidate_key, snapshot.evidence);
  }
  // § 5 — la evidencia de las organizaciones pagadas y aún sin evaluar. Sin
  // sembrarla, un reintento en la ventana entre la búsqueda y su evaluación tendría
  // las organizaciones pero no con qué evaluarlas.
  for (const pending of restored?.pending_organizations ?? []) {
    const key = candidateKeyFor({
      providerOrganizationId: pending.provider_organization_id,
      name: pending.name,
      domain: pending.domain,
      linkedinUrl: pending.linkedin_url,
      providerRank: pending.provider_rank,
      declaredIndustry: pending.declared_industry,
    });
    if (!evidenceByKey.has(key)) evidenceByKey.set(key, pending.evidence);
  }

  /**
   * § 8 — resultado de las comprobaciones externas por candidato, cacheado.
   *
   * `buildProspectingPipelineCandidate` ejecuta la verificación HTTP del sitio y
   * la consulta de duplicados en SellUp/HubSpot. Ninguna de las dos depende del
   * perfil enriquecido: el enrichment sólo añade `metadata.apollo_profile`, y el
   * constructor de candidatos no lo lee. Repetirlas después de cada enrichment
   * era gasto de red sin cambio posible en el resultado.
   */
  type CandidateAssessmentCache = {
    candidate: ProspectingPipelineCandidate;
    duplicate: { sellUpDuplicate: boolean; hubSpotDuplicate: boolean };
    /** Dominio con el que se hicieron las comprobaciones dependientes de dominio. */
    checkedDomain: string | null;
  };
  const assessmentByKey = new Map<string, CandidateAssessmentCache>();
  const enrichmentSnapshots: ApolloTwoRoundEnrichmentSnapshot[] = [
    ...(restored?.enrichment_snapshots ?? []),
  ];
  const enrichmentStatusByKey = new Map<string, ApolloTwoRoundEnrichmentStatus>();
  for (const snapshot of enrichmentSnapshots) {
    enrichmentStatusByKey.set(snapshot.candidate_key, snapshot.status);
  }

  /**
   * HARDENING-1 §§ 3 y 4 — veredicto de subindustria por candidato, y clave de uso
   * del enrichment que lo produjo.
   *
   * El veredicto se recalcula tras el enrichment, así que el mapa siempre guarda
   * la evaluación MÁS reciente. La clave de uso es la procedencia: sin ella el
   * dato persistido no se puede atribuir a la operación que se pagó.
   */
  const subindustryPrecisionByKey = new Map<string, ApolloSubindustryPrecisionAssessment>();
  const enrichmentUsageKeyByCandidate = new Map<string, string>();

  const searchOutputs: WebSearchOutput[] = [];
  let persistedCandidateIds: string[] = [...(restored?.persisted_candidate_ids ?? [])];
  let candidatesPersisted = restored?.candidates_persisted === true;

  /**
   * § 2 — aserción defensiva de presupuesto.
   *
   * Se comprueba ANTES de autorizar cualquier operación adicional: pasada la
   * reserva, la corrida no emite ni una llamada más. No lanza, porque abortar
   * con excepción perdería los candidatos ya obtenidos y ya pagados.
   */
  const budgetExceeded = (): boolean => {
    const recorded = recordedUsageCreditsNow();
    if (recorded <= input.reservedCredits) return false;
    if (!budgetAnomalyRaised) {
      budgetAnomalyRaised = true;
      warnings.push(
        `${TWO_ROUND_BUDGET_ANOMALY}: recorded=${recorded} reserved=${input.reservedCredits}`,
      );
    }
    return true;
  };

  /**
   * § 3 / § 7 — proyecta el estado del orquestador al checkpoint durable y lo
   * escribe. Devuelve `false` si no quedó durable, y el orquestador degrada la
   * operación a indeterminada.
   */
  /**
   * CAS-CLOSE § 2 — último documento que se SABE durable.
   *
   * Cada intento se construye fusionado sobre él, así que una escritura nuestra
   * nunca puede borrar lo que un proceso concurrente ya consiguió persistir. Sin
   * este suelo, tras probar la durabilidad de una operación ajena la siguiente
   * escritura ganaría el CAS con un documento MÁS ESTRECHO que el almacenado.
   */
  let durableFloor: ApolloTwoRoundCheckpointV1 | null = restored;

  const noteCheckpointFailure = (
    reason: ApolloTwoRoundCheckpointReason,
    detailCode: string,
  ): void => {
    const detail = `${TWO_ROUND_CHECKPOINT_WARNING}:${reason}:${detailCode}`;
    checkpointFailures.push(detail);
    if (!warnings.includes(detail)) warnings.push(detail);
  };

  const buildAttempt = (
    snapshot: ApolloTwoRoundCheckpointSnapshot,
    overrides:
      | {
          reason?: ApolloTwoRoundCheckpointReason;
          candidatesPersisted?: boolean;
          persistedCandidateIds?: string[];
        }
      | undefined,
    version: number,
  ): ApolloTwoRoundCheckpointV1 => {
    const local = buildCheckpoint({
      reason: overrides?.reason ?? snapshot.reason,
      checkpointVersion: version,
      correlation: input.correlation,
      config,
      resume: snapshot.resume,
      evidenceByKey,
      enrichmentSnapshots,
      recordedOperationCredits: [...recordedCreditsByOperation.values()],
      candidatesPersisted: overrides?.candidatesPersisted ?? candidatesPersisted,
      persistedCandidateIds: overrides?.persistedCandidateIds ?? persistedCandidateIds,
      spendAccounting: buildApolloTwoRoundSpendAccounting({
        estimatedCredits: budget.maximumInternalRecordedCredits,
        reservedCredits: input.reservedCredits,
        recordedUsageCredits: recordedUsageCreditsNow(),
      }),
      checkpointWriteFailures: checkpointFailures,
    });
    if (durableFloor === null) return local;
    const merged = mergeApolloTwoRoundCheckpoints(durableFloor, local);
    // Una fusión rechazada aquí significaría que el suelo pertenece a otra corrida,
    // que es justo lo que `readCheckpoint` ya excluyó. Se escribe el documento
    // local antes que abandonar el estado de ESTA ejecución.
    if (merged.kind === 'refused') return local;
    return { ...merged.checkpoint, checkpoint_version: version };
  };

  /** Reabsorbe el gasto y los fallos que un documento ajeno ya declaraba. */
  const adoptDurableCheckpoint = (durable: ApolloTwoRoundCheckpointV1): void => {
    durableFloor = durable;
    checkpointVersion = Math.max(checkpointVersion, durable.checkpoint_version);
    // Misma regla de deduplicación que la fusión: una operación se cobró una vez.
    const reconciled = mergeRecordedOperationCredits(
      [...recordedCreditsByOperation.values()],
      durable.recorded_operation_credits,
    );
    recordedCreditsByOperation.clear();
    for (const entry of reconciled) recordedCreditsByOperation.set(entry.operation_id, entry);
    for (const failure of durable.checkpoint_write_failures) {
      if (!checkpointFailures.includes(failure)) checkpointFailures.push(failure);
    }
  };

  /**
   * CAS-CLOSE § 1 — qué hacer cuando otro proceso del mismo run ganó el CAS.
   *
   * `stale_rejected` NO prueba durabilidad por sí solo. Sólo se puede devolver
   * `true` si el checkpoint ganador contiene EXACTAMENTE esta operación: mismo
   * `operationId`, mismo estado, mismo resultado recuperable, misma identidad
   * económica y una versión superior.
   *
   * Si no la contiene, la opción A —refusionar sobre el ganador y reintentar el
   * CAS— es la preferida, porque la fusión de dos checkpoints del mismo run es
   * inequívoca. Cuando la fusión se rechaza (otra corrida, otra config) o el
   * documento durable no se puede leer, se cae a la opción B: `false`, que el
   * orquestador convierte en operación INDETERMINADA y detiene lo dependiente.
   *
   * Ninguna de las dos ramas vuelve a llamar a Apollo.
   */
  const resolveStaleRejection = async (
    attempted: ApolloTwoRoundCheckpointV1,
    snapshot: ApolloTwoRoundCheckpointSnapshot,
  ): Promise<boolean> => {
    let current = attempted;

    for (let attempt = 1; attempt <= MAX_STALE_RESOLUTION_ATTEMPTS; attempt++) {
      const durable = await deps
        .loadCheckpoint(input.reservedBatchId, runIdentity)
        .catch(() => null);
      if (durable === null) {
        // No se puede probar nada sobre un documento que no se puede leer.
        noteCheckpointFailure(current.checkpoint_reason, 'durable_checkpoint_unreadable');
        return false;
      }
      adoptDurableCheckpoint(durable);

      const operationContext = snapshot.operationContext;
      if (operationContext !== null) {
        const verdict = verifyDurableCheckpointContainsOperation(durable, current, {
          operationId: operationContext.operationId,
          operationKey: operationContext.operationKey,
          roundNumber: operationContext.roundNumber,
          expectedStatus:
            snapshot.reason === 'search_round_indeterminate' ||
            snapshot.reason === 'enrichment_indeterminate'
              ? 'indeterminate'
              : 'completed',
        });
        if (verdict.durable) {
          const note = `${TWO_ROUND_CONCURRENT_DURABILITY_SOURCE}:${operationContext.operationId}`;
          if (!warnings.includes(note)) warnings.push(note);
          return true;
        }
      }

      // Opción A — fusionar sobre el ganador y volver a intentar el CAS.
      const merged = mergeApolloTwoRoundCheckpoints(durable, current);
      if (merged.kind === 'refused') {
        noteCheckpointFailure(current.checkpoint_reason, `merge_refused_${merged.reason}`);
        return false;
      }
      current = {
        ...merged.checkpoint,
        checkpoint_version: durable.checkpoint_version + 1,
      };

      const retry = await deps
        .saveCheckpoint(input.reservedBatchId, current)
        .catch((err: unknown) => ({
          kind: 'failed' as const,
          reason: err instanceof Error ? err.message : 'checkpoint_write_threw',
        }));
      if (retry.kind === 'written') {
        checkpointVersion = retry.checkpointVersion;
        durableFloor = { ...current, checkpoint_version: retry.checkpointVersion };
        return true;
      }
      if (retry.kind === 'stale_rejected') continue;
      noteCheckpointFailure(current.checkpoint_reason, retry.kind);
      return false;
    }

    noteCheckpointFailure(current.checkpoint_reason, 'stale_resolution_retries_exhausted');
    return false;
  };

  const persistCheckpoint = async (
    snapshot: ApolloTwoRoundCheckpointSnapshot,
    overrides?: {
      reason?: ApolloTwoRoundCheckpointReason;
      candidatesPersisted?: boolean;
      persistedCandidateIds?: string[];
    },
  ): Promise<boolean> => {
    const checkpoint = buildAttempt(snapshot, overrides, checkpointVersion + 1);

    const outcome = await deps
      .saveCheckpoint(input.reservedBatchId, checkpoint)
      .catch((err: unknown) => ({
        kind: 'failed' as const,
        reason: err instanceof Error ? err.message : 'checkpoint_write_threw',
      }));

    if (outcome.kind === 'written') {
      checkpointVersion = outcome.checkpointVersion;
      durableFloor = { ...checkpoint, checkpoint_version: outcome.checkpointVersion };
      return true;
    }
    if (outcome.kind === 'stale_rejected') return resolveStaleRejection(checkpoint, snapshot);

    noteCheckpointFailure(checkpoint.checkpoint_reason, outcome.kind);
    return false;
  };

  /**
   * QUERY-QUALITY-2-FIX § 1 y § 2 — construcción ÚNICA del request de una ronda.
   *
   * `searchRound` la usa para ejecutar y `buildRoundProviderRequest` para comparar
   * sin ejecutar. Que las dos salgan de la MISMA llamada es lo que garantiza que la
   * huella con la que se decide sea la del body que saldría: una segunda
   * construcción en paralelo podría divergir en cuanto el mapper cambie.
   */
  const buildRoundSearchRequest = (
    hypothesis: ApolloTwoRoundQueryHypothesis,
    requestedResultLimit: number,
  ): {
    searchInput: WebSearchInput;
    searchOptions: ApolloOrgsSearchOptions;
    effective: ApolloEffectiveRequest;
  } => {
    const searchInput: WebSearchInput = {
      query: hypothesis.queryHypothesis,
      country: input.country,
      countryCode: input.countryCode,
      industry: input.industry,
      intent: 'company_discovery',
      maxResults: requestedResultLimit,
      provider: 'apollo_organizations',
      subindustries: input.subindustries,
      // CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM §§ 2 y 3 — la MISMA resolución para
      // todas las páginas y las dos rondas: se lee una vez por corrida, así que dos
      // llamadas de la misma corrida no pueden redactarse con dos versiones.
      subindustryCatalogTerms: input.subindustryCatalogTerms ?? null,
      selectionCatalogVersion: input.selectionCatalogVersion ?? null,
      additionalCriteriaTokens: hypothesis.queryParameters.keywordTags,
    };

    const searchOptions: ApolloOrgsSearchOptions = {
      // § 5 — la modalidad necesita ver a los candidatos con evidencia sectorial
      // insuficiente: son los únicos que pueden competir por un enrichment. El
      // gate se aplica después, candidato a candidato.
      sectorGateMode: 'annotate',
      // QUERY-QUALITY-2 § 5 — el límite de esta modalidad es el suyo. La variable
      // legacy `AGENT1_APOLLO_MAX_RESULTS_PER_QUERY` recortaba en silencio la ronda
      // a 3 y hacía inalcanzable el objetivo de cinco.
      resultLimitMode: 'two_round',
      twoRoundMaxResultsPerRound: config.maxResultsPerRound,
      // QUERY-QUALITY-2 § 3 — la ronda 2 puede pedir la página 2 de la misma
      // búsqueda cuando no hay variante de términos.
      startPage: hypothesis.queryParameters.page,
    };

    const effective = buildApolloOrganizationsEffectiveRequest({
      input: searchInput,
      requestedMaxResults: requestedResultLimit,
      resultLimitMode: searchOptions.resultLimitMode,
      twoRoundMaxResultsPerRound: searchOptions.twoRoundMaxResultsPerRound,
      startPage: searchOptions.startPage,
      legacyMaxResultsPerQuery: resolveApolloMaxResultsPerQuery(),
    });

    return { searchInput, searchOptions, effective };
  };

  // HARDENING-3 § 6 — la ruta de producción NO puede configurarse sin el constructor
  // del request efectivo: el tipo lo exige en compilación y la factory en runtime.
  const orchestratorDeps: ApolloTwoRoundProductionOrchestratorDeps =
    createApolloTwoRoundProductionOrchestratorDeps({
    // § 2 — el orquestador compara los bodies efectivos de las dos rondas sin
    // emitir una sola llamada: cero créditos, cero filas de uso.
    buildRoundProviderRequest: ({ hypothesis, requestedResultLimit }) => {
      const { effective } = buildRoundSearchRequest(hypothesis, requestedResultLimit);
      const coverage = effective.subindustryCoverage;
      return {
        effectiveRequestFingerprint: effective.effectiveRequestFingerprint,
        page: effective.page,
        perPage: effective.perPage,
        effectiveKeywordTags: effective.effectiveKeywordTags,
        // MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 §§ 6 y 7 — la cobertura del body
        // efectivo y su veredicto de gasto viajan con el preview: el orquestador
        // decide con ellos ANTES de emitir la búsqueda.
        subindustryCoverage: {
          requestedSubindustries: coverage.requestedSubindustries,
          coveredSubindustries: coverage.coveredSubindustries,
          uncoveredSubindustries: coverage.uncoveredSubindustries,
          coverageCount: coverage.coverageCount,
          coverageRatio: coverage.coverageRatio,
          effectiveKeywordsBySubindustry: coverage.effectiveKeywordsBySubindustry,
          complete: coverage.complete,
        },
        subindustryCoverageBlockReason:
          effective.subindustryCoverageSpendGate.blockReason,
      };
    },

    searchRound: async ({ hypothesis, requestedResultLimit, operationContext }) => {
      if (budgetExceeded()) {
        return { organizations: [], providerRequestCount: 0, internalRecordedCredits: 0 };
      }

      const { searchInput, searchOptions } = buildRoundSearchRequest(
        hypothesis,
        requestedResultLimit,
      );

      const output = await deps.searchApollo(
        searchInput,
        requestedResultLimit,
        {
          batchId: input.reservedBatchId,
          triggeredByUserId: input.triggeredByUserId,
          // El enrichment lo gobierna el orquestador bajo su cap GLOBAL de dos.
          // Dejar que el cascade del provider gaste por su cuenta reabriría
          // exactamente el descuadre que este hito cierra.
          remainingEnrichmentBudget: 0,
          runCorrelation: (input.runCorrelationMetadata ?? null) as never,
          // § 2 — ronda, sujeto y operación llegan hasta la fila económica de la
          // búsqueda, y hasta su `usage_key`.
          operationContext: toApolloTwoRoundOperationContextMetadata(operationContext),
        },
        undefined,
        searchOptions,
      );
      searchOutputs.push(output);

      const credits = readRecordedSearchCredits(output);
      // § 2 CAS-CLOSE — el gasto se atribuye a ESTA operación. Los créditos que el
      // ledger registró se conservan incluso si el desenlace quedó indeterminado:
      // la búsqueda pudo haberse cobrado, y descontarlos escondería ese gasto.
      recordOperationCredits(operationContext, {
        credits,
        billingUnknown: readSearchIndeterminacy(output),
        usageKey: null,
      });

      const organizations = output.results.map((result, index) => {
        const organization = toRawDiscoveredOrganization(result, index + 1);
        const key = candidateKeyFor(organization);
        evidenceByKey.set(key, toCandidateEvidenceSnapshot(result));
        return organization;
      });

      return {
        organizations,
        providerRequestCount: output.skipped ? 0 : 1,
        internalRecordedCredits: credits,
        indeterminate: readSearchIndeterminacy(output),
        // § 3 — lo que el proveedor DECLARÓ, no lo que nos convenga suponer.
        providerTotalPages: readProviderTotalPages(output),
      };
    },

    assessCandidate: async ({ organization, identity }) => {
      const key = candidateKeyFor(organization);
      const result = readEvidenceResult(evidenceByKey, key);
      if (!result) {
        // Sin el resultado original no hay evidencia que evaluar. Se rechaza,
        // nunca se acepta a ciegas.
        return buildRejectedAssessment('invalid_domain', organization);
      }

      // 3-9. Gates baratos reales: país, dominio, TLD, correo, ownership,
      // plataforma externa, cooldown e historial. Cero llamadas, cero créditos.
      // ADDENDUM § 2 — el gate de gasto evalúa las CINCO selecciones con ANY-OF.
      const eligibility = evaluateApolloEnrichmentEligibility(result, {
        targetCountryCode: input.countryCode,
        sector: input.industry,
        subindustries: input.subindustries,
        domainsInCooldown: negativeMemory.excludedDomains,
      });

      const sector = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
        result,
        input.industry,
        input.subindustries,
      );
      // QUERY-QUALITY-2 § 7 — contradicción visible en campos GRATUITOS. El QA
      // gastó su único enrichment en Citigroup buscando supermercados: la
      // industria declarada ya decía «retail banking» antes de pagar nada.
      // MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 1 — ANY-OF: basta que UNA
      // subindustria pedida no resulte contradicha. El cap de enrichments y de
      // créditos no se mueve; cambia quién compite, no cuántos se pagan.
      const contradiction = evaluateApolloFreeSectorContradictionAnyOf(
        readFreeSectorEvidence(result, organization),
        subindustryMappings,
      );
      // HARDENING-1 § 3 — la precisión de subindustria se evalúa con las señales
      // GRATUITAS de la búsqueda, antes de cualquier gasto, y degrada el veredicto
      // sectorial cuando la evidencia no demuestra la subindustria pedida.
      // AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 2 — ANY-OF sobre TODAS
      // las subindustrias pedidas, no sólo `subindustries[0]`. La búsqueda Apollo
      // ya las consulta con esa semántica; evaluar sólo la primera descartaba de
      // la cuenta a una empresa que demostraba la segunda selección del usuario.
      const precision = assessApolloSubindustryPrecisionForRequest(result, input.subindustries);
      subindustryPrecisionByKey.set(key, precision);
      const sectorEvidenceState: CandidateSectorEvidenceState = contradiction.contradictory
        ? 'sector_evidence_contradictory'
        : foldSubindustryPrecisionIntoSectorState(
            toSectorEvidenceState(sector.decision),
            precision,
          );

      // 10-11. Duplicado en SellUp y en HubSpot — una sola consulta por
      // organización, la misma que el pipeline de producción ya hace, y cacheada
      // para que el enrichment no la repita (§ 8).
      const built = await deps.buildCandidate(result, {
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        catalogContext,
        provider: 'apollo_organizations',
        fallbackQueryText: input.industry,
      });
      const duplicate = readDuplicateVerdict(built.candidate);
      assessmentByKey.set(key, {
        candidate: built.candidate,
        duplicate,
        checkedDomain: identity.normalizedDomain,
      });

      const cooldownActive =
        identity.normalizedDomain !== null &&
        negativeMemory.excludedDomains.has(identity.normalizedDomain);
      const knownDuplicate = duplicate.sellUpDuplicate || duplicate.hubSpotDuplicate;

      const signals: CheapAssessment['signals'] = {
        countryCompatible: eligibility.eligible || eligibility.skipReason !== 'country_mismatch',
        domainConfident: identity.normalizedDomain !== null,
        ownershipConfident: eligibility.eligible && eligibility.domainSource === 'asserted',
        sectorKeywordMatchCount: sector.matchedTerms.length,
        novel: !knownDuplicate && !cooldownActive,
        hasCompanySizeSignal: readHasEmployeeCount(result),
        hasLocationSignal: readHasLocation(result),
        hasLinkedInUrl: identity.normalizedLinkedInUrl !== null,
        freeOfContradictoryEvidence: sectorEvidenceState !== 'sector_evidence_contradictory',
        knownDuplicate,
        cooldownActive,
        // § 7 — viaja al ranking: un candidato contradicho no compite por un
        // enrichment ni aunque el resto de sus señales sea impecable.
        declaredSectorContradiction: contradiction.contradictory,
      };

      // Orden del § 4: primero los gates del proveedor, después los duplicados
      // conocidos, y sólo al final el veredicto sectorial. Un duplicado nunca
      // llega a competir por un enrichment.
      let rejection: CheapRejectionReason | null = null;
      if (!eligibility.eligible) {
        rejection = toCheapRejectionReason(eligibility.skipReason);
      } else if (duplicate.sellUpDuplicate) {
        rejection = 'duplicate_in_sellup';
      } else if (duplicate.hubSpotDuplicate) {
        rejection = 'duplicate_in_hubspot';
      } else if (cooldownActive) {
        rejection = 'cooldown_or_prior_suggestion';
      } else if (sectorEvidenceState === 'sector_not_mapped') {
        rejection = 'sector_not_mapped';
      } else if (sectorEvidenceState === 'sector_evidence_contradictory') {
        rejection = 'sector_evidence_contradictory';
      }

      return {
        rejection,
        sectorEvidenceState,
        signals,
        noPriorSuggestion: !cooldownActive,
      };
    },

    enrichCandidate: async ({ candidateKey, identity, operationContext }) => {
      const notExecuted: EnrichmentResult = {
        executed: false,
        sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
        internalRecordedCredits: 0,
      };
      // Sin pricing activo el enrichment no se ejecuta. Sin presupuesto tampoco.
      if (!enrichmentAllowed || budgetExceeded()) return notExecuted;

      const result = readEvidenceResult(evidenceByKey, candidateKey);
      if (!result || identity.normalizedDomain === null) return notExecuted;

      // § 1 — el transporte se instrumenta para poder CLASIFICAR el desenlace del
      // cobro en vez de deducirlo de un mensaje de error.
      let observedOutcome: ApolloEnrichmentBillingOutcome | null = null;
      const instrumentedEnrichOrg: typeof enrichApolloOrganization = async (params) => {
        try {
          const enrichResult = await deps.enrichOrganization(params);
          observedOutcome = classifyApolloEnrichmentBillingOutcome({
            success: enrichResult.success === true,
            matched: enrichResult.success === true && enrichResult.data !== undefined,
            statusCode: enrichResult.error?.statusCode ?? null,
          });
          return enrichResult;
        } catch (err) {
          observedOutcome = classifyApolloEnrichmentBillingOutcome({ threw: true });
          throw err;
        }
      };

      // Un solo enrichment: la lista que se le pasa al cascade tiene UN
      // elemento y el cap es 1. El presupuesto global lo gobierna el
      // orquestador, no este cap por llamada.
      const cascade = await deps.enrichCascade(
        [result],
        1,
        { enrichOrg: instrumentedEnrichOrg },
        {
          eligibility: {
            targetCountryCode: input.countryCode,
            sector: input.industry,
            // ADDENDUM § 2 — mismo contrato ANY-OF que el gate previo. Si aquí
            // volviera a viajar una sola, el cascade rechazaría antes de pagar a
            // candidatos que el gate anterior ya había admitido.
            subindustries: input.subindustries,
          },
        },
      );

      const entry = cascade.meta.entries[0];
      // Misma regla que la ruta legacy: una llamada REAL ocurrió si la entrada
      // quedó enriquecida o si falló después de haber salido. Un `cap_reached`,
      // un `missing_domain` o un `eligibility_blocked` no gastaron nada, así que
      // no generan fila económica.
      if (entry === undefined || !(entry.enriched === true || entry.skip_reason === 'enrichment_failed')) {
        return notExecuted;
      }

      const outcome: ApolloEnrichmentBillingOutcome =
        observedOutcome ?? classifyApolloEnrichmentOutcomeFromCascadeEntry(entry);
      const accounting = resolveApolloEnrichmentUsageAccounting(outcome);

      // § 1 — UNA fila por enrichment, siempre, con la correlación completa y el
      // contexto de la operación. Se escribe ANTES del checkpoint (§ 3) y nunca
      // vuelve a llamar a Apollo para poder escribirse.
      const usageKey = buildApolloEnrichmentUsageKey({
        batchId: input.reservedBatchId,
        domain: identity.normalizedDomain,
        operationId: operationContext.operationId,
        fallbackTimestampMs: 0,
      });
      const logResult = await deps
        .logEnrichmentUsage({
          usageKey,
          batchId: input.reservedBatchId,
          triggeredByUserId: input.triggeredByUserId,
          domain: identity.normalizedDomain,
          fieldsAdded: entry.fields_added ?? [],
          cascadeVersion: cascade.meta.cascade_version,
          unitCostUsd: enrichmentUnitCostUsd,
          errorMessage: entry.error ?? null,
          runCorrelation: (input.runCorrelationMetadata ?? null) as never,
          operationContext: toApolloTwoRoundOperationContextMetadata(operationContext),
          stampOperationBillingState: true,
          // § 5 CAS-CLOSE — esta fila se escribió con el criterio de dos rondas,
          // que clasifica el cobro por el desenlace observado. La ruta legacy
          // conserva el suyo.
          billingContract: APOLLO_TWO_ROUND_BILLING_CONTRACT,
          accounting,
        })
        .catch(() => ({ kind: 'failed' as const, error: 'enrichment_usage_log_threw' }));
      if (logResult.kind === 'failed') {
        warnings.push('two_round_enrichment_usage_log_failed');
      }

      const credits = accounting.creditsUsed ?? 0;
      recordOperationCredits(operationContext, {
        credits,
        billingUnknown: accounting.billingState === 'unknown',
        usageKey,
      });

      if (outcome === 'indeterminate') {
        recordEnrichmentSnapshot({
          enrichmentSnapshots,
          enrichmentStatusByKey,
          candidateKey,
          operationContext,
          status: 'indeterminate',
          recordedCredits: null,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
        });
        return {
          executed: false,
          sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
          internalRecordedCredits: 0,
          indeterminate: true,
        };
      }

      const enrichedResult = cascade.results[0] ?? result;
      if (entry.enriched === true) {
        evidenceByKey.set(candidateKey, toCandidateEvidenceSnapshot(enrichedResult));
        // § 8 — las comprobaciones dependientes de dominio SÓLO se repiten si el
        // dominio cambió materialmente. Si no cambió, el candidato reconstruido
        // sería idéntico: el constructor no lee `metadata.apollo_profile`, que es
        // lo único que el enrichment toca.
        const cached = assessmentByKey.get(candidateKey) ?? null;
        const enrichedDomain = readEvidenceDomain(enrichedResult);
        const domainChanged =
          cached === null || (enrichedDomain !== null && enrichedDomain !== cached.checkedDomain);
        if (domainChanged) {
          const rebuilt = await deps.buildCandidate(enrichedResult, {
            country: input.country,
            countryCode: input.countryCode,
            industry: input.industry,
            catalogContext,
            provider: 'apollo_organizations',
            fallbackQueryText: input.industry,
          });
          assessmentByKey.set(candidateKey, {
            candidate: rebuilt.candidate,
            duplicate: readDuplicateVerdict(rebuilt.candidate),
            checkedDomain: enrichedDomain,
          });
        } else {
          // A1-APOLLO-LINKEDIN-EMPLOYEES-1 — el dominio no cambió, así que las
          // comprobaciones caras siguen siendo válidas y no se repiten. Pero el
          // enrichment SÍ pudo aportar el número de empleados o el LinkedIn, y
          // eso ya no vive sólo en `apollo_profile`: viaja en el candidato. Sin
          // esta re-captura, el crédito pagado por `organization_enrichment` se
          // registraría y su dato se perdería.
          const cachedAssessment = assessmentByKey.get(candidateKey);
          if (cachedAssessment) {
            assessmentByKey.set(candidateKey, {
              ...cachedAssessment,
              candidate: withRecapturedProviderCompanyFields(
                cachedAssessment.candidate,
                enrichedResult,
              ),
            });
          }
        }
      }

      // Recalcular el veredicto sectorial es GRATIS y puro: es la única señal que
      // el enrichment podía mover.
      // ADDENDUM § 2 — misma semántica ANY-OF que antes del gasto. Reevaluar el
      // perfil comprado contra una sola subindustria podría degradar a un
      // candidato que el enrichment acababa de confirmar para otra de las pedidas.
      const sector = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
        enrichedResult,
        input.industry,
        input.subindustries,
      );
      // § 5 — la reevaluación posterior al enrichment vuelve a pasar por la
      // precisión de subindustria. Un perfil enriquecido puede confirmar la
      // subindustria, seguir sin demostrarla o revelar un modelo de negocio que la
      // excluye; los tres desenlaces tienen cubeta propia en las métricas.
      // § 2 — misma semántica ANY-OF que en la evaluación previa al gasto.
      const enrichedPrecision = assessApolloSubindustryPrecisionForRequest(
        enrichedResult,
        input.subindustries,
      );
      subindustryPrecisionByKey.set(candidateKey, enrichedPrecision);
      enrichmentUsageKeyByCandidate.set(candidateKey, usageKey);
      const sectorEvidenceState = foldSubindustryPrecisionIntoSectorState(
        toSectorEvidenceState(sector.decision),
        enrichedPrecision,
      );

      // § 8 — un duplicado que sólo se pudo ver con el dominio recuperado por el
      // enrichment sí es un rechazo post-enrichment legítimo.
      const refreshed = assessmentByKey.get(candidateKey) ?? null;
      const postEnrichmentRejection: CheapRejectionReason | null =
        refreshed?.duplicate.sellUpDuplicate === true
          ? 'duplicate_in_sellup'
          : refreshed?.duplicate.hubSpotDuplicate === true
            ? 'duplicate_in_hubspot'
            : null;

      recordEnrichmentSnapshot({
        enrichmentSnapshots,
        enrichmentStatusByKey,
        candidateKey,
        operationContext,
        status: outcome === 'charged' ? 'executed' : 'no_match',
        recordedCredits: credits,
        sectorEvidenceState,
      });

      return {
        executed: outcome === 'charged',
        sectorEvidenceState,
        internalRecordedCredits: credits,
        ...(postEnrichmentRejection !== null ? { postEnrichmentRejection } : {}),
        ...(outcome === 'no_match' ? { noMatch: true } : {}),
      };
    },

    /**
     * HARDENING-1 § 5 — ownership como gate FINAL, con el candidato ya construido
     * y el perfil ya enriquecido.
     *
     * Es literalmente la misma función que aplica el writer
     * (`evaluateCompanyOwnership` + `isBlockedByCompanyOwnership`), invocada aquí
     * para que su veredicto llegue ANTES de contar elegibles y no después de
     * publicarlos. En la corrida `be181d2d` el writer descartó por ownership a una
     * empresa que el orquestador ya había contado: `run_metrics` dijo 3 y la base
     * tuvo 2. Con el gate aquí, esa empresa no llega a contarse.
     *
     * Cero llamadas al proveedor y cero créditos: sólo compara el nombre con el
     * dominio que ya tenemos.
     *
     * Fail-open deliberado ante la AUSENCIA del candidato: si no hay nada que
     * evaluar no se inventa un rechazo. El writer sigue siendo la última palabra,
     * así que un hueco aquí degrada la métrica, no la corrección.
     */
    applyFinalGates: ({ candidateKey }) => {
      const cached = assessmentByKey.get(candidateKey) ?? null;
      if (cached === null) return { rejection: null };
      const ownership = evaluateCompanyOwnership(
        cached.candidate.name,
        cached.candidate.website ?? null,
        cached.candidate.domain ?? null,
      );
      return {
        rejection: isBlockedByCompanyOwnership(ownership) ? 'ownership_mismatch' : null,
      };
    },

    saveCheckpoint: (snapshot) => persistCheckpoint(snapshot),
  });

  const runResult: ApolloTwoRoundRunResult = await runApolloTwoRoundDiscovery(
    {
      config,
      queryContext: {
        country: input.country,
        countryCode: input.countryCode,
        sector: input.industry,
        // § 1 — TODAS las subindustrias pedidas llegan a la redacción de la
        // consulta, en el orden de la solicitud.
        subindustries: input.subindustries,
      },
      correlation: input.correlation,
      resume: restored ? toResumeStateFromCheckpoint(restored) : null,
    },
    orchestratorDeps,
  );

  // ── Persistencia ────────────────────────────────────────────────────────────
  //
  // § 5 — `candidates_persisted` se LEE. Un reintento posterior a la escritura no
  // vuelve a escribir NI reconstruye nada: devuelve lo que ya se persistió. Antes
  // el campo se guardaba y nadie lo consultaba, así que un reintento reescribía
  // candidatos que ya existían.
  //
  // Cuando NO se han persistido, los candidatos se resuelven de la caché de esta
  // ejecución y, para los que vengan de un checkpoint anterior, se reconstruyen
  // desde su evidencia mínima. Reconstruir cuesta la verificación del sitio y la
  // consulta de duplicados —ambas gratuitas en créditos de proveedor— y es lo que
  // permite no repetir la búsqueda, que sí cuesta.
  /**
   * HARDENING-1 § 4 — baja a campos persistibles lo que la corrida COMPRÓ.
   *
   * La evidencia de `evidenceByKey` se sustituye por la enriquecida en cuanto un
   * enrichment tiene éxito, así que aquí se lee el perfil final. La operación de
   * procedencia se declara según lo que realmente ocurrió con ESE candidato: un
   * enrichment ejecutado o sólo la búsqueda. Atribuir a `organization_enrichment`
   * un dato que trajo la búsqueda falsearía la procedencia de algo que nadie pagó.
   */
  const buildEnrichmentCapture = (
    candidateKey: string,
  ): ProspectingPipelineCandidate['providerEnrichmentCapture'] => {
    const evidence = readEvidenceResult(evidenceByKey, candidateKey);
    if (evidence === null) return null;
    const precision =
      subindustryPrecisionByKey.get(candidateKey) ??
      // § 2 — el respaldo (candidato restaurado de un checkpoint anterior) usa el
      // MISMO evaluador ANY-OF: si aquí quedara `subindustries[0]`, un reintento
      // reintroduciría por la puerta de atrás el defecto que este § cierra.
      assessApolloSubindustryPrecisionForRequest(evidence, input.subindustries);
    const enriched = enrichmentStatusByKey.get(candidateKey) === 'executed';
    return captureApolloEnrichmentForPersistence({
      result: evidence,
      precision,
      provenance: {
        sourceProvider: 'apollo',
        sourceOperation: enriched ? 'organization_enrichment' : 'organizations_search',
        sourceRequestId: enrichmentUsageKeyByCandidate.get(candidateKey) ?? null,
        observedAt: new Date().toISOString(),
      },
    });
  };

  const resolvePersistableCandidates = async (): Promise<ProspectingPipelineCandidate[]> => {
    const resolved: ProspectingPipelineCandidate[] = [];
    // AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 § D — las ambiguas viajan al
    // writer JUNTO a las completas. El writer ya sabe distinguirlas: su contrato
    // de completitud las degrada a `needs_review` y las deja fuera de
    // `target_count`. Lo que faltaba era que llegaran.
    //
    // El orden importa: las completas primero, para que el tope de escritura del
    // writer —si alguno aplica— nunca sacrifique una empresa válida por una que
    // sólo va a revisión.
    for (const entry of [...runResult.persisted, ...runResult.reviewOnly]) {
      const capture = buildEnrichmentCapture(entry.candidateKey);
      const cached = assessmentByKey.get(entry.candidateKey);
      if (cached) {
        // El veredicto sectorial de la modalidad viaja con el candidato: es lo
        // que permite al writer distinguir `subindustry_match = confirmed` de
        // «nadie lo evaluó», sin volver a llamar al gate ni al proveedor.
        resolved.push({
          ...cached.candidate,
          sectorEvidenceState: entry.sectorEvidenceState,
          providerEnrichmentCapture: capture,
        });
        continue;
      }
      const evidence = readEvidenceResult(evidenceByKey, entry.candidateKey);
      if (evidence === null) continue;
      const rebuilt = await deps.buildCandidate(evidence, {
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        catalogContext,
        provider: 'apollo_organizations',
        fallbackQueryText: input.industry,
        sectorEvidenceState: entry.sectorEvidenceState,
      });
      assessmentByKey.set(entry.candidateKey, {
        candidate: rebuilt.candidate,
        duplicate: readDuplicateVerdict(rebuilt.candidate),
        checkedDomain: entry.identity.normalizedDomain,
      });
      resolved.push({ ...rebuilt.candidate, providerEnrichmentCapture: capture });
    }
    return resolved;
  };

  // CAS-CLOSE § 1 — otro proceso del MISMO run pudo persistir los candidatos
  // mientras esta ejecución corría. El suelo durable lo dice, y volver a escribir
  // los duplicaría en un lote que ya los tiene.
  if (!candidatesPersisted && durableFloor?.candidates_persisted === true) {
    candidatesPersisted = true;
    persistedCandidateIds = [...durableFloor.persisted_candidate_ids];
  }

  const persistableCandidates: ProspectingPipelineCandidate[] = candidatesPersisted
    ? []
    : await resolvePersistableCandidates();

  const observability = buildObservabilityMetadata({
    runResult,
    budget,
    reservedCredits: input.reservedCredits,
    recordedUsageCredits: recordedUsageCreditsNow(),
    budgetAnomalyRaised,
    checkpointFailures,
    candidatesPersisted,
    // MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § A — lo que la corrida RECIBIÓ,
    // escrito junto a lo que hizo. La forense de `7d92773b` tuvo que deducir de
    // las keywords que la solicitud sólo traía una subindustria; con esto la
    // pregunta «¿llegaron las dos?» se responde leyendo el lote.
    requestedSubindustries: input.subindustries,
    // CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 9 — y CONTRA QUÉ catálogo se redactó.
    catalogTerms: input.subindustryCatalogTerms ?? null,
    selectionCatalogVersion: input.selectionCatalogVersion ?? null,
  });

  let candidatesCreated = persistedCandidateIds.length;
  // A1-APOLLO-PERSISTENCE-READINESS-4 § 7 — resultado real de la escritura, que
  // el wizard necesita para no anunciar un fallo de almacenamiento como un vacío
  // normal. `undefined` cuando este intento no escribió (los candidatos ya
  // estaban persistidos por un intento anterior del MISMO run).
  let persistenceOutcome: CandidatePersistenceOutcome | undefined;

  if (!candidatesPersisted) {
    const pipelineOutput: ProspectingPipelineOutput = {
      input: {
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        webSearchProvider: 'apollo_organizations',
        mode: 'multi_query',
        targetCount: config.targetEligibleCompanies,
        maxResultsPerQuery: config.maxResultsPerRound,
        subindustries: input.subindustries,
      },
      catalogContext,
      searchQuery: runResult.rounds[0]?.queryHypothesis ?? input.industry,
      webSearch: mergeSearchOutputs(searchOutputs, input.industry),
      candidates: persistableCandidates,
      summary: buildSummary(
        config.targetEligibleCompanies,
        runResult.runMetrics.totalRawResults,
        persistableCandidates,
      ),
      warnings,
      metadata: {
        pipelineVersion: 'apollo-two-round-1',
        provider: 'apollo_organizations',
        search_mode: 'apollo_two_round_adaptive',
        ...observability,
      },
    };

    const writerResult = await deps.persistCandidates({
      pipelineOutput,
      triggeredByUserId: input.triggeredByUserId,
      ownerId: input.ownerId,
      source: 'agent_1',
      dryRun: false,
      existingBatchId: input.reservedBatchId,
      extraBatchMetadata: {
        ...(input.extraBatchMetadata ?? {}),
        apollo_discovery_modality: 'two_round_adaptive',
        ...observability,
      },
    });

    candidatesCreated = writerResult.candidatesCreated;
    persistedCandidateIds = writerResult.createdCandidateIds ?? [];
    persistenceOutcome = writerResult.persistence;
    candidatesPersisted = true;

    // § 3 — el checkpoint final se escribe DESPUÉS del writer y RELEYENDO el
    // documento, así que conserva la metadata que el writer acaba de dejar.
    await persistCheckpoint(
      {
        reason: 'run_completed',
        resume: toApolloTwoRoundResumeState(runResult),
        operationContext: null,
      },
      { reason: 'candidates_persisted', candidatesPersisted: true, persistedCandidateIds },
    );
  }

  const budgetAnomalies = [
    ...(budgetAnomalyRaised ? [TWO_ROUND_BUDGET_ANOMALY] : []),
    ...(runResult.manualReconciliationRequired ? [TWO_ROUND_INDETERMINATE_ANOMALY] : []),
  ];

  return {
    input: {
      country: input.country,
      countryCode: input.countryCode,
      industry: input.industry,
      subindustries: input.subindustries,
      additionalCriteria: input.additionalCriteria,
      webSearchProvider: 'apollo_organizations',
      targetInternal: config.targetEligibleCompanies,
      maxRounds: config.maxRounds,
      targetPersistibleCandidates: config.targetEligibleCompanies,
      existingBatchId: input.reservedBatchId,
      triggeredByUserId: input.triggeredByUserId,
      ownerId: input.ownerId,
      dryRun: false,
    } as IncrementalSearchOutput['input'],
    candidates: persistableCandidates,
    // Un reintento posterior a la escritura reporta lo que ya está en la base, no
    // una lista vacía: los candidatos existen, sólo no se reconstruyeron.
    candidatesCount: candidatesPersisted
      ? Math.max(persistableCandidates.length, persistedCandidateIds.length)
      : persistableCandidates.length,
    usefulCandidatesCount: candidatesPersisted
      ? Math.max(persistableCandidates.length, persistedCandidateIds.length)
      : persistableCandidates.length,
    candidatesCreated,
    metadata: {
      ...observability,
    } as unknown as IncrementalSearchOutput['metadata'],
    warnings,
    batchId: input.reservedBatchId,
    // HARDENING-1 § 1 — `targetReached` deja de significar «el orquestador acumuló
    // N elegibles» y pasa a significar «hay N candidatos válidos en la base». Es
    // la misma regla que aplica el writer sobre la metadata del lote, y aquí se
    // aplica sobre lo que el wizard va a leer.
    //
    // `candidatesCreated` es el recuento del writer cuando esta ejecución escribió,
    // y el tamaño de `persisted_candidate_ids` cuando los candidatos ya estaban
    // escritos por un intento anterior del mismo run. En los dos casos son filas,
    // nunca la proyección del ranking.
    targetReached:
      config.targetEligibleCompanies > 0 &&
      candidatesCreated >= config.targetEligibleCompanies,
    projectedTargetReached: runResult.targetReached,
    targetPersistibleCandidates: config.targetEligibleCompanies,
    ...(budgetAnomalies.length > 0 ? { budgetAnomalies } : {}),
    ...(persistenceOutcome ? { persistenceOutcome } : {}),
  };
}

// ─── Observabilidad ───────────────────────────────────────────────────────────

/**
 * § 9 — la contabilidad de gasto sale del constructor único de `budget.ts`, no de
 * un objeto literal armado aquí. Había dos implementaciones de las mismas cuatro
 * cantidades y sólo una estaba testeada.
 */
/**
 * MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 6 — cobertura de la CORRIDA.
 *
 * Es la UNIÓN de lo que cubrió cada ronda, porque el § 3 admite distribuciones en
 * las que la cobertura global se completa entre las dos. Lo que NO se admite es
 * que una subindustria pedida no aparezca en ninguna: eso es `uncovered`, y el
 * gate del § 7 lo bloquea antes de gastar.
 *
 * Se deriva de las rondas —de lo que realmente salió— y nunca de la solicitud: una
 * corrida bloqueada reporta `covered = 0`, no `covered = requested`.
 */
function buildRunSubindustryCoverageMetadata(
  runResult: ApolloTwoRoundRunResult,
  requestedSubindustries: readonly string[],
): Record<string, unknown> {
  const covered: string[] = [];
  const effectiveKeywordsBySubindustry: Record<string, string[]> = {};

  for (const round of runResult.rounds) {
    const coverage = round.subindustryCoverage;
    if (!coverage) continue;
    for (const subindustry of coverage.coveredSubindustries) {
      if (!covered.includes(subindustry)) covered.push(subindustry);
    }
    for (const [subindustry, keywords] of Object.entries(
      coverage.effectiveKeywordsBySubindustry,
    )) {
      const bucket = (effectiveKeywordsBySubindustry[subindustry] ??= []);
      for (const keyword of keywords) {
        if (!bucket.includes(keyword)) bucket.push(keyword);
      }
    }
  }

  const requested = [...requestedSubindustries];
  const coveredInRequestOrder = requested.filter((subindustry) => covered.includes(subindustry));
  const uncovered = requested.filter((subindustry) => !covered.includes(subindustry));

  return toApolloSubindustryQueryCoverageMetadata({
    requestedSubindustries: requested,
    coveredSubindustries: coveredInRequestOrder,
    uncoveredSubindustries: uncovered,
    coverageCount: coveredInRequestOrder.length,
    coverageRatio: requested.length === 0 ? 1 : coveredInRequestOrder.length / requested.length,
    effectiveKeywordsBySubindustry,
    unattributedEffectiveKeywords: [],
    complete: uncovered.length === 0,
  });
}

function buildObservabilityMetadata(input: {
  runResult: ApolloTwoRoundRunResult;
  budget: ReturnType<typeof estimateApolloTwoRoundBudget>;
  reservedCredits: number;
  recordedUsageCredits: number;
  budgetAnomalyRaised: boolean;
  checkpointFailures: readonly string[];
  candidatesPersisted: boolean;
  /** § A — subindustrias que la SOLICITUD trajo, en su orden. Ausente ⇒ []. */
  requestedSubindustries?: readonly string[];
  /**
   * CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 9 — la resolución de términos con la que
   * se redactaron TODAS las consultas de esta corrida. Ausente ⇒ se declara como no
   * resuelta, que es un hecho de la corrida y no un campo que falte.
   */
  catalogTerms?: ApolloSubindustryCatalogTermsResolution | null;
  /** § 3 — versión con la que se resolvió la selección del usuario. */
  selectionCatalogVersion?: string | null;
}): Record<string, unknown> {
  const { runResult } = input;
  const requestedSubindustries = [...(input.requestedSubindustries ?? [])];
  const accounting = buildApolloTwoRoundSpendAccounting({
    estimatedCredits: input.budget.maximumInternalRecordedCredits,
    reservedCredits: input.reservedCredits,
    recordedUsageCredits: input.recordedUsageCredits,
  });

  const anomalies = [
    ...(input.budgetAnomalyRaised ? [TWO_ROUND_BUDGET_ANOMALY] : []),
    ...(runResult.manualReconciliationRequired ? [TWO_ROUND_INDETERMINATE_ANOMALY] : []),
  ];

  // § D — se evalúa sobre el estado FINAL de la corrida (los candidatos tal como
  // el checkpoint `run_completed` los va a guardar), nunca sobre uno intermedio.
  const finalStateConsistency = evaluateApolloTwoRoundFinalStateConsistency({
    rounds: runResult.rounds,
    candidates: toApolloTwoRoundResumeState(runResult).candidates.map((candidate) => ({
      candidate_key: candidate.candidateKey,
      eligible: candidate.eligible,
      finally_rejected_or_duplicated: candidate.finallyRejectedOrDuplicated,
    })),
    runMetrics: {
      totalUniqueOrganizations: runResult.runMetrics.totalUniqueOrganizations,
      totalEligibleCompanies: runResult.runMetrics.totalEligibleCompanies,
      persistedCandidates: runResult.runMetrics.persistedCandidates,
    },
    targetEligibleCompanies: runResult.targetEligibleCompanies,
    targetReached: runResult.targetReached,
  });

  return {
    [APOLLO_TWO_ROUND_OBSERVABILITY_KEY]: {
      modality: 'two_round_adaptive',
      // § A — la SOLICITUD, tal cual llegó. `requested_subindustries_count` va
      // aparte porque es lo que se compara contra la selección de la UI de un
      // vistazo, sin leer el array.
      requested_subindustries: requestedSubindustries,
      requested_subindustries_count: requestedSubindustries.length,
      // MULTI-SUBINDUSTRY-QUERY-DRAFTING-ANYOF-1 § 6 — y qué parte de esa solicitud
      // llegó de verdad a las consultas pagadas. Es la pregunta que la forense de
      // `ce957e2f` no pudo responder leyendo el lote: la solicitud decía dos y la
      // consulta representaba una, y ningún campo lo declaraba.
      ...buildRunSubindustryCoverageMetadata(runResult, requestedSubindustries),
      // CATALOG SOURCE-OF-TRUTH FINAL ADDENDUM § 9 — de qué versión publicada del
      // catálogo salieron los términos, con su digest, y si esa versión es la misma
      // con la que se resolvió la selección. Sin estos campos, «cobertura 2/2» no
      // dice contra qué catálogo se midió.
      ...toApolloSubindustryCatalogTermsMetadata(input.catalogTerms ?? null),
      ...toApolloCatalogVersionCoherenceMetadata(
        evaluateApolloCatalogVersionCoherence({
          selectionCatalogVersion: input.selectionCatalogVersion ?? null,
          resolution: input.catalogTerms ?? null,
          requestedSubindustries,
        }),
      ),
      // § 7 — con valor, ninguna búsqueda se emitió y los créditos son CERO.
      query_coverage_block_reason: runResult.queryCoverageBlockReason,
      result_status: runResult.resultStatus,
      target_eligible_companies: runResult.targetEligibleCompanies,
      eligible_companies_found: runResult.eligibleCompaniesFound,
      rounds_executed: runResult.roundsExecuted,
      target_reached: runResult.targetReached,
      partial_result_reason: runResult.partialResultReason,
      second_round_skipped_reason: runResult.secondRoundSkippedReason,
      // QUERY-QUALITY-2 § 12 — el próximo QA lee ESTO, no el texto humano de la
      // hipótesis: dos rondas con la misma huella son la misma búsqueda pagada
      // dos veces, por muy distinta que suene su descripción.
      ...buildRoundComparisonMetadata(runResult),
      rounds: runResult.rounds.map(toRoundMetricsMetadata),
      run_metrics: toRunMetricsMetadata(runResult.runMetrics),
      enrichment_selections: runResult.enrichmentSelections,
      enrichment_skips: runResult.enrichmentSkips,
      budget: toApolloTwoRoundBudgetMetadata(input.budget),
      spend_accounting: {
        estimated_credits: accounting.estimatedCredits,
        reserved_credits: accounting.reservedCredits,
        recorded_usage_credits: accounting.recordedUsageCredits,
        // Nunca se infiere del ledger interno: sin evidencia externa aislable
        // queda null (§ 10).
        confirmed_provider_credits: accounting.confirmedProviderCredits,
      },
      // § 4 — la conciliación manual es un hecho de la corrida, no una nota.
      manual_reconciliation_required: runResult.manualReconciliationRequired,
      indeterminate_operations: runResult.indeterminateOperations.map((operation) => ({
        round_number: operation.roundNumber,
        operation_key: operation.operationKey,
        operation_subject: operation.subject,
        operation_id: operation.operationId,
        reason: operation.reason,
      })),
      completed_operation_keys_count: runResult.completedOperationKeys.length,
      indeterminate_operation_keys_count: runResult.indeterminateOperationKeys.length,
      // § D — contradicciones entre desglose por ronda, snapshots y run_metrics.
      // `ok: true` en una corrida sana; los conflictos se nombran, no se corrigen.
      final_state_consistency: toFinalStateConsistencyMetadata(finalStateConsistency),
      // § 3 — un checkpoint que no se pudo escribir queda visible.
      checkpoint_write_failures: [...input.checkpointFailures],
      candidates_persisted: input.candidatesPersisted,
      ...(anomalies.length > 0 ? { budget_anomalies: anomalies } : {}),
      ...toApolloTwoRoundConfigDiagnostics(resolveApolloTwoRoundConfigFromEnv()),
    },
  };
}

/**
 * QUERY-QUALITY-2 § 12 — comparación explícita entre las dos rondas.
 *
 * Todo lo que aquí se afirma sale de lo que REALMENTE se envió. Un dato ausente
 * queda null: «no se sabe qué envió la ronda 2» no es «envió lo mismo».
 */
export function buildRoundComparisonMetadata(
  runResult: ApolloTwoRoundRunResult,
): Record<string, unknown> {
  const round1 = runResult.rounds.find((round) => round.roundNumber === 1) ?? null;
  const round2 = runResult.rounds.find((round) => round.roundNumber === 2) ?? null;

  const hypothesis1 = round1?.providerRequestFingerprint ?? null;
  const hypothesis2 = round2?.providerRequestFingerprint ?? null;
  const effective1 = round1?.effectiveProviderFingerprint ?? null;
  const effective2 = round2?.effectiveProviderFingerprint ?? null;

  const distinct = (a: string | null, b: string | null): boolean | null =>
    a === null || b === null ? null : a !== b;

  return {
    // § 10 — las cuatro huellas, cada una con su nombre. Confundirlas es el defecto
    // que este hito cierra: la de hipótesis explica la intención, la efectiva es la
    // que decide si una segunda búsqueda podía traer algo nuevo.
    round_1_hypothesis_fingerprint: hypothesis1,
    round_2_hypothesis_fingerprint: hypothesis2,
    round_1_effective_provider_fingerprint: effective1,
    round_2_effective_provider_fingerprint: effective2,
    /** Criterio ECONÓMICO. Null cuando falta una de las dos: ausencia ≠ igualdad. */
    effective_fingerprints_are_distinct: distinct(effective1, effective2),
    /** Conservado para continuidad de lectura; NO es el criterio económico. */
    round_1_provider_fingerprint: hypothesis1,
    round_2_provider_fingerprint: hypothesis2,
    hypothesis_fingerprints_are_distinct: distinct(hypothesis1, hypothesis2),
    fingerprints_are_distinct: distinct(effective1, effective2) ?? distinct(hypothesis1, hypothesis2),
    round_1_page: round1?.page ?? null,
    round_2_page: round2?.page ?? null,
    round_1_per_page: round1?.perPage ?? null,
    round_2_per_page: round2?.perPage ?? null,
    specific_terms_sent: round1?.specificTermsSent ?? [],
    round_2_specific_terms_sent: round2?.specificTermsSent ?? [],
    // § 10 — lo que EFECTIVAMENTE viajó, tras prioridad y truncamiento.
    round_1_effective_keywords_sent: round1?.effectiveKeywordsSent ?? [],
    round_2_effective_keywords_sent: round2?.effectiveKeywordsSent ?? [],
    round_2_skipped_reason: runResult.secondRoundSkippedReason,
    round_2_novel_provider_results: round2?.newUniqueResults ?? null,
    // SCALE-SECOND-ROUND-FIX-1B § 1 — por qué la ronda 2 pidió la página que pidió.
    // `null` cuando nadie decidió (sin ronda 2, o rehidratada de un checkpoint).
    round_2_page_decision: toRound2PageDecisionMetadata(runResult.round2PageDecision),
  };
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

function toCandidateSnapshot(
  candidate: ResumedCandidate,
  evidence: ApolloTwoRoundCandidateEvidenceSnapshot | null,
  enrichmentStatus: ApolloTwoRoundEnrichmentStatus,
): ApolloTwoRoundCandidateSnapshot {
  return {
    candidate_key: candidate.candidateKey,
    round_number: candidate.roundNumber,
    provider_rank: candidate.providerRank,
    provider_organization_id: candidate.identity.providerOrganizationId,
    normalized_name: candidate.identity.canonicalName,
    normalized_domain: candidate.identity.normalizedDomain,
    normalized_linkedin_url: candidate.identity.normalizedLinkedInUrl,
    sector_evidence_state: candidate.sectorEvidenceState,
    rejection_reason: candidate.assessment.rejection,
    eligible: candidate.eligible,
    became_eligible_after_enrichment: candidate.becameEligibleAfterEnrichment,
    finally_rejected_or_duplicated: candidate.finallyRejectedOrDuplicated,
    no_prior_suggestion: candidate.assessment.noPriorSuggestion,
    enrichment_status: candidate.enrichmentExecuted ? 'executed' : enrichmentStatus,
    ranking_signals: candidate.assessment.signals,
    evidence,
  };
}

function buildCheckpoint(input: {
  reason: ApolloTwoRoundCheckpointReason;
  checkpointVersion: number;
  correlation: ApolloTwoRoundRunCorrelation;
  config: ApolloTwoRoundDiscoveryConfig;
  resume: ApolloTwoRoundResumeState;
  evidenceByKey: ReadonlyMap<string, ApolloTwoRoundCandidateEvidenceSnapshot>;
  enrichmentSnapshots: readonly ApolloTwoRoundEnrichmentSnapshot[];
  recordedOperationCredits: readonly ApolloTwoRoundRecordedOperationCredit[];
  candidatesPersisted: boolean;
  persistedCandidateIds: readonly string[];
  spendAccounting: {
    estimatedCredits: number;
    reservedCredits: number;
    recordedUsageCredits: number;
    confirmedProviderCredits: number | null;
  };
  checkpointWriteFailures: readonly string[];
}): ApolloTwoRoundCheckpointV1 {
  const statusByKey = new Map<string, ApolloTwoRoundEnrichmentStatus>();
  for (const snapshot of input.enrichmentSnapshots) {
    statusByKey.set(snapshot.candidate_key, snapshot.status);
  }

  return {
    version: APOLLO_TWO_ROUND_CHECKPOINT_CONTRACT_VERSION,
    checkpoint_version: input.checkpointVersion,
    checkpoint_updated_at: null,
    checkpoint_reason: input.reason,
    idempotency_key: input.correlation.idempotencyKey,
    request_fingerprint: input.correlation.requestFingerprint,
    // § 2 CAS-CLOSE — la fusión NUNCA mezcla dos corridas del wizard.
    wizard_run_id: input.correlation.wizardRunId,
    config: input.config,
    completed_operation_keys: [...(input.resume.completedOperationKeys ?? [])],
    indeterminate_operation_keys: [...(input.resume.indeterminateOperationKeys ?? [])],
    seen_organization_keys: toSeenOrganizationKeys(input.resume.seenIdentities),
    round_summaries: input.resume.rounds.map((round) => ({ ...round })),
    candidate_snapshots: input.resume.candidates.map((candidate) =>
      toCandidateSnapshot(
        candidate,
        input.evidenceByKey.get(candidate.candidateKey) ?? null,
        statusByKey.get(candidate.candidateKey) ?? 'not_attempted',
      ),
    ),
    // § 5 — organizaciones ya pagadas cuya evaluación no se ha registrado. Sin su
    // evidencia, un reintento en esa ventana daría la ronda por vacía.
    pending_organizations: (input.resume.pendingRoundOrganizations ?? []).flatMap((entry) =>
      entry.organizations.flatMap((organization) => {
        const evidence = input.evidenceByKey.get(candidateKeyFor(organization));
        if (evidence === undefined) return [];
        return [
          {
            round_number: entry.roundNumber,
            provider_rank: organization.providerRank,
            provider_organization_id: organization.providerOrganizationId ?? null,
            name: organization.name ?? null,
            domain: organization.domain ?? null,
            linkedin_url: organization.linkedinUrl ?? null,
            declared_industry: organization.declaredIndustry ?? null,
            evidence,
          } satisfies ApolloTwoRoundPendingOrganizationSnapshot,
        ];
      }),
    ),
    enrichment_snapshots: input.enrichmentSnapshots.map((snapshot) => ({ ...snapshot })),
    // § 2 CAS-CLOSE — gasto por operación, ordenado para que dos procesos del
    // mismo run produzcan documentos comparables byte a byte.
    recorded_operation_credits: [...input.recordedOperationCredits]
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.operation_id.localeCompare(b.operation_id)),
    persisted_candidate_ids: [...input.persistedCandidateIds],
    candidates_persisted: input.candidatesPersisted,
    observed_rejection_reasons: [...input.resume.observedRejectionReasons],
    second_round_skipped_reason: input.resume.secondRoundSkippedReason ?? null,
    totals: {
      raw_results: input.resume.totalRawResults,
      search_credits: input.resume.totalSearchCredits,
      enrichment_credits: input.resume.totalEnrichmentCredits,
      enrichments_executed: input.resume.enrichmentsExecuted,
    },
    spend_accounting: {
      estimated_credits: input.spendAccounting.estimatedCredits,
      reserved_credits: input.spendAccounting.reservedCredits,
      recorded_usage_credits: input.spendAccounting.recordedUsageCredits,
      confirmed_provider_credits: input.spendAccounting.confirmedProviderCredits,
    },
    checkpoint_write_failures: [...input.checkpointWriteFailures],
    // § 2 CAS-CLOSE — una operación con el cobro sin confirmar exige conciliación
    // aunque el orquestador no la haya listado todavía como indeterminada.
    manual_reconciliation_required:
      (input.resume.indeterminateOperationKeys ?? []).length > 0 ||
      hasUnknownOperationBilling(input.recordedOperationCredits),
    compacted: false,
  };
}

/** § 5 — rehidrata el estado del orquestador desde el checkpoint sanitizado. */
export function toResumeStateFromCheckpoint(
  checkpoint: ApolloTwoRoundCheckpointV1,
): ApolloTwoRoundResumeState {
  const candidates: ResumedCandidate[] = checkpoint.candidate_snapshots.map((snapshot) => ({
    candidateKey: snapshot.candidate_key,
    roundNumber: snapshot.round_number,
    providerRank: snapshot.provider_rank,
    identity: {
      providerOrganizationId: snapshot.provider_organization_id,
      normalizedDomain: snapshot.normalized_domain,
      normalizedLinkedInUrl: snapshot.normalized_linkedin_url,
      canonicalName: snapshot.normalized_name,
    },
    assessment: {
      rejection: snapshot.rejection_reason,
      sectorEvidenceState: snapshot.sector_evidence_state,
      signals: snapshot.ranking_signals,
      noPriorSuggestion: snapshot.no_prior_suggestion,
    },
    sectorEvidenceState: snapshot.sector_evidence_state,
    eligible: snapshot.eligible,
    becameEligibleAfterEnrichment: snapshot.became_eligible_after_enrichment,
    enrichmentExecuted: snapshot.enrichment_status === 'executed',
    finallyRejectedOrDuplicated: snapshot.finally_rejected_or_duplicated,
  }));

  // § 5 — organizaciones pagadas y sin evaluar, agrupadas por ronda.
  const pendingByRound = new Map<number, RawDiscoveredOrganization[]>();
  for (const pending of checkpoint.pending_organizations ?? []) {
    const organizations = pendingByRound.get(pending.round_number) ?? [];
    organizations.push({
      providerOrganizationId: pending.provider_organization_id,
      name: pending.name,
      domain: pending.domain,
      linkedinUrl: pending.linkedin_url,
      providerRank: pending.provider_rank,
      declaredIndustry: pending.declared_industry,
    });
    pendingByRound.set(pending.round_number, organizations);
  }

  return {
    seenIdentities: candidates.map((candidate) => candidate.identity),
    candidates,
    rounds: checkpoint.round_summaries,
    totalRawResults: checkpoint.totals.raw_results,
    totalSearchCredits: checkpoint.totals.search_credits,
    totalEnrichmentCredits: checkpoint.totals.enrichment_credits,
    enrichmentsExecuted: checkpoint.totals.enrichments_executed,
    observedRejectionReasons: checkpoint.observed_rejection_reasons,
    secondRoundSkippedReason: checkpoint.second_round_skipped_reason,
    completedOperationKeys: checkpoint.completed_operation_keys,
    indeterminateOperationKeys: checkpoint.indeterminate_operation_keys,
    candidatesPersisted: checkpoint.candidates_persisted,
    pendingRoundOrganizations: [...pendingByRound].map(([roundNumber, organizations]) => ({
      roundNumber,
      organizations,
    })),
  };
}

function recordEnrichmentSnapshot(input: {
  enrichmentSnapshots: ApolloTwoRoundEnrichmentSnapshot[];
  enrichmentStatusByKey: Map<string, ApolloTwoRoundEnrichmentStatus>;
  candidateKey: string;
  operationContext: ApolloTwoRoundOperationContext;
  status: ApolloTwoRoundEnrichmentStatus;
  recordedCredits: number | null;
  sectorEvidenceState: CandidateSectorEvidenceState;
}): void {
  input.enrichmentStatusByKey.set(input.candidateKey, input.status);
  input.enrichmentSnapshots.push({
    candidate_key: input.candidateKey,
    round_number: input.operationContext.roundNumber,
    operation_id: input.operationContext.operationId,
    operation_subject: input.operationContext.subject,
    status: input.status,
    recorded_credits: input.recordedCredits,
    sector_evidence_state: input.sectorEvidenceState,
  });
}

// ─── Helpers locales ──────────────────────────────────────────────────────────

/**
 * Clave estable de una organización dentro de la corrida. Idéntica en criterio a
 * la del orquestador para que ambos hablen de la misma empresa.
 */
function candidateKeyFor(organization: RawDiscoveredOrganization): string {
  if (organization.providerOrganizationId) return `apollo:${organization.providerOrganizationId}`;
  const domain = organization.domain ? normalizeDomain(organization.domain) : null;
  if (domain) return `domain:${domain}`;
  return `name:${(organization.name ?? '').trim().toLowerCase()}`;
}

/**
 * Recupera el resultado de búsqueda de un candidato desde la evidencia mínima.
 *
 * Es lo que permite que un reintento vuelva a evaluar gates y a construir el
 * candidato sin repetir la búsqueda: ninguna de esas funciones llama al
 * proveedor, así que reconstruir aquí no cuesta un crédito.
 */
function readEvidenceResult(
  evidenceByKey: ReadonlyMap<string, ApolloTwoRoundCandidateEvidenceSnapshot>,
  key: string,
): WebSearchResult | null {
  const snapshot = evidenceByKey.get(key);
  return snapshot === undefined ? null : fromCandidateEvidenceSnapshot(snapshot);
}

/** Dominio que las comprobaciones dependientes de dominio usarían (§ 8). */
function readEvidenceDomain(result: WebSearchResult): string | null {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const profile = (meta['apollo_profile'] ?? {}) as Record<string, unknown>;
  const raw = meta['domain'] ?? profile['primary_domain'];
  if (typeof raw !== 'string' || raw.trim() === '') return normalizeDomain(result.url);
  return normalizeDomain(raw) ?? raw.trim().toLowerCase();
}

/**
 * A1-APOLLO-LINKEDIN-EMPLOYEES-1 — vuelve a leer los campos empresariales del
 * proveedor sobre un candidato ya construido, fusionándolos con lo que ya tenía.
 *
 * Devuelve un objeto nuevo. Un valor ya confirmado no se degrada nunca: la
 * fusión sólo puede mejorar la observación (ver `mergeEmployeeCountCapture`).
 */
function withRecapturedProviderCompanyFields(
  candidate: ProspectingPipelineCandidate,
  enrichedResult: WebSearchResult,
): ProspectingPipelineCandidate {
  const recaptured = captureApolloCompanyFields(enrichedResult, new Date().toISOString());
  const linkedin = mergeCompanyLinkedInCapture(
    candidate.providerCompanyFields?.linkedin,
    recaptured.linkedin,
  );
  const employeeCount = mergeEmployeeCountCapture(
    candidate.providerCompanyFields?.employeeCount,
    recaptured.employeeCount,
  );

  return {
    ...candidate,
    providerCompanyFields: { linkedin, employeeCount },
    companyLinkedInUrl: linkedin.companyLinkedInUrl,
    ...(employeeCount.status === 'confirmed'
      ? { employeeCount: employeeCount.employeeCount }
      : {}),
  };
}

function buildRejectedAssessment(
  rejection: CheapRejectionReason,
  organization: RawDiscoveredOrganization,
): CheapAssessment {
  return {
    rejection,
    sectorEvidenceState: 'sector_not_mapped',
    signals: {
      countryCompatible: false,
      domainConfident: false,
      ownershipConfident: false,
      sectorKeywordMatchCount: 0,
      novel: false,
      hasCompanySizeSignal: false,
      hasLocationSignal: false,
      hasLinkedInUrl: organization.linkedinUrl !== null && organization.linkedinUrl !== undefined,
      freeOfContradictoryEvidence: false,
      knownDuplicate: false,
      cooldownActive: false,
    },
    noPriorSuggestion: true,
  };
}

/**
 * QUERY-QUALITY-2 § 3 — `total_pages` que el proveedor declaró en esta búsqueda.
 *
 * Null cuando el proveedor no lo dijo: la ronda 2 no puede pedir una página 2
 * cuya existencia nadie declaró.
 */
export function readProviderTotalPages(output: WebSearchOutput): number | null {
  const metadata = (output.metadata ?? {}) as Record<string, unknown>;
  const pagination = metadata['apollo_pagination'] as { total_pages?: unknown } | undefined;
  const totalPages = pagination?.total_pages;
  return typeof totalPages === 'number' && Number.isFinite(totalPages) ? totalPages : null;
}

/**
 * QUERY-QUALITY-2 § 7 — evidencia GRATUITA de identidad de un candidato.
 *
 * Sólo campos declarados por el proveedor: industria, industrias, keywords y
 * nombre. La descripción se excluye a propósito — bloquear por ella descartaría
 * supermercados reales que mencionan su propio crédito de consumo.
 */
export function readFreeSectorEvidence(
  result: WebSearchResult,
  organization: RawDiscoveredOrganization,
): ApolloFreeSectorEvidence {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const profile = (meta['apollo_profile'] ?? {}) as Record<string, unknown>;
  const readStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  return {
    declaredIndustry:
      organization.declaredIndustry ??
      (typeof meta['industry'] === 'string' ? (meta['industry'] as string) : null),
    declaredIndustries: [
      ...readStringArray(meta['industries']),
      ...readStringArray(profile['industries']),
    ],
    keywords: [
      ...readStringArray(meta['keywords']),
      ...readStringArray(profile['keywords']),
      ...readStringArray(profile['organization_keywords']),
    ],
    organizationName: organization.name ?? result.title ?? null,
  };
}

/** Créditos que NUESTRO ledger registró para una búsqueda. Nunca inventa un valor. */
export function readRecordedSearchCredits(output: WebSearchOutput): number {
  const usage = (output.metadata?.['usage'] ?? null) as { credits_used?: unknown } | null;
  const credits = usage?.credits_used;
  return typeof credits === 'number' && Number.isFinite(credits) ? credits : 0;
}

function readHasEmployeeCount(result: WebSearchResult): boolean {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const value = meta['employee_count'] ?? meta['estimated_num_employees'];
  return typeof value === 'number' && value > 0;
}

function readHasLocation(result: WebSearchResult): boolean {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  for (const key of ['city', 'country', 'country_code']) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim() !== '') return true;
  }
  return false;
}

/**
 * Une la observabilidad de búsqueda de ambas rondas en un solo `WebSearchOutput`.
 *
 * Se conserva la metadata de CADA ronda en `rounds[]`: colapsarla en un objeto
 * plano haría imposible saber qué devolvió cada una, que es justo lo que § 4
 * pide poder ver.
 */
export function mergeSearchOutputs(
  outputs: readonly WebSearchOutput[],
  fallbackQuery: string,
): WebSearchOutput {
  if (outputs.length === 0) {
    return {
      provider: 'apollo_organizations',
      query: fallbackQuery,
      results: [],
      resultsCount: 0,
      skipped: true,
      skipReason: 'no_rounds_executed',
      estimatedCostUsd: 0,
      metadata: { apollo_two_round_search_rounds: [] },
    };
  }

  const results = outputs.flatMap((output) => output.results);
  return {
    provider: 'apollo_organizations',
    query: outputs[0].query,
    results,
    resultsCount: results.length,
    skipped: outputs.every((output) => output.skipped),
    skipReason: outputs.find((output) => output.skipReason)?.skipReason ?? null,
    estimatedCostUsd: outputs.reduce((sum, output) => sum + (output.estimatedCostUsd ?? 0), 0),
    metadata: {
      apollo_two_round_search_rounds: outputs.map((output, index) => ({
        round_number: index + 1,
        skipped: output.skipped,
        skip_reason: output.skipReason ?? null,
        results_count: output.resultsCount,
        metadata: output.metadata ?? null,
      })),
    },
  };
}

export { APOLLO_TWO_ROUND_CHECKPOINT_KEY };
export type { ApolloTwoRoundResumeState, ApolloTwoRoundCheckpointV1 };
