/**
 * Official Candidate Enricher — 16AK.13
 *
 * Enriquece candidatos oficiales (RUES) con evidencia web controlada (Tavily)
 * y evaluación de IA (Claude/Anthropic) como capa posterior.
 *
 * Cambios 16AK.13:
 * - Multi-query Tavily (máx 2 queries por candidato, early-stop si evidencia suficiente).
 * - Scoring de evidencia antes de enviar a Claude.
 * - Extracción local de website/LinkedIn/descripción.
 * - Claude recibe evidencia pre-clasificada; devuelve field_confidence por campo.
 * - Metadata estructurada: web.official_website, web.linkedin_company, web.public_description.
 *
 * Contratos:
 * - RUES / datos oficiales NO se sobrescriben.
 * - Claude NO inventa datos. Solo evalúa evidencia explícita.
 * - Si Tavily falla → warning, no falla el flujo.
 * - Si Claude falla → fit_status = 'unknown', no falla el flujo.
 * - No modifica: status, review_status, duplicate_status, source_primary, batch_id,
 *   account_id, converted_account_id, hubspot_company_id.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { runTavilyWebSearch } from './web-search-providers/tavily-web-search-provider';
import { getAiProviderCredential } from '../../services/ai-connection';
import { estimateLLMCost } from './llm-evaluator';
import { isUsefulReviewCandidate } from '@/modules/prospect-batches/types';
import {
  buildSearchQueriesByIntent,
  scoreWebEvidence,
  extractWebEnrichmentResult,
  buildPublicDescription,
  hasHighConfidenceEvidence,
  hasMinimumEvidenceForClaude,
  hasTaxIdentifierConflict,
  isDirectoryOrThirdPartyEvidenceDomain,
  extractDomainFromUrl,
  validateChileOfficialWebsite,
  type ScoredWebResult,
  type CandidateBasicInfo,
  type WebEnrichmentResult,
} from './web-evidence-scorer';

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_ENRICHMENT_CANDIDATES = 10;
const MAX_QUERIES_PER_CANDIDATE = 3;
const TAVILY_MAX_RESULTS_PER_QUERY = 5;
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 20_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CandidateRow extends CandidateBasicInfo {
  id: string;
  website: string | null;
  domain: string | null;
  status: string | null;
  duplicate_status: string | null;
  review_flags: string[] | null;
  metadata: Record<string, unknown> | null;
  country_code?: string | null;
  legal_status?: string | null;
  company_size?: string | null;
}

type FieldConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown';

export interface AIEvaluationResult {
  website: string | null;
  domain: string | null;
  company_linkedin_url: string | null;
  description: string | null;
  commercial_signals: string[];
  fit_score: number | null;
  fit_status: 'high' | 'medium' | 'low' | 'unknown';
  fit_reasons: string[];
  risks: string[];
  missing_fields: string[];
  summary: string;
  evidence_used: string[];
  field_confidence: {
    website: FieldConfidenceLevel;
    linkedin: FieldConfidenceLevel;
    description: FieldConfidenceLevel;
    company_size: FieldConfidenceLevel;
    sector: FieldConfidenceLevel;
  } | null;
}

interface EnrichedCandidate {
  id: string;
  name: string | null;
  status: 'enriched' | 'skipped' | 'tavily_failed' | 'ai_failed' | 'no_evidence';
  skipReason?: string;
  website?: string | null;
  domain?: string | null;
  fitScore?: number | null;
  costTrace?: CostTrace;
}

interface CostTrace {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  executed_at: string;
}

export interface EnrichmentSummary {
  enriched: number;
  skipped: number;
  tavilyFailed: number;
  aiFailed: number;
  noEvidence: number;
  totalEstimatedCostUsd: number;
  candidates: EnrichedCandidate[];
  warnings: string[];
}

// ─── Eligibility filter ───────────────────────────────────────────────────────

function isEligibleForEnrichment(candidate: CandidateRow): boolean {
  return isUsefulReviewCandidate(candidate);
}

// ─── Domain extractor ─────────────────────────────────────────────────────────

function extractDomainSimple(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ─── Claude evaluation prompt ─────────────────────────────────────────────────

function buildEvaluationPrompt(
  candidate: CandidateRow,
  scoredResults: ScoredWebResult[],
  queriesRun: string[],
  industry: string,
  preExtractedWebsite: string | null,
  preExtractedLinkedIn: string | null,
): string {
  const name = candidate.legal_name ?? candidate.name ?? 'Empresa desconocida';

  const evidenceBlock = scoredResults
    .map((r, i) =>
      [
        `[${i + 1}] Tipo: ${r.source_type.toUpperCase()} | Confidence: ${r.confidence} | Score: ${r.raw_score}`,
        `    URL: ${r.url}`,
        `    Título: ${r.title}`,
        r.snippet ? `    Texto: ${r.snippet.slice(0, 280)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

  const preExtracted: string[] = [];
  if (preExtractedWebsite) preExtracted.push(`- Website detectado localmente: ${preExtractedWebsite}`);
  else preExtracted.push('- Website: no detectado localmente');
  if (preExtractedLinkedIn) preExtracted.push(`- LinkedIn detectado localmente: ${preExtractedLinkedIn}`);
  else preExtracted.push('- LinkedIn: no detectado localmente');

  return `Eres un evaluador de evidencia comercial para SellUp, plataforma B2B Colombia.

EMPRESA (fuente oficial RUES):
- Nombre: ${name}
${candidate.tax_identifier ? `- NIT: ${candidate.tax_identifier}` : ''}
${candidate.city ? `- Ciudad: ${candidate.city}` : ''}
- Sector registrado: ${candidate.industry ?? industry}
- País: Colombia

BÚSQUEDAS REALIZADAS (${queriesRun.length}):
${queriesRun.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}

EVIDENCIA WEB PRE-CLASIFICADA (${scoredResults.length} resultados):
${evidenceBlock || '(sin resultados)'}

EXTRACCIÓN PREVIA (sistema local):
${preExtracted.join('\n')}

INDUSTRIA objetivo SellUp: ${industry}

INSTRUCCIONES CRÍTICAS — LEE ANTES DE RESPONDER:
1. Usa SOLO evidencia de los resultados anteriores. No inventes URLs, NIT ni datos.
2. website/domain: SOLO fuentes tipo OFFICIAL_WEBSITE con confidence high/medium.
   - PROHIBIDO usar fuentes tipo COMMERCIAL_DIRECTORY, PUBLIC_REGISTRY, CHAMBER_OF_COMMERCE.
   - Dominios como registronit.com, informacolombia.com, datacreditoempresas.com.co,
     einforma.co, paginasamarillas.com.co, kompass.com, zoominfo.com son DIRECTORIOS,
     NO son el sitio web oficial de la empresa. Si solo hay esos, website = null.
   - Solo acepta un dominio propio de la empresa (ej: escanherabogados.com, mypyme.co).
3. company_linkedin_url: SOLO resultados tipo LINKEDIN_COMPANY con URL explícita /company/
   Y el nombre en el título/snippet corresponde con alta probabilidad a ESTA empresa.
   Si hay duda o match parcial, devuelve null (el sistema lo guardará como possible_match).
4. description: construye SOLO desde snippets de resultados high/medium confidence.
   No uses snippets de directorios para construir descripción oficial.
5. fit_score: null si hay menos de 2 resultados con texto relevante a esta empresa.
6. No inferir tamaño de empresa salvo que el snippet lo mencione explícitamente.
7. Si evidencia no corresponde a esta empresa (nombre diferente, otro país): fit_status "unknown".
8. field_confidence: "unknown" si no hay evidencia explícita del campo.
9. NUNCA pongas en website/domain: registronit.com, informacolombia.com, datacreditoempresas.com.co,
   einforma.co, empresite.com, paginasamarillas.com.co, wikipedia.org, facebook.com,
   instagram.com, x.com, twitter.com, google.com, gmail.com, youtube.com o cualquier directorio, buscador o red social.

Responde ÚNICAMENTE con JSON válido (sin markdown, sin texto adicional):
{
  "website": "<URL completa del sitio PROPIO de la empresa, sino null>",
  "domain": "<dominio sin www si encontrado y es sitio propio, sino null>",
  "company_linkedin_url": "<URL /company/ LinkedIn con match fuerte, sino null>",
  "description": "<1-2 frases desde snippets high/medium no-directorio, sino null>",
  "commercial_signals": ["<señal explícita en evidencia>"],
  "fit_score": <número 0-100 o null>,
  "fit_status": "high" | "medium" | "low" | "unknown",
  "fit_reasons": ["<razón basada en evidencia>"],
  "risks": ["<riesgo detectado>"],
  "missing_fields": ["<campo sin evidencia>"],
  "summary": "<1 oración resumen>",
  "evidence_used": ["<url1>", "<url2>"],
  "field_confidence": {
    "website": "high" | "medium" | "low" | "unknown",
    "linkedin": "high" | "medium" | "low" | "unknown",
    "description": "high" | "medium" | "low" | "unknown",
    "company_size": "high" | "medium" | "low" | "unknown",
    "sector": "high" | "medium" | "low" | "unknown"
  }
}`;
}

function parseAIResponse(raw: string): AIEvaluationResult | null {
  try {
    const stripped = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let toParse = stripped;
    const match = /\{[\s\S]*\}/.exec(stripped);
    if (match) toParse = match[0];

    const parsed = JSON.parse(toParse) as Record<string, unknown>;

    const fitStatusRaw = String(parsed.fit_status ?? 'unknown');
    const fitStatus: AIEvaluationResult['fit_status'] = (
      ['high', 'medium', 'low', 'unknown'] as const
    ).includes(fitStatusRaw as AIEvaluationResult['fit_status'])
      ? (fitStatusRaw as AIEvaluationResult['fit_status'])
      : 'unknown';

    const fitScoreRaw = parsed.fit_score;
    const fitScore =
      typeof fitScoreRaw === 'number' && isFinite(fitScoreRaw)
        ? Math.min(100, Math.max(0, Math.round(fitScoreRaw)))
        : null;

    const validConfidence = (v: unknown): FieldConfidenceLevel =>
      typeof v === 'string' && ['high', 'medium', 'low', 'unknown'].includes(v)
        ? (v as FieldConfidenceLevel)
        : 'unknown';

    const fcRaw = parsed.field_confidence as Record<string, unknown> | null | undefined;
    const fieldConfidence: AIEvaluationResult['field_confidence'] = fcRaw
      ? {
          website: validConfidence(fcRaw.website),
          linkedin: validConfidence(fcRaw.linkedin),
          description: validConfidence(fcRaw.description),
          company_size: validConfidence(fcRaw.company_size),
          sector: validConfidence(fcRaw.sector),
        }
      : null;

    return {
      website: typeof parsed.website === 'string' && parsed.website.length > 0 ? parsed.website : null,
      domain: typeof parsed.domain === 'string' && parsed.domain.length > 0 ? parsed.domain : null,
      company_linkedin_url:
        typeof parsed.company_linkedin_url === 'string' && parsed.company_linkedin_url.includes('/company/')
          ? parsed.company_linkedin_url
          : null,
      description:
        typeof parsed.description === 'string' && parsed.description.length > 0
          ? parsed.description
          : null,
      commercial_signals: Array.isArray(parsed.commercial_signals)
        ? parsed.commercial_signals.map(String)
        : [],
      fit_score: fitScore,
      fit_status: fitStatus,
      fit_reasons: Array.isArray(parsed.fit_reasons) ? parsed.fit_reasons.map(String) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.map(String) : [],
      missing_fields: Array.isArray(parsed.missing_fields) ? parsed.missing_fields.map(String) : [],
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      evidence_used: Array.isArray(parsed.evidence_used) ? parsed.evidence_used.map(String) : [],
      field_confidence: fieldConfidence,
    };
  } catch {
    return null;
  }
}

async function callClaudeForEvidence(
  prompt: string,
  apiKey: string,
  model: string,
): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const textContent = data.content.find((c) => c.type === 'text');
    if (!textContent) throw new Error('Anthropic: no text content in response');

    return {
      content: textContent.text,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Multi-query Tavily runner ────────────────────────────────────────────────

async function runMultiQueryTavily(
  candidate: CandidateBasicInfo,
  industry: string,
  warnings: string[],
  candidateId: string,
): Promise<{ rawResults: Array<{ url: string; title: string; snippet: string | null }>; queriesRun: string[]; failed: boolean }> {
  const strategies = buildSearchQueriesByIntent(candidate, industry);
  const allResults: Array<{ url: string; title: string; snippet: string | null }> = [];
  const queriesRun: string[] = [];
  const seenUrls = new Set<string>();

  for (const strategy of strategies.slice(0, MAX_QUERIES_PER_CANDIDATE)) {
    let queryFailed = false;

    try {
      const output = await runTavilyWebSearch(
        { query: strategy.query, searchDepth: 'basic' },
        TAVILY_MAX_RESULTS_PER_QUERY,
      );

      if (output.skipped) {
        warnings.push(`tavily_skipped:${candidateId}:${output.skipReason ?? 'unknown'}`);
        queryFailed = true;
      } else {
        queriesRun.push(strategy.query);
        for (const r of output.results) {
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url);
            allResults.push({ url: r.url, title: r.title, snippet: r.snippet ?? null });
          }
        }
      }
    } catch (err: unknown) {
      warnings.push(
        `tavily_error:${candidateId}:${err instanceof Error ? err.message : 'unknown'}`,
      );
      queryFailed = true;
    }

    // If first query failed entirely, abort
    if (queryFailed && queriesRun.length === 0) {
      return { rawResults: [], queriesRun: [], failed: true };
    }

    // Early stop: enough high-quality evidence after first query
    if (queriesRun.length > 0 && allResults.length > 0) {
      const preview = scoreWebEvidence(candidate, allResults);
      if (hasHighConfidenceEvidence(preview)) break;
    }
  }

  return { rawResults: allResults, queriesRun, failed: false };
}

// ─── Main enricher ────────────────────────────────────────────────────────────

/**
 * Enriquece candidatos de un lote oficial con evidencia Tavily + evaluación Claude.
 *
 * Flujo por candidato:
 *   1. Filtrar elegibles (sin liquidación, sin exact_duplicate).
 *   2. Multi-query Tavily (máx 2 queries, early stop si evidencia suficiente).
 *   3. Scoring de evidencia local.
 *   4. Extracción local: website, LinkedIn, descripción.
 *   5. Claude evalúa evidencia pre-clasificada; devuelve field_confidence.
 *   6. Persistir: website, domain, fit_score, metadata.enrichment estructurada.
 */
