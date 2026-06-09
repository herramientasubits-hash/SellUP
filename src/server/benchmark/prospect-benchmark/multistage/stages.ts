/**
 * Multistage Orchestrator — Stage Implementations (16AB.23.3)
 *
 * Stages 3 and 4 are purely deterministic (no AI).
 * Stages 1, 2, and 5 make AI calls via the client module.
 * Parsing logic lives here, keeping prompts.ts declarative.
 */

import { callWithRetry } from './client';
import {
  buildPlanPrompt,
  buildDiscoveryPrompt,
  buildVerificationPrompt,
  buildReplacementDiscoveryPrompt,
  SYSTEM_PROMPT,
} from './prompts';
import { MULTISTAGE_CONFIG } from './config';
import type { CheckpointManager } from './checkpoint';
import type {
  ApiCallResult,
  BatchUsage,
  DiscoveryCandidate,
  ExecutionMetrics,
  SearchPlanOutput,
  VerifiedCandidateResult,
} from './ms-types';
import type { FetchFn } from './client';
import type { BenchmarkCandidate } from '../types';

// ─── JSON extraction ──────────────────────────────────────────────────────────

function extractJson(text: string): unknown | null {
  const tagMatch = text.match(/<json_output>([\s\S]*?)<\/json_output>/);
  const raw = tagMatch?.[1]?.trim() ?? null;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─── Stage 1 — Search Plan ────────────────────────────────────────────────────

export async function runStage1Plan(
  apiKey: string,
  country: string,
  industry: string,
  context: string,
  checkpoint: CheckpointManager,
  metrics: ExecutionMetrics,
  fetchFn: FetchFn
): Promise<SearchPlanOutput | null> {
  const cacheKey = 'search-plan.json';
  const cached = checkpoint.loadFile<SearchPlanOutput>(cacheKey);
  if (cached) return cached;

  checkpoint.markStageStarted('stage1_plan');

  const prompt = buildPlanPrompt(country, industry, context);
  const startMs = Date.now();

  const result = await callWithRetry(
    apiKey,
    prompt,
    { maxSearchUses: 0, timeoutMs: 60_000, systemPrompt: SYSTEM_PROMPT },
    (waitMs) => { checkpoint.addRateLimitWait(waitMs); metrics.rate_limit_wait_ms += waitMs; },
    fetchFn
  );

  const dur = Date.now() - startMs;
  metrics.per_stage_duration_ms['stage1_plan'] = dur;
  metrics.longest_call_duration_ms = Math.max(metrics.longest_call_duration_ms, dur);
  metrics.total_api_calls++;

  checkpoint.addUsage(result.usage);

  if (result.retried) { checkpoint.recordRetry(); metrics.retried_api_calls++; }

  if (result.errorCode) {
    if (result.errorCode === 'connection_terminated') metrics.terminated_connections++;
    checkpoint.recordFailure();
    metrics.failed_api_calls++;
    return buildDefaultPlan(country, industry);
  }

  checkpoint.recordSuccess();
  metrics.successful_api_calls++;

  if (!result.data) return buildDefaultPlan(country, industry);

  const parsed = extractJson(result.data) as Record<string, unknown> | null;
  const plan = parsePlan(parsed);
  checkpoint.saveFile(cacheKey, plan);
  checkpoint.markStageCompleted('stage1_plan');
  return plan;
}

function parsePlan(obj: Record<string, unknown> | null): SearchPlanOutput {
  const def = buildDefaultPlan('Colombia', 'Tecnología');
  if (!obj) return def;
  return {
    subsectors: Array.isArray(obj['subsectors']) ? obj['subsectors'] as string[] : def.subsectors,
    cities: Array.isArray(obj['cities']) ? obj['cities'] as string[] : def.cities,
    company_types: Array.isArray(obj['company_types']) ? obj['company_types'] as string[] : def.company_types,
    target_sources: Array.isArray(obj['target_sources']) ? obj['target_sources'] as string[] : def.target_sources,
    queries: Array.isArray(obj['queries']) ? obj['queries'] as string[] : def.queries,
    exclusions: Array.isArray(obj['exclusions']) ? obj['exclusions'] as string[] : def.exclusions,
    diversity_strategy: typeof obj['diversity_strategy'] === 'string' ? obj['diversity_strategy'] : def.diversity_strategy,
    batch_themes: Array.isArray(obj['batch_themes']) ? obj['batch_themes'] as string[] : def.batch_themes,
  };
}

function buildDefaultPlan(country: string, _industry: string): SearchPlanOutput {
  return {
    subsectors: ['SaaS B2B', 'ciberseguridad', 'datos y IA', 'fintech B2B', 'servicios tech'],
    cities: ['Bogotá', 'Medellín', 'Cali', 'Barranquilla'],
    company_types: ['software propio', 'plataforma B2B', 'servicios tech'],
    target_sources: ['Fedesoft', 'ProColombia', 'Y Combinator', 'LinkedIn /company/'],
    queries: [
      `empresas SaaS B2B ${country} 2024`,
      `ciberseguridad ${country} empresas tecnología`,
      `fintech B2B ${country} serie A`,
    ],
    exclusions: ['confianza Baja', 'empresas cerradas', 'sin sede Colombia'],
    diversity_strategy: 'Cover Bogotá + Medellín + additional cities; min 4 subsectors',
    batch_themes: [
      'SaaS y software empresarial colombiano',
      'Datos, IA y ciberseguridad en Colombia',
      'Fintech B2B y tecnología financiera',
      'Servicios tecnológicos e ingeniería de software',
      'Healthtech, retail tech y verticales B2B',
    ],
  };
}

// ─── Stage 2 — Discovery batches ─────────────────────────────────────────────

export async function runStage2DiscoveryBatch(
  apiKey: string,
  batchIndex: number,
  theme: string,
  country: string,
  context: string,
  alreadyFoundNames: string[],
  checkpoint: CheckpointManager,
  metrics: ExecutionMetrics,
  fetchFn: FetchFn
): Promise<DiscoveryCandidate[]> {
  // Load from cache if available and valid
  if (checkpoint.isDiscoveryBatchCompleted(batchIndex)) {
    const cached = checkpoint.loadFile<{ candidates: DiscoveryCandidate[] }>(
      checkpoint.discoveryFile(batchIndex)
    );
    if (cached?.candidates) {
      return cached.candidates;
    }
    // File was corrupt — re-process
  }

  if (!checkpoint.withinBudget()) return [];

  const prompt = buildDiscoveryPrompt(batchIndex, theme, country, context, alreadyFoundNames);
  const startMs = Date.now();

  const result = await callWithRetry(
    apiKey,
    prompt,
    {
      maxSearchUses: MULTISTAGE_CONFIG.max_searches_per_discovery_call,
      timeoutMs: MULTISTAGE_CONFIG.per_call_timeout_ms,
      systemPrompt: SYSTEM_PROMPT,
    },
    (waitMs) => { checkpoint.addRateLimitWait(waitMs); metrics.rate_limit_wait_ms += waitMs; },
    fetchFn
  );

  const dur = Date.now() - startMs;
  metrics.longest_call_duration_ms = Math.max(metrics.longest_call_duration_ms, dur);
  metrics.total_api_calls++;

  checkpoint.addUsage(result.usage);
  if (result.retried) { checkpoint.recordRetry(); metrics.retried_api_calls++; }

  if (result.errorCode) {
    if (result.errorCode === 'connection_terminated') metrics.terminated_connections++;
    checkpoint.recordFailure();
    metrics.failed_api_calls++;
    checkpoint.recordBatchFailure('stage2_discovery', batchIndex, result.errorCode);
    metrics.partial_results_preserved = true;
    return [];
  }

  checkpoint.recordSuccess();
  metrics.successful_api_calls++;

  const candidates = parseDiscoveryCandidates(result.data ?? '', batchIndex, theme);
  checkpoint.saveFile(checkpoint.discoveryFile(batchIndex), { batch_index: batchIndex, batch_theme: theme, candidates });
  checkpoint.markDiscoveryBatchCompleted(batchIndex);
  metrics.discovery_batches_completed++;

  return candidates;
}

function parseDiscoveryCandidates(text: string, batchIndex: number, theme: string): DiscoveryCandidate[] {
  const obj = extractJson(text) as Record<string, unknown> | null;
  if (!obj || !Array.isArray(obj['candidates'])) return [];

  return (obj['candidates'] as unknown[])
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      name: String(c['name'] ?? '').trim(),
      website: cleanUrl(c['website']),
      linkedin: cleanUrl(c['linkedin']),
      city: cleanStr(c['city']),
      sector: String(c['sector'] ?? 'Tecnología').trim(),
      description: cleanStr(c['description']),
      confidence: normalizeConfidence(c['confidence']),
      evidence_url: cleanUrl(c['evidence_url']),
      evidence_source: cleanStr(c['evidence_source']),
      estimated_size: cleanStr(c['estimated_size']),
      notes: cleanStr(c['notes']),
      batch_index: batchIndex,
      batch_theme: theme,
    }))
    .filter((c) => c.name.length > 1);
}

