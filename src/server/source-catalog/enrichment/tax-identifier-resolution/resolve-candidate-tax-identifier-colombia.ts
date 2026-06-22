import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ResolveTaxIdentifierInput,
  type ResolveTaxIdentifierOutput,
  type TaxIdentifierCandidate,
} from './types';
import { normalizeColombiaCompanyName, normalizeColombiaCompanyNameExact } from './normalize-name';

export const GENERIC_THRESHOLD = 2;

export const GENERIC_KEYWORDS = new Set([
  'software',
  'servicios', 'servicio',
  'tecnologia', 'tecnologias', 'tecnologica', 'tecnologicos',
  'consultoria', 'consultorias',
  'soluciones', 'solucion',
  'enterprise',
  'colombia',
  'erp',
  'crm',
  'recursos',
  'humanos',
  'b2b',
  'sistemas',
  'industria', 'industrial',
  'negocios',
  'gestion',
  'comercial', 'comercializadora',
  'corporacion', 'corporativo',
  'internacional',
  'compania', 'compania_acento',
  'grupo',
  'logistica',
  'digital', 'digitales',
  'inteligencia',
  'procesos',
  'productos',
  'proveedora',
  'sociedad',
  'marketing',
  'publicidad',
  'estrategia',
  'mercadeo',
]);

export function hasDomainSignal(
  token: string,
  domain: string | null | undefined,
  website: string | null | undefined,
): boolean {
  const tokenLower = token.toLowerCase();
  const urls = [domain, website].filter(Boolean) as string[];
  if (urls.length === 0) return false;

  for (const url of urls) {
    const clean = url.toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '');
    const domainRoot = clean.split('.')[0];
    if (domainRoot === tokenLower) return true;
    if (clean.includes(tokenLower)) return true;
  }
  return false;
}

export function isNameTooGeneric(
  tokens: string[],
  domain: string | null | undefined = undefined,
  website: string | null | undefined = undefined,
): boolean {
  const meaningful = tokens.filter(t => t.length >= 4);

  if (meaningful.length >= GENERIC_THRESHOLD) {
    return false;
  }

  const singleToken = meaningful.length > 0 ? meaningful[0] : tokens[0];
  if (!singleToken) return true;

  const lower = singleToken.toLowerCase();

  if (GENERIC_KEYWORDS.has(lower)) return true;

  if (hasDomainSignal(singleToken, domain, website)) return false;

  if (singleToken.length >= 5) return false;

  return true;
}

export function getSupabaseClient(): SupabaseClient | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(url, serviceKey);
}

export async function querySnapshotByName(
  sb: SupabaseClient,
  normalizedName: string,
  exact: boolean,
): Promise<Record<string, unknown>[]> {
  if (exact) {
    const { data, error } = await sb
      .from('source_company_snapshots')
      .select('*')
      .eq('source_key', 'co_siis')
      .eq('country_code', 'CO')
      .eq('normalized_legal_name', normalizedName)
      .limit(5);

    if (error) return [];
    return (data ?? []) as Record<string, unknown>[];
  }

  const { data, error } = await sb
    .from('source_company_snapshots')
    .select('*')
    .eq('source_key', 'co_siis')
    .eq('country_code', 'CO')
    .ilike('normalized_legal_name', `%${normalizedName}%`)
    .limit(10);

  if (error) return [];
  return (data ?? []) as Record<string, unknown>[];
}

export function buildCandidate(
  row: Record<string, unknown>,
  confidence: number,
  reason: string,
): TaxIdentifierCandidate {
  return {
    taxIdentifier: (row['normalized_tax_id'] as string) ?? '',
    legalName: (row['legal_name'] as string) ?? (row['normalized_legal_name'] as string) ?? '',
    sourceKey: 'co_siis',
    confidence,
    reason,
  };
}

export function findExactMatch(
  rows: Record<string, unknown>[],
  normalizedName: string,
): TaxIdentifierCandidate | null {
  const exactRows = rows.filter(
    (r) => (r['normalized_legal_name'] as string) === normalizedName,
  );

  if (exactRows.length === 1) {
    return buildCandidate(exactRows[0], 0.85, 'Exact normalized name match in SIIS snapshot');
  }

  return null;
}

