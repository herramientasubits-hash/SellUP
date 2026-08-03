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
import { runApolloOrganizationsSearch } from '../web-search-providers/apollo-organizations-search-provider';
import {
  evaluateApolloEnrichmentEligibility,
  type ApolloEnrichmentIneligibilityReason,
} from '../apollo-enrichment-eligibility-gate';
import { evaluateApolloSectorRelevanceForPaidOperation } from '../apollo-sector-relevance-gate';
import { runApolloOrganizationEnrichmentCascade } from '../apollo-organization-enrichment-cascade';
import { enrichApolloOrganization } from '@/server/integrations/apollo-client';
import { loadActiveApolloOrganizationEnrichmentPricing } from '@/modules/usage-tracking/provider-pricing';
import { writeProspectingCandidates } from '../candidate-writer';
import {
  loadDiscoveryNegativeMemory,
  emptyNegativeMemory,
  type DiscoveryNegativeMemory,
} from '../discovery-negative-memory';
import { normalizeDomain } from '../normalization';
import {
  buildApolloEnrichmentUsageKey,
  classifyApolloEnrichmentBillingOutcome,
  classifyApolloEnrichmentOutcomeFromCascadeEntry,
  logApolloOrganizationEnrichmentUsage,
  resolveApolloEnrichmentUsageAccounting,
  type ApolloEnrichmentBillingOutcome,
} from '../apollo-organization-enrichment-usage-log';

import {
  runApolloTwoRoundDiscovery,
  toApolloTwoRoundResumeState,
  type ApolloTwoRoundCheckpointSnapshot,
  type ApolloTwoRoundDeps,
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
} from './checkpoint';
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
  let recordedUsageCredits = restored?.spend_accounting.recorded_usage_credits ?? 0;
  let budgetAnomalyRaised = false;
  let checkpointVersion = restored?.checkpoint_version ?? 0;
  const checkpointFailures: string[] = [...(restored?.checkpoint_write_failures ?? [])];

  // Evidencia mínima por candidato: la del checkpoint más la que las rondas
  // vayan produciendo. Es lo único que se guarda del resultado del proveedor.
  const evidenceByKey = new Map<string, ApolloTwoRoundCandidateEvidenceSnapshot>();
  for (const snapshot of restored?.candidate_snapshots ?? []) {
    if (snapshot.evidence !== null) evidenceByKey.set(snapshot.candidate_key, snapshot.evidence);
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
    if (recordedUsageCredits <= input.reservedCredits) return false;
    if (!budgetAnomalyRaised) {
      budgetAnomalyRaised = true;
      warnings.push(
        `${TWO_ROUND_BUDGET_ANOMALY}: recorded=${recordedUsageCredits} reserved=${input.reservedCredits}`,
      );
    }
    return true;
  };

  /**
   * § 3 / § 7 — proyecta el estado del orquestador al checkpoint durable y lo
   * escribe. Devuelve `false` si no quedó durable, y el orquestador degrada la
   * operación a indeterminada.
   */
  const persistCheckpoint = async (
    snapshot: ApolloTwoRoundCheckpointSnapshot,
    overrides?: {
      reason?: ApolloTwoRoundCheckpointReason;
      candidatesPersisted?: boolean;
      persistedCandidateIds?: string[];
    },
  ): Promise<boolean> => {
    checkpointVersion += 1;
    const checkpoint = buildCheckpoint({
      reason: overrides?.reason ?? snapshot.reason,
      checkpointVersion,
      correlation: input.correlation,
      config,
      resume: snapshot.resume,
      evidenceByKey,
      enrichmentSnapshots,
      candidatesPersisted: overrides?.candidatesPersisted ?? candidatesPersisted,
      persistedCandidateIds: overrides?.persistedCandidateIds ?? persistedCandidateIds,
      spendAccounting: buildApolloTwoRoundSpendAccounting({
        estimatedCredits: budget.maximumInternalRecordedCredits,
        reservedCredits: input.reservedCredits,
        recordedUsageCredits,
      }),
      checkpointWriteFailures: checkpointFailures,
    });

    const outcome = await deps
      .saveCheckpoint(input.reservedBatchId, checkpoint)
      .catch((err: unknown) => ({
        kind: 'failed' as const,
        reason: err instanceof Error ? err.message : 'checkpoint_write_threw',
      }));

    if (outcome.kind === 'written') return true;
    // Una escritura stale significa que otro intento ya persistió un checkpoint
    // más nuevo: el estado ESTÁ durable, sólo no lo escribimos nosotros.
    if (outcome.kind === 'stale_rejected') return true;

    const detail = `${TWO_ROUND_CHECKPOINT_WARNING}:${checkpoint.checkpoint_reason}:${outcome.kind}`;
    checkpointFailures.push(detail);
    if (!warnings.includes(detail)) warnings.push(detail);
    return false;
  };

  const orchestratorDeps: ApolloTwoRoundDeps = {
    searchRound: async ({ hypothesis, requestedResultLimit, operationContext }) => {
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
          // § 2 — ronda, sujeto y operación llegan hasta la fila económica de la
          // búsqueda, y hasta su `usage_key`.
          operationContext: toApolloTwoRoundOperationContextMetadata(operationContext),
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
        evidenceByKey.set(key, toCandidateEvidenceSnapshot(result));
        return organization;
      });

      return {
        organizations,
        providerRequestCount: output.skipped ? 0 : 1,
        internalRecordedCredits: credits,
        indeterminate: readSearchIndeterminacy(output),
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
            subindustry: input.subindustries[0] ?? null,
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
      const logResult = await deps
        .logEnrichmentUsage({
          usageKey: buildApolloEnrichmentUsageKey({
            batchId: input.reservedBatchId,
            domain: identity.normalizedDomain,
            operationId: operationContext.operationId,
            fallbackTimestampMs: 0,
          }),
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
          accounting,
        })
        .catch(() => ({ kind: 'failed' as const, error: 'enrichment_usage_log_threw' }));
      if (logResult.kind === 'failed') {
        warnings.push('two_round_enrichment_usage_log_failed');
      }

      const credits = accounting.creditsUsed ?? 0;
      recordedUsageCredits += credits;

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
        }
      }

      // Recalcular el veredicto sectorial es GRATIS y puro: es la única señal que
      // el enrichment podía mover.
      const sector = evaluateApolloSectorRelevanceForPaidOperation(
        enrichedResult,
        input.industry,
        input.subindustries[0] ?? null,
      );
      const sectorEvidenceState = toSectorEvidenceState(sector.decision);

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

    saveCheckpoint: (snapshot) => persistCheckpoint(snapshot),
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
  const resolvePersistableCandidates = async (): Promise<ProspectingPipelineCandidate[]> => {
    const resolved: ProspectingPipelineCandidate[] = [];
    for (const entry of runResult.persisted) {
      const cached = assessmentByKey.get(entry.candidateKey);
      if (cached) {
        resolved.push(cached.candidate);
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
      });
      assessmentByKey.set(entry.candidateKey, {
        candidate: rebuilt.candidate,
        duplicate: readDuplicateVerdict(rebuilt.candidate),
        checkedDomain: entry.identity.normalizedDomain,
      });
      resolved.push(rebuilt.candidate);
    }
    return resolved;
  };

  const persistableCandidates: ProspectingPipelineCandidate[] = candidatesPersisted
    ? []
    : await resolvePersistableCandidates();

  const observability = buildObservabilityMetadata({
    runResult,
    budget,
    reservedCredits: input.reservedCredits,
    recordedUsageCredits,
    budgetAnomalyRaised,
    checkpointFailures,
    candidatesPersisted,
  });

  let candidatesCreated = persistedCandidateIds.length;

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
    targetReached: runResult.targetReached,
    targetPersistibleCandidates: config.targetEligibleCompanies,
    ...(budgetAnomalies.length > 0 ? { budgetAnomalies } : {}),
  };
}

