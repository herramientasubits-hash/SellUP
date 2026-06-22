import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCandidateTaxIdentifierForMexico } from '../resolve-candidate-tax-identifier-mexico';
import type { TaxIdentifierResolutionBatchMetadata } from '../types';

describe('orchestrator behavior for Mexico', () => {
  it('resolveCandidateTaxIdentifierForMexico returns not_resolvable_automatically', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico({
      name: 'Empresa MX SA de CV',
      countryCode: 'MX',
    });
    assert.equal(result.status, 'not_resolvable_automatically');
  });

  it('batch metadata includes not_resolvable_automatically_count', () => {
    const meta: TaxIdentifierResolutionBatchMetadata = {
      attempted: true,
      candidates_processed: 5,
      resolved_count: 0,
      ambiguous_count: 0,
      not_found_count: 0,
      skipped_count: 0,
      not_resolvable_automatically_count: 5,
      human_review_required_count: 5,
      errors: [],
    };
    assert.equal(meta.not_resolvable_automatically_count, 5);
    assert.equal(meta.human_review_required_count, 5);
  });

  it('enrichment does not break when tax_identifier is null for MX', async () => {
    const result = await resolveCandidateTaxIdentifierForMexico({
      name: 'Sin RFC',
      countryCode: 'MX',
    });
    assert.equal(result.status, 'not_resolvable_automatically');
    assert.equal(result.taxIdentifier, undefined);
    assert.equal(result.metadata?.human_review_required, true);
  });

  it('Colombia resolver still returns skipped for MX country code', async () => {
    const { resolveCandidateTaxIdentifierForColombia } = await import('../resolve-candidate-tax-identifier-colombia');
    const result = await resolveCandidateTaxIdentifierForColombia({
      name: 'Empresa MX SA de CV',
      countryCode: 'MX',
    });
    assert.equal(result.status, 'skipped');
  });
});
