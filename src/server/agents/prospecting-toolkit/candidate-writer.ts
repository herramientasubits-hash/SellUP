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
import { evaluateCountryCompatibility, countryCompatibilityRankWeight } from "./country-compatibility";
import { classifySourceUrlQuality, isBlockedBySourceUrlQuality } from "./source-url-quality-gate";
import { evaluateBusinessFit, isBlockedByBusinessFit } from "./business-fit-gate";
import type { BusinessFitResult } from "./business-fit-gate";
import { evaluateExternalPlatformGate } from "./external-platform-blocklist";
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
  CandidateQualityLabel,
  ProspectingPipelineCandidate,
  ProspectingPipelineInput,
  ProspectingPipelineOutput,
  ProspectingPipelineWriteOutput,
} from "./types";

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

// ─── Content-page gate (Hito 16AB.43.28) ──────────────────────────────────────
//
// Detecta URLs cuyo path indica una página de contenido, artículo, caso de éxito
// o blog en lugar de una homepage corporativa de una empresa real.
// Operación completamente local — sin IA, sin llamadas externas.

const CONTENT_PAGE_PATH_PATTERNS = [
  'casos-exito',                          // /nosotros/casos-exito, /casos-exito
  'caso-de-exito',                        // /caso-de-exito-...
  'casos-de-exito',                       // /3-casos-de-exito-..., /casos-de-exito
  '/academia/',                           // /academia/conceptos/...
  '/actualidad/',                         // /actualidad/nuestros-expertos/...
  '/nuestros-expertos/',                  // /nuestros-expertos/...
  '/blog/',                               // artículos de blog
  '/articulo/',                           // artículos editoriales
  '/article/',                            // artículos en inglés
  '/guide/',                              // guías
  '/full-guide/',                         // guías completas
  'nearshore-software-development',       // artículos tipo "nearshore software development Colombia"
];

const CONTENT_PAGE_NAME_PATTERNS = [
  /^casos\s+de\s+[eé]xito/i,             // "Casos de éxito Línea Datascan"
  /^caso\s+de\s+[eé]xito/i,              // "Caso de éxito ..."
  /^full\s+guide$/i,                     // "Full guide"
  /^fases\s+y\s+beneficios/i,            // "Fases y beneficios..."
  /^\d+\s+casos\s+de\s+[eé]xito/i,       // "3 casos de éxito..."
  /^nearshore\s+software/i,              // "Nearshore software development..."
];

/**
 * Retorna true si la URL tiene un path que indica página de contenido/artículo,
 * no una homepage corporativa.
 */
export function isContentPageUrl(website: string | null): boolean {
  if (!website) return false;
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const pathname = new URL(url).pathname.toLowerCase();
    return CONTENT_PAGE_PATH_PATTERNS.some((p) => pathname.includes(p));
  } catch {
    return false;
  }
}

/**
 * Retorna true si el nombre del candidato parece un título de artículo/caso de éxito
 * en lugar del nombre de una empresa real.
 */
export function isContentPageName(name: string): boolean {
  return CONTENT_PAGE_NAME_PATTERNS.some((p) => p.test(name.trim()));
}

// ─── Path depth helper ────────────────────────────────────────────────────────

/**
 * Número de segmentos de path en la URL. Menor → más cercano a la raíz.
 * Se usa como tiebreaker en el ordenamiento de elegibles.
 */
function pathDepth(website: string | null): number {
  if (!website) return 999;
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    const { pathname } = new URL(url);
    return pathname.split('/').filter((s) => s.length > 0).length;
  } catch {
    return 999;
  }
}

// ─── Official website gate ────────────────────────────────────────────────────
//
// Dominios que son directorios, catálogos, marketplaces o rankings.
// Un candidato cuyo dominio de website sea uno de estos no debe persistirse
// como empresa oficial, ya que no tiene sitio propio identificable.
// Hito 16AB.43.25.

