/**
 * Candidate Writer — Hito 5
 *
 * Persiste el output de runProspectingPipeline() en:
 *   - prospect_batches  (1 lote por llamada)
 *   - prospect_candidates (uno por candidato elegible)
 *   - prospect_candidate_audit (batch_created + candidate_created)
 *
 * NO crea accounts.
 * NO escribe en HubSpot.
 * NO llama Apollo ni Lusha.
 * NO llama ningún proveedor IA.
 * Usa service role key para escribir sin sesión de usuario.
 */

import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runProspectingPipeline } from "./prospecting-pipeline";
import { buildNoveltyIndex, evaluateCandidateNovelty, buildRecentIdentityKeySet } from "./novelty-checker";
import { buildCanonicalCompanyIdentity } from "./canonical-company-identity";
// ADAPTIVE-EARLY-STOP §§ 3, 4 y 5 — los gates deterministas, el comparador de
// ranking, la dedupe intra-lote y el orden del cupo viven fuera de este archivo
// para que el evaluador PRE-writer invoque LAS MISMAS funciones, no una copia.
import {
  isContentPageUrl,
  isContentPageName,
  isDirectorySourceDomain,
  mapQualityLabelToStatus,
  extractDomain,
  normalizeName,
  compareWriterEligibleRank,
  selectIntraBatchIdentityWinnerIndexes,
  orderByCompleteFirst,
} from "./candidate-writer-pure-gates";
import { buildProspectCandidateIdentityKey } from "./prospect-candidate-identity-key";
import { evaluateCountryCompatibility, countryCompatibilityRankWeight } from "./country-compatibility";
import { classifySourceUrlQuality, isBlockedBySourceUrlQuality } from "./source-url-quality-gate";
import { evaluateBusinessFit, isBlockedByBusinessFit } from "./business-fit-gate";
import type { BusinessFitResult } from "./business-fit-gate";
import { evaluateExternalPlatformGate } from "./external-platform-blocklist";
import { evaluateContentIntermediaryGate } from "./content-intermediary-gate";
import { evaluateCompanyOwnership, isBlockedByCompanyOwnership } from "./company-ownership-gate";
import { normalizeProspectCompanyName } from "./company-name-normalizer";
import { evaluateCountryEvidence } from "./country-evidence-gate";
import type { CountryEvidenceResult } from "./country-evidence-gate";
import { computeEvidencePersistencePolicy } from "./evidence-persistence-policy";
import { checkActiveCandidateDuplicate } from "./active-candidate-identity-guard";
import { buildLinkedInEnrichmentMetadata } from "./linkedin-company-enrichment";
import {
  runControlledLinkedInCompanySearch,
  DEFAULT_LINKEDIN_SEARCH_CONFIG,
} from "./linkedin-company-search";
import {
  runWebsiteLinkedInExtraction,
} from "./linkedin-website-social-extractor";
import type { WebsiteExtractionBatchSummary } from "./linkedin-website-social-extractor";
import type {
  LinkedInSearchConfig,
  LinkedInSearchProviderFn,
  LinkedInBatchSearchMetadata,
  ControlledLinkedInSearchCandidate,
  LinkedInUsageContext,
  LinkedInUsageLoggerFn,
} from "./linkedin-company-search";
import type { ActiveCandidateRecord, DuplicateGuardInput } from "./active-candidate-identity-guard";
import type {
  CandidateWriterInput,
  CandidateWriterOutput,
  CandidateWriterSkipped,
  DuplicateStatus,
  ProspectingPipelineCandidate,
  ProspectingPipelineInput,
  ProspectingPipelineOutput,
  ProspectingPipelineWriteOutput,
} from "./types";
import {
  buildCandidateRichProfileV1,
  refreshCandidateRichProfileWithEffectiveTruth,
} from "./candidate-rich-profile";
// CANDIDATE-OPERABILITY-VALIDATION-1 §§ A, D, E, F.
import {
  CANDIDATE_RECORD_ORIGIN_METADATA_KEY,
  resolveCandidateRecordOriginForWriter,
  toCandidateRecordOriginColumns,
  toCandidateRecordOriginMetadata,
} from "./candidate-record-origin";
import {
  describeLinkedinAvailability,
  LINKEDIN_AVAILABILITY_METADATA_KEY,
  reconcileScoringForLinkedinAvailability,
  toLinkedinAvailabilityMetadata,
} from "./candidate-linkedin-availability";
import { resolveCanonicalCandidateName } from "./resolve-canonical-candidate-name";
import type { CanonicalCandidateNameResolution } from "./resolve-canonical-candidate-name";
import {
  runRichProfileEnrichmentBatch,
  mergeRichProfileEnrichmentResult,
} from './rich-profile-enrichment';
import {
  evaluateIcpSizeGate,
  resolveIcpSizeGateWriterAction,
} from './icp-size-gate';
import type { IcpSizeGateBatchSummary } from './icp-size-gate';
import {
  resolveEmployeeSizeForIcpGate,
  extractHubSpotMatchedEmployees,
  extractCandidateCompanySize,
} from './employee-size-resolver';
import {
  toCompanyLinkedInMetadataBlock,
  toCompanyEmployeeCountMetadataBlock,
} from './apollo-company-fields-mapping';
import type {
  ApolloCompanyFieldsCapture,
  CompanyFieldMappingStatus,
} from './apollo-company-fields-mapping';
import {
  buildCompanyLinkedInTrace,
  buildEmployeeCountTrace,
} from './apollo-company-fields-mapping';
import {
  evaluateCandidateSubindustryTargetEligibility,
  buildCandidateCompletenessCounters,
  resolveCandidateStatusForCompleteness,
  INCOMPLETE_CANDIDATE_REVIEW_FLAG,
  CANDIDATE_TARGET_METRICS_METADATA_KEY,
} from './candidate-completeness-contract';
import type { CandidateCanonicalTargetEligibility as CandidateTargetEligibility } from './candidate-completeness-contract';
import type {
  RichProfileEnrichmentConfig,
  RichProfileEnrichmentProviderFn,
  RichProfileEnrichmentBatchMetadata,
  RichProfileEnrichmentUsagePayload,
  RichProfileEnrichmentUsageLoggerFn,
  RichProfileEnrichmentProviderResult,
} from './rich-profile-enrichment';
// Q3F-5BB.11F.1 — Apollo batch provider_attempts[] (observational, additive).
// Q3F-5BB.11F.2 — Apollo per-candidate provider_trace + source_trace (additive).
import {
  BATCH_PROVIDER_ROUTING_KEY,
  mergeProviderAttemptsBatchMetadata,
  mergeCandidateProviderMetadata,
} from '@/modules/prospect-batches/provider-routing';
import {
  shouldEmitApolloBatchProviderAttempts,
  buildApolloBatchProviderAttempt,
  buildApolloCandidateProviderTrace,
  APOLLO_PROVIDER_USAGE_KEY,
  APOLLO_ORGANIZATIONS_OPERATION_KEY,
} from './provider-routing-attempts';
// A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 §§ 1, 4, 6 y 7 — verdad de la
// persistencia, datos del enrichment en columnas, desglose de descartes por
// motivo real y sellado terminal del lote.
import { reconcileApolloTwoRoundPersistedTruth } from './apollo-persisted-candidate-truth';
import {
  buildCandidateSkipBreakdown,
  toCandidateSkipBreakdownMetadata,
} from './candidate-skip-reason-taxonomy';
import {
  APOLLO_ENRICHMENT_PERSISTENCE_METADATA_KEY,
  toApolloEnrichmentCandidateColumns,
  toApolloEnrichmentPersistenceMetadata,
} from './apollo-enrichment-persistence-capture';
import { decideBatchCompletionSeal } from './batch-completion-seal';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from './apollo-two-round/observability';
// A1-APOLLO-PERSISTENCE-READINESS-4 § 7 — clasificación sanitizada del fallo de
// escritura y estado de lote coherente con el resultado real de la persistencia.
import {
  DURABLE_PROSPECT_CANDIDATE_STATUSES,
  NO_PRE_EXISTING_DURABLE_CANDIDATES,
  durableCandidatesFromCount,
  resolveBatchDurableTotals,
  resolveBatchTerminalStatusDecision,
  type DurableCandidateKnowledge,
} from '@/server/prospect-batches/batch-durable-candidates';
// AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-2 — dueño de cada campo del lote.
import {
  resolveAdoptedBatchPatch,
  type ExistingAdoptedBatchRow,
} from '@/server/prospect-batches/adopted-batch-truth';
import {
  classifyCandidatePersistenceError,
  resolvePersistenceStatus,
  toCandidatePersistenceOutcomeMetadata,
  CANDIDATE_PERSISTENCE_OUTCOME_METADATA_KEY,
  type CandidatePersistenceOutcome,
  type PersistenceErrorCode,
  type PersistenceErrorStage,
} from './prospect-candidate-persistence-readiness';
import {
  CANDIDATE_PERSISTENCE_FAILED_AUDIT_ACTION,
  classifyCandidateInsertFailureKind,
  extractDatabaseErrorDiagnostics,
  toCandidatePersistenceFailureAuditDetails,
  type DatabaseErrorDiagnostics,
} from './candidate-persistence-failure-audit';

// ─── Resultado de la persistencia ─────────────────────────────────────────────

/**
 * A1-APOLLO-PERSISTENCE-READINESS-4 § 7 — constructor único del resultado de
 * persistencia del writer.
 *
 * Existe para que ninguno de los caminos de salida del writer pueda olvidar las
 * cifras: un `return` sin ellas es exactamente cómo un fallo de escritura acabó
 * siendo indistinguible de un vacío normal.
 *
 * `persistenceFailed` NO se deriva de «cero guardados»: cero guardados es el
 * resultado legítimo de una corrida cuyos candidatos se descartaron a propósito.
 * Se deriva de que hubiera al menos un fallo REAL de escritura.
 */
function buildPersistenceOutcome(input: {
  eligibleBeforePersistence: number;
  persistedCandidates: number;
  failures: readonly { code: PersistenceErrorCode; stage: PersistenceErrorStage }[];
  attemptedCount?: number;
  /**
   * FORENSICS-1 § 4 y § 7 — cifras que la UI necesita para explicar un éxito
   * parcial. Ausentes en los caminos que no recorrieron el bucle de escritura:
   * ahí no se midieron, y `undefined` lo dice sin fingir un cero.
   */
  lateDuplicateCount?: number;
  completeValidCandidates?: number;
  reviewOnlyCandidates?: number;
}): CandidatePersistenceOutcome {
  const failureCount = input.failures.length;
  // Con varios fallos se reporta el PRIMER código: es el que explica la corrida,
  // y una columna ausente produce el mismo error en todas las filas.
  const first = input.failures[0] ?? null;
  // Los intentos que no se pasan explícitamente se reconstruyen: guardados más
  // fallidos. Nunca menos que los guardados.
  const attempted = input.attemptedCount ?? input.persistedCandidates + failureCount;
  return {
    eligibleBeforePersistence: input.eligibleBeforePersistence,
    persistedCandidates: input.persistedCandidates,
    persistenceFailureCount: failureCount,
    persistenceFailed: failureCount > 0,
    persistenceErrorCode: first?.code ?? null,
    persistenceErrorStage: first?.stage ?? null,
    persistenceStatus: resolvePersistenceStatus({
      succeededCount: input.persistedCandidates,
      failedCount: failureCount,
    }),
    persistenceAttemptedCount: attempted,
    persistenceSucceededCount: input.persistedCandidates,
    persistenceFailedCount: failureCount,
    persistenceGap: Math.max(0, attempted - input.persistedCandidates),
    ...(input.lateDuplicateCount !== undefined
      ? { lateDuplicateCount: input.lateDuplicateCount }
      : {}),
    ...(input.completeValidCandidates !== undefined
      ? { completeValidCandidates: input.completeValidCandidates }
      : {}),
    ...(input.reviewOnlyCandidates !== undefined
      ? { reviewOnlyCandidates: input.reviewOnlyCandidates }
      : {}),
  };
}

/**
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-1 § 7 — verdad del LOTE, no sólo
 * del contribuyente.
 *
 * Lee cuántas filas durables contiene ya el lote que se va a ADOPTAR, ANTES de
 * que este escritor inserte nada. Ese momento es el que hace que el total sea
 * una suma y no un doble conteo (§ 8).
 *
 * Es un conteo ACOTADO: `head: true` no trae ni una fila, así que no viaja
 * ningún dato personal ni payload de candidato. Cero llamadas a proveedor, cero
 * créditos, cero escrituras.
 *
 * Fail-closed en su lectura: un error o un `count` ausente devuelven «no se
 * pudo determinar», que NO es lo mismo que cero (§ 10) y que aguas abajo impide
 * escribir un estado terminal inventado.
 */
async function probePreExistingDurableCandidates(
  admin: SupabaseClient,
  batchId: string,
): Promise<DurableCandidateKnowledge> {
  try {
    const { count, error } = await admin
      .from("prospect_candidates")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batchId)
      .in("status", [...DURABLE_PROSPECT_CANDIDATE_STATUSES]);

    if (error) return { known: false, reason: "read_failed" };
    return durableCandidatesFromCount(count);
  } catch {
    return { known: false, reason: "read_failed" };
  }
}

/** Resultado de persistencia de un camino que no escribió candidatos. */
function emptyPersistenceOutcome(eligibleBeforePersistence = 0): CandidatePersistenceOutcome {
  return buildPersistenceOutcome({
    eligibleBeforePersistence,
    persistedCandidates: 0,
    failures: [],
  });
}

// ─── Batch validation error ───────────────────────────────────────────────────

/**
 * Thrown when existingBatchId is provided but fails validation.
 * Callers can inspect `code` to distinguish the failure reason.
 * No writes have occurred when this is thrown.
 */
export class CandidateWriterBatchValidationError extends Error {
  constructor(
    public readonly code:
      | 'BATCH_NOT_FOUND'
      | 'BATCH_WRONG_OWNER'
      | 'BATCH_INCOMPATIBLE_SOURCE'
      | 'BATCH_INCOMPATIBLE_STATUS',
    message: string,
  ) {
    super(message);
    this.name = 'CandidateWriterBatchValidationError';
  }
}

/** States that allow a batch to receive pipeline results. */
const BATCH_STATES_ACCEPTING_RESULTS: string[] = ['draft', 'generating'];

// ─── Admin client ─────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials not configured");
  return createAdminClient(url, key);
}

// ─── Gates deterministas del writer ───────────────────────────────────────────
//
// ADAPTIVE-EARLY-STOP § 3 — el gate de página de contenido, el de dominio de
// directorio, la profundidad de path y el mapeo de etiqueta de calidad vivían
// aquí como funciones privadas de este archivo. Ahora viven en
// `candidate-writer-pure-gates.ts`, sin un cambio de comportamiento, porque el
// evaluador PRE-writer tiene que invocar LAS MISMAS y no una copia.
//
// Se re-exportan `isContentPageUrl` / `isContentPageName` porque ya eran API
// pública de este módulo (`precision-gate.test.ts` las importa desde aquí).

export {
  isContentPageUrl,
  isContentPageName,
} from './candidate-writer-pure-gates';

// ─── Active duplicate guard — prefetch helper ─────────────────────────────────

const ACTIVE_STATUSES_FOR_GUARD = [
  'needs_review', 'approved', 'converted', 'ready_for_review',
  'draft', 'generating', 'pending', 'active', 'ready', 'in_progress',
];

/**
 * Estado observable del prefetch del Active Duplicate Guard (Q3F-5AW.2 Phase 1).
 *
 *   - 'ok'       → el prefetch corrió sin errores (aunque haya 0 filas).
 *   - 'degraded' → el prefetch falló/degradó y el guard opera fail-open con []
 *                  (menor cobertura). Se deja observable en metadata; NO bloquea.
 */
export type ActiveCandidateGuardStatus = 'ok' | 'degraded';

/** Motivo de la degradación del prefetch, cuando aplica. */
export type ActiveCandidateGuardReason = 'prefetch_failed' | 'query_error' | null;

export interface ActiveCandidateGuardPrefetch {
  records: ActiveCandidateRecord[];
  status: ActiveCandidateGuardStatus;
  reason: ActiveCandidateGuardReason;
}

/**
 * Carga candidatos activos relevantes desde Supabase para el Active Duplicate Guard.
 *
 * Hace dos consultas acotadas:
 *   1. Por dominio exacto (para detectar same_active_domain cross-country)
 *   2. Por country_code (para detectar same_inferred_identity dentro del país)
 *
 * Diseñado para degradar de forma segura (fail-open) si la query falla o si el
 * cliente no soporta el método (e.g., fake admin en tests): retorna records=[]
 * y, a diferencia de antes, señala status='degraded' + reason para que el fallo
 * quede OBSERVABLE en metadata (Q3F-5AW.2 Phase 1). El comportamiento funcional
 * es idéntico al anterior: el guard sigue tolerando la degradación sin bloquear.
 */
export async function fetchActiveCandidatesForGuard(
  admin: SupabaseClient,
  batchDomains: string[],
  countryCode: string | null,
): Promise<ActiveCandidateGuardPrefetch> {
  try {
    const result: ActiveCandidateRecord[] = [];
    const seenIds = new Set<string>();
    let sawQueryError = false;

    function mapRow(row: Record<string, unknown>): ActiveCandidateRecord {
      const meta = (row['metadata'] ?? {}) as Record<string, unknown>;
      const ir = (meta['identity_resolution'] ?? {}) as Record<string, unknown>;
      return {
        id: row['id'] as string,
        name: row['name'] as string,
        domain: (row['domain'] as string | null) ?? null,
        normalizedName: (row['normalized_name'] as string | null) ?? null,
        inferredCompanyName: (ir['inferred_company_name'] as string | null) ?? null,
        status: row['status'] as string,
      };
    }

    // Primary: by domain (catches same_active_domain globally, cross-country)
    if (batchDomains.length > 0) {
      const { data: byDomain, error: byDomainError } = await (admin as ReturnType<typeof import('@supabase/supabase-js').createClient>)
        .from('prospect_candidates')
        .select('id, name, domain, normalized_name, metadata, status')
        .in('status', ACTIVE_STATUSES_FOR_GUARD)
        .in('domain', batchDomains)
        .limit(500);

      if (byDomainError) sawQueryError = true;
      if (Array.isArray(byDomain)) {
        for (const row of byDomain as Record<string, unknown>[]) {
          const rec = mapRow(row);
          if (!seenIds.has(rec.id)) {
            seenIds.add(rec.id);
            result.push(rec);
          }
        }
      }
    }

    // Secondary: by country (catches same_inferred_identity within country, bounded)
    if (countryCode) {
      const { data: byCountry, error: byCountryError } = await (admin as ReturnType<typeof import('@supabase/supabase-js').createClient>)
        .from('prospect_candidates')
        .select('id, name, domain, normalized_name, metadata, status')
        .in('status', ACTIVE_STATUSES_FOR_GUARD)
        .eq('country_code', countryCode)
        .limit(500);

      if (byCountryError) sawQueryError = true;
      if (Array.isArray(byCountry)) {
        for (const row of byCountry as Record<string, unknown>[]) {
          const rec = mapRow(row);
          if (!seenIds.has(rec.id)) {
            seenIds.add(rec.id);
            result.push(rec);
          }
        }
      }
    }

    if (sawQueryError) {
      return { records: result, status: 'degraded', reason: 'query_error' };
    }
    return { records: result, status: 'ok', reason: null };
  } catch {
    // Non-critical: guard degrades gracefully (fail-open) if prefetch throws.
    return { records: [], status: 'degraded', reason: 'prefetch_failed' };
  }
}

// ─── Mapeos ───────────────────────────────────────────────────────────────────

/**
 * Mapea DuplicateStatus del toolkit al duplicate_status del schema DB.
 * El toolkit usa valores distintos a los del schema de Supabase.
 */
/**
 * STABLE-TARGET-WRITER-PARITY § 9 — exportada para que el orquestador lea el
 * MISMO `duplicate_status` que se persistirá, en vez de deducirlo.
 *
 * Deducirlo era exactamente lo que producía la divergencia: el orquestador sabía
 * «hay duplicado conocido» y el writer escribía un valor de un vocabulario que
 * el orquestador no conocía.
 */
export function mapDuplicateStatus(status: DuplicateStatus): string {
  switch (status) {
    case "new_candidate":
      return "no_match";
    case "existing_in_sellup":
      return "exact_duplicate";
    case "existing_in_hubspot":
      return "exact_duplicate";
    case "possible_duplicate":
      return "possible_duplicate";
    case "insufficient_data":
      return "insufficient_data";
    case "unchecked":
      return "unchecked";
    case "error":
      return "unchecked";
    default:
      return "unchecked";
  }
}

