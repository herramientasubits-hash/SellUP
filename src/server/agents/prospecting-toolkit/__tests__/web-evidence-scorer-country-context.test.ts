/**
 * Tests — v1.16K-M getCountrySearchContext multi-country
 *
 * Verifies that getCountrySearchContext returns correct country-specific
 * context for CO, MX, CL, PE, EC, and unknown country codes.
 * No MX/PE/EC candidate should receive Colombia/NIT/RUES context.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getCountrySearchContext } from '../web-evidence-scorer';

function makeCandidate(countryCode: string | null): Parameters<typeof getCountrySearchContext>[0] {
  return { country_code: countryCode } as Parameters<typeof getCountrySearchContext>[0];
}

describe('WESC1 — getCountrySearchContext returns correct country terms', () => {
  it('CO → Colombia / NIT / RUES', () => {
    const ctx = getCountrySearchContext(makeCandidate('CO'));
    assert.equal(ctx.countryTerm, 'Colombia');
    assert.equal(ctx.taxIdLabel, 'NIT');
    assert.equal(ctx.officialRegistryLabel, 'RUES');
    assert.equal(ctx.expectedCountryCode, 'CO');
    assert.ok(ctx.preferredTLDs.includes('.co') || ctx.preferredTLDs.includes('.com.co'));
  });

  it('MX → México / RFC / DENUE/SAT', () => {
    const ctx = getCountrySearchContext(makeCandidate('MX'));
    assert.equal(ctx.countryTerm, 'México');
    assert.equal(ctx.taxIdLabel, 'RFC');
    assert.ok(ctx.officialRegistryLabel.includes('SAT') || ctx.officialRegistryLabel.includes('DENUE'));
    assert.equal(ctx.expectedCountryCode, 'MX');
    assert.ok(ctx.preferredTLDs.some(t => t.includes('mx')));
  });

  it('CL → Chile / RUT / RES Chile', () => {
    const ctx = getCountrySearchContext(makeCandidate('CL'));
    assert.equal(ctx.countryTerm, 'Chile');
    assert.equal(ctx.taxIdLabel, 'RUT');
    assert.equal(ctx.expectedCountryCode, 'CL');
    assert.ok(ctx.preferredTLDs.includes('.cl'));
  });

  it('PE → Perú / RUC / SUNAT', () => {
    const ctx = getCountrySearchContext(makeCandidate('PE'));
    assert.equal(ctx.countryTerm, 'Perú');
    assert.equal(ctx.taxIdLabel, 'RUC');
    assert.ok(ctx.officialRegistryLabel.includes('SUNAT'));
    assert.equal(ctx.expectedCountryCode, 'PE');
    assert.ok(ctx.preferredTLDs.some(t => t.includes('pe')));
  });

  it('EC → Ecuador / RUC / SRI Ecuador', () => {
    const ctx = getCountrySearchContext(makeCandidate('EC'));
    assert.equal(ctx.countryTerm, 'Ecuador');
    assert.equal(ctx.taxIdLabel, 'RUC');
    assert.ok(ctx.officialRegistryLabel.includes('SRI'));
    assert.equal(ctx.expectedCountryCode, 'EC');
    assert.ok(ctx.preferredTLDs.some(t => t.includes('ec')));
  });
});

describe('WESC2 — getCountrySearchContext generic fallback (not Colombia)', () => {
  it('unknown country code → does NOT return Colombia context', () => {
    const ctx = getCountrySearchContext(makeCandidate('AR'));
    assert.notEqual(ctx.countryTerm, 'Colombia', 'AR should not get Colombia context');
    assert.notEqual(ctx.taxIdLabel, 'NIT', 'AR should not get NIT label');
    assert.notEqual(ctx.officialRegistryLabel, 'RUES', 'AR should not get RUES registry');
  });

  it('null country code → generic fallback, not Colombia', () => {
    const ctx = getCountrySearchContext(makeCandidate(null));
    assert.notEqual(ctx.countryTerm, 'Colombia');
    assert.notEqual(ctx.taxIdLabel, 'NIT');
  });

  it('all 5 countries have distinct expectedCountryCode', () => {
    const codes = ['CO', 'MX', 'CL', 'PE', 'EC'];
    const contexts = codes.map(cc => getCountrySearchContext(makeCandidate(cc)));
    const expectedCodes = contexts.map(c => c.expectedCountryCode);
    const unique = new Set(expectedCodes);
    assert.equal(unique.size, codes.length, 'Each country should have a unique expectedCountryCode');
  });
});
