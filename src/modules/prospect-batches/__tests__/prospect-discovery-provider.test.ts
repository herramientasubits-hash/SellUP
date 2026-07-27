/**
 * Q3F-5BB.3D / 10C3-FIX-1 — resolveProspectDiscoveryProvider unit contract.
 *
 * Pure decision layer: no I/O, no env, no network. Three-state routing:
 *   - Lusha-eligible (companies-by-criteria + mapped sector + supported country)
 *     AND flag on            → 'lusha'
 *   - Lusha-eligible AND flag off → 'blocked_lusha_disabled' (STRICT-ALL fail closed)
 *   - not Lusha-eligible        → 'default_ai' (existing Agent 1 behavior)
 *
 * Invariant: a Lusha-eligible intent NEVER resolves to 'default_ai'. The flag can
 * only toggle an eligible row between 'lusha' and 'blocked_lusha_disabled'.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveProspectDiscoveryProvider,
  isProspectLushaEligible,
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

  it('BLOCKS (blocked_lusha_disabled) when eligible but the preview flag is off', () => {
    // STRICT-ALL fail closed — must NOT degrade to default_ai / Apollo.
    const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, lushaPreviewEnabled: false });
    assert.equal(decision.provider, 'blocked_lusha_disabled');
    assert.equal(decision.reason, 'lusha_preview_disabled');
  });

  it('never resolves a Lusha-eligible intent to default_ai (flag on OR off)', () => {
    for (const lushaPreviewEnabled of [true, false]) {
      const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, lushaPreviewEnabled });
      assert.notEqual(
        decision.provider,
        'default_ai',
        `eligible criteria leaked to default_ai with flag=${lushaPreviewEnabled}`,
      );
    }
  });

  it('isProspectLushaEligible is independent of the flag (flag is not an input)', () => {
    assert.equal(
      isProspectLushaEligible({ searchType: 'exploratory', sectorKey: 'healthcare', countryCode: 'CO' }),
      true,
    );
    assert.equal(
      isProspectLushaEligible({ searchType: 'competitors', sectorKey: 'healthcare', countryCode: 'CO' }),
      false,
    );
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
