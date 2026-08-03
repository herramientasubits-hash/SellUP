/**
 * production-runner.server.ts — Adaptador de PRODUCCIÓN de la modalidad Apollo
 * de dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1-FIX · § 1.
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
 *   usage logging             → realLogApolloOrgsUsage
 *   persistencia              → writeProspectingCandidates
 *   ledger de operaciones     → estado de la corrida en el metadata del lote
 *
 * Ninguna de esas funciones se reimplementa aquí. Lo único propio del archivo es
 * la traducción entre vocabularios y el orden en que se invocan.
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
import { runApolloOrganizationsSearch } from '../web-search-providers/apollo-organizations-search-provider';
import {
  evaluateApolloEnrichmentEligibility,
  type ApolloEnrichmentIneligibilityReason,
} from '../apollo-enrichment-eligibility-gate';
import { evaluateApolloSectorRelevanceForPaidOperation } from '../apollo-sector-relevance-gate';
import { runApolloOrganizationEnrichmentCascade } from '../apollo-organization-enrichment-cascade';
import { creditsForApolloOperation } from '../apollo-operation-pricing';
import { writeProspectingCandidates } from '../candidate-writer';
import {
  loadDiscoveryNegativeMemory,
  emptyNegativeMemory,
  type DiscoveryNegativeMemory,
} from '../discovery-negative-memory';
import { normalizeDomain } from '../normalization';

import {
  runApolloTwoRoundDiscovery,
  toApolloTwoRoundResumeState,
  type ApolloTwoRoundDeps,
  type ApolloTwoRoundResumeState,
  type ApolloTwoRoundRunResult,
  type CheapAssessment,
  type CheapRejectionReason,
  type EnrichmentResult,
  type RawDiscoveredOrganization,
} from './orchestrator';
import type { ApolloTwoRoundRunCorrelation } from './idempotency';
import {
  APOLLO_TWO_ROUND_OBSERVABILITY_KEY,
  toRoundMetricsMetadata,
  toRunMetricsMetadata,
} from './observability';
import {
  estimateApolloTwoRoundBudget,
  toApolloTwoRoundBudgetMetadata,
} from './budget';
import {
  toApolloTwoRoundConfigDiagnostics,
  type ApolloTwoRoundDiscoveryConfig,
} from './config';
import { resolveApolloTwoRoundConfigFromEnv } from './env.server';
import type { CandidateSectorEvidenceState } from './enrichment-ranking';
import {
  serializeRunState,
  deserializeRunState,
  type ApolloTwoRoundPersistedRunState,
} from './run-state';

// ─── Entrada ──────────────────────────────────────────────────────────────────

export type ApolloTwoRoundWizardRunInput = {
  country: string;
  countryCode: string;
  industry: string;
  subindustries: string[];
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

// ─── Dependencias (inyectables sólo para tests) ───────────────────────────────

export type ApolloTwoRoundProductionDeps = {
  searchApollo: typeof runApolloOrganizationsSearch;
  buildCandidate: typeof buildProspectingPipelineCandidate;
  enrichCascade: typeof runApolloOrganizationEnrichmentCascade;
  persistCandidates: typeof writeProspectingCandidates;
  /** Memoria negativa (dominios ya sugeridos). Vacía cuando no hay cliente. */
  loadNegativeMemory: (scope: {
    countryCode: string;
    industryName: string;
    subindustryNames: string[];
    lookbackDays: number;
  }) => Promise<DiscoveryNegativeMemory>;
  /** Estado de un intento anterior de la MISMA corrida. Null si no hay. */
  loadRunState: (batchId: string) => Promise<ApolloTwoRoundPersistedRunState | null>;
  /** Persiste el estado tras cada paso irreversible. Nunca lanza. */
  saveRunState: (batchId: string, state: ApolloTwoRoundPersistedRunState) => Promise<void>;
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

// ─── Runner ───────────────────────────────────────────────────────────────────

