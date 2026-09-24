/**
 * Lusha → pending-review persistence — pure core (Q3F-5BB.4 · duplicate parity Q3F-5BB.7)
 *
 * Turns a Lusha company-prospecting result into a pending-review prospect batch
 * plus candidate rows. This module is PURE + fully dependency-injected: it does
 * NO I/O of its own. Every write flows through the injected `reserveBatch` /
 * `insertCandidates` deps, so it is STRUCTURALLY impossible for it to touch
 * accounts, HubSpot, enrichment, `provider_usage_logs` or `agent_runs` — those
 * write dependencies simply do not exist here.
 *
 * Q3F-5BB.7 adds DUPLICATE PARITY with the canonical Tavily/candidate-writer flow
 * BEFORE candidates are persisted, via two READ-ONLY injected deps:
 *   - `checkCompanyDuplicate`  → canonical SellUp + HubSpot duplicate checker.
 *   - `fetchActiveCandidates`  → canonical active-candidate prefetch (read-only).
 * These are strictly read-only: they can only detect duplicates, never create or
 * mutate anything. The active-candidate guard itself is the canonical pure
 * function `checkActiveCandidateDuplicate` (no I/O), imported directly.
 *
 * Authorized scope (Q3F-5BB.4 + Q3F-5BB.7):
 *   - DB writes limited to prospect_batches + prospect_candidates (two deps).
 *   - Never creates accounts/companies; never calls HubSpot WRITE / enrichment.
 *   - Lusha runs exactly once via the injected `runSearch`, backed by the same
 *     read-only `executeLushaPreview` core → page 0 / size 10 / ≤1 credit.
 *   - On Lusha failure OR zero usable companies: NO writes at all.
 *   - Dedupe by normalized domain (fallback normalized name) — the preview
 *     already marks in-batch domain duplicates; here we drop them before insert.
 *   - Duplicate parity: for every deduped company we run the canonical SellUp +
 *     HubSpot duplicate check and the active-candidate guard, then persist the
 *     real `duplicate_status`, `matched_account_id`, `matched_hubspot_company_id`
 *     and a `source_trace` describing what ran. Strong active-candidate matches
 *     (same active domain / same inferred identity) are SKIPPED, exactly like the
 *     canonical writer.
 *   - Never persists raw provider payloads or secrets.
 */

import {
  resolveLushaDiscardDisposition,
  classifyLushaExactDuplicateSource,
  type LushaDiscardEvent,
} from '@/modules/prospect-discards/lusha-mapping';
import type { DiscardDispositionCode } from '@/modules/prospect-discards/types';
import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
// AGENT1-CUT3B23 §§ 5/6/8 — el MISMO constructor de evidencia de identidad y el
// MISMO registro de lote que usan las otras dos rutas de escritura de Agente 1.
//
// 🔴 Esto NO sustituye a `lusha-run-identity-registry`: aquél dedupea la CORRIDA
// del proveedor (todas las páginas de todas las ramas) ANTES de pagar, y es
// específico de Lusha. Éste dedupea el LOTE entre capas, en la admisión. Son dos
// preguntas distintas y las dos siguen vivas.
import { buildCompanyIdentityEvidence } from '@/server/agents/prospecting-toolkit/company-identity-evidence';
import {
  admitByBatchIdentity,
  createBatchIdentityRegistry,
  tallyBatchIdentityPersisted,
  toBatchIdentityCountersMetadata,
  type BatchIdentityRegistry,
} from '@/server/agents/prospecting-toolkit/batch-identity-registry';
// AGENT1-CUT3B4 § 22 — sólo el TIPO del desenlace vallado. Este núcleo sigue sin
// tener I/O propio: la RPC la ejecuta la dependencia inyectada.
import type { FencedCandidateInsertResult } from './batch-identity-fence';
// 🔴 CUT9A-FIX — la conjunción que autoriza la ruta anterior a B4 se REUTILIZA, no
// se reescribe: es la MISMA autoridad que usan los otros dos escritores.
import {
  isProvenFenceCapabilityAbsent,
  type FenceCapabilityEvidence,
} from './batch-identity-fenced-persistence';
import type { LushaCanonicalBatchReservation } from './lusha-canonical-batch';
// AGENT1-LOCAL-CUT9B — la publicación DURABLE de la aceptación. Este núcleo sigue
// SIN I/O propio: importa el TIPO del desenlace y el TIPO del proyector, y la
// escritura la ejecuta la dependencia inyectada, igual que las otras tres.
import type { BatchMetadataPublicationResult } from './batch-metadata-fenced-publication';
import type { ResolveExtraBatchMetadata } from '@/server/agents/prospecting-toolkit/writer-metadata-resolution';
// AGENT1-LOCAL-CUT9 §§ 3, 4 — el tipo CANÓNICO de aceptación hacia el objetivo,
// importado SÓLO como tipo. El núcleo no lo calcula: quien lo resuelve es
// `resolveAcceptedForTarget` en la acción, que es la única aritmética de la
// corrida. Aquí sólo se declara el campo por el que viaja para que no nazca una
// segunda forma del mismo hecho.
import type { AcceptedForTargetResult } from '@/modules/prospect-batches/accepted-for-target';
import { isLinkedInCompanyUrl } from '@/modules/prospect-batches/candidate-linkedin-url';
import {
  checkActiveCandidateDuplicate,
  type ActiveCandidateRecord,
  type DuplicateGuardInput,
  type DuplicateGuardMatch,
} from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
// AGENT1-LUSHA-CUT-L7 — el lector COMPARTIDO de fuerza de identidad. El mismo
// que usan el pre-pago gratuito, la guarda de activos y Apollo.
import {
  classifyDuplicateIdentityEvidence,
  findStrongIdentityDuplicateMatch,
  findWeakIdentityDuplicateMatch,
  isStrongActiveGuardReason,
  isWeakActiveGuardReason,
} from '@/server/agents/prospecting-toolkit/strong-identity-duplicate-match';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import {
  normalizeDomain,
  type LushaPreviewCompany,
  type LushaPreviewInput,
  type LushaPreviewResult,
} from './lusha-preview';
// Q3F-5BB.10C2 — shared, provider-agnostic intake pipeline (pure). The barrel path
// carries no forbidden substring; every function here is pure and every side
// effect (official-source reads) arrives through an INJECTED resolver, so the core
// stays free of supabase/env/fetch. See src/server/agents/prospect-intake/.
import {
  mapLushaCompanyToProviderDiscoveredCompany,
  normalizeProviderDiscoveredCompany,
  evaluateProspectIntakeGate,
  buildProspectIntakeGateAuditEntry,
  enrichNormalizedProspectWithOfficialSources,
  buildOfficialSourceEnrichmentMetadata,
  buildOfficialSourceTypedColumns,
  type LushaRawCompany,
  type ProspectSearchCriteria,
  type NormalizedProspectCandidate,
  type EnrichedProspectCandidateIdentity,
  type OfficialSourceResolver,
  type ProspectIntakeGateResult,
} from '@/server/agents/prospect-intake';
// Q3F-5BB.11D — additive provider-routing metadata (pure 11B/11C contract). The
// barrel path carries no forbidden substring; every helper is pure (no env, no
// I/O, no provider client). Used ONLY to stamp OBSERVATIONAL routing metadata on
// the batch + candidates; it never decides eligibility or executes anything.
import {
  buildProviderAttemptMetadata,
  buildCandidateProviderTraceMetadata,
  mergeProviderRoutingBatchMetadata,
  mergeCandidateProviderMetadata,
  type ProviderRoutingMetadata,
  type ProviderRoutingPlan,
} from '@/modules/prospect-batches/provider-routing';
// AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 — los tres módulos puros que este
// orquestador OBEDECE. Ninguno tiene env, I/O, cliente de proveedor ni DB:
//   · limits    — los topes por rama (extraídos de aquí; se re-exportan abajo).
//   · execution — targetGap, techo de peticiones, techo de filas y telemetría.
//   · identity  — el registro de identidad compartido por TODA la corrida.
import {
  LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
  LUSHA_PENDING_REVIEW_MAX_PAGES,
  LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS,
} from './lusha-pending-review-limits';
import {
  boundAcceptedByUnconfirmedWrites,
  evaluateLushaSurvivorCompleteness,
  resolveLushaRunAcceptanceTruth,
  type LushaRunAcceptanceFacts,
  type SurvivorCompletenessInput,
} from './lusha-run-acceptance-truth';
import {
  LUSHA_RUN_MAX_RAW_RESULTS,
  decideLushaProviderRequest,
  resolveLushaExecutionBranches,
  resolveLushaProviderRequestsAllowed,
  resolveLushaRemainingGap,
  resolveLushaTargetGap,
  toLushaRunTelemetryMetadata,
  type LushaBranchOutcome,
  type LushaBranchTelemetry,
  type LushaExecutionBranch,
  type LushaRunStopReason,
  type LushaRunTelemetry,
} from './lusha-multibranch-execution';
// AGENT1-LUSHA-CUT-L5 §§ 2-9 — el contrato de BLOQUES de facturación de Lusha
// Prospecting y el contraste esperado ↔ real. Módulo puro: sin env, sin red, sin
// DB. No sustituye a `billing.creditsCharged`, que sigue siendo la liquidación.
import { resolveLushaRunMaxProviderCredits } from './lusha-run-liability';
import {
  evaluateLushaProspectingBillingContrast,
  LUSHA_PROSPECTING_BILLING_BLOCK_SIZE,
  LUSHA_PROSPECTING_PAGE_SIZE,
  shouldStopPaidPaginationOnBillingContrast,
  type LushaProspectingBillingContrast,
} from '@/server/integrations/lusha-prospecting-contract';
// AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 17-19 — la SEGUNDA puerta de
// paginación: la primera pregunta si queda hueco y quedan peticiones; ésta mira
// lo que la página YA PAGADA rindió. Vive en `prepaid-novelty` porque es política
// neutral de proveedor, no una regla de Lusha.
import { decidePaidPageContinuation } from '@/modules/prospect-batches/prepaid-novelty/paid-page-novelty-continuation';
// ADDENDUM PROVIDER-SEEN §§ 4, 10 — la memoria de lo ya pagado nace AQUÍ, en el
// único punto del ejecutor donde consta una respuesta VÁLIDA del proveedor.
import { planProviderSeenRecording } from '@/modules/prospect-batches/provider-seen/provider-seen-recording';
import {
  countProviderSeenHits,
  EMPTY_PROVIDER_SEEN_MEMORY,
  type ProviderSeenMemory,
} from '@/modules/prospect-batches/provider-seen/provider-seen-identity';
import type {
  ProviderSeenLoadSummary,
  ProviderSeenPageYield,
} from '@/modules/prospect-batches/provider-seen/provider-seen-telemetry';
import type { ProviderExclusionPlan } from '@/modules/prospect-batches/provider-seen/provider-exclusion-planner';
import type { PrePaidFreeSourceOutcome } from '@/modules/prospect-batches/prepaid-novelty/prepaid-novelty-context';
import type {
  ProviderSeenWriteInput,
  ProviderSeenWriteResult,
} from '@/server/prospect-batches/provider-seen/provider-seen-store';
import {
  createLushaRunIdentityRegistry,
  dedupeLushaCompaniesByIdentity,
  normalizeLushaCompanyName,
  // 🔴 AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION § 4 — la supresión de conocidos
  // se siembra en el registro que YA existe. No hay un segundo registro.
  seedLushaKnownDomains,
  type LushaIdentityDuplicateReason,
  type LushaRunIdentityRegistry,
} from './lusha-run-identity-registry';
import type { LushaIndustryBranch, LushaMacroSearchPlan } from './lusha-macro-search-plan';
// AGENT1-LUSHA-FIRST-LIVE-QA-P0-FIX-1 §§ 3, 5, 7 — la autoridad de PRECISIÓN de
// macro industria, branch-aware y apoyada en el catálogo canónico. Módulo puro.
import {
  assessLushaMacroPrecision,
  describeLushaBranchProvenance,
  isLushaMacroPrecisionAdmitted,
  toLushaMacroPrecisionMetadata,
  type LushaBranchProvenance,
  type LushaMacroPrecisionAssessment,
} from './lusha-macro-precision';
// § 12 — el MISMO evaluador de tamaño ICP que el escritor canónico de Agente 1.
// Puro y determinista; no se inventa un segundo gate de tamaño.
import {
  evaluateIcpSizeGate,
  ICP_SIZE_GATE_DEFAULT_THRESHOLD,
  classifyKnownEmployeeCount,
  type IcpSizeGateResult,
} from '@/server/agents/prospecting-toolkit/icp-size-gate';
// 🔴 X6.4-A — el gate obligatorio de PAÍS que la ruta Apollo ya aplica, traído a
// la pierna Lusha SIN reimplementarlo: el módulo sólo compone
// `evaluateCountryCompatibility`. El ownership queda FUERA de X6.4 — ver la nota
// de alcance en `lusha-country-gate.ts`.
import {
  evaluateLushaCountryGate,
  type LushaCountryRejection,
} from './lusha-country-gate';
// 🔴 X6.12 — el veredicto de OWNERSHIP de esta ruta, por la costura de admisión
// única de X6.10-C. NO bloquea: responde la condición del contrato. Ver la nota
// de medición en el módulo (X6.4 midió ~15 % de falso positivo del heurístico
// textual sobre empresas reales, y por eso un rechazo no puede descartar).
import {
  evaluateLushaOwnershipEvidence,
  toLushaOwnershipGateMetadata,
  type LushaOwnershipEvidence,
} from './lusha-ownership-evidence';
// 🔴 VISIBILIDAD DE OWNERSHIP (opción C) — la marca que la cola y la ficha leen.
import { resolveOwnershipReviewFlags } from '@/modules/prospect-batches/ownership-review-flag';
// 🔴 X6.14 — la evaluación SUSTENTADA de `quality_gate`, en sustitución del
// `qualityGate: 'pass'` fijo. Corre ANTES del catálogo porque no lo necesita.
import {
  evaluateLushaQualityGate,
  toLushaQualityGateMetadata,
  type LushaQualityGateResult,
} from './lusha-quality-gate';
// AGENT1-LUSHA-REQUEST-OBSERVABILITY-1 — lo pedido y lo devuelto, por página.
import {
  observeLushaPageRequest,
  type LushaPageRequestObservation,
} from './lusha-page-request-observation';

// ─── Contract constants (see data-contract in migrations 040/045/093) ─────────

/** Batch provenance. There is no `lusha` batch source enum; this AI-wizard flow
 *  maps to `agent_1`. The provider name lives in metadata + candidate rows. */
export const LUSHA_PENDING_REVIEW_BATCH_SOURCE = 'agent_1' as const;
/** Batch status so its candidates surface in the Prospectos review list. */
export const LUSHA_PENDING_REVIEW_BATCH_STATUS = 'ready_for_review' as const;
/** Candidate source_primary — the enum explicitly allows `lusha`. */
export const LUSHA_PENDING_REVIEW_CANDIDATE_SOURCE = 'lusha' as const;
/** Candidate status required by the Prospectos list + review actions. */
export const LUSHA_PENDING_REVIEW_CANDIDATE_STATUS = 'needs_review' as const;
/** MANDATORY: the review actions reject anything but `production`
 *  (`not_clean_production`). The canonical Agent-1 writer omits this — we do not. */
export const LUSHA_PENDING_REVIEW_RECORD_ORIGIN = 'production' as const;
/** Marks the writer as the classifier for record_origin (migration 093 enum). */
export const LUSHA_PENDING_REVIEW_CLASSIFICATION_SOURCE = 'writer' as const;
/** Default duplicate_status when no duplicate signal was found. */
export const LUSHA_PENDING_REVIEW_DUPLICATE_STATUS = 'no_match' as const;
/** Discreet provider traceability. */
export const LUSHA_PENDING_REVIEW_PROVIDER = 'lusha' as const;
/** Where the human review happens. */
export const LUSHA_PENDING_REVIEW_URL = PROSPECTOS_TAB_ROUTE;
/** source_trace marker so an auditor knows which resolver produced the status. */
export const LUSHA_DUPLICATE_RESOLUTION_VERSION = 'lusha_duplicate_parity_v1' as const;

// ─── Useful-candidate top-up guardrails (Q3F-5BB.7B, server-authoritative) ────
//
// AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 § 6 — los valores se EXTRAJERON a
// `lusha-pending-review-limits` (mismos nombres, mismos valores) y aquí se
// re-exportan, para que el ejecutor multi-rama pueda derivar sus techos de ellos
// sin crear un ciclo de inicialización con este módulo. Ningún llamador cambia.
export {
  LUSHA_PENDING_REVIEW_MIN_USEFUL_CANDIDATES,
  LUSHA_PENDING_REVIEW_MAX_PAGES,
  LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS,
};

// ─── Duplicate parity contracts (Q3F-5BB.7) ───────────────────────────────────

/** DB duplicate_status values this writer can persist. Mirrors the canonical
 *  candidate-writer mapping (existing_in_* → exact_duplicate, possible_duplicate
 *  → possible_duplicate, else no_match). Unlike the canonical writer this Lusha
 *  flow NEVER persists a blocking `unchecked`/`insufficient_data` just because the
 *  secondary HubSpot check was unavailable — see `resolveLushaCandidateDuplicateState`. */
export type LushaDbDuplicateStatus = 'no_match' | 'exact_duplicate' | 'possible_duplicate';

export type AccountDuplicateCheckTrace =
  | 'performed_matched'
  | 'performed_possible_duplicate'
  | 'performed_no_match';

export type HubSpotDuplicateCheckTrace =
  | 'performed_matched'
  | 'performed_possible_duplicate'
  | 'performed_no_match'
  | 'skipped_unavailable';

export type ActiveCandidateDuplicateCheckTrace =
  | 'performed_no_match'
  | 'performed_possible_duplicate';

// ─── Reviewer-facing duplicate details (Q3F-5BB.7B) ───────────────────────────

/** Coarse match kind, derived from the checker reason / guard reason. */
export type LushaDuplicateMatchType =
  | 'exact_domain'
  | 'exact_tax_id'
  | 'name_country'
  | 'name_similarity'
  | 'canonical_identity'
  | 'active_domain'
  | 'parent_shared_domain'
  | 'unknown';

/** One concrete entity this candidate coincided with (safe fields only). */
export interface LushaDuplicateDetailSource {
  source: 'sellup' | 'hubspot' | 'active_candidate';
  matchType: LushaDuplicateMatchType;
  /** Whether this is a confirmed (exact) or a possible match. */
  strength: 'exact' | 'possible';
  confidence?: number;
  matchedName?: string;
  matchedDomain?: string;
  matchedAccountId?: string;
  matchedHubspotCompanyId?: string;
  matchedCandidateId?: string;
  /** Raw checker reason, verbatim — no payloads, no secrets. */
  reason?: string;
}

/**
 * Reviewer-facing duplicate detail persisted in `source_trace.duplicateDetails`.
 * Explains WHO this candidate coincided with, from WHICH source, and WHY — so the
 * review UI can show concrete names/domains/ids instead of a generic label.
 * NEVER contains raw HubSpot payloads, headers, tokens or other sensitive data.
 */
export interface LushaDuplicateDetails {
  status: LushaDbDuplicateStatus;
  sources: LushaDuplicateDetailSource[];
  reviewerMessage: string;
}

/** Resolved duplicate state for a single Lusha company, ready to persist. */
export interface LushaCandidateDuplicateResolution {
  dbDuplicateStatus: LushaDbDuplicateStatus;
  matchedAccountId: string | null;
  matchedHubspotCompanyId: string | null;
  accountDuplicateCheck: AccountDuplicateCheckTrace;
  hubSpotDuplicateCheck: HubSpotDuplicateCheckTrace;
  activeCandidateDuplicateCheck: ActiveCandidateDuplicateCheckTrace;
  activeGuardReason: DuplicateGuardMatch['reason'];
  /** Reviewer-facing detail; null when nothing coincided (no_match). */
  duplicateDetails: LushaDuplicateDetails | null;
}

/** Company paired with its resolved duplicate state (post-guard, insert-ready). */
export interface ResolvedLushaCandidate {
  company: LushaPreviewCompany;
  resolution: LushaCandidateDuplicateResolution;
  /**
   * Q3F-5BB.10C2 — official-source identity from the shared enrichment step.
   * Optional so builder unit tests that construct a candidate directly keep
   * compiling. When present + strong, its typed columns (tax_identifier, …) are
   * persisted and its metadata is written under `metadata.source_enrichment`.
   */
  enriched?: EnrichedProspectCandidateIdentity;
  /** Soft signals from the shared mandatory gate (reviewable_with_warnings). */
  gateWarnings?: string[];
  /**
   * AGENT1-LUSHA-FIRST-LIVE-QA-P0-FIX-1 § 7 — qué RAMA trajo a esta empresa.
   * Ids de industria y nada más: sin payload del proveedor y sin PII. Opcional
   * porque la ruta legacy de un sector no ejecuta ramas.
   */
  branchProvenance?: LushaBranchProvenance;
  /**
   * § 5 — el veredicto de precisión de macro que la ADMITIÓ. Sólo lo llevan las
   * empresas aceptadas: un candidato persistido sin este bloque es un candidato
   * de la ruta legacy, nunca uno que la precisión dejó pasar sin mirar.
   */
  macroPrecision?: LushaMacroPrecisionAssessment;
  /**
   * 🔴 X6.12 — el veredicto de ownership con el que esta candidata se juzga.
   *
   * Opcional para que las pruebas del constructor de filas sigan compilando;
   * ausente equivale a «no se evaluó», y el contrato de completitud lo lee como
   * `fail` — fail-closed, nunca un pase.
   */
  ownership?: LushaOwnershipEvidence;
  /**
   * 🔴 X6.14 — el veredicto de CALIDAD con el que esta candidata se juzga.
   *
   * Opcional por la misma razón que `ownership`: las pruebas del constructor de
   * filas construyen candidatas a mano. Ausente ⇒ el contrato lo lee fail-closed
   * (`quality_gate` no satisfecho), nunca como un pase.
   */
  quality?: LushaQualityGateResult;
}

// ─── Excluded exact-duplicate audit detail (Q3F-5BB.7D) ────────────────────────

/**
 * Auditable record of ONE exact-duplicate company that was excluded from the
 * persisted (reviewable) candidates. Stored in `prospect_batches.metadata
 * .excludedExactDuplicates` so an auditor can see WHICH company was dropped and
 * WHO it coincided with — without ever inserting it as a reviewable candidate.
 *
 * Only safe fields are copied (name/domain + the same reviewer-facing
 * `LushaDuplicateDetailSource` entries used for persisted candidates). NEVER
 * contains raw provider payloads, headers, tokens or other sensitive data.
 */
export interface LushaExcludedExactDuplicate {
  name: string;
  domain: string | null;
  duplicateStatus: 'exact_duplicate';
  sources: LushaDuplicateDetailSource[];
  reviewerMessage: string | null;
}

/** Build the safe excluded-duplicate audit entry for one excluded exact match. */
export function buildLushaExcludedExactDuplicate(
  resolved: ResolvedLushaCandidate,
): LushaExcludedExactDuplicate {
  const { company, resolution } = resolved;
  return {
    name: company.name ?? '',
    domain: normalizeDomain(company.domain),
    duplicateStatus: 'exact_duplicate',
    sources: resolution.duplicateDetails?.sources ?? [],
    reviewerMessage: resolution.duplicateDetails?.reviewerMessage ?? null,
  };
}

// ─── Row shapes handed to the injected insert deps ────────────────────────────

export interface LushaPendingReviewBatchRow {
  name: string;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  /**
   * 🔴 AGENT1-LOCAL-CUT9A § 8 — el objetivo PEDIDO, no lo persistido.
   *
   * Hasta este corte aquí aterrizaba `persistedCount`, así que con 5 pedidos y 3
   * escritos el lote afirmaba que se pidieron 3: un CONTRIBUYENTE redefiniendo la
   * PETICIÓN. Ahora lo establece el primer propietario del lote —el resolutor
   * canónico— y ningún contribuyente posterior lo toca. Misma regla que CUT-2 fijó
   * para el wizard.
   */
  target_count: number | null;
  /**
   * 🔴 AGENT1-LOCAL-CUT9A §§ 2, 3 — identidad de EJECUCIÓN.
   *
   * Es la mitad de la clave única `(created_by, client_request_id)` que ya existe
   * en `prospect_batches`, y es lo que hace que la mitad gratuita y la de pago de
   * UNA misma búsqueda no puedan terminar en dos lotes. No es una identidad nueva:
   * la columna y su índice existen desde antes de este corte.
   */
  client_request_id: string;
  search_depth: 'standard';
  status: typeof LUSHA_PENDING_REVIEW_BATCH_STATUS;
  source: typeof LUSHA_PENDING_REVIEW_BATCH_SOURCE;
  owner_id: string;
  created_by: string;
  metadata: Record<string, unknown>;
}

