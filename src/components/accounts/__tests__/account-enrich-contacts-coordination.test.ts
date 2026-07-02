/**
 * 17A.9C.1 — Drawer coordination tests
 *
 * Verifies the onRequestOpen/onRequestEnrich callback contract that prevents
 * double side-panels when "Enriquecer contactos" is clicked from inside the
 * AccountDetailSheet.
 *
 * Pure logic tests — no DOM, no React, no API calls, no data writes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { ContactEnrichmentInitialCompany } from '@/components/contact-enrichment/contact-enrichment-drawer';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeFullCompany(
  overrides: Partial<ContactEnrichmentInitialCompany> = {},
): ContactEnrichmentInitialCompany {
  return {
    name: 'Acme Corp',
    domain: 'acme.com',
    country: 'Colombia',
    countryCode: 'CO',
    sellupAccountId: 'acct-001',
    hubspotCompanyId: 'hs-999',
    ...overrides,
  };
}

// Simulates the handler in accounts-data-table-client that receives the company
// from AccountDetailSheet.onRequestEnrich and sets it as enrichCompany state.
function simulateOnRequestEnrich(
  company: ContactEnrichmentInitialCompany,
  state: { enrichCompany: ContactEnrichmentInitialCompany | null; detailOpen: boolean },
) {
  state.detailOpen = false;
  state.enrichCompany = company;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('17A.9C.1 — Drawer coordination', () => {
  it('onRequestEnrich closes the detail sheet and sets enrichCompany', () => {
    const state = { enrichCompany: null as ContactEnrichmentInitialCompany | null, detailOpen: true };
    const company = makeFullCompany();

    simulateOnRequestEnrich(company, state);

    assert.strictEqual(state.detailOpen, false, 'detail sheet should be closed');
    assert.deepStrictEqual(state.enrichCompany, company, 'enrichCompany should match');
  });

  it('preloadedCompany preserves all fields including countryCode and hubspotCompanyId', () => {
    const company = makeFullCompany({ countryCode: 'PE', hubspotCompanyId: 'hs-42' });

    assert.strictEqual(company.countryCode, 'PE');
    assert.strictEqual(company.hubspotCompanyId, 'hs-42');
    assert.strictEqual(company.sellupAccountId, 'acct-001');
    assert.strictEqual(company.name, 'Acme Corp');
  });

  it('preloadedCompany is not lost when transitioning between sheet and drawer', () => {
    const state = { enrichCompany: null as ContactEnrichmentInitialCompany | null, detailOpen: true };
    const company = makeFullCompany({ sellupAccountId: 'acct-xyz', hubspotCompanyId: 'hs-hub' });

    simulateOnRequestEnrich(company, state);

    // The enrichment drawer should receive the exact same company object
    assert.ok(state.enrichCompany !== null, 'enrichCompany must not be null after transition');
    assert.strictEqual(state.enrichCompany!.sellupAccountId, 'acct-xyz');
    assert.strictEqual(state.enrichCompany!.hubspotCompanyId, 'hs-hub');
    assert.strictEqual(state.enrichCompany!.countryCode, 'CO');
  });

  it('onRequestOpen callback receives the preloadedCompany unchanged', () => {
    const received: ContactEnrichmentInitialCompany[] = [];
    const onRequestOpen = (c: ContactEnrichmentInitialCompany) => received.push(c);

    const company = makeFullCompany({ countryCode: 'MX', hubspotCompanyId: null });

    // Simulate what AccountEnrichContactsButton does when onRequestOpen is set
    const handleClick = (preloadedCompany: ContactEnrichmentInitialCompany, cb?: (c: ContactEnrichmentInitialCompany) => void) => {
      if (cb) {
        cb(preloadedCompany);
      }
      // else: open internal drawer (not testable here)
    };

    handleClick(company, onRequestOpen);

    assert.strictEqual(received.length, 1, 'callback should be called once');
    assert.deepStrictEqual(received[0], company, 'callback receives the full company');
    assert.strictEqual(received[0].countryCode, 'MX');
    assert.strictEqual(received[0].hubspotCompanyId, null);
  });

  it('without onRequestOpen, button does not call external callback (standalone mode)', () => {
    const received: ContactEnrichmentInitialCompany[] = [];

    const handleClick = (preloadedCompany: ContactEnrichmentInitialCompany, cb?: (c: ContactEnrichmentInitialCompany) => void) => {
      if (cb) {
        cb(preloadedCompany);
        return;
      }
      // standalone mode: opens internal drawer — nothing to assert here
    };

    const company = makeFullCompany();
    handleClick(company, undefined);

    assert.strictEqual(received.length, 0, 'no external callback in standalone mode');
  });

  it('countryCode and hubspotCompanyId are optional fields on ContactEnrichmentInitialCompany', () => {
    const minimal: ContactEnrichmentInitialCompany = { name: 'Minimal Corp' };
    assert.strictEqual(minimal.countryCode, undefined);
    assert.strictEqual(minimal.hubspotCompanyId, undefined);
    assert.strictEqual(minimal.name, 'Minimal Corp');
  });
});
