/**
 * Lusha → pending-review persistence — pure core (Q3F-5BB.4 · duplicate parity Q3F-5BB.7)
 *
 * Turns a Lusha company-prospecting result into a pending-review prospect batch
 * plus candidate rows. This module is PURE + fully dependency-injected: it does
 * NO I/O of its own. Every write flows through the injected `insertBatch` /
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

import { PROSPECTOS_TAB_ROUTE } from '@/config/navigation';
import { isLinkedInCompanyUrl } from '@/modules/prospect-batches/candidate-linkedin-url';
import {
  checkActiveCandidateDuplicate,
  type ActiveCandidateRecord,
  type DuplicateGuardInput,
  type DuplicateGuardMatch,
} from '@/server/agents/prospecting-toolkit/active-candidate-identity-guard';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
  DuplicateMatch,
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
import {
  createLushaRunIdentityRegistry,
  dedupeLushaCompaniesByIdentity,
  normalizeLushaCompanyName,
  type LushaIdentityDuplicateReason,
  type LushaRunIdentityRegistry,
} from './lusha-run-identity-registry';
import type { LushaMacroSearchPlan } from './lusha-macro-search-plan';

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
  target_count: number | null;
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
}

/** Runs Lusha once. Backed by the read-only `executeLushaPreview` core so the
 *  page/size/credit guardrails are inherited verbatim. */
export type RunLushaSearch = (input: LushaPreviewInput) => Promise<LushaPreviewResult>;

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

