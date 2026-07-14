/**
 * Tests — AccountAgentsRunHistory pure display helpers (Hito 17B.4X.7C.3E.3)
 *
 * Pure helper function tests only — no DOM rendering, matches the repo's
 * existing convention for component-adjacent logic tests (see
 * lusha-credential-diagnostic-card-17b4q.test.ts,
 * pa-panamacompra-convenio-coverage-card.test.tsx).
 *
 * Cases:
 *   1-2  resolveAccountRunProviderLabel — providersUsed wins over
 *        intendedProvider; falls back to 'Sin proveedor' when neither is set
 *   3-4  resolveAccountRunStatusBadge — known status; unknown status falls
 *        back to the 'pending' badge rather than rendering nothing
 *   5    buildContactEnrichmentRunDetailHref — matches the read-only viewer
 *        route exactly (single source of truth for the "Ver detalle" link)
 *   6    formatContactEnrichmentRunDateTime — empty string never throws
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCOUNT_RUN_STATUS_BADGE,
  buildContactEnrichmentRunDetailHref,
  formatContactEnrichmentRunDateTime,
  resolveAccountRunProviderLabel,
  resolveAccountRunStatusBadge,
} from '../account-agents-run-history';
import type { AccountContactEnrichmentRun } from '@/modules/contact-enrichment/account-run-history-types';

function baseRun(overrides: Partial<AccountContactEnrichmentRun> = {}): AccountContactEnrichmentRun {
  return {
    id: '5e6fcc30-8449-4816-b46b-63a190704665',
    accountId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    status: 'ready_for_review',
    companyName: 'Siteco Soluciones',
    companyDomain: 'sitecosoluciones.com',
    companyCountryCode: 'CO',
    intendedProvider: 'lusha',
    providersUsed: ['lusha'],
    attemptOrder: 1,
    estimatedCostUsd: 0.008,
    realCostUsd: null,
    agentRunId: '11111111-1111-1111-1111-111111111111',
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: '2026-07-10T12:05:00.000Z',
    candidateCount: 0,
    pendingReviewCount: 0,
    approvedCount: 0,
    totalCreditsUsed: 1,
    providerUsageStatuses: ['success'],
    ...overrides,
  };
}

describe('resolveAccountRunProviderLabel', () => {
  it('prefers providersUsed[0] over intendedProvider', () => {
    const run = baseRun({ providersUsed: ['apollo'], intendedProvider: 'lusha' });
    assert.equal(resolveAccountRunProviderLabel(run), 'Apollo');
  });

  it('falls back to intendedProvider when providersUsed is empty', () => {
    const run = baseRun({ providersUsed: [], intendedProvider: 'lusha' });
    assert.equal(resolveAccountRunProviderLabel(run), 'Lusha');
  });

  it('falls back to "Sin proveedor" when neither is set', () => {
    const run = baseRun({ providersUsed: [], intendedProvider: null });
    assert.equal(resolveAccountRunProviderLabel(run), 'Sin proveedor');
  });
});

describe('resolveAccountRunStatusBadge', () => {
  it('resolves a known status to its label', () => {
    assert.equal(resolveAccountRunStatusBadge('ready_for_review').label, 'Listo para revisión');
  });

  it('falls back to the pending badge for an unrecognized status', () => {
    assert.deepEqual(resolveAccountRunStatusBadge('not_a_real_status'), ACCOUNT_RUN_STATUS_BADGE.pending);
  });

  it('every ContactEnrichmentRunStatus value used by the run viewer has a badge here (no silent blank)', () => {
    const knownStatuses = [
      'pending',
      'resolving',
      'ready_to_enrich',
      'enriching',
      'ready_for_review',
      'completed',
      'failed',
      'superseded',
    ];
    for (const status of knownStatuses) {
      assert.ok(ACCOUNT_RUN_STATUS_BADGE[status], `missing badge for status ${status}`);
    }
  });
});

describe('buildContactEnrichmentRunDetailHref', () => {
  it('matches the read-only viewer route exactly', () => {
    assert.equal(
      buildContactEnrichmentRunDetailHref('5e6fcc30-8449-4816-b46b-63a190704665'),
      '/contact-enrichment/runs/5e6fcc30-8449-4816-b46b-63a190704665',
    );
  });
});

describe('formatContactEnrichmentRunDateTime', () => {
  it('returns an em dash for an empty string instead of throwing', () => {
    assert.equal(formatContactEnrichmentRunDateTime(''), '—');
  });

  it('formats a real ISO timestamp without throwing', () => {
    assert.doesNotThrow(() => formatContactEnrichmentRunDateTime('2026-07-10T12:00:00.000Z'));
  });
});
