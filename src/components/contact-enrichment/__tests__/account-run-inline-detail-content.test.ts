/**
 * Tests — resolveAccountRunInlineDetailContent (Hito 17B.4X.7C.3E.4)
 *
 * Pure unit tests. No network, no DOM. Reuses classifyLushaRunViewerBranch
 * (already covered by run-viewer-branch-classifier.test.ts) so these cases
 * focus on: (1) the copy/shape the inline expansion renders, and (2) that
 * the returned content never carries a field the card summary already
 * shows (provider, status, attempt, date, costs, credits, candidate count).
 *
 * Cases:
 *   A — SITECO reproduction (Lusha success, 0 candidates) → empty_after_filtering
 *       content with the exact required headline/detail and raw/phone fields
 *   B — Lusha credentials missing → static branch copy
 *   C — Lusha company context error → static branch copy
 *   D — Lusha provider error → uses latest usage row's errorMessage
 *   E — Lusha has candidates → static branch copy
 *   F — Lusha not yet executed → static branch copy
 *   G — Apollo / non-Lusha run, not failed → no_detail_available fallback
 *   H — Apollo / non-Lusha run, failed, with summaryError → generic_failed with reason
 *   I — Apollo / non-Lusha run, failed, no summaryError → generic_failed, safe default
 *   J — structural guard: no returned content object ever carries a
 *       provider/status/attempt/date/cost/credits/candidate-count key
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccountRunInlineDetailContent } from '../account-run-inline-detail-content';
import type { ContactEnrichmentRunProviderUsage } from '@/modules/contact-enrichment/run-viewer-types';

function usageRow(overrides: Partial<ContactEnrichmentRunProviderUsage> = {}): ContactEnrichmentRunProviderUsage {
  return {
    providerKey: 'lusha',
    operationKey: 'lusha_contact_prospecting',
    status: 'success',
    creditsUsed: 1,
    resultsReturned: 0,
    rawResultsCount: 4,
    phoneRevealEnabled: false,
    errorMessage: null,
    createdAt: '2026-07-10T12:03:00.000Z',
    ...overrides,
  };
}

const FORBIDDEN_KEYS = [
  'provider',
  'providersUsed',
  'intendedProvider',
  'status',
  'attemptOrder',
  'createdAt',
  'estimatedCostUsd',
  'realCostUsd',
  'totalCreditsUsed',
  'creditsUsed',
  'candidateCount',
];

describe('A — SITECO reproduction (Lusha success, 0 candidates)', () => {
  it('resolves empty_after_filtering with the exact required copy', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'lusha', status: 'ready_for_review', summaryError: null },
      lushaUsageRows: [usageRow({ rawResultsCount: 4, phoneRevealEnabled: false })],
      candidatesCount: 0,
    });

    assert.equal(content.kind, 'lusha_empty_after_filtering');
    assert.equal(content.headline, 'Lusha no encontró contactos relevantes');
    assert.equal(
      content.detail,
      'Lusha ejecutó la búsqueda correctamente, pero los perfiles encontrados no pasaron los filtros de relevancia o consistencia con la empresa.',
    );
    assert.equal(content.rawResultsCount, 4);
    assert.equal(content.phoneRevealEnabled, false);
  });
});

describe('B — Lusha credentials missing', () => {
  it('resolves the static credentials-missing copy', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'lusha', status: 'failed', summaryError: 'missing_api_key' },
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(content.kind, 'lusha_credentials_missing');
    assert.equal(content.headline, 'Lusha no está disponible o no tiene credenciales configuradas');
  });
});

describe('C — Lusha company context error', () => {
  it('resolves the static company-context-error copy', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'lusha', status: 'failed', summaryError: 'invalid_account' },
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(content.kind, 'lusha_company_context_error');
  });
});

describe('D — Lusha provider error', () => {
  it('uses the latest usage row error message when present', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'lusha', status: 'failed', summaryError: null },
      lushaUsageRows: [usageRow({ status: 'error', errorMessage: 'Lusha search failed: 503' })],
      candidatesCount: 0,
    });
    assert.equal(content.kind, 'lusha_provider_error');
    assert.equal(content.detail, 'Lusha search failed: 503');
  });

  it('falls back to a generic error message when none is recorded', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'lusha', status: 'failed', summaryError: null },
      lushaUsageRows: [usageRow({ status: 'error', errorMessage: null })],
      candidatesCount: 0,
    });
    assert.match(content.detail, /No fue posible completar la búsqueda con Lusha/);
  });
});

describe('E — Lusha has candidates', () => {
  it('resolves the static has-candidates copy', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'lusha', status: 'ready_for_review', summaryError: null },
      lushaUsageRows: [usageRow({ status: 'success' })],
      candidatesCount: 2,
    });
    assert.equal(content.kind, 'lusha_has_candidates');
  });
});

describe('F — Lusha not yet executed', () => {
  it('resolves the static not-yet-executed copy', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'lusha', status: 'ready_to_enrich', summaryError: null },
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(content.kind, 'lusha_not_yet_executed');
  });
});

describe('G — Apollo / non-Lusha run, not failed', () => {
  it('falls back to no_detail_available', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'apollo', status: 'completed', summaryError: null },
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(content.kind, 'no_detail_available');
    assert.equal(content.detail, 'No hay detalle adicional disponible para este run.');
  });

  it('legacy run with no intendedProvider also falls back to no_detail_available', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: null, status: 'superseded', summaryError: null },
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(content.kind, 'no_detail_available');
  });
});

describe('H/I — Apollo / non-Lusha run, failed', () => {
  it('includes the recorded summaryError as the reason', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'apollo', status: 'failed', summaryError: 'rate_limited' },
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(content.kind, 'generic_failed');
    assert.match(content.detail, /rate_limited/);
  });

  it('uses a safe default when no summaryError is recorded', () => {
    const content = resolveAccountRunInlineDetailContent({
      run: { intendedProvider: 'apollo', status: 'failed', summaryError: null },
      lushaUsageRows: [],
      candidatesCount: 0,
    });
    assert.equal(content.kind, 'generic_failed');
    assert.equal(content.detail, 'No hay un motivo adicional registrado para este run.');
  });
});

describe('J — structural guard: never repeats a card-summary field', () => {
  const cases: Array<Parameters<typeof resolveAccountRunInlineDetailContent>[0]> = [
    {
      run: { intendedProvider: 'lusha', status: 'ready_for_review', summaryError: null },
      lushaUsageRows: [usageRow()],
      candidatesCount: 0,
    },
    {
      run: { intendedProvider: 'lusha', status: 'failed', summaryError: 'missing_api_key' },
      lushaUsageRows: [],
      candidatesCount: 0,
    },
    {
      run: { intendedProvider: 'apollo', status: 'completed', summaryError: null },
      lushaUsageRows: [],
      candidatesCount: 0,
    },
    {
      run: { intendedProvider: 'apollo', status: 'failed', summaryError: 'x' },
      lushaUsageRows: [],
      candidatesCount: 0,
    },
  ];

  for (const [index, input] of cases.entries()) {
    it(`case ${index} — returned keys exclude every forbidden card-summary field`, () => {
      const content = resolveAccountRunInlineDetailContent(input);
      const keys = Object.keys(content);
      for (const forbidden of FORBIDDEN_KEYS) {
        assert.ok(!keys.includes(forbidden), `unexpected key "${forbidden}" in inline detail content`);
      }
    });
  }
});
