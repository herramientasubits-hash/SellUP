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
    },
  };
}

// ─── Función principal ────────────────────────────────────────────────────────

export async function writeProspectingCandidates(
  input: CandidateWriterInput,
  // For testing only: inject an admin client instead of reading env vars.
  // Production callers always omit this parameter.
  adminClientOverride?: SupabaseClient,
): Promise<CandidateWriterOutput> {
  const { pipelineOutput, triggeredByUserId, ownerId, batchName, source, dryRun, extraBatchMetadata, existingBatchId } = input;
  const isDryRun = dryRun ?? false;

  // Guard: sin candidatos
  if (!pipelineOutput.candidates || pipelineOutput.candidates.length === 0) {
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

  // ── Pass 1: evaluate all candidates through gates → collect eligible ────────
  type EligibleEntry = {
    candidate: ProspectingPipelineCandidate;
    candidateStatus: string;
    domain: string | null;
    countryCompatWeight: number;
    noveltyResult: ReturnType<typeof evaluateCandidateNovelty>;
    identityKey: string | null;
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

    eligibleEntries.push({
      candidate,
      candidateStatus,
      domain: effectiveDomain,
      countryCompatWeight: countryCompatibilityRankWeight(countryCompat),
      noveltyResult,
      identityKey: identity.identityKey ?? null,
    });
  }

  // ── Pass 2: rank eligible candidates by priority (Hito 16AB.43.27 / 16AB.43.28) ─
  // Priority: 1) country compat weight desc, 2) confidence score desc,
  //           3) path depth asc (closer to root URL is better)
  eligibleEntries.sort((a, b) => {
    const countryDiff = b.countryCompatWeight - a.countryCompatWeight;
    if (countryDiff !== 0) return countryDiff;
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

  // ── Pass 4: write eligible (after cap) ──────────────────────────────────────
  for (const { candidate, candidateStatus, domain, noveltyResult } of toPersist) {
    const dbDuplicateStatus = mapDuplicateStatus(
      candidate.duplicateCheck?.status ?? "unchecked"
    );

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
      confidence_score: candidate.scoring.confidenceScore,
      fit_score: candidate.scoring.fitScore,
      data_completeness_score: candidate.scoring.dataCompletenessScore,
      status: candidateStatus,
      review_notes: reviewNotes,
      metadata: {
        ...buildCandidateMetadata(candidate),
        novelty_check: noveltyResult.noveltyMetadata,
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
    const qualitySkipped = skipped.filter((s) => s.reason === "qualityLabel=discard");
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
    const storedAdaptive = (extraBatchMetadata as Record<string, unknown> | null)?.['adaptive_discovery'] as Record<string, unknown> | undefined;
    const reconciledAdaptiveForStorage = storedAdaptive != null && targetCap != null
      ? {
          ...storedAdaptive,
          persisted_count: createdCandidateIds.length,
          remaining_to_target: Math.max(0, targetCap - createdCandidateIds.length),
          result_status:
            createdCandidateIds.length >= targetCap
              ? 'success_target_reached'
              : createdCandidateIds.length > 0
              ? 'success_partial'
              : 'no_new_candidates',
        }
      : storedAdaptive;

    const finalMetadata = {
      ...preMergedMetadata,
      writer_summary: writerSummary,
      novelty_summary: noveltySummary,
      pipeline_summary_post_write: pipelineSummaryPostWrite,
      canonical_identity_gate: canonicalIdentityGate,
      precision_gate: precisionGateMetadata,
      ...(targetCapMetadata ? { target_cap: targetCapMetadata } : {}),
      ...(reconciledAdaptiveForStorage != null ? { adaptive_discovery: reconciledAdaptiveForStorage } : {}),
    };

    if (candidatesCreated === 0 && errors.length === 0) {
      // All candidates were intentionally skipped (novelty / quality) — no new
      // content to review. Correct the status so the batch does not appear as
      // ready_for_review when it has nothing in it.
      await admin
        .from("prospect_batches")
        .update({ status: "nothing_to_write", metadata: finalMetadata })
        .eq("id", batchId);
    } else {
      await admin
        .from("prospect_batches")
        .update({ metadata: finalMetadata })
        .eq("id", batchId);
    }
  } catch {
    // Non-critical: metadata update failure does not affect the writer result
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
  }
): Promise<ProspectingPipelineWriteOutput> {
  const pipelineOutput: ProspectingPipelineOutput = await runProspectingPipeline(input);

  const writer = await writeProspectingCandidates({
    pipelineOutput,
    triggeredByUserId: input.triggeredByUserId ?? null,
    ownerId: input.ownerId ?? null,
    batchName: input.batchName ?? null,
    source: "agent_1",
    dryRun: input.dryRun ?? false,
    extraBatchMetadata: input.extraBatchMetadata ?? null,
  });

  return { pipeline: pipelineOutput, writer };
}
