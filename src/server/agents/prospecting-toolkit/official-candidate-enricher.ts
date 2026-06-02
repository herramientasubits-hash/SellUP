/**
 * Official Candidate Enricher — Hito 16AK.11
 *
 * Enriquece candidatos oficiales (RUES) con evidencia web controlada (Tavily)
 * y evaluación de IA (Claude/Anthropic) como capa posterior.
 *
 * Contrato:
 * - Solo actúa sobre candidatos elegibles (sin liquidación, sin exact_duplicate).
 * - Tavily busca evidencia pública: website, descripción, señales comerciales.
 * - Claude evalúa SOLO la evidencia encontrada. No inventa datos.
 * - Si Tavily falla → warning, no falla el flujo.
 * - Si Claude falla → fit_status = 'unknown', no falla el flujo.
 * - No modifica: status, review_status, duplicate_status, source_primary, batch_id,
 *   account_id, converted_account_id, hubspot_company_id.
 * - Máximo maxEnrichmentCandidates por ejecución para controlar costos.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { runTavilyWebSearch } from './web-search-providers/tavily-web-search-provider';
import { getAiProviderCredential } from '../../services/ai-connection';
import { estimateLLMCost } from './llm-evaluator';

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
const MAX_ENRICHMENT_CANDIDATES = 5;
const TAVILY_MAX_RESULTS = 5;
const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 20_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  name: string | null;
  legal_name: string | null;
  tax_identifier: string | null;
  city: string | null;
  industry: string | null;
  website: string | null;
  domain: string | null;
  status: string | null;
  duplicate_status: string | null;
  review_flags: string[] | null;
  metadata: Record<string, unknown> | null;
}

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
  // Skip if no identifying data
  if (!candidate.name && !candidate.tax_identifier) return false;
  // Skip converted or discarded
  if (candidate.status === 'converted_to_account' || candidate.status === 'discarded') return false;
  // Skip exact duplicates (already in HubSpot/SellUp)
  if (candidate.duplicate_status === 'exact_duplicate') return false;
  // Skip liquidation / inactive signals
  const flags = candidate.review_flags ?? [];
  if (flags.includes('liquidation_signal') || flags.includes('inactive_company')) return false;
  return true;
}

// ─── Query builder ────────────────────────────────────────────────────────────

function buildTavilyQuery(candidate: CandidateRow, industry: string): string {
  const parts: string[] = [];
  const name = candidate.legal_name ?? candidate.name ?? '';
  if (name) parts.push(`"${name}"`);
  if (candidate.tax_identifier) parts.push(`NIT ${candidate.tax_identifier}`);
  parts.push('empresa Colombia');
  if (industry) parts.push(industry.split('/')[0].trim());
  parts.push('sitio web');
  return parts.join(' ');
}

// ─── Domain extractor ─────────────────────────────────────────────────────────

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const { hostname } = new URL(normalized);
    return hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

// ─── Claude evaluation ────────────────────────────────────────────────────────

function buildEvaluationPrompt(
  candidate: CandidateRow,
  tavilySnippets: Array<{ url: string; title: string; snippet: string | null }>,
  industry: string,
): string {
  const name = candidate.legal_name ?? candidate.name ?? 'Empresa desconocida';
  const evidenceBlock = tavilySnippets
    .map((r, i) =>
      [
        `[${i + 1}] URL: ${r.url}`,
        `    Título: ${r.title}`,
        r.snippet ? `    Texto: ${r.snippet.slice(0, 300)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n');

  return `Eres un evaluador de evidencia comercial para SellUp, una plataforma B2B.

EMPRESA (fuente oficial RUES Colombia):
- Nombre: ${name}
${candidate.tax_identifier ? `- NIT: ${candidate.tax_identifier}` : ''}
${candidate.city ? `- Ciudad: ${candidate.city}` : ''}
- Sector registrado: ${candidate.industry ?? industry}
- País: Colombia

EVIDENCIA WEB ENCONTRADA (resultados Tavily):
${evidenceBlock || '(sin resultados)'}

INDUSTRIA objetivo para prospección SellUp: ${industry}

INSTRUCCIONES:
1. Extrae datos SOLO si están explícitos en la evidencia anterior.
2. website/domain/company_linkedin_url deben estar respaldados por una URL en evidence_used.
3. fit_score debe ser null si hay menos de 2 resultados con texto relevante.
4. NO inventes NIT, website, LinkedIn, empleados ni datos no encontrados.
5. Si la evidencia no corresponde a esta empresa, retorna fit_status "unknown".

Responde ÚNICAMENTE con este JSON válido (sin markdown, sin texto adicional):
{
  "website": "<URL completa si encontrada, sino null>",
  "domain": "<dominio sin www si encontrado, sino null>",
  "company_linkedin_url": "<URL LinkedIn corporativo si encontrado, sino null>",
  "description": "<descripción pública 1-2 frases basada en evidencia, sino null>",
  "commercial_signals": ["<señal comercial encontrada>"],
  "fit_score": <número 0-100 o null>,
  "fit_status": "high" | "medium" | "low" | "unknown",
  "fit_reasons": ["<razón basada en evidencia>"],
  "risks": ["<riesgo detectado>"],
  "missing_fields": ["website", "linkedin"],
  "summary": "<1 oración resumen>",
  "evidence_used": ["<url1>", "<url2>"]
}`;
}

function parseAIResponse(raw: string): AIEvaluationResult | null {
  try {
    const stripped = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    // Try to extract JSON object if surrounded by text
    let toParse = stripped;
    const match = /\{[\s\S]*\}/.exec(stripped);
    if (match) toParse = match[0];

    const parsed = JSON.parse(toParse) as Record<string, unknown>;

    const fitStatusRaw = String(parsed.fit_status ?? 'unknown');
    const fitStatus: AIEvaluationResult['fit_status'] = ['high', 'medium', 'low', 'unknown'].includes(
      fitStatusRaw,
    )
      ? (fitStatusRaw as AIEvaluationResult['fit_status'])
      : 'unknown';

    const fitScoreRaw = parsed.fit_score;
    const fitScore =
      typeof fitScoreRaw === 'number' && isFinite(fitScoreRaw)
        ? Math.min(100, Math.max(0, Math.round(fitScoreRaw)))
        : null;

    return {
      website: typeof parsed.website === 'string' && parsed.website.length > 0 ? parsed.website : null,
      domain: typeof parsed.domain === 'string' && parsed.domain.length > 0 ? parsed.domain : null,
      company_linkedin_url:
        typeof parsed.company_linkedin_url === 'string' && parsed.company_linkedin_url.length > 0
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

// ─── Main enricher ────────────────────────────────────────────────────────────

/**
 * Enriquece candidatos de un lote oficial con evidencia Tavily + evaluación Claude.
 *
 * Flujo por candidato:
 *   1. Filtrar elegibles (sin liquidación, sin exact_duplicate).
 *   2. Tavily: buscar evidencia pública.
 *   3. Si Tavily encontró ≥1 resultado: Claude evalúa evidencia.
 *   4. Persistir: website, domain, fit_score, metadata.enrichment.
 *
 * Nunca falla el flujo principal. Errores → warning en summary.
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

  // ── Load candidates for batch ─────────────────────────────────────────────
  const { data: rows, error: loadError } = await admin
    .from('prospect_candidates')
    .select(
      'id, name, legal_name, tax_identifier, city, industry, website, domain, status, duplicate_status, review_flags, metadata',
    )
    .eq('batch_id', batchId)
    .limit(50); // load more, filter below

  if (loadError || !rows) {
    summary.warnings.push(`enrichment_load_failed: ${loadError?.message ?? 'no rows'}`);
    return summary;
  }

  // ── Filter eligible + limit ───────────────────────────────────────────────
  const maxCandidates = Math.min(criteria.targetCount, MAX_ENRICHMENT_CANDIDATES);
  const eligible = (rows as CandidateRow[]).filter(isEligibleForEnrichment).slice(0, maxCandidates);

  const skippedCount = rows.length - eligible.length;
  for (let i = 0; i < skippedCount; i++) {
    summary.skipped++;
    summary.candidates.push({
      id: (rows as CandidateRow[])[eligible.length + i]?.id ?? 'unknown',
      name: (rows as CandidateRow[])[eligible.length + i]?.name ?? null,
      status: 'skipped',
      skipReason: 'not_eligible',
    });
  }

  if (eligible.length === 0) {
    summary.warnings.push('no_eligible_candidates_for_enrichment');
    return summary;
  }

  // ── Resolve AI credentials once ───────────────────────────────────────────
  let anthropicApiKey: string | null = null;
  let aiModel = FALLBACK_MODEL;

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

  // ── Enrich each eligible candidate sequentially ────────────────────────────
  for (const candidate of eligible) {
    const result: EnrichedCandidate = {
      id: candidate.id,
      name: candidate.name,
      status: 'skipped',
    };

    // ── Step 1: Tavily search ───────────────────────────────────────────────
    const query = buildTavilyQuery(candidate, criteria.industry);
    let tavilySnippets: Array<{ url: string; title: string; snippet: string | null }> = [];
    let tavilyFailed = false;

    try {
      const tavilyOutput = await runTavilyWebSearch(
        { query, searchDepth: 'basic' },
        TAVILY_MAX_RESULTS,
      );

      if (tavilyOutput.skipped) {
        tavilyFailed = true;
        summary.warnings.push(`tavily_skipped:${candidate.id}:${tavilyOutput.skipReason ?? 'unknown'}`);
      } else {
        tavilySnippets = tavilyOutput.results.map((r) => ({
          url: r.url,
          title: r.title,
          snippet: r.snippet ?? null,
        }));
      }
    } catch (tavilyErr: unknown) {
      tavilyFailed = true;
      summary.warnings.push(
        `tavily_error:${candidate.id}:${tavilyErr instanceof Error ? tavilyErr.message : 'unknown'}`,
      );
    }

    if (tavilyFailed) {
      result.status = 'tavily_failed';
      summary.tavilyFailed++;
      summary.candidates.push(result);

      // Persist skipped_reason in metadata without other changes
      await persistEnrichmentMetadata(admin, candidate.id, candidate.metadata, {
        web: { skipped: true, skip_reason: 'tavily_failed' },
        ai_evaluation: null,
        cost_trace: null,
        executed_at: new Date().toISOString(),
      });
      continue;
    }

    if (tavilySnippets.length === 0) {
      result.status = 'no_evidence';
      summary.noEvidence++;
      summary.candidates.push(result);

      await persistEnrichmentMetadata(admin, candidate.id, candidate.metadata, {
        web: { skipped: false, results_count: 0, skip_reason: 'no_results' },
        ai_evaluation: null,
        cost_trace: null,
        executed_at: new Date().toISOString(),
      });
      continue;
    }

    // ── Step 2: Claude evaluation ───────────────────────────────────────────
    let aiResult: AIEvaluationResult | null = null;
    let costTrace: CostTrace | null = null;

    if (anthropicApiKey) {
      const prompt = buildEvaluationPrompt(candidate, tavilySnippets, criteria.industry);
      try {
        const { content, inputTokens, outputTokens } = await callClaudeForEvidence(
          prompt,
          anthropicApiKey,
          aiModel,
        );

        const parsed = parseAIResponse(content);
        if (parsed) {
          aiResult = parsed;
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

        // Persist Tavily results even if Claude failed
        await persistEnrichmentMetadata(admin, candidate.id, candidate.metadata, {
          web: { skipped: false, results_count: tavilySnippets.length, results: tavilySnippets },
          ai_evaluation: { status: 'failed' },
          cost_trace: null,
          executed_at: new Date().toISOString(),
        });
        summary.candidates.push(result);
        continue;
      }
    }

    // ── Step 3: Persist enrichment ──────────────────────────────────────────
    const updatePayload: Record<string, unknown> = {};

    // Only set website/domain if Claude found it with evidence backing
    if (aiResult?.website && aiResult.evidence_used.length > 0) {
      // Don't overwrite if already has a website from the official source
      if (!candidate.website) {
        updatePayload.website = aiResult.website;
        updatePayload.domain = aiResult.domain ?? extractDomain(aiResult.website);
        result.website = aiResult.website;
        result.domain = updatePayload.domain as string | null;
      }
    }

    // Set fit_score only if Claude produced a real number
    if (aiResult && typeof aiResult.fit_score === 'number') {
      updatePayload.fit_score = aiResult.fit_score;
      result.fitScore = aiResult.fit_score;
    }

    // Persist metadata.enrichment
    const enrichmentMeta = {
      web: {
        skipped: false,
        results_count: tavilySnippets.length,
        results: tavilySnippets.slice(0, 3), // store only top 3 to keep metadata lean
        query,
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
            provider: 'anthropic',
            model: aiModel,
          }
        : { status: 'skipped', reason: 'no_anthropic_key' },
      cost_trace: costTrace,
      executed_at: new Date().toISOString(),
    };

    updatePayload.metadata = await buildMergedMetadata(admin, candidate.id, candidate.metadata, enrichmentMeta);

    await admin
      .from('prospect_candidates')
      .update(updatePayload)
      .eq('id', candidate.id);

    result.status = 'enriched';
    result.costTrace = costTrace ?? undefined;
    summary.enriched++;
    summary.candidates.push(result);
  }

  return summary;
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

async function buildMergedMetadata(
  _admin: SupabaseClient,
  _candidateId: string,
  existingMeta: Record<string, unknown> | null,
  enrichmentBlock: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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
  const merged = await buildMergedMetadata(admin, candidateId, existingMeta, enrichmentBlock);
  await admin
    .from('prospect_candidates')
    .update({ metadata: merged })
    .eq('id', candidateId);
}
