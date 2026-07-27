/**
 * Q3F-5BB.10C3-FIX-1 (P1-3) — resolveProspectWizardRoute dry-route matrix.
 *
 * Pure resolver: no I/O, no env, no network. Proves the routing invariant that
 * the 10C3 incident violated: a Lusha-eligible intent can only be honored
 * (`lusha`) or blocked (`blocked_lusha_disabled`) — it can NEVER be re-routed to
 * the Apollo-capable Agent 1 generation action. Every Lusha-intent row must have
 * `wouldUseApollo: false`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import type { WizardLushaCriteriaState } from '@/modules/prospect-batches/wizard-lusha-criteria';
import { resolveProspectWizardRoute } from '@/modules/prospect-batches/prospect-wizard-route';

const CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'ind-health', name: 'Salud', slug: 'salud', description: null, sortOrder: 1 },
    { id: 'ind-mining', name: 'Minería', slug: 'mineria', description: null, sortOrder: 2 },
  ],
  subindustries: [
    {
      id: 'sub-hosp',
      industryId: 'ind-health',
      name: 'Hospitales',
      slug: 'hospitales',
      description: null,
      applicableCountries: null,
      sortOrder: 1,
    },
  ],
};

/** Lusha-eligible: CO + Salud maps to a Lusha sector. */
const ELIGIBLE: WizardLushaCriteriaState = {
  countryCode: 'CO',
  industryId: 'ind-health',
  subindustryIds: [],
  additionalCriteriaRaw: null,
};

/** Not Lusha-eligible: Minería does not map to a Lusha sector. */
const NOT_ELIGIBLE: WizardLushaCriteriaState = {
  countryCode: 'CO',
  industryId: 'ind-mining',
  subindustryIds: [],
  additionalCriteriaRaw: null,
};

function route(
  criteria: WizardLushaCriteriaState,
  lushaPreviewEnabled: boolean,
  executionEnabled: boolean,
) {
  return resolveProspectWizardRoute({ criteria, catalog: CATALOG, lushaPreviewEnabled, executionEnabled });
}

describe('resolveProspectWizardRoute — dry-route matrix', () => {
  it('eligible + flag on → lusha, Lusha pending-review action, no Apollo', () => {
    const r = route(ELIGIBLE, true, false);
    assert.equal(r.intendedProvider, 'lusha');
    assert.equal(r.effectiveProvider, 'lusha');
    assert.equal(r.blockedReason, null);
    assert.equal(r.wouldCallAction, 'generateLushaPendingReviewBatchAction');
    assert.equal(r.wouldUseApollo, false);
  });

  it('eligible + flag off → blocked, no action, no Apollo (STRICT-ALL)', () => {
    // Even with execution enabled, the blocked row must call nothing.
    const r = route(ELIGIBLE, false, true);
    assert.equal(r.intendedProvider, 'lusha');
    assert.equal(r.effectiveProvider, 'blocked_lusha_disabled');
    assert.equal(r.blockedReason, 'lusha_preview_disabled');
    assert.equal(r.wouldCallAction, null);
    assert.equal(r.wouldUseApollo, false);
  });

  it('not eligible + execution on → default_ai, Agent 1 action, Apollo-capable', () => {
    const r = route(NOT_ELIGIBLE, false, true);
    assert.equal(r.intendedProvider, 'default_ai');
    assert.equal(r.effectiveProvider, 'default_ai');
    assert.equal(r.blockedReason, null);
    assert.equal(r.wouldCallAction, 'executeProspectWizardGenerationAction');
    assert.equal(r.wouldUseApollo, true);
  });

  it('not eligible + execution off → default_ai, no runnable action, no Apollo', () => {
    const r = route(NOT_ELIGIBLE, false, false);
    assert.equal(r.intendedProvider, 'default_ai');
    assert.equal(r.effectiveProvider, 'default_ai');
    assert.equal(r.wouldCallAction, null);
    assert.equal(r.wouldUseApollo, false);
  });

  it('INVARIANT: every Lusha-intent row has wouldUseApollo === false', () => {
    // Sweep the full flag x execution grid for the eligible criteria.
    for (const lushaPreviewEnabled of [true, false]) {
      for (const executionEnabled of [true, false]) {
        const r = route(ELIGIBLE, lushaPreviewEnabled, executionEnabled);
        assert.equal(r.intendedProvider, 'lusha');
        assert.equal(
          r.wouldUseApollo,
          false,
          `Lusha intent reached Apollo (flag=${lushaPreviewEnabled}, exec=${executionEnabled})`,
        );
        assert.notEqual(r.effectiveProvider, 'default_ai');
        assert.notEqual(r.wouldCallAction, 'executeProspectWizardGenerationAction');
      }
    }
  });
});
