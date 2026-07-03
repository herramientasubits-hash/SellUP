// Tests for normalizeBulkExecutionSummary — 17A.10H
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBulkExecutionSummary } from '../bulk-contact-enrichment-drawer';

describe('normalizeBulkExecutionSummary', () => {
  it('reads counters from camelCase top-level fields', () => {
    const result = normalizeBulkExecutionSummary({
      status: 'completed',
      totalProcessed: 4,
      totalSucceeded: 1,
      totalFailed: 0,
      totalCandidatesCreated: 3,
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.summary.processed, 4);
    assert.equal(result.summary.with_candidates, 1);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.candidates_created, 3);
  });

  it('reads counters from snake_case summary field', () => {
    const result = normalizeBulkExecutionSummary({
      status: 'completed',
      summary: {
        total_processed: 2,
        accounts_with_candidates: 1,
        accounts_without_candidates: 1,
        accounts_failed: 0,
        total_candidates_created: 5,
      },
    });
    assert.equal(result.summary.processed, 2);
    assert.equal(result.summary.with_candidates, 1);
    assert.equal(result.summary.without_candidates, 1);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.candidates_created, 5);
  });

  it('handles status completed', () => {
    assert.equal(normalizeBulkExecutionSummary({ status: 'completed' }).status, 'completed');
  });

  it('handles status completed_with_errors', () => {
    assert.equal(
      normalizeBulkExecutionSummary({ status: 'completed_with_errors' }).status,
      'completed_with_errors',
    );
  });

  it('handles status failed', () => {
    assert.equal(normalizeBulkExecutionSummary({ status: 'failed' }).status, 'failed');
  });

  it('defaults all counters to 0 when fields are missing', () => {
    const { summary } = normalizeBulkExecutionSummary({});
    assert.equal(summary.processed, 0);
    assert.equal(summary.with_candidates, 0);
    assert.equal(summary.without_candidates, 0);
    assert.equal(summary.failed, 0);
    assert.equal(summary.candidates_created, 0);
  });

  it('defaults status to completed when missing', () => {
    assert.equal(normalizeBulkExecutionSummary({}).status, 'completed');
  });

  it('does not interpret completed as error', () => {
    const result = normalizeBulkExecutionSummary({ status: 'completed', totalFailed: 0 });
    assert.equal(result.status, 'completed');
    assert.equal(result.summary.failed, 0);
  });

  it('does not lose totalCandidatesCreated', () => {
    const result = normalizeBulkExecutionSummary({ status: 'completed', totalCandidatesCreated: 7 });
    assert.equal(result.summary.candidates_created, 7);
  });

  it('handles null body safely', () => {
    assert.equal(normalizeBulkExecutionSummary(null).summary.processed, 0);
  });

  it('handles undefined body safely', () => {
    assert.equal(normalizeBulkExecutionSummary(undefined).summary.processed, 0);
  });

  it('prefers camelCase top-level over snake_case summary when both present', () => {
    const result = normalizeBulkExecutionSummary({
      totalProcessed: 5,
      summary: { total_processed: 99 },
    });
    assert.equal(result.summary.processed, 5);
  });
});
