/**
 * SIIS Colombia — Enrichment Adapter
 *
 * Adaptador de enriquecimiento post-discovery para Supersociedades SIIS.
 * Opera EXCLUSIVAMENTE desde snapshot en source_company_snapshots.
 *
 * Comportamiento (migrado en EC4D5.APP-C4C al contrato cardinality-aware):
 * - Si la tabla no existe o está vacía → status: 'skipped' (nunca lanza).
 * - co_siis es TAX_GRAIN. El match por identidad fiscal usa el contrato
 *   snapshot-read (readLatestTaxGrainSnapshotByTaxId): scopea source_key +
 *   country_code + normalized_tax_id, ordena por source_year desc y prueba con
 *   `.limit(2)` — NUNCA `.limit(1).maybeSingle()`. Dos filas para el mismo NIT
 *   en el año más reciente se reportan como violación de cardinalidad
 *   observable, jamás como un pick arbitrario silencioso.
 * - Si se provee un tax id, el fallback por nombre NO corre: una identidad
 *   fiscal válida nunca se reemplaza por un match difuso de nombre.
 * - El fallback por nombre (solo sin tax id) queda scoped a
 *   source_key='co_siis', country_code='CO' y el source_year más reciente, y
 *   prueba con `.limit(2)`: 1 fila → match de baja confianza (comportamiento
 *   previo preservado); ≥2 filas → ambigüedad observable (no elige arbitrario).
 *
 * Solo server-side. No usar en Client Components.
 */

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  SnapshotReadQueryError,
  readLatestTaxGrainSnapshotByTaxId,
  type SnapshotIdentityRow,
  type SnapshotReadClient,
} from '../../snapshot-read/snapshot-read-contract';
import type {
  SourceEnrichmentAdapter,
  SourceEnrichmentInput,
  SourceEnrichmentOutput,
  SourceCapability,
} from '../../enrichment/types';

// ─── Constants ─────────────────────────────────────────────────────────────────

const SNAPSHOT_TABLE = 'source_company_snapshots' as const;
const SOURCE_KEY = 'co_siis' as const;
const COUNTRY_CODE = 'CO' as const;

/**
 * Columns consumed by buildSiisMatchResult. Includes source_year, required by
 * the latest-year cardinality-aware lookup to disambiguate the most recent year.
 */
const SNAPSHOT_SELECT_COLUMNS =
  'source_year, legal_name, normalized_tax_id, priority_score, sector, city, department, financials, signals';

// ─── Normalización ────────────────────────────────────────────────────────────

