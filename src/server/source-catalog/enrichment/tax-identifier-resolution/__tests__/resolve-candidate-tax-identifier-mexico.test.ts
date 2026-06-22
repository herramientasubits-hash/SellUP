import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateTaxIdentifierForMexico } from '../resolve-candidate-tax-identifier-mexico';
import type { ResolveTaxIdentifierInput } from '../types';

function makeInput(overrides: Partial<ResolveTaxIdentifierInput> = {}): ResolveTaxIdentifierInput {
  return {
    name: 'Empresa Mexicana SA de CV',
    countryCode: 'MX',
    domain: null,
    website: null,
    sector: null,
    existingMetadata: {},
    ...overrides,
  };
}

describe('resolveCandidateTaxIdentifierForMexico', () => {
  it('returns not_resolvable_automatically for MX country code', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.equal(result.status, 'not_resolvable_automatically');
  });

  it('never returns resolved status', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.notEqual(result.status, 'resolved');
  });

  it('never writes taxIdentifier', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.equal(result.taxIdentifier, undefined);
  });

  it('includes human_review_required = true in metadata', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.equal(result.metadata?.human_review_required, true);
  });

  it('includes contextual_sources_available with mx_denue', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.deepEqual(result.metadata?.contextual_sources_available, ['mx_denue']);
  });

  it('includes reason in metadata', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.ok(result.metadata?.reason);
    assert.ok(result.metadata?.reason!.includes('Mexico RFC'));
  });

  it('includes recommended_next_step in metadata', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.ok(result.metadata?.recommended_next_step);
    assert.ok(result.metadata?.recommended_next_step!.includes('Human reviewer'));
  });

  it('has sourceKey mx_rfc_manual_review', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.equal(result.sourceKey, 'mx_rfc_manual_review');
  });

  it('has confidence 0', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.equal(result.confidence, 0);
  });

  it('returns skipped for non-MX country code', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput({ countryCode: 'CO' }));
    assert.equal(result.status, 'skipped');
  });

  it('returns skipped for MX not using Colombia logic', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico(makeInput());
    assert.equal(result.status, 'not_resolvable_automatically');
    assert.equal(result.sourceKey, 'mx_rfc_manual_review');
    assert.notEqual(result.sourceKey, 'co_siis');
  });

  it('works with minimal input (name only)', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico({
      name: 'Test',
      countryCode: 'MX',
    });
    assert.equal(result.status, 'not_resolvable_automatically');
  });

  it('does not use Tavily, LLM, or external API', async () => {
    const originalFetch = global.fetch;
    let fetchCalled = false;
    global.fetch = (() => {
      fetchCalled = true;
      return Promise.resolve(new Response());
    }) as typeof global.fetch;

    try {
      await resolveCandidateTaxIdentifierForMexico(makeInput());
      assert.equal(fetchCalled, false);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
