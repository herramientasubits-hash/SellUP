/**
 * Tests — classifyLushaRunOutcome (Hito 17B.4X.7C.3D)
 *
 * Pure unit tests. No network, no DOM.
 *
 * Cases:
 *   A — success with candidates (ok=true, status='success')
 *   B — success but 0 candidates after filtering (ok=false, status='no_reviewable_candidate')
 *   C — true unavailable/no-credentials (status='missing_api_key' | 'disabled')
 *   D — true provider error / other real failures
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLushaRunOutcome } from '../lusha-run-outcome-classifier';

describe('classifyLushaRunOutcome', () => {
  describe('Case A — success with candidates', () => {
    it('providerStatus=success, success=true, no error', () => {
      const result = classifyLushaRunOutcome({
        ok: true,
        status: 'success',
        message: 'Lusha company run: 1 candidate(s) created, 0 duplicate(s) skipped.',
      });
      assert.equal(result.success, true);
      assert.equal(result.providerStatus, 'success');
      assert.equal(result.error, undefined);
    });
  });

  describe('Case B — success but 0 candidates after filtering (the reported bug)', () => {
    it('providerStatus=success (NOT skipped/error) even though runner reports ok=false', () => {
      const result = classifyLushaRunOutcome({
        ok: false,
        status: 'no_reviewable_candidate',
        message: 'Lusha prospecting: 0 candidate(s) created, 4 filtered/skipped.',
      });
      assert.equal(result.providerStatus, 'success');
    });

    it('success=true — this must never be reported as a failure', () => {
      const result = classifyLushaRunOutcome({
        ok: false,
        status: 'no_reviewable_candidate',
        message: 'Lusha prospecting: 0 candidate(s) created, 4 filtered/skipped.',
      });
      assert.equal(result.success, true);
    });

    it('error is undefined — never surfaces the runner message as an error reason', () => {
      const result = classifyLushaRunOutcome({
        ok: false,
        status: 'no_reviewable_candidate',
        message: 'Lusha prospecting: 0 candidate(s) created, 4 filtered/skipped.',
      });
      assert.equal(result.error, undefined);
    });
  });

  describe('Case C — true unavailable / no credentials', () => {
    it('missing_api_key → providerStatus=skipped, success=false, error present', () => {
      const result = classifyLushaRunOutcome({
        ok: false,
        status: 'missing_api_key',
        message: 'Lusha API key not configured (sellup_prospecting_lusha_api_key not found in Vault).',
      });
      assert.equal(result.success, false);
      assert.equal(result.providerStatus, 'skipped');
      assert.equal(result.error, 'Lusha API key not configured (sellup_prospecting_lusha_api_key not found in Vault).');
    });

    it('disabled → providerStatus=skipped, success=false', () => {
      const result = classifyLushaRunOutcome({
        ok: false,
        status: 'disabled',
        message: 'Lusha no está habilitado en este entorno.',
      });
      assert.equal(result.success, false);
      assert.equal(result.providerStatus, 'skipped');
    });
  });

  describe('Case D — true provider error / other real failures', () => {
    it('provider_error → providerStatus=error, success=false, error present', () => {
      const result = classifyLushaRunOutcome({
        ok: false,
        status: 'provider_error',
        message: 'Lusha enrich failed: HTTP 503',
      });
      assert.equal(result.success, false);
      assert.equal(result.providerStatus, 'error');
      assert.equal(result.error, 'Lusha enrich failed: HTTP 503');
    });

    it('invalid_account → providerStatus=error (never mislabeled as skipped/missing credentials)', () => {
      const result = classifyLushaRunOutcome({
        ok: false,
        status: 'invalid_account',
        message: 'Account acc-1 is archived. Cannot enrich for archived accounts.',
      });
      assert.equal(result.providerStatus, 'error');
    });

    it('not_found → providerStatus=error', () => {
      const result = classifyLushaRunOutcome({
        ok: false,
        status: 'not_found',
        message: 'Run not found: unknown',
      });
      assert.equal(result.providerStatus, 'error');
    });
  });
});
