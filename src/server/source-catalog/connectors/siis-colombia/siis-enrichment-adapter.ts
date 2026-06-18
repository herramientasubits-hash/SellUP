/**
 * SIIS Colombia — Enrichment Adapter
 *
 * Adaptador de enriquecimiento post-discovery para Supersociedades SIIS.
 * Opera EXCLUSIVAMENTE desde snapshot en source_company_snapshots.
 *
 * Comportamiento:
 * - Si la tabla no existe o está vacía → devuelve status: 'skipped' (nunca lanza)
 * - Intenta match por NIT normalizado primero
 * - Fallback a match por nombre normalizado (menor confianza)
 * - Calcula priorityBoost según ingresos operacionales
 *
 * Solo server-side. No usar en Client Components.
 */

import { createClient } from '@supabase/supabase-js';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
  SourceCapability,
} from '../../enrichment/types';

// ─── Normalización ────────────────────────────────────────────────────────────

/** Normaliza NIT: elimina puntos, guiones, espacios y dígito de verificación */
function normalizeNIT(nit: string): string {
  return nit
    .replace(/[\.\-\s]/g, '')
    .replace(/-\d$/, '')
    .trim();
}

/** Normaliza razón social: minúsculas, sin tildes, sin sufijos legales */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove combining diacritics
    .replace(/\b(s\.a\.s\.?|sas|s\.a\.?|ltda\.?|e\.u\.?|corp\.?|inc\.?|llc|s\.r\.l\.?)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Supabase admin client (service role) ────────────────────────────────────

function getAdminSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(url, serviceKey);
}

// ─── Result builder ──────────────────────────────────────────────────────────

function buildMatchResult(
  row: Record<string, unknown>,
  matchedBy: 'tax_id' | 'normalized_name',
  confidence: number,
): SourceEnrichmentOutput {
  const financials = (row['financials'] as Record<string, unknown>) ?? {};
  const signals = (row['signals'] as Record<string, unknown>) ?? {};

  // Compute priority boost based on operating revenue (COP)
  let priorityBoost = 0;
  const revenue =
    (financials['operatingRevenueCurrent'] as number | undefined) ??
    (financials['operating_revenue_current'] as number | undefined);
  if (typeof revenue === 'number') {
    if (revenue > 100_000_000_000) priorityBoost = 3;      // > 100B COP
    else if (revenue > 10_000_000_000) priorityBoost = 2;  // > 10B COP
    else if (revenue > 1_000_000_000) priorityBoost = 1;   // > 1B COP
  }

  return {
    sourceKey: 'co_siis',
    status: 'matched',
    matchedBy,
    confidence,
    sourceYear: typeof row['source_year'] === 'number' ? row['source_year'] : undefined,
    priorityBoost,
    signals: {
      sector: row['sector'],
      city: row['city'],
      department: row['department'],
      ...signals,
    },
    financials,
    metadata: {
      legal_name: row['legal_name'],
      normalized_tax_id: row['normalized_tax_id'],
      priority_score: row['priority_score'],
    },
  };
}

// ─── Adapter implementation ──────────────────────────────────────────────────

export const siisEnrichmentAdapter: SourceEnrichmentAdapter = {
  sourceKey: 'co_siis',
  supportedCapabilities: [
    'enrichment_after_discovery',
    'tax_id_validation',
    'financial_signals',
    'prioritization',
  ] as SourceCapability[],

  async getSnapshotStatus() {
    try {
      const sb = getAdminSupabase();
      if (!sb) return { available: false };

      const { data, error } = await sb
        .from('source_company_snapshots')
        .select('source_year, imported_at')
        .eq('source_key', 'co_siis')
        .order('imported_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error ?? !data) return { available: false };

      return {
        available: true,
        year: data['source_year'] as number | undefined,
        lastImportedAt: data['imported_at'] as string | undefined,
      };
    } catch {
      return { available: false };
    }
  },

  async enrichCandidate(input: SourceEnrichmentInput): Promise<SourceEnrichmentOutput> {
    if (input.countryCode !== 'CO') {
      return {
        sourceKey: 'co_siis',
        status: 'skipped',
        matchedBy: null,
        confidence: 0,
        reason: 'country_not_supported',
      };
    }

    const sb = getAdminSupabase();
    if (!sb) {
      return {
        sourceKey: 'co_siis',
        status: 'skipped',
        matchedBy: null,
        confidence: 0,
        reason: 'snapshot_not_available',
      };
    }

    try {
      // 1. Try match by NIT first (highest confidence)
      if (input.candidateTaxId) {
        const normalizedNit = normalizeNIT(input.candidateTaxId);
        const { data, error } = await sb
          .from('source_company_snapshots')
          .select('*')
          .eq('source_key', 'co_siis')
          .eq('normalized_tax_id', normalizedNit)
          .limit(1)
          .maybeSingle();

        if (!error && data) {
          return buildMatchResult(data as Record<string, unknown>, 'tax_id', 0.95);
        }
      }

      // 2. Fallback: normalized name match (lower confidence)
      const normalizedSearchName = normalizeName(input.candidateName);
      if (normalizedSearchName.length > 2) {
        const { data: nameMatch, error: nameErr } = await sb
          .from('source_company_snapshots')
          .select('*')
          .eq('source_key', 'co_siis')
          .ilike('normalized_legal_name', `%${normalizedSearchName}%`)
          .limit(1)
          .maybeSingle();

        if (!nameErr && nameMatch) {
          return buildMatchResult(nameMatch as Record<string, unknown>, 'normalized_name', 0.60);
        }
      }

      // 3. Check if snapshot is loaded at all
      const { count } = await sb
        .from('source_company_snapshots')
        .select('id', { count: 'exact', head: true })
        .eq('source_key', 'co_siis');

      if (!count || count === 0) {
        return {
          sourceKey: 'co_siis',
          status: 'skipped',
          matchedBy: null,
          confidence: 0,
          reason: 'snapshot_not_available',
        };
      }

      return {
        sourceKey: 'co_siis',
        status: 'no_match',
        matchedBy: null,
        confidence: 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';

      // Table doesn't exist yet — snapshot not imported
      if (
        msg.includes('does not exist') ||
        msg.includes('relation') ||
        msg.includes('42P01')
      ) {
        return {
          sourceKey: 'co_siis',
          status: 'skipped',
          matchedBy: null,
          confidence: 0,
          reason: 'snapshot_not_available',
        };
      }

      return {
        sourceKey: 'co_siis',
        status: 'error',
        matchedBy: null,
        confidence: 0,
        reason: msg,
      };
    }
  },
};