const DIRECTORY_SOURCE_DOMAINS = new Set([
  // Catálogos de software
  'catalogodesoftware.com',
  'comparasoftware.com',
  'comparasoftware.co',
  'capterra.com',
  'capterra.co',
  'g2.com',
  'getapp.com',
  'softwareadvice.com',
  'trustradius.com',
  'softwareworld.co',
  'crozdesk.com',
  'alternativeto.net',
  'producthunt.com',
  'techbehemoths.com',
  'clutch.co',
  'goodfirms.co',
  'sortlist.com',
  'designrush.com',
  // Directorios empresariales
  'guiatic.com',
  'yelp.com',
  'paginasamarillas.com.co',
  'einforma.com',
  'einforma.co',
  'datacreditoempresas.com.co',
  'lasempresas.com.co',
  'connectamericas.com',
  // Plataformas sociales
  'linkedin.com',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  // Portales de empleo
  'computrabajo.com',
  'indeed.com',
  'glassdoor.com',
]);

/**
 * Retorna true si el dominio pertenece a un directorio/catálogo/marketplace,
 * lo que indica que el candidato no tiene sitio oficial propio identificable.
 */
function isDirectorySourceDomain(domain: string | null): boolean {
  if (!domain) return false;
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (DIRECTORY_SOURCE_DOMAINS.has(d)) return true;
  for (const entry of DIRECTORY_SOURCE_DOMAINS) {
    if (d.endsWith(`.${entry}`)) return true;
  }
  return false;
}

// ─── Active duplicate guard — prefetch helper ─────────────────────────────────

const ACTIVE_STATUSES_FOR_GUARD = [
  'needs_review', 'approved', 'converted', 'ready_for_review',
  'draft', 'generating', 'pending', 'active', 'ready', 'in_progress',
];

/**
 * Carga candidatos activos relevantes desde Supabase para el Active Duplicate Guard.
 *
 * Hace dos consultas acotadas:
 *   1. Por dominio exacto (para detectar same_active_domain cross-country)
 *   2. Por country_code (para detectar same_inferred_identity dentro del país)
 *
 * Diseñado para degradar silenciosamente si la query falla o si el cliente
 * no soporta el método (e.g., fake admin en tests) — retorna [] en ese caso.
 */
async function fetchActiveCandidatesForGuard(
  admin: SupabaseClient,
  batchDomains: string[],
  countryCode: string | null,
): Promise<ActiveCandidateRecord[]> {
  try {
    const result: ActiveCandidateRecord[] = [];
    const seenIds = new Set<string>();

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
      const { data: byDomain } = await (admin as ReturnType<typeof import('@supabase/supabase-js').createClient>)
        .from('prospect_candidates')
        .select('id, name, domain, normalized_name, metadata, status')
        .in('status', ACTIVE_STATUSES_FOR_GUARD)
        .in('domain', batchDomains)
        .limit(500);

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
      const { data: byCountry } = await (admin as ReturnType<typeof import('@supabase/supabase-js').createClient>)
        .from('prospect_candidates')
        .select('id, name, domain, normalized_name, metadata, status')
        .in('status', ACTIVE_STATUSES_FOR_GUARD)
        .eq('country_code', countryCode)
        .limit(500);

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

    return result;
  } catch {
    // Non-critical: guard degrades gracefully if prefetch fails
    return [];
  }
}

// ─── Mapeos ───────────────────────────────────────────────────────────────────

/**
 * Mapea DuplicateStatus del toolkit al duplicate_status del schema DB.
 * El toolkit usa valores distintos a los del schema de Supabase.
 */