// Mapea qualityLabel del scorer al status de prospect_candidates y retorna null
// para labels que deben omitirse (`discard`): ver `mapQualityLabelToStatus` en
// `candidate-writer-pure-gates.ts`. ADAPTIVE-EARLY-STOP § 3 — movido allí, sin
// cambios, para que el evaluador PRE-writer resuelva `quality_label_discard` con
// la MISMA función.

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidUuid(val: string | null | undefined): boolean {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

/**
 * A1-APOLLO-LINKEDIN-EMPLOYEES-1 — captura de respaldo cuando la ruta Apollo
 * entrega un candidato SIN los campos del proveedor.
 *
 * No es una ausencia del proveedor: es que la captura no llegó hasta aquí. Se
 * etiqueta `mapping_failed` para que el diagnóstico apunte adentro, no a Apollo.
 */
const MAPPING_FAILED_COMPANY_FIELDS: ApolloCompanyFieldsCapture = {
  linkedin: {
    companyLinkedInUrl: null,
    status: 'mapping_failed',
    sourceProvider: 'apollo',
    sourceOperation: null,
    observedAt: null,
    rawValue: null,
    reason: 'provider_company_fields_absent_from_candidate',
  },
  employeeCount: {
    employeeCount: null,
    status: 'mapping_failed',
    sourceProvider: 'apollo',
    sourceOperation: null,
    observedAt: null,
    rawValue: null,
    reason: 'provider_company_fields_absent_from_candidate',
  },
};

/**
 * True cuando el error del insert es exactamente «la columna `linkedin_url` no
 * existe».
 *
 * Mismo criterio estricto que `isMissingProviderUsageCorrelationColumnError`: el
 * código de error Y el nombre de la columna en el mensaje. Cualquier otro fallo
 * es un fallo de verdad y debe propagarse.
 */
export function isMissingLinkedInUrlColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const isSchemaCodeMatch = code === '42703' || code === 'PGRST204';
  if (!isSchemaCodeMatch) return false;
  return typeof message === 'string' && message.includes('linkedin_url');
}

/**
 * Construye el metadata del candidato.
 * No incluye HTML completo ni tokens/secretos.
 * snippet truncado a 300 chars.
 * Incluye llm_evaluation si el candidato fue generado por el evaluador LLM (Hito 16H).
 */
function buildCandidateMetadata(
  candidate: ProspectingPipelineCandidate
): Record<string, unknown> {
  const { websiteVerification, duplicateCheck, scoring } = candidate;

  return {
    generated_by: "agent_1_candidate_writer",
    source_url: candidate.sourceUrl,
    source_title: candidate.sourceTitle ?? null,
    inferred_name_source: candidate.inferredNameSource ?? null,
    source_snippet: candidate.sourceSnippet?.slice(0, 300) ?? null,
    ...(candidate.searchTrace ? { search_trace: candidate.searchTrace } : {}),
    ...(candidate.llmEvaluation
      ? { llm_evaluation: candidate.llmEvaluation }
      : {}),
    website_verification: websiteVerification
      ? {
          status: websiteVerification.status,
          confidence: websiteVerification.confidence,
          domain: websiteVerification.domain,
          redirected: websiteVerification.redirected,
          http_status: websiteVerification.httpStatus,
          skipped: websiteVerification.skipped,
          skip_reason: websiteVerification.skipReason ?? null,
        }
      : null,
    duplicate_check: duplicateCheck
      ? {
          status: duplicateCheck.status,
          confidence: duplicateCheck.confidence,
          sources_checked: duplicateCheck.checkedSources,
          summary: duplicateCheck.summary,
          matches: duplicateCheck.matches.map((m) => ({
            source: m.source,
            status: m.status,
            confidence: m.confidence,
            matched_name: m.matchedName ?? null,
            matched_domain: m.matchedDomain ?? null,
            matched_website: m.matchedWebsite ?? null,
            matched_id: m.matchedId ?? null,
            reason: m.reason,
          })),
        }
      : null,
    scoring: {
      confidence_score: scoring.confidenceScore,
      fit_score: scoring.fitScore,
      data_completeness: scoring.dataCompletenessScore,
      quality_label: scoring.qualityLabel,
      recommended_action: scoring.recommendedAction,
      reasons: scoring.reasons,
      warnings: scoring.warnings,
      blockers: scoring.blockers,
      fit_breakdown: scoring.fitBreakdown ?? null,
    },
  };
}

// ─── Función principal ────────────────────────────────────────────────────────

export type LinkedInSearchOverride = {
  config: LinkedInSearchConfig;
  providerFn?: LinkedInSearchProviderFn;
  /** Contexto de trazabilidad para usage logging (v1.15.7). */
  usageContext?: LinkedInUsageContext;
  /** Logger inyectable por llamada real al provider (v1.15.7). En prod: escribe a provider_usage_logs. */
  usageLoggerFn?: LinkedInUsageLoggerFn;
  /**
   * Costo por crédito Tavily resuelto desde provider_pricing_config (v1.16K-R-B).
   * Se inyecta en el usageContext por defecto que arma el writer (que aporta el
   * batchId real). null = pricing no disponible → el orchestrator bloquea las
   * llamadas reales con skipped_reason='missing_pricing' (nunca registra $0).
   * Ignorado si usageContext se provee explícitamente (ese contexto ya lo lleva).
   */
  unitCostUsd?: number | null;
};

export type RichProfileEnrichmentOverride = {
  config: RichProfileEnrichmentConfig;
  providerFn: RichProfileEnrichmentProviderFn;
  /** Costo por query del provider (0 para mock). Requerido para Tavily real. */
  unitCostUsd?: number;
  /** Logger para usage payloads. Requerido para Tavily real con dryRun=false. */
  usageLoggerFn?: RichProfileEnrichmentUsageLoggerFn;
};

/**
 * Q3F-5BB.11F.1 — Reconcile Apollo COMPANY-discovery credit spend for a batch
 * from `provider_usage_logs`, filtered STRICTLY to
 * `provider_key='apollo'` + `operation_key='organizations_search'`. This
 * structurally excludes phone reveal (`person_phone_reveal`), organization
 * enrichment (`organization_enrichment`), and any contact-enrichment rows.
 *
 * Fail-soft & conservative: returns the summed `credits_used` of matching rows
 * with a numeric credit value; returns `null` (NEVER 0) when the query errors,
 * no matching rows exist, or no row carries a numeric credit — "unknown" is
 * never reported as a real 0 spend. Reads only; never writes.
 */
export async function reconcileApolloOrganizationsCredits(
  admin: SupabaseClient,
  batchId: string,
): Promise<number | null> {
  try {
    const { data, error } = await admin
      .from('provider_usage_logs')
      .select('credits_used')
      .eq('batch_id', batchId)
      .eq('provider_key', APOLLO_PROVIDER_USAGE_KEY)
      .eq('operation_key', APOLLO_ORGANIZATIONS_OPERATION_KEY);

    if (error || !Array.isArray(data) || data.length === 0) return null;

    let total = 0;
    let sawNumericCredit = false;
    for (const row of data) {
      const credits = (row as { credits_used?: unknown }).credits_used;
      if (typeof credits === 'number' && Number.isFinite(credits)) {
        total += credits;
        sawNumericCredit = true;
      }
    }
    return sawNumericCredit ? total : null;
  } catch {
    // Non-critical: reconciliation failure must never affect the writer result.
    return null;
  }
}

