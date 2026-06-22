// Tests — SIIS Colombia enrichment adapter
//
// Verifica buildSiisMatchResult y guard clauses del adapter.
// Sin llamadas reales a Supabase. Sin internet.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSiisMatchResult, siisEnrichmentAdapter } from '../siis-enrichment-adapter';
import type { SourceEnrichmentInput } from '../../../enrichment/types';

// ─── 1. buildSiisMatchResult ─────────────────────────────────────────────────

describe('buildSiisMatchResult', () => {
  it('builds matched result with priority boost for high revenue', () => {
    const row = {
      source_year: 2024,
      source_key: 'co_siis',
      legal_name: 'Tecnología Avanzada SAS',
      normalized_tax_id: '900123456',
      priority_score: 7,
      sector: 'Servicios',
      city: 'Bogotá',
      department: 'Cundinamarca',
      financials: {
        operatingRevenueCurrent: 50,
        profitLossCurrent: 5,
      },
      signals: { supervisor: 'Supersociedades', ciiu: '6201' },
    };

    const result = buildSiisMatchResult(row, 'tax_id', 0.95);

    assert.equal(result.sourceKey, 'co_siis');
    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'tax_id');
    assert.equal(result.confidence, 0.95);
    assert.equal(result.sourceYear, 2024);
    assert.equal(result.priorityBoost, 2);
    assert.equal((result.signals as Record<string, unknown>)['sector'], 'Servicios');
    assert.equal((result.signals as Record<string, unknown>)['city'], 'Bogotá');
  });

  it('priority boost 3 for revenue > 100B COP', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 200 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 3);
  });

  it('priority boost 2 for revenue > 10B COP', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 24.75 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 2);
  });

  it('priority boost 1 for revenue > 1B COP', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 5 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 1);
  });

  it('priority boost 0 for revenue <= 1B COP', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 0.5 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 0);
  });

  it('ECOPETROL-like: 113.92 → priority boost 3', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 113.92 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 3);
  });

  it('D1-like: 19.44 → priority boost 2', () => {
    const result = buildSiisMatchResult(
      { financials: { operatingRevenueCurrent: 19.44 } },
      'tax_id',
      0.95,
    );
    assert.equal(result.priorityBoost, 2);
  });

  it('priority boost 0 when no revenue', () => {
    const result = buildSiisMatchResult({}, 'tax_id', 0.95);
    assert.equal(result.priorityBoost, 0);
  });

  it('includes signals and metadata', () => {
    const row = {
      legal_name: 'Empresa Test',
      normalized_tax_id: '800123456',
      priority_score: 5,
      financials: { operatingRevenueCurrent: 2 },
      signals: { supervisor: 'Test', ciiu: '1234' },
    };

    const result = buildSiisMatchResult(row, 'normalized_name', 0.6);
    assert.equal(result.matchedBy, 'normalized_name');
    assert.equal(result.confidence, 0.6);
    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['legal_name'], 'Empresa Test');
    assert.equal(meta['normalized_tax_id'], '800123456');
    assert.equal(meta['priority_score'], 5);
  });
});

// ─── 2. Adapter guard clauses ─────────────────────────────────────────────────

describe('siisEnrichmentAdapter enrichCandidate — guard clauses', () => {
  it('returns skipped for non-CO country', async () => {
    const input: SourceEnrichmentInput = {
      candidateName: 'Empresa X',
      countryCode: 'MX',
      capability: 'enrichment_after_discovery',
    };
    const result = await siisEnrichmentAdapter.enrichCandidate(input);
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'country_not_supported');
  });

  it('returns skipped when no SUPABASE_SERVICE_ROLE_KEY', async () => {
    // This test relies on SUPABASE_SERVICE_ROLE_KEY not being set in test env
    const input: SourceEnrichmentInput = {
      candidateName: 'Empresa X',
      countryCode: 'CO',
      candidateTaxId: '900123456',
      capability: 'enrichment_after_discovery',
    };
    const result = await siisEnrichmentAdapter.enrichCandidate(input);
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'snapshot_not_available');
  });
});