export interface PersistLushaPendingReviewDeps {
  runSearch: RunLushaSearch;
  // ── Write deps (the ONLY two write surfaces) ──
  insertBatch: (row: LushaPendingReviewBatchRow) => Promise<{ id: string }>;
  insertCandidates: (
    rows: LushaPendingReviewCandidateRow[],
  ) => Promise<{ insertedCount: number }>;
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
  /** True when page 1 was requested to top up useful candidates. */
  topUpTriggered: boolean;
  // ── Shared intake pipeline metrics (Q3F-5BB.10C2) ──
  // Optional so existing callers that build a result literal (UI fallbacks, older
  // test doubles) keep compiling; the core always populates them.
  /** Companies dropped by the shared mandatory gate (never reached duplicate check). */
  hardExcludedByGateCount?: number;
  /** Persisted candidates that got a STRONG official-source identity (typed columns filled). */
  enrichedWithOfficialSourceCount?: number;
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
  /** Empresas descartadas por identidad ya vista (páginas Y ramas). */
  crossBranchDuplicatesRemoved?: number;
  /** Filas crudas del proveedor acumuladas en toda la corrida. */
  rawResultsTotal?: number;
  /** Por qué la corrida dejó de pedir. */
  stopReason?: LushaRunStopReason;
  /** Telemetría completa de corrida + ramas (§§ 18/19). Sin PII. */
  multiBranch?: LushaRunTelemetry;
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
export { normalizeLushaCompanyName };

function employeesLabel(company: LushaPreviewCompany): string | null {
  if (typeof company.employeesExact === 'number') return String(company.employeesExact);
  if (company.employeesMin !== null || company.employeesMax !== null) {
    return `${company.employeesMin ?? '?'}-${company.employeesMax ?? '?'}`;
  }
  return null;
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
 * Build the provider-neutral search criteria for the gate + enrichment from the
 * wizard input and the server-authoritative request summary. `minEmployees` is the
 * requested size-band minimum (the same band the preview already filtered by), so
 * the gate's `known_employee_count_below_min` check enforces the requested floor.
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
    sector: rs.sector ?? input.sectorKey ?? null,
    minEmployees: rs.sizeBand?.min ?? null,
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

/** Strong active matches are SKIPPED before insert (canonical writer behavior). */
export function isStrongActiveGuardMatch(match: DuplicateGuardMatch): boolean {
  return (
    match.matched &&
    (match.reason === 'same_active_domain' || match.reason === 'same_inferred_identity')
  );
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

/** True for the checker statuses that mean a confirmed (exact) match. */
function isExactCheckerStatus(status: DuplicateMatch['status']): boolean {
  return status === 'existing_in_sellup' || status === 'existing_in_hubspot';
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

  for (const m of dupResult.matches) {
    if (m.source !== 'sellup' && m.source !== 'hubspot') continue;
    const exact = isExactCheckerStatus(m.status);
    const possible = m.status === 'possible_duplicate';
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

  // Active-candidate canonical match contributes a possible-duplicate source.
  if (guardMatch.matched && guardMatch.reason === 'same_canonical_identity') {
    const detail: LushaDuplicateDetailSource = {
      source: 'active_candidate',
      matchType: classifyActiveGuardMatchType(guardMatch.reason),
      strength: 'possible',
    };
    if (guardMatch.matchedName) detail.matchedName = guardMatch.matchedName;
    if (guardMatch.matchedDomain) detail.matchedDomain = guardMatch.matchedDomain;
    if (guardMatch.matchedCandidateId) detail.matchedCandidateId = guardMatch.matchedCandidateId;
    detail.reason = 'Mismo nombre normalizado que un candidato activo';
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
  const sellupMatches = dupResult.matches.filter((m) => m.source === 'sellup');
  const hubspotMatches = dupResult.matches.filter((m) => m.source === 'hubspot');

  const sellupExact = sellupMatches.find((m) => m.status === 'existing_in_sellup') ?? null;
  const sellupPossible = sellupMatches.find((m) => m.status === 'possible_duplicate') ?? null;
  const hubspotExact = hubspotMatches.find((m) => m.status === 'existing_in_hubspot') ?? null;
  const hubspotPossible = hubspotMatches.find((m) => m.status === 'possible_duplicate') ?? null;

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

  const activeCanonical =
    guardMatch.matched && guardMatch.reason === 'same_canonical_identity';
  const activeCandidateDuplicateCheck: ActiveCandidateDuplicateCheckTrace = activeCanonical
    ? 'performed_possible_duplicate'
    : 'performed_no_match';

  const dbDuplicateStatus: LushaDbDuplicateStatus =
    sellupExact || hubspotExact
      ? 'exact_duplicate'
      : sellupPossible || hubspotPossible || activeCanonical
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

/** Aggregate top-up + duplicate-classification metrics for the batch summary. */
export interface LushaPendingReviewBatchMetrics {
  pagesRequested: number;
  creditsChargedTotal: number | null;
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
export function buildLushaPendingReviewBatchRow(
  input: LushaPreviewInput,
  actor: PersistLushaPendingReviewActor,
  search: LushaPreviewResult,
  persistedCount: number,
  metrics: LushaPendingReviewBatchMetrics,
): LushaPendingReviewBatchRow {
  const rs = search.requestSummary;
  const sectorLabel = rs.sector ?? input.sectorKey;
  const countryLabel = rs.country ?? input.countryCode;
  const excludedExactDuplicates = metrics.excludedExactDuplicates ?? [];
  const excludedByMandatoryGate = metrics.excludedByMandatoryGate ?? [];

  return {
    name: `Búsqueda con IA · ${sectorLabel} · ${countryLabel}`,
    country: rs.country ?? null,
    country_code: input.countryCode ?? null,
    industry: rs.sector ?? null,
    target_count: persistedCount,
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
        sector_key: rs.sectorKey,
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

/** Build candidate insert rows from resolved companies (post duplicate parity). */
export function buildLushaPendingReviewCandidateRows(
  batchId: string,
  resolved: ResolvedLushaCandidate[],
): LushaPendingReviewCandidateRow[] {
  return resolved.map(({ company, resolution, enriched, gateWarnings }) => {
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
 * Run the shared, provider-agnostic intake pipeline for every deduped company:
 *
 *   map (shared Lusha adapter) → normalize → mandatory gate
 *     → hard_excluded companies are separated and NEVER reach the duplicate check
 *     → reviewable companies go through official-source enrichment (injected,
 *       read-only resolvers) then the canonical active-candidate guard + duplicate
 *       check, with any STRONG official-source taxIdentifier/legalName threaded in.
 *
 * Strong active matches are skipped (returned via `guardSkippedCount`), matching
 * the canonical writer. Purely orchestrates injected read-only deps — no I/O of
 * its own. Returns the reviewable resolutions plus bounded gate + enrichment
 * summaries for the batch metadata.
 */
export async function resolveLushaCandidatesDuplicateState(
  deps: Pick<
    PersistLushaPendingReviewDeps,
    'checkCompanyDuplicate' | 'fetchActiveCandidates' | 'officialSourceResolvers'
  >,
  input: LushaPreviewInput,
  companies: LushaPreviewCompany[],
  criteria: ProspectSearchCriteria,
): Promise<{
  resolved: ResolvedLushaCandidate[];
  guardSkippedCount: number;
  hardExcluded: LushaGateAuditEntry[];
  gate: LushaGateSummary;
  enrichment: LushaOfficialSourceEnrichmentSummary;
}> {
  const resolvers = deps.officialSourceResolvers ?? [];

  // ── 1. Map → normalize → mandatory gate. Hard-excluded never reach dup check. ──
  const reviewable: Array<{
    company: LushaPreviewCompany;
    normalized: NormalizedProspectCandidate;
    gate: ProspectIntakeGateResult;
  }> = [];
  const hardExcluded: LushaGateAuditEntry[] = [];
  const gate = emptyGateSummary();

  for (const company of companies) {
    const discovered = lushaPreviewCompanyToProviderDiscoveredCompany(company, criteria);
    const normalized = normalizeProviderDiscoveredCompany(discovered, criteria);
    const gateResult = evaluateProspectIntakeGate(normalized, criteria);

    for (const reason of [...gateResult.hardReasons, ...gateResult.warnings]) {
      gate.reasonCounts[reason] = (gate.reasonCounts[reason] ?? 0) + 1;
    }

    if (gateResult.decision === 'hard_excluded') {
      gate.hardExcludedCount++;
      hardExcluded.push(buildProspectIntakeGateAuditEntry(normalized, gateResult));
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

  // ── 3. Per reviewable company: official-source enrichment → active guard →
  //       duplicate check (with the strong official identity threaded in). ──
  const resolved: ResolvedLushaCandidate[] = [];
  let guardSkippedCount = 0;
  const enrichment = emptyEnrichmentSummary();

  for (const { company, normalized, gate: gateResult } of reviewable) {
    // Official-source enrichment (fail_soft by default). Resolvers are injected +
    // read-only; with none, this yields the shared unsupported/unavailable result.
    const enriched = await enrichNormalizedProspectWithOfficialSources(
      normalized,
      criteria,
      resolvers,
    );
    tallyEnrichmentStatus(enrichment, enriched.officialSource.status);

    const guardMatch = checkActiveCandidateDuplicate(
      buildLushaGuardInput(company),
      activeCandidates,
    );

    // Strong active match → skip, exactly like the canonical writer.
    if (isStrongActiveGuardMatch(guardMatch)) {
      guardSkippedCount++;
      continue;
    }

    const dupResult = await deps.checkCompanyDuplicate(
      buildLushaDuplicateCheckInput(company, input, enriched),
    );
    const resolution = resolveLushaCandidateDuplicateState(dupResult, guardMatch);
    resolved.push({ company, resolution, enriched, gateWarnings: gateResult.warnings });
  }

  return { resolved, guardSkippedCount, hardExcluded, gate, enrichment };
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
  /** Sólo telemetría: cuánto reservó el llamador, para que el lote lo registre. */
  creditsReserved?: number | null;
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
  const providerRequestsAllowed = resolveLushaProviderRequestsAllowed(branches.length);
  const expectedMaxCredits = branches.length * LUSHA_PENDING_REVIEW_EXPECTED_MAX_CREDITS;

  // § 10/§ 11 — UN registro de identidad para todas las páginas de todas las ramas.
  let identityRegistry: LushaRunIdentityRegistry = createLushaRunIdentityRegistry();
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
  const gateSummary = emptyGateSummary();
  const enrichmentSummary = emptyEnrichmentSummary();
  let skippedActiveDuplicatesCount = 0;
  let skippedUnusableCount = 0;
  let crossBranchDuplicatesRemoved = 0;
  const duplicateReasonCounts: Record<LushaIdentityDuplicateReason, number> = {
    provider_company_id: 0,
    normalized_domain: 0,
    normalized_linkedin_url: 0,
    normalized_name_fallback: 0,
  };
  let creditsChargedTotal: number | null = null;
  let resultsReturnedTotal: number | null = null;
  let providerRequestsUsed = 0;
  let firstSearch: LushaPreviewResult | null = null;
  const branchTelemetry: LushaBranchTelemetry[] = [];
  let stopReason: LushaRunStopReason = 'branches_exhausted';
  let runStopped = false;
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
    const remainingGapBefore = resolveLushaRemainingGap(targetGap, useful.length);

    // § 4 — objetivo cerrado ⇒ las ramas restantes NO se piden. Quedan en la
    // telemetría como `not_attempted` para que se vea que existían y se omitieron.
    if (runStopped || remainingGapBefore <= 0) {
      if (!runStopped) stopReason = 'target_reached';
      runStopped = true;
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

    for (let page = 0; page < LUSHA_PENDING_REVIEW_MAX_PAGES; page++) {
      // § 6/§ 16/§ 17 — la decisión de pedir es explícita y de ámbito de corrida.
      // No se delega a la cota de los bucles: ver la cabecera del módulo de
      // política.
      const decision = decideLushaProviderRequest({
        remainingGap: resolveLushaRemainingGap(targetGap, useful.length),
        providerRequestsUsed,
        providerRequestsAllowed,
        rawResultsTotal,
      });
      if (!decision.allowed) {
        stopReason = decision.stopReason;
        runStopped = true;
        if (decision.stopReason === 'target_reached' && page > 0) {
          branchOutcome = 'target_reached';
        }
        break;
      }

      const search = await deps.runSearch({
        ...input,
        page,
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
      });
      providerRequestsUsed++;
      branchProviderRequests++;
      branchPagesAttempted++;
      if (firstSearch === null) firstSearch = search;

      const pageCredits = search.billing?.creditsCharged ?? null;
      creditsChargedTotal = addCredits(creditsChargedTotal, pageCredits);
      branchCredits = addCredits(branchCredits, pageCredits);
      if (typeof search.billing?.resultsReturned === 'number') {
        resultsReturnedTotal = (resultsReturnedTotal ?? 0) + search.billing.resultsReturned;
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

      const dedupe = dedupeLushaCompaniesByIdentity(search.results ?? [], identityRegistry);
      identityRegistry = dedupe.registry;
      skippedUnusableCount += dedupe.unusableCount;
      crossBranchDuplicatesRemoved += dedupe.duplicateCount;
      branchDuplicatesRemoved += dedupe.duplicateCount;
      for (const reason of Object.keys(duplicateReasonCounts) as LushaIdentityDuplicateReason[]) {
        duplicateReasonCounts[reason] += dedupe.duplicateReasonCounts[reason];
      }
      normalizedCount += dedupe.unique.length;
      branchUniqueResults += dedupe.unique.length;

      // Provider-neutral criteria for the shared gate + enrichment. Built from the
      // (server-authoritative) request summary; stable across pages.
      const criteria = buildLushaProspectSearchCriteria(input, search);

      const { resolved, guardSkippedCount, hardExcluded, gate, enrichment } =
        await resolveLushaCandidatesDuplicateState(deps, input, dedupe.unique, criteria);
      skippedActiveDuplicatesCount += guardSkippedCount;

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

      for (const candidate of resolved) {
        if (candidate.resolution.dbDuplicateStatus === 'exact_duplicate') {
          // Exact duplicates are excluded from persistence — never reviewable.
          // We keep a safe, auditable detail record (Q3F-5BB.7D).
          excludedExactDuplicates.push(buildLushaExcludedExactDuplicate(candidate));
        } else {
          // § 12 — AQUÍ, y sólo aquí, una empresa cierra hueco.
          useful.push(candidate);
        }
      }

      // § 16 — el proveedor no ofrece continuación si esta página vino vacía:
      // pedir la siguiente pagaría una petición para releer el mismo vacío.
      if (pageRaw === 0) break;
    }

    const remainingGapAfter = resolveLushaRemainingGap(targetGap, useful.length);
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
    });
  }

  // Error duro: la primera petición falló y no hay nada que conservar.
  if (hardFailure !== null) return hardFailure;

  const remainingGapFinal = resolveLushaRemainingGap(targetGap, useful.length);
  if (remainingGapFinal <= 0 && !runStopped) stopReason = 'target_reached';
  // El techo y el agotamiento de ramas COINCIDEN cuando cada rama gastó todas sus
  // páginas: los bucles terminan solos y nadie llega a rechazar una petición. Con
  // el hueco todavía abierto, lo que paró la corrida fue el techo —no la falta de
  // ramas— y reportarlo como `branches_exhausted` escondería que hubo recorte.
  if (
    stopReason === 'branches_exhausted' &&
    remainingGapFinal > 0 &&
    providerRequestsUsed >= providerRequestsAllowed
  ) {
    stopReason = 'request_cap_reached';
  }
  // «Sin resultados» sólo cuando el proveedor no devolvió NI UNA fila: es distinto
  // de «devolvió y todo era duplicado», que ya se explica con los conteos.
  if (rawResultsTotal === 0 && stopReason === 'branches_exhausted') {
    stopReason = 'no_results';
  }

  const pagesRequested = providerRequestsUsed;

  const excludedExactDuplicatesCount = excludedExactDuplicates.length;
  // `skippedCount` conserva su significado de siempre: todo lo que el proveedor
  // devolvió y no llegó a candidato por identidad — filas impersistibles,
  // duplicados de identidad (antes «duplicados de dominio/nombre») y descartes
  // fuertes del guard de activos. Dejar fuera los duplicados de identidad habría
  // hecho que la UI dijera «0 omitidas» tras descartar la mitad de la página.
  const totalSkipped =
    skippedUnusableCount + crossBranchDuplicatesRemoved + skippedActiveDuplicatesCount;
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
    maxRawResults: LUSHA_RUN_MAX_RAW_RESULTS,
    rawResultsTotal,
    crossBranchDuplicatesRemoved,
    duplicateReasonCounts,
    uniqueResultsTotal: normalizedCount,
    usefulResultsTotal: useful.length,
    remainingGapFinal,
    creditsReserved: execution?.creditsReserved ?? null,
    creditsReportedActual: creditsChargedTotal,
    stopReason,
    branches: branchTelemetry,
  };

  const baseMetrics = {
    pagesRequested,
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
    rawResultsTotal,
    stopReason,
    multiBranch: runTelemetry,
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
    useful.length,
    {
      pagesRequested,
      creditsChargedTotal,
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
  const { id: batchId } = await deps.insertBatch(batchRowWithRouting);

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
  const { insertedCount } = await deps.insertCandidates(candidateRowsWithRouting);

  return {
    ok: true,
    status: 'success',
    batchId,
    createdCandidatesCount: insertedCount,
    skippedCount: totalSkipped,
    creditsCharged: creditsChargedTotal,
    resultsReturned: resultsReturnedTotal,
    reviewUrl: LUSHA_PENDING_REVIEW_URL,
    message: `Encontramos ${insertedCount} ${insertedCount === 1 ? 'empresa candidata' : 'empresas candidatas'} para revisar.`,
    ...baseMetrics,
    usefulCandidatesCount: useful.length,
    insertedCandidatesCount: insertedCount,
  };
}
