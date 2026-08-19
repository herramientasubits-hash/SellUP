/**
 * Q3F-5BB.3D / 10C3-FIX-1 — resolveProspectDiscoveryProvider unit contract.
 *
 * Pure decision layer: no I/O, no env, no network. Three-state routing:
 *   - Lusha-eligible (companies-by-criteria + ROUTABLE Macro-v2 industry +
 *     supported country)
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
  macroIndustryKey: 'health_pharma',
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
      isProspectLushaEligible({ searchType: 'exploratory', macroIndustryKey: 'health_pharma', countryCode: 'CO' }),
      true,
    );
    assert.equal(
      isProspectLushaEligible({ searchType: 'competitors', macroIndustryKey: 'health_pharma', countryCode: 'CO' }),
      false,
    );
  });

  it('falls back to default_ai for a non-criteria search type', () => {
    const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, searchType: 'competitors' });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'search_type_not_criteria');
  });

  it('falls back to default_ai when the industry is not a routable macro', () => {
    // AGENT1-LUSHA-MACRO-V2-ROUTING-CUTOVER-1 § 7 — `healthcare` era el SECTOR
    // legacy y ya no nombra ninguna ruta: la autoridad es la clave canónica de
    // macro (`health_pharma`). Se prueban las dos formas de quedar fuera.
    for (const macroIndustryKey of ['unknown_sector', 'healthcare', 'education']) {
      const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, macroIndustryKey });
      assert.equal(decision.provider, 'default_ai');
      assert.equal(decision.reason, 'sector_not_mapped');
    }
  });

  it('legacy: el vocabulario de sectores ya no produce ninguna ruta', () => {
    const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, macroIndustryKey: 'unknown_sector' });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'sector_not_mapped');
  });

  it('falls back to default_ai for an unsupported country', () => {
    const decision = resolveProspectDiscoveryProvider({ ...COMPATIBLE, countryCode: 'ZZ' });
    assert.equal(decision.provider, 'default_ai');
    assert.equal(decision.reason, 'country_not_supported');
  });
});
