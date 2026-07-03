/**
 * Tests — Bulk Enrichment Eligibility (Agente 2A, Hito 17A.10B)
 *
 * Verifica la función pura evaluateBulkContactEnrichmentEligibility.
 * Sin DB, sin Apollo, sin Supabase real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateBulkContactEnrichmentEligibility,
  type BulkEligibilityInput,
  type BulkEligibilityAccountInput,
} from '../bulk-enrichment-eligibility';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeAccount(
  overrides: Partial<BulkEligibilityAccountInput> & { id: string },
): BulkEligibilityAccountInput {
  return {
    name: 'Acme Corp',
    domain: 'acme.com',
    country_code: 'CO',
    ...overrides,
  };
}

function makeInput(
  accounts: BulkEligibilityAccountInput[],
  runs: Record<string, Array<{ status: string }>> = {},
  pendingCandidateIds: string[] = [],
): BulkEligibilityInput {
  return {
    accounts,
    activeRunsByAccountId: new Map(Object.entries(runs)),
    pendingCandidateAccountIds: new Set(pendingCandidateIds),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('evaluateBulkContactEnrichmentEligibility', () => {
  it('cuenta válida queda eligible', () => {
    const account = makeAccount({ id: 'acc-1' });
    const result = evaluateBulkContactEnrichmentEligibility(makeInput([account]));

    assert.equal(result.eligible.length, 1);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.eligible[0].accountId, 'acc-1');
    assert.equal(result.eligible[0].name, 'Acme Corp');
    assert.equal(result.eligible[0].countryCode, 'CO');
  });

  it('cuenta sin country_code se omite con missing_country_code', () => {
    const account = makeAccount({ id: 'acc-1', country_code: null });
    const result = evaluateBulkContactEnrichmentEligibility(makeInput([account]));

    assert.equal(result.eligible.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'missing_country_code');
  });

  it('cuenta sin nombre se omite con insufficient_company_data', () => {
    const account = makeAccount({ id: 'acc-1', name: null });
    const result = evaluateBulkContactEnrichmentEligibility(makeInput([account]));

    assert.equal(result.skipped[0].reason, 'insufficient_company_data');
  });

  it('cuenta con nombre muy corto se omite con insufficient_company_data', () => {
    const account = makeAccount({ id: 'acc-1', name: 'A' });
    const result = evaluateBulkContactEnrichmentEligibility(makeInput([account]));

    assert.equal(result.skipped[0].reason, 'insufficient_company_data');
  });

  it('cuenta con run enriching se omite con enrichment_in_progress', () => {
    const account = makeAccount({ id: 'acc-1' });
    const result = evaluateBulkContactEnrichmentEligibility(
      makeInput([account], { 'acc-1': [{ status: 'enriching' }] }),
    );

    assert.equal(result.skipped[0].reason, 'enrichment_in_progress');
  });

  it('cuenta con run ready_to_enrich se omite como enrichment_in_progress', () => {
    const account = makeAccount({ id: 'acc-1' });
    const result = evaluateBulkContactEnrichmentEligibility(
      makeInput([account], { 'acc-1': [{ status: 'ready_to_enrich' }] }),
    );

    assert.equal(result.skipped[0].reason, 'enrichment_in_progress');
  });

  it('cuenta con run pending se omite como enrichment_in_progress', () => {
    const account = makeAccount({ id: 'acc-1' });
    const result = evaluateBulkContactEnrichmentEligibility(
      makeInput([account], { 'acc-1': [{ status: 'pending' }] }),
    );

    assert.equal(result.skipped[0].reason, 'enrichment_in_progress');
  });

  it('cuenta con run ready_for_review se omite con already_ready_for_review', () => {
    const account = makeAccount({ id: 'acc-1' });
    const result = evaluateBulkContactEnrichmentEligibility(
      makeInput([account], { 'acc-1': [{ status: 'ready_for_review' }] }),
    );

    assert.equal(result.skipped[0].reason, 'already_ready_for_review');
  });

  it('cuenta con candidato pending_review se omite con pending_candidates_exist', () => {
    const account = makeAccount({ id: 'acc-1' });
    const result = evaluateBulkContactEnrichmentEligibility(
      makeInput([account], {}, ['acc-1']),
    );

    assert.equal(result.skipped[0].reason, 'pending_candidates_exist');
  });

  it('varias cuentas mixtas devuelven conteos correctos', () => {
    const accounts = [
      makeAccount({ id: 'acc-valid' }),
      makeAccount({ id: 'acc-no-country', country_code: null }),
      makeAccount({ id: 'acc-in-progress' }),
      makeAccount({ id: 'acc-ready-review' }),
      makeAccount({ id: 'acc-pending-candidates' }),
    ];

    const result = evaluateBulkContactEnrichmentEligibility(
      makeInput(
        accounts,
        {
          'acc-in-progress': [{ status: 'enriching' }],
          'acc-ready-review': [{ status: 'ready_for_review' }],
        },
        ['acc-pending-candidates'],
      ),
    );

    assert.equal(result.selectedCount, 5);
    assert.equal(result.eligible.length, 1);
    assert.equal(result.skipped.length, 4);
    assert.equal(result.eligible[0].accountId, 'acc-valid');
  });

  it('estimatedApolloCredits equivale al número de cuentas elegibles', () => {
    const accounts = [
      makeAccount({ id: 'acc-1' }),
      makeAccount({ id: 'acc-2' }),
      makeAccount({ id: 'acc-3', country_code: null }),
    ];

    const result = evaluateBulkContactEnrichmentEligibility(makeInput(accounts));

    assert.equal(result.eligible.length, 2);
    assert.equal(result.estimatedApolloCredits, 2);
  });

  it('missing_country_code tiene prioridad sobre otros checks', () => {
    // Cuenta sin country_code y también con run en curso → debe reportar missing_country_code
    const account = makeAccount({ id: 'acc-1', country_code: null });
    const result = evaluateBulkContactEnrichmentEligibility(
      makeInput([account], { 'acc-1': [{ status: 'running' }] }),
    );

    assert.equal(result.skipped[0].reason, 'missing_country_code');
  });

  it('selectedCount refleja el total de cuentas recibidas', () => {
    const accounts = [
      makeAccount({ id: 'acc-1' }),
      makeAccount({ id: 'acc-2' }),
    ];

    const result = evaluateBulkContactEnrichmentEligibility(makeInput(accounts));

    assert.equal(result.selectedCount, 2);
  });

  // ── account_archived ──────────────────────────────────────────────────────

  it('cuenta archivada se omite con account_archived', () => {
    const account = makeAccount({ id: 'acc-1', archived_at: '2026-07-01T15:57:18Z' });
    const result = evaluateBulkContactEnrichmentEligibility(makeInput([account]));

    assert.equal(result.eligible.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].reason, 'account_archived');
  });

  it('account_archived tiene prioridad sobre missing_country_code', () => {
    const account = makeAccount({ id: 'acc-1', archived_at: '2026-07-01T00:00:00Z', country_code: null });
    const result = evaluateBulkContactEnrichmentEligibility(makeInput([account]));

    assert.equal(result.skipped[0].reason, 'account_archived');
  });

  it('account_archived tiene prioridad sobre already_ready_for_review', () => {
    const account = makeAccount({ id: 'acc-1', archived_at: '2026-07-01T00:00:00Z' });
    const result = evaluateBulkContactEnrichmentEligibility(
      makeInput([account], { 'acc-1': [{ status: 'ready_for_review' }] }),
    );

    assert.equal(result.skipped[0].reason, 'account_archived');
  });

  it('cuenta activa con archived_at null y datos válidos sigue siendo eligible', () => {
    const account = makeAccount({ id: 'acc-1', archived_at: null });
    const result = evaluateBulkContactEnrichmentEligibility(makeInput([account]));

    assert.equal(result.eligible.length, 1);
    assert.equal(result.skipped.length, 0);
  });
});