export async function enrichBatchCandidatesWithWebAndAI(
  admin: SupabaseClient,
  batchId: string,
  criteria: { country: string; countryCode: string; industry: string; targetCount: number },
): Promise<EnrichmentSummary> {
  const summary: EnrichmentSummary = {
    enriched: 0,
    skipped: 0,
    tavilyFailed: 0,
    aiFailed: 0,
    noEvidence: 0,
    totalEstimatedCostUsd: 0,
    candidates: [],
    warnings: [],
  };

  const { data: rows, error: loadError } = await admin
    .from('prospect_candidates')
    .select(
      'id, name, legal_name, tax_identifier, city, industry, website, domain, status, duplicate_status, review_flags, metadata, country_code, legal_status, company_size',
    )
    .eq('batch_id', batchId)
    .limit(50);

  if (loadError || !rows) {
    summary.warnings.push(`enrichment_load_failed: ${loadError?.message ?? 'no rows'}`);
    return summary;
  }

  const maxCandidates = Math.min(criteria.targetCount, MAX_ENRICHMENT_CANDIDATES);
  const eligible = (rows as CandidateRow[]).filter(isEligibleForEnrichment).slice(0, maxCandidates);

  const skippedRows = (rows as CandidateRow[]).filter((r) => !isEligibleForEnrichment(r));
  for (const row of skippedRows) {
    summary.skipped++;
    summary.candidates.push({ id: row.id, name: row.name, status: 'skipped', skipReason: 'not_eligible' });
    await persistEnrichmentMetadata(admin, row.id, row.metadata, {
      skipped: true,
      skipped_reason: 'blocked_not_useful_candidate',
      web: { skipped: true, skip_reason: 'blocked_not_useful_candidate' },
    });
  }

  if (eligible.length === 0) {
    summary.warnings.push('no_eligible_candidates_for_enrichment');
    return summary;
  }

  // Resolve AI credentials once
  let anthropicApiKey: string | null = null;
  const aiModel = FALLBACK_MODEL;

  try {
    const credResult = await getAiProviderCredential('anthropic');
    if (credResult.success && credResult.apiKey) {
      anthropicApiKey = credResult.apiKey;
    } else {
      summary.warnings.push('anthropic_credential_missing: ai_evaluation_will_be_skipped');
    }
  } catch {
    summary.warnings.push('anthropic_credential_error: ai_evaluation_will_be_skipped');
  }

  for (const candidate of eligible) {
    const result: EnrichedCandidate = { id: candidate.id, name: candidate.name, status: 'skipped' };

    // ── Step 1: Multi-query Tavily ─────────────────────────────────────────
    const { rawResults, queriesRun, failed: tavilyFailed } = await runMultiQueryTavily(
      candidate,
      criteria.industry,
      summary.warnings,
      candidate.id,
    );

    if (tavilyFailed) {
      result.status = 'tavily_failed';
      summary.tavilyFailed++;
      await persistEnrichmentMetadata(admin, candidate.id, candidate.metadata, {
        web: { skipped: true, skip_reason: 'tavily_failed' },
        ai_evaluation: null,
        cost_trace: null,
        executed_at: new Date().toISOString(),
      });
      summary.candidates.push(result);
      continue;
    }

    if (rawResults.length === 0) {
      result.status = 'no_evidence';
      summary.noEvidence++;
      await persistEnrichmentMetadata(admin, candidate.id, candidate.metadata, {
        web: { skipped: false, results_count: 0, skip_reason: 'no_results', queries: queriesRun },
        ai_evaluation: null,
        cost_trace: null,
        executed_at: new Date().toISOString(),
      });
      summary.candidates.push(result);
      continue;
    }

    // ── Step 2: Score evidence ─────────────────────────────────────────────
    const scoredResults = scoreWebEvidence(candidate, rawResults);

    // ── Step 3: Local extraction (structured — 16AK.13B) ──────────────────
    const webEnrichment: WebEnrichmentResult = extractWebEnrichmentResult(candidate, scoredResults);
    const officialWebsiteEvidence = webEnrichment.official_website;
    const linkedInEvidence = webEnrichment.linkedin_company;
    const publicDescriptionEvidence = buildPublicDescription(scoredResults);

    // ── Step 3.5: NIT conflict analysis (16AK.16C) ────────────────────────
    const nitConflicts: string[] = [];
    const nitMatches: string[] = [];
    if (candidate.tax_identifier) {
      for (const r of scoredResults) {
        const evidenceText = `${r.url} ${r.title} ${r.snippet ?? ''}`;
        const check = hasTaxIdentifierConflict(candidate.tax_identifier, evidenceText);
        const domain = extractDomainFromUrl(r.url) ?? r.url;
        if (check === 'conflict') nitConflicts.push(domain);
        else if (check === 'match') nitMatches.push(domain);
      }
    }

    // 16AK.16D: NIT conflict blocking gate — prevents weak evidence from polluting visible fields
    const hasNitConflictBlocking = nitConflicts.length > 0 && nitMatches.length === 0;

    // ── Step 4: Claude evaluation ──────────────────────────────────────────
    // 16AK.16C: Gate — only call Claude if hasMinimumEvidenceForClaude passes
    const shouldCallClaude =
      anthropicApiKey !== null &&
      hasMinimumEvidenceForClaude(webEnrichment, scoredResults, candidate);

    let claudeSkipReason: 'insufficient_evidence' | 'tax_identifier_conflict' | 'weak_entity_match' | 'no_country_coherent_evidence' | null = null;
    if (anthropicApiKey && !shouldCallClaude) {
      const isChileCandidate = candidate.country_code === 'CL';
      if (isChileCandidate) {
        // 16AK.17B: Chile-specific skip reason — geographic coherence gate
        const hasAnyCoherent = scoredResults.some((r) => r.geographic_coherence?.coherent === true);
        if (!hasAnyCoherent && scoredResults.length > 0) {
          claudeSkipReason = 'no_country_coherent_evidence';
        } else if (!webEnrichment.official_website && !webEnrichment.linkedin_company && webEnrichment.public_evidence.length === 0) {
          claudeSkipReason = 'insufficient_evidence';
        } else {
          claudeSkipReason = 'weak_entity_match';
        }
      } else {
        if (nitConflicts.length > 0 && nitMatches.length === 0) {
          claudeSkipReason = 'tax_identifier_conflict';
        } else if (
          !webEnrichment.official_website &&
          !webEnrichment.linkedin_company &&
          webEnrichment.public_evidence.length === 0
        ) {
          claudeSkipReason = 'insufficient_evidence';
        } else {
          claudeSkipReason = 'weak_entity_match';
        }
      }
    }

    let aiResult: AIEvaluationResult | null = null;
    let costTrace: CostTrace | null = null;

    if (shouldCallClaude) {
      const prompt = buildEvaluationPrompt(
        candidate,
        scoredResults,
        queriesRun,
        criteria.industry,
        officialWebsiteEvidence?.url ?? null,
        linkedInEvidence?.url ?? null,
      );

      try {
        const { content, inputTokens, outputTokens } = await callClaudeForEvidence(
          prompt,
          anthropicApiKey!, // non-null: shouldCallClaude guarantees anthropicApiKey !== null
          aiModel,
        );

        const parsed = parseAIResponse(content);
        if (parsed) {
          aiResult = parsed;

          // Guard: reject Claude's website if it slipped through as a directory
          if (aiResult.website) {
            const aiDomain = extractDomainFromUrl(aiResult.website);
            if (aiDomain && isDirectoryOrThirdPartyEvidenceDomain(aiDomain)) {
              summary.warnings.push(`ai_website_rejected_directory:${candidate.id}:${aiDomain}`);
              aiResult = {
                ...aiResult,
                website: null,
                domain: null,
                field_confidence: aiResult.field_confidence
                  ? { ...aiResult.field_confidence, website: 'unknown' as const }
                  : null,
              };
            }
          }

          const estimatedCostUsd = estimateLLMCost(inputTokens, outputTokens, aiModel);
          summary.totalEstimatedCostUsd += estimatedCostUsd;
          costTrace = {
            provider: 'anthropic',
            model: aiModel,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            estimated_cost_usd: estimatedCostUsd,
            executed_at: new Date().toISOString(),
          };
        } else {
          summary.warnings.push(`ai_parse_failed:${candidate.id}`);
        }
      } catch (aiErr: unknown) {
        result.status = 'ai_failed';
        summary.aiFailed++;
        summary.warnings.push(
          `ai_error:${candidate.id}:${aiErr instanceof Error ? aiErr.message : 'unknown'}`,
        );

        const updatePayload: Record<string, unknown> = {};
        // 16AK.16D: Block website if NIT conflict with no NIT match
        const finalWebsite = hasNitConflictBlocking ? null : (officialWebsiteEvidence?.url ?? null);
        const finalDomain = hasNitConflictBlocking ? null : (officialWebsiteEvidence?.domain ?? null);

        if (!candidate.website && finalWebsite) {
          updatePayload.website = finalWebsite;
          updatePayload.domain = finalDomain;
          result.website = finalWebsite;
          result.domain = finalDomain;
        }

        const enrichmentMeta = {
          web: {
            skipped: false,
            results_count: scoredResults.length,
            queries_run: queriesRun.length,
            queries: queriesRun,
            official_website: officialWebsiteEvidence ?? null,
            linkedin_company: linkedInEvidence ?? null,
            possible_linkedin_matches: webEnrichment.possible_linkedin_matches,
            public_evidence: webEnrichment.public_evidence,
            rejected_as_official_website: webEnrichment.rejected_as_official_website,
            public_description: publicDescriptionEvidence ?? null,
            results: scoredResults.slice(0, 5),
            tax_id_conflicts: nitConflicts,
            tax_id_matches: nitMatches,
            claude_skip_reason: null,
          },
          ai_evaluation: { status: 'failed' },
          cost_trace: null,
          executed_at: new Date().toISOString(),
        };

        updatePayload.metadata = buildMergedMetadata(candidate.metadata, enrichmentMeta);

        await admin.from('prospect_candidates').update(updatePayload).eq('id', candidate.id);
        summary.candidates.push(result);
        continue;
      }
    }

    // ── Step 5: Build update payload ───────────────────────────────────────
    const updatePayload: Record<string, unknown> = {};

    // Website: prefer local extraction; fall back to Claude only if official
    // 16AK.16D: Apply NIT conflict blocking gate before persisting visible fields
    const aiWebsiteIsValid = aiResult?.website
      ? !isDirectoryOrThirdPartyEvidenceDomain(extractDomainFromUrl(aiResult.website) ?? '')
      : false;
    const rawFinalWebsite =
      officialWebsiteEvidence?.url ?? (aiWebsiteIsValid ? (aiResult?.website ?? null) : null);
    const rawFinalDomain =
      officialWebsiteEvidence?.domain ??
      (aiWebsiteIsValid ? (aiResult?.domain ?? extractDomainSimple(aiResult?.website)) : null);

    const isChile = candidate.country_code === 'CL';
    const websiteValidation = isChile
      ? validateChileOfficialWebsite(rawFinalWebsite, candidate.name ?? candidate.legal_name ?? '')
      : { valid: true, reason: 'ok' };

    // Gate: if NIT conflict without any NIT match, or if Chile validation fails, block all locally-derived website
    const finalWebsite = hasNitConflictBlocking || !websiteValidation.valid ? null : rawFinalWebsite;
    const finalDomain = hasNitConflictBlocking || !websiteValidation.valid ? null : rawFinalDomain;

    if (!candidate.website && finalWebsite) {
      updatePayload.website = finalWebsite;
      updatePayload.domain = finalDomain;
      result.website = finalWebsite;
      result.domain = finalDomain as string | null;
    } else if (candidate.website) {
      // If stored website is a directory (from previous enrichment), clear it
      const existingDomain = extractDomainFromUrl(candidate.website);
      if (existingDomain && isDirectoryOrThirdPartyEvidenceDomain(existingDomain)) {
        updatePayload.website = finalWebsite ?? null;
        updatePayload.domain = finalDomain ?? null;
        result.website = finalWebsite ?? null;
        result.domain = finalDomain ?? null;
        summary.warnings.push(`cleared_directory_website:${candidate.id}:${existingDomain}`);
      }
    }

    if (aiResult && typeof aiResult.fit_score === 'number') {
      updatePayload.fit_score = aiResult.fit_score;
      result.fitScore = aiResult.fit_score;
    }

    // LinkedIn: prefer local confirmed; fall back to Claude if /company/ URL
    // 16AK.16D: Block if NIT conflict blocking gate active
    const aiLinkedIn = aiResult?.company_linkedin_url ?? null;
    const finalLinkedIn = hasNitConflictBlocking ? null : (linkedInEvidence?.url ?? aiLinkedIn);

    // Description: prefer local extraction; fall back to Claude
    // 16AK.16D: Block if NIT conflict blocking gate active
    const finalDescription = hasNitConflictBlocking
      ? null
      : (publicDescriptionEvidence?.text ?? (aiResult?.description ?? null));

    // 16AK.16D: Compute status fields for metadata
    const officialWebsiteStatus = hasNitConflictBlocking
      ? 'blocked_by_tax_conflict'
      : !websiteValidation.valid
      ? 'rejected'
      : finalWebsite
      ? 'confirmed'
      : 'not_found';

    const publicDescriptionStatus = hasNitConflictBlocking
      ? 'skipped_tax_conflict'
      : !finalDescription
      ? 'not_found'
      : 'confirmed';

    const linkedinStatus = hasNitConflictBlocking
      ? 'blocked_by_tax_conflict'
      : linkedInEvidence
      ? 'confirmed'
      : finalLinkedIn
      ? 'possible'
      : webEnrichment.possible_linkedin_matches.length > 0
      ? 'possible'
      : 'not_found';

    const visibleWebsiteAllowed = !hasNitConflictBlocking && !!finalWebsite;
    const apolloSkipReason = visibleWebsiteAllowed
      ? null
      : candidate.country_code === 'CL'
        ? 'no_confirmed_country_coherent_domain'
        : 'no_confirmed_domain';

    const enrichmentMeta = {
      web: {
        skipped: false,
        results_count: scoredResults.length,
        queries_run: queriesRun.length,
        queries: queriesRun,
        official_website: hasNitConflictBlocking ? null : (officialWebsiteEvidence ?? null),
        official_website_status: officialWebsiteStatus,
        visible_website_allowed: visibleWebsiteAllowed,
        apollo_skip_reason: apolloSkipReason,
        linkedin_company: hasNitConflictBlocking ? null : (linkedInEvidence
          ? linkedInEvidence
          : finalLinkedIn
          ? { url: finalLinkedIn, confidence: 'low' as const, evidence_url: finalLinkedIn, reason: 'claude_extracted' }
          : null),
        linkedin_status: linkedinStatus,
        possible_linkedin_matches: hasNitConflictBlocking ? [] : webEnrichment.possible_linkedin_matches,
        public_evidence: webEnrichment.public_evidence,
        rejected_as_official_website: webEnrichment.rejected_as_official_website,
        public_description: hasNitConflictBlocking ? null : (publicDescriptionEvidence ?? (finalDescription ? { text: finalDescription, confidence: 'low' as const, evidence_used: [] } : null)),
        public_description_status: publicDescriptionStatus,
        results: scoredResults.slice(0, 5),
        tax_id_conflicts: nitConflicts,
        tax_id_matches: nitMatches,
        claude_skip_reason: claudeSkipReason ?? null,
      },
      ai_evaluation: aiResult
        ? {
            fit_score: aiResult.fit_score,
            fit_status: aiResult.fit_status,
            fit_reasons: aiResult.fit_reasons,
            risks: aiResult.risks,
            missing_fields: aiResult.missing_fields,
            summary: aiResult.summary,
            evidence_used: aiResult.evidence_used,
            description: aiResult.description,
            commercial_signals: aiResult.commercial_signals,
            field_confidence: aiResult.field_confidence,
            provider: 'anthropic',
            model: aiModel,
          }
        : claudeSkipReason !== null
        ? { status: 'skipped', reason: claudeSkipReason }
        : anthropicApiKey !== null
        ? { status: 'failed', reason: 'parse_failed' }
        : { status: 'skipped', reason: 'no_anthropic_key' },
      cost_trace: costTrace,
      executed_at: new Date().toISOString(),
    };

    // Add limited_public_data if candidate has no website, no LinkedIn, no size, no description, and no sector
    const hasNoWebsite = !finalWebsite && !candidate.website;
    const hasNoLinkedIn = !finalLinkedIn;
    const hasNoSize = !candidate.company_size;
    const hasNoDescription = !finalDescription;
    const hasNoSector = !candidate.industry;

    if (hasNoWebsite && hasNoLinkedIn && hasNoSize && hasNoDescription && hasNoSector) {
      const currentFlags = candidate.review_flags ?? [];
      if (!currentFlags.includes('limited_public_data')) {
        updatePayload.review_flags = [...currentFlags, 'limited_public_data'];
      }
    }

    updatePayload.metadata = buildMergedMetadata(candidate.metadata, enrichmentMeta);

    await admin.from('prospect_candidates').update(updatePayload).eq('id', candidate.id);

    result.status = 'enriched';
    result.costTrace = costTrace ?? undefined;
    summary.enriched++;
    summary.candidates.push(result);
  }

  return summary;
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

function buildMergedMetadata(
  existingMeta: Record<string, unknown> | null,
  enrichmentBlock: Record<string, unknown>,
): Record<string, unknown> {
  const base = existingMeta ?? {};
  const existingEnrichment = (base.enrichment as Record<string, unknown> | undefined) ?? {};
  return {
    ...base,
    enrichment: {
      ...existingEnrichment,
      ...enrichmentBlock,
    },
  };
}

async function persistEnrichmentMetadata(
  admin: SupabaseClient,
  candidateId: string,
  existingMeta: Record<string, unknown> | null,
  enrichmentBlock: Record<string, unknown>,
): Promise<void> {
  const merged = buildMergedMetadata(existingMeta, enrichmentBlock);
  await admin.from('prospect_candidates').update({ metadata: merged }).eq('id', candidateId);
}
