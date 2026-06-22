/**
 * DENUE Mexico — Contextual Enrichment Adapter
 *
 * Propósito: enriquecer candidatos México con contexto operativo desde
 * DENUE (Directorio Estadístico Nacional de Unidades Económicas / INEGI).
 *
 * NO resuelve tax_identifier (RFC).
 * NO cambia tax_identifier_resolution.status.
 * NO marca resolved fiscalmente.
 * Siempre conserva human_review_required = true.
 *
 * Solo server-side. No usar en Client Components.
 */

import { fetchDenueDatasetSample } from './denue-client';
import type { FetchDenueResult } from './denue-client';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
  SourceCapability,
} from '../../enrichment/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DenueMatch {
  denue_id: string | null;
  establishment_name: string | null;
  legal_name: string | null;
  business_activity: string | null;
  sector: string | null;
  subsector: string | null;
  state: string | null;
  municipality: string | null;
  locality: string | null;
  street: string | null;
  employee_range: string | null;
  website: string | null;
  phone: string | null;
  confidence: number;
  reason: string;
  matched_by: string;
}

export interface DenueEnrichmentMetadata {
  status: 'matched' | 'no_match' | 'ambiguous' | 'error';
  source_key: string;
  matched_by: 'name' | 'normalized_name' | 'name_and_location' | 'none';
  confidence: number;
  human_review_required: true;
  does_not_resolve_tax_identifier: true;
  matches: DenueMatch[];
}

export type DenueFetchFn = typeof fetchDenueDatasetSample;

// ─── Name normalization — Mexico-specific ─────────────────────────────────────

const MX_STOP_TOKENS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'en', 'y', 'e', 'o', 'a',
  'un', 'una', 'con', 'por', 'para', 'su', 'al', 'lo',
  'sa', 's', 'a', 'cv', 'rl', 'sapi', 'sc', 'ac', 'sp',
]);

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(name: string): string[] {
  const normalized = normalizeName(name);
  return normalized
    .split(/\s+/)
    .filter((t) => t.length > 1 && !MX_STOP_TOKENS.has(t));
}

function tokenSetSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter((t) => setB.has(t)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function nameContainsTokens(name: string, tokens: string[]): boolean {
  const lower = name.toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

// ─── Match confidence ─────────────────────────────────────────────────────────

interface MatchResult {
  confidence: number;
  matchedBy: 'name' | 'normalized_name' | 'name_and_location' | 'none';
  reason: string;
}

function evaluateMatch(
  candidateName: string,
  establishmentName: string | null,
  legalName: string | null,
): MatchResult {
  const nameToMatch = establishmentName ?? legalName;
  if (!nameToMatch) {
    return { confidence: 0, matchedBy: 'none', reason: 'DENUE record has no name' };
  }

  const candidateNorm = normalizeName(candidateName);
  const estabNorm = normalizeName(nameToMatch);

  if (candidateNorm === estabNorm) {
    return {
      confidence: 0.75,
      matchedBy: 'name',
      reason: 'Exact name match after normalization',
    };
  }

  const candidateTokens = significantTokens(candidateName);
  const estabTokens = significantTokens(nameToMatch);

  if (candidateTokens.length === 0 || estabTokens.length === 0) {
    return { confidence: 0, matchedBy: 'none', reason: 'No significant tokens to compare' };
  }

  const similarity = tokenSetSimilarity(candidateTokens, estabTokens);

  if (similarity >= 0.8) {
    return {
      confidence: 0.65,
      matchedBy: 'normalized_name',
      reason: `Strong token overlap (${Math.round(similarity * 100)}%)`,
    };
  }

  if (similarity >= 0.5) {
    return {
      confidence: 0.50,
      matchedBy: 'normalized_name',
      reason: `Partial token overlap (${Math.round(similarity * 100)}%)`,
    };
  }

  if (nameContainsTokens(nameToMatch, candidateTokens)) {
    return {
      confidence: 0.40,
      matchedBy: 'normalized_name',
      reason: 'Candidate tokens found in establishment name',
    };
  }

  return { confidence: 0, matchedBy: 'none', reason: 'Name similarity below threshold' };
}

// ─── Raw record → DenueMatch ──────────────────────────────────────────────────

function rawRecordToDenueMatch(
  record: Record<string, unknown>,
  candidateName: string,
): DenueMatch {
  const nombre = typeof record['Nombre'] === 'string' ? record['Nombre'].trim() : null;
  const razonSocial = typeof record['Razon_social'] === 'string' ? record['Razon_social'].trim() : null;
  const activity = typeof record['Clase_actividad'] === 'string' ? record['Clase_actividad'].trim() : null;
  const estrato = typeof record['Estrato'] === 'string' ? record['Estrato'].trim() : null;
  const telefono = typeof record['Telefono'] === 'string' ? record['Telefono'].trim() : null;
  const sitioWeb = typeof record['Sitio_internet'] === 'string' ? record['Sitio_internet'].trim() : null;
  const ubicacion = typeof record['Ubicacion'] === 'string' ? record['Ubicacion'].trim() : null;

  const clee = typeof record['CLEE'] === 'string' ? record['CLEE'].trim() : null;
  const id = typeof record['Id'] === 'string' ? record['Id'].trim() : null;

  const { confidence, matchedBy, reason } = evaluateMatch(candidateName, nombre, razonSocial);

  let state: string | null = null;
  let municipality: string | null = null;
  let locality: string | null = null;
  if (ubicacion) {
    const parts = ubicacion.split(',').map((p) => p.trim());
    if (parts.length >= 3) {
      locality = parts[0] ?? null;
      municipality = parts[1] ?? null;
      state = parts[2] ?? null;
    } else if (parts.length === 2) {
      municipality = parts[0] ?? null;
      state = parts[1] ?? null;
    } else if (parts.length === 1) {
      state = parts[0];
    }
  }

  const street = [
    typeof record['Tipo_vialidad'] === 'string' ? record['Tipo_vialidad'].trim() : null,
    typeof record['Calle'] === 'string' ? record['Calle'].trim() : null,
    typeof record['Num_Exterior'] === 'string' ? record['Num_Exterior'].trim() : null,
  ]
    .filter((p): p is string => p !== null)
    .join(' ') || null;

  return {
    denue_id: clee ?? id,
    establishment_name: nombre ?? razonSocial,
    legal_name: razonSocial,
    business_activity: activity,
    sector: null,
    subsector: null,
    state,
    municipality,
    locality,
    street,
    employee_range: estrato,
    website: sitioWeb,
    phone: telefono,
    confidence,
    reason,
    matched_by: matchedBy,
  };
}

// ─── DENUE response → sorted matches ──────────────────────────────────────────

function sortMatchesByConfidence(matches: DenueMatch[]): DenueMatch[] {
  return [...matches].sort((a, b) => b.confidence - a.confidence);
}

function buildEnrichmentOutput(
  fetchResult: FetchDenueResult,
  candidateName: string,
): SourceEnrichmentOutput {
  if (!fetchResult.ok) {
    return {
      sourceKey: 'mx_denue',
      status: 'error',
      matchedBy: null,
      confidence: 0,
      reason: fetchResult.error,
      metadata: {
        error: fetchResult.error,
        does_not_resolve_tax_identifier: true,
      },
    };
  }

  const rawRecords = fetchResult.records as Record<string, unknown>[];
  if (rawRecords.length === 0) {
    return {
      sourceKey: 'mx_denue',
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
      metadata: {
        status: 'no_match',
        source_key: 'mx_denue',
        matched_by: 'none',
        confidence: 0,
        human_review_required: true,
        does_not_resolve_tax_identifier: true,
        matches: [],
      },
    };
  }

  const allMatches = rawRecords
    .map((r) => rawRecordToDenueMatch(r, candidateName))
    .filter((m) => m.confidence >= 0.40);

  if (allMatches.length === 0) {
    return {
      sourceKey: 'mx_denue',
      status: 'no_match',
      matchedBy: null,
      confidence: 0,
      metadata: {
        status: 'no_match',
        source_key: 'mx_denue',
        matched_by: 'none',
        confidence: 0,
        human_review_required: true,
        does_not_resolve_tax_identifier: true,
        matches: [],
      },
    };
  }

  const sorted = sortMatchesByConfidence(allMatches);
  const topMatches = sorted.slice(0, 5);
  const topConfidence = topMatches[0].confidence;
  const hasSingleStrongMatch = topMatches.length === 1 && topConfidence >= 0.65;

  const enrichmentStatus = hasSingleStrongMatch ? 'matched' : 'ambiguous';
  const matchByValue = topMatches[0].matched_by;

  return {
    sourceKey: 'mx_denue',
    status: hasSingleStrongMatch ? 'matched' : 'matched',
    matchedBy: matchByValue !== 'none' ? (matchByValue === 'name' ? 'exact_name' as const : 'normalized_name' as const) : null,
    confidence: topConfidence,
    metadata: {
      status: enrichmentStatus,
      source_key: 'mx_denue',
      matched_by: topMatches[0].matched_by,
      confidence: topConfidence,
      human_review_required: true,
      does_not_resolve_tax_identifier: true,
      matches: topMatches,
    },
  };
}

// ─── Core enrichment logic (injectable for tests) ─────────────────────────────

export async function enrichCandidateImpl(
  input: SourceEnrichmentInput,
  fetchFn: DenueFetchFn,
): Promise<SourceEnrichmentOutput> {
  if (input.countryCode !== 'MX') {
    return {
      sourceKey: 'mx_denue',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'country_not_supported',
    };
  }

  if (!input.candidateName || input.candidateName.trim().length === 0) {
    return {
      sourceKey: 'mx_denue',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'missing_candidate_name',
    };
  }

  const tokens = significantTokens(input.candidateName);
  if (tokens.length === 0) {
    return {
      sourceKey: 'mx_denue',
      status: 'skipped',
      matchedBy: null,
      confidence: 0,
      reason: 'no_significant_tokens',
    };
  }

  // Use the first significant token as search term
  // For multi-word names, use up to 2 tokens
  const searchTerm = tokens.slice(0, 2).join(' ');

  const result = await fetchFn({
    condicion: searchTerm,
    entidad: '09',
    limit: 10,
  });

  return buildEnrichmentOutput(result, input.candidateName);
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const denueEnrichmentAdapter: SourceEnrichmentAdapter = {
  sourceKey: 'mx_denue',
  supportedCapabilities: [
    'enrichment_after_discovery',
  ] as SourceCapability[],

  async enrichCandidate(input: SourceEnrichmentInput): Promise<SourceEnrichmentOutput> {
    return enrichCandidateImpl(input, fetchDenueDatasetSample);
  },
};
