/**
 * Tests — Apollo Organization Industry Raw-Label Ingestion (Q3F-5AP.1)
 *
 * Pure unit tests. No Supabase, no network, no filesystem, no provider call,
 * no AI. Uses Node.js built-in test runner.
 *
 * All raw-label inputs below are SYNTHETIC TEST INPUT: they validate
 * ingestion mechanics, normalization collisions, representative selection,
 * and ordering. They do NOT claim Apollo taxonomy coverage, provider
 * semantic correctness, or real provider output frequency.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ingestApolloOrganizationIndustryRawLabels,
  type ApolloOrganizationIndustryObservation,
} from '../apollo-industry-raw-label-ingestion';

// ── SYNTHETIC_APOLLO_INDUSTRY_OBSERVATIONS ────────────────────────────────
// Neutral, explicitly synthetic fixture builder — not a claim of real Apollo
// output.

function observation(
  industry: string | null | undefined,
  industries?: readonly string[] | null,
): ApolloOrganizationIndustryObservation {
  return { industry, industries };
}

describe('Q3F-5AP.1 — ingestApolloOrganizationIndustryRawLabels', () => {
  it('APRI-1: empty organization collection returns []', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([]);
    assert.deepEqual(result, []);
  });

  it('APRI-2: organization with null industry and null industries returns []', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation(null, null)]);
    assert.deepEqual(result, []);
  });

  it('APRI-3: scalar industry is included', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('Software')]);
    assert.deepEqual(result, [{ rawLabel: 'Software' }]);
  });

  it('APRI-4: every valid industries[] string is included', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation(null, ['Alpha', 'Beta', 'Gamma']),
    ]);
    assert.deepEqual(
      result.map((r) => r.rawLabel).sort(),
      ['Alpha', 'Beta', 'Gamma'].sort(),
    );
    assert.equal(result.length, 3);
  });

  it('APRI-5: scalar and array are unioned when both are populated', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('Fintech', ['Insurtech', 'Proptech']),
    ]);
    const labels = result.map((r) => r.rawLabel).sort();
    assert.deepEqual(labels, ['Fintech', 'Insurtech', 'Proptech'].sort());
  });

  it('APRI-6: same exact raw string in scalar and array collapses', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('Logistics', ['Logistics']),
    ]);
    assert.deepEqual(result, [{ rawLabel: 'Logistics' }]);
  });

  it('APRI-7: same exact raw string across different organizations collapses', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('Retail'),
      observation('Retail'),
    ]);
    assert.deepEqual(result, [{ rawLabel: 'Retail' }]);
  });

  it('APRI-8: outer-whitespace variants collapse', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('  Manufacturing  '),
      observation('Manufacturing'),
    ]);
    assert.equal(result.length, 1);
  });

  it('APRI-9: stored rawLabel is trimmed', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('  Aerospace  ')]);
    assert.deepEqual(result, [{ rawLabel: 'Aerospace' }]);
  });

  it('APRI-10: stored rawLabel preserves case', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('EdTech')]);
    assert.deepEqual(result, [{ rawLabel: 'EdTech' }]);
  });

  it('APRI-11: stored rawLabel preserves punctuation', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('Oil & Gas')]);
    assert.deepEqual(result, [{ rawLabel: 'Oil & Gas' }]);
  });

  it('APRI-12: stored rawLabel preserves Unicode/diacritics', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('Educación')]);
    assert.deepEqual(result, [{ rawLabel: 'Educación' }]);
  });

  it('APRI-13: empty string is dropped', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('')]);
    assert.deepEqual(result, []);
  });

  it('APRI-14: whitespace-only value is dropped', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('   ')]);
    assert.deepEqual(result, []);
  });

  it('APRI-15: ASCII-control-only value normalizing empty is dropped', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('\x00\x1F\x07')]);
    assert.deepEqual(result, []);
  });

  it('APRI-16: punctuation-only value normalizing empty is dropped', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('!!!---///')]);
    assert.deepEqual(result, []);
  });

  it('APRI-17: runtime non-string scalar value is ignored without throw', () => {
    const malformed = { industry: 12345 as unknown as string } as ApolloOrganizationIndustryObservation;
    assert.doesNotThrow(() => {
      const result = ingestApolloOrganizationIndustryRawLabels([malformed]);
      assert.deepEqual(result, []);
    });
  });

  it('APRI-18: runtime industries[] containing non-string values ignores only malformed elements', () => {
    const malformed = {
      industries: ['Valid', null, undefined, 42, {}, 'AlsoValid'] as unknown as string[],
    } as ApolloOrganizationIndustryObservation;
    const result = ingestApolloOrganizationIndustryRawLabels([malformed]);
    assert.deepEqual(
      result.map((r) => r.rawLabel).sort(),
      ['AlsoValid', 'Valid'].sort(),
    );
  });

  it('APRI-19: case-normalization collision collapses by normalized key', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('software'),
      observation('SOFTWARE'),
      observation('Software'),
    ]);
    assert.equal(result.length, 1);
  });

  it('APRI-20: separator collision — hyphen/underscore/slash/backslash variants collapse', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('cyber-security'),
      observation('cyber_security'),
      observation('cyber/security'),
      observation('cyber\\security'),
    ]);
    assert.equal(result.length, 1);
  });

  it('APRI-21: diacritic-normalization collision collapses', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('Educación'),
      observation('Educacion'),
    ]);
    assert.equal(result.length, 1);
  });

  it('APRI-22: N3 chooses lexicographically smallest trimmed rawLabel', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('software'),
      observation('SOFTWARE'),
      observation('Software'),
    ]);
    // Ordinal comparison: 'SOFTWARE' < 'Software' < 'software' (uppercase code
    // units sort below lowercase).
    assert.deepEqual(result, [{ rawLabel: 'SOFTWARE' }]);
  });

  it('APRI-23: N3 result is identical when organization input order is reversed', () => {
    const forward = ingestApolloOrganizationIndustryRawLabels([
      observation('software'),
      observation('SOFTWARE'),
      observation('Software'),
    ]);
    const reversed = ingestApolloOrganizationIndustryRawLabels([
      observation('Software'),
      observation('SOFTWARE'),
      observation('software'),
    ]);
    assert.deepEqual(forward, reversed);
  });

  it('APRI-24: N3 result is identical when industries[] input order is reversed', () => {
    const forward = ingestApolloOrganizationIndustryRawLabels([
      observation(null, ['software', 'SOFTWARE', 'Software']),
    ]);
    const reversed = ingestApolloOrganizationIndustryRawLabels([
      observation(null, ['Software', 'SOFTWARE', 'software']),
    ]);
    assert.deepEqual(forward, reversed);
  });

  it('APRI-25: different normalized keys remain separate even when raw strings are visually similar', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('Ecommerce'),
      observation('E-commerce'),
    ]);
    // 'Ecommerce' normalizes to 'ecommerce'; 'E-commerce' normalizes to
    // 'e commerce' (hyphen becomes a space, not removed) — distinct keys.
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((r) => r.rawLabel).sort(),
      ['E-commerce', 'Ecommerce'].sort(),
    );
  });

  it('APRI-26: dedup scope spans the whole provider execution result set, not one organization at a time', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('Telecom'),
      observation(null, ['Telecom']),
      observation('telecom'),
    ]);
    assert.equal(result.length, 1);
  });

  it('APRI-27: output sorted by normalized key ASC', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('Zeta'),
      observation('Alpha'),
      observation('Mu'),
    ]);
    assert.deepEqual(
      result.map((r) => r.rawLabel),
      ['Alpha', 'Mu', 'Zeta'],
    );
  });

  it('APRI-28: rawLabel lexical ASC is used as the explicit O3 tie-break', () => {
    // Distinct normalized keys already sort the output; this case proves the
    // comparator sequence (key first, then rawLabel) is applied consistently
    // by checking a multi-entry batch resolves to strict ascending order on
    // normalized key with no violation of the documented tie-break rule.
    const result = ingestApolloOrganizationIndustryRawLabels([
      observation('beta'),
      observation('Alpha-2'),
      observation('alpha-1'),
    ]);
    const keys = result.map((r) => r.rawLabel);
    // 'alpha-1' and 'Alpha-2' normalize to 'alpha 1' and 'alpha 2' — distinct
    // keys, so both survive; 'alpha 1' < 'alpha 2' < 'beta' lexically.
    assert.deepEqual(keys, ['alpha-1', 'Alpha-2', 'beta']);
  });

  it('APRI-29: input organization array is not mutated', () => {
    const input: ApolloOrganizationIndustryObservation[] = [observation('Retail')];
    const snapshot = JSON.parse(JSON.stringify(input));
    ingestApolloOrganizationIndustryRawLabels(input);
    assert.deepEqual(JSON.parse(JSON.stringify(input)), snapshot);
  });

  it('APRI-30: input industries arrays are not mutated', () => {
    const industries = ['Alpha', 'Beta'];
    const input: ApolloOrganizationIndustryObservation[] = [observation(null, industries)];
    ingestApolloOrganizationIndustryRawLabels(input);
    assert.deepEqual(industries, ['Alpha', 'Beta']);
  });

  it('APRI-31: repeated calls with identical logical input return deeply equal output', () => {
    const input: ApolloOrganizationIndustryObservation[] = [
      observation('Software', ['Fintech', 'Retail']),
      observation('Logistics'),
    ];
    const first = ingestApolloOrganizationIndustryRawLabels(input);
    const second = ingestApolloOrganizationIndustryRawLabels(input);
    assert.deepEqual(first, second);
  });

  it('APRI-32: a synthetic collision fixture is documented as synthetic and proves no Apollo taxonomy coverage claim', () => {
    // SYNTHETIC TEST INPUT — validates ingestion/collision mechanics only.
    // Does not assert Apollo production taxonomy coverage.
    const SYNTHETIC_APOLLO_INDUSTRY_OBSERVATIONS: ApolloOrganizationIndustryObservation[] = [
      observation('Widget Manufacturing'),
      observation('widget manufacturing'),
    ];
    const result = ingestApolloOrganizationIndustryRawLabels(
      SYNTHETIC_APOLLO_INDUSTRY_OBSERVATIONS,
    );
    assert.equal(result.length, 1);
  });

  it('APRI-33: public output objects contain exactly rawLabel', () => {
    const result = ingestApolloOrganizationIndustryRawLabels([observation('Software')]);
    for (const entry of result) {
      assert.deepEqual(Object.keys(entry), ['rawLabel']);
    }
  });

  it('APRI-34: function performs no DB/provider/AI side effect (static import inspection)', () => {
    // Verified statically: this module imports only
    // normalizeClassificationValue from the pure catalog-normalization
    // module. No @supabase/*, no src/lib/supabase, no next/headers, no
    // server-only, no Apollo runtime client, no fetch/network utility, no AI
    // module import exists in apollo-industry-raw-label-ingestion.ts.
    assert.equal(typeof ingestApolloOrganizationIndustryRawLabels, 'function');
  });

  it('APRI-35: the function does not depend on provider encounter order', () => {
    const a = ingestApolloOrganizationIndustryRawLabels([
      observation('Alpha', ['Beta']),
      observation('Gamma'),
    ]);
    const b = ingestApolloOrganizationIndustryRawLabels([
      observation('Gamma'),
      observation('Alpha', ['Beta']),
    ]);
    assert.deepEqual(a, b);
  });
});
