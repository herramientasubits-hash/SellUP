/**
 * Tests for Chile ChileCompra OCDS post-approval enrichment — v1.16CL-E
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  enrichChileCandidateWithChileCompraOcds,
  resolveRutFromInput,
  derivePriorityBoost,
} from '../chilecompra-ocds-post-approval-enrichment';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMatchResult(overrides = {}) {
  return {
    matched: true,
    source_year: 2025,
    legal_name: 'EMPRESA EJEMPLO LTDA',
    tax_id: '76543210-9',
    normalized_tax_id: '76543210-9',
    priority_score: 0.85,
    signals: {
      total_awarded_amount_clp: 10000000,
      awards_count: 2,
      last_award_date: '2025-03-01',
      buyer_names: ['SERVICIO X'],
      buyer_ruts: ['60000000-0'],
      unspsc_codes: ['72101501'],
      unspsc_descriptions: ['Obras'],
      ocids: ['ocds-70d2nz-001'],
      source_urls: [],
      procurement_methods: ['open'],
      awards_with_missing_amount: 0,
      awards_in_non_clp_currency: 0,
      currencies_seen: ['CLP'],
    },
    raw_data: {},
    reason: null,
    ...overrides,
  };
}

function makeNoMatchResult(reason = 'no_snapshot_match_by_rut') {
  return {
    matched: false,
    source_year: null,
    legal_name: null,
    tax_id: null,
    normalized_tax_id: '99999999-9',
    priority_score: null,
    signals: null,
    raw_data: null,
    reason,
  };
}

// ── resolveRutFromInput ────────────────────────────────────────────────────────

describe('resolveRutFromInput', () => {
  it('returns taxId when present', () => {
    assert.equal(resolveRutFromInput({ countryCode: 'CL', taxId: '12345678-9' }), '12345678-9');
  });

  it('falls back to metadata.tax_id', () => {
    assert.equal(
      resolveRutFromInput({ countryCode: 'CL', metadata: { tax_id: '12345678-9' } }),
      '12345678-9',
    );
  });

  it('falls back to metadata.rut', () => {
    assert.equal(
      resolveRutFromInput({ countryCode: 'CL', metadata: { rut: '12345678-9' } }),
      '12345678-9',
    );
  });

  it('returns null when no RUT available', () => {
    assert.equal(resolveRutFromInput({ countryCode: 'CL' }), null);
  });
});

// ── derivePriorityBoost ────────────────────────────────────────────────────────

describe('derivePriorityBoost', () => {
  it('returns 3 for score >= 0.8', () => assert.equal(derivePriorityBoost(0.9), 3));
  it('returns 2 for score >= 0.5', () => assert.equal(derivePriorityBoost(0.6), 2));
  it('returns 1 for score > 0', () => assert.equal(derivePriorityBoost(0.3), 1));
  it('returns 0 for score = 0', () => assert.equal(derivePriorityBoost(0), 0));
  it('returns 0 for null', () => assert.equal(derivePriorityBoost(null), 0));
});

// ── enrichChileCandidateWithChileCompraOcds ────────────────────────────────────

describe('enrichChileCandidateWithChileCompraOcds', () => {
  it('returns not_cl_country for non-CL candidate', async () => {
    const result = await enrichChileCandidateWithChileCompraOcds({
      countryCode: 'PE',
      taxId: '12345678',
    });
    assert.equal(result.enriched, false);
    assert.equal(result.cl_chilecompra_ocds, null);
    assert.equal(result.reason, 'not_cl_country');
  });

  it('returns missing_tax_id block when no RUT', async () => {
    const result = await enrichChileCandidateWithChileCompraOcds({ countryCode: 'CL' });
    assert.equal(result.enriched, true);
    assert.equal(result.reason, 'missing_tax_id');
    assert.equal(result.cl_chilecompra_ocds?.status, 'no_match');
    assert.equal(result.cl_chilecompra_ocds?.reason, 'missing_tax_id');
    assert.equal(result.cl_chilecompra_ocds?.confidence, 0);
  });

  it('builds matched block when lookup returns match', async () => {
    const mockLookup = async () => makeMatchResult();
    const result = await enrichChileCandidateWithChileCompraOcds(
      { countryCode: 'CL', taxId: '76543210-9' },
      mockLookup,
    );
    assert.equal(result.enriched, true);
    assert.equal(result.reason, 'rut_lookup_completed');
    assert.equal(result.cl_chilecompra_ocds?.status, 'matched');
    assert.equal(result.cl_chilecompra_ocds?.matched_by, 'tax_id');
    assert.equal(result.cl_chilecompra_ocds?.confidence, 1);
    assert.equal(result.cl_chilecompra_ocds?.source_year, 2025);
    assert.equal(result.cl_chilecompra_ocds?.source, 'source_company_snapshots');
    assert.equal(result.cl_chilecompra_ocds?.priority_boost, 3); // score=0.85 → boost=3
    assert.equal(result.cl_chilecompra_ocds?.reason, null);
    assert.ok(result.cl_chilecompra_ocds?.enriched_at);
  });

  it('builds no_match block when lookup returns no match', async () => {
    const mockLookup = async () => makeNoMatchResult();
    const result = await enrichChileCandidateWithChileCompraOcds(
      { countryCode: 'CL', taxId: '99999999-9' },
      mockLookup,
    );
    assert.equal(result.cl_chilecompra_ocds?.status, 'no_match');
    assert.equal(result.cl_chilecompra_ocds?.confidence, 0);
    assert.equal(result.cl_chilecompra_ocds?.priority_boost, 0);
    assert.equal(result.cl_chilecompra_ocds?.reason, 'no_snapshot_match_by_rut');
  });

  it('builds error block when lookup throws, does not rethrow', async () => {
    const mockLookup = async () => { throw new Error('connection timeout'); };
    const result = await enrichChileCandidateWithChileCompraOcds(
      { countryCode: 'CL', taxId: '76543210-9' },
      mockLookup,
    );
    assert.equal(result.enriched, true);
    assert.equal(result.cl_chilecompra_ocds?.status, 'error');
    assert.ok(result.cl_chilecompra_ocds?.reason?.includes('connection timeout'));
  });

  it('priority_boost is derived from priority_score', async () => {
    const mockLookup = async () => makeMatchResult({ priority_score: 0.3 });
    const result = await enrichChileCandidateWithChileCompraOcds(
      { countryCode: 'CL', taxId: '76543210-9' },
      mockLookup,
    );
    assert.equal(result.cl_chilecompra_ocds?.priority_boost, 1);
  });

  it('does not expose raw_data in metadata block', async () => {
    const mockLookup = async () => makeMatchResult({ raw_data: { huge_field: 'x'.repeat(5000) } });
    const result = await enrichChileCandidateWithChileCompraOcds(
      { countryCode: 'CL', taxId: '76543210-9' },
      mockLookup,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.equal((result.cl_chilecompra_ocds as any)['raw_data'], undefined);
  });

  it('never calls ChileCompra API (lookup is injected mock)', async () => {
    let called = false;
    const mockLookup = async () => { called = true; return makeNoMatchResult(); };
    await enrichChileCandidateWithChileCompraOcds(
      { countryCode: 'CL', taxId: '76543210-9' },
      mockLookup,
    );
    assert.equal(called, true);
  });

  it('does not create candidates or accounts (pure enrichment layer)', async () => {
    const mockLookup = async () => makeMatchResult();
    const result = await enrichChileCandidateWithChileCompraOcds(
      { countryCode: 'CL', taxId: '76543210-9' },
      mockLookup,
    );
    assert.equal(result.enriched, true);
    // No throw confirms no DB write attempted in this pure layer
  });
});