/** Normaliza NIT: elimina DV, puntos, guiones, espacios */
function normalizeNIT(nit: string): string {
  return nit
    .replace(/-\d{1,2}$/, '')
    .replace(/[\.\-\s]/g, '')
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

function getAdminSupabase(): SupabaseClient | null {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  return createClient(url, serviceKey);
}

// ─── Result builder ──────────────────────────────────────────────────────────

export function buildSiisMatchResult(
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
    // SIIS financials stored in billions of COP (e.g., 113.92 for ECOPETROL)
    if (revenue > 100) priorityBoost = 3;
    else if (revenue > 10) priorityBoost = 2;
    else if (revenue > 1) priorityBoost = 1;
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

// ─── No-match / skipped envelopes ──────────────────────────────────────────────

function skipped(reason: string): SourceEnrichmentOutput {
  return { sourceKey: SOURCE_KEY, status: 'skipped', matchedBy: null, confidence: 0, reason };
}

function noMatch(reason?: string): SourceEnrichmentOutput {
  return { sourceKey: SOURCE_KEY, status: 'no_match', matchedBy: null, confidence: 0, ...(reason ? { reason } : {}) };
}

// ─── Snapshot presence probe ────────────────────────────────────────────────────

/**
 * Scoped probe (source_key + country_code) that answers two questions in one
 * query the APP-C2 fake models: is the co_siis snapshot loaded at all, and what
 * is its most recent source_year (used to scope the name fallback). Uses a
 * `.order(...).limit(1)` list read — NOT `.limit(1).maybeSingle()` — because a
 * "top-1 by year" probe is legitimately single-row; it never truncates a
 * cardinality-sensitive identity lookup.
 */
async function probeCoSiisSnapshot(
  sb: SupabaseClient,
): Promise<{ loaded: boolean; latestYear: number | null }> {
  const { data, error } = await sb
    .from(SNAPSHOT_TABLE)
    .select('source_year')
    .eq('source_key', SOURCE_KEY)
    .eq('country_code', COUNTRY_CODE)
    .order('source_year', { ascending: false })
    .limit(1);

  if (error) {
    throw new SnapshotReadQueryError(
      `co_siis snapshot presence probe failed${error.code ? ` (${error.code})` : ''}`,
      { code: error.code, context: { lookup: 'probeCoSiisSnapshot' } },
    );
  }

  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return { loaded: false, latestYear: null };

  const year = row['source_year'];
  return {
    loaded: true,
    latestYear: typeof year === 'number' && Number.isFinite(year) ? year : null,
  };
}

/**
 * Scoped fuzzy-name fallback. Only runs when NO tax id was provided. Filters
 * source_key='co_siis', country_code='CO' and the most recent source_year, and
 * probes with `.limit(2)`:
 *   - 0 rows → no_match
 *   - 1 row  → normalized_name match at 0.60 (pre-migration behavior preserved)
 *   - ≥2 rows → ambiguous, reported observably; NEVER an arbitrary pick.
 */
async function matchCoSiisByName(
  sb: SupabaseClient,
  candidateName: string,
  latestYear: number,
): Promise<SourceEnrichmentOutput> {
  const normalizedSearchName = normalizeName(candidateName);
  if (normalizedSearchName.length <= 2) return noMatch();

  const { data, error } = await sb
    .from(SNAPSHOT_TABLE)
    .select(SNAPSHOT_SELECT_COLUMNS)
    .eq('source_key', SOURCE_KEY)
    .eq('country_code', COUNTRY_CODE)
    .eq('source_year', latestYear)
    .ilike('normalized_legal_name', `%${normalizedSearchName}%`)
    .limit(2);

  if (error) {
    throw new SnapshotReadQueryError(
      `co_siis name fallback query failed${error.code ? ` (${error.code})` : ''}`,
      { code: error.code, context: { lookup: 'matchCoSiisByName' } },
    );
  }

  const rows = (data as Array<Record<string, unknown>> | null) ?? [];
  if (rows.length === 0) return noMatch();
  if (rows.length === 1) return buildSiisMatchResult(rows[0], 'normalized_name', 0.6);

  // ≥2 fuzzy matches within the latest year: ambiguous. Do not pick arbitrarily.
  return noMatch('ambiguous_name_match');
}

// ─── Core enrichment (client injected — testable) ──────────────────────────────

/**
 * Core enrichment against a provided Supabase-shaped client. Exported (not on
 * the fixed SourceEnrichmentAdapter interface) so tests can inject the APP-C2
 * snapshot fake (tax-id path) or a local ilike-aware fake (name path) without
 * touching env/service-role wiring or the shared adapter interface.
 */
export async function enrichCoSiisCandidate(
  input: SourceEnrichmentInput,
  sb: SupabaseClient,
): Promise<SourceEnrichmentOutput> {
  const hasTaxId =
    input.candidateTaxId != null && String(input.candidateTaxId).trim().length > 0;

  try {
    // ── Tax-id path: fiscal identity via the cardinality-aware contract ──
    // If a tax id is provided, this is the ONLY path: a valid fiscal identity is
    // never replaced by a fuzzy name match.
    if (hasTaxId) {
      const normalizedNit = normalizeNIT(String(input.candidateTaxId));
      const result = await readLatestTaxGrainSnapshotByTaxId({
        client: sb as unknown as SnapshotReadClient<SnapshotIdentityRow>,
        sourceKey: SOURCE_KEY,
        countryCode: COUNTRY_CODE,
        normalizedTaxId: normalizedNit,
        selectColumns: SNAPSHOT_SELECT_COLUMNS,
      });

      switch (result.status) {
        case 'FOUND':
          return buildSiisMatchResult(result.row as Record<string, unknown>, 'tax_id', 0.95);
        case 'SOURCE_FAMILY_CARDINALITY_INVARIANT_VIOLATION':
        case 'MULTI_RECORD_SAME_FISCAL_IDENTITY':
          return noMatch('snapshot_cardinality_violation');
        case 'RECORD_IDENTITY_NOT_FOUND':
        case 'IDENTITY_UNAVAILABLE': {
          // Miss with a tax id provided: distinguish "snapshot not loaded"
          // (skipped) from "loaded but no fiscal match" (no_match). Fuzzy name
          // fallback is intentionally NOT attempted here.
          const presence = await probeCoSiisSnapshot(sb);
          return presence.loaded ? noMatch() : skipped('snapshot_not_available');
        }
      }
    }

    // ── Name fallback path: only when no tax id was provided ──
    const presence = await probeCoSiisSnapshot(sb);
    if (!presence.loaded || presence.latestYear === null) {
      return skipped('snapshot_not_available');
    }
    return await matchCoSiisByName(sb, input.candidateName, presence.latestYear);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const code = err instanceof SnapshotReadQueryError ? err.code : undefined;

    // Table doesn't exist yet — snapshot not imported.
    if (
      code === '42P01' ||
      msg.includes('does not exist') ||
      msg.includes('relation') ||
      msg.includes('42P01')
    ) {
      return skipped('snapshot_not_available');
    }

    return {
      sourceKey: SOURCE_KEY,
      status: 'error',
      matchedBy: null,
      confidence: 0,
      reason: msg,
    };
  }
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
        .from(SNAPSHOT_TABLE)
        .select('source_year, imported_at')
        .eq('source_key', SOURCE_KEY)
        .eq('country_code', COUNTRY_CODE)
        .order('imported_at', { ascending: false })
        .limit(1);

      const row = (data as Array<Record<string, unknown>> | null)?.[0];
      if (error ?? !row) return { available: false };

      return {
        available: true,
        year: row['source_year'] as number | undefined,
        lastImportedAt: row['imported_at'] as string | undefined,
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
    if (!sb) return skipped('snapshot_not_available');

    return enrichCoSiisCandidate(input, sb);
  },
};