export async function writeProspectingCandidates(
  input: CandidateWriterInput,
  // For testing only: inject an admin client instead of reading env vars.
  // Production callers always omit this parameter.
  adminClientOverride?: SupabaseClient,
  // For testing only: override LinkedIn search config and provider.
  // Production callers always omit this parameter (feature disabled by default).
  linkedInSearchOverride?: LinkedInSearchOverride,
  // For testing only: override Rich Profile enrichment config and provider (v1.16E).
  // Production callers always omit this parameter (feature disabled by default).
  richProfileEnrichmentOverride?: RichProfileEnrichmentOverride,
): Promise<CandidateWriterOutput> {
  const { pipelineOutput, triggeredByUserId, ownerId, batchName, source, dryRun, extraBatchMetadata, existingBatchId } = input;
  const isDryRun = dryRun ?? false;

  // Guard: sin candidatos
  if (!pipelineOutput.candidates || pipelineOutput.candidates.length === 0) {
    if (!existingBatchId) {
      return {
        dryRun: isDryRun,
        batchId: null,
        candidatesCreated: 0,
        candidatesSkipped: 0,
        createdCandidateIds: [],
        skipped: [],
        status: isDryRun ? "dry_run" : "failed",
        errors: ["El pipeline no retornó candidatos para persistir"],
        persistence: emptyPersistenceOutcome(),
      };
    }
    // With existingBatchId (wizard path), proceed through batch metadata update
    // so gate metadata, tavily reconciliation, and adaptive discovery are persisted
    // even when no candidates were generated.
    // The rest of the function handles 0 candidates gracefully:
    // - batch is updated (Path A)
    // - gate loop produces zeroed-out summary metadata
    // - post-loop block writes final metadata including tavily_usage_reconciliation
  }

  // ── Dry run ───────────────────────────────────────────────────────────────
  if (isDryRun) {
    const skipped: CandidateWriterSkipped[] = [];

    for (const candidate of pipelineOutput.candidates) {
      const status = mapQualityLabelToStatus(candidate.scoring.qualityLabel);
      if (status === null) {
        skipped.push({ name: candidate.name, reason: "qualityLabel=discard", searchTrace: candidate.searchTrace ?? undefined });
      }
    }

    return {
      dryRun: true,
      batchId: null,
      candidatesCreated: 0,
      candidatesSkipped: skipped.length,
      createdCandidateIds: [],
      skipped,
      status: "dry_run",
      errors: [],
      // Una corrida en seco no escribe: no puede fallar al escribir.
      persistence: emptyPersistenceOutcome(
        pipelineOutput.candidates.length - skipped.length,
      ),
    };
  }

  // ── Write real ────────────────────────────────────────────────────────────
  const admin = adminClientOverride ?? getAdminClient();
  const errors: string[] = [];
  const createdCandidateIds: string[] = [];
  const skipped: CandidateWriterSkipped[] = [];
  // A1-APOLLO-PERSISTENCE-READINESS-4 § 7 — fallos REALES de escritura, separados
  // de los descartes intencionales. Antes compartían la lista `skipped` y el
  // fallo terminaba clasificado como «ni historial ni calidad», es decir, como
  // nada.
  const persistenceFailures: { code: PersistenceErrorCode; stage: PersistenceErrorStage }[] = [];
  /** Candidatos que llegaron a intentar el INSERT (elegibles tras todas las puertas). */
  let insertAttempts = 0;
  /** § 4 — duplicados que sólo aparecieron al chocar con un índice único. */
  let lateDuplicateCount = 0;

  /**
   * § 8 — el fallo de un candidato queda auditado aunque no exista su fila.
   *
   * `prospect_candidate_audit.candidate_id` es nullable, así que el registro se
   * ancla al lote. La auditoría nunca puede tumbar la corrida: si ella misma
   * falla, el writer sigue y el resultado del lote no cambia.
   */
  const recordCandidatePersistenceFailure = async (input: {
    diagnostics: DatabaseErrorDiagnostics;
    errorCode: PersistenceErrorCode;
    name: string;
    domain: string | null;
    identityKey: string | null;
    countryCode: string | null;
  }): Promise<void> => {
    try {
      await admin.from('prospect_candidate_audit').insert({
        batch_id: batchId,
        candidate_id: null,
        actor_user_id: triggeredByUserId ?? null,
        action_type: CANDIDATE_PERSISTENCE_FAILED_AUDIT_ACTION,
        details: toCandidatePersistenceFailureAuditDetails({
          stage: 'candidate_insert',
          errorCode: input.errorCode,
          diagnostics: input.diagnostics,
          companyName: input.name,
          normalizedDomain: input.domain,
          identityKey: input.identityKey,
          countryCode: input.countryCode,
          occurredAt: new Date().toISOString(),
        }),
      });
    } catch {
      // Un fallo de auditoría no puede convertirse en un fallo de la corrida.
    }
  };
  /**
   * A1-APOLLO-LINKEDIN-EMPLOYEES-1 § 5 — completitud de cada candidato REALMENTE
   * escrito. Alimenta los contadores separados: persistidos ≠ completos.
   */
  const completenessEligibilities: CandidateTargetEligibility[] = [];
  /**
   * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 § E — completitud de TODAS las
   * filas escritas, incluidas las que no traen campos de proveedor.
   *
   * `completenessEligibilities` sólo acumula las que tienen `providerCompanyFields`
   * porque alimenta un bloque de metadata sobre esos campos. El recuento canónico
   * de la corrida no puede excluir a nadie: una fila sin campos de proveedor es,
   * por definición, una fila incompleta, y omitirla inflaría `target_count`.
   */
  const persistedTargetEligibilities: CandidateTargetEligibility[] = [];
  /** Inserts que tuvieron que reintentarse porque la columna `linkedin_url` no existe. */
  let linkedInColumnFallbackCount = 0;

  // Novelty index: carga candidatos históricos para los dominios del lote actual
  // en un solo SELECT antes de crear el batch. No hace writes.
  const candidateDomains = pipelineOutput.candidates.map(
    (c) => c.domain ?? extractDomain(c.website)
  );
  const noveltyIndex = await buildNoveltyIndex(admin, candidateDomains);

  // Identity key index: carga identity keys de candidatos recientes para
  // deduplicar semánticamente ("Siesa Enterprise" vs "Siesa"). Hito 16AB.43.25.
  const recentIdentityKeys = await buildRecentIdentityKeySet(admin);

  const now = new Date();
  const { country, countryCode, industry } = pipelineOutput.input;

  const finalBatchName =
    batchName ??
    `Agente 1 · Pipeline · ${country} · ${industry} · ${now.toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })}`;

  const batchSource = source === "mock" || source === "web_search" ? "agent_1" : (source ?? "agent_1");

  const pipelineMeta = pipelineOutput.metadata as Record<string, unknown>;
  const isMockRun = pipelineMeta?.provider === "mock";
  /**
   * Ruta de descubrimiento de EMPRESAS por Apollo. Es la única en la que el
   * contrato de LinkedIn / número de empleados aplica: en las demás no hay payload
   * de Apollo que mapear, y marcarlas como «el proveedor no lo devolvió» sería
   * afirmar algo sobre un proveedor al que no se le preguntó.
   */
  const isApolloCompanyDiscoveryPath = pipelineMeta?.provider === "apollo_organizations";

  /**
   * CUT-2 § 8 — el bloque OBSERVACIONAL que este escritor produce por sí mismo.
   *
   * Se separa de `extraBatchMetadata` a propósito. `extraBatchMetadata` es
   * PASO A TRAVÉS: lo rellena el llamador y hoy transporta claves que NO son
   * del escritor (`run_provider_selection` y `apollo_discovery_taxonomy` las
   * escribe también la reserva del wizard, y la de la reserva es más rica).
   * Tratar todo el objeto como «propio» era exactamente lo que permitía que un
   * contribuyente pisara verdad ajena al adoptar.
   *
   * Sobre un lote adoptado, sólo las claves de ESTE literal pueden actualizarse.
   */
  const writerOwnedBatchMetadata: Record<string, unknown> = {
    generated_by: "agent_1_candidate_writer",
    pipeline_version: pipelineMeta?.pipelineVersion ?? "unknown",
    pipeline_summary: {
      requested: pipelineOutput.summary.requested,
      returned: pipelineOutput.summary.returned,
      high_quality_new: pipelineOutput.summary.highQualityNew,
      needs_review: pipelineOutput.summary.needsReview,
      duplicates: pipelineOutput.summary.duplicates,
      insufficient_data: pipelineOutput.summary.insufficientData,
      discarded: pipelineOutput.summary.discarded,
    },
    web_search_provider: pipelineMeta?.provider ?? "unknown",
    search_depth: pipelineMeta?.searchDepth ?? "standard",
    search_mode: pipelineMeta?.search_mode ?? "single_query",
    catalog_sources:
      pipelineOutput.catalogContext?.recommendedSources?.map((s) => s.key) ?? [],
    warnings: pipelineOutput.warnings ?? [],
    generated_at: pipelineMeta?.executedAt ?? now.toISOString(),
    dry_run: false,
    ...(pipelineMeta?.search_mode === "multi_query"
      ? {
          query_version: pipelineMeta.query_version ?? null,
          queries_executed: pipelineMeta.queries_executed ?? null,
          raw_results_count: pipelineMeta.raw_results_count ?? null,
          deduped_results_count: pipelineMeta.deduped_results_count ?? null,
          filtered_out_count: pipelineMeta.filtered_out_count ?? null,
          kept_count: pipelineMeta.kept_count ?? null,
          max_results_per_query: pipelineMeta.max_results_per_query ?? null,
        }
      : {}),
    ...(pipelineMeta?.query_trace_summary
      ? { query_trace_summary: pipelineMeta.query_trace_summary }
      : {}),
    ...(isMockRun
      ? {
          generation_mode: "mock",
          warning: "Datos de prueba. No convertir a empresas reales.",
        }
      : {}),
  };

  /**
   * Forma final IDÉNTICA a la anterior a CUT-2: el paso a través se esparce al
   * final, así que un lote NUEVO recibe byte a byte la misma metadata que antes.
   * Lo único que cambia es que ahora se sabe qué mitad es del escritor.
   */
  const batchMetadata: Record<string, unknown> = {
    ...writerOwnedBatchMetadata,
    ...(extraBatchMetadata ?? {}),
  };

  /** Claves cuyo dueño es este escritor — dato, no lista duplicada. */
  const writerOwnedBatchMetadataKeys = Object.keys(writerOwnedBatchMetadata);

  // ── Resolve or create batch ───────────────────────────────────────────────
  // preMergedMetadata: metadata used for the batch row and later for the
  // post-loop update. When reusing an existing batch, it merges the
  // previously-stored wizard metadata (preserved) with the pipeline metadata
  // (added). When creating a new batch it is identical to batchMetadata.
  let batchId: string;
  let preMergedMetadata: Record<string, unknown> = batchMetadata;
  /**
   * § 7 — marca de cierre que el lote YA tenía. Un lote nuevo no tiene ninguna, y
   * uno reutilizado sólo se acepta en `draft` / `generating`, que tampoco la
   * tienen; se lee de todos modos para que el sellado nunca pise una existente.
   */
  let existingCompletedAt: string | null = null;

  /**
   * CUT-1 § 7 — filas durables que el lote ya contenía ANTES de este escritor.
   *
   * Un lote NUEVO (path B) no puede contener nada: es cero CONOCIDO y no cuesta
   * ni una lectura. Un lote ADOPTADO (path A) sí puede traer contenido —por
   * ejemplo las filas gratuitas de una corrida mixta— y hay que preguntárselo a
   * la base antes de insertar.
   */
  let preExistingDurableCandidates: DurableCandidateKnowledge =
    NO_PRE_EXISTING_DURABLE_CANDIDATES;

  /**
   * CUT-1 CORRECTION § 3/§ 4 — estado que el lote ADOPTADO tenía al llegar aquí.
   *
   * Se guarda para dos cosas y sólo dos: poder auditar la transición REAL cuando
   * por fin se escriba un estado terminal, y poder decir de qué estado se venía.
   * Un lote NUEVO no tiene ninguno (`null`): su creación ya la cuenta
   * `batch_created`, y una transición desde «no existía» no es una transición.
   */
  let adoptedBatchPreviousStatus: string | null = null;

  if (existingBatchId) {
    // ── Path A: reuse an existing batch ────────────────────────────────────
    // Validate then UPDATE; throw CandidateWriterBatchValidationError before
    // any write if the batch is not eligible.

    const { data: existingBatch, error: selectError } = await admin
      .from("prospect_batches")
      .select(
        // § 7 — `completed_at` se LEE para poder respetar una marca previa: una
        // corrida deja de avanzar una sola vez, y dos cierres no pueden dar
        // instantes distintos.
        // CUT-2 § 3/§ 4 — las seis columnas de identidad global se LEEN antes de
        // adoptar. Sin leerlas no se puede saber cuáles ya tenían verdad, y sin
        // saberlo la única política posible es «gana el último que escribe»,
        // que es justo el defecto.
        "id, status, source, created_by, owner_id, metadata, client_request_id, completed_at, name, country, country_code, industry, target_count, search_depth",
      )
      .eq("id", existingBatchId)
      .single();

    if (selectError || !existingBatch) {
      throw new CandidateWriterBatchValidationError(
        "BATCH_NOT_FOUND",
        `Batch ${existingBatchId} not found or inaccessible.`,
      );
    }

    // Ownership: accept if created_by matches triggeredByUserId OR owner_id matches ownerId
    const ownerMatches =
      (triggeredByUserId != null && existingBatch.created_by === triggeredByUserId) ||
      (ownerId != null && existingBatch.owner_id === ownerId);
    if (!ownerMatches) {
      throw new CandidateWriterBatchValidationError(
        "BATCH_WRONG_OWNER",
        `Batch ${existingBatchId} does not belong to the requesting user.`,
      );
    }

    // Source: must be agent_1 (this pipeline's type)
    if (existingBatch.source !== "agent_1") {
      throw new CandidateWriterBatchValidationError(
        "BATCH_INCOMPATIBLE_SOURCE",
        `Batch ${existingBatchId} has source '${existingBatch.source}', expected 'agent_1'.`,
      );
    }

    // Status: only draft or generating can receive pipeline results
    if (!BATCH_STATES_ACCEPTING_RESULTS.includes(existingBatch.status)) {
      throw new CandidateWriterBatchValidationError(
        "BATCH_INCOMPATIBLE_STATUS",
        `Batch ${existingBatchId} has status '${existingBatch.status}', which cannot receive pipeline results.`,
      );
    }

    existingCompletedAt =
      typeof (existingBatch as { completed_at?: unknown }).completed_at === 'string'
        ? ((existingBatch as { completed_at?: string }).completed_at ?? null)
        : null;
    // CUT-2 § 8/§ 10 — la fusión de metadata deja de ser un `spread` en el que
    // gana el contribuyente actual, y el PATCH de ADOPCIÓN se construye por un
    // camino PROPIO en vez de recortar el payload de creación. Los dos tienen
    // dueños distintos: sobre un lote nuevo el escritor es el dueño de la
    // identidad de la petición; sobre uno adoptado, no.
    //
    // El comentario que había aquí afirmaba que las claves del wizard y las del
    // pipeline «no se solapan, así que un spread superficial es suficiente y
    // seguro». Era falso en dos claves REALES, y no por un futuro hipotético:
    // `run_provider_selection` y `apollo_discovery_taxonomy` las escribe también
    // la reserva del wizard y vuelven a llegar aquí por `extraBatchMetadata`. En
    // `apollo_discovery_taxonomy` la de la reserva es un SUPERCONJUNTO —lleva
    // además `macro_industry_key`, `macro_industry_display_name` y
    // `requested_subindustries`— así que el spread la degradaba a la versión
    // pobre en cada adopción.
    const adoptedBatchTruth = resolveAdoptedBatchPatch({
      existingBatch: existingBatch as ExistingAdoptedBatchRow,
      incoming: {
        name: finalBatchName,
        country,
        country_code: countryCode,
        industry,
        target_count: pipelineOutput.summary.requested,
        search_depth: pipelineOutput.input.searchDepth ?? "standard",
        metadata: batchMetadata,
        contributorOwnedMetadataKeys: writerOwnedBatchMetadataKeys,
      },
    });
    preMergedMetadata = adoptedBatchTruth.metadata;

    // UPDATE the existing batch with the resolved adoption patch.
    // created_by, owner_id, client_request_id and created_at are NOT touched.
    //
    // CUT-1 CORRECTION § 2 — 🔴 `status` NO viaja en esta escritura, y es el
    // punto entero de esta corrección.
    //
    // Antes esta UPDATE ponía `ready_for_review` AQUÍ, antes de sondear qué
    // contenía el lote y antes de intentar un solo INSERT. Con eso, la decisión
    // `preserve` de § 10 —«no se pudo determinar el contenido, no se inventa
    // ningún estado terminal»— no conservaba el estado del lote: conservaba un
    // `ready_for_review` que esta misma línea acababa de FABRICAR. Un lote en
    // `generating` con la sonda ilegible y 0 inserciones terminaba anunciado
    // como revisable sin que nadie hubiera podido comprobar que hubiera algo
    // dentro. El contrato decía «unknown durable count ⇒ no terminal status is
    // invented» y la implementación lo incumplía una escritura antes.
    //
    // El estado terminal lo decide una sola autoridad, la finalización (§ 3),
    // cuando ya se conocen las tres verdades: lo que el lote traía, lo que este
    // contribuyente insertó y qué falló. Omitir la columna deja intacto el
    // `draft` / `generating` que la fila ya tenía.
    //
    // CUT-2 § 4/§ 5 — y de los campos de la petición (nombre, país, industria,
    // objetivo, profundidad) sólo viajan los que la fila NO tenía todavía. El
    // objetivo es el caso que más duele: con hueco mixto —10 pedidos, 7 gratis,
    // 3 de pago— este contribuyente llega con `requested = 3`, y escribirlo
    // encima convertiría un lote completo en un lote que dice haber pedido tres.
    const { error: updateError } = await admin
      .from("prospect_batches")
      .update(adoptedBatchTruth.patch)
      .eq("id", existingBatchId);

    if (updateError) {
      return {
        dryRun: false,
        batchId: null,
        candidatesCreated: 0,
        candidatesSkipped: pipelineOutput.candidates.length,
        createdCandidateIds: [],
        skipped: pipelineOutput.candidates.map((c) => ({
          name: c.name,
          reason: "batch_update_failed",
          searchTrace: c.searchTrace ?? undefined,
        })),
        status: "failed",
        // § 7 — código sanitizado, no el mensaje del motor: este texto viaja
        // hacia arriba y puede terminar en metadata persistida.
        errors: [`Error al actualizar lote existente: ${classifyCandidatePersistenceError(updateError)}`],
        persistence: buildPersistenceOutcome({
          eligibleBeforePersistence: pipelineOutput.candidates.length,
          persistedCandidates: 0,
          failures: [
            {
              code: classifyCandidatePersistenceError(updateError),
              stage: 'batch_update',
            },
          ],
        }),
      };
    }

    batchId = existingBatchId;

    // CUT-1 § 7/§ 8 — la lectura ocurre AQUÍ: el lote ya está validado y adoptado
    // y todavía no se ha intentado ni un INSERT de candidato. Todo lo que cuente
    // esta sonda es, por construcción, anterior a este escritor.
    preExistingDurableCandidates = await probePreExistingDurableCandidates(
      admin,
      batchId,
    );

    // CUT-1 CORRECTION § 4 — aquí NO se audita ninguna transición.
    //
    // Esto emitía `batch_status_changed` con `new_status: 'ready_for_review'`
    // antes de que existiera la decisión, así que dejaba en el historial una
    // transición que podía no haber ocurrido nunca: con la sonda ilegible y 0
    // inserciones, el lote se quedaba (correctamente) donde estaba y la
    // auditoría seguía afirmando que había pasado a revisable.
    //
    // Lo único que se hace es RECORDAR de dónde se venía. La transición se
    // audita una sola vez, en el punto en que el estado terminal se escribe de
    // verdad, y con el estado que realmente se escribió.
    adoptedBatchPreviousStatus = existingBatch.status as string;

  } else {
    // ── Path B: create a new batch (historical behavior — unchanged) ────────

    const { data: batch, error: batchError } = await admin
      .from("prospect_batches")
      .insert({
        name: finalBatchName,
        country,
        country_code: countryCode,
        industry,
        target_count: pipelineOutput.summary.requested,
        search_depth: pipelineOutput.input.searchDepth ?? "standard",
        status: "ready_for_review",
        source: batchSource,
        owner_id: ownerId ?? null,
        created_by: triggeredByUserId ?? null,
        metadata: batchMetadata,
      })
      .select("id")
      .single();

    if (batchError || !batch) {
      return {
        dryRun: false,
        batchId: null,
        candidatesCreated: 0,
        candidatesSkipped: pipelineOutput.candidates.length,
        createdCandidateIds: [],
        skipped: pipelineOutput.candidates.map((c) => ({
          name: c.name,
          reason: "batch_creation_failed",
          searchTrace: c.searchTrace ?? undefined,
        })),
        status: "failed",
        errors: [`Error al crear lote: ${classifyCandidatePersistenceError(batchError)}`],
        persistence: buildPersistenceOutcome({
          eligibleBeforePersistence: pipelineOutput.candidates.length,
          persistedCandidates: 0,
          failures: [
            { code: classifyCandidatePersistenceError(batchError), stage: 'batch_update' },
          ],
        }),
      };
    }

    batchId = batch.id;

    // Auditoría: batch_created
    await admin.from("prospect_candidate_audit").insert({
      batch_id: batchId,
      candidate_id: null,
      actor_user_id: triggeredByUserId ?? null,
      action_type: "batch_created",
      details: {
        name: finalBatchName,
        source: batchSource,
        generated_by: "agent_1_candidate_writer",
      },
    });
  }

  // Canonical identity gate tracking (Hito 16AB.43.25)
  type IdentityGateSample = { name: string; reason: string; matched_identity?: string };
  const identityGate = {
    nonCompanyPhraseCount: 0,
    seenIdentityCount: 0,
    nonOfficialDomainCount: 0,
    samples: [] as IdentityGateSample[],
  };

  // Precision gate tracking (Hito 16AB.43.27 / 16AB.43.28)
  const precisionGate = {
    contentPageCount: 0,
    intraBatchDuplicateCount: 0,
    countryIncompatibleCount: 0,
    genericNameCount: 0,
    targetCapCount: 0,
  };

  // Source URL quality gate tracking (Hito 16AB.43.29)
  type SourceUrlQualitySample = { name: string; reason: string; url: string | null };
  const sourceUrlQualityGate = {
    blockedCount: 0,
    blockedByType: {} as Record<string, number>,
    samples: [] as SourceUrlQualitySample[],
  };

  // Business fit gate tracking (Hito 16AB.43.29)
  type BusinessFitSample = {
    name: string;
    reason: string;
    url: string | null;
    fit: string;
    // v1.16K-K: populated when recall recovery inferred a corporate name from domain
    name_for_fit?: string;
    original_name?: string;
    recall_recovery_applied_for_fit?: boolean;
  };
  const businessFitGateData = {
    rejectedCount: 0,
    lowFitCount: 0,
    mediumFitCount: 0,
    highFitCount: 0,
    samples: [] as BusinessFitSample[],
  };

  // External platform gate tracking (Hito 16AB.43.30)
  type ExternalPlatformSample = { name: string; url: string | null; reason: string; platformType: string };
  const externalPlatformGateData = {
    blockedCount: 0,
    blockedByType: {} as Record<string, number>,
    samples: [] as ExternalPlatformSample[],
  };

  // Company ownership gate tracking (Hito 16AB.43.30)
  type CompanyOwnershipSample = { name: string; url: string | null; reason: string; confidence: string };
  const companyOwnershipGateData = {
    blockedCount: 0,
    lowConfidenceCount: 0,
    samples: [] as CompanyOwnershipSample[],
  };

  // Recall recovery gate tracking (v1.10)
  type RecallRecoverySample = { name: string; inferred_name: string; url: string | null };
  const recallRecoveryGate = {
    domain_inferred_identity_count: 0,
    ownership_recovered_count: 0,
    soft_memory_allowed_count: 0,
    hard_negative_memory_blocked_count: 0,
    samples: [] as RecallRecoverySample[],
  };

  // Subindustrias del contexto del batch (inyectadas desde el wizard a través de extraBatchMetadata).
  const batchSubindustries = (() => {
    const raw = (extraBatchMetadata as Record<string, unknown> | null)?.['subindustries'];
    return Array.isArray(raw) ? (raw as string[]) : [];
  })();
  const batchAdditionalCriteria = (() => {
    const raw = (extraBatchMetadata as Record<string, unknown> | null)?.['additional_criteria'];
    return typeof raw === 'string' ? raw : null;
  })();

  /**
   * AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 3 — subindustrias que la
   * búsqueda PIDIÓ, leídas del request y no de lo que el proveedor alcanzó a
   * evaluar.
   *
   * Es la entrada que permite distinguir «no se pidió subindustria» (la búsqueda
   * sectorial de siempre, que no cambia) de «se pidió y nadie la evaluó» (Tavily,
   * la ruta legacy, o un capture de Apollo sin `precision`). Sin ella el segundo
   * caso caía a `sectorEvidenceState` —el veredicto de INDUSTRIA— y contaba hacia
   * el objetivo sin una sola señal de la subindustria pedida.
   *
   * `pipelineOutput.input.subindustries` manda porque es lo que el pipeline
   * ejecutó; `extraBatchMetadata.subindustries` es el respaldo para las rutas que
   * sólo inyectan el contexto del wizard.
   */
  const requestedSubindustriesForTarget = (() => {
    const fromPipeline = (pipelineOutput.input as { subindustries?: unknown } | null)
      ?.subindustries;
    if (Array.isArray(fromPipeline) && fromPipeline.length > 0) return fromPipeline as string[];
    return batchSubindustries;
  })();

  // Evidence persistence policy gate tracking (Hito v1.5)
  type EvidencePolicySample = { name: string; reason: string; url: string | null };
  const evidencePolicyGateData = {
    blockedCount: 0,
    confidenceCapCount: 0,
    samples: [] as EvidencePolicySample[],
  };

  // Active Duplicate Guard tracking (v1.13.1)
  type DuplicateGuardSample = {
    candidate_name: string;
    candidate_domain: string | null;
    /** v1.14: inferred company name when identity_resolution was applied */
    candidate_inferred_name?: string | null;
    reason: string;
    matched_candidate_id: string;
    matched_name: string;
    matched_domain: string | null;
  };
  const duplicateGuardData = {
    checkedCount: 0,
    skippedCount: 0,
    possibleDuplicateCount: 0,
    samples: [] as DuplicateGuardSample[],
    // Q3F-5AW.2 (Phase 1) — observabilidad del prefetch fail-open del guard.
    prefetchStatus: 'ok' as ActiveCandidateGuardStatus,
    prefetchReason: null as ActiveCandidateGuardReason,
  };

  // ICP size gate batch tracking (v1.16I)
  const icpSizeGateData: {
    passCount: number;
    needsValidationCount: number;
    blockedCount: number;
    blockedReasons: string[];
  } = {
    passCount: 0,
    needsValidationCount: 0,
    blockedCount: 0,
    blockedReasons: [],
  };

  // ── Writer omitted samples — audit trail (v1.16K-K FIX 5) ───────────────────
  type WriterOmittedSample = {
    name: string;
    domain: string | null;
    url: string | null;
    final_skip_reason: string;
    gate: string;
    recall_recovered_name: string | null;
    name_for_fit: string | null;
    query_text: string | null;
    round_number: number | null;
    provider_rank: number | null;
    source_title: string | null;
    source_snippet: string | null;
    pipeline_quality_label: string | null;
    is_recall_recovery_applied: boolean;
    was_identity_in_cooldown: boolean;
    matched_identity_key: string | null;
  };
  const writerOmittedSamples: WriterOmittedSample[] = [];
  const MAX_OMITTED_SAMPLES = 50;

  function captureOmittedSample(
    cand: ProspectingPipelineCandidate,
    domain: string | null | undefined,
    reason: string,
    gate: string,
    opts: {
      recallRecoveredName?: string | null;
      nameForFit?: string | null;
      isRecallRecoveryApplied?: boolean;
      wasIdentityInCooldown?: boolean;
      matchedIdentityKey?: string | null;
    } = {},
  ): void {
    if (writerOmittedSamples.length >= MAX_OMITTED_SAMPLES) return;
    const trace = cand.searchTrace;
    writerOmittedSamples.push({
      name: cand.name,
      domain: domain ?? null,
      url: cand.website ?? null,
      final_skip_reason: reason,
      gate,
      recall_recovered_name: opts.recallRecoveredName ?? null,
      name_for_fit: opts.nameForFit ?? null,
      query_text: trace?.query_text ?? null,
      round_number: trace?.round_number ?? null,
      provider_rank: trace?.provider_rank ?? null,
      source_title: cand.sourceTitle ?? null,
      source_snippet: cand.sourceSnippet ?? null,
      pipeline_quality_label: cand.scoring.qualityLabel,
      is_recall_recovery_applied: opts.isRecallRecoveryApplied ?? false,
      was_identity_in_cooldown: opts.wasIdentityInCooldown ?? false,
      matched_identity_key: opts.matchedIdentityKey ?? null,
    });
  }

  // ── Pass 1: evaluate all candidates through gates → collect eligible ────────
  type IdentityResolutionMeta = {
    original_detected_name: string;
    inferred_company_name: string;
    identity_source: 'domain_inferred';
    reason: string;
    ownership_gate_decision: string;
    warning: string;
  };

  type EligibleEntry = {
    candidate: ProspectingPipelineCandidate;
    candidateStatus: string;
    domain: string | null;
    countryCompatWeight: number;
    noveltyResult: ReturnType<typeof evaluateCandidateNovelty>;
    identityKey: string | null;
    sourceUrlRankingBonus: number;
    businessFitRankingBonus: number;
    countryEvidenceResult: CountryEvidenceResult;
    businessFitResult: BusinessFitResult;
    /** v1.10: Metadatos de resolución de identidad cuando el nombre fue inferido desde dominio. */
    identityResolution: IdentityResolutionMeta | null;
    /** v1.16K-L: Resolución del nombre canónico final del candidato. */
    canonicalNameResolution: CanonicalCandidateNameResolution;
  };
  const eligibleEntries: EligibleEntry[] = [];

  for (const candidate of pipelineOutput.candidates) {
    const candidateStatus = mapQualityLabelToStatus(candidate.scoring.qualityLabel);

    if (candidateStatus === null) {
      skipped.push({ name: candidate.name, reason: "qualityLabel=discard", searchTrace: candidate.searchTrace ?? undefined });
      captureOmittedSample(candidate, candidate.domain, "qualityLabel=discard", 'quality_label');
      continue;
    }

    // ── Canonical identity gate (Hito 16AB.43.25 / 16AB.43.27) ─────────────
    const identity = buildCanonicalCompanyIdentity(candidate.name);

    if (identity.isNonCompanyPhrase) {
      skipped.push({ name: candidate.name, reason: "non_company_phrase", searchTrace: candidate.searchTrace ?? undefined });
      identityGate.nonCompanyPhraseCount++;
      if (
        identity.nonCompanyReason === 'page_title_not_company_name' ||
        identity.nonCompanyReason === 'generic_commercial_label'
      ) {
        precisionGate.genericNameCount++;
      }
      if (identityGate.samples.length < 10) {
        identityGate.samples.push({ name: candidate.name, reason: "non_company_phrase" });
      }
      captureOmittedSample(candidate, candidate.domain, "non_company_phrase", 'canonical_identity');
      continue;
    }

    if (identity.identityKey && recentIdentityKeys.has(identity.identityKey)) {
      skipped.push({ name: candidate.name, reason: "seen_identity_key_recently", searchTrace: candidate.searchTrace ?? undefined });
      identityGate.seenIdentityCount++;
      if (identityGate.samples.length < 10) {
        identityGate.samples.push({
          name: candidate.name,
          reason: "seen_identity_key_recently",
          matched_identity: identity.identityKey,
        });
      }
      captureOmittedSample(candidate, candidate.domain, "seen_identity_key_recently", 'canonical_identity', {
        wasIdentityInCooldown: true,
        matchedIdentityKey: identity.identityKey,
      });
      continue;
    }

    const effectiveDomain = candidate.domain ?? extractDomain(candidate.website);
    if (isDirectorySourceDomain(effectiveDomain)) {
      skipped.push({ name: candidate.name, reason: "non_official_source_domain", searchTrace: candidate.searchTrace ?? undefined });
      identityGate.nonOfficialDomainCount++;
      if (identityGate.samples.length < 10) {
        identityGate.samples.push({ name: candidate.name, reason: "non_official_source_domain" });
      }
      captureOmittedSample(candidate, effectiveDomain, "non_official_source_domain", 'canonical_identity');
      continue;
    }

    // ── Country compatibility gate (Hito 16AB.43.27) ─────────────────────────
    const urlToCheck = candidate.website ?? (effectiveDomain ? `https://${effectiveDomain}` : null);
    if (!countryCode) {
      skipped.push({ name: candidate.name, reason: 'missing_country_code', searchTrace: candidate.searchTrace ?? undefined });
      precisionGate.countryIncompatibleCount++;
      captureOmittedSample(candidate, effectiveDomain, 'missing_country_code', 'country_compatibility');
      continue;
    }
    const countryCompat = evaluateCountryCompatibility(urlToCheck, countryCode);
    if (!countryCompat.compatible) {
      skipped.push({ name: candidate.name, reason: `country_incompatible:${countryCompat.reason}`, searchTrace: candidate.searchTrace ?? undefined });
      precisionGate.countryIncompatibleCount++;
      captureOmittedSample(candidate, effectiveDomain, `country_incompatible:${countryCompat.reason}`, 'country_compatibility');
      continue;
    }

    // ── Content-page gate (Hito 16AB.43.28) ──────────────────────────────────
    // Bloquea páginas de contenido/artículo/caso de éxito que no son empresas.
    if (isContentPageUrl(candidate.website) || isContentPageName(candidate.name)) {
      skipped.push({ name: candidate.name, reason: 'content_page', searchTrace: candidate.searchTrace ?? undefined });
      precisionGate.contentPageCount++;
      captureOmittedSample(candidate, effectiveDomain, 'content_page', 'content_page');
      continue;
    }

    // ── Content/intermediary gate (Hito v1.16K-H) ────────────────────────────
    // Bloquea sitios de contenido editorial (blogs) e intermediarios/brokers
    // que no son vendedores directos. Evita que CiberBlog-like candidates
    // lleguen a la tabla de prospectos visibles como needs_review.
    {
      const intermediaryResult = evaluateContentIntermediaryGate({
        name: candidate.name,
        domain: effectiveDomain,
        title: candidate.sourceTitle ?? undefined,
        snippet: candidate.sourceSnippet ?? undefined,
        companySize: typeof candidate.companySize === 'string' ? candidate.companySize : undefined,
      });

      if (intermediaryResult.blocked) {
        const primaryReason = intermediaryResult.reasons[0] ?? 'content_or_intermediary_site';
        skipped.push({
          name: candidate.name,
          reason: primaryReason,
          searchTrace: candidate.searchTrace ?? undefined,
        });
        precisionGate.contentPageCount++;
        captureOmittedSample(candidate, effectiveDomain, primaryReason, 'content_intermediary');
        continue;
      }
    }

    // ── External platform gate (Hito 16AB.43.30) ─────────────────────────────
    // Bloquea fuentes externas: medios editoriales, foros, marketplaces,
    // directorios, sitios de reseñas, redes sociales, glosarios, etc.
    // Se ejecuta ANTES del business-fit gate para que business-fit no pueda
    // "salvar" una fuente externa con buen snippet.
    const externalPlatformResult = evaluateExternalPlatformGate(
      candidate.website ?? (effectiveDomain ? `https://${effectiveDomain}` : null),
      candidate.name,
    );
    if (!externalPlatformResult.allowed) {
      const epReason = `external_platform:${externalPlatformResult.platformType ?? 'unknown'}`;
      skipped.push({
        name: candidate.name,
        reason: epReason,
        searchTrace: candidate.searchTrace ?? undefined,
      });
      externalPlatformGateData.blockedCount++;
      const pt = externalPlatformResult.platformType ?? 'unknown_external_platform';
      externalPlatformGateData.blockedByType[pt] =
        (externalPlatformGateData.blockedByType[pt] ?? 0) + 1;
      if (externalPlatformGateData.samples.length < 10) {
        externalPlatformGateData.samples.push({
          name: candidate.name,
          url: candidate.website ?? null,
          reason: externalPlatformResult.reason ?? 'blocked',
          platformType: pt,
        });
      }
      captureOmittedSample(candidate, effectiveDomain, epReason, 'external_platform');
      continue;
    }

    // ── Company ownership gate (Hito 16AB.43.30 / v1.10 Recall Recovery) ─────
    // Evalúa si el dominio de la URL pertenece oficialmente a la empresa candidata.
    // v1.10: Si Tavily devolvió un título genérico como nombre, se infiere el nombre
    // real desde el dominio antes de evaluar la propiedad.
    const nameNormResult = normalizeProspectCompanyName(
      candidate.name,
      candidate.website ?? candidate.domain ?? undefined,
    );
    const domainInferredForOwnership =
      nameNormResult.normalizationReason === 'seo_phrase_replaced_by_domain';
    const nameForOwnership = domainInferredForOwnership
      ? nameNormResult.name
      : candidate.name;

    // v1.16K-K: Use the domain-inferred corporate name for business fit evaluation
    // when the source returned a generic SEO title (e.g. "Consultoría ERP, CRM, HCM"
    // instead of the real company "Dinámica CD"). This prevents the fit gate from
    // blocking a valid company because its title looks like a service category.
    const nameForFit = domainInferredForOwnership ? nameNormResult.name : candidate.name;

    const companyOwnershipResult = evaluateCompanyOwnership(
      nameForOwnership,
      candidate.website ?? null,
      effectiveDomain,
    );

    // Build identity resolution metadata when domain inference was applied
    const identityResolutionForEntry: IdentityResolutionMeta | null =
      domainInferredForOwnership && !isBlockedByCompanyOwnership(companyOwnershipResult)
        ? {
            original_detected_name: nameNormResult.originalName,
            inferred_company_name: nameNormResult.name,
            identity_source: 'domain_inferred',
            reason: 'detected_name_looked_like_generic_service_title',
            ownership_gate_decision: 'allow_with_domain_inferred_identity',
            warning:
              'Nombre inferido desde dominio porque la fuente devolvió un título genérico.',
          }
        : null;

    if (domainInferredForOwnership && !isBlockedByCompanyOwnership(companyOwnershipResult)) {
      recallRecoveryGate.domain_inferred_identity_count++;
      recallRecoveryGate.ownership_recovered_count++;
      if (recallRecoveryGate.samples.length < 10) {
        recallRecoveryGate.samples.push({
          name: nameNormResult.originalName,
          inferred_name: nameNormResult.name,
          url: candidate.website ?? null,
        });
      }
    }

    if (isBlockedByCompanyOwnership(companyOwnershipResult)) {
      const owReason = `company_ownership:${companyOwnershipResult.confidence}`;
      skipped.push({
        name: candidate.name,
        reason: owReason,
        searchTrace: candidate.searchTrace ?? undefined,
      });
      companyOwnershipGateData.blockedCount++;
      if (companyOwnershipResult.confidence === 'low') {
        companyOwnershipGateData.lowConfidenceCount++;
      }
      if (companyOwnershipGateData.samples.length < 10) {
        companyOwnershipGateData.samples.push({
          name: candidate.name,
          url: candidate.website ?? null,
          reason: companyOwnershipResult.reason,
          confidence: companyOwnershipResult.confidence,
        });
      }
      captureOmittedSample(candidate, effectiveDomain, owReason, 'company_ownership', {
        recallRecoveredName: domainInferredForOwnership ? nameNormResult.name : null,
        nameForFit: nameForFit,
        isRecallRecoveryApplied: domainInferredForOwnership,
      });
      continue;
    }

    // ── Source URL quality gate (Hito 16AB.43.29) ────────────────────────────
    // Bloquea URLs que son artículos, blogs, directorios de partners, registros
    // de partners o páginas genéricas de transformación digital.
    const urlToClassify = candidate.website ?? (effectiveDomain ? `https://${effectiveDomain}` : null);
    const sourceUrlQualityResult = classifySourceUrlQuality(urlToClassify, candidate.name);
    if (isBlockedBySourceUrlQuality(sourceUrlQualityResult)) {
      const urlQualReason = `source_url_quality:${sourceUrlQualityResult.quality}`;
      skipped.push({
        name: candidate.name,
        reason: urlQualReason,
        searchTrace: candidate.searchTrace ?? undefined,
      });
      sourceUrlQualityGate.blockedCount++;
      sourceUrlQualityGate.blockedByType[sourceUrlQualityResult.quality] =
        (sourceUrlQualityGate.blockedByType[sourceUrlQualityResult.quality] ?? 0) + 1;
      precisionGate.contentPageCount++; // contribuye al count de exclusiones de contenido
      if (sourceUrlQualityGate.samples.length < 10) {
        sourceUrlQualityGate.samples.push({
          name: candidate.name,
          reason: sourceUrlQualityResult.reason,
          url: candidate.website ?? null,
        });
      }
      captureOmittedSample(candidate, effectiveDomain, urlQualReason, 'source_url_quality', {
        recallRecoveredName: domainInferredForOwnership ? nameNormResult.name : null,
        nameForFit: nameForFit,
        isRecallRecoveryApplied: domainInferredForOwnership,
      });
      continue;
    }

    // ── Business-fit gate (Hito 16AB.43.29) ──────────────────────────────────
    // Evalúa si el candidato encaja con el segmento B2B SaaS/ERP/CRM/LMS/HR Tech.
    // Bloquea agencias de marketing, BPO/staffing sin producto tech, y candidatos
    // con señales negativas fuertes.
    // v1.16K-K: use nameForFit (domain-inferred when available) instead of raw candidate.name
    const businessFitResult = evaluateBusinessFit({
      name: nameForFit,
      website: candidate.website ?? null,
      domain: effectiveDomain ?? null,
      sourceSnippet: candidate.sourceSnippet ?? null,
      sourceTitle: candidate.sourceTitle ?? null,
      subindustries: batchSubindustries,
      additionalCriteria: batchAdditionalCriteria,
    });

    if (businessFitResult.fit === 'high') {
      businessFitGateData.highFitCount++;
    } else if (businessFitResult.fit === 'medium') {
      businessFitGateData.mediumFitCount++;
    } else if (businessFitResult.fit === 'low') {
      businessFitGateData.lowFitCount++;
    } else {
      businessFitGateData.rejectedCount++;
    }

    if (isBlockedByBusinessFit(businessFitResult)) {
      const bfReason = `business_fit:${businessFitResult.fit}`;
      skipped.push({
        name: candidate.name,
        reason: bfReason,
        searchTrace: candidate.searchTrace ?? undefined,
      });
      if (businessFitGateData.samples.length < 10) {
        businessFitGateData.samples.push({
          name: candidate.name,
          reason: businessFitResult.reasons.join('; '),
          url: candidate.website ?? null,
          fit: businessFitResult.fit,
          ...(domainInferredForOwnership
            ? {
                name_for_fit: nameForFit,
                original_name: candidate.name,
                recall_recovery_applied_for_fit: true,
              }
            : {}),
        });
      }
      captureOmittedSample(candidate, effectiveDomain, bfReason, 'business_fit', {
        recallRecoveredName: domainInferredForOwnership ? nameNormResult.name : null,
        nameForFit: nameForFit,
        isRecallRecoveryApplied: domainInferredForOwnership,
      });
      continue;
    }

    // ── Novelty check ─────────────────────────────────────────────────────────
    const noveltyResult = evaluateCandidateNovelty(
      { name: candidate.name, domain: candidate.domain, website: candidate.website },
      noveltyIndex,
    );
    if (noveltyResult.shouldSkip) {
      skipped.push({
        name: candidate.name,
        reason: noveltyResult.skipReason!,
        domain: candidate.domain ?? extractDomain(candidate.website),
        previous_candidate_ids: noveltyResult.noveltyMetadata.previous_candidate_ids,
        previous_batch_ids: noveltyResult.noveltyMetadata.previous_batch_ids,
        searchTrace: candidate.searchTrace ?? undefined,
      });
      captureOmittedSample(candidate, effectiveDomain, noveltyResult.skipReason!, 'novelty', {
        recallRecoveredName: domainInferredForOwnership ? nameNormResult.name : null,
        nameForFit: nameForFit,
        isRecallRecoveryApplied: domainInferredForOwnership,
      });
      continue;
    }

    // ── Country evidence gate (Hito v1.4) ────────────────────────────────────
    // Evalúa si hay evidencia real del país en URL/dominio/snippet/título,
    // o si el país solo se infirió de la query de búsqueda.
    const queryText = candidate.searchTrace?.query_text ?? null;
    const countryEvidenceResult = evaluateCountryEvidence({
      website: candidate.website ?? null,
      domain: effectiveDomain,
      sourceSnippet: candidate.sourceSnippet ?? null,
      sourceTitle: candidate.sourceTitle ?? null,
      queryText,
      targetCountryCode: countryCode ?? null,
    });

    // v1.16K-L: Resolve canonical company name when detected name is a generic SEO title.
    // Uses source_title suffix extraction (preferred) or domain inference as fallback.
    const canonicalNameResolution = resolveCanonicalCandidateName({
      detectedName: candidate.name,
      sourceTitle: candidate.sourceTitle ?? null,
      domain: effectiveDomain,
      identityResolution: identityResolutionForEntry
        ? {
            inferred_company_name: identityResolutionForEntry.inferred_company_name,
            identity_source: identityResolutionForEntry.identity_source,
          }
        : null,
    });

    eligibleEntries.push({
      candidate,
      candidateStatus,
      domain: effectiveDomain,
      countryCompatWeight: countryCompatibilityRankWeight(countryCompat),
      noveltyResult,
      identityKey: identity.identityKey ?? null,
      sourceUrlRankingBonus: sourceUrlQualityResult.rankingBonus,
      businessFitRankingBonus: businessFitResult.rankingBonus,
      countryEvidenceResult,
      businessFitResult,
      identityResolution: identityResolutionForEntry,
      canonicalNameResolution,
    });
  }

  // ── Pass 2: rank eligible candidates by priority (Hito 16AB.43.27 / 16AB.43.28 / 16AB.43.29) ─
  // Priority: 1) composite fit score desc (business fit + URL quality + country compat),
  //           2) confidence score desc,
  //           3) path depth asc (closer to root URL is better)
  // ADAPTIVE-EARLY-STOP § 4 — comparador COMPARTIDO con el evaluador PRE-writer.
  eligibleEntries.sort((a, b) =>
    compareWriterEligibleRank(
      {
        businessFitRankingBonus: a.businessFitRankingBonus,
        sourceUrlRankingBonus: a.sourceUrlRankingBonus,
        countryCompatWeight: a.countryCompatWeight,
        confidenceScore: a.candidate.scoring.confidenceScore ?? null,
        website: a.candidate.website ?? null,
      },
      {
        businessFitRankingBonus: b.businessFitRankingBonus,
        sourceUrlRankingBonus: b.sourceUrlRankingBonus,
        countryCompatWeight: b.countryCompatWeight,
        confidenceScore: b.candidate.scoring.confidenceScore ?? null,
        website: b.candidate.website ?? null,
      },
    ),
  );

  // ── Pass 2.5: intra-batch identity deduplicate (Hito 16AB.43.28) ─────────────
  // After ranking, keep only the first (best-ranked) entry per identity key.
  // Prevents the same company from appearing twice in one batch with different URLs.
  //
  // ADAPTIVE-EARLY-STOP § 4 — la SELECCIÓN de ganadores es ahora la función
  // compartida; lo que se queda aquí es el efecto colateral (contadores, ledger
  // de descartes y muestras), que sólo el writer emite.
  type IntraBatchDupeSample = { identity_key: string; kept_url: string | null; removed_url: string | null };
  const intraBatchDupeSamples: IntraBatchDupeSample[] = [];
  const intraDedupe = selectIntraBatchIdentityWinnerIndexes(
    eligibleEntries.map((entry) => entry.identityKey),
  );
  const eligibleAfterIntraDedupe: EligibleEntry[] = intraDedupe.winners.map(
    (index) => eligibleEntries[index],
  );

  for (const index of intraDedupe.losers) {
    const entry = eligibleEntries[index];
    const ik = entry.identityKey!;
    precisionGate.intraBatchDuplicateCount++;
    skipped.push({ name: entry.candidate.name, reason: 'intra_batch_identity_duplicate', searchTrace: entry.candidate.searchTrace ?? undefined });
    // AGENT1-APOLLO-FINALIZATION-HARDENING-1 § F — todo descarte necesita una
    // candidata TRAZABLE, no sólo una categoría agregada.
    captureOmittedSample(entry.candidate, entry.domain, 'intra_batch_identity_duplicate', 'intra_batch_identity');
    if (intraBatchDupeSamples.length < 10) {
      const keptEntry = eligibleAfterIntraDedupe.find((e) => e.identityKey === ik);
      intraBatchDupeSamples.push({
        identity_key: ik,
        kept_url: keptEntry?.candidate.website ?? null,
        removed_url: entry.candidate.website ?? null,
      });
    }
  }

  // ── Pass 3: apply target cap (Hito 16AB.43.27) ───────────────────────────────
  //
  // ADAPTIVE-EARLY-STOP § 5 — el cupo se aplica COMPLETE-FIRST.
  //
  // Hasta este hito el cupo cortaba el lote ordenado por ENCAJE, así que con el
  // cupo igual al objetivo un candidato completo y válido podía quedar
  // desplazado por uno de revisión mejor rankeado. Para Agente 1 el objetivo
  // declarado es encontrar empresas ELEGIBLES, no empresas con buen encaje: ese
  // desplazamiento reducía el resultado de la corrida por construcción.
  //
  // La proyección de completitud usa las MISMAS entradas que
  // `evaluateCandidateSubindustryTargetEligibility` leerá en Pass 4, salvo
  // `duplicate_status`, que aquí se toma del duplicate-checker y que el Active
  // Duplicate Guard sólo puede DEGRADAR más adelante (nunca mejorar). Es decir:
  // esta partición nunca promueve a un candidato que el writer vaya a dejar en
  // revisión por un motivo que ya se conozca, y en el peor caso ordena a dos
  // candidatos del mismo grupo como antes.
  //
  // Ni el cupo total ni el orden de encaje DENTRO de cada grupo cambian.
  const targetCap = input.targetPersistibleCandidates ?? null;
  const eligibleBeforeCap = eligibleAfterIntraDedupe.length;
  const capOrdered = orderByCompleteFirst(eligibleAfterIntraDedupe, (entry) =>
    evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: entry.candidate.sectorEvidenceState,
      requestedSubindustries: requestedSubindustriesForTarget,
      subindustryPrecision: entry.candidate.providerEnrichmentCapture?.precision ?? null,
      employeeCountStatus:
        entry.candidate.providerCompanyFields?.employeeCount.status ?? 'mapping_failed',
      linkedinStatus: entry.candidate.providerCompanyFields?.linkedin.status ?? 'mapping_failed',
      duplicateStatus: mapDuplicateStatus(entry.candidate.duplicateCheck?.status ?? 'unchecked'),
      ownershipGate: 'pass',
      qualityGate: 'pass',
    }).countsTowardTarget,
  );
  const toPersist =
    targetCap != null && targetCap > 0 && eligibleBeforeCap > targetCap
      ? capOrdered.slice(0, targetCap)
      : capOrdered;
  const cappedEntries = capOrdered.slice(toPersist.length);

  for (const { candidate, domain } of cappedEntries) {
    skipped.push({ name: candidate.name, reason: "target_cap", searchTrace: candidate.searchTrace ?? undefined });
    precisionGate.targetCapCount++;
    // § F — elegible, sin rechazo: se queda fuera por cupo, no por calidad. Debe
    // seguir siendo trazable como cualquier otro descarte.
    captureOmittedSample(candidate, domain, 'target_cap', 'target_cap');
  }

  // ── Active Duplicate Guard: prefetch active candidates (v1.13.1) ───────────
  // Fetches existing active candidates once before the write loop to avoid
  // re-inserting companies already in SellUp (e.g., Softland case).
  const guardBatchDomains = toPersist
    .map((e) => e.domain)
    .filter((d): d is string => d !== null && d.length > 0);
  const guardPrefetch = await fetchActiveCandidatesForGuard(
    admin,
    guardBatchDomains,
    countryCode ?? null,
  );
  const activeCandidatesForGuard = guardPrefetch.records;
  // Q3F-5AW.2 (Phase 1) — deja observable si el prefetch del guard degradó
  // (fail-open). No cambia el comportamiento: el guard sigue tolerando []
  // sin bloquear; solo se registra para diagnóstico.
  duplicateGuardData.prefetchStatus = guardPrefetch.status;
  duplicateGuardData.prefetchReason = guardPrefetch.reason;

  // ── Pre-Pass: Controlled LinkedIn Search (v1.15.2) ────────────────────────
  // Pre-compute LinkedIn enrichments for all candidates in toPersist.
  // When the feature is enabled (via linkedInSearchOverride), candidates with
  // not_found enrichment and confidenceScore >= minConfidenceScore get a
  // controlled search attempt. All real search runs behind a feature flag —
  // production callers omit linkedInSearchOverride so the feature is disabled.
  // No real API calls happen unless explicitly enabled via the override.
  const nowIso = now.toISOString();
  const linkedInSearchConfig = linkedInSearchOverride?.config ?? DEFAULT_LINKEDIN_SEARCH_CONFIG;
  const linkedInSearchProviderFn: LinkedInSearchProviderFn =
    linkedInSearchOverride?.providerFn ?? (async () => []);

  // Build initial enrichments from existing evidence (v1.15.1 behavior)
  const preComputedLinkedInEnrichments = toPersist.map(({ candidate, domain: d }) =>
    buildLinkedInEnrichmentMetadata({
      candidateName: candidate.name,
      candidateDomain: d,
      countryCode: candidate.countryCode,
      sourceTitle: candidate.sourceTitle ?? undefined,
      sourceSnippet: candidate.sourceSnippet ?? undefined,
      sourceUrl: candidate.sourceUrl ?? undefined,
      website: candidate.website ?? undefined,
      // A1-APOLLO-LINKEDIN-EMPLOYEES-1 — el LinkedIn que el proveedor YA devolvió.
      // Sin esta línea, la única evidencia que se miraba eran el título, el
      // snippet y la URL del sitio, y un `linkedin_url` presente en el payload de
      // Apollo terminaba reportado como «no hay LinkedIn en la evidencia».
      providedLinkedInUrl: candidate.companyLinkedInUrl ?? undefined,
      source: 'provided_search_result',
      checkedAt: nowIso,
    }),
  );

  // ── Pre-Pass B: Website Social Link Extraction (v1.16K-R-G) ─────────────────
  // For ALL candidates with a known website, try to extract a LinkedIn company URL
  // directly from the official site before Tavily. Cost: $0 — no external search API.
  // Runs independently of the Tavily cap: even if maxPerBatch=3, every candidate with
  // a website gets this free pass.
  let websiteExtractionBatchSummary: WebsiteExtractionBatchSummary | null = null;

  {
    const websiteExtractionCandidates = toPersist.map(({ candidate, domain: d }, i) => ({
      name: candidate.name,
      website: candidate.website ?? null,
      domain: d,
      countryCode: candidate.countryCode ?? null,
      currentEnrichment: preComputedLinkedInEnrichments[i],
    }));

    const websiteOutput = await runWebsiteLinkedInExtraction(websiteExtractionCandidates, nowIso);

    websiteExtractionBatchSummary = websiteOutput.batchSummary;

    // Apply results: update enrichments where website extraction found a match
    for (let i = 0; i < websiteOutput.results.length; i++) {
      const result = websiteOutput.results[i];
      if (result.extractionStatus === 'found') {
        preComputedLinkedInEnrichments[i] = result.enrichment;
      }
    }
  }

  let linkedInBatchSearchMetadata: LinkedInBatchSearchMetadata | null = null;

  if (linkedInSearchConfig.enabled) {
    const searchCandidates: ControlledLinkedInSearchCandidate[] = toPersist.map(
      ({ candidate, domain: d, countryEvidenceResult: cer, businessFitResult: bfr, identityResolution: ir }, i) => {
        // Pre-check duplicate guard: same_active_domain or same_inferred_identity
        // would block this candidate in the write loop — skip LinkedIn search for them.
        const preGuardName = ir?.inferred_company_name ?? candidate.name;
        const preGuardInput: DuplicateGuardInput = {
          name: candidate.name,
          domain: d,
          website: candidate.website ?? null,
          inferredCompanyName: preGuardName,
          normalizedName: normalizeName(preGuardName),
        };
        const preGuardMatch = checkActiveCandidateDuplicate(preGuardInput, activeCandidatesForGuard);
        const isBlockedByDuplicateGuard =
          preGuardMatch.matched &&
          (preGuardMatch.reason === 'same_active_domain' ||
            preGuardMatch.reason === 'same_inferred_identity');

        // Pre-check evidence persistence policy: blocked candidates won't be inserted.
        const prePolicy = computeEvidencePersistencePolicy({ countryEvidence: cer, businessFit: bfr });
        const isBlockedByEvidencePolicy = prePolicy.decision === 'blocked';

        return {
          name: candidate.name,
          domain: d,
          countryCode: candidate.countryCode ?? null,
          sourceTitle: candidate.sourceTitle ?? null,
          sourceSnippet: candidate.sourceSnippet ?? null,
          confidenceScore: candidate.scoring.confidenceScore,
          currentEnrichment: preComputedLinkedInEnrichments[i],
          isBlockedByDuplicateGuard,
          isBlockedByEvidencePolicy,
        };
      },
    );

    const searchOutput = await runControlledLinkedInCompanySearch(
      searchCandidates,
      linkedInSearchConfig,
      linkedInSearchProviderFn,
      nowIso,
      {
        usageContext: linkedInSearchOverride?.usageContext ?? {
          batchId: batchId,
          userId: triggeredByUserId ?? null,
          dryRun: isDryRun,
          // v1.16K-R-B: resolved Tavily LinkedIn unit cost so estimated_cost_usd > 0.
          // null when pricing is missing → orchestrator blocks real calls visibly.
          unitCostUsd: linkedInSearchOverride?.unitCostUsd ?? null,
        },
        usageLoggerFn: linkedInSearchOverride?.usageLoggerFn,
      },
    );

    linkedInBatchSearchMetadata = searchOutput.batchMetadata;

    // Replace enrichments with search-updated results (aligned by index)
    for (let i = 0; i < searchOutput.results.length; i++) {
      preComputedLinkedInEnrichments[i] = searchOutput.results[i].enrichment;
    }
  }

  // ── Pre-Pass: Controlled Rich Profile Enrichment (v1.16E) ─────────────────
  // After LinkedIn enrichments are computed, optionally enrich city/size/description
  // via a controlled provider. Runs only when richProfileEnrichmentOverride is
  // supplied explicitly. Production callers omit this parameter so DEFAULT behavior
  // (no enrichment, 0 provider calls) is preserved unconditionally.
  type RichEnrichmentStoredResult = {
    providerResult: RichProfileEnrichmentProviderResult;
    estimatedCostUsd: number;
  };
  const richEnrichmentResultsByIdx = new Map<number, RichEnrichmentStoredResult>();
  let richProfileBatchMetadata: RichProfileEnrichmentBatchMetadata | null = null;
  let richProfileUsagePayloads: RichProfileEnrichmentUsagePayload[] = [];
  let richProfileUsageLogSuccessCount = 0;
  let richProfileUsageLogFailedCount = 0;

  if (richProfileEnrichmentOverride) {
    // Build per-candidate enrichment input, reusing pre-computed LinkedIn enrichments.
    // candidateId = String(i) allows us to map results back by toPersist index.
    const enrichmentCandidates = toPersist.map(
      ({ candidate, domain: d, countryEvidenceResult: cer, businessFitResult: bfr, identityResolution: ir }, i) => {
        // Pre-check duplicate guard (same logic as LinkedIn pre-pass)
        const preGuardName = ir?.inferred_company_name ?? candidate.name;
        const preGuardInput: DuplicateGuardInput = {
          name: candidate.name,
          domain: d,
          website: candidate.website ?? null,
          inferredCompanyName: preGuardName,
          normalizedName: normalizeName(preGuardName),
        };
        const preGuardMatch = checkActiveCandidateDuplicate(preGuardInput, activeCandidatesForGuard);
        const isBlockedByDuplicateGuard =
          preGuardMatch.matched &&
          (preGuardMatch.reason === 'same_active_domain' ||
            preGuardMatch.reason === 'same_inferred_identity');

        // Pre-check evidence policy
        const prePolicy = computeEvidencePersistencePolicy({ countryEvidence: cer, businessFit: bfr });
        const isBlockedByEvidencePolicy = prePolicy.decision === 'blocked';

        // Build base rich profile using LinkedIn enrichment from pre-pass
        const baseRichProfile = buildCandidateRichProfileV1({
          name: candidate.name,
          website: candidate.website,
          domain: candidate.domain,
          country: candidate.country,
          countryCode: candidate.countryCode,
          industry: candidate.industry,
          sourceUrl: candidate.sourceUrl,
          sourceTitle: candidate.sourceTitle ?? null,
          sourceSnippet: candidate.sourceSnippet,
          confidenceScore: candidate.scoring.confidenceScore,
          fitScore: candidate.scoring.fitScore,
          fitLabel: candidate.scoring.fitBreakdown?.fit_label ?? null,
          fitReasons: candidate.scoring.fitBreakdown?.fit_reasons ?? null,
          linkedInEnrichment: preComputedLinkedInEnrichments[i],
          countryEvidenceLevel: cer.evidenceLevel,
          countryEvidenceSources: cer.evidenceSources,
          countryEvidenceWarning: cer.warning ?? null,
          evidencePolicyWarnings: prePolicy.warnings,
        });

        return {
          candidateId: String(i),
          name: candidate.name,
          domain: d,
          website: candidate.website ?? null,
          country: candidate.country,
          countryCode: candidate.countryCode,
          industry: candidate.industry,
          confidenceScore: candidate.scoring.confidenceScore,
          fitScore: candidate.scoring.fitScore,
          richProfile: baseRichProfile,
          isBlockedByDuplicateGuard,
          isBlockedByEvidencePolicy,
        };
      },
    );

    const enrichmentOutput = await runRichProfileEnrichmentBatch(enrichmentCandidates, {
      config: richProfileEnrichmentOverride.config,
      providerFn: richProfileEnrichmentOverride.providerFn,
      unitCostUsd: richProfileEnrichmentOverride.unitCostUsd ?? 0,
      batchId: batchId,
      userId: triggeredByUserId ?? null,
      dryRun: isDryRun,
      usageLoggerFn: richProfileEnrichmentOverride.usageLoggerFn,
      clockFn: () => new Date().toISOString(),
    });

    richProfileBatchMetadata = enrichmentOutput.batchMetadata;
    richProfileUsagePayloads = enrichmentOutput.usagePayloads;

    // Map enriched profiles back to toPersist indices via candidateId
    for (const ep of enrichmentOutput.enrichedProfiles) {
      const idx = parseInt(ep.candidate.candidateId ?? '', 10);
      if (!isNaN(idx) && ep.providerResult.status !== 'failed') {
        richEnrichmentResultsByIdx.set(idx, {
          providerResult: ep.providerResult,
          estimatedCostUsd: ep.usagePayload.estimated_cost_usd,
        });
      }
    }

    // Log usage payloads (skip for dry run and mock provider)
    const shouldLogUsage =
      !isDryRun &&
      richProfileEnrichmentOverride.config.provider !== 'mock' &&
      richProfileEnrichmentOverride.config.provider !== 'disabled' &&
      richProfileEnrichmentOverride.usageLoggerFn != null;

    if (shouldLogUsage) {
      for (const payload of richProfileUsagePayloads) {
        try {
          await richProfileEnrichmentOverride.usageLoggerFn!(payload);
          richProfileUsageLogSuccessCount++;
        } catch {
          richProfileUsageLogFailedCount++;
        }
      }
    }
  }

  // ── Pass 4: write eligible (after cap) ──────────────────────────────────────
  for (const [_entryIdx, { candidate, candidateStatus, domain, noveltyResult, countryEvidenceResult, businessFitResult, identityResolution, canonicalNameResolution }] of toPersist.entries()) {
    // v1.16K-L: use canonical name when a generic SEO title was resolved to a real company name
    const persistedName = canonicalNameResolution.applied ? canonicalNameResolution.canonicalName : candidate.name;
    // ── Active Duplicate Guard (v1.13.1 / v1.14) ─────────────────────────────
    // Best identity priority for guard input:
    //   1. identity_resolution.inferred_company_name — resolved from generic service title
    //      (e.g. "Software ERP CRM y RRHH en Colombia" → "Softland" via domain inference)
    //   2. candidate.name — raw name as fallback
    // When identity_resolution.reason indicates a generic service title
    // (detected_name_looked_like_generic_service_title, domain_inferred, title_generic,
    // service_title), inferred_company_name takes precedence over the raw name.
    const resolvedInferredName = identityResolution?.inferred_company_name ?? null;
    const guardInferredName = resolvedInferredName ?? candidate.name;
    const guardInput: DuplicateGuardInput = {
      name: candidate.name,
      domain,
      website: candidate.website ?? null,
      inferredCompanyName: guardInferredName,
      normalizedName: normalizeName(guardInferredName),
    };
    const guardMatch = checkActiveCandidateDuplicate(guardInput, activeCandidatesForGuard);
    duplicateGuardData.checkedCount++;

    if (guardMatch.matched) {
      const isStrongMatch =
        guardMatch.reason === 'same_active_domain' ||
        guardMatch.reason === 'same_inferred_identity';

      if (isStrongMatch) {
        skipped.push({
          name: candidate.name,
          reason: `duplicate_guard:${guardMatch.reason}`,
          searchTrace: candidate.searchTrace ?? undefined,
        });
        // § F — `duplicateGuardData.samples` ya guarda el nombre, pero acotado a
        // 10 y en su propia cubeta; `writer_omitted_samples` es el ledger único.
        captureOmittedSample(candidate, domain, `duplicate_guard:${guardMatch.reason}`, 'duplicate_guard');
        duplicateGuardData.skippedCount++;
        if (duplicateGuardData.samples.length < 10) {
          duplicateGuardData.samples.push({
            candidate_name: candidate.name,
            candidate_domain: domain ?? null,
            candidate_inferred_name: resolvedInferredName,
            reason: guardMatch.reason!,
            matched_candidate_id: guardMatch.matchedCandidateId ?? '',
            matched_name: guardMatch.matchedName ?? '',
            matched_domain: guardMatch.matchedDomain ?? null,
          });
        }
        continue;
      }

      // same_canonical_identity: persist as possible_duplicate and annotate
      duplicateGuardData.possibleDuplicateCount++;
      if (duplicateGuardData.samples.length < 10) {
        duplicateGuardData.samples.push({
          candidate_name: candidate.name,
          candidate_domain: domain ?? null,
          candidate_inferred_name: resolvedInferredName,
          reason: guardMatch.reason!,
          matched_candidate_id: guardMatch.matchedCandidateId ?? '',
          matched_name: guardMatch.matchedName ?? '',
          matched_domain: guardMatch.matchedDomain ?? null,
        });
      }
    }

    // ── Evidence persistence policy (Hito v1.5) ─────────────────────────────
    const evidencePolicy = computeEvidencePersistencePolicy({
      countryEvidence: countryEvidenceResult,
      businessFit: businessFitResult,
    });

    if (evidencePolicy.decision === 'blocked') {
      skipped.push({
        name: candidate.name,
        reason: `evidence_policy:${evidencePolicy.primaryReason}`,
        searchTrace: candidate.searchTrace ?? undefined,
      });
      // § F — mismo ledger único para todo descarte, además de la muestra
      // acotada propia de `evidencePolicyGateData`.
      captureOmittedSample(
        candidate,
        domain,
        `evidence_policy:${evidencePolicy.primaryReason}`,
        'evidence_policy',
      );
      evidencePolicyGateData.blockedCount++;
      if (evidencePolicyGateData.samples.length < 10) {
        evidencePolicyGateData.samples.push({
          name: candidate.name,
          reason: evidencePolicy.primaryReason,
          url: candidate.website ?? null,
        });
      }
      continue;
    }

    // ── A1-APOLLO-LINKEDIN-EMPLOYEES-1 — campos empresariales del proveedor ────
    //
    // § 4 del contrato: la ausencia del proveedor y la pérdida interna son cosas
    // distintas y se registran distinto. En la ruta Apollo la captura la pone el
    // constructor del candidato; si falta, es una pérdida interna (`mapping_failed`),
    // nunca «el proveedor no lo devolvió».
    //
    // CANDIDATE-OPERABILITY-VALIDATION-1 § D — este bloque estaba ~150 líneas más
    // abajo, DESPUÉS de construir el `rich_profile` y de fijar el score efectivo.
    // Por eso el perfil no podía ver el LinkedIn de Apollo y declaraba
    // `missing_fields: ['linkedin_url', …]` sobre una fila que lo tenía en columna.
    // Resolver la verdad ANTES de afirmar nada sobre ella es el arreglo.
    const providerCompanyFields = isApolloCompanyDiscoveryPath
      ? (candidate.providerCompanyFields ?? MAPPING_FAILED_COMPANY_FIELDS)
      : null;

    // ── LinkedIn Enrichment (v1.15.1 + v1.15.2) ──────────────────────────────
    // Pre-computed in the LinkedIn pre-pass above. Includes controlled search
    // result when the feature is enabled and the candidate was eligible.
    const linkedInEnrichment = preComputedLinkedInEnrichments[_entryIdx];

    // § E — disponibilidad y verificación, cada una de su fuente. La URL canónica
    // sale de la MISMA precedencia que la columna `linkedin_url` (proveedor >
    // enriquecimiento del writer); la verificación, sólo del enriquecimiento.
    const linkedinAvailability = describeLinkedinAvailability({
      providerCapture: providerCompanyFields?.linkedin ?? null,
      writerEnrichment: linkedInEnrichment,
    });

    // § F — el scoring se corrigió si la URL le llegó tarde. Retira la advertencia
    // falsa y aplica el componente canónico exactamente una vez; con la URL ya
    // vista por el scorer (ruta reordenada del pipeline) esto es un no-op.
    const linkedinScoring = reconcileScoringForLinkedinAvailability(
      candidate.scoring,
      linkedinAvailability,
    );
    const reconciledScoring = linkedinScoring.scoring;

    const effectiveConfidenceScore =
      evidencePolicy.confidenceCap !== null
        ? Math.min(reconciledScoring.confidenceScore, evidencePolicy.confidenceCap)
        : reconciledScoring.confidenceScore;

    if (evidencePolicy.confidenceCap !== null) {
      evidencePolicyGateData.confidenceCapCount++;
    }

    // Guard override: same_canonical_identity → mark as possible_duplicate
    const dbDuplicateStatus =
      guardMatch.matched && guardMatch.reason === 'same_canonical_identity'
        ? 'possible_duplicate'
        : mapDuplicateStatus(candidate.duplicateCheck?.status ?? "unchecked");

    // matched_account_id solo si es UUID válido de SellUp
    const sellupMatch = candidate.duplicateCheck?.matches.find(
      (m) => m.source === "sellup"
    );
    const matchedAccountId =
      isValidUuid(sellupMatch?.matchedId) ? sellupMatch!.matchedId! : null;

    // matched_hubspot_company_id puede ser cualquier string
    const hubspotMatch = candidate.duplicateCheck?.matches.find(
      (m) => m.source === "hubspot"
    );
    const matchedHubspotId = hubspotMatch?.matchedId ?? null;

    const reviewNotes =
      candidate.scoring.qualityLabel === "insufficient_data"
        ? `Datos insuficientes. Blockers: ${candidate.scoring.blockers.join(", ")}`
        : null;

    // ── Rich Profile (v1.16A + v1.16E controlled enrichment) ─────────────────
    const richProfile = buildCandidateRichProfileV1({
      name: persistedName,
      website: candidate.website,
      domain: candidate.domain,
      country: candidate.country,
      countryCode: candidate.countryCode,
      industry: candidate.industry,
      sourceUrl: candidate.sourceUrl,
      sourceTitle: candidate.sourceTitle ?? null,
      sourceSnippet: candidate.sourceSnippet,
      confidenceScore: effectiveConfidenceScore,
      fitScore: candidate.scoring.fitScore,
      fitLabel: candidate.scoring.fitBreakdown?.fit_label ?? null,
      fitReasons: candidate.scoring.fitBreakdown?.fit_reasons ?? null,
      linkedInEnrichment,
      // § D/G — la URL canónica y su estado de verificación entran al perfil.
      effectiveLinkedin: {
        url: linkedinAvailability.url,
        state: linkedinAvailability.isVerified
          ? 'verified'
          : linkedinAvailability.isAvailable
            ? 'available_unverified'
            : 'absent',
      },
      countryEvidenceLevel: countryEvidenceResult.evidenceLevel,
      countryEvidenceSources: countryEvidenceResult.evidenceSources,
      countryEvidenceWarning: countryEvidenceResult.warning ?? null,
      evidencePolicyWarnings: evidencePolicy.warnings,
    });

    // Apply v1.16E enrichment result if pre-pass computed one for this entry
    const preEnrichResult = richEnrichmentResultsByIdx.get(_entryIdx);
    const mergedRichProfile = preEnrichResult
      ? mergeRichProfileEnrichmentResult(richProfile, preEnrichResult.providerResult, {
          externalCallUsed: true,
          estimatedCostUsd: preEnrichResult.estimatedCostUsd,
        })
      : richProfile;

    // ── ICP Size Gate (v1.16J / v1.16J.1) ────────────────────────────────────
    // Resolver central: prioriza rich_profile > company_size > HubSpot employees.
    // Corre DESPUÉS del enriquecimiento para usar el rango real si está disponible.
    const resolvedEmployeeSize = resolveEmployeeSizeForIcpGate({
      richProfileSize: mergedRichProfile.size,
      candidateCompanySize: extractCandidateCompanySize(candidate),
      matchedHubspotEmployees: extractHubSpotMatchedEmployees(hubspotMatch?.raw),
      threshold: 200,
    });
    const icpSizeGateResult = evaluateIcpSizeGate(resolvedEmployeeSize.icpInput);
    const icpSizeGateAction = resolveIcpSizeGateWriterAction(icpSizeGateResult);

    if (icpSizeGateAction.action === 'skip') {
      const icpSkipReason = icpSizeGateAction.skipReason ?? 'icp_size_below_threshold';
      skipped.push({
        name: candidate.name,
        reason: icpSkipReason,
        searchTrace: candidate.searchTrace ?? undefined,
      });
      // AGENT1-APOLLO-FINALIZATION-HARDENING-1 § F — el defecto real de la
      // corrida `bdc51c49`: `writer_summary.quality_rejected_count = 1` y
      // `writer_omitted_samples = []`. La categoría existía; la candidata no
      // tenía nombre en ningún lado. Este gate era el único de Pass 4 sin
      // `captureOmittedSample`.
      captureOmittedSample(candidate, domain, icpSkipReason, 'icp_size');
      icpSizeGateData.blockedCount++;
      if (icpSizeGateData.blockedReasons.length < 20) {
        icpSizeGateData.blockedReasons.push(
          `${candidate.name}: ${icpSizeGateResult.reason}`,
        );
      }
      continue;
    }

    if (icpSizeGateAction.action === 'needs_review') {
      icpSizeGateData.needsValidationCount++;
    } else {
      icpSizeGateData.passCount++;
    }

    // Annotate the rich profile with gate result + resolution trace (immutable)
    const employeeSizeResolutionTrace = {
      selected_source: resolvedEmployeeSize.selectedSource,
      selected_value: resolvedEmployeeSize.selectedValue,
      confidence: resolvedEmployeeSize.confidence,
    };
    // CANDIDATE-OPERABILITY-VALIDATION-1 § G — el perfil se refresca con la verdad
    // EFECTIVA antes de anotar el gate. Es el único punto de la función donde ya
    // están resueltas las cuatro: LinkedIn normalizado, subindustria con precisión
    // demostrada, ciudad del enrichment y tamaño del resolver central. Antes de este
    // hito el perfil se congelaba con el estado pre-enrichment y declaraba ausentes
    // los cuatro campos que la propia fila acabaría teniendo en columna.
    const enrichmentCapture = candidate.providerEnrichmentCapture ?? null;
    const refreshedRichProfile = refreshCandidateRichProfileWithEffectiveTruth(
      mergedRichProfile,
      {
        linkedin: {
          url: linkedinAvailability.url,
          state: linkedinAvailability.isVerified
            ? 'verified'
            : linkedinAvailability.isAvailable
              ? 'available_unverified'
              : 'absent',
        },
        city: enrichmentCapture?.city ?? null,
        citySource: enrichmentCapture?.city != null ? 'linkedin' : undefined,
        // Sólo la subindustria con precisión `confirmed` llega aquí: la captura ya
        // aplica esa regla (§ 3 de QUALITY-PERSISTENCE-HARDENING-1) y no se relaja.
        subindustry: enrichmentCapture?.subindustry ?? null,
        employeeCount:
          providerCompanyFields?.employeeCount.status === 'confirmed'
            ? providerCompanyFields.employeeCount.employeeCount
            : null,
        employeeSizeRange:
          resolvedEmployeeSize.selectedValue == null
            ? null
            : String(resolvedEmployeeSize.selectedValue),
        employeeSizeSource: 'registry',
      },
    );

    const finalRichProfile = {
      ...refreshedRichProfile,
      size: {
        ...refreshedRichProfile.size,
        icp_size_gate: icpSizeGateResult,
        employee_size_resolution: employeeSizeResolutionTrace,
      },
    };

    // Per-candidate enrichment metadata (only when provider returned a result)
    const perCandidateRichEnrichment = preEnrichResult
      ? {
          status: preEnrichResult.providerResult.status,
          provider: richProfileEnrichmentOverride!.config.provider,
          evidence_url: preEnrichResult.providerResult.evidence_url ?? null,
          confidence: preEnrichResult.providerResult.confidence ?? null,
          warnings: preEnrichResult.providerResult.warnings ?? [],
          checked_at: nowIso,
          cost_usd: preEnrichResult.estimatedCostUsd,
        }
      : null;

    const linkedInVerified =
      linkedInEnrichment.status === 'found' && linkedInEnrichment.confidence >= 70;
    const effectiveFitScore = Math.min(100, candidate.scoring.fitScore + (linkedInVerified ? 5 : 0));

    const baseFitBreakdown = candidate.scoring.fitBreakdown ?? null;
    const adjustedFitBreakdown = linkedInVerified
      ? baseFitBreakdown
        ? {
            ...baseFitBreakdown,
            fit_reasons: [...(baseFitBreakdown.fit_reasons ?? []), 'linkedin_company_verified'],
            final_fit_score: effectiveFitScore,
          }
        : {
            product_fit: 0,
            country_fit: 0,
            b2b_signal: 0,
            duplicate_penalty: 0,
            country_evidence_penalty: 0,
            generic_agency_penalty: 0,
            commercial_calibration_delta: 5,
            final_fit_score: effectiveFitScore,
            fit_label: 'medium' as const,
            fit_reasons: ['linkedin_company_verified'],
            fit_penalties: [],
          }
      : baseFitBreakdown;

    // AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — bounded official-source columns
    // (tax_identifier / tax_identifier_type / legal_name / legal_status),
    // produced by the shared provider-neutral intake seam when a strong match
    // was found. `null` in every field when the candidate carries no
    // `officialSourceIdentity` (e.g. Apollo candidates that predate this
    // adoption, or any candidate the seam did not find a strong match for) —
    // never invented.
    const officialSourceTypedColumns = candidate.officialSourceIdentity?.typedColumns ?? {
      tax_identifier: null,
      tax_identifier_type: null,
      legal_name: null,
      legal_status: null,
    };

    // Q3F-5AW.2 (Phase 1) — identidad canónica determinística para el candidato.
    // Se persiste en la columna nullable identity_key. NO se usa ON CONFLICT ni
    // unique index todavía; es aditivo/observable. NULL si no hay identidad
    // suficiente (nunca bloquea el insert).
    // AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — antes del adoption, ningún
    // candidato de Agente 1 traía identificador fiscal y la clave se componía
    // SIEMPRE de dominio → nombre. Con la costura compartida, un candidato con
    // identidad fiscal FUERTE sube al primer nivel (`tax:<cc>:<nit>`) por la
    // MISMA precedencia que ya usa la aprobación de candidatos — no se
    // introduce un algoritmo nuevo.
    const candidateIdentityKey = buildProspectCandidateIdentityKey({
      name: persistedName,
      domain: domain ?? null,
      website: candidate.website ?? null,
      countryCode: candidate.countryCode ?? null,
      taxIdentifier: officialSourceTypedColumns.tax_identifier,
    });

    // `providerCompanyFields` se resolvió al principio de la iteración (§ D): es la
    // MISMA captura, leída una sola vez, que alimenta scoring, perfil y columnas.
    const companyLinkedInBlock = providerCompanyFields
      ? toCompanyLinkedInMetadataBlock(providerCompanyFields.linkedin)
      : null;
    const companyEmployeeCountBlock = providerCompanyFields
      ? toCompanyEmployeeCountMetadataBlock(providerCompanyFields.employeeCount)
      : null;

    // URL que se persiste en la columna canónica. El valor de Apollo manda; si
    // Apollo no lo devolvió, sirve el que el enriquecimiento del writer confirmó.
    const apolloLinkedInUrl = providerCompanyFields?.linkedin.companyLinkedInUrl ?? null;
    const enrichmentLinkedInUrl =
      linkedInEnrichment.status === 'found' ? (linkedInEnrichment.company_url ?? null) : null;
    const persistedLinkedInUrl = apolloLinkedInUrl ?? enrichmentLinkedInUrl;
    const persistedLinkedInOrigin = apolloLinkedInUrl
      ? 'apollo'
      : enrichmentLinkedInUrl
        ? 'writer_linkedin_enrichment'
        : null;

    // ── § G — trazabilidad por campo ──────────────────────────────────────────
    //
    // El `usage_key` de la operación que trajo el dato sólo existe cuando hubo
    // una operación PAGADA (el enrichment de organización). Cuando el valor vino
    // de la búsqueda, no hay clave que citar y el campo queda en `null` en vez de
    // inventarse una.
    //
    // `persistence_mode` se declara aquí como `column` porque es lo que este
    // insert intenta. Si la columna no existiera en el entorno, el reintento sin
    // ella lo registra a nivel de lote en `company_fields_completeness.
    // linkedin_persistence_mode = 'metadata_only'`: la columna existe o no existe
    // para TODA la corrida, así que el estado del lote es el que manda, y por eso
    // es el que la QA certifica.
    const companyFieldSourceRequestId =
      candidate.providerEnrichmentCapture?.provenance.sourceRequestId ?? null;
    const companyFieldTraces = providerCompanyFields
      ? {
          linkedin: buildCompanyLinkedInTrace(providerCompanyFields.linkedin, {
            sourceRequestId: companyFieldSourceRequestId,
            persistenceMode: persistedLinkedInUrl !== null ? 'column' : 'not_persisted',
          }),
          employee_count: buildEmployeeCountTrace(providerCompanyFields.employeeCount, {
            sourceRequestId: companyFieldSourceRequestId,
            persistenceMode:
              providerCompanyFields.employeeCount.status === 'confirmed'
                ? 'column'
                : 'not_persisted',
          }),
        }
      : null;

    // § 5 — la regla de conteo hacia el target. Los gates de propiedad y de
    // calidad ya descartaron antes del insert a quien no pasaba, así que llegar
    // aquí ES el `pass`; se registra explícito en vez de darse por supuesto.
    //
    // AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 3 — cuando la búsqueda
    // pidió una subindustria específica, el veredicto que decide el conteo es
    // el de `ApolloSubindustryPrecisionAssessment` (`providerEnrichmentCapture
    // .precision`), NO `candidate.sectorEvidenceState`: ese estado es el
    // veredicto de relevancia sectorial/de INDUSTRIA, subindustria-ciego para
    // toda subindustria sin catálogo de anclas propio, y leerlo como si
    // demostrara la subindustria pedida es el defecto que este cambio cierra.
    const targetEligibility = evaluateCandidateSubindustryTargetEligibility({
      persistenceSuccess: true,
      sectorEvidenceState: candidate.sectorEvidenceState,
      // § 3 — lo que se PIDIÓ. Con esto, una búsqueda con subindustria cuya
      // precisión no llegó queda fail-closed en vez de heredar el veredicto de
      // industria.
      requestedSubindustries: requestedSubindustriesForTarget,
      subindustryPrecision: candidate.providerEnrichmentCapture?.precision ?? null,
      employeeCountStatus: providerCompanyFields?.employeeCount.status ?? 'mapping_failed',
      linkedinStatus: providerCompanyFields?.linkedin.status ?? 'mapping_failed',
      duplicateStatus: dbDuplicateStatus,
      ownershipGate: 'pass',
      qualityGate: 'pass',
    });

    // Un candidato incompleto se persiste, pero nunca como `high_quality_new`.
    const completenessAdjustedStatus = resolveCandidateStatusForCompleteness(
      candidateStatus,
      targetEligibility,
    );
    const completenessReviewFlags = targetEligibility.countsTowardTarget
      ? []
      : [INCOMPLETE_CANDIDATE_REVIEW_FLAG];

    // FORENSICS-1 § 10 — la procedencia que se persiste es la REAL. Un candidato
    // producido íntegramente por Apollo Organizations no puede etiquetarse
    // `web_ai`: la ficha lo mostraba como «Web/IA» mientras sus propios campos
    // citaban «Apollo · organizations_search». `apollo` ya está en el dominio de
    // `prospect_candidates_source_primary_check`, así que no hace falta migración.
    const isApolloCompanyDiscoveryRun = shouldEmitApolloBatchProviderAttempts({
      webSearchProvider: pipelineMeta?.provider,
      hasProviderRouting: preMergedMetadata[BATCH_PROVIDER_ROUTING_KEY] != null,
    });
    const candidateSourcePrimary = isApolloCompanyDiscoveryRun ? 'apollo' : 'web_ai';

    // ── CANDIDATE-OPERABILITY-VALIDATION-1 § A — la procedencia de la FILA ──────
    //
    // `record_origin` es la dimensión que decide si la cola de revisión limpia
    // puede operar el candidato (`PENDING_REVIEW_RECORD_ORIGIN = 'production'`, y
    // los cuatro gates de acción con ella). El writer canónico nunca la escribía:
    // los `web_ai` con `production` venían de un backfill único
    // (`classification_source = 'derived_status'`) y todo lo escrito después de
    // aquel backfill —incluida cada fila de Apollo— quedaba en NULL, es decir
    // inoperable. No es lo mismo que `source_primary`: eso dice QUÉ proveedor la
    // produjo; esto dice DE QUÉ CLASE DE CORRIDA salió.
    //
    // La verdad la deriva el clasificador canónico sobre la fila que se va a
    // insertar. Un marcador de smoke/QA/import gana siempre: esta vía nunca
    // asciende nada a `production`.
    const candidateBaseMetadata = buildCandidateMetadata(candidate);
    const recordOriginResolution = resolveCandidateRecordOriginForWriter({
      dryRun: isDryRun,
      candidate: {
        status: completenessAdjustedStatus,
        duplicate_status: dbDuplicateStatus,
        source_primary: candidateSourcePrimary,
        review_notes: reviewNotes,
        // La metadata del CANDIDATO, no la del lote: es donde viven los marcadores
        // `smoke_test` / `qa_only` que tienen que poder vetar el ascenso.
        metadata: candidateBaseMetadata,
      },
      batch: {
        source,
        name: batchName ?? null,
        metadata: preMergedMetadata,
      },
    });

    const candidateInsertBase = {
      batch_id: batchId,
      name: persistedName,
      normalized_name: normalizeName(persistedName),
      identity_key: candidateIdentityKey,
      website: candidate.website ?? null,
      domain: domain ?? null,
      country: candidate.country,
      country_code: candidate.countryCode,
      industry: candidate.industry,
      source_primary: candidateSourcePrimary,
      sources_checked: [
        { provider: "web_search", checked_at: now.toISOString() },
        {
          provider: "website_verifier",
          checked_at: now.toISOString(),
          result: candidate.websiteVerification?.status ?? "skipped",
        },
        {
          provider: "duplicate_check",
          checked_at: now.toISOString(),
          result: candidate.duplicateCheck?.status ?? "unchecked",
        },
      ],
      duplicate_status: dbDuplicateStatus,
      matched_account_id: matchedAccountId,
      matched_hubspot_company_id: matchedHubspotId,
      confidence_score: effectiveConfidenceScore,
      fit_score: effectiveFitScore,
      // § F — la completitud reconciliada. Si la URL de LinkedIn le llegó al scorer
      // después de puntuar, su componente canónico se aplica aquí exactamente una vez.
      data_completeness_score: reconciledScoring.dataCompletenessScore,
      status: completenessAdjustedStatus,
      review_notes: reviewNotes,
      // § A — la fila declara de qué clase de corrida salió. Sin esto, un candidato
      // real de una corrida real no se puede aprobar ni descartar desde la cola.
      ...toCandidateRecordOriginColumns(recordOriginResolution),
      ...(completenessReviewFlags.length > 0 ? { review_flags: completenessReviewFlags } : {}),
      // § 3 — el número de empleados va a su columna normal. Sólo un valor
      // `confirmed` se escribe: `null` nunca se convierte en cero y un `invalid`
      // no se disfraza de dato.
      ...(providerCompanyFields?.employeeCount.status === 'confirmed'
        ? {
            employee_count: providerCompanyFields.employeeCount.employeeCount,
            employee_count_source: providerCompanyFields.employeeCount.sourceProvider,
          }
        : {}),
      // A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 § 4 — ciudad y clasificación
      // que el enrichment devolvió, en sus columnas normales. El proyector omite
      // la clave de todo campo que el proveedor no entregó: un dato ausente deja
      // la columna intacta en vez de borrarla con un null.
      //
      // No solapa con § 3: el proyector del enrichment NO escribe `employee_count`
      // ni `linkedin_url` — esas dos columnas las gobierna A1-APOLLO-LINKEDIN-
      // EMPLOYEES-1 por su propia vía.
      ...(candidate.providerEnrichmentCapture
        ? toApolloEnrichmentCandidateColumns(candidate.providerEnrichmentCapture)
        : {}),
      // AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — official-source identity in
      // its normal columns, reusing the exact same `buildOfficialSourceTypedColumns`
      // projection the Lusha flow already writes through. Every key is `null`
      // when the seam found no strong match — never a fabricated identity.
      ...(candidate.officialSourceIdentity ? officialSourceTypedColumns : {}),
      metadata: {
        ...candidateBaseMetadata,
        scoring: {
          // § F — el scoring publicado es el reconciliado: ya no puede contener
          // «LinkedIn no disponible» sobre una fila con `linkedin_url` en columna.
          confidence_score: reconciledScoring.confidenceScore,
          fit_score: effectiveFitScore,
          data_completeness: reconciledScoring.dataCompletenessScore,
          quality_label: reconciledScoring.qualityLabel,
          recommended_action: reconciledScoring.recommendedAction,
          reasons: reconciledScoring.reasons,
          warnings: reconciledScoring.warnings,
          blockers: reconciledScoring.blockers,
          fit_breakdown: adjustedFitBreakdown,
        },
        // § A — cómo se decidió la procedencia de la fila, auditable sin reejecutar.
        [CANDIDATE_RECORD_ORIGIN_METADATA_KEY]:
          toCandidateRecordOriginMetadata(recordOriginResolution),
        // § E — disponibilidad y verificación como DOS campos distintos. Es lo que
        // permite a la ficha decir «disponible · verificación pendiente» sin tener
        // que elegir entre afirmar una ausencia falsa o una verificación falsa.
        [LINKEDIN_AVAILABILITY_METADATA_KEY]: toLinkedinAvailabilityMetadata(
          linkedinAvailability,
          linkedinScoring,
        ),
        linkedin_enrichment: linkedInEnrichment,
        // § 2 y § 3 — señales de LinkedIn empresarial y de número de empleados con
        // su procedencia. `prospect_candidates` no tiene columnas de procedencia,
        // así que viven aquí, estructuradas y con los nombres del contrato.
        ...(companyLinkedInBlock
          ? {
              company_linkedin: {
                ...companyLinkedInBlock,
                persisted_linkedin_url: persistedLinkedInUrl,
                persisted_linkedin_origin: persistedLinkedInOrigin,
                // § G — las cinco etapas del campo, para que «no está» deje de
                // tener cinco causas indistinguibles.
                ...(companyFieldTraces ? { trace: companyFieldTraces.linkedin } : {}),
              },
            }
          : {}),
        ...(companyEmployeeCountBlock
          ? {
              company_employee_count: {
                ...companyEmployeeCountBlock,
                ...(companyFieldTraces ? { trace: companyFieldTraces.employee_count } : {}),
              },
            }
          : {}),
        // § 5 — por qué este candidato cuenta (o no) hacia el target. Persistido
        // no es lo mismo que completo, y aquí queda dicho por candidato.
        ...(providerCompanyFields
          ? {
              target_completeness: {
                counts_toward_target: targetEligibility.countsTowardTarget,
                failed_conditions: targetEligibility.failedConditions,
                base_status: candidateStatus,
                persisted_status: completenessAdjustedStatus,
                // AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 3 — el
                // mismo veredicto que decidió `counts_toward_target`, explícito
                // y auditable sin tener que releer `apollo_enrichment_capture`.
                complete_valid: targetEligibility.completeValid,
                review_only: targetEligibility.reviewOnly,
                review_only_reasons: targetEligibility.reviewOnlyReasons,
                blocking_reasons: targetEligibility.blockingReasons,
                subindustry_requirement_applied: targetEligibility.subindustryRequirementApplied,
                subindustry_mapped: targetEligibility.subindustryMapped,
                subindustry_match: targetEligibility.subindustryMatch,
                // § 5 — la causa CONCRETA, para que la ficha no tenga que
                // deducirla y no pueda mostrar «ambigua» sobre una rechazada.
                subindustry_blocking_reason: targetEligibility.subindustryBlockingReason,
                // § 2 — las subindustrias pedidas y cuál confirmó. Sin esto,
                // auditar una corrida de cinco selecciones exigía reevaluar.
                requested_subindustries: targetEligibility.requestedSubindustries,
                matched_requested_subindustry: targetEligibility.matchedRequestedSubindustry,
                matched_subindustry_family: targetEligibility.matchedSubindustryFamily,
              },
            }
          : {}),
        // AGENT1-APOLLO-SHARED-INTAKE-ADOPTION-1 — whether official-source
        // enrichment was ACTUALLY attempted for this candidate, distinct from
        // the static `catalog_sources` recommendation elsewhere in this
        // object: attempted/source/status/confidence/matched/which legal
        // fields changed, all bounded (no raw registry payload).
        ...(candidate.officialSourceIdentity
          ? { official_source_enrichment: candidate.officialSourceIdentity.officialSourceMetadata }
          : {}),
        // HARDENING § 4 — evidencia de subindustria y procedencia del dato.
        // `prospect_candidates` no tiene columnas para ninguna de las dos, así que
        // viven aquí estructuradas, SIN sustituir a las columnas normales.
        ...(candidate.providerEnrichmentCapture
          ? {
              [APOLLO_ENRICHMENT_PERSISTENCE_METADATA_KEY]:
                toApolloEnrichmentPersistenceMetadata(candidate.providerEnrichmentCapture),
            }
          : {}),
        novelty_check: noveltyResult.noveltyMetadata,
        ...(identityResolution
          ? {
              identity_resolution: {
                ...identityResolution,
                // v1.16K-L: canonical name fields — always present when identity_resolution is set
                ...(canonicalNameResolution.applied
                  ? {
                      canonical_name: canonicalNameResolution.canonicalName,
                      canonical_name_source: canonicalNameResolution.source,
                      canonical_name_applied: true,
                      canonical_name_confidence: canonicalNameResolution.confidence,
                      canonical_name_reason: canonicalNameResolution.reason,
                    }
                  : { canonical_name_applied: false }),
              },
            }
          : {}),
        country_evidence: {
          evidence_level: countryEvidenceResult.evidenceLevel,
          evidence_sources: countryEvidenceResult.evidenceSources,
          ...(countryEvidenceResult.warning
            ? { warning: countryEvidenceResult.warning }
            : {}),
        },
        ...(evidencePolicy.decision !== 'ok' || evidencePolicy.warnings.length > 0
          ? {
              evidence_policy: {
                decision: evidencePolicy.decision,
                primary_reason: evidencePolicy.primaryReason,
                force_review_manually: evidencePolicy.forceReviewManually,
                confidence_cap: evidencePolicy.confidenceCap,
                original_confidence: candidate.scoring.confidenceScore,
                effective_confidence: effectiveConfidenceScore,
                warnings: evidencePolicy.warnings,
              },
            }
          : {}),
        ...(guardMatch.matched && guardMatch.reason === 'same_canonical_identity'
          ? {
              duplicate_guard: {
                matched: true,
                reason: guardMatch.reason,
                matched_candidate_id: guardMatch.matchedCandidateId,
                matched_domain: guardMatch.matchedDomain,
                matched_name: guardMatch.matchedName,
              },
            }
          : {}),
        rich_profile: finalRichProfile,
        ...(perCandidateRichEnrichment ? { rich_profile_enrichment: perCandidateRichEnrichment } : {}),
        icp_size_gate: icpSizeGateResult,
        employee_size_resolution: {
          selected_source: resolvedEmployeeSize.selectedSource,
          selected_value: resolvedEmployeeSize.selectedValue,
          confidence: resolvedEmployeeSize.confidence,
          reason: resolvedEmployeeSize.reason,
          attempted_sources: resolvedEmployeeSize.attemptedSources,
        },
      },
    };

    // ── Q3F-5BB.11F.2 — Apollo candidate provider_trace + source_trace ────────
    // Additive & observational. Mirror of the Lusha 11D per-candidate stamping:
    // stamp `metadata.source_provider` + `metadata.provider_trace` and keep
    // `source_trace.sourceProvider` consistent — ONLY for Apollo COMPANY
    // discovery (web_search_provider === 'apollo_organizations') AND only when
    // 11E already stamped provider_routing. The guard is checked on
    // preMergedMetadata because finalMetadata (which spreads preMergedMetadata)
    // is only assembled AFTER this loop; provider_routing arrives via the 11E
    // extraBatchMetadata seam, so both guards observe the same value. Every
    // other provider path (Tavily / mock / …) leaves candidateInsert
    // byte-for-byte unchanged (no source_trace / provider_trace / source_provider
    // keys). A provider mismatch fails closed via ProviderMetadataConsistencyError
    // rather than silently overwriting provenance. Per-candidate cost stays
    // null/null — batch credits are never split per candidate.
    const apolloProviderTrace = isApolloCompanyDiscoveryRun
      ? buildApolloCandidateProviderTrace()
      : null;

    // Fail-closed consistency check + source_trace derivation via the 11C merge
    // (mirrors Lusha 11D). Agent-1 web candidates carry no prior provider marker,
    // so this adopts 'apollo'; a conflicting existing marker throws
    // ProviderMetadataConsistencyError rather than silently overwriting. The
    // typed provider_trace / source_provider additions come from the concrete
    // trace object (keeping candidate.metadata's precise type for the insert).
    const apolloCandidateSourceTrace = apolloProviderTrace
      ? mergeCandidateProviderMetadata(
          { metadata: candidateInsertBase.metadata, source_trace: undefined },
          apolloProviderTrace,
        ).source_trace
      : null;

    const candidateInsertWithTrace = apolloProviderTrace
      ? {
          ...candidateInsertBase,
          metadata: {
            ...candidateInsertBase.metadata,
            source_provider: apolloProviderTrace.source_provider,
            provider_trace: apolloProviderTrace,
          },
          source_trace: apolloCandidateSourceTrace,
        }
      : candidateInsertBase;

    // § 2 — LinkedIn empresarial en su columna canónica. La columna puede no
    // existir todavía en un entorno donde la migración no se haya aplicado; en
    // ese caso el insert se reintenta SIN ella y el valor sigue vivo en la
    // metadata estructurada. Nunca se pierde un candidato por esto.
    const candidateInsert =
      persistedLinkedInUrl !== null
        ? { ...candidateInsertWithTrace, linkedin_url: persistedLinkedInUrl }
        : candidateInsertWithTrace;

    insertAttempts += 1;

    try {
      let { data: created, error: insertErr } = await admin
        .from("prospect_candidates")
        .insert(candidateInsert)
        .select("id")
        .single();

      if (
        insertErr &&
        persistedLinkedInUrl !== null &&
        isMissingLinkedInUrlColumnError(insertErr)
      ) {
        linkedInColumnFallbackCount += 1;
        const retry = await admin
          .from("prospect_candidates")
          .insert(candidateInsertWithTrace)
          .select("id")
          .single();
        created = retry.data;
        insertErr = retry.error;
      }

      if (insertErr || !created) {
        // § 7 — el motivo que se propaga es un CÓDIGO nuestro, nunca el mensaje
        // del motor. El mensaje crudo (`Could not find the 'identity_key'
        // column of 'prospect_candidates' in the schema cache`) terminaba en
        // `skipped[].reason`, y desde ahí en metadata persistida y en el
        // `failureReason` del provider_attempt.
        const code = classifyCandidatePersistenceError(insertErr);
        const diagnostics = extractDatabaseErrorDiagnostics(insertErr);
        const failureKind = classifyCandidateInsertFailureKind(diagnostics);
        // § 4 — una duplicidad que sólo aparece al chocar con un índice único es
        // un duplicado tardío, no una avería de escritura. Se cuenta como tal
        // para no inflar el hueco de persistencia con un fallo inexistente.
        if (failureKind === 'duplicate') {
          lateDuplicateCount += 1;
        } else {
          persistenceFailures.push({ code, stage: 'candidate_insert' });
          errors.push(`Error al crear candidato: ${code}`);
        }
        skipped.push({
          name: candidate.name,
          reason:
            failureKind === 'duplicate'
              ? 'duplicate_late_unique_conflict'
              : `persistence_failed:${code}`,
          searchTrace: candidate.searchTrace ?? undefined,
        });
        await recordCandidatePersistenceFailure({
          diagnostics,
          errorCode: code,
          name: persistedName,
          domain: domain ?? null,
          identityKey: candidateIdentityKey,
          countryCode: candidate.countryCode ?? null,
        });
        continue;
      }

      createdCandidateIds.push(created.id);
      // § 5 — sólo se contabiliza la completitud de lo que REALMENTE se escribió.
      if (providerCompanyFields) completenessEligibilities.push(targetEligibility);
      // § E — el recuento canónico incluye TODA fila escrita, con campos de
      // proveedor o sin ellos.
      persistedTargetEligibilities.push(targetEligibility);

      // Auditoría: candidate_created
      await admin.from("prospect_candidate_audit").insert({
        batch_id: batchId,
        candidate_id: created.id,
        actor_user_id: triggeredByUserId ?? null,
        action_type: "candidate_created",
        details: {
          name: persistedName,
          source_primary: candidateSourcePrimary,
          quality_label: candidate.scoring.qualityLabel,
          status: candidateStatus,
        },
      });
    } catch (err: unknown) {
      // § 7 — una excepción también es un fallo de persistencia, y su mensaje
      // tampoco se propaga tal cual.
      const code = classifyCandidatePersistenceError(err);
      persistenceFailures.push({ code, stage: 'candidate_insert' });
      errors.push(`Error inesperado al crear candidato: ${code}`);
      skipped.push({
        name: candidate.name,
        reason: `persistence_failed:${code}`,
        searchTrace: candidate.searchTrace ?? undefined,
      });
      await recordCandidatePersistenceFailure({
        diagnostics: extractDatabaseErrorDiagnostics(err),
        errorCode: code,
        name: persistedName,
        domain: domain ?? null,
        identityKey: candidateIdentityKey,
        countryCode: candidate.countryCode ?? null,
      });
    }
  }

  // Determinar status del writer
  const candidatesCreated = createdCandidateIds.length;
  const candidatesSkipped = skipped.length;

  let status: CandidateWriterOutput["status"];
  if (candidatesCreated === 0 && errors.length === 0) {
    // Todos descartados intencionalmente
    status = "success";
  } else if (candidatesCreated === 0) {
    status = "failed";
  } else if (errors.length > 0) {
    status = "partial_success";
  } else {
    status = "success";
  }

  // A1-APOLLO-PERSISTENCE-READINESS-4 § 7/§ 9 — cifras reales de la persistencia
  // y el estado de lote que se deriva de ellas. Se calculan una sola vez y las
  // usan las DOS escrituras de estado de abajo, para que no puedan discrepar.
  // AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 § E — vocabulario canónico de
  // la corrida, calculado UNA vez sobre las filas realmente escritas. Todos los
  // consumidores (resumen, panel, costo, auditoría, reconciliación) leen de
  // aquí para que no pueda haber dos verdades.
  //
  // FORENSICS-1 § 7 — se calcula ANTES del resultado de persistencia porque ese
  // resultado ya lo publica: la UI necesita distinguir «3 filas guardadas» de
  // «3 candidatos completos», y en la corrida `9a9acf99` esas dos cifras eran 3
  // y 0.
  const canonicalCompletenessCounters = buildCandidateCompletenessCounters(
    persistedTargetEligibilities,
  );

  const persistenceOutcome = buildPersistenceOutcome({
    eligibleBeforePersistence: insertAttempts,
    attemptedCount: insertAttempts,
    persistedCandidates: candidatesCreated,
    failures: persistenceFailures,
    lateDuplicateCount,
    completeValidCandidates: canonicalCompletenessCounters.complete_valid_candidates,
    reviewOnlyCandidates: canonicalCompletenessCounters.review_only_candidates,
  });
  // AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-1 § 7 — el estado terminal se
  // decide con la verdad del LOTE, no sólo con `candidatesCreated`.
  //
  // Pasar únicamente lo que escribió este escritor es exactamente el defecto P0
  // G2: un lote que ya contenía 7 filas gratuitas terminaba en `completed` o en
  // `failed` porque la pata de pago insertó 0.
  //
  // § 8 — sin doble conteo: `preExistingDurableCandidates` se leyó ANTES del
  // bucle de inserción, así que las filas de este escritor no están dentro y el
  // total es la suma limpia de las dos cifras.
  const batchDurableTotals = resolveBatchDurableTotals({
    preExisting: preExistingDurableCandidates,
    insertedNow: candidatesCreated,
  });
  const batchStatusDecision = resolveBatchTerminalStatusDecision({
    preExisting: preExistingDurableCandidates,
    persistedCandidates: candidatesCreated,
    persistenceFailureCount: persistenceFailures.length,
  });
  // `preserve` (§ 10) significa que no se pudo determinar qué contenía el lote y
  // este escritor no aportó nada: no hay estado terminal honesto, así que no se
  // escribe ninguno y el lote conserva el que ya tenía. La metadata sí se
  // escribe, con el motivo, para que la corrida no quede muda.
  const batchStatusForOutcome =
    batchStatusDecision.action === 'write' ? batchStatusDecision.status : null;

  // ── Terminal status write (guaranteed) ───────────────────────────────────
  // A batch with 0 persisted candidates must NEVER remain ready_for_review.
  // This runs in its own try-catch so it cannot be swallowed by the metadata
  // computation below. The full metadata update repeats the status write later.
  //
  // § 9 — antes esta corrección sólo cubría «todo descartado a propósito»
  // (`completed`). Un lote con empresas elegibles cuya escritura falló caía por
  // el `else` y se quedaba en `ready_for_review` con cero candidatos: es lo que
  // permitió que LIVE-QA-2 (lote 62fdf47b) se leyera como un vacío normal. Ahora
  // ese caso queda `failed`, que ya existe en el CHECK de `prospect_batches`.
  //
  // CUT-1 CORRECTION § 3 — 🔴 esto ya NO es una «corrección»: es la ÚNICA
  // autoridad de estado del lote, y por eso cubre los TRES estados terminales,
  // `ready_for_review` incluido.
  //
  // Antes se excluía `ready_for_review` a propósito, porque la adopción (path A)
  // y la creación (path B) ya lo habían escrito antes del bucle. Quitada esa
  // escritura prematura de la adopción, excluirlo aquí dejaría un agujero
  // simétrico al que se cierra: un lote adoptado en `generating` que SÍ ganó
  // filas se quedaría en `generating` para siempre. Escribirlo aquí es lo que
  // convierte `{ action: 'write', status: 'ready_for_review' }` en un hecho.
  //
  // Para path B es una reescritura idempotente del mismo valor con el que se
  // insertó la fila, así que su comportamiento histórico no cambia.
  //
  // `preserve` (§ 10) sigue sin escribir NADA: ni aquí ni abajo.
  if (batchStatusForOutcome !== null) {
    let statusWritten = false;
    try {
      const { error: statusWriteError } = await admin
        .from("prospect_batches")
        .update({ status: batchStatusForOutcome })
        .eq("id", batchId);
      statusWritten = !statusWriteError;
      if (statusWriteError) {
        console.error(
          "[candidate-writer] terminal status write failed for batch",
          batchId,
          classifyCandidatePersistenceError(statusWriteError),
        );
      }
    } catch (err) {
      console.error("[candidate-writer] status correction failed for batch", batchId, err);
    }

    // CUT-1 CORRECTION § 4 — la transición se audita AQUÍ y una sola vez, sólo
    // si el estado terminal se escribió de verdad y sólo si hubo transición.
    //
    // Condiciones, todas necesarias:
    //   * `statusWritten` — no se audita un cambio que la base rechazó;
    //   * `adoptedBatchPreviousStatus !== null` — un lote NUEVO no transiciona
    //     desde nada: su creación ya la cuenta `batch_created`;
    //   * el estado anterior y el nuevo son DISTINTOS — reafirmar el mismo valor
    //     no es una transición y no se fabrica una.
    //
    // Con `preserve` no se entra en este bloque, así que el caso «sonda ilegible
    // + 0 inserciones» no deja ninguna auditoría que afirme `ready_for_review`.
    if (
      statusWritten &&
      adoptedBatchPreviousStatus !== null &&
      adoptedBatchPreviousStatus !== batchStatusForOutcome
    ) {
      try {
        await admin.from("prospect_candidate_audit").insert({
          batch_id: batchId,
          candidate_id: null,
          actor_user_id: triggeredByUserId ?? null,
          action_type: "batch_status_changed",
          details: {
            name: finalBatchName,
            source: batchSource,
            generated_by: "agent_1_candidate_writer",
            previous_status: adoptedBatchPreviousStatus,
            new_status: batchStatusForOutcome,
          },
        });
      } catch (err) {
        console.error(
          "[candidate-writer] batch_status_changed audit failed for batch",
          batchId,
          err,
        );
      }
    }
  }

  // ── Post-loop metadata update ─────────────────────────────────────────────
  // Persist real write counts and novelty summary into the batch so the UI
  // can explain why fewer candidates appeared than the pipeline returned.
  try {
    // v1.16K-K FIX 4: add negative_memory_rejected_recently to novelty bucket
    const noveltyReasons = new Set([
      "seen_in_previous_batch_recently",
      "confirmed_duplicate_previous",
      "rejected_recently",
      "negative_memory_rejected_recently",
    ]);
    const noveltySkipped = skipped.filter((s) => noveltyReasons.has(s.reason));
    // § 6 — el desglose por motivo REAL. Cada descarte cae en exactamente una
    // cubeta y la suma es `skipped.length`.
    const skipBreakdown = buildCandidateSkipBreakdown(skipped);
    // § 6 — `quality_skipped_count` deja de absorber decisiones de ownership.
    // Una empresa cuyo dominio no se pudo acreditar no es una empresa de baja
    // calidad, y contarla como tal mandaba a buscar la causa al sitio equivocado:
    // en la corrida `be181d2d` el único descarte era ownership y el resumen decía
    // «calidad». El resto de la cubeta se conserva tal cual estaba.
    // v1.16K-K FIX 3: add content/intermediary gate reasons to quality bucket
    const qualitySkipped = skipped.filter((s) =>
      s.reason === "qualityLabel=discard" ||
      s.reason.startsWith("external_platform:") ||
      s.reason.startsWith("source_url_quality:") ||
      s.reason.startsWith("business_fit:") ||
      s.reason === "content_page" ||
      s.reason === "non_company_phrase" ||
      s.reason === "non_official_source_domain" ||
      s.reason === "country_incompatible" || s.reason.startsWith("country_incompatible:") ||
      s.reason === "blog_content_site" ||
      s.reason === "not_a_direct_vendor" ||
      s.reason === "content_or_intermediary_site",
    );
    const identityGateTotal =
      identityGate.nonCompanyPhraseCount +
      identityGate.seenIdentityCount +
      identityGate.nonOfficialDomainCount;

    const writerSummary = {
      actual_persisted_count: createdCandidateIds.length,
      actual_skipped_count: skipped.length,
      novelty_skipped_count: noveltySkipped.length,
      quality_skipped_count: qualitySkipped.length,
      identity_gate_skipped_count: identityGateTotal,
      created_candidate_ids_count: createdCandidateIds.length,
      // § 6 — el desglose por motivo real. `ownership_rejected_count` ya no vive
      // dentro de `quality_skipped_count`, y las cubetas suman `actual_skipped_count`.
      ...toCandidateSkipBreakdownMetadata(skipBreakdown),
      // § 1 — cuántos elegibles LLEGARON al writer y cuántos quedaron como filas.
      // Son cantidades distintas por definición y aquí se declaran las dos. Se
      // cuentan los candidatos recibidos, no los que alcanzaron el INSERT: el
      // hueco que hay que poder explicar es justo el de los gates intermedios.
      eligible_before_persistence: pipelineOutput.candidates.length,
      insert_attempt_count: insertAttempts,
      // CUT-1 § 8 — aritmética de supervivencia, declarada y auditable. Las dos
      // cifras se publican por separado justamente para que un total inflado se
      // vea: `total` tiene que ser `pre_existing + actual_persisted_count`, ni
      // uno más. `pre_existing_durable_candidates_known` distingue «cero» de «no
      // se pudo leer», que es la conversión que § 10 prohíbe.
      pre_existing_durable_candidates: batchDurableTotals.preExistingDurableCandidates,
      pre_existing_durable_candidates_known: batchDurableTotals.preExistingKnown,
      total_durable_candidates: batchDurableTotals.totalDurableCandidates,
      batch_status_decision: batchStatusDecision.action,
      updated_at: new Date().toISOString(),
    };

    const noveltySummary = {
      skipped_count: noveltySkipped.length,
      skipped_recent_count: noveltySkipped.filter(
        (s) => s.reason === "seen_in_previous_batch_recently"
      ).length,
      skipped_confirmed_duplicate_count: noveltySkipped.filter(
        (s) => s.reason === "confirmed_duplicate_previous"
      ).length,
      skipped_rejected_recently_count: noveltySkipped.filter(
        (s) => s.reason === "rejected_recently"
      ).length,
      // v1.16K-K FIX 4: count candidates blocked by negative memory
      skipped_negative_memory_count: noveltySkipped.filter(
        (s) => s.reason === "negative_memory_rejected_recently"
      ).length,
      skipped_items: noveltySkipped.slice(0, 20).map((s) => ({
        name: s.name,
        domain: s.domain ?? null,
        reason: s.reason,
        previous_batch_ids: s.previous_batch_ids ?? [],
        previous_candidate_ids: s.previous_candidate_ids ?? [],
        search_trace: s.searchTrace ?? null,
      })),
    };

    const projectedPersistableCandidates = pipelineOutput.candidates.length;
    const canonicalTargetMetrics = {
      projected_persistable_candidates: projectedPersistableCandidates,
      persisted_candidates: canonicalCompletenessCounters.persisted_candidates,
      complete_valid_candidates: canonicalCompletenessCounters.complete_valid_candidates,
      review_only_candidates: canonicalCompletenessCounters.review_only_candidates,
      target_count: canonicalCompletenessCounters.target_count,
      persistence_gap:
        projectedPersistableCandidates - canonicalCompletenessCounters.persisted_candidates,
      target_eligible_companies: targetCap ?? pipelineOutput.summary.requested,
      target_reached:
        (targetCap ?? pipelineOutput.summary.requested) > 0 &&
        canonicalCompletenessCounters.target_count >=
          (targetCap ?? pipelineOutput.summary.requested),
      failed_condition_counts: canonicalCompletenessCounters.failed_condition_counts,
    };

    const pipelineSummaryPostWrite = {
      requested: pipelineOutput.summary.requested,
      persisted: createdCandidateIds.length,
      skipped: skipped.length,
      returned_before_writer: pipelineOutput.summary.returned,
      // § E — antes esto repetía el total de filas, así que decía «5 para
      // revisión» aunque 2 estuvieran completas. Ahora nombra sólo las que de
      // verdad quedaron pendientes de revisión.
      needs_review_persisted: canonicalCompletenessCounters.review_only_candidates,
      complete_valid_persisted: canonicalCompletenessCounters.complete_valid_candidates,
    };

    // A1-APOLLO-LINKEDIN-EMPLOYEES-1 § 5 — contadores SEPARADOS. `persisted` ya
    // no puede leerse como «candidatos completos»: un candidato sin LinkedIn o
    // sin número de empleados se persiste con `needs_review` y queda fuera de
    // `target_count`.
    const companyFieldsCompleteness =
      completenessEligibilities.length > 0
        ? {
            ...buildCandidateCompletenessCounters(completenessEligibilities),
            target: targetCap ?? pipelineOutput.summary.requested,
            linkedin_url_column_fallback_count: linkedInColumnFallbackCount,
            // § G — `column` es el estado que una QA puede certificar: la columna
            // existe y el valor está en ella. `metadata_only` sigue siendo un
            // estado válido durante un despliegue gradual, pero no certifica nada.
            linkedin_persistence_mode:
              linkedInColumnFallbackCount > 0 ? 'metadata_only' : 'column',
          }
        : undefined;

    const canonicalIdentityGate = {
      enabled: true,
      non_company_phrase_exclusions: identityGate.nonCompanyPhraseCount,
      seen_identity_exclusions: identityGate.seenIdentityCount,
      non_official_domain_exclusions: identityGate.nonOfficialDomainCount,
      total_exclusions: identityGateTotal,
      samples: identityGate.samples,
    };

    const precisionGateMetadata = {
      enabled: true,
      content_page_exclusions: precisionGate.contentPageCount,
      intra_batch_duplicates_removed: precisionGate.intraBatchDuplicateCount,
      country_incompatible_exclusions: precisionGate.countryIncompatibleCount,
      generic_name_exclusions: precisionGate.genericNameCount,
      target_cap_exclusions: precisionGate.targetCapCount,
      ...(intraBatchDupeSamples.length > 0
        ? { intra_batch_identity_dedupe: { enabled: true, duplicates_removed: precisionGate.intraBatchDuplicateCount, samples: intraBatchDupeSamples } }
        : {}),
    };

    const targetCapMetadata = targetCap != null
      ? {
          enabled: true,
          target: targetCap,
          eligible_before_cap: eligibleBeforeCap,
          persisted_after_cap: createdCandidateIds.length,
          capped_count: precisionGate.targetCapCount,
        }
      : undefined;

    // Reconcile adaptive_discovery with actual persisted count (Hito 16AB.43.28).
    // extraBatchMetadata.adaptive_discovery was set as a placeholder before the writer ran.
    // Here we overwrite it with the real persisted count so the DB reflects truth.
    // Hito 16AB.43.30: also fix stop_reason to be coherent with actual result.
    const storedAdaptive = (extraBatchMetadata as Record<string, unknown> | null)?.['adaptive_discovery'] as Record<string, unknown> | undefined;
    const reconciledAdaptiveForStorage = storedAdaptive != null && targetCap != null
      ? (() => {
          const persisted = createdCandidateIds.length;
          const remaining = Math.max(0, targetCap - persisted);
          const roundsExecuted = (storedAdaptive.rounds_executed as number) ?? 0;
          const maxRounds = (storedAdaptive.max_rounds as number) ?? 0;

          // Determine coherent stop_reason based on actual outcome
          let coherentStopReason: string;
          if (persisted >= targetCap) {
            coherentStopReason = 'target_reached';
          } else if (roundsExecuted >= maxRounds) {
            coherentStopReason = 'max_rounds_exhausted';
          } else {
            coherentStopReason = (storedAdaptive.stop_reason as string) ?? 'max_rounds_exhausted';
          }

          let resultStatus: string;
          if (persisted >= targetCap) {
            resultStatus = 'success_target_reached';
          } else if (persisted > 0) {
            resultStatus = 'success_partial';
          } else {
            resultStatus = 'no_new_candidates';
          }

          return {
            ...storedAdaptive,
            persisted_count: persisted,
            remaining_to_target: remaining,
            stop_reason: coherentStopReason,
            result_status: resultStatus,
          };
        })()
      : storedAdaptive;

    // Source URL quality gate metadata (Hito 16AB.43.29)
    const sourceUrlQualityGateMetadata = {
      enabled: true,
      blocked_count: sourceUrlQualityGate.blockedCount,
      blocked_by_type: sourceUrlQualityGate.blockedByType,
      samples: sourceUrlQualityGate.samples.slice(0, 5),
    };

    // Business fit gate metadata (Hito 16AB.43.29)
    const businessFitGateMetadata = {
      enabled: true,
      rejected_count: businessFitGateData.rejectedCount,
      low_fit_count: businessFitGateData.lowFitCount,
      medium_fit_count: businessFitGateData.mediumFitCount,
      high_fit_count: businessFitGateData.highFitCount,
      samples: businessFitGateData.samples.slice(0, 5),
    };

    // Evidence persistence policy gate metadata (Hito v1.5)
    const evidencePolicyGateMetadata = {
      enabled: true,
      blocked_count: evidencePolicyGateData.blockedCount,
      confidence_capped_count: evidencePolicyGateData.confidenceCapCount,
      samples: evidencePolicyGateData.samples.slice(0, 5),
    };

    // External platform gate metadata (Hito 16AB.43.30)
    const externalPlatformGateMetadata = {
      enabled: true,
      blocked_count: externalPlatformGateData.blockedCount,
      blocked_by_type: externalPlatformGateData.blockedByType,
      samples: externalPlatformGateData.samples.slice(0, 5),
    };

    // Company ownership gate metadata (Hito 16AB.43.30)
    const companyOwnershipGateMetadata = {
      enabled: true,
      blocked_count: companyOwnershipGateData.blockedCount,
      low_confidence_count: companyOwnershipGateData.lowConfidenceCount,
      samples: companyOwnershipGateData.samples.slice(0, 5),
    };

    // Tavily usage reconciliation metadata (Hito 16AB.43.30 / 16AB.43.31)
    // Reconciliación basada en provider_usage_logs reales. Consulta la tabla
    // provider_usage_logs por batch_id para obtener los valores reales de
    // créditos consumidos y queries ejecutadas. Fallback a pipeline metadata
    // si no hay logs disponibles o si la consulta falla.
    const tavilyUsageReconciliation = await (async () => {
      let logsCount = 0;
      let creditsUsedLogged = 0;
      let queriesPlannedTotal = 0;
      let queriesExecutedTotal = 0;
      let successfulQueryCountTotal = 0;
      let failedQueryCountTotal = 0;
      let logsAvailable = false;

      try {
        const { data: usageLogs, error: logsError } = await admin
          .from('provider_usage_logs')
          .select('credits_used, metadata')
          .eq('batch_id', batchId)
          .eq('provider_key', 'tavily')
          .eq('operation_key', 'multi_query_web_search');

        if (!logsError && Array.isArray(usageLogs) && usageLogs.length > 0) {
          logsAvailable = true;
          logsCount = usageLogs.length;

          for (const log of usageLogs) {
            const credits = typeof log.credits_used === 'number' ? log.credits_used : 0;
            creditsUsedLogged += credits;

            const meta = (log.metadata ?? {}) as Record<string, unknown>;
            const planned = typeof meta.queries_planned === 'number' ? meta.queries_planned : 0;
            const executed = typeof meta.queries_executed === 'number' ? meta.queries_executed : 0;
            const successful = typeof meta.successful_query_count === 'number' ? meta.successful_query_count : 0;
            const failed = typeof meta.failed_query_count === 'number' ? meta.failed_query_count : 0;

            queriesPlannedTotal += planned;
            queriesExecutedTotal += executed;
            successfulQueryCountTotal += successful;
            failedQueryCountTotal += failed;
          }
        }
      } catch {
        // Non-critical: fall back to pipeline metadata
      }

      if (!logsAvailable) {
        // Fallback: calculate from pipeline metadata
        const queriesExecuted = (() => {
          const qe = pipelineMeta?.queries_executed;
          return Array.isArray(qe) ? (qe as string[]) : [];
        })();
        queriesExecutedTotal = queriesExecuted.length;
        creditsUsedLogged = pipelineMeta?.tavily_credits_used != null
          ? (pipelineMeta.tavily_credits_used as number)
          : queriesExecutedTotal;
        logsCount = pipelineMeta?.provider_usage_logs_count != null
          ? (pipelineMeta.provider_usage_logs_count as number)
          : queriesExecutedTotal;
        queriesPlannedTotal = queriesExecutedTotal;
        successfulQueryCountTotal = pipelineMeta?.successful_queries_count as number ?? queriesExecutedTotal;
        failedQueryCountTotal = pipelineMeta?.failed_queries_count as number ?? 0;
      }

      const creditsPerQuery = queriesExecutedTotal > 0
        ? Math.round(creditsUsedLogged / queriesExecutedTotal)
        : 1;
      const expectedCredits = queriesExecutedTotal * creditsPerQuery;
      const reconStatus = expectedCredits === creditsUsedLogged ? 'matched' : 'mismatch';
      return {
        enabled: true,
        logs_count: logsCount,
        queries_planned_total: queriesPlannedTotal,
        queries_executed_total: queriesExecutedTotal,
        successful_query_count_total: successfulQueryCountTotal,
        failed_query_count_total: failedQueryCountTotal,
        credits_per_query: creditsPerQuery,
        credits_used_logged: creditsUsedLogged,
        expected_credits_from_queries: expectedCredits,
        reconciliation_status: reconStatus,
      };
    })();

    const recallRecoveryGateMetadata = {
      enabled: true,
      domain_inferred_identity_count: recallRecoveryGate.domain_inferred_identity_count,
      ownership_recovered_count: recallRecoveryGate.ownership_recovered_count,
      soft_memory_allowed_count: recallRecoveryGate.soft_memory_allowed_count,
      hard_negative_memory_blocked_count: recallRecoveryGate.hard_negative_memory_blocked_count,
      samples: recallRecoveryGate.samples.slice(0, 10),
    };

    const duplicateGuardMetadata = {
      enabled: true,
      checked_count: duplicateGuardData.checkedCount,
      skipped_count: duplicateGuardData.skippedCount,
      possible_duplicate_count: duplicateGuardData.possibleDuplicateCount,
      samples: duplicateGuardData.samples.slice(0, 10),
      // Q3F-5AW.2 (Phase 1) — observabilidad del prefetch fail-open (no bloquea).
      active_candidate_guard_status: duplicateGuardData.prefetchStatus,
      active_candidate_guard_reason: duplicateGuardData.prefetchReason,
    };

    // ── § 1 — la verdad de la persistencia sobre la proyección ───────────────
    //
    // La observabilidad de dos rondas se construye ANTES del writer, así que su
    // `persisted_candidates` es una PROYECCIÓN del ranking del orquestador, no un
    // recuento de filas. Aquí, con las filas ya escritas, se reescribe con la
    // verdad y se deja constancia del hueco y de su causa.
    //
    // El desglose de causas sale del mismo `skipBreakdown` del § 6: el hueco se
    // explica con los motivos REALES de los descartes, no con una atribución
    // plausible. Lo que ninguna cubeta explique queda como `unexplained_gap`.
    const twoRoundReconciled = reconcileApolloTwoRoundPersistedTruth(
      (preMergedMetadata as Record<string, unknown>)[APOLLO_TWO_ROUND_OBSERVABILITY_KEY],
      {
        eligibleBeforePersistence: pipelineOutput.candidates.length,
        persistedCandidates: createdCandidateIds.length,
        // § E — el objetivo se decide contra las empresas COMPLETAS Y VÁLIDAS,
        // no contra el total de filas: desde el § D hay filas persistidas que
        // existen sólo para revisión.
        completeValidCandidates: canonicalCompletenessCounters.complete_valid_candidates,
        gapCauses: {
          ownership_rejected: skipBreakdown.ownership_rejected,
          quality_rejected: skipBreakdown.quality_rejected,
          sector_rejected: skipBreakdown.sector_rejected,
          country_rejected: skipBreakdown.country_rejected,
          duplicate_hubspot: skipBreakdown.duplicate_hubspot,
          duplicate_sellup: skipBreakdown.duplicate_sellup,
          cooldown_or_prior_suggestion: skipBreakdown.cooldown,
          novelty_rejected: skipBreakdown.novelty_rejected,
          identity_gate_rejected: skipBreakdown.identity_gate_rejected,
          persistence_failed: skipBreakdown.persistence_failed,
        },
        targetEligibleCompanies: pipelineOutput.summary.requested,
      },
    );

    const finalMetadata = {
      ...preMergedMetadata,
      ...(twoRoundReconciled
        ? { [APOLLO_TWO_ROUND_OBSERVABILITY_KEY]: twoRoundReconciled.observability }
        : {}),
      // § E — el resumen del writer publica las tres cifras separadas. Antes sólo
      // publicaba `created_candidate_ids_count`, que cualquiera podía leer como
      // «empresas válidas».
      writer_summary: {
        ...writerSummary,
        complete_valid_candidates: canonicalTargetMetrics.complete_valid_candidates,
        review_only_candidates: canonicalTargetMetrics.review_only_candidates,
        target_count: canonicalTargetMetrics.target_count,
        persistence_gap: canonicalTargetMetrics.persistence_gap,
        // FORENSICS-1 § 7 — éxito parcial con nombre propio. `persistence_failed`
        // por sí solo no distingue «no se guardó nada» de «se guardaron 3 de 4».
        persistence_status: persistenceOutcome.persistenceStatus,
        persistence_attempted_count: persistenceOutcome.persistenceAttemptedCount,
        persistence_succeeded_count: persistenceOutcome.persistenceSucceededCount,
        persistence_failed_count: persistenceOutcome.persistenceFailedCount,
        late_duplicate_count: lateDuplicateCount,
      },
      // A1-APOLLO-PERSISTENCE-READINESS-4 § 7 — cifras sanitizadas del resultado
      // de la escritura. Sin stack, sin SQL, sin mensaje del motor: sólo enteros
      // y uno de dos códigos conocidos.
      [CANDIDATE_PERSISTENCE_OUTCOME_METADATA_KEY]:
        toCandidatePersistenceOutcomeMetadata(persistenceOutcome),
      novelty_summary: noveltySummary,
      pipeline_summary_post_write: pipelineSummaryPostWrite,
      // § E — bloque canónico de la corrida. Existe para toda modalidad, no sólo
      // para Apollo dos rondas: cualquier consumidor que pregunte «cuántas
      // cuentan» tiene una única respuesta y no la deduce del total de filas.
      [CANDIDATE_TARGET_METRICS_METADATA_KEY]: canonicalTargetMetrics,
      ...(companyFieldsCompleteness
        ? { company_fields_completeness: companyFieldsCompleteness }
        : {}),
      canonical_identity_gate: canonicalIdentityGate,
      precision_gate: precisionGateMetadata,
      source_url_quality_gate: sourceUrlQualityGateMetadata,
      business_fit_gate: businessFitGateMetadata,
      external_platform_gate: externalPlatformGateMetadata,
      company_ownership_gate: companyOwnershipGateMetadata,
      evidence_policy_gate: evidencePolicyGateMetadata,
      recall_recovery_gate: recallRecoveryGateMetadata,
      duplicate_guard: duplicateGuardMetadata,
      tavily_usage_reconciliation: tavilyUsageReconciliation,
      // v1.16K-K FIX 5: detailed omitted samples for post-run auditing
      writer_omitted_samples: writerOmittedSamples,
      ...(websiteExtractionBatchSummary ? { linkedin_search: { website_extraction: websiteExtractionBatchSummary, ...(linkedInBatchSearchMetadata ?? {}) } } : linkedInBatchSearchMetadata ? { linkedin_search: linkedInBatchSearchMetadata } : {}),
      ...(targetCapMetadata ? { target_cap: targetCapMetadata } : {}),
      ...(reconciledAdaptiveForStorage != null ? { adaptive_discovery: reconciledAdaptiveForStorage } : {}),
      ...(richProfileBatchMetadata
        ? {
            rich_profile_enrichment: {
              ...richProfileBatchMetadata,
              usage_logged: richProfileUsageLogSuccessCount > 0,
              usage_log_success_count: richProfileUsageLogSuccessCount,
              usage_log_failed_count: richProfileUsageLogFailedCount,
            },
          }
        : {}),
      icp_size_gate_summary: {
        threshold: 200,
        pass_count: icpSizeGateData.passCount,
        needs_validation_count: icpSizeGateData.needsValidationCount,
        blocked_count: icpSizeGateData.blockedCount,
        blocked_reasons: icpSizeGateData.blockedReasons,
      } satisfies IcpSizeGateBatchSummary,
    };

    // ── Q3F-5BB.11F.1 — Apollo batch provider_attempts[] (OBSERVATIONAL) ──────
    // Additive: emit metadata.provider_attempts[] ONLY for Apollo COMPANY
    // discovery (web_search_provider === 'apollo_organizations') AND only when
    // 11E already stamped metadata.provider_routing. Every other provider path
    // (Tavily / mock / …) leaves the metadata byte-for-byte unchanged. Costs are
    // reconciled strictly from provider_usage_logs (organizations_search only);
    // unknown credit spend stays null (never 0) and estimated_cost_usd is null.
    let metadataToPersist: Record<string, unknown> = finalMetadata;
    if (
      shouldEmitApolloBatchProviderAttempts({
        webSearchProvider: pipelineMeta?.provider,
        hasProviderRouting:
          (finalMetadata as Record<string, unknown>)[BATCH_PROVIDER_ROUTING_KEY] != null,
      })
    ) {
      const apolloCreditsUsed = await reconcileApolloOrganizationsCredits(admin, batchId);
      const apolloAttempt = buildApolloBatchProviderAttempt({
        writerStatus: status,
        rawCount:
          typeof pipelineMeta?.total_raw_evaluated === "number"
            ? (pipelineMeta.total_raw_evaluated as number)
            : null,
        normalizedCount:
          typeof pipelineOutput.summary?.returned === "number"
            ? pipelineOutput.summary.returned
            : null,
        gateExcludedCount: qualitySkipped.length + identityGateTotal,
        exactDuplicateCount: precisionGate.intraBatchDuplicateCount,
        possibleDuplicateCount: duplicateGuardData.possibleDuplicateCount,
        persistedCount: createdCandidateIds.length,
        creditsUsed: apolloCreditsUsed,
        failureReason: errors.length > 0 ? errors[0] : null,
      });
      metadataToPersist = mergeProviderAttemptsBatchMetadata(finalMetadata, [apolloAttempt]);
    }

    // ── § 7 — sellado terminal ────────────────────────────────────────────
    //
    // `batchStatusForOutcome` es siempre terminal (`ready_for_review`,
    // `completed` o `failed`): la corrida ya no va a avanzar por sí sola. Aun así
    // el lote `e1622574…` quedó con `completed_at = null` porque nadie lo
    // escribía, y una corrida sin fecha de cierre no se puede ordenar, medir ni
    // comparar con las demás.
    //
    // Viaja en la MISMA escritura que la metadata, no en una aparte: el estado y
    // su fecha de cierre describen el mismo hecho y separarlos abre una ventana
    // en la que el lote está terminal y sin sellar.
    //
    // Idempotente: una marca previa se respeta siempre y la decisión no depende
    // de este proceso, sino de lo que la fila ya tenía.
    //
    // CUT-1 § 10 — con `preserve` no hay estado terminal: la corrida no puede
    // afirmar que terminó de ninguna manera concreta, así que tampoco se sella
    // una fecha de cierre. Se escribe metadata y nada más.
    const completionSeal =
      batchStatusForOutcome !== null
        ? decideBatchCompletionSeal({
            status: batchStatusForOutcome,
            currentCompletedAt: existingCompletedAt,
            now,
          })
        : { shouldWrite: false as const, completedAt: null };
    const completedAtPatch =
      completionSeal.shouldWrite && completionSeal.completedAt !== null
        ? { completed_at: completionSeal.completedAt }
        : {};

    if (batchStatusForOutcome !== null) {
      // `ready_for_review` — CUT-1 CORRECTION § 3: hay contenido durable, sea
      //               heredado del lote o insertado por este contribuyente. Ya
      //               no se da por hecho que otra escritura anterior lo puso.
      // `completed` — todos los candidatos se descartaron a propósito
      // (historial / calidad): no hay contenido nuevo que revisar.
      // `failed`    — § 9: había elegibles y la escritura falló. El lote NO puede
      //               quedarse en `ready_for_review` con cero candidatos dentro.
      await admin
        .from("prospect_batches")
        .update({
          status: batchStatusForOutcome,
          metadata: metadataToPersist,
          ...completedAtPatch,
        })
        .eq("id", batchId);
    } else {
      // `preserve` (§ 10) — se escribe metadata (con el motivo) y NADA de estado:
      // el lote conserva el `draft` / `generating` que ya tenía.
      await admin
        .from("prospect_batches")
        .update({ metadata: metadataToPersist, ...completedAtPatch })
        .eq("id", batchId);
    }
  } catch (err) {
    // Non-critical: metadata update failure does not affect the writer result.
    // CUT-1 CORRECTION § 3 — el estado terminal ya lo escribió arriba la
    // escritura garantizada, para los TRES estados. Que esta escritura de
    // metadata falle no puede dejar el lote sin estado terminal.
    console.error("[candidate-writer] post-loop metadata update failed for batch", batchId, err);
  }

  return {
    dryRun: false,
    batchId,
    candidatesCreated,
    candidatesSkipped,
    createdCandidateIds,
    skipped,
    status,
    errors,
    persistence: persistenceOutcome,
  };
}