function mapDuplicateStatus(status: DuplicateStatus): string {
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

/**
 * Mapea qualityLabel del scorer al status de prospect_candidates.
 * Retorna null para labels que deben omitirse (discard).
 *
 * Mapeo:
 *   high_quality_new → needs_review
 *   needs_review     → needs_review
 *   duplicate        → duplicate
 *   insufficient_data→ needs_review (con nota, se conserva para trazabilidad)
 *   discard          → null (no se crea candidato)
 */
function mapQualityLabelToStatus(label: CandidateQualityLabel): string | null {
  switch (label) {
    case "high_quality_new":
      return "needs_review";
    case "needs_review":
      return "needs_review";
    case "duplicate":
      return "duplicate";
    case "insufficient_data":
      return "needs_review";
    case "discard":
      return null;
    default:
      return "needs_review";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeName(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDomain(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = website.startsWith("http") ? website : `https://${website}`;
    const { hostname } = new URL(url);
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isValidUuid(val: string | null | undefined): boolean {
  if (!val) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
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
};

export async function writeProspectingCandidates(
  input: CandidateWriterInput,
  // For testing only: inject an admin client instead of reading env vars.
  // Production callers always omit this parameter.
  adminClientOverride?: SupabaseClient,
  // For testing only: override LinkedIn search config and provider.
  // Production callers always omit this parameter (feature disabled by default).
  linkedInSearchOverride?: LinkedInSearchOverride,
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
    };
  }

  // ── Write real ────────────────────────────────────────────────────────────
  const admin = adminClientOverride ?? getAdminClient();
  const errors: string[] = [];
  const createdCandidateIds: string[] = [];
  const skipped: CandidateWriterSkipped[] = [];

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

  const batchMetadata: Record<string, unknown> = {
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
    ...(extraBatchMetadata ?? {}),
  };

  // ── Resolve or create batch ───────────────────────────────────────────────
  // preMergedMetadata: metadata used for the batch row and later for the
  // post-loop update. When reusing an existing batch, it merges the
  // previously-stored wizard metadata (preserved) with the pipeline metadata
  // (added). When creating a new batch it is identical to batchMetadata.
  let batchId: string;
  let preMergedMetadata: Record<string, unknown> = batchMetadata;

  if (existingBatchId) {
    // ── Path A: reuse an existing batch ────────────────────────────────────
    // Validate then UPDATE; throw CandidateWriterBatchValidationError before
    // any write if the batch is not eligible.

    const { data: existingBatch, error: selectError } = await admin
      .from("prospect_batches")
      .select("id, status, source, created_by, owner_id, metadata, client_request_id")
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

    // Merge metadata: wizard fields (preserved) + pipeline fields (added/overwritten).
    // Wizard keys (request_source, catalog_version_id, industry_id, etc.) do not
    // overlap with pipeline keys (generated_by, pipeline_version, etc.) so a
    // shallow spread is sufficient and safe.
    const existingMeta = (existingBatch.metadata ?? {}) as Record<string, unknown>;
    preMergedMetadata = { ...existingMeta, ...batchMetadata };

    // UPDATE the existing batch to ready_for_review with merged metadata.
    // created_by, owner_id, client_request_id and created_at are NOT touched.
    const { error: updateError } = await admin
      .from("prospect_batches")
      .update({
        name: finalBatchName,
        country,
        country_code: countryCode,
        industry,
        target_count: pipelineOutput.summary.requested,
        search_depth: pipelineOutput.input.searchDepth ?? "standard",
        status: "ready_for_review",
        metadata: preMergedMetadata,
      })
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
        errors: [`Error al actualizar lote existente: ${updateError.message ?? "unknown"}`],
      };
    }

    batchId = existingBatchId;

    // Audit: record the status transition (draft → ready_for_review)
    await admin.from("prospect_candidate_audit").insert({
      batch_id: batchId,
      candidate_id: null,
      actor_user_id: triggeredByUserId ?? null,
      action_type: "batch_status_changed",
      details: {
        name: finalBatchName,
        source: batchSource,
        generated_by: "agent_1_candidate_writer",
        previous_status: existingBatch.status,
        new_status: "ready_for_review",
      },
    });

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
        errors: [`Error al crear lote: ${batchError?.message ?? "unknown"}`],
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
  type BusinessFitSample = { name: string; reason: string; url: string | null; fit: string };
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
  };

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
  };
  const eligibleEntries: EligibleEntry[] = [];

  for (const candidate of pipelineOutput.candidates) {
    const candidateStatus = mapQualityLabelToStatus(candidate.scoring.qualityLabel);

    if (candidateStatus === null) {
      skipped.push({ name: candidate.name, reason: "qualityLabel=discard", searchTrace: candidate.searchTrace ?? undefined });
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
      continue;
    }

    const effectiveDomain = candidate.domain ?? extractDomain(candidate.website);
    if (isDirectorySourceDomain(effectiveDomain)) {
      skipped.push({ name: candidate.name, reason: "non_official_source_domain", searchTrace: candidate.searchTrace ?? undefined });
      identityGate.nonOfficialDomainCount++;
      if (identityGate.samples.length < 10) {
        identityGate.samples.push({ name: candidate.name, reason: "non_official_source_domain" });
      }
      continue;
    }

    // ── Country compatibility gate (Hito 16AB.43.27) ─────────────────────────
    const urlToCheck = candidate.website ?? (effectiveDomain ? `https://${effectiveDomain}` : null);
    const countryCompat = evaluateCountryCompatibility(urlToCheck, countryCode ?? 'CO');
    if (!countryCompat.compatible) {
      skipped.push({ name: candidate.name, reason: `country_incompatible:${countryCompat.reason}`, searchTrace: candidate.searchTrace ?? undefined });
      precisionGate.countryIncompatibleCount++;
      continue;
    }

    // ── Content-page gate (Hito 16AB.43.28) ──────────────────────────────────
    // Bloquea páginas de contenido/artículo/caso de éxito que no son empresas.
    if (isContentPageUrl(candidate.website) || isContentPageName(candidate.name)) {
      skipped.push({ name: candidate.name, reason: 'content_page', searchTrace: candidate.searchTrace ?? undefined });
      precisionGate.contentPageCount++;
      continue;
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
      skipped.push({
        name: candidate.name,
        reason: `external_platform:${externalPlatformResult.platformType ?? 'unknown'}`,
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
      skipped.push({
        name: candidate.name,
        reason: `company_ownership:${companyOwnershipResult.confidence}`,
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
      continue;
    }

    // ── Source URL quality gate (Hito 16AB.43.29) ────────────────────────────
    // Bloquea URLs que son artículos, blogs, directorios de partners, registros
    // de partners o páginas genéricas de transformación digital.
    const urlToClassify = candidate.website ?? (effectiveDomain ? `https://${effectiveDomain}` : null);
    const sourceUrlQualityResult = classifySourceUrlQuality(urlToClassify, candidate.name);
    if (isBlockedBySourceUrlQuality(sourceUrlQualityResult)) {
      skipped.push({
        name: candidate.name,
        reason: `source_url_quality:${sourceUrlQualityResult.quality}`,
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
      continue;
    }

    // ── Business-fit gate (Hito 16AB.43.29) ──────────────────────────────────
    // Evalúa si el candidato encaja con el segmento B2B SaaS/ERP/CRM/LMS/HR Tech.
    // Bloquea agencias de marketing, BPO/staffing sin producto tech, y candidatos
    // con señales negativas fuertes.
    const businessFitResult = evaluateBusinessFit({
      name: candidate.name,
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
      skipped.push({
        name: candidate.name,
        reason: `business_fit:${businessFitResult.fit}`,
        searchTrace: candidate.searchTrace ?? undefined,
      });
      if (businessFitGateData.samples.length < 10) {
        businessFitGateData.samples.push({
          name: candidate.name,
          reason: businessFitResult.reasons.join('; '),
          url: candidate.website ?? null,
          fit: businessFitResult.fit,
        });
      }
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
    });
  }

  // ── Pass 2: rank eligible candidates by priority (Hito 16AB.43.27 / 16AB.43.28 / 16AB.43.29) ─
  // Priority: 1) composite fit score desc (business fit + URL quality + country compat),
  //           2) confidence score desc,
  //           3) path depth asc (closer to root URL is better)
  eligibleEntries.sort((a, b) => {
    const aComposite = a.businessFitRankingBonus + a.sourceUrlRankingBonus + a.countryCompatWeight * 10;
    const bComposite = b.businessFitRankingBonus + b.sourceUrlRankingBonus + b.countryCompatWeight * 10;
    const compositeDiff = bComposite - aComposite;
    if (compositeDiff !== 0) return compositeDiff;
    const scoreDiff = (b.candidate.scoring.confidenceScore ?? 0) - (a.candidate.scoring.confidenceScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return pathDepth(a.candidate.website) - pathDepth(b.candidate.website);
  });

  // ── Pass 2.5: intra-batch identity deduplicate (Hito 16AB.43.28) ─────────────
  // After ranking, keep only the first (best-ranked) entry per identity key.
  // Prevents the same company from appearing twice in one batch with different URLs.
  const seenBatchIdentityKeys = new Set<string>();
  type IntraBatchDupeSample = { identity_key: string; kept_url: string | null; removed_url: string | null };
  const intraBatchDupeSamples: IntraBatchDupeSample[] = [];
  const eligibleAfterIntraDedupe: EligibleEntry[] = [];

  for (const entry of eligibleEntries) {
    const ik = entry.identityKey;
    if (!ik) {
      eligibleAfterIntraDedupe.push(entry);
      continue;
    }
    if (!seenBatchIdentityKeys.has(ik)) {
      seenBatchIdentityKeys.add(ik);
      eligibleAfterIntraDedupe.push(entry);
    } else {
      precisionGate.intraBatchDuplicateCount++;
      skipped.push({ name: entry.candidate.name, reason: 'intra_batch_identity_duplicate', searchTrace: entry.candidate.searchTrace ?? undefined });
      if (intraBatchDupeSamples.length < 10) {
        const keptEntry = eligibleAfterIntraDedupe.find((e) => e.identityKey === ik);
        intraBatchDupeSamples.push({
          identity_key: ik,
          kept_url: keptEntry?.candidate.website ?? null,
          removed_url: entry.candidate.website ?? null,
        });
      }
    }
  }

  // ── Pass 3: apply target cap (Hito 16AB.43.27) ───────────────────────────────
  const targetCap = input.targetPersistibleCandidates ?? null;
  const eligibleBeforeCap = eligibleAfterIntraDedupe.length;
  const toPersist =
    targetCap != null && targetCap > 0 && eligibleBeforeCap > targetCap
      ? eligibleAfterIntraDedupe.slice(0, targetCap)
      : eligibleAfterIntraDedupe;
  const cappedEntries = eligibleAfterIntraDedupe.slice(toPersist.length);

  for (const { candidate } of cappedEntries) {
    skipped.push({ name: candidate.name, reason: "target_cap", searchTrace: candidate.searchTrace ?? undefined });
    precisionGate.targetCapCount++;
  }

  // ── Active Duplicate Guard: prefetch active candidates (v1.13.1) ───────────
  // Fetches existing active candidates once before the write loop to avoid
  // re-inserting companies already in SellUp (e.g., Softland case).
  const guardBatchDomains = toPersist
    .map((e) => e.domain)
    .filter((d): d is string => d !== null && d.length > 0);
  const activeCandidatesForGuard = await fetchActiveCandidatesForGuard(
    admin,
    guardBatchDomains,
    countryCode ?? null,
  );

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
      source: 'provided_search_result',
      checkedAt: nowIso,
    }),
  );

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
          batchId: existingBatchId ?? null,
          userId: triggeredByUserId ?? null,
          dryRun: isDryRun,
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

  // ── Pass 4: write eligible (after cap) ──────────────────────────────────────
  for (const [_entryIdx, { candidate, candidateStatus, domain, noveltyResult, countryEvidenceResult, businessFitResult, identityResolution }] of toPersist.entries()) {
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

    const effectiveConfidenceScore =
      evidencePolicy.confidenceCap !== null
        ? Math.min(candidate.scoring.confidenceScore, evidencePolicy.confidenceCap)
        : candidate.scoring.confidenceScore;

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

    // ── LinkedIn Enrichment (v1.15.1 + v1.15.2) ──────────────────────────────
    // Pre-computed in the LinkedIn pre-pass above. Includes controlled search
    // result when the feature is enabled and the candidate was eligible.
    const linkedInEnrichment = preComputedLinkedInEnrichments[_entryIdx];

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

    const candidateInsert = {
      batch_id: batchId,
      name: candidate.name,
      normalized_name: normalizeName(candidate.name),
      website: candidate.website ?? null,
      domain: domain ?? null,
      country: candidate.country,
      country_code: candidate.countryCode,
      industry: candidate.industry,
      source_primary: "web_ai",
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
      data_completeness_score: candidate.scoring.dataCompletenessScore,
      status: candidateStatus,
      review_notes: reviewNotes,
      metadata: {
        ...buildCandidateMetadata(candidate),
        scoring: {
          confidence_score: candidate.scoring.confidenceScore,
          fit_score: effectiveFitScore,
          data_completeness: candidate.scoring.dataCompletenessScore,
          quality_label: candidate.scoring.qualityLabel,
          recommended_action: candidate.scoring.recommendedAction,
          reasons: candidate.scoring.reasons,
          warnings: candidate.scoring.warnings,
          blockers: candidate.scoring.blockers,
          fit_breakdown: adjustedFitBreakdown,
        },
        linkedin_enrichment: linkedInEnrichment,
        novelty_check: noveltyResult.noveltyMetadata,
        ...(identityResolution ? { identity_resolution: identityResolution } : {}),
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
      },
    };

    try {
      const { data: created, error: insertErr } = await admin
        .from("prospect_candidates")
        .insert(candidateInsert)
        .select("id")
        .single();

      if (insertErr || !created) {
        const msg = insertErr?.message ?? "unknown";
        errors.push(`Error al crear candidato "${candidate.name}": ${msg}`);
        skipped.push({ name: candidate.name, reason: msg, searchTrace: candidate.searchTrace ?? undefined });
        continue;
      }

      createdCandidateIds.push(created.id);

      // Auditoría: candidate_created
      await admin.from("prospect_candidate_audit").insert({
        batch_id: batchId,
        candidate_id: created.id,
        actor_user_id: triggeredByUserId ?? null,
        action_type: "candidate_created",
        details: {
          name: candidate.name,
          source_primary: "web_ai",
          quality_label: candidate.scoring.qualityLabel,
          status: candidateStatus,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unexpected error";
      errors.push(`Error inesperado al crear candidato "${candidate.name}": ${msg}`);
      skipped.push({ name: candidate.name, reason: msg, searchTrace: candidate.searchTrace ?? undefined });
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

  // ── Status correction (guaranteed) ───────────────────────────────────────
  // A batch with 0 persisted candidates must NEVER remain ready_for_review.
  // This runs in its own try-catch so it cannot be swallowed by the metadata
  // computation below. The full metadata update repeats the status write later.
  if (candidatesCreated === 0 && errors.length === 0) {
    try {
      await admin
        .from("prospect_batches")
        .update({ status: "completed" })
        .eq("id", batchId);
    } catch (err) {
      console.error("[candidate-writer] status correction failed for batch", batchId, err);
    }
  }

  // ── Post-loop metadata update ─────────────────────────────────────────────
  // Persist real write counts and novelty summary into the batch so the UI
  // can explain why fewer candidates appeared than the pipeline returned.
  try {
    const noveltyReasons = new Set([
      "seen_in_previous_batch_recently",
      "confirmed_duplicate_previous",
      "rejected_recently",
    ]);
    const noveltySkipped = skipped.filter((s) => noveltyReasons.has(s.reason));
    const qualitySkipped = skipped.filter((s) =>
      s.reason === "qualityLabel=discard" ||
      s.reason.startsWith("external_platform:") ||
      s.reason.startsWith("company_ownership:") ||
      s.reason.startsWith("source_url_quality:") ||
      s.reason.startsWith("business_fit:") ||
      s.reason === "content_page" ||
      s.reason === "non_company_phrase" ||
      s.reason === "non_official_source_domain" ||
      s.reason === "country_incompatible" || s.reason.startsWith("country_incompatible:"),
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
      skipped_items: noveltySkipped.slice(0, 20).map((s) => ({
        name: s.name,
        domain: s.domain ?? null,
        reason: s.reason,
        previous_batch_ids: s.previous_batch_ids ?? [],
        previous_candidate_ids: s.previous_candidate_ids ?? [],
        search_trace: s.searchTrace ?? null,
      })),
    };

    const pipelineSummaryPostWrite = {
      requested: pipelineOutput.summary.requested,
      persisted: createdCandidateIds.length,
      skipped: skipped.length,
      returned_before_writer: pipelineOutput.summary.returned,
      needs_review_persisted: createdCandidateIds.length,
    };

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
          .eq('batch_id', batchId);

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
    };

    const finalMetadata = {
      ...preMergedMetadata,
      writer_summary: writerSummary,
      novelty_summary: noveltySummary,
      pipeline_summary_post_write: pipelineSummaryPostWrite,
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
      ...(linkedInBatchSearchMetadata ? { linkedin_search: linkedInBatchSearchMetadata } : {}),
      ...(targetCapMetadata ? { target_cap: targetCapMetadata } : {}),
      ...(reconciledAdaptiveForStorage != null ? { adaptive_discovery: reconciledAdaptiveForStorage } : {}),
    };

    if (candidatesCreated === 0 && errors.length === 0) {
      // All candidates were intentionally skipped (novelty / quality) — no new
      // content to review. Correct the status so the batch does not appear as
      // ready_for_review when it has nothing in it.
      await admin
        .from("prospect_batches")
        .update({ status: "completed", metadata: finalMetadata })
        .eq("id", batchId);
    } else {
      await admin
        .from("prospect_batches")
        .update({ metadata: finalMetadata })
        .eq("id", batchId);
    }
  } catch (err) {
    // Non-critical: metadata update failure does not affect the writer result.
    // Status was already corrected above (completed) if candidatesCreated === 0.
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
  );

  return { pipeline: pipelineOutput, writer };
}