// ─── Observabilidad ───────────────────────────────────────────────────────────

/**
 * § 9 — la contabilidad de gasto sale del constructor único de `budget.ts`, no de
 * un objeto literal armado aquí. Había dos implementaciones de las mismas cuatro
 * cantidades y sólo una estaba testeada.
 */
function buildObservabilityMetadata(input: {
  runResult: ApolloTwoRoundRunResult;
  budget: ReturnType<typeof estimateApolloTwoRoundBudget>;
  reservedCredits: number;
  recordedUsageCredits: number;
  budgetAnomalyRaised: boolean;
  checkpointFailures: readonly string[];
  candidatesPersisted: boolean;
}): Record<string, unknown> {
  const { runResult } = input;
  const accounting = buildApolloTwoRoundSpendAccounting({
    estimatedCredits: input.budget.maximumInternalRecordedCredits,
    reservedCredits: input.reservedCredits,
    recordedUsageCredits: input.recordedUsageCredits,
  });

  const anomalies = [
    ...(input.budgetAnomalyRaised ? [TWO_ROUND_BUDGET_ANOMALY] : []),
    ...(runResult.manualReconciliationRequired ? [TWO_ROUND_INDETERMINATE_ANOMALY] : []),
  ];

  return {
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
      // § 3 — un checkpoint que no se pudo escribir queda visible.
      checkpoint_write_failures: [...input.checkpointFailures],
      candidates_persisted: input.candidatesPersisted,
      ...(anomalies.length > 0 ? { budget_anomalies: anomalies } : {}),
      ...toApolloTwoRoundConfigDiagnostics(resolveApolloTwoRoundConfigFromEnv()),
    },
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
    enrichment_snapshots: input.enrichmentSnapshots.map((snapshot) => ({ ...snapshot })),
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
    manual_reconciliation_required:
      (input.resume.indeterminateOperationKeys ?? []).length > 0,
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

export { APOLLO_TWO_ROUND_CHECKPOINT_KEY };
export type { ApolloTwoRoundResumeState, ApolloTwoRoundCheckpointV1 };
