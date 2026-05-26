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
import { runProspectingPipeline } from "./prospecting-pipeline";
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

// ─── Admin client ─────────────────────────────────────────────────────────────

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service credentials not configured");
  return createAdminClient(url, key);
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
  input: CandidateWriterInput
): Promise<CandidateWriterOutput> {
  const { pipelineOutput, triggeredByUserId, ownerId, batchName, source, dryRun, extraBatchMetadata } = input;
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
        skipped.push({ name: candidate.name, reason: "qualityLabel=discard" });
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
  const admin = getAdminClient();
  const errors: string[] = [];
  const createdCandidateIds: string[] = [];
  const skipped: CandidateWriterSkipped[] = [];

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
    ...(isMockRun
      ? {
          generation_mode: "mock",
          warning: "Datos de prueba. No convertir a empresas reales.",
        }
      : {}),
    ...(extraBatchMetadata ?? {}),
  };

  // Crear prospect_batch
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
      })),
      status: "failed",
      errors: [`Error al crear lote: ${batchError?.message ?? "unknown"}`],
    };
  }

  const batchId = batch.id;

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

  // Crear candidatos
  for (const candidate of pipelineOutput.candidates) {
    const candidateStatus = mapQualityLabelToStatus(candidate.scoring.qualityLabel);

    if (candidateStatus === null) {
      skipped.push({ name: candidate.name, reason: "qualityLabel=discard" });
      continue;
    }

    const dbDuplicateStatus = mapDuplicateStatus(
      candidate.duplicateCheck?.status ?? "unchecked"
    );

    const domain = candidate.domain ?? extractDomain(candidate.website);

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
      metadata: buildCandidateMetadata(candidate),
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
        skipped.push({ name: candidate.name, reason: msg });
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
      skipped.push({ name: candidate.name, reason: msg });
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