// ─── Stage 3 — Deterministic pre-filter ──────────────────────────────────────

const REJECT_KEYWORDS = [
  'artículo', 'artículo de', 'las 10', 'las 5', 'top 10', 'ranking',
  'listado de', 'directory', 'directorios', 'asociación', 'federación',
  'gremio', 'cámara de comercio', 'informe', 'reporte', 'blog',
];

const REJECT_DOMAINS = [
  'yosoylatino.es', 'ecosistemastartup.com', 'reddit.com', 'wikipedia.org',
  'google.com', 'facebook.com', 'twitter.com', 'x.com',
];

export type PrefilterResult = {
  accepted: DiscoveryCandidate[];
  rejected: Array<{ candidate: DiscoveryCandidate; reason: string }>;
};

export function runStage3Prefilter(raw: DiscoveryCandidate[]): PrefilterResult {
  const accepted: DiscoveryCandidate[] = [];
  const rejected: Array<{ candidate: DiscoveryCandidate; reason: string }> = [];
  const seenNames = new Set<string>();
  const seenDomains = new Set<string>();

  for (const c of raw) {
    if (!c.name || c.name.length < 2) {
      rejected.push({ candidate: c, reason: 'empty_name' });
      continue;
    }

    const nameLower = c.name.toLowerCase();
    if (REJECT_KEYWORDS.some((k) => nameLower.includes(k))) {
      rejected.push({ candidate: c, reason: 'name_is_article_or_list' });
      continue;
    }

    if (c.confidence === 'Baja') {
      rejected.push({ candidate: c, reason: 'low_confidence' });
      continue;
    }

    const domain = c.website ? extractDomain(c.website) : null;
    if (domain && REJECT_DOMAINS.some((rd) => domain.includes(rd))) {
      rejected.push({ candidate: c, reason: 'rejected_domain' });
      continue;
    }

    // Internal dedup
    const normName = nameLower.replace(/\s+/g, ' ').trim();
    if (seenNames.has(normName)) {
      rejected.push({ candidate: c, reason: 'duplicate_internal' });
      continue;
    }
    if (domain && seenDomains.has(domain)) {
      rejected.push({ candidate: c, reason: 'duplicate_domain' });
      continue;
    }

    seenNames.add(normName);
    if (domain) seenDomains.add(domain);
    accepted.push(c);
  }

  return { accepted, rejected };
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url.toLowerCase();
  }
}

