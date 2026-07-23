/**
 * Q3F-5BB.3E — Pure bridge: wizard collected criteria → hidden Lusha decision.
 *
 * `resolveWizardLushaCriteria` classifies the conversational wizard's collected
 * criteria and builds the read-only Lusha input. It NEVER runs Lusha. These
 * tests cover the flag gate, the industria→sector mapping, country support, and
 * the forced guardrail defaults (size band, null sub-industry).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';
import { resolveWizardLushaCriteria } from '../wizard-lusha-criteria';

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

describe('resolveWizardLushaCriteria', () => {
  it('returns default_ai (input null) when the preview flag is off', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: 'ind-health', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      false,
    );
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.input, null);
  });

  it('resolves lusha with the mapped sector + forced guardrail defaults when compatible', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: 'ind-health', subindustryIds: ['sub-hosp'], additionalCriteriaRaw: null },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'lusha');
    assert.ok(decision.input);
    assert.equal(decision.input?.countryCode, 'CO');
    assert.equal(decision.input?.sectorKey, 'healthcare');
    // No reliable catalog→Lusha sub-industry mapping — never invented.
    assert.equal(decision.input?.subIndustryId, null);
    assert.equal(decision.input?.sizeBandKey, '201-5000');
    assert.equal(decision.input?.searchText, null);
  });

  it('forwards a non-empty additional criterion as trimmed searchText', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: 'ind-health', subindustryIds: [], additionalCriteriaRaw: '  telemedicina  ' },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'lusha');
    assert.equal(decision.input?.searchText, 'telemedicina');
  });

  it('falls back to default_ai when the industria does not map to a Lusha sector', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: 'ind-mining', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.input, null);
  });

  it('falls back to default_ai for an unsupported country', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'ZZ', industryId: 'ind-health', subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.input, null);
  });

  it('falls back to default_ai when no industria is selected yet', () => {
    const decision = resolveWizardLushaCriteria(
      { countryCode: 'CO', industryId: null, subindustryIds: [], additionalCriteriaRaw: null },
      CATALOG,
      true,
    );
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.input, null);
  });
});