export interface LushaPendingReviewCandidateRow {
  batch_id: string;
  name: string;
  normalized_name: string | null;
  website: string | null;
  domain: string | null;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  company_size: string | null;
  /**
   * AGENT1-LUSHA-FIRST-LIVE-QA-P0-FIX-1 § 12 — el conteo EXACTO de empleados en su
   * columna tipada, no sólo como texto en `company_size` y en la metadata.
   *
   * El defecto que cierra: DINISSAN llegó con 682 empleados exactos del proveedor,
   * la ficha los mostraba en «Datos Comerciales y Web»… y el bloque «Tamaño ICP»
   * decía «Sin evaluación de tamaño», porque nadie había escrito ni la columna ni
   * el gate. Columnas existentes (nada de migración): `employee_count` con su
   * CHECK de no-negativo, y `employee_count_source` como texto libre.
   *
   * 🔴 `employee_count_status` se deja intencionadamente sin escribir. Su CHECK
   * sólo admite un vocabulario de umbral 100 (`confirmed_100_plus`, …) mientras el
   * ICP de SellUp son 200: rellenarlo obligaría a afirmar un umbral que no es el
   * del producto. Es exactamente lo que hace hoy el escritor de Apollo, que lo
   * deja nulo en las 13 filas de Producción.
   */
  employee_count: number | null;
  employee_count_source: string | null;
  /**
   * 🔴 X6.12 — columna EXISTENTE (`prospect_candidates.linkedin_url`), nada de
   * migración. Sólo se escribe cuando `isLinkedInCompanyUrl` acredita la URL que
   * el proveedor entregó; `null` en cualquier otro caso.
   */
  linkedin_url: string | null;
  /**
   * 🔴 VISIBILIDAD DE OWNERSHIP (opción C) — columna EXISTENTE, sin migración.
   *
   * `null` ⇒ esta fila no trae veredicto de ownership y NO se le inventa uno.
   * `[]` ⇒ se evaluó y quedó acreditada. Con la marca ⇒ se evaluó y no se pudo
   * verificar la relación empresa–dominio.
   */
  review_flags: string[] | null;
  // Q3F-5BB.10C2 — typed identity columns, populated ONLY on a STRONG official-source
  // match (else null). Columns already exist on prospect_candidates (migrations
  // 040/045); no migration is added here. `identity_key` is deliberately NOT touched.
  tax_identifier: string | null;
  tax_identifier_type: string | null;
  legal_name: string | null;
  legal_status: string | null;
  source_primary: typeof LUSHA_PENDING_REVIEW_CANDIDATE_SOURCE;
  sources_checked: string[];
  duplicate_status: LushaDbDuplicateStatus;
  matched_account_id: string | null;
  matched_hubspot_company_id: string | null;
  confidence_score: number | null;
  fit_score: number | null;
  data_completeness_score: number | null;
  status: typeof LUSHA_PENDING_REVIEW_CANDIDATE_STATUS;
  record_origin: typeof LUSHA_PENDING_REVIEW_RECORD_ORIGIN;
  classification_source: typeof LUSHA_PENDING_REVIEW_CLASSIFICATION_SOURCE;
  source_trace: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

// ─── Injected dependencies + result ───────────────────────────────────────────

export interface PersistLushaPendingReviewActor {
  internalUserId: string;
  /**
   * AGENT1-LOCAL-CUT9A §§ 2, 3 — identidad de EJECUCIÓN de esta corrida.
   *
   * OBLIGATORIA a propósito. Opcional, un llamador podía omitirla y la fila nacía
   * sin la mitad de su clave canónica: el lote quedaba fuera del índice único y la
   * mitad gratuita no tenía nada que adoptar.
   */
  clientRequestId: string;
  /**
   * § 8 — el objetivo PEDIDO por la persona, que es lo que `target_count` publica.
   *
   * OBLIGATORIA por la misma razón: sin ella el único número a mano para
   * `target_count` volvía a ser un residual.
   */
  requestedTarget: number;
}

/**
 * AGENT1-LUSHA-CUT-L3 § 5 — QUÉ distingue una petición lógica de otra.
 *
 * `page` ya viaja dentro de `LushaPreviewInput`, pero `branchIndex` no existía en
 * ninguna parte de la entrada: dos ramas del plan que compartieran industria
 * principal y sub habrían producido la MISMA identidad, y la valla durable habría
 * suprimido la segunda como si fuera un replay. Se pasa aparte, y no dentro de
 * `LushaPreviewInput`, porque el índice de rama es del EJECUTOR: el núcleo de
 * preview no sabe que existe un plan multi-rama y no debe empezar a saberlo.
 */
export type LushaProviderRequestCoordinates = {
  /** Índice de la rama dentro del plan de la corrida, base 0. */
  branchIndex: number;
  /** Página pedida al proveedor, base 0. La misma que viaja en el input. */
  page: number;
};

/** Runs Lusha once. Backed by the read-only `executeLushaPreview` core so the
 *  page/size/credit guardrails are inherited verbatim.
 *
 *  El segundo argumento es OPCIONAL para no romper a los dobles de prueba
 *  anteriores a CUT-L3; la ruta pagada de producción lo pasa siempre. */
export type RunLushaSearch = (
  input: LushaPreviewInput,
  coordinates?: LushaProviderRequestCoordinates,
) => Promise<LushaPreviewResult>;

/** READ-ONLY. Canonical SellUp + HubSpot duplicate checker. Can only detect
 *  duplicates — it never writes. */
export type CheckLushaCompanyDuplicate = (
  input: DuplicateCheckInput,
) => Promise<DuplicateCheckResult>;

/** READ-ONLY. Loads active prospect candidates for the guard. Returns [] when the
 *  prefetch is unavailable (fail-open — the guard degrades gracefully). */
export type FetchActiveCandidatesForLushaGuard = (
  domains: string[],
  countryCode: string | null,
) => Promise<ActiveCandidateRecord[]>;

/**
 * AGENT1-CUT3B4 § 22 — la época de un lote RECIÉN CREADO.
 *
 * `prospect_batches.identity_epoch` nace en 0 por DEFAULT, y esta ruta crea el lote
 * en la misma llamada en la que escribe sus candidatos: no hay ninguna otra época
 * posible. Se nombra en vez de escribir un 0 suelto para que, el día en que esta
 * ruta adopte un lote preexistente, el literal no se cuele como si siguiera siendo
 * cierto — tendría que venir de la foto, como en los otros dos escritores.
 */
export const LUSHA_FRESH_BATCH_IDENTITY_EPOCH = 0;

/**
 * AGENT1-LOCAL-CUT9A § 4 — esta ruta SÍ adopta el lote canónico de su ejecución.
 *
 * 🔴 Era `false`, y CUT-3B4 § 22 dejó dicho por qué importaba el día en que
 * cambiara: «si algún día se pone en `true`, la escritura en bloque tiene que pasar
 * por `runFencedPersistence` con re-evaluación, porque `stale` dejará de ser
 * inalcanzable». Ese día es éste, y la advertencia se atiende, no se sortea:
 *
 *   · La época YA NO es el literal 0, y tampoco sale de la RESERVA.
 *
 *     🔴 CUT9A-FIX-ADOPTED-EPOCH-REFRESH. Que saliera de la reserva era el defecto
 *     que V9A.1 destapó: el resolutor canónico memoiza el objeto ENTERO —id,
 *     `adopted` e `identityEpoch`—, así que cuando la capa gratuita materializa el
 *     lote primero deja memoizado `{ adopted: false, identityEpoch: 0 }`, LUEGO
 *     escribe sus candidatos por la valla y sube la época a N, y la mitad de pago
 *     recibe de vuelta el 0 memoizado sin volver a tocar la base. Con
 *     `expectedEpoch = 0` sobre un lote que ya está en N, la valla respondía
 *     `stale` —correctamente— y la corrida ENTERA lanzaba DESPUÉS de haber pagado
 *     al proveedor.
 *
 *     `adopted` tampoco sirve como autoridad temporal: `adopted: false` significa
 *     «esta llamada creó la fila», NO «la fila sigue en la época 0». Las dos cosas
 *     son simultáneamente ciertas en la ruta gratuita→pago, y por eso la época
 *     tiene que venir de una lectura ACTUAL —`deps.readBatchIdentityEpoch`, que en
 *     producción es la foto canónica de CUT-3B4— tomada justo antes de escribir.
 *
 *     La IDENTIDAD del lote sigue memoizada: el `batchId` no cambia, no hay un
 *     segundo INSERT y las dos mitades siguen compartiendo el mismo lote. Lo único
 *     que deja de tratarse como verdad final memoizada es la ÉPOCA.
 *   · `stale` deja de ser inalcanzable, y eso es DELIBERADO: la relectura elimina
 *     el `stale` FALSO —el que sólo existía porque la época viajaba caduca—, no la
 *     carrera REAL. Si entre la relectura y el INSERT otro escritor legítimo avanza
 *     la época, la valla sigue respondiendo `stale` y esta ruta LANZA. No hay
 *     caída a una escritura sin valla, y no se reintenta en bucle: migrar esta
 *     escritura a `runFencedPersistence` con re-evaluación de admisión es CUT-9.
 *
 * 🔴 AGENT1-LOCAL-CUT9 §§ 6, 7 — la limitación que CUT9A declaró aquí está
 * CERRADA. La admisión por identidad de lote ya no se siembra vacía: recibe en
 * `execution.batchIdentitySeed` las filas que la capa gratuita dejó en el lote
 * canónico, resueltas por `loadBatchIdentityRegistry`. Con eso una empresa que lo
 * gratuito ya cerró no puede volver por la ruta de pago y cerrar hueco por segunda
 * vez. La paridad CRUZADA (`checkCompanyDuplicate` + prefetch de activos) sigue
 * corriendo entera: responde otra pregunta y no se sustituye.
 */
export const LUSHA_PENDING_REVIEW_BATCH_ADOPTION_SUPPORTED = true;

export interface PersistLushaPendingReviewDeps {
  runSearch: RunLushaSearch;
  // ── Write deps (the ONLY two write surfaces) ──
  /**
   * AGENT1-LOCAL-CUT9A § 4 — RESERVE-OR-RETURN, ya no INSERT incondicional.
   *
   * 🔴 El nombre cambió con la semántica, y ése es el punto: mientras se llamó
   * `insertBatch` y devolvió `{ id }`, el núcleo no tenía forma de saber si la fila
   * era suya o adoptada, y la escritura vallada sólo podía suponer época 0.
   *
   * El contrato que el llamador debe cumplir:
   *
   *   INSERT con `(created_by, client_request_id)` → `{ adopted: false, epoch fresca }`
   *   23505 sobre esa clave → RELEE ESA fila → `{ adopted: true, época real }`
   *
   * 🔴 Nunca «el último lote», nunca por nombre/país/sector: la única autoridad de
   * adopción es la clave canónica.
   */
  reserveBatch: (
    row: LushaPendingReviewBatchRow,
  ) => Promise<LushaCanonicalBatchReservation>;
  /**
   * AGENT1-CUT3B4 § 22 — escritura de candidatos ANTERIOR a B4.
   *
   * 🔴 Sigue existiendo, y sigue siendo TODO-O-NADA, por una razón acotada: la
   * migración 126 se entrega SIN aplicar, y con la RPC vallada ausente ésta es la
   * única forma de que la ruta de Lusha escriba. En cuanto la 126 esté aplicada,
   * `insertCandidatesFenced` responde y este camino queda inalcanzable.
   *
   * 🔴 CUT-3B4-CORRECCIÓN — se invoca EXCLUSIVAMENTE cuando
   * `insertCandidatesFenced` devuelve `capability_absent`, que es la BASE diciendo
   * que la función vallada no existe. Su ausencia como dependencia ya NO puede
   * llevar hasta aquí: eso era un desvío estructural, independiente del esquema.
   */
  insertCandidates: (
    rows: LushaPendingReviewCandidateRow[],
  ) => Promise<{ insertedCount: number }>;
  /**
   * AGENT1-CUT3B4 § 22 — escritura VALLADA del bloque de candidatos.
   *
   * Comprueba la época del lote, inserta el bloque ENTERO y avanza la época, todo
   * en UNA transacción. La atomicidad de todo-o-nada que la guarda de CUT-3B23
   * defiende no se pierde: se traslada a la transacción, donde es más fuerte.
   *
   * 🔴 CUT-3B4-CORRECCIÓN — OBLIGATORIA, y el `?` no puede volver. Mientras fue
   * opcional, el núcleo tenía un `else` que escribía sin valla por el solo hecho
   * de que nadie la inyectara: un desvío que no dependía del esquema y que ninguna
   * aplicación de la 126 podía cerrar. Un llamador o una prueba que quiera modelar
   * «la 126 no está aplicada» inyecta una función que devuelva
   * `{ status: 'capability_absent' }` — que es lo que diría la base de verdad—, no
   * omite la dependencia.
   */
  insertCandidatesFenced: (args: {
    batchId: string;
    expectedEpoch: number;
    rows: LushaPendingReviewCandidateRow[];
  }) => Promise<FencedCandidateInsertResult>;
  /**
   * 🔴 CUT9A-FIX-ADOPTED-EPOCH-REFRESH — LECTURA ACTUAL de la época del lote.
   *
   * READ-ONLY, y OBLIGATORIA por la misma razón que `insertCandidatesFenced`: es
   * una dependencia cuya ausencia no puede autorizar nada. Mientras la época salía
   * de la reserva memoizada, la mitad de pago escribía declarando un estado que
   * podía llevar toda la ejecución de retraso.
   *
   * Se llama con el lote canónico YA resuelto y justo ANTES de la escritura
   * vallada, porque lo que importa no es qué época tenía el lote cuando se
   * materializó sino cuál tiene AHORA.
   *
   * En producción es la foto canónica de CUT-3B4 (`loadBatchIdentityRegistry` →
   * `read_batch_identity_snapshot`), que lee filas y época en UNA sentencia. Este
   * corte NO añade una consulta Lusha ad-hoc a `prospect_batches.identity_epoch`:
   * la autoridad de identidad de lote ya existe y es ésa.
   *
   * 🔴 Devuelve la EVIDENCIA completa, no un número: `epoch: null` no es la época
   * 0. Distinguir «la 126 no está aplicada» (esquema, ruta anterior a B4) de «la
   * lectura falló» (avería, fallo CERRADO) exige las tres señales, y quien las
   * combina es `isProvenFenceCapabilityAbsent`, nunca este llamador por su cuenta.
   */
  readBatchIdentityEpoch: (batchId: string) => Promise<FenceCapabilityEvidence>;
  /**
   * ── AGENT1-LOCAL-CUT9B — la publicación DURABLE de la aceptación ──────────
   *
   * Write dep #4, y la ÚNICA que este corte añade. Existe porque en esta ruta la
   * metadata del lote se publica en el INSERT de la reserva, es decir ANTES de
   * que exista una sola fila; cuando la aceptación se conoce ya no queda ninguna
   * escritura en la que esparcirla. `candidate-writer` no tiene ese problema —su
   * publicación de metadata es POSTERIOR a los candidatos— y por eso a él le basta
   * con `resolveExtraBatchMetadata` a secas.
   *
   * 🔴 Las DOS mitades viajan JUNTAS, en un solo objeto, a propósito. Separarlas
   * en dos campos opcionales permitiría un estado que no debe existir: un
   * proyector sin escritor —una aceptación resuelta que no se publica en ninguna
   * parte, que es EXACTAMENTE el defecto que este corte cierra— o un escritor sin
   * proyector, que no tendría nada que escribir. Con un solo dep hay dos estados y
   * sólo dos: publica, o no hay publicación que hacer.
   *
   * 🔴 OPCIONAL, y aquí sí es correcto: su ausencia no autoriza NADA. No abre una
   * escritura sin valla, no relaja una comprobación y no cambia una decisión de
   * admisión — sólo significa «esta corrida no tiene bloque que publicar», que es
   * el comportamiento byte por byte anterior a CUT9B. Es la diferencia con
   * `insertCandidatesFenced`, cuya ausencia SÍ autorizaba escribir sin valla y por
   * eso tuvo que volverse obligatoria (CUT-3B4-CORRECCIÓN). Que la ruta productiva
   * lo cablee lo sostiene una guarda estática, no el tipo.
   *
   * 🔴 `resolve` es PURA y NO es una segunda autoridad de aceptación: recibe lo
   * que este writer acaba de contar y devuelve claves ya serializadas por quien
   * sí manda (`resolveAcceptedForTarget` → `toAcceptedForTargetMetadata`, ambas en
   * la acción). El núcleo no suma, no resta, no compara y no vuelve a acotar.
   *
   * 🔴 `publish` NUNCA lanza y NUNCA altera el resultado de la corrida. Un fallo
   * de publicación llega después de que el proveedor cobrara y de que los
   * candidatos fueran durables: propagarlo devolvería un error por una corrida
   * exitosa y le ofrecería a la persona un reintento que volvería a gastar. Es la
   * misma regla que ya gobierna la liquidación y la fila de uso de esta ruta.
   */
  acceptedForTargetPublication?: {
    resolve: ResolveExtraBatchMetadata;
    publish: (args: {
      batchId: string;
      /**
       * La época que el lote tiene DESPUÉS de la escritura de candidatos, o
       * `null` cuando la valla no existe. Es el token de CAS, no un dato.
       */
      epochAfterWrite: number | null;
      /** La evidencia con la que se prueba —o no— la ausencia de la valla. */
      evidence: FenceCapabilityEvidence;
      published: Record<string, unknown> | null;
    }) => Promise<BatchMetadataPublicationResult>;
  } | null;
  // ── Read-only duplicate-parity deps (Q3F-5BB.7) — never write ──
  checkCompanyDuplicate: CheckLushaCompanyDuplicate;
  fetchActiveCandidates: FetchActiveCandidatesForLushaGuard;
  /**
   * Q3F-5BB.10C2 — READ-ONLY official-source resolvers injected for the shared
   * enrichment step. Optional so legacy callers/tests keep compiling; when
   * omitted (or empty) enrichment yields the shared "unsupported/unavailable"
   * result and no strong identity is produced (taxIdentifier stays null →
   * duplicate check behaves exactly as before). Resolvers can only READ (they
   * are the ONLY new injected surface and add no write capability).
   */
  officialSourceResolvers?: OfficialSourceResolver[];
}

/**
 * Q3F-5BB.11D — OPTIONAL, OBSERVATIONAL provider-routing observation. When
 * present, the core stamps the additive routing metadata (11C) onto the batch
 * (`provider_routing` + `provider_attempts[]`) and each candidate
 * (`provider_trace`, keeping `source_provider` / `source_trace.sourceProvider`
 * consistent). Purely additive: when omitted (legacy callers / tests) behavior
 * is byte-for-byte unchanged and no routing metadata is written. This never
 * decides eligibility, never gates execution, and never changes which companies
 * are persisted — the live guard is authoritative.
 */
export interface LushaProviderRoutingObservation {
  routingMetadata?: ProviderRoutingMetadata;
  routingPlan?: ProviderRoutingPlan;
}

export type PersistLushaPendingReviewStatus = 'success' | 'empty' | 'error';

export interface PersistLushaPendingReviewResult {
  ok: boolean;
  status: PersistLushaPendingReviewStatus;
  batchId: string | null;
  createdCandidatesCount: number;
  skippedCount: number;
  creditsCharged: number | null;
  resultsReturned: number | null;
  reviewUrl: string;
  message: string;
  error?: string;
  // ── Top-up + duplicate-classification metrics (Q3F-5BB.7B) ──
  /**
   * Peticiones de búsqueda realmente hechas al proveedor.
   *
   * 🔑 Con el ejecutor multi-rama es el total de la CORRIDA (ramas × páginas), no
   * un número de página. Sigue siendo la señal que la liquidación usa
   * (`shouldReleaseLushaReservation`): 0 significa que la corrida fue
   * estructuralmente incapaz de gastar, y eso vale igual con una rama que con tres.
   */
  pagesRequested: number;
  /**
   * Techo de créditos de esta corrida: ramas × techo por rama (2 · 4 · 6).
   * Con una sola rama —la ruta legacy— sigue siendo 2.
   */
  expectedMaxCredits: number;
  /** Sum of credits charged across every page requested (null if none reported). */
  creditsChargedTotal: number | null;
  /**
   * AGENT1-LUSHA-CUT-L5 §§ 7, 8 — el resumen de facturación de la corrida.
   *
   * 🔴 Los tres números viven aparte a propósito. `creditsChargedTotal` (arriba)
   * es lo que Lusha liquidó y sigue siendo la única autoridad; esto es lo que su
   * contrato de bloques decía que debía costar, y si no coinciden hay que poder
   * verlo sin abrir la base.
   *
   * Ausente en corridas que no despacharon ninguna petición.
   */
  billingContract?: LushaRunBillingContractSummary;
  /** Reviewable candidates persisted (no_match + possible_duplicate). */
  usefulCandidatesCount: number;
  /** Exact duplicates EXCLUDED from persistence (never inserted as reviewable). */
  excludedExactDuplicatesCount: number;
  /** Companies skipped by the active-candidate strong-match guard. */
  skippedActiveDuplicatesCount: number;
  /** Subset of persisted candidates flagged possible_duplicate. */
  possibleDuplicatesCount: number;
  /** Candidates actually inserted (== createdCandidatesCount on success). */
  insertedCandidatesCount: number;
  /**
   * 🔴 X6.13 — identidad DURABLE de las supervivientes que esta corrida declara
   * ACEPTADAS, con espacio de nombres propio (`lusha:<identidad>`).
   *
   * Un contador no se puede deduplicar contra otro contador: si un replay
   * vuelve a reportar las mismas filas, dos cifras suman dos veces. Estas
   * identidades viajan hasta `resolveAcceptedForTarget`, que agrega por UNIÓN.
   *
   * 🔴 El espacio de nombres es obligatorio y NO se comparte con el writer de
   * Apollo: sus ids son uuid de fila y los de aquí son identidad de empresa.
   * Conflatarlos inventaría coincidencias.
   */
  acceptedCandidateIdentities?: readonly string[];
  /**
   * AGENT1-LOCAL-CUT9B — DESENLACE de la publicación durable de la aceptación.
   *
   * 🔴 Existe para que «no se publicó» deje de ser silencioso. Sin este campo,
   * una publicación que rebotó por `stale` y una que entró producen exactamente el
   * mismo resultado de corrida, y la ausencia del bloque en la fila sólo se podría
   * descubrir mirando la base a mano. Es el mismo criterio que hizo que la
   * liquidación de presupuesto dejara de ser `Promise<void>`.
   *
   * `null` = esta corrida no tenía publicación que hacer (nadie inyectó la
   * costura). No es un fallo y no se distingue de la corrida anterior a CUT9B.
   */
  acceptedForTargetPublication?: BatchMetadataPublicationResult | null;
  /** True when page 1 was requested to top up useful candidates. */
  topUpTriggered: boolean;
  // ── Shared intake pipeline metrics (Q3F-5BB.10C2) ──
  // Optional so existing callers that build a result literal (UI fallbacks, older
  // test doubles) keep compiling; the core always populates them.
  /** Companies dropped by the shared mandatory gate (never reached duplicate check). */
  hardExcludedByGateCount?: number;
  /** Persisted candidates that got a STRONG official-source identity (typed columns filled). */
  enrichedWithOfficialSourceCount?: number;
  // ── AGENT1-CUT3B23 § 15 — identidad de lote ──
  /**
   * Empresas retiradas por el registro de identidad de LOTE (duplicado duro).
   * NO son errores y NO consumen el objetivo. Cero cuando nada coincidió.
   */
  batchIdentityDuplicateSkippedCount?: number;
  /**
   * Conteo del corte: crudo descubierto, aceptado ÚNICO, duplicados retirados,
   * posibles duplicados admitidos y conflictos fuertes; más —desde AGENT1-CUT3B4— la
   * telemetría de CONCURRENCIA. `boolean` y `null` entran porque «no se pudo
   * establecer la época» no es un número y colapsarlo a 0 lo habría hecho pasar por
   * «época cero», que es una afirmación distinta. Sin PII: sólo conteos y estados.
   */
  batchIdentityMetrics?: Record<string, number | boolean | null>;
  // ── Global Agent1 budget gate (AGENT1-LUSHA-BUDGET-GATE-1) ──
  /**
   * Detalle ESTRUCTURADO de un bloqueo de presupuesto, con la misma forma que el
   * `budgetExceeded` de la ruta Apollo, para que el cliente lo redacte con
   * `mapBudgetExceeded` y los dos avisos no puedan divergir. Ausente cuando el
   * bloqueo no fue de presupuesto o cuando el período no se pudo leer (nunca se
   * inventan cifras).
   */
  budgetExceeded?: {
    reason: 'exhausted' | 'insufficient_for_run';
    availableCredits: number;
    requiredCredits: number;
  };
  // ── Ejecución multi-rama (AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1) ──
  //
  // Opcionales para que los literales de resultado que construyen la UI y los
  // dobles de prueba más antiguos sigan compilando; el core siempre los rellena.
  /** Techo de peticiones de la corrida: ramas × páginas por rama. */
  providerRequestsAllowed?: number;
  /** Peticiones realmente hechas. Nunca puede exceder el techo. */
  providerRequestsUsed?: number;
  /** Ramas que el plan declaraba (1 en la ruta legacy). */
  branchCountPlanned?: number;
  /** Ramas que llegaron a pedir al proveedor. */
  branchCountAttempted?: number;
  /** Objetivo global de candidatos útiles de esta corrida. */
  targetGap?: number;
  /** Hueco que quedó abierto al terminar. 0 = objetivo alcanzado. */
  remainingGapFinal?: number;
  /**
   * Empresas descartadas por identidad ya vista DENTRO de la corrida del
   * proveedor (páginas Y ramas).
   *
   * 🔴 CUT-L1 § 4 — NO incluye las que cayeron por la siembra de conocidos: ésas
   * van en `localKnownSuppressedTotal`. Un conocido histórico no es un resultado
   * que el proveedor haya repetido.
   */
  crossBranchDuplicatesRemoved?: number;
  /**
   * 🔴 AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION §§ 4, 5 — empresas que Lusha
   * DEVOLVIÓ y que SellUp ya conocía por dominio antes de empezar.
   *
   * Lusha V3 no tiene exclusión server-side, así que estas filas ya pudieron
   * cobrar su crédito de Prospecting. Lo que este contador afirma es lo único que
   * se puede afirmar: no contaron como net-new y no arrastraron trabajo pagado
   * aguas abajo. NO es un ahorro y no se publica como tal.
   */
  localKnownSuppressedTotal?: number;
  /** Cuántos dominios conocidos entraron a la siembra CLIENTE de la corrida. */
  localKnownSeedCount?: number;
  /** Filas crudas del proveedor acumuladas en toda la corrida. */
  rawResultsTotal?: number;
  /** Por qué la corrida dejó de pedir. */
  stopReason?: LushaRunStopReason;
  // ── Exactitud de objetivo + precisión de macro (P0-FIX-1 §§ 2, 3) ──
  /**
   * Empresas nuevas y PRECISAS que la corrida encontró: aceptadas + sobrantes.
   * Puede superar `targetGap` — es lo que permite ver que una página ya pagada
   * rindió más de lo que el objetivo podía absorber.
   */
  reviewableFoundTotal?: number;
  /** De las anteriores, cuántas se descartaron por objetivo ya cerrado. */
  targetOverflowDiscarded?: number;
  /** Empresas nuevas que el catálogo NO confirmó para la macro pedida. */
  precisionRejectedTotal?: number;
  /**
   * 🔴 X6.14 — empresas nuevas y precisas que el gate de CALIDAD rechazó
   * (intermediario, plataforma externa, página de contenido, segmento excluido).
   * Contador propio: no son duplicados, ni país, ni precisión.
   */
  qualityRejectedTotal?: number;
  /** Telemetría completa de corrida + ramas (§§ 18/19). Sin PII. */
  multiBranch?: LushaRunTelemetry;
  /**
   * AGENT1-LOCAL-CUT9 §§ 3, 4, 16 — el subconjunto ACEPTADO hacia el objetivo de
   * la corrida ENTERA (gratuito + pagado), con su hueco restante y su veredicto.
   *
   * 🔴 El núcleo NO lo calcula y no puede: sólo ve su propia mitad. Lo resuelve la
   * acción con `resolveAcceptedForTarget`, la ÚNICA aritmética de aceptación, y lo
   * adjunta al resultado. Este campo existe para que viaje con la forma CANÓNICA y
   * no como un puñado de números sueltos que la UI tendría que recombinar.
   *
   * 🔴 NO sustituye a `createdCandidatesCount` ni a `insertedCandidatesCount`: ésas
   * siguen siendo el UNIVERSO DURABLE de la mitad de pago. Las dos familias
   * conviven porque son distintas (CUT-7 § 10).
   *
   * Ausente ⇒ esta corrida no declaró aceptación (llamadores legados, dobles de
   * prueba). Nunca se sustituye por filas.
   */
  acceptedForTarget?: AcceptedForTargetResult;
  /**
   * AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — las empresas que esta corrida evaluó
   * y que NO acabaron como candidato visible del lote, con su disposición
   * durable ya resuelta.
   *
   * 🔴 Existe TAMBIÉN cuando `status === 'empty'`, y eso es el punto: una
   * corrida puede evaluar cincuenta empresas, rechazarlas todas y crear cero
   * candidatos. Hoy esa corrida no dejaba rastro por empresa, y reconstruirla
   * exigía volver a preguntar a Lusha — es decir, volver a pagar.
   *
   * 🔴 Es OBSERVACIÓN, no decisión: ningún contador de la corrida depende de
   * este arreglo. Ausente ⇒ llamador legado o doble de prueba; nunca se
   * sustituye por filas.
   */
  discardedCompanies?: readonly LushaDiscardedCompanyRecord[];
}

/** Baseline metrics used by non-success (error/empty) results. */
const EMPTY_TOPUP_METRICS = {
  pagesRequested: 0,
  expectedMaxCredits: LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS,
  creditsChargedTotal: null as number | null,
  usefulCandidatesCount: 0,
  excludedExactDuplicatesCount: 0,
  skippedActiveDuplicatesCount: 0,
  possibleDuplicatesCount: 0,
  insertedCandidatesCount: 0,
  topUpTriggered: false,
  hardExcludedByGateCount: 0,
  enrichedWithOfficialSourceCount: 0,
} as const;

/**
 * Resultado de una corrida que NO necesitó al proveedor.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 15, 22(A).
 *
 * 🔴 Es un ÉXITO, no un vacío. La corrida cerró el objetivo con empresas
 * gratuitas: hay candidatos que revisar, y por eso `ok` es `true` y hay un
 * `batchId`. Devolver `status: 'empty'` diría lo contrario de lo que pasó.
 *
 * 🔴 Todas las cifras de proveedor son CEROS REALES, no ausencias: no hubo
 * estimación, no hubo reserva, no hubo cliente y no hubo petición, así que
 * `pagesRequested`, `creditsCharged` y `creditsChargedTotal` valen exactamente lo
 * que se gastó. `creditsChargedTotal` es 0 y no `null` a propósito: `null` es «el
 * proveedor no reportó», y aquí no hubo proveedor a quien preguntar.
 */
export function buildLushaProviderNotRequiredResult(input: {
  batchId: string | null;
  createdCandidatesCount: number;
  targetGap: number;
  message: string;
}): PersistLushaPendingReviewResult {
  return {
    ok: true,
    status: 'success',
    batchId: input.batchId,
    createdCandidatesCount: input.createdCandidatesCount,
    skippedCount: 0,
    creditsCharged: 0,
    resultsReturned: 0,
    reviewUrl: LUSHA_PENDING_REVIEW_URL,
    message: input.message,
    pagesRequested: 0,
    expectedMaxCredits: 0,
    creditsChargedTotal: 0,
    usefulCandidatesCount: input.createdCandidatesCount,
    excludedExactDuplicatesCount: 0,
    skippedActiveDuplicatesCount: 0,
    possibleDuplicatesCount: 0,
    insertedCandidatesCount: input.createdCandidatesCount,
    topUpTriggered: false,
    hardExcludedByGateCount: 0,
    enrichedWithOfficialSourceCount: 0,
    providerRequestsAllowed: 0,
    providerRequestsUsed: 0,
    branchCountPlanned: 0,
    branchCountAttempted: 0,
    targetGap: input.targetGap,
    remainingGapFinal: 0,
    crossBranchDuplicatesRemoved: 0,
    localKnownSuppressedTotal: 0,
    localKnownSeedCount: 0,
    rawResultsTotal: 0,
    reviewableFoundTotal: input.createdCandidatesCount,
    targetOverflowDiscarded: 0,
    precisionRejectedTotal: 0,
    qualityRejectedTotal: 0,
  };
}

/**
 * Build a fail-closed result (error/invalid input). Single source of truth reused
 * by both the pure core and the server-action wrapper so every failure path
 * carries the full (zeroed) metric surface.
 */
export function buildLushaPendingReviewFailure(
  message: string,
  error: string,
  overrides?: Partial<Pick<PersistLushaPendingReviewResult,
    'creditsCharged' | 'resultsReturned' | 'creditsChargedTotal' | 'pagesRequested'>>,
): PersistLushaPendingReviewResult {
  return {
    ok: false,
    status: 'error',
    batchId: null,
    createdCandidatesCount: 0,
    skippedCount: 0,
    creditsCharged: overrides?.creditsCharged ?? null,
    resultsReturned: overrides?.resultsReturned ?? null,
    reviewUrl: LUSHA_PENDING_REVIEW_URL,
    message,
    error,
    ...EMPTY_TOPUP_METRICS,
    ...(overrides?.creditsChargedTotal !== undefined
      ? { creditsChargedTotal: overrides.creditsChargedTotal }
      : {}),
    ...(overrides?.pagesRequested !== undefined
      ? { pagesRequested: overrides.pagesRequested }
      : {}),
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Normalize a company name for dedupe fallback + normalized_name column.
 *
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 § 10 — la implementación canónica
 * vive ahora en `lusha-run-identity-registry` (el registro de identidad de la
 * corrida la necesita, y dos copias de la misma intención derivarían: la clave de
 * dedupe dejaría de coincidir con la columna persistida sin que nada fallara).
 * Se re-exporta con el mismo nombre, así que ningún llamador ni ninguna suite
 * cambia de import.
 */

// ═══════════════════════════════════════════════════════════════════════════
// AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — acumulador OBSERVADOR de descartes
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 Este bloque no decide NADA. Cada registro se captura en el punto exacto en
// el que la lógica que ya existía acababa de descartar la empresa, y ninguna
// condición de aceptación/rechazo, ningún contador y ningún desenlace de la
// corrida cambia por su presencia. Si se borrara, la corrida produciría
// exactamente los mismos números.
//
// Lo que resuelve: la pierna Lusha evaluaba decenas de empresas y sólo dejaba
// rastro por empresa de las que llegaban a candidato. Una corrida que evaluara
// 50 y aceptara 5 perdía la identidad de las otras 45, y reconstruir qué pasó
// con cada una exigía volver a consultar a Lusha —es decir, volver a pagar.

/** Un descarte de Lusha, con su identidad y su veredicto durable ya resuelto. */
export interface LushaDiscardedCompanyRecord {
  name: string;
  domain: string | null;
  providerCompanyId: string | null;
  linkedinUrl: string | null;
  industry: string | null;
  countryCode: string | null;
  disposition: DiscardDispositionCode;
  reasonCode: string | null;
  reasonDetail: string | null;
  roundOrigin: string | null;
  evidence: Record<string, unknown>;
}

/**
 * Construye el registro durable de UN descarte, o `null` si el desenlace es
 * transitorio (la taxonomía pura es la única autoridad sobre eso).
 *
 * 🔴 No rellena ausencias: un campo que el proveedor no trajo viaja como
 * `null`, nunca como un valor plausible.
 */
function buildLushaDiscardRecord(input: {
  company: LushaPreviewCompany;
  event: LushaDiscardEvent;
  branchIndex: number;
  page: number;
  reasonDetail?: string | null;
  evidence?: Record<string, unknown>;
}): LushaDiscardedCompanyRecord | null {
  const resolution = resolveLushaDiscardDisposition(input.event);
  if (resolution === null) return null;
  const name = input.company.name?.trim();
  if (!name) return null; // `name` es NOT NULL y sin él no hay nada que auditar.
  return {
    name,
    domain: normalizeDomain(input.company.domain),
    providerCompanyId: input.company.providerCompanyId ?? null,
    linkedinUrl: input.company.linkedinUrl ?? null,
    industry: input.company.industry ?? null,
    countryCode: input.company.countryIso2 ?? null,
    disposition: resolution.disposition,
    reasonCode: resolution.reasonCode,
    reasonDetail: input.reasonDetail ?? null,
    roundOrigin: `lusha_branch_${input.branchIndex}_page_${input.page}`,
    evidence: {
      provider: LUSHA_PENDING_REVIEW_PROVIDER,
      discard_kind: input.event.kind,
      branch_index: input.branchIndex,
      page: input.page,
      ...(input.evidence ?? {}),
    },
  };
}

export { normalizeLushaCompanyName };

function employeesLabel(company: LushaPreviewCompany): string | null {
  const known = classifyKnownEmployeeCount(company.employeesExact);
  if (known !== null) return String(known);
  return employeesRangeLabel(company);
}

/** Sólo el rango declarado. Nunca el conteo exacto — ver `buildLushaIcpSizeGate`. */
function employeesRangeLabel(company: LushaPreviewCompany): string | null {
  const min = classifyKnownEmployeeCount(company.employeesMin);
  const max = classifyKnownEmployeeCount(company.employeesMax);
  if (min === null && max === null) return null;
  return `${min ?? '?'}-${max ?? '?'}`;
}

/**
 * § 12 — el tamaño de una empresa Lusha, evaluado por el gate ICP CANÓNICO.
 *
 * No se inventa un segundo gate: se llama a `evaluateIcpSizeGate`, el mismo
 * evaluador puro que usa el escritor de Agente 1, con el conteo exacto cuando
 * Lusha lo trae y con el rango cuando sólo hay rango. Sin dato ⇒ el gate devuelve
 * `needs_validation` por su propia regla («desconocido ≠ menor que el umbral»),
 * que es la respuesta correcta y no una que este módulo elija.
 *
 * 🔴 Lo que este bloque NO hace: cambiar la admisión. `resolveIcpSizeGateWriterAction`
 * —el lado del contrato que bloquea candidatos y fuerza revisión— NO se cablea
 * aquí. Escribir el veredicto es honestidad de ficha; convertirlo en un filtro de
 * persistencia sería un segundo gate de admisión sin QA.
 *
 * 🔴 A1-LUSHA-WATERFALL-SIZE-GATE § CUT-5A — y sigue sin cablearse a propósito,
 * porque el suelo de tamaño YA lo aplica el gate compartido de intake: la
 * admisión toma `minEmployees` de `resolveLushaLocalMinEmployees`, que usa
 * `ICP_SIZE_GATE_DEFAULT_THRESHOLD`, el MISMO umbral que evalúa esta función. Los
 * dos coinciden por construcción, y hay una sola autoridad de admisión. Añadir
 * aquí una segunda decisión sobre la misma pregunta sería la doble autoridad que
 * este repo evita en todas partes.
 */
export function buildLushaIcpSizeGate(company: LushaPreviewCompany): IcpSizeGateResult {
  // 🔴 § CUT-5B — el conteo entra por `classifyKnownEmployeeCount`, la MISMA
  // clasificación que usa el normalizador del que bebe la admisión. Antes de
  // este corte la ficha leía `employeesExact` en crudo y las dos discrepaban en
  // las tres puntas donde el valor no es un conteo limpio:
  //
  //   · `NaN`      — `NaN >= 200` es `false`, así que la ficha decía `block`.
  //                  Eso es inventar un veredicto de tamaño a partir de un valor
  //                  que no es un tamaño.
  //   · negativos  — mismo camino, mismo invento.
  //   · `0`        — la ficha decía `block` y la admisión, que lo recibía ya
  //                  colapsado a `null`, decía «desconocido». Ahora las dos leen
  //                  cero-conocido y las dos bloquean.
  //
  // La ficha no decide: describe la MISMA decisión. Que no puedan discrepar es
  // el punto, y una prueba de mutación lo vigila.
  const knownCount = classifyKnownEmployeeCount(company.employeesExact);
  return evaluateIcpSizeGate({
    employeeCount: knownCount,
    // Sin conteo utilizable la etiqueta de rango tampoco puede afirmar nada: un
    // `NaN` rendido como texto sería un rango inventado.
    sizeRange: knownCount === null ? employeesRangeLabel(company) : employeesLabel(company),
    source: LUSHA_PENDING_REVIEW_PROVIDER,
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a matched id looks like a real SellUp account UUID. */
export function isValidAccountUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

/**
 * Dedupe de la corrida — AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 § 10.
 *
 * El `dedupeLushaCompanies` que vivía aquí deduplicaba con UNA clave por empresa
 * (`dominio ?? nombre`) sobre un `Set` compartido entre páginas. Con ramas eso
 * dejaba escapar duplicados de forma sistemática —la misma empresa vuelta por dos
 * ramas con el dominio presente en una respuesta y ausente en la otra genera dos
 * claves distintas— y se sustituye por `dedupeLushaCompaniesByIdentity`, que
 * reconoce cuatro identidades (id de proveedor, dominio, LinkedIn, y el nombre
 * como respaldo) contra un registro de CORRIDA.
 *
 * No se conservan las dos: dos rutas de dedupe con la misma intención acabarían
 * discrepando, y la que decidiera sería la que el orquestador llamara ese día.
 */
export { dedupeLushaCompaniesByIdentity };

/**
 * Build the canonical duplicate-check input for a Lusha company.
 *
 * Q3F-5BB.10C2: Lusha company prospecting itself returns no fiscal identifier, but
 * the shared official-source enrichment can supply a STRONG one (e.g. Colombia
 * name→NIT). When an `enriched` identity is provided, its `taxIdentifier` /
 * `legalName` are threaded into the checker so an exact tax-id match can surface a
 * strong duplicate (see the SellUp checker's tax_identifier lookup). With no
 * enrichment the behavior is unchanged (taxIdentifier stays null).
 */
export function buildLushaDuplicateCheckInput(
  company: LushaPreviewCompany,
  input: LushaPreviewInput,
  enriched?: EnrichedProspectCandidateIdentity | null,
): DuplicateCheckInput {
  const domain = normalizeDomain(company.domain);
  return {
    name: company.name ?? '',
    normalizedName: normalizeLushaCompanyName(company.name),
    website: company.domain ? `https://${company.domain}` : null,
    domain,
    country: company.country,
    countryCode: company.countryIso2 ?? input.countryCode ?? null,
    // Strong official-source identity when available (else null — unchanged).
    taxIdentifier: enriched?.taxIdentifier ?? null,
    legalName: enriched?.legalName ?? null,
  };
}

// ─── Shared intake pipeline adapters (Q3F-5BB.10C2) ───────────────────────────

/**
 * Map a preview-normalized `LushaPreviewCompany` into the raw structural shape the
 * shared Lusha adapter consumes, then into a `ProviderDiscoveredCompany`. This
 * routes Lusha through the SAME provider-agnostic mapper Apollo/Tavily use, so
 * domain/website/LinkedIn/country/employees are mapped identically for every
 * provider. Pure.
 */
export function lushaPreviewCompanyToProviderDiscoveredCompany(
  company: LushaPreviewCompany,
  criteria: ProspectSearchCriteria,
) {
  const raw: LushaRawCompany = {
    id: company.providerCompanyId,
    name: company.name,
    domain: company.domain,
    website: company.domain ? `https://${company.domain}` : null,
    linkedin: company.linkedinUrl,
    employeeCount: company.employeesExact,
    industry: company.industry,
    country: company.country,
    countryCode: company.countryIso2,
  };
  return mapLushaCompanyToProviderDiscoveredCompany(raw, {
    requestId: null,
    searchCriteria: criteria,
  });
}

/**
 * 🔴 A1-LUSHA-WATERFALL-SIZE-GATE § CUT-5A — el suelo de tamaño LOCAL de una
 * corrida de Lusha, que ya no puede quedarse en `null`.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `minEmployees` era «el mínimo de la banda pedida al proveedor», y la pierna
 * Lusha del waterfall NO pide banda: `runLushaWaterfallLeg` no manda
 * `sizeBandKey`, así que `resolveLushaPreviewSizeBand` devolvía `null`, el
 * `requestSummary.sizeBand` viajaba `null` y este campo salía `null`. Con
 * `minEmployees === null` el gate compartido de intake SALTA por completo su
 * comprobación de tamaño (ver `evaluateProspectIntakeGate`, § 4: exige
 * `minEmployees !== null`). Resultado: en el waterfall, Lusha admitía empresas
 * de cualquier tamaño — ni filtro de proveedor ni filtro local.
 *
 * ── Por qué el suelo es incondicional ────────────────────────────────────────
 *
 * Porque la definición de negocio no depende de lo que se le pidió al
 * proveedor. `ICP_SIZE_GATE_DEFAULT_THRESHOLD` (200, inclusivo) es el mismo
 * umbral que evalúa `buildLushaIcpSizeGate` en la ficha y el mismo que aplica el
 * writer de Apollo, así que la admisión y lo que la ficha declara no pueden
 * discrepar. Una banda MÁS estricta que el suelo se respeta tal cual —pedir
 * `1001-5000` y admitir desde 200 sería relajar lo pedido—; una banda más laxa,
 * o su ausencia, cae al suelo.
 *
 * ── Lo que esto NO es ────────────────────────────────────────────────────────
 *
 * NO es un filtro de proveedor. Este valor no entra en el cuerpo de la petición
 * —`buildLushaPreviewRequest` sólo mira `sizeBand`— y se calcula DESPUÉS de la
 * respuesta, a partir de `requestSummary`. El crédito de la página ya está
 * gastado cuando el suelo se aplica: este corte no ahorra créditos y no pretende
 * ahorrarlos. Lo que impide es que una empresa por debajo del ICP llegue a ser
 * candidato.
 *
 * NO hay techo. `>= 200` no tiene extremo superior: 5.000 y 1.000.000 pasan
 * igual, y `maxEmployees` sigue siendo sólo la banda pedida (el gate compartido
 * no la usa para bloquear).
 *
 * Pura.
 */
export function resolveLushaLocalMinEmployees(requestedBandMin: number | null | undefined): number {
  return typeof requestedBandMin === 'number' &&
    Number.isFinite(requestedBandMin) &&
    requestedBandMin > ICP_SIZE_GATE_DEFAULT_THRESHOLD
    ? requestedBandMin
    : ICP_SIZE_GATE_DEFAULT_THRESHOLD;
}

/**
 * Build the provider-neutral search criteria for the gate + enrichment from the
 * wizard input and the server-authoritative request summary. `minEmployees` is the
 * LOCAL ICP floor (never null — see `resolveLushaLocalMinEmployees`), raised to the
 * requested size-band minimum when that band is stricter, so the gate's
 * `known_employee_count_below_min` check always enforces at least the ICP floor.
 * Pure.
 */
export function buildLushaProspectSearchCriteria(
  input: LushaPreviewInput,
  search: LushaPreviewResult,
): ProspectSearchCriteria {
  const rs = search.requestSummary;
  return {
    countryCode: input.countryCode ?? null,
    country: rs.country ?? null,
    sector: rs.sector ?? input.macroIndustryKey ?? null,
    minEmployees: resolveLushaLocalMinEmployees(rs.sizeBand?.min ?? null),
    maxEmployees: rs.sizeBand?.max ?? null,
    sourceProvider: LUSHA_PENDING_REVIEW_PROVIDER,
  };
}

/** Build the active-candidate guard input for a Lusha company. */
export function buildLushaGuardInput(company: LushaPreviewCompany): DuplicateGuardInput {
  const name = company.name ?? null;
  return {
    name,
    domain: normalizeDomain(company.domain),
    website: company.domain ? `https://${company.domain}` : null,
    // Lusha has no separate inferred/service-title identity — use the raw name.
    inferredCompanyName: name,
    normalizedName: normalizeLushaCompanyName(company.name),
  };
}

/**
 * Strong active matches are SKIPPED before insert (canonical writer behavior).
 *
 * AGENT1-LUSHA-CUT-L7 § 17 — el eje fuerte es el DOMINIO y sólo el dominio.
 * `same_inferred_identity` comparaba `inferred_company_name` normalizado: es
 * NOMBRE, y saltaba duro sin dejar rastro, así que dos empresas homónimas con
 * dominios distintos se reducían a una en silencio. Ahora sobrevive como
 * evidencia de posible duplicado (`resolveLushaCandidateDuplicateState`).
 */
export function isStrongActiveGuardMatch(match: DuplicateGuardMatch): boolean {
  return match.matched && isStrongActiveGuardReason(match.reason);
}

/**
 * Derive a coarse match type from the SellUp/HubSpot checker's free-text reason.
 * The checkers only expose a human `reason` string (see sellup/hubspot-duplicate
 * -checker), so we pattern-match it into a stable enum for the reviewer UI. Falls
 * back to `unknown` rather than guessing.
 */
export function classifySellupHubspotMatchType(reason: string | null | undefined): LushaDuplicateMatchType {
  const r = (reason ?? '').toLowerCase();
  if (/dominio exacto|exact domain/.test(r)) return 'exact_domain';
  if (/identificador fiscal|nit|tax id/.test(r)) return 'exact_tax_id';
  if (/nombre normalizado exacto|normalized name/.test(r)) return 'name_country';
  if (/nombre similar|similar|contenido/.test(r)) return 'name_similarity';
  return 'unknown';
}

/** Map the active-candidate guard reason to a reviewer-facing match type. */
export function classifyActiveGuardMatchType(
  reason: DuplicateGuardMatch['reason'],
): LushaDuplicateMatchType {
  switch (reason) {
    case 'same_active_domain':
      return 'active_domain';
    case 'same_canonical_identity':
      return 'canonical_identity';
    case 'same_inferred_identity':
      return 'canonical_identity';
    default:
      return 'unknown';
  }
}

const SOURCE_LABEL: Record<LushaDuplicateDetailSource['source'], string> = {
  sellup: 'SellUp',
  hubspot: 'HubSpot',
  active_candidate: 'candidato activo',
};

/** Compose a short Spanish reviewer sentence from the collected detail sources. */
export function buildDuplicateReviewerMessage(
  status: LushaDbDuplicateStatus,
  sources: LushaDuplicateDetailSource[],
): string {
  if (status === 'no_match' || sources.length === 0) {
    return 'Sin coincidencias con cuentas, HubSpot ni candidatos activos.';
  }
  const who = sources
    .map((s) => {
      const label = SOURCE_LABEL[s.source];
      const name = s.matchedName ?? s.matchedDomain ?? null;
      return name ? `${label} (${name})` : label;
    })
    .join(', ');
  if (status === 'exact_duplicate') {
    return `Duplicado confirmado — coincide con ${who}. Excluido de revisión.`;
  }
  return `Posible duplicado — coincide con ${who}. Requiere revisión humana.`;
}

/**
 * Build the reviewer-facing duplicate detail from the raw checker matches plus the
 * active-candidate guard match. Returns null when nothing coincided (no_match).
 * Only safe fields are copied — never raw payloads.
 */
export function buildLushaDuplicateDetails(
  status: LushaDbDuplicateStatus,
  dupResult: DuplicateCheckResult,
  guardMatch: DuplicateGuardMatch,
): LushaDuplicateDetails | null {
  const sources: LushaDuplicateDetailSource[] = [];
  // § 14 — la FUERZA que se le muestra al revisor sale del lector compartido, no
  // de la etiqueta del checker: un `existing_in_sellup` por NOMBRE es `possible`.
  const identityContext = { candidateDomain: dupResult.input?.domain ?? null };

  for (const m of dupResult.matches) {
    if (m.source !== 'sellup' && m.source !== 'hubspot') continue;
    const evidence = classifyDuplicateIdentityEvidence(m, identityContext);
    const exact = evidence.strength === 'strong';
    const possible = evidence.strength === 'weak';
    if (!exact && !possible) continue; // ignore insufficient_data / new_candidate / unchecked

    const detail: LushaDuplicateDetailSource = {
      source: m.source,
      matchType: classifySellupHubspotMatchType(m.reason),
      strength: exact ? 'exact' : 'possible',
    };
    if (typeof m.confidence === 'number') detail.confidence = m.confidence;
    if (m.matchedName) detail.matchedName = m.matchedName;
    if (m.matchedDomain) detail.matchedDomain = m.matchedDomain;
    if (m.reason) detail.reason = m.reason;
    if (m.source === 'sellup' && isValidAccountUuid(m.matchedId)) {
      detail.matchedAccountId = m.matchedId as string;
    }
    if (m.source === 'hubspot' && typeof m.matchedId === 'string' && m.matchedId.trim()) {
      detail.matchedHubspotCompanyId = m.matchedId;
    }
    sources.push(detail);
  }

  // § 17 — cualquier coincidencia de NOMBRE contra un candidato activo
  // (`same_canonical_identity` o `same_inferred_identity`) aporta evidencia de
  // posible duplicado. Antes `same_inferred_identity` saltaba duro y no dejaba
  // rastro alguno para el revisor.
  if (guardMatch.matched && isWeakActiveGuardReason(guardMatch.reason)) {
    const detail: LushaDuplicateDetailSource = {
      source: 'active_candidate',
      matchType: classifyActiveGuardMatchType(guardMatch.reason),
      strength: 'possible',
    };
    if (guardMatch.matchedName) detail.matchedName = guardMatch.matchedName;
    if (guardMatch.matchedDomain) detail.matchedDomain = guardMatch.matchedDomain;
    if (guardMatch.matchedCandidateId) detail.matchedCandidateId = guardMatch.matchedCandidateId;
    detail.reason =
      guardMatch.reason === 'same_inferred_identity'
        ? 'Mismo nombre inferido que un candidato activo'
        : 'Mismo nombre normalizado que un candidato activo';
    sources.push(detail);
  }

  if (status === 'no_match' || sources.length === 0) return null;

  return {
    status,
    sources,
    reviewerMessage: buildDuplicateReviewerMessage(status, sources),
  };
}

/**
 * Resolve the persisted duplicate state for a single company from the canonical
 * SellUp+HubSpot check result plus the active-candidate guard match.
 *
 * Mapping (mirrors candidate-writer's `mapDuplicateStatus` semantics):
 *   - any SellUp/HubSpot exact match         → exact_duplicate
 *   - any SellUp/HubSpot possible match, OR
 *     active guard `same_canonical_identity` → possible_duplicate
 *   - otherwise                              → no_match
 *
 * HubSpot leniency (Q3F-5BB.7): when the secondary HubSpot check could not run
 * (not connected / errored) we record `hubSpotDuplicateCheck = skipped_unavailable`
 * and DO NOT let that turn the whole candidate into a blocking status — the
 * primary SellUp accounts check still ran. This is the one deliberate divergence
 * from the canonical consolidator, which conservatively emits `unchecked`.
 */
export function resolveLushaCandidateDuplicateState(
  dupResult: DuplicateCheckResult,
  guardMatch: DuplicateGuardMatch,
): LushaCandidateDuplicateResolution {
  // AGENT1-LUSHA-CUT-L7 §§ 14-16 — «exacto» exige identidad FUERTE, no la
  // etiqueta. El dominio del candidato entra como contexto del veto de § 8.
  const identityContext = { candidateDomain: dupResult.input?.domain ?? null };

  const sellupExact = findStrongIdentityDuplicateMatch(dupResult.matches, 'sellup', identityContext);
  const sellupPossible = findWeakIdentityDuplicateMatch(dupResult.matches, 'sellup', identityContext);
  const hubspotExact = findStrongIdentityDuplicateMatch(dupResult.matches, 'hubspot', identityContext);
  const hubspotPossible = findWeakIdentityDuplicateMatch(dupResult.matches, 'hubspot', identityContext);

  const hubspotChecked = dupResult.checkedSources.includes('hubspot');
  const hubspotErrored = (dupResult.errors ?? []).some((e) => /hubspot/i.test(e));
  const hubspotAvailable = hubspotChecked && !hubspotErrored;

  // matched_account_id — only when it is a real SellUp account UUID.
  const sellupMatchId = sellupExact?.matchedId ?? sellupPossible?.matchedId ?? null;
  const matchedAccountId = isValidAccountUuid(sellupMatchId) ? (sellupMatchId as string) : null;

  // matched_hubspot_company_id — any non-empty HubSpot object id string.
  const hubspotMatchId = hubspotExact?.matchedId ?? hubspotPossible?.matchedId ?? null;
  const matchedHubspotCompanyId =
    typeof hubspotMatchId === 'string' && hubspotMatchId.trim().length > 0
      ? hubspotMatchId
      : null;

  const accountDuplicateCheck: AccountDuplicateCheckTrace = sellupExact
    ? 'performed_matched'
    : sellupPossible
      ? 'performed_possible_duplicate'
      : 'performed_no_match';

  const hubSpotDuplicateCheck: HubSpotDuplicateCheckTrace = !hubspotAvailable
    ? 'skipped_unavailable'
    : hubspotExact
      ? 'performed_matched'
      : hubspotPossible
        ? 'performed_possible_duplicate'
        : 'performed_no_match';

  // § 17 — `same_inferred_identity` es igualdad de NOMBRE, igual que
  // `same_canonical_identity`. Deja de ser un salto duro y pasa a contribuir
  // evidencia de posible duplicado, en vez de desaparecer sin dejar rastro.
  const activeWeakName = guardMatch.matched && isWeakActiveGuardReason(guardMatch.reason);
  const activeCandidateDuplicateCheck: ActiveCandidateDuplicateCheckTrace = activeWeakName
    ? 'performed_possible_duplicate'
    : 'performed_no_match';

  const dbDuplicateStatus: LushaDbDuplicateStatus =
    sellupExact || hubspotExact
      ? 'exact_duplicate'
      : sellupPossible || hubspotPossible || activeWeakName
        ? 'possible_duplicate'
        : 'no_match';

  return {
    dbDuplicateStatus,
    matchedAccountId,
    matchedHubspotCompanyId,
    accountDuplicateCheck,
    hubSpotDuplicateCheck,
    activeCandidateDuplicateCheck,
    activeGuardReason: guardMatch.matched ? guardMatch.reason : null,
    duplicateDetails: buildLushaDuplicateDetails(dbDuplicateStatus, dupResult, guardMatch),
  };
}

/** A resolved candidate is USEFUL (reviewable) when it is not an exact duplicate. */
export function isUsefulLushaResolution(resolution: LushaCandidateDuplicateResolution): boolean {
  return resolution.dbDuplicateStatus !== 'exact_duplicate';
}

/**
 * AGENT1-LUSHA-CUT-L5 §§ 7, 8 — lo ESPERADO frente a lo REAL, de la corrida entera.
 *
 * `expectedCreditsTotal` sale de `max(1, ceil(resultados / 25))` por página;
 * `actualCreditsTotal` es la suma de `billing.creditsCharged`. Que difieran no se
 * corrige: se publica.
 */
export type LushaRunBillingContractSummary = {
  /** Resultados por bloque, tal como el contrato HUMANO los define. */
  billingBlockSize: number;
  /** Tamaño de página que la ruta pagada solicitó. */
  requestedPageSize: number;
  /** Techo de créditos de UNA petición de ese tamaño. */
  requestLiabilityCreditsPerPage: number | null;
  /** Suma de lo que el contrato esperaba. `null` si ninguna página fue tasable. */
  expectedCreditsTotal: number | null;
  /** Suma de lo REAL. Nunca derivada. */
  actualCreditsTotal: number | null;
  /** Páginas cuyo cargo real no coincidió con el esperado. */
  mismatchedPages: number;
  /** `true` = todo cuadró · `false` = hubo incumplimiento · `null` = indeterminable. */
  matchesContract: boolean | null;
  /** Una página cobró por encima de su responsabilidad reservada (§ 9). */
  exceededRequestLiability: boolean;
};

/** Aggregate top-up + duplicate-classification metrics for the batch summary. */
export interface LushaPendingReviewBatchMetrics {
  pagesRequested: number;
  creditsChargedTotal: number | null;
  /**
   * CUT-L5 §§ 7, 8 — esperado vs real. Opcional para que los llamadores legacy
   * sigan compilando; ausente ⇒ los metadatos conservan su forma previa al corte.
   */
  billingContract?: LushaRunBillingContractSummary;
  resultsReturnedTotal: number | null;
  usefulCandidatesCount: number;
  possibleDuplicatesCount: number;
  excludedExactDuplicatesCount: number;
  skippedActiveDuplicatesCount: number;
  topUpTriggered: boolean;
  /** Auditable detail of every excluded exact duplicate (Q3F-5BB.7D). Optional so
   *  legacy callers keep compiling; treated as `[]` when omitted. */
  excludedExactDuplicates?: LushaExcludedExactDuplicate[];
  // ── Shared intake pipeline metrics (Q3F-5BB.10C2). All optional so legacy
  //    callers/tests keep compiling; omitted → absent from batch metadata. ──
  /** Aggregate mandatory-gate outcome (hard/warning/clean + reason counts). */
  gateSummary?: LushaGateSummary;
  /** Bounded, PII-safe audit entries for companies the gate hard-excluded. */
  excludedByMandatoryGate?: LushaGateAuditEntry[];
  /** Aggregate official-source enrichment outcome. */
  enrichmentSummary?: LushaOfficialSourceEnrichmentSummary;
  /**
   * §§ 18/19 — telemetría de corrida + ramas. Opcional para que los llamadores
   * antiguos sigan compilando; omitida ⇒ ausente de los metadatos del lote, que
   * quedan byte a byte como antes de este trabajo.
   */
  multiBranchTelemetry?: LushaRunTelemetry;
}

/** Build the batch insert row (deterministic — no clocks, no randomness). */
/**
 * 🔴 AGENT1-LOCAL-CUT9A § 8 — el parámetro `persistedCount` SE ELIMINÓ.
 *
 * No se dejó de usar: dejó de existir. Era la única cifra a mano que podía
 * aterrizar en `target_count`, y mientras estuviera en el ámbito bastaba un
 * despiste para que un contribuyente volviera a redefinir la petición. Ahora el
 * objetivo pedido sólo puede venir de `actor.requestedTarget`, que lo fija el
 * propietario del lote antes de que corra nada.
 */
export function buildLushaPendingReviewBatchRow(
  input: LushaPreviewInput,
  actor: PersistLushaPendingReviewActor,
  search: LushaPreviewResult,
  metrics: LushaPendingReviewBatchMetrics,
): LushaPendingReviewBatchRow {
  const rs = search.requestSummary;
  const sectorLabel = rs.sector ?? input.macroIndustryKey ?? '—';
  const countryLabel = rs.country ?? input.countryCode;
  const excludedExactDuplicates = metrics.excludedExactDuplicates ?? [];
  const excludedByMandatoryGate = metrics.excludedByMandatoryGate ?? [];

  return {
    name: `Búsqueda con IA · ${sectorLabel} · ${countryLabel}`,
    country: rs.country ?? null,
    country_code: input.countryCode ?? null,
    industry: rs.sector ?? null,
    // § 8 — la PETICIÓN, no el residual. Ver la cabecera del campo en la fila.
    // § 8 — la PETICIÓN, no el residual. Ver la cabecera del campo en la fila.
    target_count: actor.requestedTarget,
    client_request_id: actor.clientRequestId,
    search_depth: 'standard',
    status: LUSHA_PENDING_REVIEW_BATCH_STATUS,
    source: LUSHA_PENDING_REVIEW_BATCH_SOURCE,
    owner_id: actor.internalUserId,
    created_by: actor.internalUserId,
    metadata: {
      provider: LUSHA_PENDING_REVIEW_PROVIDER,
      discovery_source: 'generate_with_ia_wizard',
      limited_scope: true,
      do_not_sync_hubspot: true,
      do_not_call_enrichment: true,
      // Duplicate parity ran before persistence (Q3F-5BB.7).
      duplicate_resolution_version: LUSHA_DUPLICATE_RESOLUTION_VERSION,
      request: {
        country_code: input.countryCode,
        // AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 § 2 — la clave del metadato NO
        // cambia (`sector_key` ya está escrita en lotes de Producción y
        // renombrarla partiría en dos la lectura histórica); lo que cambia es lo
        // que contiene: la identidad de industria que resolvió la petición, que
        // en la ruta moderna es una `MacroIndustryKey`. `macro_industry_key` la
        // publica sin ambigüedad para quien lea metadatos nuevos.
        sector_key: rs.industryKey,
        macro_industry_key: rs.macroIndustryKey,
        main_industries_ids: rs.mainIndustriesIds,
        sub_industry_id: rs.subIndustryId,
        size_band: rs.sizeBand,
        has_search_text: rs.hasSearchText,
      },
      // Safe billing metadata only — no API key, no headers, no raw payload.
      billing: {
        provider: LUSHA_PENDING_REVIEW_PROVIDER,
        endpoint_category: 'company_prospecting',
        credits_charged: metrics.creditsChargedTotal,
        results_returned: metrics.resultsReturnedTotal,
        // Techo de la CORRIDA cuando se conoce el plan (ramas × techo por rama);
        // el techo por rama cuando no hay plan, que es el valor de siempre.
        expected_max_credits:
          metrics.multiBranchTelemetry !== undefined
            ? metrics.multiBranchTelemetry.branchCountPlanned *
              LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS
            : LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS,
        pages_requested: metrics.pagesRequested,
        // ── CUT-L5 §§ 7, 8 — el contraste, junto al importe REAL ──────────────
        //
        // 🔴 `credits_charged` (arriba) NO se toca: sigue siendo la liquidación.
        // Esto es lo que el contrato de bloques decía, y `billing_contract_match`
        // es la única forma de descubrir sin abrir la base que el proveedor cobró
        // por reglas distintas de las que dijo tener.
        //
        // Ausente cuando la corrida no despachó nada, para que un lote anterior al
        // corte conserve su forma byte por byte.
        ...(metrics.billingContract
          ? {
              billing_block_size: metrics.billingContract.billingBlockSize,
              requested_page_size: metrics.billingContract.requestedPageSize,
              request_liability_credits_per_page:
                metrics.billingContract.requestLiabilityCreditsPerPage,
              expected_credits_total: metrics.billingContract.expectedCreditsTotal,
              billing_contract_match: metrics.billingContract.matchesContract,
              billing_contract_mismatched_pages: metrics.billingContract.mismatchedPages,
              billing_exceeded_request_liability:
                metrics.billingContract.exceededRequestLiability,
            }
          : {}),
      },
      // §§ 18/19 — ejecución multi-rama. Sólo se emite cuando el core la pasa, de
      // modo que un lote de la ruta legacy conserva su forma exacta.
      ...(metrics.multiBranchTelemetry
        ? { multi_branch: toLushaRunTelemetryMetadata(metrics.multiBranchTelemetry) }
        : {}),
      // Aggregate duplicate-classification + top-up summary (Q3F-5BB.7B).
      duplicate_summary: {
        total_useful_persisted: metrics.usefulCandidatesCount,
        possible_duplicates_persisted: metrics.possibleDuplicatesCount,
        exact_duplicates_excluded: metrics.excludedExactDuplicatesCount,
        active_duplicates_skipped: metrics.skippedActiveDuplicatesCount,
        pages_requested: metrics.pagesRequested,
        top_up_triggered: metrics.topUpTriggered,
        // Length of the auditable excluded-duplicate detail array (Q3F-5BB.7D).
        excluded_details_count: excludedExactDuplicates.length,
      },
      // Auditable per-company detail of the exact duplicates that were EXCLUDED
      // from the reviewable candidates (Q3F-5BB.7D). Safe fields only — no raw
      // payloads, headers or secrets. Empty array when nothing was excluded.
      excludedExactDuplicates,
      // ── Shared intake pipeline summary (Q3F-5BB.10C2) ──
      // Aggregate mandatory-gate outcome.
      gate_summary: {
        hard_excluded_count: metrics.gateSummary?.hardExcludedCount ?? 0,
        warning_count: metrics.gateSummary?.warningCount ?? 0,
        clean_count: metrics.gateSummary?.cleanCount ?? 0,
        reason_counts: metrics.gateSummary?.reasonCounts ?? {},
      },
      // Bounded, PII-safe audit entries for companies the gate hard-excluded
      // (never persisted as reviewable candidates). Empty when nothing excluded.
      excludedByMandatoryGate,
      // Aggregate official-source enrichment outcome.
      source_enrichment_summary: {
        matched_count: metrics.enrichmentSummary?.matchedCount ?? 0,
        low_confidence_count: metrics.enrichmentSummary?.lowConfidenceCount ?? 0,
        not_found_count: metrics.enrichmentSummary?.notFoundCount ?? 0,
        unsupported_count: metrics.enrichmentSummary?.unsupportedCount ?? 0,
        error_count: metrics.enrichmentSummary?.errorCount ?? 0,
      },
    },
  };
}

/**
 * Build the `metadata.duplicate_check` block in the canonical shape the review
 * LIST (Prospectos data table) already renders via `parseDuplicateCheck`:
 * `{ summary, sources_checked, matches[] }`. Feeding this makes the tooltip +
 * detail dialog show the matched company name/domain/reason for Lusha candidates
 * (Q3F-5BB.7B) — instead of the previous generic "SellUp: duplicado confirmado".
 * The active-candidate source maps to `sellup` here (the list UI only knows
 * sellup/hubspot); its reason string makes the candidate origin explicit.
 */
export function buildLushaDuplicateCheckMetadata(
  resolution: LushaCandidateDuplicateResolution,
): Record<string, unknown> {
  const sources_checked = ['sellup'];
  if (resolution.hubSpotDuplicateCheck !== 'skipped_unavailable') sources_checked.push('hubspot');

  const matches = (resolution.duplicateDetails?.sources ?? []).map((s) => ({
    source: s.source === 'active_candidate' ? 'sellup' : s.source,
    status: s.strength === 'exact' ? 'exact_duplicate' : 'possible_duplicate',
    confidence: typeof s.confidence === 'number' ? s.confidence : null,
    matched_name: s.matchedName ?? null,
    matched_domain: s.matchedDomain ?? null,
    matched_website: null,
    matched_id:
      s.matchedAccountId ?? s.matchedHubspotCompanyId ?? s.matchedCandidateId ?? null,
    reason: s.reason ?? null,
  }));

  return {
    summary: resolution.duplicateDetails?.reviewerMessage ?? 'Sin coincidencias',
    sources_checked,
    matches,
  };
}

/**
 * Build the `metadata.validation` block in the canonical shape the candidate
 * DETAIL sheet's "Validación" tab already renders (sellup/hubspot duplicate
 * checks with matched name/domain/id). The SellUp slot prefers a real account
 * match; when the only signal is an active-candidate canonical match it surfaces
 * that with `matched_source: 'candidate'` + `matched_candidate_id`, which the
 * sheet renders correctly. HubSpot slot is omitted when the check was unavailable.
 */
export function buildLushaValidationMetadata(
  resolution: LushaCandidateDuplicateResolution,
): Record<string, unknown> {
  const sources = resolution.duplicateDetails?.sources ?? [];
  const sellupAccount = sources.find((s) => s.source === 'sellup');
  const activeCandidate = sources.find((s) => s.source === 'active_candidate');
  const hubspot = sources.find((s) => s.source === 'hubspot');

  // ── SellUp slot ──
  let sellupStatus: 'duplicate' | 'possible_duplicate' | 'no_match';
  if (resolution.accountDuplicateCheck === 'performed_matched') sellupStatus = 'duplicate';
  else if (resolution.accountDuplicateCheck === 'performed_possible_duplicate')
    sellupStatus = 'possible_duplicate';
  else if (resolution.activeCandidateDuplicateCheck === 'performed_possible_duplicate')
    sellupStatus = 'possible_duplicate';
  else sellupStatus = 'no_match';

  const sellupMatch = sellupAccount ?? activeCandidate ?? null;
  const sellup_duplicate_check: Record<string, unknown> = { status: sellupStatus };
  if (sellupMatch) {
    if (sellupMatch.matchedName) sellup_duplicate_check.matched_name = sellupMatch.matchedName;
    if (sellupMatch.matchedDomain) sellup_duplicate_check.matched_domain = sellupMatch.matchedDomain;
    if (sellupMatch.source === 'active_candidate') {
      sellup_duplicate_check.matched_source = 'candidate';
      if (sellupMatch.matchedCandidateId)
        sellup_duplicate_check.matched_candidate_id = sellupMatch.matchedCandidateId;
    } else {
      sellup_duplicate_check.matched_source = 'account';
      if (resolution.matchedAccountId)
        sellup_duplicate_check.matched_account_id = resolution.matchedAccountId;
    }
    sellup_duplicate_check.matched_by = sellupMatch.matchType;
  }

  const validation: Record<string, unknown> = { sellup_duplicate_check };

  // ── HubSpot slot (omit entirely when unavailable) ──
  if (resolution.hubSpotDuplicateCheck !== 'skipped_unavailable') {
    const hsStatus =
      resolution.hubSpotDuplicateCheck === 'performed_matched'
        ? 'match'
        : resolution.hubSpotDuplicateCheck === 'performed_possible_duplicate'
          ? 'possible_match'
          : 'no_match';
    const hubspot_duplicate_check: Record<string, unknown> = { status: hsStatus };
    if (hubspot?.matchedName) hubspot_duplicate_check.matched_company_name = hubspot.matchedName;
    if (resolution.matchedHubspotCompanyId)
      hubspot_duplicate_check.matched_company_id = resolution.matchedHubspotCompanyId;
    if (hubspot?.matchedDomain) hubspot_duplicate_check.matched_domain = hubspot.matchedDomain;
    validation.hubspot_duplicate_check = hubspot_duplicate_check;
  }

  return validation;
}

/**
 * 🔴 X6.12 — la ÚNICA proyección de un superviviente a la entrada del contrato
 * de completitud.
 *
 * Existe como función con nombre —y no como un objeto literal en cada punto de
 * uso— porque la aceptación se resuelve dos veces por corrida: antes de escribir
 * (metadata del lote, que se escribe cuando las filas todavía no existen) y
 * DESPUÉS de escribir (la verdad final del writer). Dos literales serían dos
 * definiciones de «completa» capaces de separarse, que es el defecto que CUT-7 y
 * X5.1 llevan dos cortes cerrando.
 *
 * 🔴 `linkedinUrl` se ACREDITA aquí con el mismo predicado con el que la fila la
 * persiste (`isLinkedInCompanyUrl`). Una URL que la fila no guardaría no puede
 * satisfacer la condición.
 */
export function toLushaSurvivorCompletenessInput(
  entry: ResolvedLushaCandidate,
): SurvivorCompletenessInput {
  return {
    employeeCount:
      typeof entry.company.employeesExact === 'number' ? entry.company.employeesExact : null,
    duplicateStatus: entry.resolution.dbDuplicateStatus,
    ownershipGate: entry.ownership?.gateVerdict ?? 'fail',
    linkedinUrl: isLinkedInCompanyUrl(entry.company.linkedinUrl)
      ? entry.company.linkedinUrl
      : null,
    macroIndustryConfirmed: entry.macroPrecision?.verdict === 'confirmed',
    /**
     * 🔴 X6.14 — el veredicto de CALIDAD real, en sustitución del `'pass'` fijo.
     *
     * Ausente ⇒ `fail`, no `pass`: una candidata construida sin pasar por el
     * gate no ha sido evaluada, y una condición no evaluada no se declara
     * aprobada. Es la misma postura fail-closed que `ownershipGate`.
     */
    qualityGate: entry.quality?.verdict ?? 'fail',
  };
}

/** Build candidate insert rows from resolved companies (post duplicate parity). */
export function buildLushaPendingReviewCandidateRows(
  batchId: string,
  resolved: ResolvedLushaCandidate[],
): LushaPendingReviewCandidateRow[] {
  return resolved.map(({ company, resolution, enriched, gateWarnings, branchProvenance, macroPrecision, ownership, quality }) => {
    // Typed identity columns — filled ONLY on a STRONG official-source match.
    const typedColumns = enriched
      ? buildOfficialSourceTypedColumns(enriched)
      : { tax_identifier: null, tax_identifier_type: null, legal_name: null, legal_status: null };

    return {
    batch_id: batchId,
    name: company.name as string, // dedupe guarantees a non-empty name
    normalized_name: normalizeLushaCompanyName(company.name),
    website: company.domain ? `https://${company.domain}` : null,
    domain: company.domain,
    country: company.country,
    country_code: company.countryIso2,
    industry: company.industry,
    company_size: employeesLabel(company),
    // § 12 — la columna tipada, no sólo la etiqueta de texto.
    employee_count: typeof company.employeesExact === 'number' ? company.employeesExact : null,
    // 🔴 X6.12 — la COLUMNA, no sólo la metadata. La ficha de revisión y el
    // contrato de completitud leen sitios distintos, y hasta este corte esta
    // ruta llenaba únicamente el segundo: la evidencia existía
    // (`metadata.linkedin_enrichment.status = 'found'` en 8 de 8 filas del lote
    // `bedebe9b`) y la columna quedaba vacía, así que `linkedin_status` se
    // declaraba NO DISPONIBLE por un defecto de transporte.
    //
    // Se acredita con el MISMO predicado que decide el bloque de metadata: una
    // URL que no sea página de empresa no se escribe, jamás se fabrica.
    linkedin_url: isLinkedInCompanyUrl(company.linkedinUrl) ? company.linkedinUrl : null,
    // 🔴 VISIBILIDAD DE OWNERSHIP (opción C) — el veredicto deja de vivir sólo
    // en `metadata` y se publica donde la cola y la ficha YA miran.
    //
    // 🔴 Sin evaluación no hay fila marcada NI fila absuelta: `null` dice
    // «nadie lo juzgó», que es distinto de «se juzgó y pasó».
    review_flags: ownership
      ? [...resolveOwnershipReviewFlags({ evaluated: true, admitted: !ownership.admission.blocked })]
      : null,
    employee_count_source:
      typeof company.employeesExact === 'number' ? LUSHA_PENDING_REVIEW_PROVIDER : null,
    // Strong official-source identity (or nulls) — Q3F-5BB.10C2.
    tax_identifier: typedColumns.tax_identifier,
    tax_identifier_type: typedColumns.tax_identifier_type,
    legal_name: typedColumns.legal_name,
    legal_status: typedColumns.legal_status,
    source_primary: LUSHA_PENDING_REVIEW_CANDIDATE_SOURCE,
    sources_checked: [LUSHA_PENDING_REVIEW_PROVIDER],
    duplicate_status: resolution.dbDuplicateStatus,
    matched_account_id: resolution.matchedAccountId,
    matched_hubspot_company_id: resolution.matchedHubspotCompanyId,
    confidence_score: null,
    fit_score: typeof company.score === 'number' ? company.score : null,
    data_completeness_score: null,
    status: LUSHA_PENDING_REVIEW_CANDIDATE_STATUS,
    record_origin: LUSHA_PENDING_REVIEW_RECORD_ORIGIN,
    classification_source: LUSHA_PENDING_REVIEW_CLASSIFICATION_SOURCE,
    source_trace: {
      sourceProvider: LUSHA_PENDING_REVIEW_PROVIDER,
      sourceKey: company.domain ?? company.providerCompanyId ?? null,
      providerCompanyId: company.providerCompanyId ?? null,
      discovery: 'generate_with_ia_wizard',
      duplicateResolutionVersion: LUSHA_DUPLICATE_RESOLUTION_VERSION,
      // What actually ran before persistence (Q3F-5BB.7 — no longer 'not_performed').
      accountDuplicateCheck: resolution.accountDuplicateCheck,
      hubSpotDuplicateCheck: resolution.hubSpotDuplicateCheck,
      activeCandidateDuplicateCheck: resolution.activeCandidateDuplicateCheck,
      ...(resolution.activeGuardReason
        ? { activeCandidateGuardReason: resolution.activeGuardReason }
        : {}),
      // Reviewer-facing detail contract (Q3F-5BB.7B) — who/where/why it coincided.
      ...(resolution.duplicateDetails
        ? { duplicateDetails: resolution.duplicateDetails }
        : {}),
    },
    metadata: {
      provider: LUSHA_PENDING_REVIEW_PROVIDER,
      score: company.score,
      passes_gate: company.passesGate,
      issues: company.issues,
      // Flat path kept for backward compatibility (existing batches read it).
      linkedin_url: company.linkedinUrl,
      // Canonical path the review UI already reads via getCandidateLinkedInUrl /
      // getCandidateLinkedInDisplay (Q3F-5BB.7D). Only written when Lusha returned
      // a real company profile URL — never fabricated.
      ...(isLinkedInCompanyUrl(company.linkedinUrl)
        ? {
            linkedin_enrichment: {
              status: 'found' as const,
              company_url: company.linkedinUrl,
              source: LUSHA_PENDING_REVIEW_PROVIDER,
            },
          }
        : {}),
      employees: {
        exact: company.employeesExact,
        min: company.employeesMin,
        max: company.employeesMax,
      },
      // § 12 — el bloque que la ficha de revisión LEE para «Tamaño ICP»
      // (`getIcpSizeGateUiState`). Sin él el candidato salía como «Sin evaluación
      // de tamaño» aunque el proveedor hubiera entregado el conteo exacto.
      icp_size_gate: buildLushaIcpSizeGate(company),
      // 🔴 X6.12 — el veredicto de ownership con el que esta candidata se juzgó,
      // acotado y sin PII. `blocks_persistence: false` va en la fila a propósito:
      // el rechazo NO descarta en esta ruta, y quien audite la fila tiene que
      // poder leerlo sin abrir el código.
      ...(ownership ? { ownership_gate: toLushaOwnershipGateMetadata(ownership) } : {}),
      // 🔴 X6.14 — el veredicto de CALIDAD, con sus checks y sus estados. Es lo
      // que permite distinguir «se evaluó y pasó» de «aquí no había nada que
      // evaluar» sin volver a ejecutar nada.
      ...(quality ? { quality_gate: toLushaQualityGateMetadata(quality) } : {}),
      // §§ 5/7 — por qué este candidato cuenta como de la macro pedida, y qué
      // rama lo trajo. Ids y códigos: sin payload del proveedor y sin PII.
      ...(macroPrecision ? { macro_precision: toLushaMacroPrecisionMetadata(macroPrecision) } : {}),
      ...(branchProvenance
        ? {
            branch_provenance: {
              branch_index: branchProvenance.branchIndex,
              main_industry_id: branchProvenance.mainIndustryId,
              sub_industry_id: branchProvenance.subIndustryId,
            },
          }
        : {}),
      // Canonical duplicate metadata so the EXISTING review UI (list tooltip +
      // detail dialog, and the sheet's Validación tab) shows the matched entity
      // instead of a generic label (Q3F-5BB.7B).
      duplicate_check: buildLushaDuplicateCheckMetadata(resolution),
      validation: buildLushaValidationMetadata(resolution),
      // ── Shared intake pipeline metadata (Q3F-5BB.10C2) ──
      // Explicit provider tag (alongside the legacy `provider` key above).
      source_provider: LUSHA_PENDING_REVIEW_PROVIDER,
      // Bounded, PII-safe official-source outcome (never a taxId value in metadata —
      // `taxIdentifierPresent` is a boolean; the value lives only in the typed column).
      ...(enriched
        ? { source_enrichment: buildOfficialSourceEnrichmentMetadata(enriched) }
        : {}),
      // Soft gate signals so a reviewer sees why the candidate was flagged.
      ...(gateWarnings && gateWarnings.length > 0 ? { gate_warnings: gateWarnings } : {}),
    },
  };
  });
}

function sanitizeError(message: string | undefined): string {
  if (!message) return 'Error desconocido al consultar el proveedor.';
  return message.slice(0, 200);
}

// ─── Shared intake pipeline summaries (Q3F-5BB.10C2) ──────────────────────────

/** Bounded, PII-safe audit entry for one gate-excluded company. */
export type LushaGateAuditEntry = ReturnType<typeof buildProspectIntakeGateAuditEntry>;

/** Aggregate mandatory-gate outcome for the batch summary. */
export interface LushaGateSummary {
  hardExcludedCount: number;
  warningCount: number;
  cleanCount: number;
  reasonCounts: Record<string, number>;
}

/** Aggregate official-source enrichment outcome for the batch summary. */
export interface LushaOfficialSourceEnrichmentSummary {
  matchedCount: number;
  lowConfidenceCount: number;
  notFoundCount: number;
  unsupportedCount: number;
  errorCount: number;
}

function emptyGateSummary(): LushaGateSummary {
  return { hardExcludedCount: 0, warningCount: 0, cleanCount: 0, reasonCounts: {} };
}

function emptyEnrichmentSummary(): LushaOfficialSourceEnrichmentSummary {
  return {
    matchedCount: 0,
    lowConfidenceCount: 0,
    notFoundCount: 0,
    unsupportedCount: 0,
    errorCount: 0,
  };
}

/** Tally one enrichment outcome into the running summary (pure, in-place on a local). */
function tallyEnrichmentStatus(
  summary: LushaOfficialSourceEnrichmentSummary,
  status: EnrichedProspectCandidateIdentity['officialSource']['status'],
): void {
  switch (status) {
    case 'matched':
      summary.matchedCount++;
      break;
    case 'low_confidence_match':
      summary.lowConfidenceCount++;
      break;
    case 'not_found':
      summary.notFoundCount++;
      break;
    case 'unsupported_country':
    case 'source_catalog_unavailable':
      summary.unsupportedCount++;
      break;
    case 'error':
      summary.errorCount++;
      break;
    default:
      break;
  }
}

/**
 * AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — la empresa que el gate obligatorio
 * RECHAZÓ, con su identidad completa.
 *
 * 🔴 ADITIVO y aparte de `hardExcluded`. Aquél publica
 * `LushaGateAuditEntry`, que es telemetría de gate y NO lleva
 * `providerCompanyId`, `linkedinUrl` ni la industria declarada. La
 * disposición durable sí los necesita, y descartar identidad que la corrida
 * TIENE en la mano para luego escribir `null` sería perder el dato a
 * propósito. Ningún contador cambia: `gate.hardExcludedCount` y
 * `hardExcluded` siguen siendo exactamente lo que eran.
 */
export interface LushaGateHardExcludedCompany {
  company: LushaPreviewCompany;
  normalized: NormalizedProspectCandidate;
  gateResult: ProspectIntakeGateResult;
}

/**
 * AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — la empresa que el guard de candidato
 * ACTIVO saltó, con la coincidencia que lo justificó.
 *
 * 🔴 ADITIVO: `guardSkippedCount` se conserva TAL CUAL para no tocar la
 * aritmética existente. Esto no decide nada — sólo conserva la identidad de
 * una decisión que ya se tomó.
 */
export interface LushaGuardSkippedCompany {
  company: LushaPreviewCompany;
  normalized: NormalizedProspectCandidate;
  guardMatch: DuplicateGuardMatch;
}

/**
 * 🔴 X6.4-A — la empresa que el gate de PAÍS rechazó, con el veredicto que lo
 * justificó.
 *
 * ADITIVO y con contador propio: `gate.hardExcludedCount`, `hardExcluded` y
 * `guardSkippedCount` siguen contando exactamente lo que contaban. Estas
 * empresas no son «excluidas por el gate compartido de intake» —ése ya las
 * dejó pasar— y mezclarlas con él falsearía una métrica existente.
 */
export interface LushaCountryExcludedCompany {
  company: LushaPreviewCompany;
  normalized: NormalizedProspectCandidate;
  rejection: LushaCountryRejection;
}

/**
 * 🔴 X6.14 — la empresa que la PRECISIÓN MACRO rechazó.
 *
 * Existía antes como decisión, pero se tomaba DESPUÉS del catálogo y del
 * chequeo de duplicados. Ahora se toma antes, así que la identidad tiene que
 * viajar hasta el bucle de rama, que es quien escribe la fila durable y lleva
 * los contadores. La decisión NO cambia: la toma `isLushaMacroPrecisionAdmitted`,
 * exactamente igual que antes.
 */
export interface LushaPrecisionRejectedCompany {
  company: LushaPreviewCompany;
  normalized: NormalizedProspectCandidate;
  precision: LushaMacroPrecisionAssessment;
}

/**
 * 🔴 X6.14 — la empresa que el gate de CALIDAD rechazó, antes del catálogo.
 *
 * Es el desenlace nuevo de este corte: hasta aquí la ruta Lusha declaraba
 * `quality_gate: 'pass'` sin evaluarlo, así que un intermediario de contenido o
 * una plataforma externa entraban a revisión y CONTABAN hacia el mínimo.
 */
export interface LushaQualityRejectedCompany {
  company: LushaPreviewCompany;
  normalized: NormalizedProspectCandidate;
  quality: LushaQualityGateResult;
}

/**
 * 🔴 X6.14 — lo que la precisión macro necesita, transportado hasta la tubería.
 *
 * Son los MISMOS tres campos que `assessLushaMacroPrecision` ya pedía; lo único
 * que cambia es dónde se leen. La industria declarada sale de cada empresa, así
 * que no viaja aquí.
 */
export interface LushaPrecisionEvaluationInput {
  macroIndustryKey: string;
  branch: LushaIndustryBranch | null;
  branchIndex: number;
}

/**
 * La tubería compartida de admisión, en el ORDEN que el producto pide.
 *
 * ── 🔴 X6.14 — el orden, y por qué éste ─────────────────────────────────────
 *
 *   map → normalize → gate obligatorio ──────────► hard_excluded, nunca sigue
 *     → país (X6.4-A) ───────────────────────────► country_rejected, nunca sigue
 *     → precisión macro ─────────────────────────► sector_rejected, nunca sigue
 *     → guarda de candidato ACTIVO ──────────────► sellup_duplicate, nunca sigue
 *     → calidad (intermediario, plataforma externa, página, encaje) ─► nunca sigue
 *     → ownership (evidencia, NO bloquea)
 *     → CONSULTA DE IDENTIDAD al catálogo oficial (NIT / razón social)
 *     → chequeo de duplicados, con esa identidad fuerte enhebrada
 *
 * Antes de este corte el catálogo corría en tercer lugar, así que las empresas
 * que la precisión y la guarda iban a descartar ya lo habían consultado. Los
 * cuatro filtros que ahora suben NO dependen de él: son puros o leen sólo el
 * prefetch de candidatas activas.
 *
 * 🔴 LO QUE NO SE MUEVE, Y ES DELIBERADO: la consulta de identidad sigue ANTES
 * del chequeo de duplicados, porque es quien le da el NIT y la razón social. La
 * dedupe fiscal depende de ella; bajarla la degradaría a dominio y nombre. Es
 * UNA sola consulta y su resultado se reutiliza tal cual —no hay segunda etapa
 * de enriquecimiento en esta ruta, y crear una sería inventar trabajo—.
 *
 * Purely orchestrates injected read-only deps — no I/O of its own.
 */
export async function resolveLushaCandidatesDuplicateState(
  deps: Pick<
    PersistLushaPendingReviewDeps,
    'checkCompanyDuplicate' | 'fetchActiveCandidates' | 'officialSourceResolvers'
  >,
  input: LushaPreviewInput,
  companies: LushaPreviewCompany[],
  criteria: ProspectSearchCriteria,
  /**
   * 🔴 X6.14 — lo que la precisión macro necesita para juzgar, o `null` para la
   * ruta LEGACY sin plan de macro. Ausente ⇒ la precisión no corre, exactamente
   * como hoy: ausencia = comportamiento actual, nunca una degradación silenciosa.
   */
  precisionInput: LushaPrecisionEvaluationInput | null = null,
): Promise<{
  resolved: ResolvedLushaCandidate[];
  guardSkippedCount: number;
  hardExcluded: LushaGateAuditEntry[];
  gate: LushaGateSummary;
  enrichment: LushaOfficialSourceEnrichmentSummary;
  /** ADITIVO — identidad de las rechazadas por el gate. No altera conteos. */
  hardExcludedCompanies: LushaGateHardExcludedCompany[];
  /** ADITIVO — identidad de las saltadas por el guard de activos. */
  guardSkipped: LushaGuardSkippedCompany[];
  /**
   * 🔴 X6.4-A — las rechazadas por PAÍS. NUNCA llegan al chequeo de duplicados
   * ni a `resolved`, así que no pueden persistirse.
   */
  countryExcluded: LushaCountryExcludedCompany[];
  /**
   * 🔴 X6.14 — las rechazadas por PRECISIÓN MACRO. Antes se decidían después
   * del catálogo; ahora no llegan a consultarlo.
   */
  precisionRejected: LushaPrecisionRejectedCompany[];
  /** 🔴 X6.14 — motivos de precisión de ESTA página, para el acumulado del lote. */
  precisionReasonCounts: Record<string, number>;
  /** 🔴 X6.14 — las rechazadas por CALIDAD. Tampoco llegan al catálogo. */
  qualityRejected: LushaQualityRejectedCompany[];
}> {
  const resolvers = deps.officialSourceResolvers ?? [];

  // ── 1. Map → normalize → mandatory gate. Hard-excluded never reach dup check. ──
  const reviewable: Array<{
    company: LushaPreviewCompany;
    normalized: NormalizedProspectCandidate;
    gate: ProspectIntakeGateResult;
  }> = [];
  const hardExcluded: LushaGateAuditEntry[] = [];
  const hardExcludedCompanies: LushaGateHardExcludedCompany[] = [];
  const countryExcluded: LushaCountryExcludedCompany[] = [];
  const gate = emptyGateSummary();

  for (const company of companies) {
    const discovered = lushaPreviewCompanyToProviderDiscoveredCompany(company, criteria);
    // 🔴 A1-LUSHA-WATERFALL-SIZE-GATE § CUT-5B — la pierna Lusha lee el `0` como
    // el conteo que es. Sin esta opción el normalizador compartido lo colapsa a
    // `null`, el gate lo trata como tamaño DESCONOCIDO y una empresa que el
    // proveedor declaró de cero empleados sale a revisión humana en vez de caer
    // por debajo del suelo ICP. Apollo y Tavily no la pasan y no cambian.
    const normalized = normalizeProviderDiscoveredCompany(discovered, criteria, {
      treatZeroEmployeeCountAsKnown: true,
    });
    const gateResult = evaluateProspectIntakeGate(normalized, criteria);

    for (const reason of [...gateResult.hardReasons, ...gateResult.warnings]) {
      gate.reasonCounts[reason] = (gate.reasonCounts[reason] ?? 0) + 1;
    }

    if (gateResult.decision === 'hard_excluded') {
      gate.hardExcludedCount++;
      hardExcluded.push(buildProspectIntakeGateAuditEntry(normalized, gateResult));
      // ADITIVO: la MISMA decisión, con la identidad que la fila durable pide.
      hardExcludedCompanies.push({ company, normalized, gateResult });
      continue; // NEVER sent to the duplicate check.
    }
    // ── 🔴 X6.4-A — PAÍS, antes de persistir ────────────────────────────────
    //
    // El gate compartido de intake compara el `countryCode` que el PROVEEDOR
    // declaró; `evaluateCountryCompatibility` juzga el DOMINIO. Son preguntas
    // distintas, y sólo la segunda podía ver que `www.maestro.com.pe` no es una
    // empresa colombiana por mucho que Lusha la etiquetara `CO`.
    //
    // 🔴 Aquí, y no después: estas empresas no llegan al chequeo de duplicados,
    // no entran en `resolved` y por tanto no pueden acabar en `useful` ni en una
    // fila de `prospect_candidates`.
    // 🔴 `website: null` a propósito: Lusha NO publica sitio aparte —el adaptador
    // lo deriva del dominio— y sintetizar `https://${company.domain}` sobre un
    // `domain` que ya puede venir como URL entera produce `https://https://…`,
    // que el evaluador de país leería como un dominio sin señal. El gate
    // normaliza el dominio y construye la URL una sola vez.
    const countryRejection = evaluateLushaCountryGate({
      domain: company.domain,
      website: null,
      targetCountryCode: input.countryCode ?? criteria.countryCode ?? null,
    });
    if (countryRejection !== null) {
      countryExcluded.push({ company, normalized, rejection: countryRejection });
      continue; // NEVER sent to the duplicate check.
    }

    if (gateResult.decision === 'reviewable_with_warnings') gate.warningCount++;
    else gate.cleanCount++;
    reviewable.push({ company, normalized, gate: gateResult });
  }

  // ── 2. Prefetch active candidates once for the reviewable set (read-only). ──
  const guardDomains = Array.from(
    new Set(
      reviewable
        .map((r) => normalizeDomain(r.company.domain))
        .filter((d): d is string => d !== null),
    ),
  );
  const activeCandidates = await deps.fetchActiveCandidates(
    guardDomains,
    input.countryCode ?? null,
  );

  // ── 3. 🔴 X6.14 — TODO lo que no depende del catálogo, ANTES del catálogo ──
  //
  // Precisión macro, guarda de candidato activo y calidad. Los tres son puros o
  // leen sólo el prefetch de arriba, así que nada de esto exige haber
  // consultado la identidad oficial. Lo que caiga aquí no llega al catálogo.
  const admitted: Array<{
    company: LushaPreviewCompany;
    normalized: NormalizedProspectCandidate;
    gateResult: ProspectIntakeGateResult;
    guardMatch: DuplicateGuardMatch;
    precision: LushaMacroPrecisionAssessment | null;
    quality: LushaQualityGateResult;
  }> = [];
  let guardSkippedCount = 0;
  const guardSkipped: LushaGuardSkippedCompany[] = [];
  const precisionRejected: LushaPrecisionRejectedCompany[] = [];
  const precisionReasonCounts: Record<string, number> = {};
  const qualityRejected: LushaQualityRejectedCompany[] = [];

  for (const { company, normalized, gate: gateResult } of reviewable) {
    // ── 3.a Precisión macro ──────────────────────────────────────────────────
    //
    // 🔴 Sin `precisionInput` no hay macro contra la que juzgar y la ruta legacy
    // se comporta como siempre. La DECISIÓN es la de antes, byte por byte:
    // `assessLushaMacroPrecision` + `isLushaMacroPrecisionAdmitted`.
    let precision: LushaMacroPrecisionAssessment | null = null;
    if (precisionInput !== null) {
      precision = assessLushaMacroPrecision({
        macroIndustryKey: precisionInput.macroIndustryKey,
        branch: precisionInput.branch,
        branchIndex: precisionInput.branchIndex,
        declaredIndustry: company.industry,
      });
      precisionReasonCounts[precision.reason] =
        (precisionReasonCounts[precision.reason] ?? 0) + 1;
      if (!isLushaMacroPrecisionAdmitted(precision)) {
        precisionRejected.push({ company, normalized, precision });
        continue; // 🔴 No llega al catálogo.
      }
    }

    // ── 3.b Guarda de candidato ACTIVO ───────────────────────────────────────
    //
    // 🔴 No consume el enriquecimiento —`buildLushaGuardInput` lee la empresa—,
    // así que puede decidir antes. El criterio no cambia.
    const guardMatch = checkActiveCandidateDuplicate(
      buildLushaGuardInput(company),
      activeCandidates,
    );
    if (isStrongActiveGuardMatch(guardMatch)) {
      guardSkippedCount++;
      guardSkipped.push({ company, normalized, guardMatch });
      continue; // 🔴 No llega al catálogo.
    }

    // ── 3.c Calidad ──────────────────────────────────────────────────────────
    const quality = evaluateLushaQualityGate({
      name: company.name,
      domain: company.domain,
    });
    // 🔴 Sólo `fail` descarta. `unknown` —la identidad no se pudo juzgar— NO
    // rechaza: la candidata sigue, se persiste y se revisa, y el contrato la
    // deja fuera del mínimo declarando la condición no disponible. Inventar un
    // rechazo con evidencia insuficiente es justo lo que este corte prohíbe.
    if (quality.verdict === 'fail') {
      qualityRejected.push({ company, normalized, quality });
      continue; // 🔴 No llega al catálogo.
    }

    admitted.push({ company, normalized, gateResult, guardMatch, precision, quality });
  }

  // ── 4. Sólo las admitidas: consulta de IDENTIDAD → chequeo de duplicados ───
  //
  // 🔴 La consulta de identidad al catálogo oficial (Colombia: `co_siis`,
  // nombre → NIT) NO es el enriquecimiento final del candidato: es el insumo del
  // dedupe fiscal, y por eso tiene que correr antes del chequeo que lo usa. Se
  // hace UNA vez por empresa y su resultado se reutiliza tal cual —columnas
  // tipadas y `metadata.source_enrichment`—; no hay segunda consulta ni segunda
  // etapa, porque el mismo resultado ya trae todo lo que la fila necesita.
  const resolved: ResolvedLushaCandidate[] = [];
  const enrichment = emptyEnrichmentSummary();

  for (const entry of admitted) {
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      entry.normalized,
      criteria,
      resolvers,
    );
    tallyEnrichmentStatus(enrichment, enriched.officialSource.status);

    const dupResult = await deps.checkCompanyDuplicate(
      buildLushaDuplicateCheckInput(entry.company, input, enriched),
    );
    const resolution = resolveLushaCandidateDuplicateState(dupResult, entry.guardMatch);
    // 🔴 X6.12 — el ownership se evalúa sobre la misma empresa que acaba de
    // pasar los gates obligatorios, y NO decide si se persiste: alimenta la
    // condición `ownership_gate` del contrato canónico y queda en la fila.
    const ownership = evaluateLushaOwnershipEvidence({
      name: entry.company.name,
      domain: entry.company.domain,
      linkedinUrl: entry.company.linkedinUrl,
    });
    resolved.push({
      company: entry.company,
      resolution,
      enriched,
      gateWarnings: entry.gateResult.warnings,
      ownership,
      quality: entry.quality,
      ...(entry.precision === null ? {} : { macroPrecision: entry.precision }),
    });
  }

  return {
    resolved,
    guardSkippedCount,
    hardExcluded,
    gate,
    enrichment,
    hardExcludedCompanies,
    guardSkipped,
    countryExcluded,
    precisionRejected,
    precisionReasonCounts,
    qualityRejected,
  };
}

// ─── Core orchestrator ────────────────────────────────────────────────────────

/**
 * AGENT1-LUSHA-MACRO-V2-MULTIBRANCH-EXECUTOR-1 §§ 2–6, 10–19 — opciones de
 * ejecución de una corrida.
 *
 * Todo es opcional y su ausencia es EXACTAMENTE el comportamiento de hoy: sin
 * plan se ejecuta una sola búsqueda derivada del sector, y sin `targetGap` el
 * objetivo es el de siempre (5 candidatos útiles). Los llamadores y las suites
 * que no pasan nada no cambian de comportamiento.
 */
export interface LushaMultiBranchExecution {
  /**
   * Plan Macro-v2 a ejecutar, o `null`/ausente para la búsqueda legacy única.
   *
   * 🔴 Recibirlo por parámetro —en vez de resolverlo aquí— es lo que impide que
   * este módulo se convierta en la autoridad de elegibilidad. Quien decide si hay
   * plan es `resolveLushaSearchPlanForSector`, que sólo devuelve uno para un
   * sector que la autoridad legacy YA admite.
   */
  plan?: Pick<LushaMacroSearchPlan, 'macroKey' | 'branches'> | null;
  /**
   * § 3 — cuántas empresas útiles busca la corrida ENTERA. Ausente = el objetivo
   * de hoy. El ejecutor no asume su objetivo por dentro: ver
   * `resolveLushaTargetGap`.
   */
  targetGap?: number | null;
  /**
   * 🔴 X6.12 — las subindustrias que la búsqueda PIDIÓ, transportadas desde los
   * criterios originales.
   *
   * Es un dato de ACEPTACIÓN, no de petición: NO entra en ninguna llamada al
   * proveedor, no altera el plan de ramas y no cambia ni una página de gasto.
   * Existe porque hasta este corte se perdía en el transporte —el puente del
   * wizard manda `subIndustryId: null` de forma fija— y sin él la condición
   * `subindustry_match` se resolvía contra una ausencia fabricada en vez de
   * contra lo que la persona pidió.
   *
   * Vacío/ausente ⇒ no se pidió ninguna, y la condición NO aplica.
   */
  requestedSubindustries?: readonly (string | null | undefined)[] | null;
  /** Sólo telemetría: cuánto reservó el llamador, para que el lote lo registre. */
  creditsReserved?: number | null;
  /**
   * ADDENDUM PROVIDER-SEEN § 4 — memoria de lo que este proveedor ya nos mostró.
   *
   * Ausente ⇒ memoria vacía y escritura no-op: 0 aciertos, 0 identidades nuevas y
   * comportamiento byte a byte el de antes de este PR. Ninguna de las dos piezas
   * decide nada: la memoria sólo CUENTA y la escritura sólo RECUERDA. El dedupe
   * local sigue siendo la autoridad (§ 6).
   */
  providerSeen?: {
    memory?: ProviderSeenMemory;
    record?: (input: ProviderSeenWriteInput) => Promise<ProviderSeenWriteResult>;
    /** Reloj inyectable. Sin él, las pruebas no serían deterministas. */
    now?: () => string;
    /** Correlación de la corrida. Sin PII. */
    correlationId?: string | null;
  } | null;
  /** ADDENDUM PROVIDER-SEEN § 10 — resultado de la carga de memoria previa. */
  providerSeenLoad?: ProviderSeenLoadSummary;
  /** ADDENDUM PROVIDER-SEEN § 10 — el plan de exclusión con el que se pidió. */
  providerExclusionPlan?: ProviderExclusionPlan;
  /** ADDENDUM PROVIDER-SEEN § 10 — lo que la fuente gratuita rindió. */
  freeSource?: PrePaidFreeSourceOutcome;
  /**
   * AGENT1-LOCAL-CUT9 §§ 6, 7 — la SIEMBRA del registro de identidad de LOTE, con
   * las filas que la capa gratuita ya escribió en el lote canónico de ESTA
   * ejecución.
   *
   * ── 🔴 El defecto que cierra ───────────────────────────────────────────────
   *
   * CUT9A dejó esta limitación DECLARADA: la admisión por identidad de lote se
   * sembraba VACÍA (`createBatchIdentityRegistry(null)`), y eso era un hecho
   * estructural mientras el lote sólo podía nacer en esta misma llamada. Con
   * adopción dejó de serlo: la mitad gratuita puede haber escrito ya en él, y con
   * el hueco parcial ACTIVADO (CUT-9 § 1) esa es la ruta NORMAL, no un borde.
   *
   * Sin siembra, una empresa que lo gratuito ya cerró podía volver por la ruta de
   * pago y cerrar hueco por SEGUNDA vez: objetivo 10, 4 gratis, 6 de pago de las
   * cuales 2 son las mismas ⇒ 4 + 6 = 10 y `targetReached` sobre 8 empresas
   * distintas. Esa es la aritmética que CUT-9 § 6 prohíbe.
   *
   * ── 🔴 Autoridad REUTILIZADA, nunca un emparejamiento nuevo ────────────────
   *
   * La siembra la produce `loadBatchIdentityRegistry` →
   * `read_batch_identity_snapshot` (CUT-3B4), que es la MISMA que ya usan los
   * otros dos escritores de Agente 1, y decide por TIERS de identidad —fiscal,
   * dominio, LinkedIn, id nativo de proveedor— con el nombre como evidencia DÉBIL
   * que jamás suprime (TIER 5 sólo produce `possible_duplicate`). CUT-9 no acuña
   * matching por nombre, por `displayName`, por substring ni por «última fila».
   *
   * ── 🔴 Qué NO sustituye ────────────────────────────────────────────────────
   *
   *   · `lusha-run-identity-registry` — dedupea la CORRIDA del proveedor (todas
   *     las páginas de todas las ramas) ANTES de pagar. Sigue viva.
   *   · `checkCompanyDuplicate` + el prefetch de candidatos activos — paridad
   *     CRUZADA contra SellUp/HubSpot. Siguen vivas, y siguen fallando ABIERTO.
   *
   * Esta siembra es la TERCERA pregunta: «¿esta empresa ya ocupa ESTE lote?».
   *
   * Ausente o `null` ⇒ registro vacío, que es EXACTAMENTE el comportamiento
   * anterior a CUT-9 y la verdad literal cuando la capa gratuita no escribió nada
   * (no hay lote del que sembrar). La cobertura degrada ABIERTO —igual que la
   * lectura de la que sale— porque una consulta caída no puede convertirse en
   * «esta empresa ya existía».
   */
  batchIdentitySeed?: {
    registry: BatchIdentityRegistry;
    /** Filas realmente sembradas. Sólo telemetría. */
    seededCount: number;
    /** `true` ⇒ la lectura degradó y la cobertura es MENOR, nunca mayor. */
    degraded: boolean;
  } | null;
}

/** Sum credits fail-safe: null stays null unless a page reported a number. */
function addCredits(total: number | null, page: number | null): number | null {
  if (typeof page !== 'number') return total;
  return (total ?? 0) + page;
}

/** Rama descrita para la telemetría. `null` = rama legacy (industria del sector). */
function describeBranchIds(branch: LushaExecutionBranch): {
  mainIndustryId: number | null;
  subIndustryId: number | null;
} {
  if (branch === null) return { mainIndustryId: null, subIndustryId: null };
  return {
    mainIndustryId: branch.mainIndustryId,
    subIndustryId: branch.subIndustryId ?? null,
  };
}

/**
 * Ejecuta el plan Lusha de la corrida —una o varias RAMAS, en orden de catálogo—,
 * corre la paridad de duplicados ANTES de cualquier escritura, y persiste UN lote
 * pending-review con sus candidatos ÚTILES a través de las deps inyectadas.
 *
 * ── UN objetivo, UNA reserva, UN registro de identidad (§§ 4, 8, 10) ──────────
 *
 * `targetGap` es global: si la rama 0 deja 3 útiles, la rama 1 busca 2, no 5. En
 * cuanto el objetivo se cierra la corrida PARA, y las ramas restantes no se piden
 * —ni por representación taxonómica ni por diversidad—. La identidad se recuerda
 * en un único registro de corrida, así que una empresa que vuelve en dos ramas no
 * cuenta dos veces, no se enriquece dos veces y no se persiste dos veces.
 *
 * ── Dónde exactamente incrementa el conteo ÚTIL (§ 12) ────────────────────────
 *
 * Nunca con la fila cruda del proveedor. Una empresa cuenta al cerrar el hueco
 * sólo después de:
 *
 *   1. dedupe por identidad contra TODA la corrida,
 *   2. el gate obligatorio compartido (`evaluateProspectIntakeGate`),
 *   3. enriquecimiento de fuente oficial + identidad fiscal,
 *   4. el guard de candidatos activos,
 *   5. la comprobación de duplicados SellUp + HubSpot,
 *
 * y sólo si su `duplicate_status` resuelto es `no_match` o `possible_duplicate`.
 * Por eso «el proveedor devolvió 5 filas» NUNCA cierra el objetivo: pararse ahí
 * dejaría la corrida sin candidatos revisables creyendo que cumplió.
 *
 * ── Techos (§§ 6, 16, 17) ─────────────────────────────────────────────────────
 *
 *   - Peticiones: ramas × `LUSHA_PENDING_REVIEW_MAX_PAGES`, contadas de forma
 *     explícita en ámbito de CORRIDA (1 rama → 2 · 2 → 4 · 3 → 6). Ninguna
 *     petición se intenta por encima de ese número.
 *   - Página siguiente de una rama: sólo si la anterior salió bien, devolvió al
 *     menos una fila, queda hueco y queda techo. NO se piden 2 páginas por rama
 *     automáticamente.
 *   - Filas crudas: tope de corrida (`LUSHA_RUN_MAX_RAW_RESULTS`).
 *   - Sin reintentos ciegos; la página nunca la elige el cliente.
 *
 * ── Semántica de fallo (§§ 14, 15) ────────────────────────────────────────────
 *
 *   - Primera petición fallida, sin nada útil → error duro, CERO escrituras.
 *     (idéntico al comportamiento de hoy para la ruta de una sola rama).
 *   - Fallo posterior                        → la corrida PARA y lo ya encontrado
 *                                              se conserva y se persiste. Ni
 *                                              tormenta de reintentos ni gasto
 *                                              extra para compensar el error.
 *   - Rama con 0 resultados                  → NO es un fallo: el hueco sigue
 *                                              abierto y se pasa a la siguiente.
 *   - Nada útil                              → status 'empty', sin escrituras.
 *   - Éxito                                  → exactamente un lote, luego N filas.
 */
export async function persistLushaPendingReviewBatch(
  deps: PersistLushaPendingReviewDeps,
  input: LushaPreviewInput,
  actor: PersistLushaPendingReviewActor,
  routing?: LushaProviderRoutingObservation,
  execution?: LushaMultiBranchExecution,
): Promise<PersistLushaPendingReviewResult> {
  // ── Política de la corrida, resuelta ANTES de la primera petición ──
  const plan = execution?.plan ?? null;
  const branches = resolveLushaExecutionBranches(plan);
  const targetGap = resolveLushaTargetGap(execution?.targetGap);
  /**
   * 🔴 AGENT1-LUSHA-TARGET-ACCEPTANCE-X5.1 — el crédito de COMPRA acumulado.
   *
   * Es el RENDIMIENTO de lo que ya se pagó: cuántas empresas útiles trajo. Es lo
   * único que cierra el hueco de compra, y es deliberadamente igual a la cuenta
   * de supervivientes: una página que trajo cuarenta empresas rindió, sepamos o
   * no si están completas.
   *
   * Existe como función con nombre, y no como `useful.length` suelto en cuatro
   * sitios, para que la auditoría de «¿quién decide comprar otra página?» tenga
   * UNA respuesta legible. `acceptedForTarget` y `completeValidCandidates` NO
   * pueden aparecer en ninguna de esas cuatro llamadas, y eso es exactamente lo
   * que los trinquetes M9/M10 comprueban.
   */
  const purchaseCreditSoFar = (): number => useful.length;
  // § 5 — la macro contra la que se juzga la precisión. `null` = ruta legacy de un
  // sector, donde no hay macro industria y el comportamiento es el de hoy.
  const macroKeyForPrecision = plan?.macroKey ?? null;
  const providerRequestsAllowed = resolveLushaProviderRequestsAllowed(branches.length);
  // CUT-L5 § 16 — ramas × (páginas × créditos por petición). El factor por
  // petición sale del contrato de bloques y del tamaño de página pagado, no de una
  // constante «1 por petición»: con 25 vale 1 y la reserva NO se mueve; con 50
  // valdría 2 y la reserva subiría sola, en el mismo commit.
  const expectedMaxCredits = branches.length * resolveLushaRunMaxProviderCredits();

  // § 10/§ 11 — UN registro de identidad para todas las páginas de todas las ramas.
  //
  // 🔴 AGENT1-LUSHA-CUT-L1-CLIENT-SIDE-EXCLUSION §§ 3, 4, 5 — y sembrado con los
  // dominios que SellUp YA conoce, porque Lusha V3 no tiene exclusión del lado del
  // servidor y ésta es la única capa que queda para no volver a contar como
  // net-new una empresa que ya teníamos.
  //
  // 🔴 La siembra NO sale de `sent`: está vacío por capacidad —el contrato HUMANO
  // la apagó— y sembrar de ahí habría tirado la evidencia entera justo al retirar
  // la exclusión de la petición.
  //
  // 🔴 AGENT1-LUSHA-PROVIDER-SEEN-DEDUPE-FIX §§ 2, 3 — y TAMPOCO sale de
  // `availableValues`. Sale de `dedupeAuthorityValues`, que es lo mismo menos lo
  // que sólo aporta `provider_seen`.
  //
  // El defecto que esto cierra, medido en Producción (CO / technology, fingerprint
  // `7aa292ef…`): la primera corrida persistió 5 candidatos y dejó sus 25 dominios
  // en la memoria provider-seen. Las dos siguientes volvieron a pedir la MISMA
  // página —Lusha V3 no excluye del lado del servidor—, la cobraron, y sembraron
  // esos 25 dominios aquí. Las 25 filas cayeron con `known_domain_seed`, `useful`
  // quedó vacío y la corrida salió por `status: 'empty'`: sin lote, sin candidatos
  // y con el crédito cobrado.
  //
  // «Ya pagamos por verla» NO es «ya es nuestra». Entre esas 25 había empresas
  // descartadas por sobrante de objetivo y por precisión: nadie las posee y son
  // candidatas legítimas. Quien SÍ prueba propiedad —cuentas de SellUp, HubSpot,
  // lo que la capa gratuita aceptó, lo que otra rama de esta corrida ya entregó—
  // sigue sembrando igual, y el dedupe canónico posterior (HubSpot + cuentas +
  // guarda de candidato activo) no se toca en absoluto.
  //
  // 🔴 Sólo dominios: el id de Lusha NO se siembra (CUT-L1 § 6 lo mantiene como
  // evidencia independiente y no como clave histórica), y el nombre tampoco.
  //
  // Ausente ⇒ registro vacío, byte por byte el comportamiento anterior.
  const localKnownSeed = execution?.providerExclusionPlan?.domains.dedupeAuthorityValues ?? [];
  let identityRegistry: LushaRunIdentityRegistry = seedLushaKnownDomains(
    createLushaRunIdentityRegistry(),
    localKnownSeed,
  );
  let localKnownSuppressedTotal = 0;
  const useful: ResolvedLushaCandidate[] = [];
  // Q3F-5BB.11D — observational counters for the provider attempt metadata.
  // `rawResultsTotal` = raw provider rows across every branch/page (pre dedupe);
  // `normalizedCount` = unique companies that entered the gate/dedupe pipeline.
  let rawResultsTotal = 0;
  let normalizedCount = 0;
  // Auditable detail of every excluded exact duplicate (Q3F-5BB.7D). Its length
  // is the authoritative excluded count surfaced everywhere below.
  const excludedExactDuplicates: LushaExcludedExactDuplicate[] = [];
  // Q3F-5BB.10C2 — shared intake pipeline accumulators (across branches/pages).
  const excludedByMandatoryGate: LushaGateAuditEntry[] = [];
  // AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — OBSERVADOR. Ver
  // `buildLushaDiscardRecord`: no decide, no cuenta y no altera ningún
  // desenlace. Se llena en el punto donde la lógica ya descartó la empresa.
  const discardRecords: LushaDiscardedCompanyRecord[] = [];
  const gateSummary = emptyGateSummary();
  const enrichmentSummary = emptyEnrichmentSummary();
  let skippedActiveDuplicatesCount = 0;
  let skippedUnusableCount = 0;
  let crossBranchDuplicatesRemoved = 0;
  // §§ 2/3 — los tres desenlaces NUEVOS de una empresa revisable, contados aparte
  // de todo lo de dedupe: precisión, sobrante de objetivo y aceptación.
  let precisionRejectedTotal = 0;
  /**
   * 🔴 X6.14 — cuántas rechazó el gate de CALIDAD, contadas aparte.
   *
   * No son duplicados, no son país y no son precisión: mezclarlas con
   * cualquiera de esas tres falsearía una métrica que ya existe y que la
   * certificación lee.
   */
  let qualityRejectedTotal = 0;
  /**
   * 🔴 AGENT1-LUSHA-TARGET-ACCEPTANCE-X5.1 — estructuralmente CERO desde este
   * corte, y se conserva a propósito.
   *
   * Ya no existe ningún sitio que lo incremente: el tope de aceptación que lo
   * alimentaba descartaba supervivientes de una página ya pagada por haber
   * llegado después del objetivo, y eso es justo lo que se elimina.
   *
   * No se retira el campo porque sus consumidores ya escritos —telemetría de
   * rama, fila de uso, certificación— lo leen, y un cero aquí es un cero REAL:
   * cero empresas descartadas por sobrante de objetivo. Retirarlo obligaría a
   * tocar superficies que este corte tiene prohibidas.
   *
   * Sigue sumándose en `novelUsefulFromPage` (abajo) sin cambiar nada: ahí era
   * el término que devolvía a la cuenta de rendimiento lo que el tope había
   * quitado, y con el tope fuera ese término vale cero por construcción.
   */
  // 🔴 `const`, no `let`: al retirarse el tope de aceptación ya no queda un solo
  // sitio que lo incremente, y declararlo constante hace que reintroducir un
  // incremento NO COMPILE. Es el trinquete más barato posible contra M8.
  const targetOverflowDiscarded = 0;
  let reviewableFoundTotal = 0;
  const precisionReasonCounts: Record<string, number> = {};
  const duplicateReasonCounts: Record<LushaIdentityDuplicateReason, number> = {
    provider_company_id: 0,
    normalized_domain: 0,
    normalized_linkedin_url: 0,
    normalized_name_fallback: 0,
    // 🔴 CUT-L1 §§ 4, 5 — conocido de ANTES de la corrida, no repetido por el
    // proveedor. Se cuenta aparte por eso.
    known_domain_seed: 0,
  };
  let creditsChargedTotal: number | null = null;
  let resultsReturnedTotal: number | null = null;
  // ── CUT-L5 §§ 7, 8 — las TRES cifras, separadas a propósito ────────────────
  //
  // `creditsChargedTotal` es lo REAL. Estos dos son lo ESPERADO por el contrato de
  // bloques, y existen para poder decir «el proveedor cobró distinto de lo que su
  // propio contrato dice» sin tocar ni un dígito de lo real.
  let expectedCreditsTotal: number | null = null;
  let billingContractMismatchPages = 0;
  let firstBillingContrast: LushaProspectingBillingContrast | null = null;
  let billingAnomalyContrast: LushaProspectingBillingContrast | null = null;
  let providerRequestsUsed = 0;
  let firstSearch: LushaPreviewResult | null = null;
  const branchTelemetry: LushaBranchTelemetry[] = [];
  let stopReason: LushaRunStopReason = 'branches_exhausted';
  let runStopped = false;
  // § 17/§ 20 — páginas que NO se compraron porque su rama vino sin novedad.
  // Hecho observado; nunca un ahorro estimado.
  // 🔴 AGENT1-LUSHA-PAGE-NOVELTY-POLICY-1 — se llamaba `pagesSkippedZeroNovelty`
  // cuando la cero-novedad era el motivo dominante. Ya no lo es: las únicas
  // paradas de rama son página vacía y agotamiento declarado, así que el nombre
  // pasa a decir lo que cuenta —páginas no pedidas porque la RAMA paró— en vez
  // de un motivo que la política retiró.
  let pagesSkippedBranchStopped = 0;
  // ── ADDENDUM PROVIDER-SEEN § 10 — conteos de la memoria ──
  const providerSeenMemory: ProviderSeenMemory =
    execution?.providerSeen?.memory ?? EMPTY_PROVIDER_SEEN_MEMORY;
  const recordProviderSeen = execution?.providerSeen?.record ?? null;
  const providerSeenNow = execution?.providerSeen?.now ?? (() => new Date().toISOString());
  const providerSeenCorrelationId = execution?.providerSeen?.correlationId ?? null;
  let providerSeenHitsTotal = 0;
  let providerSeenNovelTotal = 0;
  let providerSeenNewIdsTotal = 0;
  let providerSeenNewDomainsTotal = 0;
  let providerSeenWriteFailures = 0;
  let providerSeenLastWriteSkippedReason: string | null = null;
  const providerSeenPageYields: ProviderSeenPageYield[] = [];
  // AGENT1-LUSHA-REQUEST-OBSERVABILITY-1 — lo pedido y lo devuelto, por página.
  const pageRequestObservations: LushaPageRequestObservation[] = [];
  const providerSeenBranchStopReasons: Record<number, string> = {};
  let hardFailure: PersistLushaPendingReviewResult | null = null;

  const pushBranchTelemetry = (
    branchIndex: number,
    branch: LushaExecutionBranch,
    outcome: LushaBranchOutcome,
    metrics: {
      pagesAttempted: number;
      providerRequests: number;
      rawResults: number;
      duplicatesRemoved: number;
      uniqueResults: number;
      usefulResults: number;
      remainingGapBefore: number;
      remainingGapAfter: number;
      providerCreditsReported: number | null;
      precisionRejected: number;
      targetOverflowDiscarded: number;
    },
  ): void => {
    branchTelemetry.push({
      branchIndex,
      ...describeBranchIds(branch),
      ...metrics,
      outcome,
    });
  };

  for (let branchIndex = 0; branchIndex < branches.length; branchIndex++) {
    const branch = branches[branchIndex] as LushaExecutionBranch;
    const remainingGapBefore = resolveLushaRemainingGap(targetGap, purchaseCreditSoFar());

    // 🔴 X6.13 — la rama restante ya NO se salta por objetivo cerrado.
    //
    // § 4 decía: «objetivo cerrado ⇒ las ramas restantes NO se piden». Con el
    // objetivo entendido como MÍNIMO, una rama con páginas y reserva
    // disponibles debe pedirse: sus empresas son tan válidas como las de la
    // primera. La condición se queda SÓLO con `runStopped`, que es lo que
    // recoge las paradas reales —techo de peticiones, filas crudas, fallo del
    // proveedor, cancelación—.
    if (runStopped) {
      pushBranchTelemetry(branchIndex, branch, 'not_attempted', {
        pagesAttempted: 0,
        providerRequests: 0,
        rawResults: 0,
        duplicatesRemoved: 0,
        uniqueResults: 0,
        usefulResults: 0,
        remainingGapBefore,
        remainingGapAfter: remainingGapBefore,
        providerCreditsReported: null,
        precisionRejected: 0,
        targetOverflowDiscarded: 0,
      });
      continue;
    }

    const usefulBeforeBranch = useful.length;
    let branchPagesAttempted = 0;
    let branchProviderRequests = 0;
    let branchRawResults = 0;
    let branchDuplicatesRemoved = 0;
    let branchUniqueResults = 0;
    let branchCredits: number | null = null;
    let branchOutcome: LushaBranchOutcome = 'completed';
    let branchPrecisionRejected = 0;
    // 🔴 Igual que el acumulador de corrida: constante por construcción.
    const branchTargetOverflow = 0;

    for (let page = 0; page < LUSHA_PENDING_REVIEW_MAX_PAGES; page++) {
      // § 6/§ 16/§ 17 — la decisión de pedir es explícita y de ámbito de corrida.
      // No se delega a la cota de los bucles: ver la cabecera del módulo de
      // política.
      const decision = decideLushaProviderRequest({
        remainingGap: resolveLushaRemainingGap(targetGap, purchaseCreditSoFar()),
        providerRequestsUsed,
        providerRequestsAllowed,
        rawResultsTotal,
      });
      if (!decision.allowed) {
        stopReason = decision.stopReason;
        runStopped = true;
        // 🔴 X6.13 — aquí se traducía un `target_reached` de la decisión de
        // compra al desenlace de la rama. `decideLushaProviderRequest` ya no
        // puede devolverlo: el objetivo dejó de detener la compra, así que la
        // rama sólo puede pararse por techo de peticiones, filas crudas o
        // proveedor. `target_reached` sobrevive como desenlace POST-corrida
        // (más abajo), que es una afirmación sobre el resultado, no una parada.
        break;
      }

      const search = await deps.runSearch(
        {
          ...input,
          page,
          // 🔴 AGENT1-LUSHA-CUT-L5 §§ 3, 13 — LA AUTORIDAD DE TAMAÑO DE PÁGINA DE
          // LA RUTA PAGADA, y el único sitio del producto que la fija.
          //
          // 25 = exactamente UN bloque de facturación. Con 25 el proveedor no
          // puede devolver 26–50 y cobrar 2 créditos de golpe; SellUp inspecciona
          // el bloque, deduplica contra lo que ya conoce y sólo compra el
          // siguiente si queda hueco. Con 50 se pagarían los dos bloques antes de
          // saber si el primero ya cerraba el objetivo.
          //
          // Se fija AQUÍ y no en el llamador: `input` viene de la server action y
          // el navegador no puede elegir cuánto cuesta una página.
          pageSize: LUSHA_PROSPECTING_PAGE_SIZE,
          // Rama legacy ⇒ no se manda `industryBranch` y el preview deriva la
          // industria del sector, exactamente como hoy.
          ...(branch !== null
            ? {
                industryBranch: {
                  mainIndustryId: branch.mainIndustryId,
                  subIndustryId: branch.subIndustryId ?? null,
                },
              }
            : {}),
        },
        // 🔴 AGENT1-LUSHA-CUT-L3 § 5 — las coordenadas de la petición LÓGICA.
        // `branchIndex` y `page` juntos son lo que impide que la valla durable
        // confunda la página 1 con la 0, o la rama 2 con la 1.
        { branchIndex, page },
      );
      providerRequestsUsed++;
      branchProviderRequests++;
      branchPagesAttempted++;
      if (firstSearch === null) firstSearch = search;
      // AGENT1-LUSHA-REQUEST-OBSERVABILITY-1 — se registra TODA petición
      // despachada, también la que falló o vino vacía: una página pagada y vacía
      // es justo la que más necesita explicarse. Sólo observa; no decide nada.
      pageRequestObservations.push(observeLushaPageRequest({ branchIndex, page, search }));

      const pageCredits = search.billing?.creditsCharged ?? null;
      creditsChargedTotal = addCredits(creditsChargedTotal, pageCredits);
      branchCredits = addCredits(branchCredits, pageCredits);
      if (typeof search.billing?.resultsReturned === 'number') {
        resultsReturnedTotal = (resultsReturnedTotal ?? 0) + search.billing.resultsReturned;
      }

      // ── CUT-L5 §§ 7, 8, 9, 23 — CONTRASTE, no corrección ────────────────────
      //
      // Se calcula para TODA petición despachada, incluida la que falló: un `429`
      // sin importe produce `matchesContract: null` y no dispara nada, que es
      // exactamente lo que debe pasar (§ 11 — un intento fallido NO hereda el
      // mínimo de un crédito).
      //
      // 🔴 `pageCredits` entra tal cual y sale tal cual. Si Lusha dice 2 donde el
      // contrato tasa 1, el 2 es lo que se suma y lo que se reporta; lo que este
      // bloque produce es la ETIQUETA de que no cuadra. Recortar el real a la
      // reserva sería mentir sobre dinero ya gastado.
      const billingContrast = evaluateLushaProspectingBillingContrast({
        requestedPageSize: LUSHA_PROSPECTING_PAGE_SIZE,
        resultsReturned: search.billing?.resultsReturned ?? null,
        creditsCharged: pageCredits,
      });
      if (firstBillingContrast === null) firstBillingContrast = billingContrast;
      if (billingContrast.expectedCredits !== null) {
        expectedCreditsTotal = (expectedCreditsTotal ?? 0) + billingContrast.expectedCredits;
      }
      if (billingContrast.matchesContract === false) billingContractMismatchPages++;
      const billingAnomaly = shouldStopPaidPaginationOnBillingContrast(billingContrast);
      if (billingAnomaly && billingAnomalyContrast === null) {
        billingAnomalyContrast = billingContrast;
      }

      if (!search.ok) {
        branchOutcome = 'provider_failure';
        stopReason = 'provider_failure';
        runStopped = true;
        if (providerRequestsUsed === 1 && useful.length === 0) {
          // Primera petición de la corrida sin nada útil → error duro, sin
          // escrituras. Es el comportamiento de hoy para «page 0 falló».
          hardFailure = buildLushaPendingReviewFailure(
            'No fue posible completar la búsqueda con el proveedor.',
            sanitizeError(search.error),
            {
              creditsCharged: pageCredits,
              resultsReturned: search.billing?.resultsReturned ?? null,
              creditsChargedTotal,
              pagesRequested: providerRequestsUsed,
            },
          );
        }
        // Fallo posterior → se conserva lo ya encontrado (fail-safe documentado).
        break;
      }

      // Observational: raw provider rows for this successful page, BEFORE dedupe.
      const pageRaw = (search.results ?? []).length;
      rawResultsTotal += pageRaw;
      branchRawResults += pageRaw;

      // ── ADDENDUM PROVIDER-SEEN § 4 — el momento, y sólo éste ────────────────
      //
      // Estamos DESPUÉS de `search.ok` y ANTES del dedupe. Ese orden es el hito
      // entero: si la memoria se escribiera después de filtrar, heredaría los
      // criterios del filtro y volvería a olvidar justo lo que hay que recordar
      // —lo rechazado, lo duplicado, lo sobrante— que es el defecto de hoy.
      //
      // 🔴 La validez se toma de `search.ok`, jamás de `results.length`. Una lista
      // vacía puede ser una respuesta legítima sin empresas; un error NO es «cero
      // empresas», es ninguna información. Confundirlos ya quemó a este repo en la
      // ruta de teléfono (#303), donde Lusha devuelve `ok:true` con `phones:[]`
      // para cualquier error HTTP.
      const seenPlan = planProviderSeenRecording({
        provider: 'lusha',
        providerCallMade: true,
        responseValid: true,
        results: (search.results ?? []).map((company) => ({
          providerEntityId: company.providerCompanyId,
          domain: company.domain,
        })),
      });
      let pageProviderSeenHits = 0;
      if (seenPlan.record) {
        pageProviderSeenHits = countProviderSeenHits(providerSeenMemory, seenPlan.observations);
        providerSeenHitsTotal += pageProviderSeenHits;
        providerSeenNovelTotal += seenPlan.observations.length - pageProviderSeenHits;
        if (recordProviderSeen) {
          try {
            const written = await recordProviderSeen({
              observations: seenPlan.observations,
              correlationId: providerSeenCorrelationId,
              observedAt: providerSeenNow(),
            });
            providerSeenNewIdsTotal += written.newIdsRecorded;
            providerSeenNewDomainsTotal += written.newDomainsRecorded;
            // 🔴 `written === false` con un motivo NO es un no-evento: significa que
            // esta página, ya pagada, no quedó recordada y la próxima corrida la
            // volverá a pagar. Se cuenta para que el 0 de arriba se pueda leer.
            //
            // 🔴 «Sin observaciones» NO cuenta: es una respuesta válida sin nada
            // identificable, no una escritura perdida. Contarla convertiría el
            // indicador en ruido justo cuando más falta hace que se lea.
            if (
              !written.written &&
              written.skippedReason !== null &&
              written.skippedReason !== 'no_observations'
            ) {
              providerSeenWriteFailures++;
              providerSeenLastWriteSkippedReason = written.skippedReason;
            }
          } catch {
            // 🔴 Fail-open hacia el producto, pero NO en silencio hacia el operador:
            // la página YA está pagada y sus empresas ya están en la mano, así que un
            // fallo de memoria no puede tirar la corrida —eso convertiría una mejora
            // económica en una forma nueva de perder lo que se acaba de comprar—,
            // pero sí queda contado.
            providerSeenWriteFailures++;
            providerSeenLastWriteSkippedReason = 'record_threw';
          }
        }
      }

      const dedupe = dedupeLushaCompaniesByIdentity(search.results ?? [], identityRegistry);
      identityRegistry = dedupe.registry;
      skippedUnusableCount += dedupe.unusableCount;
      // 🔴 CUT-L1 § 4 — los dos desenlaces se suman por SEPARADO, y la resta no es
      // un ajuste cosmético: `crossBranchDuplicatesRemoved` afirma «el proveedor
      // devolvió esto dos veces en esta corrida», y un conocido histórico no lo
      // hizo. Nada se pierde: la suma de los dos sigue siendo `duplicateCount`, y
      // los dos entran en `skippedCount` más abajo.
      const runDuplicatesRemoved = dedupe.duplicateCount - dedupe.knownSeedRejectedCount;
      localKnownSuppressedTotal += dedupe.knownSeedRejectedCount;
      crossBranchDuplicatesRemoved += runDuplicatesRemoved;
      branchDuplicatesRemoved += runDuplicatesRemoved;
      for (const reason of Object.keys(duplicateReasonCounts) as LushaIdentityDuplicateReason[]) {
        duplicateReasonCounts[reason] += dedupe.duplicateReasonCounts[reason];
      }
      normalizedCount += dedupe.unique.length;
      branchUniqueResults += dedupe.unique.length;

      // Provider-neutral criteria for the shared gate + enrichment. Built from the
      // (server-authoritative) request summary; stable across pages.
      const criteria = buildLushaProspectSearchCriteria(input, search);

      const {
        resolved,
        guardSkippedCount,
        hardExcluded,
        gate,
        enrichment,
        hardExcludedCompanies,
        guardSkipped,
        countryExcluded,
        precisionRejected,
        precisionReasonCounts: pagePrecisionReasonCounts,
        qualityRejected,
      } = await resolveLushaCandidatesDuplicateState(
        deps,
        input,
        dedupe.unique,
        criteria,
        // 🔴 X6.14 — la precisión baja a la tubería para poder decidir ANTES del
        // catálogo. Sin macro no hay plan y `null` reproduce la ruta legacy.
        macroKeyForPrecision === null
          ? null
          : { macroIndustryKey: macroKeyForPrecision, branch, branchIndex },
      );
      skippedActiveDuplicatesCount += guardSkippedCount;

      // ── 🔴 AGENT1-HARDENING-CUT-4 — la SIEMBRA de conocidos deja fila ──────
      //
      // Una empresa retirada por `known_domain_seed` cae en el dedupe, que corre
      // ANTES de los dos puntos que generan disposiciones (gate duro y guard de
      // candidato activo). Hasta este corte su única huella era un contador:
      // `localKnownSuppressedTotal`. El motivo del descarte moría con la corrida,
      // aunque la taxonomía durable ya supiera traducirlo.
      //
      // 🔴 La decisión NO se toca: la empresa ya estaba retirada y sigue estándolo,
      // con el mismo contador y el mismo `unique`. Lo único que cambia es que ahora
      // queda escrito POR QUÉ.
      //
      // 🔴 La escritura es `ON CONFLICT DO NOTHING` sobre `(batch_id, source_key)`:
      // una segunda corrida no duplica, y un veredicto que Apollo ya escribió para
      // esa empresa en el MISMO lote sobrevive intacto — Lusha no lo pisa.
      for (const rejected of dedupe.knownSeedRejected) {
        const record = buildLushaDiscardRecord({
          company: rejected.company,
          event: { kind: 'known_domain_seed' },
          branchIndex,
          page,
          reasonDetail: rejected.matchedNormalizedDomain,
          evidence: {
            known_seed_matched_domain: rejected.matchedNormalizedDomain,
            suppression_stage: 'run_identity_dedupe',
          },
        });
        if (record !== null) discardRecords.push(record);
      }

      // ── OBSERVADOR §§ 1, 2 — las dos decisiones que el resolutor acaba de
      //    tomar, con su identidad. No es una segunda pasada por las empresas:
      //    son las salidas de la decisión, no el conjunto de entrada.
      for (const excluded of hardExcludedCompanies) {
        const record = buildLushaDiscardRecord({
          company: excluded.company,
          event: {
            kind: 'gate_hard_excluded',
            gateReason: excluded.gateResult.hardReasons[0] ?? null,
          },
          branchIndex,
          page,
          reasonDetail: excluded.gateResult.hardReasons.join(', ') || null,
          evidence: {
            gate_decision: excluded.gateResult.decision,
            gate_hard_reasons: [...excluded.gateResult.hardReasons],
            gate_warnings: [...excluded.gateResult.warnings],
          },
        });
        if (record !== null) discardRecords.push(record);
      }
      // ── 🔴 X6.4-A — los rechazos de PAÍS dejan fila ────────────────────────
      //
      // Con su disposición durable propia (`country_rejected`, ya existente) y el
      // motivo VERBATIM de la autoridad que decidió. Sin esto el descarte sería
      // invisible y reconstruirlo exigiría volver a pagarle a Lusha.
      for (const excluded of countryExcluded) {
        const { rejection } = excluded;
        const record = buildLushaDiscardRecord({
          company: excluded.company,
          event: { kind: 'country_incompatible', reason: rejection.reason },
          branchIndex,
          page,
          reasonDetail: rejection.reason,
          evidence: {
            x64_gate: rejection.kind,
            evaluated_url: rejection.evaluatedUrl,
            requested_country_code: input.countryCode ?? null,
          },
        });
        if (record !== null) discardRecords.push(record);
      }

      for (const skipped of guardSkipped) {
        const record = buildLushaDiscardRecord({
          company: skipped.company,
          event: { kind: 'active_candidate_guard' },
          branchIndex,
          page,
          reasonDetail: skipped.guardMatch.reason ?? null,
          evidence: {
            active_guard_reason: skipped.guardMatch.reason ?? null,
            active_guard_matched_candidate_id: skipped.guardMatch.matchedCandidateId,
            active_guard_matched_domain: skipped.guardMatch.matchedDomain,
          },
        });
        if (record !== null) discardRecords.push(record);
      }

      // ── 🔴 X6.14 — PRECISIÓN MACRO, ahora decidida antes del catálogo ──────
      //
      // La fila durable es la MISMA que antes (`macro_precision_rejected` ⇒
      // `sector_rejected`), con la misma evidencia. Lo único que cambia es que
      // la decisión se toma antes, así que estas empresas ya no consultan el
      // catálogo ni el chequeo de duplicados.
      for (const [reason, count] of Object.entries(pagePrecisionReasonCounts)) {
        precisionReasonCounts[reason] = (precisionReasonCounts[reason] ?? 0) + count;
      }
      for (const rejected of precisionRejected) {
        // NO cierra hueco, NO se persiste, y NO cuenta como duplicado.
        precisionRejectedTotal++;
        branchPrecisionRejected++;
        const record = buildLushaDiscardRecord({
          company: rejected.company,
          event: {
            kind: 'macro_precision_rejected',
            precisionReason: rejected.precision.reason,
          },
          branchIndex,
          page,
          reasonDetail: rejected.precision.reason,
          evidence: {
            macro_industry_key: macroKeyForPrecision,
            precision_reason: rejected.precision.reason,
            declared_industry: rejected.company.industry ?? null,
          },
        });
        if (record !== null) discardRecords.push(record);
      }

      // ── 🔴 X6.14 — CALIDAD: el desenlace NUEVO de este corte ───────────────
      //
      // Hasta aquí `quality_gate` se declaraba `pass` sin mirarlo, así que un
      // intermediario de contenido o una plataforma externa entraban a revisión
      // y contaban hacia el mínimo. Ahora se evalúa y, cuando bloquea, la
      // empresa no llega al catálogo y deja su motivo VERBATIM.
      for (const rejected of qualityRejected) {
        qualityRejectedTotal++;
        const record = buildLushaDiscardRecord({
          company: rejected.company,
          event: {
            kind: 'quality_gate_rejected',
            qualityCheck: rejected.quality.blockingCheck,
            qualityReason: rejected.quality.blockingReason,
          },
          branchIndex,
          page,
          reasonDetail: rejected.quality.blockingReason,
          evidence: {
            quality_blocking_check: rejected.quality.blockingCheck,
            quality_blocking_reason: rejected.quality.blockingReason,
            business_fit_level: rejected.quality.businessFitLevel,
            quality_checks: rejected.quality.checks.map((check) => ({
              check: check.check,
              state: check.state,
              detail: check.detail,
            })),
          },
        });
        if (record !== null) discardRecords.push(record);
      }

      // Merge the page's gate + enrichment summaries into the batch accumulators.
      excludedByMandatoryGate.push(...hardExcluded);
      gateSummary.hardExcludedCount += gate.hardExcludedCount;
      gateSummary.warningCount += gate.warningCount;
      gateSummary.cleanCount += gate.cleanCount;
      for (const [reason, count] of Object.entries(gate.reasonCounts)) {
        gateSummary.reasonCounts[reason] = (gateSummary.reasonCounts[reason] ?? 0) + count;
      }
      enrichmentSummary.matchedCount += enrichment.matchedCount;
      enrichmentSummary.lowConfidenceCount += enrichment.lowConfidenceCount;
      enrichmentSummary.notFoundCount += enrichment.notFoundCount;
      enrichmentSummary.unsupportedCount += enrichment.unsupportedCount;
      enrichmentSummary.errorCount += enrichment.errorCount;

      // ── Aceptación: duplicado exacto → precisión → tope de objetivo ──
      //
      // AGENT1-LUSHA-FIRST-LIVE-QA-P0-FIX-1 §§ 2, 3, 5, 7. El orden importa y los
      // tres desenlaces son DISTINTOS entre sí; mezclarlos fue lo que hizo
      // ilegible la corrida de producción:
      //
      //   · duplicado exacto  — ya existe en SellUp/HubSpot. Conteo de dedupe.
      //   · precisión         — existe y es nueva, pero el catálogo NO confirma
      //                         que pertenezca a la macro pedida. NO es duplicado.
      //   · sobrante          — nueva Y precisa, pero el objetivo ya está cerrado.
      //                         Tampoco es duplicado, y la página ya se pagó.
      const branchProvenance = describeLushaBranchProvenance(branch, branchIndex);
      // AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 § 17 — cuánto rindió ESTA
      // página. Se toma antes de repartir para poder decidir, al terminarla, si
      // vale la pena pagar la siguiente de la misma rama.
      const usefulBeforePage = useful.length;
      const overflowBeforePage = targetOverflowDiscarded;
      for (const candidate of resolved) {
        if (candidate.resolution.dbDuplicateStatus === 'exact_duplicate') {
          // Exact duplicates are excluded from persistence — never reviewable.
          // We keep a safe, auditable detail record (Q3F-5BB.7D).
          excludedExactDuplicates.push(buildLushaExcludedExactDuplicate(candidate));
          // ── OBSERVADOR § 3 — SellUp y HubSpot son disposiciones DISTINTAS, y
          //    la fuente la dicta la evidencia que la resolución ya produjo.
          const duplicateSource = classifyLushaExactDuplicateSource({
            sources: candidate.resolution.duplicateDetails?.sources ?? null,
            matchedAccountId: candidate.resolution.matchedAccountId,
            matchedHubspotCompanyId: candidate.resolution.matchedHubspotCompanyId,
          });
          const duplicateRecord = buildLushaDiscardRecord({
            company: candidate.company,
            event: { kind: 'exact_duplicate', duplicateSource },
            branchIndex,
            page,
            reasonDetail: candidate.resolution.duplicateDetails?.reviewerMessage ?? null,
            evidence: {
              duplicate_source: duplicateSource,
              db_duplicate_status: candidate.resolution.dbDuplicateStatus,
              account_duplicate_check: candidate.resolution.accountDuplicateCheck,
              hubspot_duplicate_check: candidate.resolution.hubSpotDuplicateCheck,
              matched_account_id: candidate.resolution.matchedAccountId,
              matched_hubspot_company_id: candidate.resolution.matchedHubspotCompanyId,
              duplicate_sources: candidate.resolution.duplicateDetails?.sources ?? null,
            },
          });
          if (duplicateRecord !== null) discardRecords.push(duplicateRecord);
          continue;
        }

        // 🔴 X6.14 — la PRECISIÓN ya decidió, arriba y antes del catálogo. Lo
        // que llega aquí es una empresa que la precisión admitió (o una de la
        // ruta legacy, que no la ejecuta), así que sólo queda aceptarla.
        //
        // 🔴 AGENT1-LUSHA-TARGET-ACCEPTANCE-X5.1 — aquí vivía el tope de
        // ACEPTACIÓN, y con él el defecto: sobre una página YA PAGADA, una
        // empresa que había superado todos los gates obligatorios se descartaba
        // como `target_overflow` por haber llegado la sexta.
        //
        // El objetivo del usuario no es un techo del universo. Ahora TODA
        // superviviente entra; cuántas CUENTAN lo decide el contrato canónico
        // después, y cuántas páginas se compran lo decide `purchaseCredit`
        // —abajo—, que es una pregunta distinta y tiene su propio nombre.
        reviewableFoundTotal++;
        // 🔴 La procedencia de rama se adjunta SÓLO en la ruta con macro, igual
        // que antes de este corte: en la ruta legacy no hay rama que describir y
        // añadírsela cambiaría la metadata de una corrida que no la tenía.
        useful.push(
          macroKeyForPrecision === null ? candidate : { ...candidate, branchProvenance },
        );
      }

      // ── § 16 + AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 17-19 ─────────
      //
      // La página ya está pagada. La pregunta es si la SIGUIENTE de esta rama
      // puede rendir algo distinto, y la única evidencia disponible para
      // responderla es lo que acaba de rendir ésta. En la corrida de producción
      // del 2026-08-19 las tres ramas compraron su página 2 después de que su
      // página 1 devolviera cero empresas útiles nuevas: tres peticiones pagadas
      // para releer un pozo que la anterior ya había demostrado seco.
      //
      // `novelUsefulFromPage` cuenta lo que sobrevivió a TODOS los filtros de
      // novedad —dedupe de corrida, guard de candidato activo, duplicado exacto y
      // precisión de macro— incluido lo que después descartó el tope de
      // aceptación de #306 por sobrepasar el objetivo. Esa inclusión no es un
      // detalle: una página que encontró cinco empresas buenas y sólo pudo
      // aceptar una porque el objetivo se cerró es el mejor resultado posible, y
      // contarla como «sin novedad» la calumniaría.
      //
      // 🔴 Cierra la RAMA, jamás la corrida (§ 19). Que `main 11 Healthcare` venga
      // seca no dice nada sobre `main 12 + sub 71 Pharmaceuticals Manufacturing`:
      // consultan universos distintos. Por eso no se toca `stopReason` ni
      // `runStopped` — igual que no lo hacía el `pageRaw === 0` que esta decisión
      // sustituye y absorbe (0 filas ⇒ 0 novedad, con su propio motivo).
      const novelUsefulFromPage =
        useful.length - usefulBeforePage + (targetOverflowDiscarded - overflowBeforePage);
      // 🔴 AGENT1-LUSHA-PAGE-NOVELTY-POLICY-1 — `novelUsefulFromPage` viaja, pero
      // ya no decide: una página no vacía con cero novedad LOCAL no cierra la
      // rama. `providerReportedExhaustion` NO se pasa a propósito: la única
      // candidata (`totalAvailable`) no está verificada en esta respuesta y el
      // contrato prohíbe inferir agotamiento de una señal ambigua.
      const continuation = decidePaidPageContinuation({
        rawFromPage: pageRaw,
        novelUsefulFromPage,
      });
      // ADDENDUM PROVIDER-SEEN § 10 — rendimiento de ESTA página, ya pagada.
      providerSeenPageYields.push({
        branchIndex,
        page,
        rawResults: pageRaw,
        providerSeenHits: pageProviderSeenHits,
        novelAfterProviderSeen: Math.max(0, pageRaw - pageProviderSeenHits),
        novelUsefulAfterLocalDedupe: novelUsefulFromPage,
      });

      if (!continuation.continueBranch) {
        providerSeenBranchStopReasons[branchIndex] = continuation.stopReason;
        const remainingPages = LUSHA_PENDING_REVIEW_MAX_PAGES - (page + 1);
        if (remainingPages > 0) pagesSkippedBranchStopped += remainingPages;
        break;
      }

      // ── CUT-L5 § 9 — la corrida deja de COMPRAR tras una anomalía ───────────
      //
      // 🔴 Aquí abajo y no arriba: esta página ya está pagada, sus empresas son
      // reales y descartarlas sería tirar lo que se acaba de comprar. Lo que la
      // anomalía prohíbe es el bloque SIGUIENTE —el de esta rama y el de todas las
      // que quedan, porque `runStopped` cierra el bucle de ramas—.
      //
      // 🔴 `provider_failure` y esto NO son lo mismo, y por eso hay un motivo de
      // parada propio: el proveedor respondió, la respuesta era buena, y lo que
      // falló fue el ACUERDO económico. Reportarlo como fallo de proveedor
      // escondería el único síntoma de que el contrato de bloques dejó de
      // describir la factura.
      if (billingAnomaly) {
        stopReason = 'provider_billing_anomaly';
        runStopped = true;
        branchOutcome = 'completed';
        break;
      }
    }

    const remainingGapAfter = resolveLushaRemainingGap(targetGap, purchaseCreditSoFar());
    pushBranchTelemetry(branchIndex, branch, branchOutcome, {
      pagesAttempted: branchPagesAttempted,
      providerRequests: branchProviderRequests,
      rawResults: branchRawResults,
      duplicatesRemoved: branchDuplicatesRemoved,
      uniqueResults: branchUniqueResults,
      usefulResults: useful.length - usefulBeforeBranch,
      remainingGapBefore,
      remainingGapAfter,
      providerCreditsReported: branchCredits,
      precisionRejected: branchPrecisionRejected,
      targetOverflowDiscarded: branchTargetOverflow,
    });
  }

  // Error duro: la primera petición falló y no hay nada que conservar.
  if (hardFailure !== null) return hardFailure;

  // ── AGENT1-CUT3B23 §§ 8/9/11/12/15 — admisión por identidad de LOTE ────────
  //
  // Corre AQUÍ, antes de derivar un solo conteo, para que todo lo que se reporta
  // aguas abajo —`usefulResultsTotal`, `acceptedForTargetTotal`, el conteo del
  // lote y `persistedCount`— describa lo que de verdad se va a persistir. Correr
  // después habría dejado a `persistedCount` afirmando un número que la inserción
  // no iba a producir.
  //
  // 🔴 AGENT1-LOCAL-CUT9 §§ 6, 7 — la siembra YA NO es vacía por construcción.
  //
  // Hasta CUT9A lo era, y allí quedó declarada como LIMITACIÓN: con adopción la
  // mitad gratuita puede haber escrito antes en este mismo lote, y con el hueco
  // parcial ACTIVADO esa es la ruta normal. Una empresa que lo gratuito ya cerró
  // podía volver por la ruta de pago y cerrar hueco por SEGUNDA vez.
  //
  // Ahora la siembra llega en `execution.batchIdentitySeed`, resuelta por
  // `loadBatchIdentityRegistry` sobre el lote canónico de la ejecución —la MISMA
  // autoridad que usan los otros dos escritores— y NO por un emparejamiento nuevo.
  //
  // 🔴 Sigue sin resolverse el lote antes de la admisión: la siembra se pide por
  // el `batchId` que la capa gratuita YA materializó, así que la admisión conserva
  // su posición (antes de derivar un solo conteo) y una corrida sin aporte
  // gratuito sigue admitiendo contra un registro vacío, que ahí es la verdad.
  //
  // 🔴 Y no sustituye a las otras dos protecciones: `checkCompanyDuplicate` y el
  // prefetch de candidatos activos siguen corriendo enteros, y siguen siendo la
  // paridad CRUZADA contra SellUp/HubSpot. Ésta responde otra pregunta: «¿esta
  // empresa ya ocupa ESTE lote?».
  //
  // 🔴 NO sustituye a `lusha-run-identity-registry`: aquél dedupea la CORRIDA del
  // proveedor (todas las páginas de todas las ramas) ANTES de pagar y es
  // específico de Lusha. Éste dedupea el LOTE entre capas, en la admisión. Lo que
  // atrapa de nuevo: dos empresas que el registro de corrida NO pudo unir —dos
  // ids de proveedor distintos, sin dominio— pero que traen la MISMA identidad
  // fiscal del enriquecimiento oficial.
  //
  // 🔴 Corre ANTES de derivar el hueco residual y el motivo de parada, y ese
  // orden es el corazón de la corrección: calcular el residual con lo que la
  // CORRIDA aceptó y luego retirar duplicados producía el informe imposible
  // «objetivo 2 · aceptado 1 · hueco 0 · target_reached». Retirar un duplicado NO
  // reabre páginas —eso sería gasto nuevo— pero SÍ obliga a decir la verdad sobre
  // el hueco que queda.
  const batchIdentityAdmission = admitByBatchIdentity(
    // 🔴 Ausente ⇒ `createBatchIdentityRegistry(null)`, byte por byte la siembra
    // vacía anterior a CUT-9. Es la verdad cuando no hubo aporte gratuito, y es la
    // degradación ABIERTA cuando la lectura de la foto falló: una consulta caída no
    // puede convertirse en «esta empresa ya existía».
    execution?.batchIdentitySeed?.registry ?? createBatchIdentityRegistry(null),
    useful,
    (resolved) =>
      buildCompanyIdentityEvidence({
        countryCode: resolved.company.countryIso2,
        // Identidad fiscal SÓLO si la costura oficial dio coincidencia FUERTE.
        taxIdentifier: resolved.enriched
          ? buildOfficialSourceTypedColumns(resolved.enriched).tax_identifier
          : null,
        domain: resolved.company.domain,
        linkedinUrl: resolved.company.linkedinUrl,
        // Identidad NATIVA de Lusha, con su namespace: `apollo:<id>` y
        // `lusha:<id>` con el mismo valor NO pueden compararse iguales.
        providerKey: LUSHA_PENDING_REVIEW_PROVIDER,
        providerEntityId: resolved.company.providerCompanyId,
        name: resolved.company.name,
      }),
  );
  const batchIdentityDuplicateSkippedCount = batchIdentityAdmission.rejected.length;
  if (batchIdentityDuplicateSkippedCount > 0) {
    // § 12 — el duplicado no se persiste, no es un error y no sobrescribe al
    // ganador: se retira del conjunto que se va a escribir. `useful` es el
    // acumulador local de esta corrida, no un valor compartido.
    const admitted = batchIdentityAdmission.admitted.map((entry) => entry.item);
    useful.splice(0, useful.length, ...admitted);
  }
  const batchIdentityMetrics = toBatchIdentityCountersMetadata(
    batchIdentityAdmission.counters,
  );
  // AGENT1-LOCAL-CUT9 § 6 — sólo conteos y banderas. `seeded: 0` con
  // `seed_available: false` significa «no había lote del que sembrar»; con
  // `seed_available: true` significa «el lote estaba vacío». No son lo mismo.
  const batchIdentitySeedTelemetry: Record<string, number | boolean> = {
    batch_identity_seed_available: execution?.batchIdentitySeed != null,
    batch_identity_seeded_rows: execution?.batchIdentitySeed?.seededCount ?? 0,
    batch_identity_seed_degraded: execution?.batchIdentitySeed?.degraded === true,
  };

  // 🔴 X5.1 — la costura única, evaluada sobre los supervivientes ya admitidos.
  // La metadata del lote (pre-inserción) y la fila de uso (post-inserción) leen
  // de AQUÍ; ninguna vuelve a escribir su propia expresión.
  const acceptanceFacts: LushaRunAcceptanceFacts = {
    requestedSubindustries: execution?.requestedSubindustries ?? [],
  };
  const acceptanceTruthPreWrite = resolveLushaRunAcceptanceTruth(
    useful.map(toLushaSurvivorCompletenessInput),
    acceptanceFacts,
  );
  // 🔴 X5.1 — el hueco de COMPRA se cierra con `purchaseCredit`, que es el
  // RENDIMIENTO de lo pagado: cuántas empresas útiles trajo. No depende de la
  // completitud ni del objetivo, y `acceptedForTarget` no entra aquí jamás.
  const remainingGapFinal = resolveLushaRemainingGap(
    targetGap,
    acceptanceTruthPreWrite.purchaseCredit,
  );
  // 🔴 AGENT1-LUSHA-PAGE-NOVELTY-POLICY-1 — aquí vivía
  // `if (remainingGapFinal <= 0 && !runStopped) stopReason = 'target_reached'`.
  //
  // Se retira: el motivo de parada informa el LÍMITE o el AGOTAMIENTO que terminó
  // la búsqueda, y el cumplimiento del objetivo lo dice `accepted_for_target` y
  // nadie más. Cerrar el hueco de COMPRA —que se mide con supervivientes y del
  // que `acceptedForTarget` está excluido por contrato— no es cumplir el
  // objetivo, y publicarlo con esa palabra producía informes contradictorios
  // dentro del mismo lote.
  //
  // El motivo que sobrevive al bucle es el real: `branches_exhausted` cuando las
  // ramas gastaron sus páginas, o el que `runStopped` fijó.

  // El techo y el agotamiento de ramas COINCIDEN cuando cada rama gastó todas sus
  // páginas: los bucles terminan solos y nadie llega a rechazar una petición.
  // Reportarlo como `branches_exhausted` escondería que hubo recorte por techo.
  //
  // 🔴 Ya no se condiciona a `remainingGapFinal > 0`: el techo de peticiones se
  // tocó o no se tocó, y eso es cierto con independencia de cuántas empresas
  // útiles trajera lo comprado. Atarlo al hueco era la última vía por la que el
  // objetivo se colaba en el motivo de parada.
  if (
    stopReason === 'branches_exhausted' &&
    providerRequestsUsed >= providerRequestsAllowed
  ) {
    stopReason = 'request_cap_reached';
  }
  // «Sin resultados» sólo cuando el proveedor no devolvió NI UNA fila: es distinto
  // de «devolvió y todo era duplicado», que ya se explica con los conteos.
  if (rawResultsTotal === 0 && stopReason === 'branches_exhausted') {
    stopReason = 'no_results';
  }
  // AGENT1-CUT3B23 § 1 — aquí vivía la asignación de
  // `post_admission_identity_gap`, disparada por
  // `stopReason === 'target_reached' && remainingGapFinal > 0`.
  //
  // 🔴 AGENT1-LUSHA-PAGE-NOVELTY-POLICY-1 — se retira la asignación, y el motivo
  // se declara lo que ya era: INALCANZABLE, y no desde este corte sino desde
  // X6.13.
  //
  // La regla nació para un camino que existía entonces: la corrida podía pararse
  // con `target_reached` DENTRO del bucle, y la admisión de identidad de LOTE
  // reabría después el hueco. X6.13 retiró esa parada (el objetivo es un MÍNIMO y
  // ya no detiene la petición), y desde entonces `target_reached` sólo podía
  // asignarse en el único sitio que exigía `remainingGapFinal <= 0`. Su condición
  // pedía a la vez `remainingGapFinal <= 0` y `remainingGapFinal > 0`: una
  // contradicción, y por tanto código muerto en `origin/main`.
  //
  // 🔴 No se sustituye por una versión "reanimada". El hueco de compra tras la
  // admisión es `remainingGapFinal`, y no se conserva ningún recuento ANTERIOR a
  // ella con el que compararlo, así que cualquier reescritura con los datos de
  // hoy volvería a ser una contradicción disfrazada. El literal sigue vivo en el
  // tipo —CUT-3B23 § 4 lo exige— y su hermano de PERSISTENCIA, que sí es
  // alcanzable, se conserva intacto más abajo.

  const pagesRequested = providerRequestsUsed;

  const excludedExactDuplicatesCount = excludedExactDuplicates.length;
  // `skippedCount` conserva su significado de siempre: todo lo que el proveedor
  // devolvió y no llegó a candidato por identidad — filas impersistibles,
  // duplicados de identidad (antes «duplicados de dominio/nombre») y descartes
  // fuertes del guard de activos. Dejar fuera los duplicados de identidad habría
  // hecho que la UI dijera «0 omitidas» tras descartar la mitad de la página.
  //
  // AGENT1-CUT3B23 § 4 — los duplicados que retira el registro de identidad de
  // LOTE son de esa misma familia y por eso suman aquí. No hay doble conteo: los
  // otros tres sumandos se cuentan ANTES de que `useful` llegue a la admisión, y
  // este cuarto sólo cuenta filas que sobrevivieron a los tres y cayeron después.
  // Siguen sin ser errores.
  //
  // 🔴 CUT-L1 § 4 — la supresión CLIENTE de conocidos suma aquí como quinto
  // sumando, y tiene que sumar: son filas que el proveedor devolvió y que no
  // llegaron a candidato. Dejarlas fuera haría que la UI dijera «0 omitidas» tras
  // retirar media página. No hay doble conteo: se restaron de
  // `crossBranchDuplicatesRemoved` en el punto donde se cuentan.
  const totalSkipped =
    skippedUnusableCount +
    crossBranchDuplicatesRemoved +
    localKnownSuppressedTotal +
    skippedActiveDuplicatesCount +
    batchIdentityDuplicateSkippedCount;
  const topUpTriggered = pagesRequested > 1;
  const possibleDuplicatesCount = useful.filter(
    (c) => c.resolution.dbDuplicateStatus === 'possible_duplicate',
  ).length;
  const hardExcludedByGateCount = excludedByMandatoryGate.length;
  const enrichedWithOfficialSourceCount = useful.filter(
    (c) => c.enriched?.strongIdentityAvailable === true,
  ).length;

  // §§ 18/19 — telemetría de corrida y de rama. Sin PII y sin payload del
  // proveedor: ids de industria, conteos, créditos y motivos.
  const runTelemetry: LushaRunTelemetry = {
    macroKey: plan?.macroKey ?? null,
    targetGap,
    branchCountPlanned: branches.length,
    branchCountAttempted: branchTelemetry.filter((b) => b.providerRequests > 0).length,
    providerRequestsAllowed,
    providerRequestsUsed,
    pagesSkippedBranchStopped,
    maxRawResults: LUSHA_RUN_MAX_RAW_RESULTS,
    rawResultsTotal,
    crossBranchDuplicatesRemoved,
    // 🔴 CUT-L1 §§ 4, 5 — lo devuelto que ya conocíamos, y cuánto se sembró.
    // `localKnownSeedCount > 0` con `provider_exclusion_domains_sent: 0` es la
    // lectura correcta del corte: se sabía, y no se envió porque no hay dónde.
    localKnownSuppressedTotal,
    localKnownSeedCount: localKnownSeed.length,
    duplicateReasonCounts,
    uniqueResultsTotal: normalizedCount,
    usefulResultsTotal: useful.length,
    reviewableFoundTotal,
    pageRequests: pageRequestObservations,
    // 🔴 X5.1 — `useful.length` es el UNIVERSO de supervivientes, no la
    // aceptación. Publicarlo aquí bajo este nombre era la mitad de la
    // divergencia D1; la otra mitad la publicaba la fila de uso.
    acceptedForTargetTotal: acceptanceTruthPreWrite.acceptedForTarget,
    targetOverflowDiscarded,
    precisionRejectedTotal,
    qualityRejectedTotal,
    precisionReasonCounts,
    remainingGapFinal,
    creditsReserved: execution?.creditsReserved ?? null,
    creditsReportedActual: creditsChargedTotal,
    stopReason,
    branches: branchTelemetry,
    // ── ADDENDUM PROVIDER-SEEN § 10 ──
    //
    // Sólo se rellena cuando el llamador pasó la memoria: sin ella el bloque no
    // se emite y la metadata del lote conserva su forma exacta previa al PR.
    ...(execution?.providerSeen
      ? {
          providerSeen: {
            rawResults: rawResultsTotal,
            providerSeenHits: providerSeenHitsTotal,
            novelAfterProviderSeen: providerSeenNovelTotal,
            novelUsefulAfterLocalDedupe: reviewableFoundTotal,
            newIdsRecorded: providerSeenNewIdsTotal,
            newDomainsRecorded: providerSeenNewDomainsTotal,
            pageYields: providerSeenPageYields,
            branchStopReasons: providerSeenBranchStopReasons,
            writeFailures: providerSeenWriteFailures,
            lastWriteSkippedReason: providerSeenLastWriteSkippedReason,
          },
          providerSeenLoad: execution.providerSeenLoad,
          providerExclusionPlan: execution.providerExclusionPlan,
          freeSource: execution.freeSource,
        }
      : {}),
  };

  // CUT-L5 §§ 7, 8 — el resumen de facturación de la corrida. `null` cuando no se
  // despachó ninguna petición: ahí no hay contrato que contrastar.
  const billingContract: LushaRunBillingContractSummary | undefined =
    firstBillingContrast === null
      ? undefined
      : {
          billingBlockSize: LUSHA_PROSPECTING_BILLING_BLOCK_SIZE,
          requestedPageSize: LUSHA_PROSPECTING_PAGE_SIZE,
          requestLiabilityCreditsPerPage: firstBillingContrast.requestLiabilityCredits,
          expectedCreditsTotal: expectedCreditsTotal,
          // 🔴 Lo REAL, sin tocar. Ver la nota del tipo.
          actualCreditsTotal: creditsChargedTotal,
          mismatchedPages: billingContractMismatchPages,
          matchesContract:
            billingContractMismatchPages > 0
              ? false
              : expectedCreditsTotal === null || creditsChargedTotal === null
                ? null
                : true,
          exceededRequestLiability: billingAnomalyContrast?.exceedsRequestLiability === true,
        };

  const baseMetrics = {
    pagesRequested,
    billingContract,
    // Techo de la CORRIDA (ramas × techo por rama): 1 rama → 2 · 2 → 4 · 3 → 6.
    // Es el mismo producto del que sale la reserva, no una segunda cuenta.
    expectedMaxCredits,
    creditsChargedTotal,
    excludedExactDuplicatesCount,
    skippedActiveDuplicatesCount,
    possibleDuplicatesCount,
    topUpTriggered,
    hardExcludedByGateCount,
    enrichedWithOfficialSourceCount,
    providerRequestsAllowed,
    providerRequestsUsed,
    branchCountPlanned: branches.length,
    branchCountAttempted: runTelemetry.branchCountAttempted,
    targetGap,
    remainingGapFinal,
    crossBranchDuplicatesRemoved,
    localKnownSuppressedTotal,
    rawResultsTotal,
    stopReason,
    reviewableFoundTotal,
    targetOverflowDiscarded,
    precisionRejectedTotal,
    qualityRejectedTotal,
    multiBranch: runTelemetry,
    batchIdentityDuplicateSkippedCount,
    batchIdentityMetrics,
    // AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — viaja en `baseMetrics` a propósito:
    // es el ÚNICO sitio que se difunde tanto al resultado `empty` como al
    // `success`, así que la trazabilidad no puede existir sólo en uno de los dos.
    discardedCompanies: discardRecords,
  };

  if (useful.length === 0) {
    // Nothing new/reviewable: empty result (no batch, no candidates).
    return {
      ok: true,
      status: 'empty',
      batchId: null,
      createdCandidatesCount: 0,
      skippedCount: totalSkipped,
      creditsCharged: creditsChargedTotal,
      resultsReturned: resultsReturnedTotal,
      reviewUrl: LUSHA_PENDING_REVIEW_URL,
      message:
        excludedExactDuplicatesCount > 0
          ? 'Las empresas encontradas ya existen (duplicados confirmados). No hay nuevas para revisar.'
          : 'La búsqueda no devolvió empresas nuevas para revisar.',
      ...baseMetrics,
      usefulCandidatesCount: 0,
      insertedCandidatesCount: 0,
    };
  }

  const batchRow = buildLushaPendingReviewBatchRow(
    input,
    actor,
    firstSearch as LushaPreviewResult,
    {
      pagesRequested,
      creditsChargedTotal,
      billingContract,
      resultsReturnedTotal,
      usefulCandidatesCount: useful.length,
      possibleDuplicatesCount,
      excludedExactDuplicatesCount,
      skippedActiveDuplicatesCount,
      topUpTriggered,
      excludedExactDuplicates,
      gateSummary,
      excludedByMandatoryGate,
      enrichmentSummary,
      multiBranchTelemetry: runTelemetry,
    },
  );
  // Q3F-5BB.11D — additively stamp the OBSERVATIONAL routing metadata on the
  // batch (provider_routing + a single primary Lusha provider_attempt built from
  // the real counters). Only when a routing observation was supplied; otherwise
  // the batch metadata is byte-for-byte the pre-11D shape. Unknown USD cost stays
  // null (never coerced to 0). All existing metadata keys are preserved.
  const batchRowWithRouting = routing?.routingMetadata
    ? {
        ...batchRow,
        metadata: mergeProviderRoutingBatchMetadata(
          batchRow.metadata,
          routing.routingMetadata,
          [
            buildProviderAttemptMetadata(
              {
                provider: LUSHA_PENDING_REVIEW_PROVIDER,
                status: 'success',
                usefulCandidateCount: useful.length,
                creditsSpent: creditsChargedTotal,
                // Lusha USD price is not authorized → unknown, never 0.
                usdSpent: null,
                error: null,
              },
              {
                role: 'primary',
                rawCount: rawResultsTotal,
                normalizedCount,
                gateExcludedCount: hardExcludedByGateCount,
                exactDuplicateCount: excludedExactDuplicatesCount,
                possibleDuplicateCount: possibleDuplicatesCount,
                persistedCount: useful.length,
                estimatedCostUsd: null,
                pagesRequested,
                qualityScore: null,
              },
            ),
          ],
        ),
      }
    : batchRow;
  // AGENT1-LOCAL-CUT9A § 4 — reserve-or-return. `batchId` puede ser una fila que
  // esta llamada acaba de crear o el lote canónico que la mitad gratuita ya
  // materializó para ESTA misma ejecución; en los dos casos es el único lote.
  const reservation = await deps.reserveBatch(batchRowWithRouting);
  const batchId = reservation.id;

  const candidateRows = buildLushaPendingReviewCandidateRows(batchId, useful);
  // Q3F-5BB.11D — additively stamp `provider_trace` on each candidate and keep
  // `metadata.source_provider` / `source_trace.sourceProvider` consistent (they
  // are already 'lusha' from the row builder, so the merge is a no-conflict
  // enrichment). Preserves every existing candidate metadata / source_trace key.
  const candidateRowsWithRouting = routing?.routingMetadata
    ? candidateRows.map((row) => {
        const trace = buildCandidateProviderTraceMetadata(
          { sourceProvider: LUSHA_PENDING_REVIEW_PROVIDER },
          { provider: LUSHA_PENDING_REVIEW_PROVIDER, role: 'primary' },
          { attemptIndex: 0, creditsUsed: null, estimatedCostUsd: null },
        );
        const merged = mergeCandidateProviderMetadata(
          { metadata: row.metadata, source_trace: row.source_trace },
          trace,
        );
        return { ...row, metadata: merged.metadata, source_trace: merged.source_trace };
      })
    : candidateRows;
  // ── AGENT1-CUT3B4 § 22 — el bloque de candidatos se escribe VALLADO ────────
  //
  // El lote acaba de nacer en esta misma llamada, así que su época es 0 y su
  // siembra está vacía por construcción. Aun así la escritura pasa por la valla, y
  // no por conveniencia: mientras el bloque se escriba fuera de ella, cualquier
  // adopción futura de este lote (el flujo mixto de un solo lote) heredaría una
  // ruta capaz de escribir sin declarar contra qué estado decidió. Vallarlo ahora
  // es lo que hace que esa puerta no exista.
  //
  // 🔴 La atomicidad de TODO-O-NADA que la guarda de CUT-3B23 defiende NO se
  // pierde: el bloque entero viaja en un solo INSERT dentro de una transacción que
  // además comprueba y avanza la época. Es la misma promesa, más fuerte.
  //
  // 🔴 Un `stale` aquí es hoy INALCANZABLE —nadie más conoce este `batchId`—, y
  // por eso NO se re-evalúa la admisión: la admisión de identidad de esta ruta ya
  // corrió arriba, sobre una siembra vacía que sigue siendo la verdad. Si un día
  // el lote se adopta, `stale` deja de ser inalcanzable y esta llamada tiene que
  // pasar por `runFencedPersistence` como las otras dos rutas.
  //
  // 🔴 CUT-3B4-CORRECCIÓN — la dependencia vallada es OBLIGATORIA y se llama
  // SIEMPRE. No hay `if (fencedInsert)` ni `else`: mientras existió, el núcleo
  // escribía sin valla por el solo hecho de que nadie inyectara la dependencia, y
  // ése es un desvío ESTRUCTURAL —ajeno al esquema— que aplicar la 126 no cerraba.
  // La ÚNICA puerta a la ruta anterior a B4 es `capability_absent`, que es la BASE
  // diciendo que la función no existe.
  let insertedCount: number;
  /**
   * Ids que la escritura VALLADA confirmó. `null` ⇒ no se tomó esa ruta, y
   * entonces lo único que se sabe es CUÁNTAS filas entraron, no cuáles.
   */
  let fencedInsertedCandidateIds: ReadonlyArray<string> | null = null;
  let fenceTelemetry: Record<string, number | boolean | null>;
  /**
   * AGENT1-LOCAL-CUT9B — la época que el lote tiene DESPUÉS de esta escritura.
   *
   * 🔴 NO es `epochEvidence.epoch`: ésa es la de ANTES, y la transacción vallada
   * acaba de avanzarla. Declararla como token de CAS daría `stale` siempre —contra
   * la propia escritura de esta corrida— y la publicación durable no entraría
   * nunca. La única época válida para lo que viene es la que la valla devolvió.
   */
  let epochAfterWrite: number | null;

  // ── 🔴 CUT9A-FIX-ADOPTED-EPOCH-REFRESH — la época se RELEE, no se recuerda ──
  //
  // La reserva canónica es autoridad de IDENTIDAD (`batchId`), y sigue memoizada:
  // esta lectura no vuelve a materializar nada ni provoca un segundo INSERT.
  //
  // Lo que la reserva NO puede seguir siendo es autoridad de ÉPOCA. El resolutor
  // memoiza el objeto entero, así que en la ruta gratuita→pago la mitad de pago
  // recibía la época que el lote tenía cuando NACIÓ (0), no la que tiene después
  // de que la capa gratuita escribiera sus filas (N). Declarar 0 sobre un lote en
  // N daba `stale` y lanzaba la corrida ENTERA tras haber pagado al proveedor.
  //
  // 🔴 `reservation.adopted` tampoco decide: `adopted: false` dice «esta llamada
  // creó la fila», no «la fila sigue en la época 0». En esta ruta las dos cosas
  // son ciertas a la vez, y ahí se rompía el literal fresco.
  const epochEvidence = await deps.readBatchIdentityEpoch(batchId);

  // 🔴 `epoch === null` NO es la época 0. Sólo la conjunción PROBADA —la BASE dijo
  // 42883/PGRST202, y la lectura no falló— autoriza seguir: en ese esquema la RPC
  // vallada no existe, la valla responderá `capability_absent` y el valor que
  // viaje es inerte. Cualquier otro `null` es avería (lectura caída, lote
  // invisible, cliente no soportado) y falla CERRADO: confundirlo con 0 habría
  // hecho pasar por vallada una escritura que no lo está.
  if (epochEvidence.epoch === null && !isProvenFenceCapabilityAbsent(epochEvidence)) {
    throw new Error('No se pudieron crear los candidatos: fence_snapshot_unavailable');
  }

  const fenced = await deps.insertCandidatesFenced({
    batchId,
    // La época ACTUAL del lote. `LUSHA_FRESH_BATCH_IDENTITY_EPOCH` sólo aparece
    // cuando la ausencia de la valla está PROBADA y el parámetro no se consulta.
    expectedEpoch: epochEvidence.epoch ?? LUSHA_FRESH_BATCH_IDENTITY_EPOCH,
    rows: candidateRowsWithRouting,
  });

  if (fenced.status === 'inserted') {
    insertedCount = fenced.insertedCount;
    /**
     * 🔴 LA RUTA VALLADA SÍ SABE CUÁLES FILAS QUEDARON.
     *
     * `insert_fenced_prospect_candidates` inserta el bloque ENTERO dentro de una
     * transacción y devuelve `candidateIds`: o entran todas o no entra ninguna.
     * Un `inserted` es, por contrato, una escritura TOTAL, así que la aceptación
     * se re-evalúa sobre la lista completa y el conteo es EXACTO. La cota
     * conservadora no aplica aquí y decirlo importa: aplicarla castigaría a la
     * ruta que sí tiene la evidencia.
     */
    fencedInsertedCandidateIds = fenced.candidateIds;
    // 🔴 Sólo un número REAL sirve de token de CAS. Un desenlace sin `nextEpoch`
    // —un doble antiguo, una respuesta ilegible— deja la época en `null`, y desde
    // ahí la publicación NO cae a una escritura sin valla: cae a «no disponible»,
    // que es fallo CERRADO. Inventar un 0 aquí escribiría declarando un estado que
    // nadie observó.
    epochAfterWrite =
      typeof fenced.nextEpoch === 'number' && Number.isFinite(fenced.nextEpoch)
        ? fenced.nextEpoch
        : null;
    fenceTelemetry = {
      identity_epoch_initial: fenced.previousEpoch,
      identity_epoch_final: fenced.nextEpoch,
      identity_fence_capability_absent: false,
    };
  } else if (fenced.status === 'capability_absent') {
    // La 126 no está aplicada. Ruta ANTERIOR a B4, tal cual. Lo decide el
    // esquema: no es un flag, no es la forma de un objeto de dependencias y nadie
    // puede activarla a mano.
    insertedCount = (await deps.insertCandidates(candidateRowsWithRouting)).insertedCount;
    // La 126 no está aplicada: la columna que hace de versión NO EXISTE, así que
    // no hay token de CAS posible. La publicación tomará la ruta anterior a B4 —la
    // misma forma de escritura que `candidate-writer` y el sellado de CUT-8B ya
    // hacen hoy— y sólo porque la ausencia está PROBADA por la base.
    epochAfterWrite = null;
    fenceTelemetry = {
      identity_epoch_initial: null,
      identity_epoch_final: null,
      identity_fence_capability_absent: true,
    };
  } else if (fenced.status === 'insert_failed') {
    // Mismo contrato que la dependencia anterior a B4: un fallo de escritura
    // LANZA. Tragárselo dejaría el lote afirmando filas que no existen.
    throw new Error(`No se pudieron crear los candidatos: ${fenced.code}`);
  } else {
    // `stale`, `batch_not_found` o `invalid_input` sobre un lote recién creado
    // por esta misma llamada. No se degrada a una escritura sin valla: se dice.
    throw new Error(`No se pudieron crear los candidatos: fence_${fenced.status}`);
  }

  // ── AGENT1-CUT3B23 §§ 1/3 — reconciliación FINAL contra las filas REALES ────
  //
  // La admisión de identidad dice qué se INTENTÓ escribir; `insertedCount` dice
  // qué EXISTE. Sólo lo segundo puede contar contra el objetivo y sólo lo segundo
  // puede cerrar el hueco. Lo normal es que coincidan; cuando no coinciden, quien
  // manda es la base.
  //
  // 🔴 La metadata del LOTE conserva la telemetría pre-inserción, y no es un
  // descuido: el lote se crea antes que sus candidatos —los candidatos necesitan
  // su `batch_id`—, así que en ese instante `insertedCount` todavía no existe. Lo
  // que el llamador recibe, que es lo que gobierna el hueco residual y la UI, sí
  // lleva la verdad persistida.
  // 🔴 AGENT1-LUSHA-TARGET-ACCEPTANCE-X5.1 — aquí vivía
  // `persistedForTarget = Math.min(insertedCount, useful.length)`, y ese número
  // se publicaba como `completeValidCandidates`. Era un conteo de FILAS ya
  // recortado por el objetivo disfrazado de veredicto de completitud: la pierna
  // Lusha no medía completitud, y el hueco se rellenó con la cifra a mano.
  //
  // Ahora las dos preguntas se responden por separado y en su sitio:
  //
  //   filas escritas      → `insertedCount`, sin recortar contra el objetivo
  //   cuántas COMPLETAN   → `acceptanceTruth`, por el contrato CANÓNICO
  //
  // `survivorsPersisted` conserva la reconciliación honesta —no se puede
  // afirmar haber persistido más filas de las que el insert confirmó— pero ya
  // NO se llama «for target», porque el objetivo no participa.
  // 🔴 X5.1 — UNA sola evaluación por corrida: `acceptanceTruthPreWrite`, ya
  // calculada arriba sobre la MISMA lista de supervivientes. Volver a evaluarla
  // aquí sería reabrir la puerta a dos expresiones para un mismo nombre, que es
  // exactamente el defecto que este corte cierra.
  const survivorsPersisted = Math.min(insertedCount, useful.length);
  /**
   * 🔴 X6.12 — LA VERDAD FINAL DEL WRITER.
   *
   * Hasta este corte la aceptación publicada era la evaluación PRE-escritura
   * recortada con `Math.min(…, survivorsPersisted)`. Ese `min` es una cota, no
   * una medición: no sabe CUÁLES filas existen, sólo cuántas, y con una
   * escritura parcial podía acreditar como completas a candidatas que no se
   * escribieron.
   *
   * Ahora la aceptación final se RE-EVALÚA sobre la lista que el writer escribió
   * —las mismas filas, el mismo proyector, la misma regla— y sólo cuando la base
   * confirmó TODAS. La escritura de esta ruta es todo-o-nada dentro de una
   * transacción vallada, así que ése es el caso normal.
   *
   * 🔴 Si la base confirmara MENOS filas de las que se le entregaron, no se
   * adivina cuáles sobrevivieron: se conserva la cota de X5.1 (fail-closed) y la
   * discrepancia queda declarada en la telemetría. Inventar un subconjunto sería
   * exactamente la clase de afirmación que este corte existe para no hacer.
   */
  /**
   * 🔴 ¿SE SABE CUÁLES filas quedaron, o sólo cuántas?
   *
   *   · Ruta VALLADA con `inserted` ⇒ transacción todo-o-nada con ids
   *     devueltos: escritura TOTAL y conteo EXACTO.
   *   · Ruta sin valla (`capability_absent`) ⇒ sólo `insertedCount`. Si coincide
   *     con lo entregado, la escritura fue total igualmente; si es menor, no hay
   *     forma de saber cuáles entraron y lo que se publica es una COTA INFERIOR.
   */
  const writerRowsFullyPersisted =
    fencedInsertedCandidateIds !== null || insertedCount >= useful.length;
  /** `false` ⇒ `acceptedForTarget` de esta pierna es una cota, no un conteo. */
  const acceptedCountExact = writerRowsFullyPersisted;
  const acceptanceTruthFinal = writerRowsFullyPersisted
    ? resolveLushaRunAcceptanceTruth(useful.map(toLushaSurvivorCompletenessInput), acceptanceFacts)
    : acceptanceTruthPreWrite;
  const remainingGapPersisted = resolveLushaRemainingGap(targetGap, survivorsPersisted);
  // 🔴 AGENT1-LUSHA-PAGE-NOVELTY-POLICY-1 — a diferencia de su hermano de
  // IDENTIDAD, este motivo SÍ es alcanzable, y su condición se conserva EXACTA.
  //
  // El disparador era `stopReason === 'target_reached'`, y ese literal sólo podía
  // asignarse bajo `remainingGapFinal <= 0 && !runStopped`. Al retirar la
  // etiqueta, esas dos condiciones se escriben tal cual: no se ensanchan —dejar
  // que una anomalía de ESCRITURA tape el límite que terminó la búsqueda sería
  // justo lo contrario de separar el motivo del cumplimiento— ni se estrechan.
  //
  // La causa aquí no es la deduplicación sino la escritura, y se nombra distinto.
  const stopReasonPersisted: LushaRunStopReason =
    remainingGapFinal <= 0 && !runStopped && remainingGapPersisted > 0
      ? 'post_admission_persistence_gap'
      : stopReason;
  const runTelemetryPersisted: LushaRunTelemetry = {
    ...runTelemetry,
    // 🔴 X5.1 — la MISMA cifra que la metadata (§ costura única). Antes esta
    // línea publicaba las filas y la metadata publicaba `useful.length`: dos
    // números bajo un solo nombre.
    //
    // 🔴 El tope contra `survivorsPersisted` NO es el objetivo, es la REALIDAD:
    // no se puede aceptar más de lo que la base confirmó que se escribió. Es la
    // invariante que CUT-9B § G fijó —«si la base confirmara MÁS filas que
    // útiles, la aceptación NO las sigue»— y sigue viva; lo que cambia es el
    // otro operando, que ya no es un conteo de filas sino el veredicto de
    // completitud del contrato canónico.
    // 🔴 La cota deja de ser `Math.min(aceptadas, filas)`: un `insertedCount`
    // acotado dice CUÁNTAS filas entraron, jamás CUÁLES, y recortar con él
    // acredita una completitud que nadie probó. Ver
    // `boundAcceptedByUnconfirmedWrites`.
    acceptedCountExact,
    acceptedForTargetTotal:
      acceptanceTruthFinal.acceptedForTarget === null
        ? null
        : boundAcceptedByUnconfirmedWrites({
            complete: acceptanceTruthFinal.acceptedForTarget,
            attempted: useful.length,
            inserted: insertedCount,
          }),
    remainingGapFinal: remainingGapPersisted,
    stopReason: stopReasonPersisted,
  };

  // ── 🔴 AGENT1-LOCAL-CUT9B — LA PUBLICACIÓN DURABLE DE LA ACEPTACIÓN ────────
  //
  // Este es el ÚNICO punto de la ruta Lusha en el que se cumplen a la vez las tres
  // condiciones que la publicación exige:
  //
  //   · el lote CANÓNICO ya está resuelto (`batchId`, no «el último lote»);
  //   · las filas ya EXISTEN y están reconciliadas contra la base
  //     (`insertedCount`, `persistedForTarget`);
  //   · la época del lote es la POSTERIOR a esta escritura, así que sirve de token
  //     de CAS.
  //
  // 🔴 Lo que viaja al proyector es la VERDAD DEL WRITER, con el vocabulario que
  // CUT-8 ya fijó (`WriterMetadataOutcome`). `completeValidCandidates` es
  // `persistedForTarget` —lo RECONCILIADO contra las filas, la misma cifra que
  // `multiBranch.acceptedForTargetTotal` publica— y NO `useful.length`, que es lo
  // que la corrida intentó escribir. Ésa es exactamente la sustitución que CUT-7
  // cerró y que este corte no puede reabrir por la puerta de la metadata.
  //
  // 🔴 El núcleo NO decide la aceptación: pasa lo que contó y recibe claves ya
  // resueltas. La aritmética sigue viviendo en `resolveAcceptedForTarget`, en la
  // acción, y ésta es la MISMA instancia que produce el resultado que la acción
  // devuelve — no una segunda entrada a la misma cuenta.
  //
  // 🔴 Nunca lanza. Ver la nota del dep: aquí el proveedor ya cobró y los
  // candidatos ya son durables.
  let acceptedForTargetPublication: BatchMetadataPublicationResult | null = null;
  if (deps.acceptedForTargetPublication) {
    const seam = deps.acceptedForTargetPublication;
    try {
      acceptedForTargetPublication = await seam.publish({
        batchId,
        epochAfterWrite,
        evidence: epochEvidence,
        published: seam.resolve({
          persistedCandidates: insertedCount,
          // 🔴 X5.1 — el veredicto del contrato CANÓNICO, no un conteo de filas.
          // 🔴 X5.1 — `null` ⇒ no medible con lo que este proveedor entrega.
          // `paidAcceptedContributionFromWriterTruth` ya sabe leerlo y produce
          // `{ measured: false, reason: 'acceptance_not_measured' }`. Un `0`
          // aquí afirmaría haber medido, y no medimos.
          // 🔴 X6.12 — la publicación durable lee la verdad FINAL del writer, la
          // misma que el llamador recibe. Dos cifras bajo el mismo nombre —una
          // en la base y otra en la respuesta— es el defecto que CUT-9B cerró.
          // 🔴 La MISMA cota conservadora que publica la corrida: dos
          // expresiones para «cuántas completas sobrevivieron» era justamente el
          // defecto que CUT-9B cerró.
          completeValidCandidates: acceptanceTruthFinal.acceptanceMeasurable
            ? boundAcceptedByUnconfirmedWrites({
                complete: acceptanceTruthFinal.complete,
                attempted: useful.length,
                inserted: insertedCount,
              })
            : null,
          // Ahora SÍ se distingue, y por eso deja de ser `null`: la suma
          // `incomplete + unknown` es exactamente la cohorte de revisión, y las
          // dos poblaciones viajan separadas en la telemetría de la corrida.
          reviewOnlyCandidates:
            acceptanceTruthFinal.incomplete + acceptanceTruthFinal.unknown,
        }),
      });
    } catch {
      // Un proyector o un escritor que lance no puede tumbar una corrida pagada.
      // Se clasifica y se dice; no se reintenta y no se degrada a otra escritura.
      acceptedForTargetPublication = {
        status: 'failed',
        code: 'accepted_for_target_publication_threw',
      };
    }
  }

  return {
    ok: true,
    status: 'success',
    batchId,
    acceptedForTargetPublication,
    createdCandidatesCount: insertedCount,
    skippedCount: totalSkipped,
    creditsCharged: creditsChargedTotal,
    resultsReturned: resultsReturnedTotal,
    reviewUrl: LUSHA_PENDING_REVIEW_URL,
    message: `Encontramos ${insertedCount} ${insertedCount === 1 ? 'empresa candidata' : 'empresas candidatas'} para revisar.`,
    ...baseMetrics,
    // Las cuatro afirmaciones FINALES sobrescriben a las de `baseMetrics`, que se
    // compusieron antes de que existiera una sola fila.
    remainingGapFinal: remainingGapPersisted,
    stopReason: stopReasonPersisted,
    multiBranch: runTelemetryPersisted,
    batchIdentityMetrics: {
      ...toBatchIdentityCountersMetadata(
        tallyBatchIdentityPersisted(batchIdentityAdmission.counters, survivorsPersisted),
      ),
      // AGENT1-CUT3B4 § 24 — telemetría de CONCURRENCIA. Sólo conteos y estados:
      // ni dominio, ni identificador fiscal, ni LinkedIn, ni id de proveedor, ni
      // nombre de empresa.
      ...fenceTelemetry,
      // AGENT1-LOCAL-CUT9 § 6 — cuántas filas del lote entraron al registro y si
      // la foto degradó. Sin esto, «0 duplicados de lote» sería indistinguible de
      // «no se sembró nada», que son dos corridas muy distintas.
      ...batchIdentitySeedTelemetry,
    },
    usefulCandidatesCount: useful.length,
    insertedCandidatesCount: insertedCount,
    // 🔴 X6.13 — la identidad de lo ACEPTADO, para que un replay no vuelva a
    // sumarlo. Se deriva del MISMO proyector y la MISMA regla que produjeron
    // `acceptanceTruthFinal`; no hay una segunda definición de «completa».
    // 🔴 Cuando la base confirmó MENOS filas de las entregadas no se puede decir
    // CUÁLES sobrevivieron, así que no se declara ninguna identidad — y eso es
    // distinto de declararlas vacías. Con el campo ausente manda el contador,
    // que ya viene acotado fail-closed por `acceptanceTruthPreWrite`; con una
    // lista vacía el aporte valdría cero y perderíamos una aceptación real.
    ...(writerRowsFullyPersisted
      ? {
          acceptedCandidateIdentities: useful
            .filter(
              (entry) =>
                evaluateLushaSurvivorCompleteness(
                  toLushaSurvivorCompletenessInput(entry),
                  acceptanceFacts,
                ) === 'complete',
            )
            .map((entry) => lushaAcceptedIdentity(entry)),
        }
      : {}),
  };
}

/**
 * 🔴 X6.13 — identidad durable de UNA superviviente aceptada, con su espacio de
 * nombres.
 *
 * El orden de preferencia es el de estabilidad: el id del proveedor sobrevive a
 * un cambio de dominio; el dominio normalizado sobrevive a un cambio de nombre;
 * el nombre es el último recurso. Nunca se devuelve una cadena vacía: una
 * identidad vacía colapsaría a varias candidatas en una sola.
 */
function lushaAcceptedIdentity(entry: ResolvedLushaCandidate): string {
  const providerId = entry.company.providerCompanyId?.trim();
  if (providerId) return `lusha:provider:${providerId}`;
  const domain = normalizeDomain(entry.company.domain);
  if (domain) return `lusha:domain:${domain}`;
  return `lusha:name:${normalizeLushaCompanyName(entry.company.name ?? '')}`;
}
