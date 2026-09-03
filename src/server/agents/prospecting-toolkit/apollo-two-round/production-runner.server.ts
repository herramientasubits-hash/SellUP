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
import type { NormalizedApolloOrganization } from '../apollo-organizations-response-normalizer';
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
import {
  evaluateApolloSectorRelevanceForPaidOperationAnyOf,
  type ApolloPaidSectorRelevanceDecision,
} from '../apollo-sector-relevance-gate';
// POST-ENRICHMENT-ADMISSION-1 — una subindustria PEDIDA y confirmada tras el
// enrichment satisface la admisión sectorial cuando no hay política legacy para el
// sector padre. Genérica: no mira el nombre del sector.
import {
  resolveApolloSectorPostEnrichmentAdmission,
  type ApolloSectorPostEnrichmentAdmissionResult,
} from '../apollo-sector-post-enrichment-admission';
// MACRO-INDUSTRY-CATALOG-DISCOVERY-1 — taxonomía de la corrida y evidencia macro.
import {
  resolveDiscoveryTaxonomyCapability,
  toDiscoveryTaxonomyMetadata,
} from '@/modules/macro-industry-catalog/discovery-taxonomy-capability';
import {
  assessMacroIndustryEvidence,
  toMacroIndustryEvidenceMetadata,
} from '../apollo-macro-industry-evidence';
// SECTOR-EVIDENCE-BOOTSTRAP-1 — autorización para ADQUIRIR la clasificación que
// `mixed_companies/search` no devuelve. No confirma nada: sólo permite preguntar.
import {
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED,
  combineApolloSectorEvidenceBootstrapAuthorizations,
  evaluateApolloSectorEvidenceBootstrapAuthorization,
  readApolloSectorEvidenceBootstrapPreconditionsFromMetadata,
  // BOOTSTRAP-PURCHASE-GATE-THREADING-1 — la MISMA autorización que dejó competir
  // al candidato, enhebrada hasta el gate que guarda la compra.
  resolveApolloSectorEvidenceBootstrapPurchaseAuthorization,
  toApolloSectorEvidenceBootstrapAuthorizationMetadata,
  type ApolloSectorEvidenceBootstrapAuthorization,
  type ApolloSectorEvidenceBootstrapCandidateReason,
  type ApolloSectorEvidenceBootstrapPurchaseSkipReason,
  type ApolloSectorEvidenceBootstrapPurchaseTrace,
} from '../apollo-sector-evidence-bootstrap';
// § 17 — la traza durable de un candidato que pagó su enrichment y murió antes
// del writer. Sin ella la corrida que existe para CALIBRAR pierde lo que compró.
import {
  APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY,
  buildApolloSectorEvidenceBootstrapAudit,
  toApolloSectorEvidenceBootstrapAuditMetadata,
} from '../apollo-sector-evidence-bootstrap-audit';
import {
  evaluateApolloFreeSectorContradictionAnyOf,
  resolveAllApolloSubindustrySearchMappings,
  type ApolloFreeSectorEvidence,
} from '../apollo-subindustry-search-mapping';
import { toApolloSubindustryQueryCoverageMetadata } from '../apollo-subindustry-query-terms';
import {
  runApolloOrganizationEnrichmentCascade,
  type EnrichmentSkipReason,
} from '../apollo-organization-enrichment-cascade';
import { enrichApolloOrganization } from '@/server/integrations/apollo-client';
import { loadActiveApolloOrganizationEnrichmentPricing } from '@/modules/usage-tracking/provider-pricing';
import { writeProspectingCandidates } from '../candidate-writer';
import type { CandidatePersistenceOutcome } from '../prospect-candidate-persistence-readiness';
// AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — adoption of the existing,
// provider-neutral official-source intake seam (see the module docstring for
// the full seam and the safety rationale).
import { deriveOfficialIdentityForApolloCandidate } from './apollo-shared-intake-bridge';
// Provider-neutral wiring — the SAME resolver factory the Lusha flow uses
// (`lusha-pending-review-actions.ts`), not an Apollo-specific copy.
import { buildColombiaOfficialSourceResolvers } from '@/server/prospect-batches/official-source-resolvers';
import type { ProspectSearchCriteria } from '@/server/agents/prospect-intake';
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
  summarizeApolloSearchPlanPageConsumption,
  type ApolloPageConsumptionOutcome,
  type ApolloSearchPlanPageConsumption,
} from './net-new-page-cursor';
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
// CUT-2 §§ 3, 4 — la demanda residual y su bloque de metadata.
import {
  PROVIDER_RESULT_DEMAND_METADATA_KEY,
  toProviderResultDemandMetadata,
  type ProviderResultDemand,
} from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';
// CUT-2 § 8 — el snapshot de memoria previa, tal y como lo consume el ledger.
import type { ApolloPriorProviderSeen } from '../apollo-organizations-provider-seen';
// MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § D — invariantes de consistencia
// entre las fuentes del estado final. Observacional: nunca lanza.
import {
  evaluateApolloTwoRoundFinalStateConsistency,
  toFinalStateConsistencyMetadata,
} from './run-final-state-consistency';
// AGENT1-APOLLO-FINALIZATION-HARDENING-1 § E — disposición final de CADA
// resultado único, nombrada y mutuamente excluyente.
import {
  evaluateApolloCandidateFinalDispositions,
  toCandidateFinalDispositionsMetadata,
} from './candidate-final-disposition';
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
  // PHASE 2B § 9 — el pliegue sectorial consume el veredicto OPERATIVO.
  projectOperationalSubindustryVerdict,
  type ApolloSubindustryPrecisionAssessment,
  type SubindustryPrecisionEvaluationOptions,
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
import { mapDuplicateStatus, fetchActiveCandidatesForGuard } from '../candidate-writer';
import {
  buildNoveltyIndex,
  buildRecentIdentityKeySet,
  evaluateCandidateNovelty,
  type NoveltyIndex,
} from '../novelty-checker';
// AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY — el evaluador PURO de historia
// pre-pago. Toda la política vive allí; aquí sólo se le pasa la evidencia.
import {
  evaluatePrepaidHistoricalDuplicate,
  type HistoricalCandidateRow,
  type PrepaidHistoricalVerdict,
} from '../apollo-prepaid-historical-parity';
import {
  APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS,
  buildApolloPreWriterBatchAdmissionContext,
  evaluateApolloPreWriterQualityGateForCandidate,
  evaluateCandidatePreWriterAdmission,
  resolveApolloPreWriterEffectiveDomain,
  type ApolloPreWriterBatchAdmissionContext,
  type ApolloPreWriterDbAdmissionContext,
} from '../apollo-pre-writer-target-conditions';
import {
  evaluateCandidateTargetEligibility,
  resolveCandidateSubindustryRequirement,
  type GateVerdict,
  type SubindustryMatchVerdict,
} from '../candidate-completeness-contract';
import type { CompanyFieldMappingStatus } from '../apollo-company-fields-mapping';
import type { ResolveExtraBatchMetadata } from '../writer-metadata-resolution';
import {
  readTwoRoundCheckpoint,
  writeTwoRoundCheckpoint,
  type CheckpointWriteOutcome,
} from './checkpoint.server';
import { hasStrongIdentityDuplicateMatch } from '../strong-identity-duplicate-match';
// AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — valla durable de página.
import {
  readApolloPageFenceEntries,
  upsertApolloPageFenceEntry,
  type ApolloPageFenceIdentity,
  type ApolloPageFenceReadOutcome,
  type ApolloPageFenceWriteOutcome,
} from './page-fence.server';
import {
  toApolloPageFenceOrganization,
  toApolloDurableResumeState,
  type ApolloPageFenceEntry,
} from './page-fence';

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
   * AGENT1-LOCAL-CUT8 · DECISIÓN B — resolver de metadata post-writer. Se reenvía
   * tal cual al writer; esta ruta no lo invoca ni lo compone.
   */
  resolveExtraBatchMetadata?: ResolveExtraBatchMetadata | null;
  /**
   * Créditos que la reserva sostiene. § 2 — la aserción defensiva compara el
   * gasto REGISTRADO contra este número, no contra la estimación.
   */
  reservedCredits: number;
  /**
   * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-2 §§ 3, 4, 5 — la demanda de resultados
   * que la capa previa al pago dejó abierta.
   *
   * 🔴 Recorta cuántas empresas se BUSCAN. No toca `reservedCredits`, que llega
   * por su propio campo desde una estimación que sólo conoce el proveedor y la
   * config (§ 5). Los dos números viajan separados a propósito: acoplarlos
   * afirmaría el modelo de facturación de Apollo, que P0-1 no ha confirmado.
   *
   * Ausente ⇒ la corrida usa el objetivo de la config entero, igual que antes.
   */
  resultDemand?: ProviderResultDemand | null;
  /**
   * CUT-2 §§ 8, 10, 11 — memoria provider-seen de corridas ANTERIORES, cargada
   * por la capa previa al pago y congelada.
   *
   * 🔴 SÓLO medición: no viaja a Apollo (§ 10), no filtra la respuesta y no
   * recorta el objetivo. Alimenta el escalón `provider_seen_hit` del embudo.
   */
  priorProviderSeen?: ApolloPriorProviderSeen | null;
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
  /**
   * ADAPTIVE-EARLY-STOP § 2 — prefetch ÚNICO por corrida de las tres estructuras
   * de base que el writer usa para admitir un candidato: el índice de novedad,
   * el conjunto de identidades en cooldown y las filas activas del Active
   * Duplicate Guard.
   *
   * Existe para que esas tres comprobaciones dejen de estar permanentemente
   * pendientes —lo que dejaba muerta la parada temprana— sin añadir una sola
   * lectura por candidato ni por ronda. Se invoca a lo sumo UNA vez por corrida,
   * de forma perezosa, en la primera evaluación de finalizabilidad.
   *
   * Su contrato es fail-closed: cuando no hay cliente, cuando la consulta falla o
   * cuando el guard degrada, devuelve `degraded: true` y las tres comprobaciones
   * vuelven a declararse PENDIENTES. El writer puede permitirse fail-open —no
   * bloquear una escritura—; una parada de gasto no.
   */
  loadAdmissionPrefetch: (input: {
    domains: readonly string[];
    countryCode: string | null;
  }) => Promise<ApolloPreWriterDbAdmissionContext>;

  /**
   * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY § 4 — la evidencia histórica FUERTE,
   * leída ANTES de pagar.
   *
   * No es una autoridad nueva: es EXACTAMENTE `buildNoveltyIndex`, la misma
   * consulta global y cross-source (por dominio, sin filtro de `source`, sin
   * ventana temporal) que el writer ya ejecutaba DESPUÉS del gasto. Lo único que
   * cambia es CUÁNDO se pregunta.
   *
   * Se invoca a lo sumo una vez por conjunto de dominios (una por ronda), nunca
   * por candidato. Fail-OPEN declarado: `degraded: true` significa «no se puede
   * afirmar nada», y no afirmar nada nunca bloquea un gasto — la misma política
   * que el resto de los gates baratos y que la comprobación de HubSpot (§ 21).
   */
  loadPrepaidHistoricalIndex: (input: {
    domains: readonly string[];
  }) => Promise<{ index: NoveltyIndex; degraded: boolean }>;
  /**
   * AGENT1-APOLLO-FINAL-SAFETY-CLOSURE · PARTE A — valla durable de página,
   * inyectable por la MISMA razón que `loadCheckpoint`/`saveCheckpoint`: para
   * que una suite pueda ejercitar la paginación real sin depender de un
   * cliente Supabase vivo. La wiring por defecto usa las funciones reales de
   * `page-fence.server.ts`; un override en pruebas sustituye el almacén por
   * uno en memoria.
   *
   * Fail-closed por contrato (§ A del corte): `writePageFenceEntry` que
   * resuelve `{kind: 'failed'}` DEBE impedir la petición a Apollo que
   * `beforeRequest` protege — eso lo decide el llamador de este dep, no el dep
   * en sí, que sólo reporta el desenlace.
   *
   * AGENT1-APOLLO-DURABLE-FENCE-HARD-CRASH-FIX · BLOQUEADOR 2 — igual de
   * fail-closed aplica a la LECTURA: `readPageFenceEntries` que resuelve
   * `{kind: 'failed'}` NUNCA se trata como "sin páginas previas". `searchRound`
   * (más abajo) detiene la ronda ANTES de tocar Apollo cuando eso ocurre.
   */
  readPageFenceEntries: (
    batchId: string,
    identity: ApolloPageFenceIdentity,
  ) => Promise<ApolloPageFenceReadOutcome>;
  writePageFenceEntry: (
    batchId: string,
    identity: ApolloPageFenceIdentity,
    entry: ApolloPageFenceEntry,
  ) => Promise<ApolloPageFenceWriteOutcome>;
};

