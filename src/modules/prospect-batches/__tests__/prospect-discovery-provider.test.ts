/**
 * Q3F-5BB.3D — resolveProspectDiscoveryProvider unit contract.
 *
 * Pure decision layer: no I/O, no env, no network. Verifies Lusha is chosen ONLY
 * when the flag is on AND the criteria are companies-by-criteria AND the sector
 * maps to a Lusha industry AND the country is Lusha-supported. Every other case
 * falls back to 'default_ai' (existing behavior preserved).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveProspectDiscoveryProvider,
  COMPANIES_BY_CRITERIA_SEARCH_TYPES,
} from '@/modules/prospect-batches/prospect-discovery-provider';

const COMPATIBLE = {
  lushaPreviewEnabled: true,
  searchType: 'exploratory',
  sectorKey: 'healthcare',
  countryCode: 'CO',
} as const;

describe('resolveProspectDiscoveryProvider', () => {
  it('selects lusha when the flag is on and every criterion is compatible', () => {
    const decision = resolveProspectDiscoveryProvider(COMPATIBLE);
    assert.equal(decision.provider, 'lusha');
    assert.equal(decision.reason, 'criteria_compatible');
  });

  it('accepts the spec token companies_by_criteria as a valid search type', () => {
    assert.ok(COMPANIES_BY_CRITERIA_SEARCH_TYPES.has('companies_by_criteria'));
    const decision = resolveProspectDiscoveryProvider({
      ...COMPATIBLE,
      searchType: 'companies_by_criteria',
    });
    assert.equal(decision.provider, 'lusha');
  });

  it('falls back to default_ai when the preview flag is off', () => {
    const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, lushaPreviewEnabled: false });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'lusha_preview_disabled');
  });

  it('falls back to default_ai for a non-criteria search type', () => {
    const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, searchType: 'competitors' });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'search_type_not_criteria');
  });

  it('falls back to default_ai when the sector does not map to Lusha', () => {
    const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, sectorKey: 'unknown_sector' });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'sector_not_mapped');
  });

  it('falls back to default_ai for an unsupported country', () => {
    const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, countryCode: 'ZZ' });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'country_not_supported');
  });
});