// ─── Stage 5 — Verification batches ──────────────────────────────────────────

export async function runStage5VerificationBatch(
  apiKey: string,
  batchIndex: number,
  candidates: DiscoveryCandidate[],
  country: string,
  checkpoint: CheckpointManager,
  metrics: ExecutionMetrics,
  fetchFn: FetchFn
): Promise<VerifiedCandidateResult[]> {
  if (checkpoint.isVerificationBatchCompleted(batchIndex)) {
    const cached = checkpoint.loadFile<{ candidates: VerifiedCandidateResult[] }>(
      checkpoint.verificationFile(batchIndex)
    );
    if (cached?.candidates) {
      return cached.candidates;
    }
    // Corrupt — re-process
  }

  if (!checkpoint.withinBudget()) return [];

  const prompt = buildVerificationPrompt(candidates, country);
  const startMs = Date.now();

  const result = await callWithRetry(
    apiKey,
    prompt,
    {
      maxSearchUses: MULTISTAGE_CONFIG.max_searches_per_verification_call,
      timeoutMs: MULTISTAGE_CONFIG.per_call_timeout_ms,
      systemPrompt: SYSTEM_PROMPT,
    },
    (waitMs) => { checkpoint.addRateLimitWait(waitMs); metrics.rate_limit_wait_ms += waitMs; },
    fetchFn
  );

  const dur = Date.now() - startMs;
  metrics.longest_call_duration_ms = Math.max(metrics.longest_call_duration_ms, dur);
  metrics.total_api_calls++;

  checkpoint.addUsage(result.usage);
  if (result.retried) { checkpoint.recordRetry(); metrics.retried_api_calls++; }

  if (result.errorCode) {
    if (result.errorCode === 'connection_terminated') metrics.terminated_connections++;
    checkpoint.recordFailure();
    metrics.failed_api_calls++;
    checkpoint.recordBatchFailure('stage5_verification', batchIndex, result.errorCode);
    metrics.partial_results_preserved = true;
    return [];
  }

  checkpoint.recordSuccess();
  metrics.successful_api_calls++;

  const verified = parseVerificationResult(result.data ?? '', candidates);
  checkpoint.saveFile(checkpoint.verificationFile(batchIndex), { batch_index: batchIndex, candidates: verified });
  checkpoint.markVerificationBatchCompleted(batchIndex);
  metrics.verification_batches_completed++;

  return verified;
}