export type ApolloTwoRoundWizardRunOutcome = IncrementalSearchOutput & {
  /** § 2 — visible cuando el gasto registrado supera la reserva. */
  budgetAnomalies?: readonly string[];
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
    persistCandidates: writeProspectingCandidates,
    loadNegativeMemory: async (scope) => {
      const { tryGetAdminClientForTwoRound } = await import('./run-state.server');
      const client = tryGetAdminClientForTwoRound();
      if (!client) return emptyNegativeMemory(scope);
      return loadDiscoveryNegativeMemory(client, scope).catch(() =>
        emptyNegativeMemory(scope),
      );
    },
    loadRunState: async (batchId) => {
      const { readTwoRoundRunState } = await import('./run-state.server');
      return readTwoRoundRunState(batchId);
    },
    saveRunState: async (batchId, state) => {
      const { writeTwoRoundRunState } = await import('./run-state.server');
      await writeTwoRoundRunState(batchId, state);
    },
    resolveConfig: () => resolveApolloTwoRoundConfigFromEnv().config,
    ...depsOverride,
  };

  const config = deps.resolveConfig();
  const budget = estimateApolloTwoRoundBudget(config);

  const catalogContext = getCatalogContext({
    country: input.country,
    countryCode: input.countryCode,
    industry: input.industry,
    searchDepth: 'standard',
  });

  const negativeMemory = await deps
    .loadNegativeMemory({
      countryCode: input.countryCode,
      industryName: input.industry,
      subindustryNames: input.subindustries,
      lookbackDays: NEGATIVE_MEMORY_LOOKBACK_DAYS,
    })
    .catch(() =>
      emptyNegativeMemory({
        countryCode: input.countryCode,
        industryName: input.industry,
        subindustryNames: input.subindustries,
        lookbackDays: NEGATIVE_MEMORY_LOOKBACK_DAYS,
      }),
    );

  // § 7 — estado del intento anterior, si lo hay.
  const persistedState = await deps.loadRunState(input.reservedBatchId).catch(() => null);
  const restored = deserializeRunState(persistedState, input.correlation);

  // Candidatos completos (con verificación, dedup y scoring) por clave, para
  // persistirlos al final sin reconstruirlos. Un reintento los recupera del
  // estado: sin ellos recuperaría el veredicto pero no tendría qué persistir.
  const candidatesByKey = new Map<string, ProspectingPipelineCandidate>(
    restored?.pipelineCandidates ?? [],
  );
  // Resultado de búsqueda por clave: lo consume el enrichment y el gate sectorial.
  const searchResultByKey = new Map<string, WebSearchResult>(restored?.searchResults ?? []);
  const searchOutputs: WebSearchOutput[] = [];
  const warnings: string[] = [];
  let recordedUsageCredits = restored?.recordedUsageCredits ?? 0;
  let budgetAnomalyRaised = false;

  /**
   * § 2 — aserción defensiva de presupuesto.
   *
   * Se comprueba ANTES de autorizar cualquier operación adicional: pasada la
   * reserva, la corrida no emite ni una llamada más. No lanza, porque abortar
   * con excepción perdería los candidatos ya obtenidos y ya pagados.
   */
  const budgetExceeded = (): boolean => {
    if (recordedUsageCredits <= input.reservedCredits) return false;
    if (!budgetAnomalyRaised) {
      budgetAnomalyRaised = true;
      warnings.push(
        `${TWO_ROUND_BUDGET_ANOMALY}: recorded=${recordedUsageCredits} reserved=${input.reservedCredits}`,
      );
    }
    return true;
  };

  const orchestratorDeps: ApolloTwoRoundDeps = {
    searchRound: async ({ hypothesis, requestedResultLimit }) => {
      if (budgetExceeded()) {
        return { organizations: [], providerRequestCount: 0, internalRecordedCredits: 0 };
      }

      const searchInput: WebSearchInput = {
        query: hypothesis.queryHypothesis,
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        intent: 'company_discovery',
        maxResults: requestedResultLimit,
        provider: 'apollo_organizations',
        subindustries: input.subindustries,
        additionalCriteriaTokens: hypothesis.queryParameters.keywordTags,
      };

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
        },
        undefined,
        // § 5 — la modalidad necesita ver a los candidatos con evidencia
        // sectorial insuficiente: son los únicos que pueden competir por un
        // enrichment. El gate se aplica después, candidato a candidato.
        { sectorGateMode: 'annotate' },
      );
      searchOutputs.push(output);

      const credits = readRecordedSearchCredits(output);
      recordedUsageCredits += credits;

      const organizations = output.results.map((result, index) => {
        const organization = toRawDiscoveredOrganization(result, index + 1);
        const key = candidateKeyFor(organization);
        searchResultByKey.set(key, result);
        return organization;
      });

      return {
        organizations,
        providerRequestCount: output.skipped ? 0 : 1,
        internalRecordedCredits: credits,
      };
    },

    assessCandidate: async ({ organization, identity }) => {
      const key = candidateKeyFor(organization);
      const result = searchResultByKey.get(key);
      if (!result) {
        // Sin el resultado original no hay evidencia que evaluar. Se rechaza,
        // nunca se acepta a ciegas.
        return buildRejectedAssessment('invalid_domain', organization);
      }

      // 3-9. Gates baratos reales: país, dominio, TLD, correo, ownership,
      // plataforma externa, cooldown e historial. Cero llamadas, cero créditos.
      const eligibility = evaluateApolloEnrichmentEligibility(result, {
        targetCountryCode: input.countryCode,
        sector: input.industry,
        subindustry: input.subindustries[0] ?? null,
        domainsInCooldown: negativeMemory.excludedDomains,
      });

      const sector = evaluateApolloSectorRelevanceForPaidOperation(
        result,
        input.industry,
        input.subindustries[0] ?? null,
      );
      const sectorEvidenceState = toSectorEvidenceState(sector.decision);

      // 10-11. Duplicado en SellUp y en HubSpot — una sola consulta por
      // organización, la misma que el pipeline de producción ya hace.
      const built = await deps.buildCandidate(result, {
        country: input.country,
        countryCode: input.countryCode,
        industry: input.industry,
        catalogContext,
        provider: 'apollo_organizations',
        fallbackQueryText: input.industry,
      });
      candidatesByKey.set(key, built.candidate);
      const duplicate = readDuplicateVerdict(built.candidate);

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

    enrichCandidate: async ({ candidateKey, identity }) => {
      const noSpend: EnrichmentResult = {
        executed: false,
        sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
        internalRecordedCredits: 0,
      };
      if (budgetExceeded()) return noSpend;

      const result = searchResultByKey.get(candidateKey);
      if (!result || identity.normalizedDomain === null) return noSpend;

      // Un solo enrichment: la lista que se le pasa al cascade tiene UN
      // elemento y el cap es 1. El presupuesto global lo gobierna el
      // orquestador, no este cap por llamada.
      const cascade = await deps.enrichCascade(
        [result],
        1,
        undefined,
        {
          eligibility: {
            targetCountryCode: input.countryCode,
            sector: input.industry,
            subindustry: input.subindustries[0] ?? null,
          },
        },
      );

      const entry = cascade.meta.entries[0];
      const executed = entry?.enriched === true || entry?.skip_reason === 'enrichment_failed';
      const credits = executed ? creditsForApolloOperation('organization_enrichment', 1) : 0;
      recordedUsageCredits += credits;

      const enrichedResult = cascade.results[0] ?? result;
      if (entry?.enriched === true) {
        searchResultByKey.set(candidateKey, enrichedResult);
        const rebuilt = await deps.buildCandidate(enrichedResult, {
          country: input.country,
          countryCode: input.countryCode,
          industry: input.industry,
          catalogContext,
          provider: 'apollo_organizations',
          fallbackQueryText: input.industry,
        });
        candidatesByKey.set(candidateKey, rebuilt.candidate);
      }

      const sector = evaluateApolloSectorRelevanceForPaidOperation(
        enrichedResult,
        input.industry,
        input.subindustries[0] ?? null,
      );

      return {
        executed,
        sectorEvidenceState: toSectorEvidenceState(sector.decision),
        internalRecordedCredits: credits,
      };
    },
  };

  const runResult: ApolloTwoRoundRunResult = await runApolloTwoRoundDiscovery(
    {
      config,
      queryContext: {
        country: input.country,
        countryCode: input.countryCode,
        sector: input.industry,
        subindustry: input.subindustries[0] ?? null,
      },
      correlation: input.correlation,
      completedOperationKeys: restored?.completedOperationKeys ?? [],
      resume: restored?.resume ?? null,
    },
    orchestratorDeps,
  );

  // § 7 — el estado se persiste ANTES de escribir candidatos: un fallo en la
  // escritura debe poder reintentarse sin volver a buscar ni a enriquecer.
  await deps
    .saveRunState(
      input.reservedBatchId,
      serializeRunState({
        correlation: input.correlation,
        completedOperationKeys: runResult.completedOperationKeys,
        resume: toApolloTwoRoundResumeState(runResult),
        pipelineCandidates: candidatesByKey,
        searchResults: searchResultByKey,
        recordedUsageCredits,
        candidatesPersisted: false,
      }),
    )
    .catch(() => {
      warnings.push('two_round_run_state_persist_failed');
    });

  // ── Persistencia ────────────────────────────────────────────────────────────
  const persistedCandidates: ProspectingPipelineCandidate[] = runResult.persisted
    .map((entry) => candidatesByKey.get(entry.candidateKey))
    .filter((candidate): candidate is ProspectingPipelineCandidate => candidate !== undefined);

  const observability = {
    [APOLLO_TWO_ROUND_OBSERVABILITY_KEY]: {
      modality: 'two_round_adaptive',
      result_status: runResult.resultStatus,
      target_eligible_companies: runResult.targetEligibleCompanies,
      eligible_companies_found: runResult.eligibleCompaniesFound,
      rounds_executed: runResult.roundsExecuted,
      target_reached: runResult.targetReached,
      partial_result_reason: runResult.partialResultReason,
      second_round_skipped_reason: runResult.secondRoundSkippedReason,
      rounds: runResult.rounds.map(toRoundMetricsMetadata),
      run_metrics: toRunMetricsMetadata(runResult.runMetrics),
      enrichment_selections: runResult.enrichmentSelections,
      enrichment_skips: runResult.enrichmentSkips,
      budget: toApolloTwoRoundBudgetMetadata(budget),
      spend_accounting: {
        estimated_credits: budget.maximumInternalRecordedCredits,
        reserved_credits: input.reservedCredits,
        recorded_usage_credits: recordedUsageCredits,
        // Nunca se infiere del ledger interno: sin evidencia externa aislable
        // queda null (§ 10).
        confirmed_provider_credits: null,
      },
      ...(budgetAnomalyRaised ? { budget_anomalies: [TWO_ROUND_BUDGET_ANOMALY] } : {}),
      ...toApolloTwoRoundConfigDiagnostics(resolveApolloTwoRoundConfigFromEnv()),
    },
  };

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
    candidates: persistedCandidates,
    summary: buildSummary(
      config.targetEligibleCompanies,
      runResult.runMetrics.totalRawResults,
      persistedCandidates,
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

  await deps
    .saveRunState(
      input.reservedBatchId,
      serializeRunState({
        correlation: input.correlation,
        completedOperationKeys: runResult.completedOperationKeys,
        resume: toApolloTwoRoundResumeState(runResult),
        pipelineCandidates: candidatesByKey,
        searchResults: searchResultByKey,
        recordedUsageCredits,
        candidatesPersisted: true,
      }),
    )
    .catch(() => undefined);

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
    candidates: persistedCandidates,
    candidatesCount: persistedCandidates.length,
    usefulCandidatesCount: persistedCandidates.length,
    candidatesCreated: writerResult.candidatesCreated,
    metadata: {
      ...observability,
    } as unknown as IncrementalSearchOutput['metadata'],
    warnings,
    batchId: writerResult.batchId ?? input.reservedBatchId,
    targetReached: runResult.targetReached,
    targetPersistibleCandidates: config.targetEligibleCompanies,
    ...(budgetAnomalyRaised ? { budgetAnomalies: [TWO_ROUND_BUDGET_ANOMALY] } : {}),
  };
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

export type { ApolloTwoRoundResumeState };