export function findPartialMatches(
  rows: Record<string, unknown>[],
  normalizedName: string,
): TaxIdentifierCandidate[] {
  const searchTokens = normalizedName.split(' ').filter(t => t.length > 0);
  if (searchTokens.length === 0) return [];

  const scored: Array<{ row: Record<string, unknown>; score: number; matchedAll: boolean }> = [];

  for (const row of rows) {
    const dbName = (row['normalized_legal_name'] as string) ?? '';
    const dbTokens = dbName.split(' ').filter(t => t.length > 0);
    if (dbTokens.length === 0) continue;

    const dbTokenSet = new Set(dbTokens);

    let matchCount = 0;
    for (const token of searchTokens) {
      if (dbTokenSet.has(token)) matchCount++;
    }

    const ratio = matchCount / searchTokens.length;
    const matchedAll = ratio >= 0.8;

    if (matchCount > 0) {
      scored.push({ row, score: ratio, matchedAll });
    }
  }

  if (scored.length === 0) return [];

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (best.matchedAll && scored.filter(s => s.matchedAll).length === 1) {
    return [buildCandidate(best.row, 0.60, 'Partial normalized name match (>=80% token overlap) in SIIS snapshot')];
  }

  return scored.map(s =>
    buildCandidate(s.row, 0.50, `Partial name match (${Math.round(s.score * 100)}% token overlap) in SIIS snapshot`),
  );
}

export async function resolveCandidateTaxIdentifierForColombia(
  input: ResolveTaxIdentifierInput,
): Promise<ResolveTaxIdentifierOutput> {
  if (input.countryCode !== 'CO') {
    return {
      status: 'skipped',
      confidence: 0,
      metadata: { warning: 'Country code is not CO' },
    };
  }

  const name = input.name?.trim();
  if (!name || name.length < 3) {
    return {
      status: 'skipped',
      confidence: 0,
      metadata: { warning: 'Name too short to resolve' },
    };
  }

  try {
    const exactNormalized = normalizeColombiaCompanyNameExact(name);
    const searchNormalized = normalizeColombiaCompanyName(name);

    if (!exactNormalized || exactNormalized.length < 2) {
      return {
        status: 'skipped',
        confidence: 0,
        metadata: { warning: 'Normalized name too short' },
      };
    }

    const searchTokens = searchNormalized.split(' ').filter(t => t.length > 0);
    if (isNameTooGeneric(searchTokens, input.domain, input.website)) {
      return {
        status: 'skipped',
        confidence: 0,
        metadata: {
          normalizedSearchName: searchNormalized,
          warning: 'Name too generic to resolve reliably',
        },
      };
    }

    const sb = getSupabaseClient();
    if (!sb) {
      return {
        status: 'error',
        confidence: 0,
        metadata: { warning: 'Supabase client not available' },
      };
    }

    const exactRows = await querySnapshotByName(sb, exactNormalized, true);

    const exactMatch = findExactMatch(exactRows, exactNormalized);
    if (exactMatch) {
      const row = exactRows.find(
        (r) => (r['normalized_legal_name'] as string) === exactNormalized,
      );
      return {
        status: 'resolved',
        taxIdentifier: exactMatch.taxIdentifier,
        confidence: 0.85,
        matchedBy: 'normalized_name',
        sourceKey: 'co_siis',
        candidates: [exactMatch],
        metadata: {
          normalizedSearchName: searchNormalized,
          matchedLegalName: exactMatch.legalName,
          sourceYear: (row?.['source_year'] as number | undefined) ?? undefined,
        },
      };
    }

    if (exactRows.length > 1) {
      const candidates = exactRows.map(r =>
        buildCandidate(r, 0.60, 'Multiple exact matches found in SIIS snapshot'),
      );
      return {
        status: 'ambiguous',
        confidence: 0.72,
        matchedBy: 'normalized_name',
        sourceKey: 'co_siis',
        candidates,
        metadata: {
          normalizedSearchName: searchNormalized,
          warning: `Found ${exactRows.length} exact matches, cannot determine which is correct`,
        },
      };
    }

    const partialRows = await querySnapshotByName(sb, searchNormalized, false);
    const partialCandidates = findPartialMatches(partialRows, searchNormalized);

    if (partialCandidates.length === 0) {
      return {
        status: 'not_found',
        confidence: 0,
        metadata: {
          normalizedSearchName: searchNormalized,
        },
      };
    }

    const mediumConfidence = partialCandidates.filter(c => c.confidence >= 0.60);
    if (mediumConfidence.length === 1) {
      return {
        status: 'ambiguous',
        confidence: 0.60,
        matchedBy: 'partial_normalized_name',
        sourceKey: 'co_siis',
        candidates: mediumConfidence,
        metadata: {
          normalizedSearchName: searchNormalized,
          matchedLegalName: mediumConfidence[0].legalName,
          warning: 'Partial name match found but confidence < 0.85 — requires human review',
        },
      };
    }

    if (mediumConfidence.length > 1) {
      return {
        status: 'ambiguous',
        confidence: 0.65,
        matchedBy: 'partial_normalized_name',
        sourceKey: 'co_siis',
        candidates: mediumConfidence,
        metadata: {
          normalizedSearchName: searchNormalized,
          warning: `Found ${partialCandidates.length} partial matches, multiple have reasonable confidence`,
        },
      };
    }

    return {
      status: 'not_found',
      confidence: 0,
      metadata: {
        normalizedSearchName: searchNormalized,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return {
      status: 'error',
      confidence: 0,
      metadata: { warning: msg },
    };
  }
}