/** § 2 — contexto vacío y DEGRADADO: nada resuelto, todo pendiente. */
export function emptyAdmissionPrefetch(): ApolloPreWriterDbAdmissionContext {
  return {
    coveredDomains: new Set<string>(),
    noveltyIndex: new Map(),
    recentIdentityKeys: new Set<string>(),
    activeCandidates: [],
    degraded: true,
  };
}

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
  decision: ApolloPaidSectorRelevanceDecision,
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
    // SECTOR-EVIDENCE-BOOTSTRAP-1 — estado propio, no un alias del anterior: el
    // motivo por el que se paga es distinto («no hay política y el proveedor no
    // dijo nada» frente a «hay política y el proveedor no dijo nada»), y la
    // auditoría posterior necesita poder distinguirlos.
    case 'sector_evidence_missing_bootstrap_eligible':
      return 'sector_evidence_missing_bootstrap_eligible';
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

/**
 * PHASE 2B § 9 — el pliegue lee el veredicto OPERATIVO, no el diagnóstico.
 *
 * Con las dos reglas de precisión vigentes (`mode: 'full'`) los dos veredictos son
 * el MISMO, término por término, así que este cambio no altera ninguna decisión de
 * hoy. Lo que instala es la frontera: una regla `confirm_only` futura podrá aportar
 * su confirmación sin que sus ramas `ambiguous`/`rejected` —las que no se han
 * calibrado— degraden el estado sectorial, convoquen enrichments o impidan
 * persistir.
 */
export function foldSubindustryPrecisionIntoSectorState(
  base: CandidateSectorEvidenceState,
  precision: ApolloSubindustryPrecisionAssessment,
  options?: SubindustryPrecisionEvaluationOptions,
): CandidateSectorEvidenceState {
  const operational = projectOperationalSubindustryVerdict(precision, options);
  if (!operational.subindustryMapped) return base;
  if (operational.subindustryMatch === 'rejected') return 'sector_evidence_contradictory';
  if (operational.subindustryMatch === 'ambiguous' && base === 'sector_evidence_confirmed') {
    // Ambigua NO cuenta para el objetivo, pero sigue siendo el único estado que
    // puede competir por un enrichment: resolver esa duda es para lo que existe.
    return 'sector_evidence_missing_needs_enrichment';
  }
  return base;
}

/**
 * AGENT1-APOLLO-NET-NEW-PAGINATION § 3 — NOMBRE POR SÍ SOLO NO ES UNA
 * IDENTIDAD HISTÓRICA DECISIVA.
 *
 * El defecto que cierra: cualquier match de los checkers legacy —incluido
 * `possible_duplicate` (contenido de nombre) y un `existing_in_sellup`/
 * `existing_in_hubspot` que resultó ser sólo nombre normalizado + país, SIN
 * dominio ni identificador fiscal— se trataba como bloqueo duro pre-pago,
 * ANTES y por fuera de la autoridad fuerte de este mismo corte
 * (`evaluatePrepaidHistoricalDuplicate`, dominio/identidad fiscal). Dos
 * empresas distintas con el mismo nombre normalizado (matriz/filial,
 * homónimas de países distintos) bloqueaban a un candidato genuinamente
 * nuevo antes de que la verdad histórica fuerte tuviera oportunidad de
 * hablar.
 *
 * `hasStrongIdentityDuplicateMatch` filtra por la CONFIANZA exacta que cada
 * checker ya documenta como derivada de dominio/tax_identifier exacto — nunca
 * por `status` a secas, que mezcla ejes fuertes y de nombre bajo la misma
 * etiqueta. Los checkers compartidos con Lusha (`checkSellUpDuplicates`,
 * `checkHubSpotDuplicates`, `duplicate-checker.ts`) NO se tocan.
 *
 * AGENT1-LUSHA-CUT-L7 — este lector dejó de ser Apollo-scoped: ahora es el
 * lector COMPARTIDO `../strong-identity-duplicate-match`, el MISMO que usan el
 * pre-pago gratuito, Lusha post-pago y la guarda de candidatos activos. La
 * semántica de nombre-vs-identidad no cambia. La única diferencia de veredicto
 * es que `hubspot 95` —identificador fiscal OFICIAL exacto, el mismo eje que
 * `sellup 92`— pasa a contar como identidad fuerte; antes se omitía de la lista
 * y una empresa que HubSpot ya tenía con ese identificador podía comprarse otra
 * vez. El cambio va en la dirección conservadora y NO afecta a ningún eje de
 * nombre.
 */