// ─── Helper de alto nivel ─────────────────────────────────────────────────────

/**
 * Ejecuta el pipeline y persiste los resultados en un solo paso.
 * Combina runProspectingPipeline + writeProspectingCandidates.
 */
export async function runAndWriteProspectingPipeline(
  input: ProspectingPipelineInput & {
    triggeredByUserId?: string | null;
    ownerId?: string | null;
    batchName?: string | null;
    dryRun?: boolean;
    extraBatchMetadata?: Record<string, unknown> | null;
    linkedInSearchOverride?: LinkedInSearchOverride;
    richProfileEnrichmentOverride?: RichProfileEnrichmentOverride;
  }
): Promise<ProspectingPipelineWriteOutput> {
  const pipelineOutput: ProspectingPipelineOutput = await runProspectingPipeline(input);

  const writer = await writeProspectingCandidates(
    {
      pipelineOutput,
      triggeredByUserId: input.triggeredByUserId ?? null,
      ownerId: input.ownerId ?? null,
      batchName: input.batchName ?? null,
      source: "agent_1",
      dryRun: input.dryRun ?? false,
      extraBatchMetadata: input.extraBatchMetadata ?? null,
    },
    undefined,
    input.linkedInSearchOverride,
    input.richProfileEnrichmentOverride,
  );

  return { pipeline: pipelineOutput, writer };
}