function parseVerificationResult(text: string, fallback: DiscoveryCandidate[]): VerifiedCandidateResult[] {
  const obj = extractJson(text) as Record<string, unknown> | null;

  if (obj && Array.isArray(obj['candidates'])) {
    return (obj['candidates'] as unknown[])
      .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
      .map((c) => ({
        original_name: String(c['original_name'] ?? '').trim(),
        resolved_name: cleanStr(c['resolved_name']),
        is_real_company: Boolean(c['is_real_company']),
        official_website: cleanUrl(c['official_website']),
        linkedin_url: cleanUrl(c['linkedin_url']),
        operates_in_colombia: Boolean(c['operates_in_colombia']),
        is_tech_b2b: Boolean(c['is_tech_b2b']),
        city: cleanStr(c['city']),
        estimated_size: cleanStr(c['estimated_size']),
        confidence: normalizeConfidence(c['confidence']),
        evidence_url: cleanUrl(c['evidence_url']),
        evidence_source: cleanStr(c['evidence_source']),
        description: cleanStr(c['description']),
        notes: cleanStr(c['notes']),
        rejection_reason: cleanStr(c['rejection_reason']),
      }));
  }

  // Fallback: pass discovery candidates through as unverified
  return fallback.map((c) => ({
    original_name: c.name,
    resolved_name: c.name,
    is_real_company: true,
    official_website: c.website,
    linkedin_url: c.linkedin,
    operates_in_colombia: true,
    is_tech_b2b: true,
    city: c.city,
    estimated_size: c.estimated_size,
    confidence: c.confidence,
    evidence_url: c.evidence_url,
    evidence_source: c.evidence_source,
    description: c.description,
    notes: c.notes,
    rejection_reason: null,
  }));
}

// ─── Stage 2 replacement discovery ───────────────────────────────────────────

export async function runReplacementDiscovery(
  apiKey: string,
  round: number,
  country: string,
  context: string,
  neededCount: number,
  existingNames: string[],
  checkpoint: CheckpointManager,
  metrics: ExecutionMetrics,
  fetchFn: FetchFn
): Promise<DiscoveryCandidate[]> {
  if (!checkpoint.withinBudget()) return [];

  const prompt = buildReplacementDiscoveryPrompt(round, country, context, neededCount, existingNames);
  const startMs = Date.now();

  const result = await callWithRetry(
    apiKey,
    prompt,
    {
      maxSearchUses: MULTISTAGE_CONFIG.max_searches_per_discovery_call,
      timeoutMs: MULTISTAGE_CONFIG.per_call_timeout_ms,
      systemPrompt: SYSTEM_PROMPT,
    },
    (waitMs) => { checkpoint.addRateLimitWait(waitMs); metrics.rate_limit_wait_ms += waitMs; },
    fetchFn
  );

  const dur = Date.now() - startMs;
  metrics.longest_call_duration_ms = Math.max(metrics.longest_call_duration_ms, dur);
  metrics.total_api_calls++;

  checkpoint.addUsage(result.usage);
  if (result.retried) { checkpoint.recordRetry(); metrics.retried_api_calls++; }

  if (result.errorCode) {
    if (result.errorCode === 'connection_terminated') metrics.terminated_connections++;
    checkpoint.recordFailure();
    metrics.failed_api_calls++;
    return [];
  }

  checkpoint.recordSuccess();
  metrics.successful_api_calls++;

  return parseDiscoveryCandidates(result.data ?? '', 100 + round, `replacement_round_${round}`);
}

// ─── Convert verified result → BenchmarkCandidate ────────────────────────────

export function verifiedToBenchmarkCandidate(
  v: VerifiedCandidateResult,
  country: string,
  sector: string
): BenchmarkCandidate {
  return {
    name: v.resolved_name ?? v.original_name,
    country,
    sector,
    website: v.official_website,
    linkedin: v.linkedin_url,
    city: v.city,
    estimated_size: v.estimated_size,
    description: v.description,
    evidence_url: v.evidence_url,
    evidence_source: v.evidence_source,
    confidence: v.confidence,
    notes: v.notes,
  };
}

// ─── Shared string helpers ────────────────────────────────────────────────────

function cleanStr(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  return s === '' || s === 'null' || s === 'undefined' ? null : s;
}

function cleanUrl(v: unknown): string | null {
  const s = cleanStr(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? s : null;
  } catch {
    if (!s.startsWith('http')) {
      try {
        new URL(`https://${s}`);
        return `https://${s}`;
      } catch { return null; }
    }
    return null;
  }
}

function normalizeConfidence(v: unknown): 'Alta' | 'Media' | 'Baja' {
  const s = String(v ?? '').toLowerCase().trim();
  if (s.includes('alta') || s === 'high') return 'Alta';
  if (s.includes('baja') || s === 'low') return 'Baja';
  return 'Media';
}

// Re-export types needed by orchestrator
export type { ApiCallResult, BatchUsage };
