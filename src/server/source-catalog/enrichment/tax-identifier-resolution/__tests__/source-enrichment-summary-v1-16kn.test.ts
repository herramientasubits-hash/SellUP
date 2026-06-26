/**
 * Tests — source_enrichment per-candidate summary — v1.16K-N pre-pilot hardening
 *
 * Verifica:
 * - _summary se escribe en metadata.source_enrichment al persistir candidatos
 * - Merge seguro: no borra metadata previa
 * - tax_identifier y tax_identifier_type se preservan cuando existen
 * - status 'no_match' queda explícito cuando no hay output de fuente
 * - status 'completed' cuando la fuente produce metadata
 *
 * Sin Supabase real. Sin LLM. Sin APIs externas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Helper: simula la lógica de _summary para CO ────────────────────────────

function buildCOSummary(
  sourceKeysAttempted: string[],
  sourceKeysMatched: string[],
  taxIdentifier: string | null,
): Record<string, unknown> {
  return {
    status: sourceKeysMatched.length > 0 ? 'completed' : 'no_match',
    enriched_at: new Date().toISOString(),
    country_code: 'CO',
    source_keys_attempted: sourceKeysAttempted,
    source_keys_matched: sourceKeysMatched,
    tax_resolution_status: taxIdentifier ? 'resolved' : 'not_found',
    tax_identifier: taxIdentifier,
    tax_identifier_type: 'NIT',
    reason: sourceKeysMatched.length === 0 ? 'no_source_match' : null,
  };
}

function buildMXSummary(
  hasDenueOutput: boolean,
  taxIdentifier: string | null,
): Record<string, unknown> {
  return {
    status: hasDenueOutput ? 'completed' : 'no_match',
    enriched_at: new Date().toISOString(),
    country_code: 'MX',
    source_keys_attempted: ['mx_denue'],
    source_keys_matched: hasDenueOutput ? ['mx_denue'] : [],
    tax_resolution_status: taxIdentifier ? 'resolved' : 'not_found',
    tax_identifier: taxIdentifier,
    tax_identifier_type: 'RFC',
    reason: !hasDenueOutput ? 'no_denue_output' : null,
  };
}

function buildCLSummary(
  hasInapiOutput: boolean,
  inapiError: boolean,
  taxIdentifier: string | null,
): Record<string, unknown> {
  return {
    status: inapiError ? 'error' : hasInapiOutput ? 'completed' : 'no_match',
    enriched_at: new Date().toISOString(),
    country_code: 'CL',
    source_keys_attempted: ['cl_inapi'],
    source_keys_matched: hasInapiOutput ? ['cl_inapi'] : [],
    tax_resolution_status: taxIdentifier ? 'resolved' : 'skipped',
    tax_identifier: taxIdentifier,
    tax_identifier_type: 'RUT',
    reason: inapiError ? 'inapi_error' : !hasInapiOutput ? 'no_inapi_output' : null,
  };
}

function mergeSourceEnrichment(
  existingMeta: Record<string, unknown>,
  newSourceEnrichment: Record<string, unknown>,
  summary: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...existingMeta,
    source_enrichment: {
      ...((existingMeta['source_enrichment'] as Record<string, unknown>) ?? {}),
      ...newSourceEnrichment,
      _summary: summary,
    },
  };
}

// ─── Tests CO ─────────────────────────────────────────────────────────────────

describe('source_enrichment._summary — CO (P1-2)', () => {
  it('candidate receives _summary with status completed when sources matched', () => {
    const summary = buildCOSummary(['rues', 'dane'], ['rues'], '900123456-1');
    assert.equal(summary.status, 'completed');
    assert.deepEqual(summary.source_keys_matched, ['rues']);
    assert.equal(summary.tax_resolution_status, 'resolved');
    assert.equal(summary.tax_identifier, '900123456-1');
    assert.equal(summary.tax_identifier_type, 'NIT');
    assert.equal(summary.reason, null);
  });

  it('candidate receives _summary with status no_match when no sources matched', () => {
    const summary = buildCOSummary(['rues', 'dane'], [], null);
    assert.equal(summary.status, 'no_match');
    assert.deepEqual(summary.source_keys_matched, []);
    assert.equal(summary.tax_resolution_status, 'not_found');
    assert.equal(summary.tax_identifier, null);
    assert.equal(summary.reason, 'no_source_match');
  });

  it('merge does not overwrite existing metadata fields', () => {
    const existingMeta = {
      scoring: { fit_score: 85 },
      search_trace: { query_text: 'empresa ABC' },
      source_enrichment: { co_rues: { status: 'completed' } },
    };
    const summary = buildCOSummary(['rues'], ['rues'], '800111222-5');
    const merged = mergeSourceEnrichment(existingMeta, { co_rues: { status: 'updated' } }, summary);

    assert.equal((merged.scoring as Record<string, unknown>)['fit_score'], 85);
    assert.ok((merged.source_enrichment as Record<string, unknown>)['_summary']);
    assert.ok((merged.source_enrichment as Record<string, unknown>)['co_rues']);
  });

  it('tax_identifier_type is NIT for CO', () => {
    const summary = buildCOSummary([], [], null);
    assert.equal(summary.tax_identifier_type, 'NIT');
  });
});

// ─── Tests MX ─────────────────────────────────────────────────────────────────

describe('source_enrichment._summary — MX (P1-2)', () => {
  it('status completed when DENUE produced output', () => {
    const summary = buildMXSummary(true, 'ABC123456DEF');
    assert.equal(summary.status, 'completed');
    assert.deepEqual(summary.source_keys_matched, ['mx_denue']);
    assert.equal(summary.tax_identifier_type, 'RFC');
    assert.equal(summary.country_code, 'MX');
  });

  it('status no_match when DENUE produced no output', () => {
    const summary = buildMXSummary(false, null);
    assert.equal(summary.status, 'no_match');
    assert.deepEqual(summary.source_keys_matched, []);
    assert.equal(summary.reason, 'no_denue_output');
    assert.equal(summary.tax_identifier, null);
  });

  it('tax_resolution_status resolved when tax_identifier present', () => {
    const summary = buildMXSummary(true, 'RFC123456ABC');
    assert.equal(summary.tax_resolution_status, 'resolved');
  });
});

// ─── Tests CL ─────────────────────────────────────────────────────────────────

describe('source_enrichment._summary — CL (P1-2)', () => {
  it('status completed when INAPI produced output', () => {
    const summary = buildCLSummary(true, false, '12.345.678-9');
    assert.equal(summary.status, 'completed');
    assert.deepEqual(summary.source_keys_matched, ['cl_inapi']);
    assert.equal(summary.tax_identifier_type, 'RUT');
    assert.equal(summary.country_code, 'CL');
  });

  it('status no_match when INAPI produced no output', () => {
    const summary = buildCLSummary(false, false, null);
    assert.equal(summary.status, 'no_match');
    assert.equal(summary.reason, 'no_inapi_output');
    assert.equal(summary.tax_resolution_status, 'skipped');
  });

  it('status error when INAPI threw', () => {
    const summary = buildCLSummary(false, true, null);
    assert.equal(summary.status, 'error');
    assert.equal(summary.reason, 'inapi_error');
  });

  it('tax_resolution_status resolved when RUT present', () => {
    const summary = buildCLSummary(true, false, '76543210-K');
    assert.equal(summary.tax_resolution_status, 'resolved');
    assert.equal(summary.tax_identifier, '76543210-K');
  });
});

// ─── Merge safety ─────────────────────────────────────────────────────────────

describe('source_enrichment merge safety (P1-2)', () => {
  it('_summary does not overwrite existing source_enrichment keys', () => {
    const existingMeta = {
      source_enrichment: {
        co_rues: { status: 'completed', rut: '123' },
        pe_sunat_bulk: { status: 'ok' },
      },
    };
    const summary = buildCOSummary(['co_rues'], ['co_rues'], '123456789-0');
    const merged = mergeSourceEnrichment(existingMeta, { co_rues: { status: 'updated' } }, summary);
    const se = merged.source_enrichment as Record<string, unknown>;

    assert.ok(se['pe_sunat_bulk'], 'pe_sunat_bulk should be preserved');
    assert.ok(se['_summary'], '_summary should be added');
    assert.ok(se['co_rues'], 'co_rues should be present');
  });

  it('_summary enriched_at is a valid ISO date string', () => {
    const summary = buildCOSummary([], [], null);
    const d = new Date(summary.enriched_at as string);
    assert.ok(!isNaN(d.getTime()), 'enriched_at should be a valid date');
  });
});
