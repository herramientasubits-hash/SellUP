/**
 * Tests — Agent 1 v1.16K-H — Content/Intermediary Gate & Review Flags
 *
 * Sin Tavily real. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — CiberBlog: nombre "blog" + snippet broker → blocked (blog_content_site + not_a_direct_vendor)
 * F2  — Blog Analytics Technologies S.A.S. → NOT blocked (direct vendor counter-signal)
 * F3  — "Directorio de Proveedores" name → blocked (content_or_intermediary_site)
 * F4  — Domain ciber.blog.net → blocked (domain contains blog)
 * F5  — "Te conectamos con partners" snippet only → blocked (not_a_direct_vendor)
 * F6  — "Buscador de empresas" snippet → blocked (content_or_intermediary_site)
 * F7  — Clean candidate, no signals → NOT blocked
 * F8  — Confidence grows with multiple signals
 * F9  — buildReviewFlags: no taxId → no_tax_id flag
 * F10 — buildReviewFlags: no size → size_unknown flag
 * F11 — buildReviewFlags: source_enrichment no_match → source_enrichment_no_match flag
 * F12 — buildReviewFlags: contentGate possible_intermediary → possible_intermediary flag
 * F13 — buildReviewFlags: existing flags preserved
 * F14 — buildPreReviewEnrichmentMetadata: attempted sources → status attempted
 * F15 — buildPreReviewEnrichmentMetadata: no sources → status no_sources
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateContentIntermediaryGate,
  buildReviewFlags,
  buildPreReviewEnrichmentMetadata,
  type ContentIntermediaryInput,
  type ReviewFlagsInput,
  type SourceEnrichmentAttempt,
} from '../content-intermediary-gate';

// ─── F1-F8: evaluateContentIntermediaryGate ───────────────────────────────────

describe('v1.16K-H — evaluateContentIntermediaryGate', () => {

  it('F1 — CiberBlog: name has "blog" + broker snippet → blocked with blog_content_site and not_a_direct_vendor', () => {
    const input: ContentIntermediaryInput = {
      name: 'CiberBlog',
      domain: 'ciberblog.net',
      snippet: 'Te conectamos con Partners Certificados de las marcas líderes a nivel mundial',
    };
    const result = evaluateContentIntermediaryGate(input);
    assert.equal(result.blocked, true);
    assert.ok(result.reasons.includes('blog_content_site'), 'should include blog_content_site');
    assert.ok(result.reasons.includes('not_a_direct_vendor'), 'should include not_a_direct_vendor');
    assert.ok(result.confidence >= 0.6, `confidence should be >= 0.6, got ${result.confidence}`);
  });

  it('F2 — "Blog Analytics Technologies S.A.S." has direct vendor counter-signal → NOT blocked', () => {
    const input: ContentIntermediaryInput = {
      name: 'Blog Analytics Technologies S.A.S.',
      domain: 'bloganalytics.com',
    };
    const result = evaluateContentIntermediaryGate(input);
    assert.equal(result.blocked, false, 'direct vendor signals should prevent block');
    assert.equal(result.reasons.length, 0);
  });

  it('F3 — Name "Directorio de Proveedores Colombia" → blocked (content_or_intermediary_site)', () => {
    const input: ContentIntermediaryInput = {
      name: 'Directorio',
      domain: 'directorioproveedores.co',
    };
    const result = evaluateContentIntermediaryGate(input);
    assert.equal(result.blocked, true);
    assert.ok(result.reasons.includes('content_or_intermediary_site'), 'should include content_or_intermediary_site');
  });

  it('F4 — Domain "empresa.blog.com.co" without direct vendor name → blocked (blog_content_site)', () => {
    const input: ContentIntermediaryInput = {
      name: 'Empresa Blog',
      domain: 'empresa.blog.com.co',
    };
    const result = evaluateContentIntermediaryGate(input);
    assert.equal(result.blocked, true);
    assert.ok(result.reasons.includes('blog_content_site'));
  });

  it('F5 — Snippet only has "te conectamos con partners" with neutral name → blocked (not_a_direct_vendor)', () => {
    const input: ContentIntermediaryInput = {
      name: 'SomeCompany',
      domain: 'somecompany.co',
      snippet: 'Te conectamos con partners especializados en tecnología',
    };
    const result = evaluateContentIntermediaryGate(input);
    assert.equal(result.blocked, true);
    assert.ok(result.reasons.includes('not_a_direct_vendor'));
  });

  it('F6 — Snippet "buscador de empresas" → blocked (content_or_intermediary_site)', () => {
    const input: ContentIntermediaryInput = {
      name: 'FindCo',
      domain: 'findco.co',
      snippet: 'somos el mejor buscador de empresas en Colombia',
    };
    const result = evaluateContentIntermediaryGate(input);
    assert.equal(result.blocked, true);
    assert.ok(result.reasons.includes('content_or_intermediary_site'));
  });

  it('F7 — Clean direct vendor candidate → NOT blocked, confidence 0', () => {
    const input: ContentIntermediaryInput = {
      name: 'Acme Software S.A.S.',
      domain: 'acmesoftware.com',
      snippet: 'Desarrollamos soluciones de software para el sector financiero en Colombia.',
      taxIdentifier: '900123456-7',
      companySize: '51-200',
    };
    const result = evaluateContentIntermediaryGate(input);
    assert.equal(result.blocked, false);
    assert.equal(result.reasons.length, 0);
    assert.equal(result.confidence, 0);
    assert.equal(result.signals.length, 0);
  });

  it('F8 — Multiple signals increase confidence monotonically', () => {
    const oneSignal = evaluateContentIntermediaryGate({
      name: 'Blog Noticias',
      domain: 'neutralsite.co',
    });
    const twoSignals = evaluateContentIntermediaryGate({
      name: 'Blog Noticias',
      domain: 'blogtest.co',
    });
    assert.ok(oneSignal.blocked);
    assert.ok(twoSignals.blocked);
    assert.ok(
      twoSignals.confidence >= oneSignal.confidence,
      `two-signal confidence ${twoSignals.confidence} should be >= one-signal ${oneSignal.confidence}`,
    );
  });

});

// ─── F9-F13: buildReviewFlags ─────────────────────────────────────────────────

describe('v1.16K-H — buildReviewFlags', () => {

  it('F9 — no taxIdentifier → no_tax_id flag added', () => {
    const input: ReviewFlagsInput = {
      taxIdentifier: null,
      companySize: '51-200',
    };
    const flags = buildReviewFlags(input);
    assert.ok(flags.includes('no_tax_id'), 'should have no_tax_id');
    assert.ok(!flags.includes('size_unknown'), 'should not have size_unknown');
  });

  it('F10 — no companySize → size_unknown flag added', () => {
    const input: ReviewFlagsInput = {
      taxIdentifier: '900123456-7',
      companySize: null,
    };
    const flags = buildReviewFlags(input);
    assert.ok(flags.includes('size_unknown'), 'should have size_unknown');
    assert.ok(!flags.includes('no_tax_id'), 'should not have no_tax_id');
  });

  it('F11 — sourceEnrichmentStatus no_match → source_enrichment_no_match flag', () => {
    const input: ReviewFlagsInput = {
      taxIdentifier: '900123456-7',
      companySize: '51-200',
      sourceEnrichmentStatus: 'no_match',
    };
    const flags = buildReviewFlags(input);
    assert.ok(flags.includes('source_enrichment_no_match'));
  });

  it('F12 — contentGateResult with not_a_direct_vendor → possible_intermediary flag', () => {
    const contentResult = evaluateContentIntermediaryGate({
      name: 'SomeCompany',
      domain: 'somecompany.co',
      snippet: 'conectamos con partners certificados',
    });
    const flags = buildReviewFlags({
      taxIdentifier: '900123456-7',
      companySize: '51-200',
      contentGateResult: contentResult,
    });
    assert.ok(flags.includes('possible_intermediary'), 'should flag possible_intermediary');
  });

  it('F13 — existing flags are preserved and merged with new ones', () => {
    const input: ReviewFlagsInput = {
      taxIdentifier: null,
      companySize: '51-200',
      existingFlags: ['enrichment_partial'],
    };
    const flags = buildReviewFlags(input);
    assert.ok(flags.includes('no_tax_id'), 'should include newly computed flag');
    assert.ok(flags.includes('enrichment_partial'), 'should preserve existing flag');
  });

});

// ─── F14-F15: buildPreReviewEnrichmentMetadata ───────────────────────────────

describe('v1.16K-H — buildPreReviewEnrichmentMetadata', () => {

  it('F14 — sources with attempted status → status "attempted", produced flags set', () => {
    const sources: SourceEnrichmentAttempt[] = [
      { source: 'co_rues', status: 'attempted' },
      { source: 'co_siis', status: 'no_match', reason: 'nit_not_found' },
    ];
    const meta = buildPreReviewEnrichmentMetadata(sources, {
      producedTaxId: true,
      producedSize: false,
      producedLinkedin: false,
    });
    assert.equal(meta.status, 'attempted');
    assert.equal(meta.produced_tax_id, true);
    assert.equal(meta.produced_size, false);
    assert.equal(meta.produced_linkedin, false);
    assert.equal(meta.sources.length, 2);
  });

  it('F15 — empty sources array → status "no_sources"', () => {
    const meta = buildPreReviewEnrichmentMetadata([], {
      producedTaxId: false,
      producedSize: false,
      producedLinkedin: false,
    });
    assert.equal(meta.status, 'no_sources');
    assert.equal(meta.sources.length, 0);
  });

});