export function readDuplicateVerdict(
  candidate: ProspectingPipelineCandidate,
): { sellUpDuplicate: boolean; hubSpotDuplicate: boolean } {
  const matches = candidate.duplicateCheck?.matches ?? [];

  return {
    sellUpDuplicate: hasStrongIdentityDuplicateMatch(matches, 'sellup'),
    hubSpotDuplicate: hasStrongIdentityDuplicateMatch(matches, 'hubspot'),
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
    // § 2 — UNA sola llamada por corrida; dentro, las tres lecturas que el writer
    // ya hacía, con los MISMOS constructores. Nada por candidato, nada por ronda.
    loadAdmissionPrefetch: async ({ domains, countryCode }) => {
      const { tryGetAdminClientForTwoRound } = await import('./checkpoint.server');
      const client = tryGetAdminClientForTwoRound();
      if (!client) return emptyAdmissionPrefetch();
      const normalized = [
        ...new Set(
          domains
            .map((domain) => (domain ? normalizeDomain(domain) : null))
            .filter((domain): domain is string => domain !== null),
        ),
      ];
      try {
        const [noveltyIndex, recentIdentityKeys, guard] = await Promise.all([
          buildNoveltyIndex(client, normalized),
          buildRecentIdentityKeySet(client),
          fetchActiveCandidatesForGuard(client, normalized, countryCode),
        ]);
        return {
          coveredDomains: new Set(normalized),
          noveltyIndex,
          recentIdentityKeys,
          activeCandidates: guard.records,
          // El guard degrada fail-open para el writer; aquí una degradación
          // significa que no se puede afirmar nada, y no afirmar nada es pendiente.
          degraded: guard.status === 'degraded',
        };
      } catch {
        return emptyAdmissionPrefetch();
      }
    },
    // § 4 — una sola lectura por conjunto de dominios, con el helper que YA
    // existía. Cero consultas nuevas por candidato y cero créditos.
    loadPrepaidHistoricalIndex: async ({ domains }) => {
      const { tryGetAdminClientForTwoRound } = await import('./checkpoint.server');
      const client = tryGetAdminClientForTwoRound();
      if (!client) return { index: new Map(), degraded: true };
      const normalized = [
        ...new Set(
          domains
            .map((domain) => (domain ? normalizeDomain(domain) : null))
            .filter((domain): domain is string => domain !== null),
        ),
      ];
      if (normalized.length === 0) return { index: new Map(), degraded: false };
      try {
        return { index: await buildNoveltyIndex(client, normalized), degraded: false };
      } catch {
        return { index: new Map(), degraded: true };
      }
    },
    readPageFenceEntries: (batchId, identity) => readApolloPageFenceEntries(batchId, identity),
    writePageFenceEntry: (batchId, identity, entry) =>
      upsertApolloPageFenceEntry(batchId, identity, entry),
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

  /**
   * ADAPTIVE-EARLY-STOP § 5 — último veredicto sectorial conocido por candidato.
   *
   * Existe porque el cupo COMPLETE-FIRST y la dedupe intra-lote son propiedades
   * del LOTE, no del candidato que el orquestador está preguntando: para
   * ordenarlos hace falta la completitud proyectada de TODOS, y la completitud
   * depende del veredicto sectorial de cada uno. El orquestador sólo entrega el
   * del candidato en curso, así que se guarda a medida que llega. Nunca se
   * adivina: un candidato del que nadie informó todavía se trata como
   * `sector_evidence_missing_needs_enrichment`, que es el estado que NO cuenta.
   */
  const sectorEvidenceStateByKey = new Map<string, CandidateSectorEvidenceState>();

  /**
   * SECTOR-EVIDENCE-BOOTSTRAP-1 — autorización de la corrida para ADQUIRIR la
   * evidencia clasificatoria que `mixed_companies/search` no devuelve.
   *
   * Se acumula por ronda a partir de las precondiciones que el provider OBSERVÓ en
   * la búsqueda que emitió, y se combinan en conjunción: basta que una ronda saliera
   * con la pregunta equivocada para que la corrida deje de autorizar gasto
   * adicional. Sin ninguna ronda, no autorizada — el estado inicial y el
   * fail-closed.
   *
   * Consecuencia declarada: un reintento que se recupera de un checkpoint SIN
   * emitir búsqueda nueva no tiene precondiciones que observar y no autoriza
   * adquisición. Puede costar candidatos; nunca créditos.
   */
  /**
   * MACRO-INDUSTRY-CATALOG-DISCOVERY-1 § 13 — la taxonomía de ESTA corrida.
   *
   * Se resuelve una vez, de la versión de catálogo con la que se resolvió la
   * selección, y gobierna la vía de admisión de todos los candidatos. Nunca se
   * deriva de `input.subindustries.length`: ese array ya podía llegar vacío en el
   * catálogo legacy y usarlo como interruptor habría cambiado de camino a toda
   * búsqueda v1 que no acotara por subindustria.
   */
  const discoveryTaxonomy = resolveDiscoveryTaxonomyCapability(input.selectionCatalogVersion);

  const searchBootstrapAuthorizations: ApolloSectorEvidenceBootstrapAuthorization[] = [];
  const registerSearchBootstrapPreconditions = (output: WebSearchOutput): void => {
    const preconditions = readApolloSectorEvidenceBootstrapPreconditionsFromMetadata(
      output.metadata,
    );
    searchBootstrapAuthorizations.push(
      preconditions === null
        ? APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED
        : evaluateApolloSectorEvidenceBootstrapAuthorization(preconditions),
    );
  };
  const sectorEvidenceBootstrapAuthorization = (): ApolloSectorEvidenceBootstrapAuthorization =>
    combineApolloSectorEvidenceBootstrapAuthorizations(searchBootstrapAuthorizations);
  /**
   * § 17 — candidatos que quedaron elegibles para ADQUIRIR evidencia, con su
   * motivo, tal como se evaluaron ANTES de gastar.
   *
   * Aparte de `sectorEvidenceStateByKey` porque ese mapa guarda el veredicto MÁS
   * RECIENTE, y tras el enrichment el estado de bootstrap ya no existe: sin este
   * registro, una auditoría posterior no podría responder «este candidato se
   * enriqueció porque la búsqueda no traía clasificación».
   */
  const bootstrapEligibleReasonByKey = new Map<
    string,
    ApolloSectorEvidenceBootstrapCandidateReason
  >();
  /**
   * POST-ENRICHMENT-ADMISSION-1 § 20 — cómo cruzó cada candidato el gate sectorial.
   *
   * Aparte de `sectorEvidenceStateByKey` por la misma razón que
   * `bootstrapEligibleReasonByKey`: ese mapa guarda el estado RESULTANTE, y desde
   * `sector_evidence_confirmed` no se puede saber si lo confirmó la política legacy
   * o una hija pedida. La auditoría necesita responder «este candidato cruzó porque
   * EPS, que se pidió, quedó confirmada tras el enrichment».
   */
  const sectorAdmissionByKey = new Map<string, ApolloSectorPostEnrichmentAdmissionResult>();

  /**
   * BOOTSTRAP-PURCHASE-GATE-THREADING-1 § 14 — qué pasó en el GATE DE COMPRA de
   * cada candidato seleccionado.
   *
   * Existe porque los seis estados del recorrido —elegible, seleccionado,
   * autorizado a comprar, intentado, ejecutado, y por qué no— colapsaban en dos:
   * `selection_rank` y `enrichment_status`. La forense de `74a49b01` tuvo que
   * hacer un replay pinneado al SHA de producción para descubrir que el gate
   * decía `sector_not_mapped`, porque ese motivo no se persistía en ningún sitio.
   *
   * No abre una verdad paralela: aterriza dentro del bloque de bootstrap que ya
   * describe este gasto.
   */
  const authorizedBootstrapPurchaseKeys = new Set<string>();
  const bootstrapPurchaseTraceByKey = new Map<string, MutablePurchaseTrace>();

  /**
   * § 2 — el prefetch de admisión, UNA sola vez por corrida y de forma perezosa.
   *
   * Perezosa y no al arrancar porque los dominios del lote no existen hasta que
   * la primera ronda devuelve. Se dispara en la primera evaluación de
   * finalizabilidad —es decir, antes de la primera decisión de parada— y a
   * partir de ahí toda lectura reutiliza la misma promesa: cero consultas por
   * ronda y cero por candidato.
   *
   * Consecuencia declarada: los candidatos cuyo dominio no estaba en el lote
   * cuando se disparó el prefetch (los que trae una ronda posterior) conservan
   * sus tres comprobaciones de base PENDIENTES, así que no pueden sostener una
   * parada. Es la dirección segura, y no añade ni una lectura.
   */
  /**
   * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY § 4 — la evidencia histórica de la
   * corrida, cargada PEREZOSAMENTE y por CONJUNTO DE DOMINIOS.
   *
   * Perezosa porque los dominios no existen hasta que una ronda devuelve, y por
   * conjunto porque `evidenceByKey` ya contiene TODA la ronda cuando se evalúa a
   * su primer candidato (`searchRound` la puebla antes de que el orquestador
   * llame a `assessCandidate`). El resultado: una lectura por ronda —a lo sumo
   * dos por corrida—, cero por candidato.
   *
   * Un dominio que quede fuera de la cobertura NO se declara nuevo en silencio:
   * dispara su propia carga. Un fallo de lectura marca la evidencia como
   * indisponible y el veredicto pasa a ser fail-open (§ 21).
   */
  const historicalRowsByDomain = new Map<string, HistoricalCandidateRow[]>();
  const historicalCoveredDomains = new Set<string>();
  let historicalEvidenceDegraded = false;
  let historicalLoads = 0;

  const collectRunDomains = (): string[] => {
    const domains = new Set<string>();
    for (const snapshot of evidenceByKey.values()) {
      // El snapshot ya trae el dominio resuelto; `url` es el respaldo cuando la
      // búsqueda no lo declaró por separado.
      const raw = snapshot.domain ?? snapshot.url ?? null;
      const normalized = raw ? normalizeDomain(raw) : null;
      if (normalized) domains.add(normalized);
    }
    return [...domains];
  };

  const ensurePrepaidHistoricalEvidence = async (
    normalizedDomain: string | null,
  ): Promise<{ rows: HistoricalCandidateRow[]; degraded: boolean }> => {
    // Sin dominio no hay eje fuerte que consultar: no se lee nada y no se afirma
    // nada. El nombre solo no puede bloquear un gasto (§ 7).
    if (normalizedDomain === null) {
      return { rows: [], degraded: historicalEvidenceDegraded };
    }
    if (!historicalCoveredDomains.has(normalizedDomain)) {
      const pending = [...new Set([...collectRunDomains(), normalizedDomain])].filter(
        (domain) => !historicalCoveredDomains.has(domain),
      );
      historicalLoads++;
      const loaded = await deps
        .loadPrepaidHistoricalIndex({ domains: pending })
        .catch(() => ({ index: new Map() as NoveltyIndex, degraded: true }));
      if (loaded.degraded) {
        historicalEvidenceDegraded = true;
      } else {
        for (const domain of pending) {
          historicalCoveredDomains.add(domain);
          historicalRowsByDomain.set(domain, (loaded.index.get(domain) ?? []) as HistoricalCandidateRow[]);
        }
      }
    }
    return {
      rows: historicalRowsByDomain.get(normalizedDomain) ?? [],
      degraded: !historicalCoveredDomains.has(normalizedDomain),
    };
  };

  /**
   * § 6 — las DOS políticas, combinadas con un OR y sin fusionarse.
   *
   * `evaluateCandidateNovelty` responde la novedad de ENTREGA con sus cooldowns
   * de `discarded` intactos (30 d revisado / 90 d sin revisar). El evaluador
   * pre-pago responde el COSTE: una fila que ocupa el lote con identidad fuerte
   * ya prueba que la empresa se conocía, sin importar su edad.
   */
  const prepaidHistoricalVerdictByKey = new Map<string, PrepaidHistoricalVerdict>();

  const evaluatePrepaidHistory = async (
    candidateKey: string,
    normalizedDomain: string | null,
    name: string | null,
    website: string | null,
  ): Promise<PrepaidHistoricalVerdict> => {
    const evidence = await ensurePrepaidHistoricalEvidence(normalizedDomain);
    const index: NoveltyIndex = new Map();
    if (normalizedDomain !== null && evidence.rows.length > 0) {
      index.set(normalizedDomain, evidence.rows as never);
    }
    const deliveryNovelty =
      evidence.degraded || normalizedDomain === null
        ? null
        : evaluateCandidateNovelty({ name: name ?? '', domain: normalizedDomain, website }, index);
    const verdict = evaluatePrepaidHistoricalDuplicate({
      needle: {
        normalizedDomain,
        name,
        // Apollo no devuelve identificador fiscal en la búsqueda: el eje existe y
        // se evalúa, pero hoy no aporta coincidencias en esta ruta. No se inventa
        // ninguno para rellenarlo.
        taxIdentifier: null,
        countryCode: input.countryCode,
      },
      rows: evidence.rows,
      deliveryNoveltyShouldSkip: deliveryNovelty?.shouldSkip === true,
      evidenceUnavailable: evidence.degraded,
    });
    prepaidHistoricalVerdictByKey.set(candidateKey, verdict);
    return verdict;
  };

  let admissionPrefetchPromise: Promise<ApolloPreWriterDbAdmissionContext> | null = null;
  const ensureAdmissionPrefetch = (): Promise<ApolloPreWriterDbAdmissionContext> => {
    // La memoización ES el contrato: la promesa se guarda antes de resolverse, así
    // que dos lecturas concurrentes comparten UNA sola llamada.
    if (admissionPrefetchPromise !== null) return admissionPrefetchPromise;
    const domains = [...assessmentByKey.values()]
      .map((cached) => resolveApolloPreWriterEffectiveDomain(cached.candidate))
      .filter((domain): domain is string => domain !== null && domain !== '');
    admissionPrefetchPromise = deps
      .loadAdmissionPrefetch({ domains, countryCode: input.countryCode })
      .catch(() => emptyAdmissionPrefetch());
    return admissionPrefetchPromise;
  };

  /**
   * Las SIETE condiciones del contrato canónico (menos `persistence_success`)
   * leídas de su fuente real, exactamente como las leerá el writer.
   *
   * Se extrae de `readCandidateTargetConditions` porque tiene un segundo
   * llamador: la proyección de completitud que ordena el cupo COMPLETE-FIRST
   * (§ 5) necesita el mismo veredicto para TODOS los candidatos del lote, no
   * sólo para el que el orquestador está preguntando.
   *
   * Puro y gratis: cero llamadas al proveedor, cero créditos, cero lecturas de
   * base. Sólo lee lo que la corrida ya construyó.
   */
  const readContractConditions = (
    candidateKey: string,
    sectorEvidenceState: CandidateSectorEvidenceState,
  ): {
    subindustryMatch: SubindustryMatchVerdict;
    employeeCountStatus: CompanyFieldMappingStatus;
    linkedinStatus: CompanyFieldMappingStatus;
    duplicateStatus: string | null;
    ownershipGate: GateVerdict;
    qualityGate: GateVerdict;
  } | null => {
    const cached = assessmentByKey.get(candidateKey) ?? null;
    if (cached === null) return null;
    const candidate = cached.candidate;
    const subindustry = resolveCandidateSubindustryRequirement({
      sectorEvidenceState,
      requestedSubindustries: input.subindustries,
      subindustryPrecision: subindustryPrecisionByKey.get(candidateKey) ?? null,
    });
    const ownership = evaluateCompanyOwnership(
      candidate.name,
      candidate.website ?? null,
      candidate.domain ?? null,
    );
    const quality = evaluateApolloPreWriterQualityGateForCandidate(candidate, {
      targetCountryCode: input.countryCode,
      subindustries: input.subindustries,
    });
    return {
      subindustryMatch: subindustry.eligibilityVerdict,
      employeeCountStatus:
        candidate.providerCompanyFields?.employeeCount.status ?? 'mapping_failed',
      linkedinStatus: candidate.providerCompanyFields?.linkedin.status ?? 'mapping_failed',
      duplicateStatus: mapDuplicateStatus(candidate.duplicateCheck?.status ?? 'unchecked'),
      ownershipGate: isBlockedByCompanyOwnership(ownership) ? 'fail' : 'pass',
      qualityGate: quality.verdict,
    };
  };

  /**
   * § 5 — completitud PROYECTADA de un candidato, sin las comprobaciones de
   * admisión. Es lo que decide su grupo en el cupo COMPLETE-FIRST.
   *
   * No incluye las admisiones a propósito: si las incluyera, el cupo dependería
   * del cupo. La pregunta que responde es «¿este candidato contaría hacia el
   * objetivo si se persistiera?», que es exactamente la que el § 5 usa para
   * ordenar.
   */
  const projectCompleteValidIfPersisted = (candidateKey: string): boolean => {
    const conditions = readContractConditions(
      candidateKey,
      sectorEvidenceStateByKey.get(candidateKey) ?? 'sector_evidence_missing_needs_enrichment',
    );
    if (conditions === null) return false;
    return evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      ...conditions,
    }).countsTowardTargetIfPersisted;
  };

  /**
   * §§ 4 y 5 — contexto de lote sobre TODOS los candidatos ya construidos.
   *
   * Se recalcula en cada lectura porque su respuesta cambia con cada enrichment
   * pagado: un crédito que resuelve `employee_count` mueve a su candidato al
   * grupo COMPLETE y puede desplazar a otro fuera del cupo. Es aritmética pura
   * sobre como mucho diez candidatos —el tope de resultados crudos de la
   * corrida—, sin I/O y sin créditos.
   */
  const buildBatchAdmissionContext = (): ApolloPreWriterBatchAdmissionContext =>
    buildApolloPreWriterBatchAdmissionContext({
      candidates: [...assessmentByKey.entries()].map(([key, cached]) => ({
        candidateKey: key,
        candidate: cached.candidate,
        completeValidIfPersisted: projectCompleteValidIfPersisted(key),
      })),
      context: {
        targetCountryCode: input.countryCode,
        subindustries: input.subindustries,
      },
      // El writer aplica exactamente este cupo (`targetPersistibleCandidates`).
      targetCap: config.targetEligibleCompanies,
    });

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

    // AGENT1-APOLLO-NET-NEW-PAGINATION-LIVE-WIRING — el ÚNICO cableado que
    // faltaba: `apollo-organizations-search-provider.ts` ya sabe paginar de
    // verdad dentro de una sola invocación cuando recibe `netNewTarget` Y
    // `evaluateCandidateAcceptance` (los dos), pero ningún llamador de
    // producción se los pasaba — cada ronda seguía siendo una sola página.
    //
    // `netNewTarget` reutiliza `requestedResultLimit` tal cual: en
    // `orchestrator.ts` ese valor YA es `Math.max(1, boundByRemainingTarget(
    // config.maxResultsPerRound, <hueco residual de esta ronda>))` — el mínimo
    // entre el hueco que falta para el objetivo y el techo de volumen propio de
    // la ronda (`config.maxResultsPerRound`). Es exactamente la demanda de
    // negocio de ESTA ronda; no hace falta (ni se debe) recalcular el hueco
    // aquí con una segunda cuenta paralela.
    //
    // `evaluateCandidateAcceptance` decide, EN VIVO y por candidato mientras la
    // página todavía se está pidiendo, si cuenta como net-new. Usa la misma
    // verdad histórica fuerte que `evaluatePrepaidHistory` más abajo
    // (`evaluatePrepaidHistoricalDuplicate` sobre `loadPrepaidHistoricalIndex`),
    // pero con caché POR DOMINIO y ámbito de ESTA ronda: `buildNoveltyIndex` es
    // por diseño una consulta por CONJUNTO de dominios (no puede "traer todo"
    // sin dominios), así que no hay forma de precargar los dominios de páginas
    // que Apollo todavía no devolvió. Lo que sí se evita es leer el MISMO
    // dominio dos veces dentro de la misma ronda — cachear es lo máximo que se
    // puede adelantar sin tocar `apollo-organizations-paginated-search.ts`
    // (que llama al evaluador UNA vez por candidato, secuencialmente, y no
    // puede lotearse por página sin cambiar ese motor, fuera de alcance de este
    // corte). Esta lectura es DISTINTA de la que hace `evaluatePrepaidHistory`
    // más abajo en `assessCandidate` — ésa sigue corriendo sin cambios DESPUÉS
    // de que la búsqueda ya volvió, como parte de la cadena canónica completa.
    // La doble lectura por dominio (aquí y en `assessCandidate`) es un costo
    // aceptado y explícito: sin ella, la paginación no tendría con qué
    // distinguir un candidato genuinamente nuevo de un duplicado histórico
    // mientras todavía está en curso.
    //
    // Fail-open, igual que el resto de los gates baratos: un dominio ausente o
    // una lectura degradada nunca detiene la paginación por sí sola, sólo deja
    // de poder afirmar que ESE candidato es duplicado.
    const roundHistoricalRowsCache = new Map<string, HistoricalCandidateRow[]>();
    const roundHistoricalDegradedDomains = new Set<string>();
    const evaluateCandidateAcceptance = async (
      organization: NormalizedApolloOrganization,
    ): Promise<boolean> => {
      const normalizedDomain = organization.primaryDomain;
      // § 7 de `apollo-prepaid-historical-parity.ts` — sin dominio no hay eje
      // fuerte que consultar: no se lee nada y no se afirma nada. Se trata
      // como net-new (fail-open), igual que `evaluatePrepaidHistory`.
      if (normalizedDomain === null) return true;

      let rows = roundHistoricalRowsCache.get(normalizedDomain);
      let degraded = roundHistoricalDegradedDomains.has(normalizedDomain);
      if (rows === undefined && !degraded) {
        const loaded = await deps
          .loadPrepaidHistoricalIndex({ domains: [normalizedDomain] })
          .catch(() => ({ index: new Map() as NoveltyIndex, degraded: true }));
        if (loaded.degraded) {
          degraded = true;
          roundHistoricalDegradedDomains.add(normalizedDomain);
        } else {
          rows = (loaded.index.get(normalizedDomain) ?? []) as HistoricalCandidateRow[];
          roundHistoricalRowsCache.set(normalizedDomain, rows);
        }
      }

      const verdict = evaluatePrepaidHistoricalDuplicate({
        needle: {
          normalizedDomain,
          name: organization.name,
          // Apollo no trae identificador fiscal en la búsqueda — igual que en
          // `evaluatePrepaidHistory`, el eje existe y se evalúa, pero no se
          // inventa ningún valor para rellenarlo.
          taxIdentifier: null,
          countryCode: input.countryCode,
        },
        rows: rows ?? [],
        evidenceUnavailable: degraded,
      });
      return !verdict.alreadyKnown;
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
      // CUT-2 §§ 8, 10 — el snapshot PREVIO viaja con la búsqueda, para MEDIR.
      // Ausente ⇒ el embudo publica `provider_seen_hit: null` con su motivo.
      //
      // 🔴 No es una exclusión: nada de esto entra en el body que sale hacia
      // Apollo. El request efectivo se construye abajo y no lee este campo, y su
      // huella —que es la que se compara— tampoco cambia por su presencia.
      ...(input.priorProviderSeen ? { priorProviderSeen: input.priorProviderSeen } : {}),
      // AGENT1-APOLLO-NET-NEW-PAGINATION-LIVE-WIRING — los DOS juntos activan
      // paginación real dentro de esta invocación (ver comentario arriba).
      netNewTarget: requestedResultLimit,
      evaluateCandidateAcceptance,
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
        // A1-APOLLO-NET-NEW-PAGINATION-V2 — la huella del body efectivo SIN
        // `page`, tal como el contrato ya la calcula. Es la MISMA que la
        // búsqueda paginada publica como `request_fingerprint`, porque las dos
        // salen de `buildApolloOrganizationsRequestContract` sobre los mismos
        // filtros y el mismo `per_page`. Identifica el PLAN, no la página.
        searchPlanFingerprint: effective.filtersFingerprint,
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

      // AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING PARTE B — valla durable de
      // página. `fenceIdentity` reutiliza la MISMA identidad que el checkpoint
      // de ronda: un documento de otra corrida no puede prestar sus páginas.
      const fenceIdentity = {
        idempotencyKey: input.correlation.idempotencyKey,
        requestFingerprint: input.correlation.requestFingerprint,
      };
      const roundNumber = operationContext.roundNumber;
      // § B7/C13 — sólo las entradas de ESTA ronda: round1/pageN y
      // round2/pageN nunca se confunden, aunque compartan número de página.
      const fenceReadOutcome = await deps.readPageFenceEntries(input.reservedBatchId, fenceIdentity);

      // AGENT1-APOLLO-DURABLE-FENCE-HARD-CRASH-FIX · BLOQUEADOR 2 — una
      // lectura que falló NUNCA se trata como "sin páginas previas": no hay
      // forma de saber qué ya se intentó, así que Apollo no se toca en esta
      // invocación. Mismo idioma que `budgetExceeded()` más arriba en esta
      // misma función — cero organizaciones, cero peticiones, cero créditos —
      // salvo que aquí el motivo se deja explícito en `warnings` para que no
      // se confunda con "la ronda no hacía falta".
      if (fenceReadOutcome.kind === 'failed') {
        warnings.push(`apollo_page_fence_read_failed:${fenceReadOutcome.reason}`);
        return { organizations: [], providerRequestCount: 0, internalRecordedCredits: 0 };
      }

      const fenceEntriesForRound = fenceReadOutcome.entries.filter(
        (entry): entry is ApolloPageFenceEntry => entry.round_number === roundNumber,
      );
      const durableResume = toApolloDurableResumeState(fenceEntriesForRound);

      const searchOptionsWithFence: ApolloOrgsSearchOptions = {
        ...searchOptions,
        durableResume,
        durablePageFence: {
          beforeRequest: async ({ page, requestFingerprint }) => {
            const outcome = await deps.writePageFenceEntry(input.reservedBatchId, fenceIdentity, {
              round_number: roundNumber,
              search_plan_fingerprint: requestFingerprint,
              page,
              status: 'request_started',
              organizations: [],
              // § B10/B11 — la posible página ya salió hacia Apollo cuando esta
              // valla se escribe. 1, no 0: nunca se representa un cobro posible
              // como definitivamente gratis.
              credits: 1,
              results_returned: 0,
              total_pages: null,
              accepted_count: null,
            });
            // AGENT1-APOLLO-FINAL-SAFETY-CLOSURE · PARTE A — `upsertApolloPageFenceEntry`
            // nunca lanza: reporta el fallo como `{kind: 'failed'}` (ver
            // `page-fence.server.ts`). Ese resultado debe LANZAR aquí, porque
            // `runApolloOrganizationsPaginatedSearch` sólo trata como
            // fail-closed lo que esta función lanza — un `return` silencioso
            // sobre un fallo dejaría la petición a Apollo salir sin registro,
            // exactamente el defecto que este corte cierra.
            if (outcome.kind === 'failed') {
              throw new Error(`durable_page_fence_write_failed: ${outcome.reason}`);
            }
          },
          onSucceeded: async ({
            page,
            requestFingerprint,
            organizations,
            credits,
            resultsReturned,
            totalPages,
            acceptedCount,
          }) => {
            const outcome = await deps.writePageFenceEntry(input.reservedBatchId, fenceIdentity, {
              round_number: roundNumber,
              search_plan_fingerprint: requestFingerprint,
              page,
              status: 'succeeded',
              organizations: organizations.map(toApolloPageFenceOrganization),
              credits,
              results_returned: resultsReturned,
              total_pages: totalPages,
              accepted_count: acceptedCount,
            });
            // BLOQUEADOR 3 — igual que `beforeRequest`: un fallo AQUÍ debe
            // LANZAR, porque sólo lo que esta función lanza detiene la
            // paginación (`durable_fence_terminal_write_failed`). Un `return`
            // silencioso dejaría que se pidiera la página siguiente aunque el
            // desenlace de ÉSTA se haya quedado en `request_started` durable —
            // posiblemente cobrada, nunca confirmada.
            if (outcome.kind === 'failed') {
              throw new Error(`durable_page_fence_terminal_write_failed: ${outcome.reason}`);
            }
          },
          onIndeterminate: async ({ page, requestFingerprint }) => {
            await deps.writePageFenceEntry(input.reservedBatchId, fenceIdentity, {
              round_number: roundNumber,
              search_plan_fingerprint: requestFingerprint,
              page,
              status: 'indeterminate',
              organizations: [],
              // § B10 — mismo motivo que `beforeRequest`: el desenlace de esta
              // página nunca se confirmó, así que su exposición se conserva en
              // 1, nunca se asienta en 0.
              credits: 1,
              results_returned: 0,
              total_pages: null,
              accepted_count: null,
            });
            // BLOQUEADOR 3 — a diferencia de `onSucceeded`, no hace falta
            // inspeccionar el desenlace de esta escritura para detener la
            // paginación: `onIndeterminate` sólo se invoca cuando la
            // clasificación del error ya es `retryable: false` (ver el
            // comentario en `apollo-organizations-paginated-search.ts`), así
            // que el motor YA se detiene para esta página sin importar si esta
            // escritura tuvo éxito. La verdad conservadora que protege el
            // reintento es el `request_started` que `beforeRequest` ya dejó
            // durable.
          },
        },
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
        searchOptionsWithFence,
      );
      searchOutputs.push(output);
      // SECTOR-EVIDENCE-BOOTSTRAP-1 — la autorización se acumula desde las búsquedas
      // REALMENTE emitidas. Una ronda saltada, en dry-run o bloqueada por el gate de
      // gasto no aporta autorización alguna.
      registerSearchBootstrapPreconditions(output);

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
        // V2 — qué páginas de qué plan quedaron consumidas. Es lo que permite
        // que la ronda siguiente del MISMO plan arranque donde ésta terminó.
        consumedPages: readApolloSearchPlanPageConsumption(output),
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
      // SECTOR-EVIDENCE-BOOTSTRAP-1 — un sector sin política deja de ser un rechazo
      // incondicional CUANDO la corrida está autorizada y el proveedor no declaró
      // clasificación alguna. Sigue sin confirmar nada: sólo permite preguntar.
      const bootstrapAuthorization = sectorEvidenceBootstrapAuthorization();
      const eligibility = evaluateApolloEnrichmentEligibility(result, {
        targetCountryCode: input.countryCode,
        sector: input.industry,
        subindustries: input.subindustries,
        sectorEvidenceBootstrap: bootstrapAuthorization,
        domainsInCooldown: negativeMemory.excludedDomains,
      });

      const sector = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
        result,
        input.industry,
        input.subindustries,
        { sectorEvidenceBootstrap: bootstrapAuthorization },
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
      // ADAPTIVE-EARLY-STOP § 5 — el veredicto queda disponible para la
      // proyección de completitud del LOTE, no sólo para este candidato.
      sectorEvidenceStateByKey.set(key, sectorEvidenceState);
      // § 17 — por qué este candidato puede competir sin política de sector.
      if (
        sectorEvidenceState === 'sector_evidence_missing_bootstrap_eligible' &&
        sector.bootstrap?.bootstrapEligible === true
      ) {
        bootstrapEligibleReasonByKey.set(key, sector.bootstrap.reason);
      }

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

      /**
       * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY § 4, § 10, § 12, § 13 — la
       * evidencia histórica FUERTE, consultada ANTES de pagar.
       *
       * Este es el punto que cierra el corte: `assessCandidate` es el último
       * lugar donde una decisión es todavía gratuita. Un `rejection` aquí saca al
       * candidato de `globalFreeSignals`, y con ello de la selección de
       * enrichment, del ranking final y de `persisted`/`reviewOnly`. Es decir:
       *
       *   0 llamadas de enrichment · 0 filas nuevas · 0 accepted-for-target
       *
       * Antes esta misma verdad se conocía —el writer la aplicaba en Pass 4— pero
       * llegaba DESPUÉS del crédito.
       */
      const prepaidHistory = await evaluatePrepaidHistory(
        key,
        identity.normalizedDomain,
        organization.name ?? null,
        built.candidate.website ?? null,
      );
      const historicallyKnown = prepaidHistory.alreadyKnown;

      const signals: CheapAssessment['signals'] = {
        countryCompatible: eligibility.eligible || eligibility.skipReason !== 'country_mismatch',
        domainConfident: identity.normalizedDomain !== null,
        ownershipConfident: eligibility.eligible && eligibility.domainSource === 'asserted',
        sectorKeywordMatchCount: sector.matchedTerms.length,
        novel: !knownDuplicate && !cooldownActive && !historicallyKnown,
        hasCompanySizeSignal: readHasEmployeeCount(result),
        hasLocationSignal: readHasLocation(result),
        hasLinkedInUrl: identity.normalizedLinkedInUrl !== null,
        freeOfContradictoryEvidence: sectorEvidenceState !== 'sector_evidence_contradictory',
        knownDuplicate,
        // Una empresa ya entregada es, a todos los efectos del ranking, una
        // sugerencia previa. No se abre una señal paralela.
        cooldownActive: cooldownActive || historicallyKnown,
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
      } else if (cooldownActive || historicallyKnown) {
        // Mismo motivo canónico: «sugerida antes». No se introduce un código
        // nuevo en la taxonomía por una autoridad nueva sobre el mismo hecho.
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
        noPriorSuggestion: !cooldownActive && !historicallyKnown,
      };
    },

    enrichCandidate: async ({ candidateKey, identity, operationContext }) => {
      // BOOTSTRAP-PURCHASE-GATE-THREADING-1 — la autorización que dejó competir a
      // este candidato viaja hasta el gate que guarda la COMPRA.
      //
      // Se acuña AQUÍ y no en el ámbito de la corrida a propósito: el orquestador
      // sólo invoca este hook para los candidatos que su selección eligió, así que
      // acuñarla en este punto la ata a la selección; y el resolutor la ata además
      // al candidato (exige el motivo que el gate barato REGISTRÓ para él) y al cap
      // (nunca más autorizaciones que enrichments permite la corrida). Un booleano
      // de corrida habría autorizado a los 20 de `74a49b01`; esto autoriza a los
      // <= 5 que compitieron.
      const purchaseDecision = resolveApolloSectorEvidenceBootstrapPurchaseAuthorization({
        runAuthorization: sectorEvidenceBootstrapAuthorization(),
        cheapGateBootstrapReason: bootstrapEligibleReasonByKey.get(candidateKey) ?? null,
        authorizedPurchasesSoFar: authorizedBootstrapPurchaseKeys.size,
        maxAuthorizedPurchases: config.maxEnrichmentsPerRun,
      });
      if (purchaseDecision.authorized) authorizedBootstrapPurchaseKeys.add(candidateKey);
      const purchaseTrace: MutablePurchaseTrace = {
        decision: purchaseDecision,
        cascadeInvoked: false,
        skipReason: null,
        cascadeIneligibilityReason: null,
      };
      bootstrapPurchaseTraceByKey.set(candidateKey, purchaseTrace);

      /**
       * § 6 — una operación pagada que NUNCA se intentó no puede degradar el
       * estado del candidato.
       *
       * Hasta este hito `notExecuted` afirmaba `sector_evidence_missing_needs_
       * enrichment` sin importar por qué no se ejecutó, y el orquestador lo
       * asignaba incondicionalmente: en `74a49b01` los 5 mejores candidatos
       * quedaron DEGRADADOS de `bootstrap_eligible` a `needs_enrichment` por una
       * compra que nunca ocurrió. El estado de un candidato al que no se le compró
       * nada es el que ya tenía — nada pudo haberlo movido.
       */
      const notExecuted = (
        skipReason: ApolloSectorEvidenceBootstrapPurchaseSkipReason,
      ): EnrichmentResult => {
        purchaseTrace.skipReason = skipReason;
        return {
          executed: false,
          sectorEvidenceState:
            sectorEvidenceStateByKey.get(candidateKey) ??
            'sector_evidence_missing_needs_enrichment',
          internalRecordedCredits: 0,
        };
      };

      // Sin pricing activo el enrichment no se ejecuta. Sin presupuesto tampoco.
      if (!enrichmentAllowed) return notExecuted('enrichment_pricing_unavailable');
      if (budgetExceeded()) return notExecuted('budget_exhausted');

      const result = readEvidenceResult(evidenceByKey, candidateKey);
      if (!result) return notExecuted('candidate_evidence_unavailable');
      if (identity.normalizedDomain === null) return notExecuted('candidate_domain_missing');

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
      purchaseTrace.cascadeInvoked = true;
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
            // BOOTSTRAP-PURCHASE-GATE-THREADING-1 — el campo que faltaba. Sin él
            // el gate de compra volvía a juzgar sin autorización y un sector sin
            // política salía `sector_not_mapped`: 5 seleccionados, 0 ejecutados.
            sectorEvidenceBootstrap: purchaseDecision.authorization,
          },
        },
      );

      const entry = cascade.meta.entries[0];
      // Misma regla que la ruta legacy: una llamada REAL ocurrió si la entrada
      // quedó enriquecida o si falló después de haber salido. Un `cap_reached`,
      // un `missing_domain` o un `eligibility_blocked` no gastaron nada, así que
      // no generan fila económica.
      if (entry === undefined || !(entry.enriched === true || entry.skip_reason === 'enrichment_failed')) {
        purchaseTrace.cascadeIneligibilityReason = entry?.ineligibility_reason ?? null;
        return notExecuted(toBootstrapPurchaseSkipReason(entry?.skip_reason ?? null));
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
      //
      // SECTOR-EVIDENCE-BOOTSTRAP-1 — DELIBERADAMENTE sin autorización de
      // adquisición. El bootstrap autoriza a PREGUNTAR, y la pregunta ya se hizo:
      // pasado el enrichment el candidato se juzga con el contrato normal. Si el
      // perfil comprado trajo clasificación, el veredicto sale de ella; si no trajo
      // nada y el sector sigue sin política, vuelve a ser `sector_not_mapped` — que
      // es la verdad («pagamos y seguimos sin poder juzgar este sector») y garantiza
      // que el estado de bootstrap sea INTERMEDIO y jamás un estado final.
      const sector = evaluateApolloSectorRelevanceForPaidOperationAnyOf(
        enrichedResult,
        input.industry,
        input.subindustries,
        { sectorEvidenceBootstrap: APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_UNAUTHORIZED },
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
      const foldedSectorEvidenceState = foldSubindustryPrecisionIntoSectorState(
        toSectorEvidenceState(sector.decision),
        enrichedPrecision,
      );
      // POST-ENRICHMENT-ADMISSION-1 — el hueco que quedaba abierto tras #274: el
      // crédito compra la clasificación, la precisión CONFIRMA la subindustria que
      // el usuario pidió, y el sector vuelve a `sector_not_mapped` porque no hay
      // política legacy para el padre. Eso es un rechazo terminal por una política
      // AUSENTE, no por evidencia en contra.
      //
      // Sólo actúa en ese hueco: con política legacy presente el veredicto de
      // siempre manda, y un estado ya medido —confirmado, contradicho, pendiente—
      // sale intacto. El pliegue de arriba conserva su invariante de sólo degradar.
      //
      // MACRO-INDUSTRY-CATALOG-DISCOVERY-1 §§ 10 y 12 — en la taxonomía macro la
      // evidencia se evalúa AQUÍ, sobre el perfil ya comprado, y nunca sobre el
      // resultado de búsqueda: es lo que impide que la cobertura de consulta se
      // convierta en evidencia de admisión.
      const macroIndustryEvidence =
        discoveryTaxonomy.mode === 'macro_industry'
          ? assessMacroIndustryEvidence({
              result: enrichedResult,
              macroIndustryDisplayName: input.industry,
            })
          : null;
      const sectorAdmission = resolveApolloSectorPostEnrichmentAdmission({
        postEnrichmentSectorState: foldedSectorEvidenceState,
        legacySectorPolicyPresent: sector.sectorPolicyPresent,
        // Un `no_match` o un `enrichment_failed` llegan hasta aquí y NO compraron
        // perfil: su precisión se evaluó sobre la evidencia de búsqueda.
        candidateEnriched: entry.enriched === true,
        requestedSubindustries: input.subindustries,
        precision: enrichedPrecision,
        catalogAuthorization: sectorEvidenceBootstrapAuthorization(),
        taxonomyMode: discoveryTaxonomy.mode,
        macroIndustryEvidence,
      });
      sectorAdmissionByKey.set(candidateKey, sectorAdmission);
      const sectorEvidenceState = sectorAdmission.sectorEvidenceState;
      // ADAPTIVE-EARLY-STOP § 5 — el veredicto que el crédito acaba de comprar
      // entra en la proyección de completitud del LOTE, que es lo que reordena el
      // cupo COMPLETE-FIRST.
      sectorEvidenceStateByKey.set(candidateKey, sectorEvidenceState);

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

      // STABLE-TARGET-WRITER-PARITY § 5 — lo que este crédito RESOLVIÓ de los
      // campos obligatorios, leído de la captura ya re-capturada más arriba
      // (`withRecapturedProviderCompanyFields`), que es la misma que persistirá
      // el writer. Sin esto, el orquestador seguiría creyendo que a La Canasta le
      // falta `employee_count` después de haberlo comprado, y gastaría los
      // enrichments restantes buscando un objetivo ya alcanzado.
      const enrichedCompanyFields =
        assessmentByKey.get(candidateKey)?.candidate.providerCompanyFields ?? null;

      return {
        executed: outcome === 'charged',
        sectorEvidenceState,
        internalRecordedCredits: credits,
        ...(postEnrichmentRejection !== null ? { postEnrichmentRejection } : {}),
        ...(outcome === 'no_match' ? { noMatch: true } : {}),
        ...(enrichedCompanyFields
          ? {
              providerCompanyFields: {
                employeeCountStatus: enrichedCompanyFields.employeeCount.status,
                linkedinStatus: enrichedCompanyFields.linkedin.status,
              },
            }
          : {}),
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

    /**
     * STABLE-TARGET-WRITER-PARITY § 1 — las condiciones del contrato canónico
     * con los MISMOS datos que leerá el writer.
     *
     * Es la pieza que elimina la doble semántica de objetivo. Hasta este hito el
     * orquestador contaba «elegibles» —gates baratos limpios y sector
     * confirmado— y el writer contaba «complete_valid» —además: subindustria
     * demostrada, `employee_count`, LinkedIn, duplicidad y calidad—. La corrida
     * `bdc51c49` confirmó a La Canasta y Surtifamiliar por nombre comercial, sin
     * `employee_count`: elegibles aquí, `needs_review` allí. Con la cuenta laxa
     * decidiendo el gasto, una corrida podía darse por cerrada en 5 con 3 filas
     * que contaran.
     *
     * Cada condición se lee de su fuente REAL, ninguna se supone:
     *
     *   subindustry_match     ← `resolveCandidateSubindustryRequirement` sobre la
     *                           misma precisión y las mismas subindustrias
     *                           PEDIDAS que usa el writer (preserva #241: sin
     *                           catálogo, `unmapped`, y no cuenta)
     *   employee_count/linkedin ← `providerCompanyFields`, la misma captura que
     *                           el writer persiste, ya re-capturada si un
     *                           enrichment la resolvió
     *   duplicate_status      ← `mapDuplicateStatus`, la función del writer
     *   ownership_gate        ← `evaluateCompanyOwnership`, la del writer
     *   quality_gate          ← los gates propios del writer que sólo dependen
     *                           del candidato (encaje de negocio, política de
     *                           evidencia, tamaño ICP)
     *
     * Cero llamadas al proveedor y cero créditos: todo es lectura de lo que la
     * corrida ya construyó.
     *
     * Sin candidato construido, TODO queda pendiente: sin nada que evaluar no se
     * inventa un veredicto, y un pendiente nunca cuenta hacia el objetivo (§ 2).
     *
     * ── ADAPTIVE-EARLY-STOP §§ 2, 3, 4, 5 y 6 ─────────────────────────────────
     *
     * Las TRECE comprobaciones de admisión del writer se resuelven aquí, cada una
     * con la función que el writer usa:
     *
     *   ocho deterministas y puras ← `evaluateApolloPreWriterDeterministicGates`
     *   tres respaldadas por base  ← un ÚNICO prefetch por corrida (§ 2)
     *   dos de lote                ← dedupe intra-lote y cupo COMPLETE-FIRST (§§ 4, 5)
     *
     * Lo que NO cambia respecto del addendum anterior: lo que no se puede
     * resolver sigue declarándose PENDIENTE, y un pendiente sigue sin contar. La
     * diferencia es que ahora quedan pendientes por una causa concreta —no hay
     * prefetch, el prefetch degradó, o el dominio quedó fuera de su cobertura— en
     * vez de estarlo siempre por construcción, que era lo que dejaba muerta la
     * parada temprana en producción.
     */
    readCandidateTargetConditions: async ({ candidateKey, sectorEvidenceState }) => {
      sectorEvidenceStateByKey.set(candidateKey, sectorEvidenceState);
      const cached = assessmentByKey.get(candidateKey) ?? null;
      if (cached === null) {
        // Sin candidato construido no hay nada que evaluar: las siete condiciones
        // del contrato y las trece admisiones quedan sin resolver.
        return {
          subindustryMatch: 'unknown',
          employeeCountStatus: 'mapping_failed',
          linkedinStatus: 'mapping_failed',
          duplicateStatus: null,
          ownershipGate: 'unknown',
          qualityGate: 'unknown',
          pendingConditions: [
            'subindustry_match',
            'employee_count_status',
            'linkedin_status',
            'duplicate_status',
            'ownership_gate',
            'quality_gate',
          ],
          unresolvedWriterOnlyAdmissionChecks: APOLLO_PENDING_PRE_WRITER_ADMISSION_CHECKS,
        };
      }

      const candidate = cached.candidate;
      const contract = readContractConditions(candidateKey, sectorEvidenceState)!;

      const dbContext = await ensureAdmissionPrefetch();
      const admission = evaluateCandidatePreWriterAdmission({
        candidateKey,
        candidate,
        context: {
          targetCountryCode: input.countryCode,
          subindustries: input.subindustries,
        },
        dbContext,
        batchContext: buildBatchAdmissionContext(),
      });

      return {
        ...contract,
        // § 6 — resueltas y negativas por un lado, sin resolver por otro. Las dos
        // impiden contar; sólo la segunda es un pendiente.
        unresolvedWriterOnlyAdmissionChecks: admission.pendingChecks,
        failedWriterOnlyAdmissionChecks: admission.failedChecks,
        resolvedWriterOnlyAdmissionChecks: admission.passedChecks,
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
      // CUT-2 §§ 4, 6, 7 — UN solo hueco para las dos rondas. El orquestador lo
      // descuenta según avanza; la ronda 2 nunca lo reinicia.
      remainingTarget: input.resultDemand?.remainingTarget ?? null,
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

  // AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — official-source search criteria for
  // the shared intake seam. Built once per run, not per candidate; the resolver
  // set (read-only Colombia co_siis) is also built once and reused across every
  // candidate this run persists.
  //
  // `ProspectSearchCriteria.subindustry` is intentionally left unset here: it
  // is a single string field and a wizard run can request several
  // subindustries — reading only `subindustries[0]` is the exact anti-pattern
  // `agent1-subindustry-fail-closed-target-integrity-1.test.ts` guards
  // against elsewhere in this file. The Colombia resolver's `canResolve` /
  // `resolve` never branch on `subindustry` (only country + candidate name),
  // so omitting it costs nothing today; a future resolver that does need it
  // should carry the FULL list, not the first element.
  const officialSourceCriteria: ProspectSearchCriteria = {
    country: input.country,
    countryCode: input.countryCode,
    sector: input.industry,
  };
  const officialSourceResolvers = buildColombiaOfficialSourceResolvers();

  /**
   * AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — runs the shared, provider-neutral
   * official-source seam (adapter → normalize → official enrichment) on an
   * already-built Apollo candidate, AFTER the cheap pre-spend dedupe and paid
   * enrichment have already run. When a strong tax identity is found, also
   * re-runs the EXISTING tax-aware duplicate checker and lets its result
   * override the candidate's `duplicateCheck` — the writer already derives
   * `duplicate_status` / `matched_account_id` / `matched_hubspot_company_id`
   * purely from that field, so no writer change is needed for the recheck to
   * take effect.
   */
  const withOfficialSourceIdentity = async (
    built: ProspectingPipelineCandidate,
    evidence: WebSearchResult | null,
  ): Promise<ProspectingPipelineCandidate> => {
    const outcome = await deriveOfficialIdentityForApolloCandidate({
      candidate: built,
      webSearchResult: evidence,
      criteria: officialSourceCriteria,
      resolvers: officialSourceResolvers,
    });
    return {
      ...built,
      officialSourceIdentity: {
        officialSourceMetadata: outcome.officialSourceMetadata,
        typedColumns: outcome.typedColumns,
        strongIdentityAvailable: outcome.strongIdentityAvailable,
      },
      ...(outcome.strongDuplicateRecheck
        ? { duplicateCheck: outcome.strongDuplicateRecheck }
        : {}),
    };
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
      const evidenceForOfficialSource = readEvidenceResult(evidenceByKey, entry.candidateKey);
      const cached = assessmentByKey.get(entry.candidateKey);
      if (cached) {
        // El veredicto sectorial de la modalidad viaja con el candidato: es lo
        // que permite al writer distinguir `subindustry_match = confirmed` de
        // «nadie lo evaluó», sin volver a llamar al gate ni al proveedor.
        const withIdentity = await withOfficialSourceIdentity(
          {
            ...cached.candidate,
            sectorEvidenceState: entry.sectorEvidenceState,
            providerEnrichmentCapture: capture,
          },
          evidenceForOfficialSource,
        );
        resolved.push(withIdentity);
        continue;
      }
      const evidence = evidenceForOfficialSource;
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
      const withIdentity = await withOfficialSourceIdentity(
        { ...rebuilt.candidate, providerEnrichmentCapture: capture },
        evidence,
      );
      resolved.push(withIdentity);
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

  /**
   * SECTOR-EVIDENCE-BOOTSTRAP-1 § 17 — la traza que permite auditar este gasto sin
   * una segunda fuente de verdad: la autorización de la corrida, quién quedó
   * elegible para adquirir evidencia y por qué, quién recibió el enrichment, en qué
   * puesto del ranking, y en qué estado sectorial terminó.
   *
   * Sólo códigos estáticos y claves de candidato — las mismas que ya viajan en
   * `enrichment_snapshots`. Sin nombres de empresa, sin secretos.
   */
  const bootstrapSelectionRankByKey = new Map<string, number>();
  runResult.enrichmentSelections.forEach((selection, index) => {
    if (!bootstrapSelectionRankByKey.has(selection.candidateKey)) {
      bootstrapSelectionRankByKey.set(selection.candidateKey, index + 1);
    }
  });
  // La disposición terminal se recalcula aquí en vez de recibirse: la proyección
  // es PURA sobre `runResult` y `buildObservabilityMetadata` la vuelve a hacer con
  // la misma entrada, así que las dos no pueden discrepar. Pasarla por parámetro
  // sólo añadiría un acoplamiento entre dos proyecciones independientes.
  const bootstrapAudit = buildApolloSectorEvidenceBootstrapAudit({
    bootstrapEligibleReasonByKey,
    selectionRankByKey: bootstrapSelectionRankByKey,
    enrichmentStatusByKey,
    evidenceByKey,
    precisionByKey: subindustryPrecisionByKey,
    sectorEvidenceStateByKey,
    sectorAdmissionByKey,
    purchaseTraceByKey: bootstrapPurchaseTraceByKey,
    finalDispositions: evaluateApolloCandidateFinalDispositions(runResult),
  });
  const bootstrapObservability = {
    [APOLLO_SECTOR_EVIDENCE_BOOTSTRAP_METADATA_KEY]: {
      ...toApolloSectorEvidenceBootstrapAuthorizationMetadata(
        sectorEvidenceBootstrapAuthorization(),
      ),
      bootstrap_eligible_count: bootstrapAudit.length,
      bootstrap_selected_for_enrichment_count: bootstrapAudit.filter(
        (candidate) => candidate.selectedForEnrichment,
      ).length,
      // BOOTSTRAP-PURCHASE-GATE-THREADING-1 § 14 — los dos escalones que faltaban
      // entre «seleccionado» y «ejecutado». `74a49b01` cerró con 5 y 0 en esos
      // extremos y nada explicaba el hueco: era este gate.
      bootstrap_purchase_authorized_count: bootstrapAudit.filter(
        (candidate) => candidate.purchase?.decision.authorized === true,
      ).length,
      bootstrap_purchase_attempted_count: bootstrapAudit.filter(
        (candidate) => candidate.purchase?.cascadeInvoked === true,
      ).length,
      // Distinto de «seleccionado»: un cupo puede gastarse y volver `no_match` o
      // quedar indeterminado. Para calibrar Wave 1 sólo cuenta lo que se ejecutó.
      bootstrap_enrichment_executed_count: bootstrapAudit.filter(
        (candidate) => candidate.enrichmentExecuted,
      ).length,
      // POST-ENRICHMENT-ADMISSION-1 § 20 — cuántos cruzaron el gate sectorial por
      // una subindustria PEDIDA y confirmada, en vez de por política legacy. Es la
      // cifra que dice si la vía nueva sirvió de algo en esta corrida.
      sector_admitted_by_requested_subindustry_precision_count: bootstrapAudit.filter(
        (candidate) =>
          candidate.sectorAdmission?.admittedByRequestedSubindustryPrecision === true,
      ).length,
      // MACRO-INDUSTRY-CATALOG-DISCOVERY-1 § 12 — la cifra equivalente para la
      // taxonomía macro: cuántos cruzaron el gate porque la evidencia comprada
      // CONFIRMÓ la macro industria pedida. Cero en toda corrida legacy.
      sector_admitted_by_confirmed_macro_industry_evidence_count: bootstrapAudit.filter(
        (candidate) =>
          candidate.sectorAdmission?.admissionSource === 'confirmed_macro_industry_evidence',
      ).length,
      // Reparto de veredictos macro, para calibrar sin volver a gastar (§ 17 de
      // #274 aplicado a la taxonomía nueva).
      macro_industry_evidence_verdicts: bootstrapAudit.reduce<Record<string, number>>(
        (acc, candidate) => {
          const verdict = candidate.sectorAdmission?.macroIndustryEvidence?.verdict;
          if (verdict) acc[verdict] = (acc[verdict] ?? 0) + 1;
          return acc;
        },
        {},
      ),
      candidates: toApolloSectorEvidenceBootstrapAuditMetadata(bootstrapAudit),
    },
    // MACRO-INDUSTRY-CATALOG-DISCOVERY-1 § 8 — bajo qué taxonomía corrió el lote.
    apollo_discovery_taxonomy: toDiscoveryTaxonomyMetadata(discoveryTaxonomy),
    // Muestra del veredicto macro por candidato admitido, sin nombres de empresa.
    apollo_macro_industry_evidence_samples: bootstrapAudit
      .map((candidate) => candidate.sectorAdmission?.macroIndustryEvidence ?? null)
      .filter((assessment): assessment is NonNullable<typeof assessment> => assessment !== null)
      .slice(0, 5)
      .map(toMacroIndustryEvidenceMetadata),
  };

  const runObservability = buildObservabilityMetadata({
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

  const observability = { ...bootstrapObservability, ...runObservability };

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
        // CUT-2 §§ 4, 6 — qué objetivo gobernó de verdad esta corrida y de dónde
        // salió. Sin esto, un lote con tres candidatos donde el usuario pidió diez
        // se lee como un fallo de recall en vez de como un hueco ya cerrado gratis.
        ...(input.resultDemand
          ? {
              [PROVIDER_RESULT_DEMAND_METADATA_KEY]: toProviderResultDemandMetadata(
                input.resultDemand,
              ),
            }
          : {}),
        ...observability,
      },
      // CUT-8 · DECISIÓN B — la costura viaja hasta el writer sin tocarse.
      resolveExtraBatchMetadata: input.resolveExtraBatchMetadata ?? null,
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

  // § E — disposición final de cada resultado único. Se calcula sobre el
  // resultado del orquestador, es decir ANTES del writer (ver el docstring del
  // módulo): las provisionalmente persistidas todavía pueden caer por calidad,
  // duplicado activo o fallo de escritura, y ESE desenlace lo sigue contando
  // `persistence_reconciliation` — agregado, no por candidato.
  const candidateFinalDispositions = evaluateApolloCandidateFinalDispositions(runResult);

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
      //
      // CANDIDATE-OPERABILITY-VALIDATION-1 § H — este bloque se llamaba
      // `final_state_consistency` y llevaba `computed_at: 'pre_writer'` para
      // avisar de que no era final. La etiqueta no bastaba: la corrida `b3afe066`
      // publicó `final_state_consistency.ok = false` con `unclassified = 1`
      // mientras `candidate_final_dispositions` cerraba 17/17 con
      // `unclassified_count = 0` y `unexplained_gap = 0`. Dos bloques con el mismo
      // nombre semántico y veredictos opuestos: quien leía «final» leía el
      // diagnóstico intermedio.
      //
      // Ahora el nombre dice cuándo se midió. `final_state_consistency` lo escribe
      // la pasada POST-writer (`reconcileApolloTwoRoundPersistedTruth`), que es la
      // única que ha visto filas.
      pre_writer_state_consistency: {
        ...toFinalStateConsistencyMetadata(finalStateConsistency),
        computed_at: 'pre_writer' as const,
      },
      // § E — universo completo de resultados únicos, cada uno con una
      // disposición nombrada. `unclassified_count` debe ser 0 en toda corrida.
      candidate_final_dispositions: toCandidateFinalDispositionsMetadata(
        candidateFinalDispositions,
      ),
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

/**
 * BOOTSTRAP-PURCHASE-GATE-THREADING-1 § 14 — la traza mientras se escribe.
 *
 * El registro público es de sólo lectura; el runner la construye por pasos (se
 * autoriza, se invoca el cascade, se conoce el desenlace) y por eso su versión
 * interna es mutable. Fuera de este módulo nadie la muta.
 */
type MutablePurchaseTrace = {
  -readonly [K in keyof ApolloSectorEvidenceBootstrapPurchaseTrace]: ApolloSectorEvidenceBootstrapPurchaseTrace[K];
};

/**
 * Traduce el motivo de salto del cascade al vocabulario del gate de compra.
 *
 * Explícito y exhaustivo a propósito: un motivo NUEVO del cascade tiene que
 * aparecer aquí, no colarse como «sin entrada». Una traza que miente sobre por
 * qué no se compró es peor que no tenerla.
 */
function toBootstrapPurchaseSkipReason(
  skipReason: EnrichmentSkipReason | null,
): ApolloSectorEvidenceBootstrapPurchaseSkipReason {
  switch (skipReason) {
    case 'eligibility_blocked':
      return 'cascade_eligibility_blocked';
    case 'cap_reached':
      return 'cascade_cap_reached';
    case 'missing_domain':
      return 'cascade_missing_domain';
    case 'cascade_disabled':
      return 'cascade_disabled';
    default:
      return 'cascade_returned_no_entry';
  }
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
 * A1-APOLLO-NET-NEW-PAGINATION-V2 — lee, del metadata que la búsqueda paginada
 * ya publica, qué páginas dejó consumidas y de qué PLAN de búsqueda.
 *
 * No añade ninguna medición nueva: `apollo_pagination.page_outcomes` es el
 * registro por página que el motor ya emitía, y `apollo_pagination.request_fingerprint`
 * es la huella del body efectivo SIN `page` (el ancla idempotente de la
 * paginación). Este lector sólo los cruza.
 *
 * `null` cuando no hay desenlaces por página —una búsqueda saltada, un doble de
 * test que no los emite—: sin evidencia no hay cursor, y el llamador conserva el
 * comportamiento previo al corte en vez de suponer una página. La huella sí es
 * opcional: cuando falta, el llamador atribuye las páginas al plan que ESA ronda
 * construyó, que es el único plan que pudo haberlas pedido.
 */
export function readApolloSearchPlanPageConsumption(
  output: WebSearchOutput,
): ApolloSearchPlanPageConsumption | null {
  const metadata = (output.metadata ?? {}) as Record<string, unknown>;
  const pagination = metadata['apollo_pagination'] as
    | { request_fingerprint?: unknown; page_outcomes?: unknown }
    | undefined;
  const rawOutcomes = pagination?.page_outcomes;
  if (!Array.isArray(rawOutcomes)) return null;
  const rawFingerprint = pagination?.request_fingerprint;
  const fingerprint =
    typeof rawFingerprint === 'string' && rawFingerprint.length > 0 ? rawFingerprint : null;

  const outcomes: ApolloPageConsumptionOutcome[] = [];
  for (const raw of rawOutcomes) {
    if (raw === null || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const page = entry['page'];
    const status = entry['status'];
    const billingState = entry['billing_state'] ?? entry['billingState'];
    if (typeof page !== 'number' || !Number.isFinite(page)) continue;
    if (
      status !== 'success' &&
      status !== 'error' &&
      status !== 'rate_limited' &&
      status !== 'indeterminate'
    ) {
      continue;
    }
    outcomes.push({
      page,
      status,
      // Un desenlace sin estado de cobro legible NO se lee como «no cobrada»:
      // `unknown` es la lectura conservadora, y deja la página consumida.
      billingState:
        billingState === 'not_charged' || billingState === 'charged' ? billingState : 'unknown',
    });
  }

  return summarizeApolloSearchPlanPageConsumption(fingerprint, outcomes);
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
