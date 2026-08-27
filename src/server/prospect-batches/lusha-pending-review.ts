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
  canAcceptLushaUsefulCandidate,
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
  type LushaIdentityDuplicateReason,
  type LushaRunIdentityRegistry,
} from './lusha-run-identity-registry';
import type { LushaMacroSearchPlan } from './lusha-macro-search-plan';
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
  type IcpSizeGateResult,
} from '@/server/agents/prospecting-toolkit/icp-size-gate';

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
  /** Empresas descartadas por identidad ya vista (páginas Y ramas). */
  crossBranchDuplicatesRemoved?: number;
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
    rawResultsTotal: 0,
    reviewableFoundTotal: input.createdCandidatesCount,
    targetOverflowDiscarded: 0,
    precisionRejectedTotal: 0,
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
export { normalizeLushaCompanyName };

function employeesLabel(company: LushaPreviewCompany): string | null {
  if (typeof company.employeesExact === 'number') return String(company.employeesExact);
  if (company.employeesMin !== null || company.employeesMax !== null) {
    return `${company.employeesMin ?? '?'}-${company.employeesMax ?? '?'}`;
  }
  return null;
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
 * persistencia sería un segundo gate de admisión sin QA, y queda como seguimiento
 * explícito.
 */
export function buildLushaIcpSizeGate(company: LushaPreviewCompany): IcpSizeGateResult {
  return evaluateIcpSizeGate({
    employeeCount: typeof company.employeesExact === 'number' ? company.employeesExact : null,
    sizeRange: employeesLabel(company),
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
    sector: rs.sector ?? input.macroIndustryKey ?? null,
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
  return resolved.map(({ company, resolution, enriched, gateWarnings, branchProvenance, macroPrecision }) => {
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
  // § 5 — la macro contra la que se juzga la precisión. `null` = ruta legacy de un
  // sector, donde no hay macro industria y el comportamiento es el de hoy.
  const macroKeyForPrecision = plan?.macroKey ?? null;
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
  // §§ 2/3 — los tres desenlaces NUEVOS de una empresa revisable, contados aparte
  // de todo lo de dedupe: precisión, sobrante de objetivo y aceptación.
  let precisionRejectedTotal = 0;
  let targetOverflowDiscarded = 0;
  let reviewableFoundTotal = 0;
  const precisionReasonCounts: Record<string, number> = {};
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
  // § 17/§ 20 — páginas que NO se compraron porque su rama vino sin novedad.
  // Hecho observado; nunca un ahorro estimado.
  let pagesSkippedZeroNovelty = 0;
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
    let branchTargetOverflow = 0;

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
          continue;
        }

        // § 5 — la precisión sólo gobierna la ruta MODERNA. Sin `plan.macroKey`
        // no hay macro industria contra la que juzgar, y la corrida legacy de un
        // sector se comporta exactamente como hoy. Ausencia = comportamiento
        // actual, no una degradación silenciosa.
        if (macroKeyForPrecision !== null) {
          const precision = assessLushaMacroPrecision({
            macroIndustryKey: macroKeyForPrecision,
            branch,
            branchIndex,
            declaredIndustry: candidate.company.industry,
          });
          precisionReasonCounts[precision.reason] =
            (precisionReasonCounts[precision.reason] ?? 0) + 1;
          if (!isLushaMacroPrecisionAdmitted(precision)) {
            // NO cierra hueco, NO se persiste, y NO cuenta como duplicado.
            precisionRejectedTotal++;
            branchPrecisionRejected++;
            continue;
          }
          reviewableFoundTotal++;
          // § 2 — el tope de ACEPTACIÓN. El de peticiones ya paró de pedir; éste
          // impide rebasar el objetivo dentro de una página ya pagada.
          if (!canAcceptLushaUsefulCandidate(targetGap, useful.length)) {
            targetOverflowDiscarded++;
            branchTargetOverflow++;
            continue;
          }
          // § 12 — AQUÍ, y sólo aquí, una empresa cierra hueco.
          useful.push({ ...candidate, branchProvenance, macroPrecision: precision });
          continue;
        }

        reviewableFoundTotal++;
        if (!canAcceptLushaUsefulCandidate(targetGap, useful.length)) {
          targetOverflowDiscarded++;
          branchTargetOverflow++;
          continue;
        }
        useful.push(candidate);
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
        if (remainingPages > 0) pagesSkippedZeroNovelty += remainingPages;
        break;
      }
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
  // AGENT1-CUT3B23 § 1 — el motivo de parada NO puede seguir afirmando que el
  // objetivo se cumplió cuando la admisión de identidad acaba de reabrir el hueco.
  //
  // 🔴 La corrida pudo pararse con `target_reached` DENTRO del bucle (`runStopped`),
  // y entonces ninguna de las reglas de arriba lo revisa. Ésta sí, y contra el
  // hueco POST-admisión: `target_reached` con hueco > 0 es un informe imposible.
  // No se reutiliza `request_cap_reached` —el techo puede no haberse tocado— ni
  // `branches_exhausted`: la causa es la deduplicación posterior, y se nombra.
  if (stopReason === 'target_reached' && remainingGapFinal > 0) {
    stopReason = 'post_admission_identity_gap';
  }

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
  const totalSkipped =
    skippedUnusableCount +
    crossBranchDuplicatesRemoved +
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
    pagesSkippedZeroNovelty,
    maxRawResults: LUSHA_RUN_MAX_RAW_RESULTS,
    rawResultsTotal,
    crossBranchDuplicatesRemoved,
    duplicateReasonCounts,
    uniqueResultsTotal: normalizedCount,
    usefulResultsTotal: useful.length,
    reviewableFoundTotal,
    acceptedForTargetTotal: useful.length,
    targetOverflowDiscarded,
    precisionRejectedTotal,
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
    reviewableFoundTotal,
    targetOverflowDiscarded,
    precisionRejectedTotal,
    multiBranch: runTelemetry,
    batchIdentityDuplicateSkippedCount,
    batchIdentityMetrics,
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
  const persistedForTarget = Math.min(insertedCount, useful.length);
  const remainingGapPersisted = resolveLushaRemainingGap(targetGap, persistedForTarget);
  // Mismo principio que arriba: `target_reached` con hueco abierto es imposible.
  // Aquí la causa no es la deduplicación sino la escritura, y se nombra distinto.
  const stopReasonPersisted: LushaRunStopReason =
    stopReason === 'target_reached' && remainingGapPersisted > 0
      ? 'post_admission_persistence_gap'
      : stopReason;
  const runTelemetryPersisted: LushaRunTelemetry = {
    ...runTelemetry,
    acceptedForTargetTotal: persistedForTarget,
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
          completeValidCandidates: persistedForTarget,
          // Esta ruta no distingue «sólo para revisión»: todo lo que persiste es
          // revisable. `null` = no medido, que es la verdad, y NUNCA un cero que
          // afirmaría haberlo medido.
          reviewOnlyCandidates: null,
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
        tallyBatchIdentityPersisted(batchIdentityAdmission.counters, persistedForTarget),
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
  };
}
