/**
 * Tests — env-flag-parser.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * The parser exists because the same deployment value used to resolve
 * differently depending on which module read it. These tests pin the single
 * normalization contract so that drift becomes a test failure.
 *
 * A. normalizeEnvToken — trim + lowercase, empty ⇒ null
 * B. parseEnvBooleanFlag — only the exact tokens are booleans
 * C. Fail-closed — absent / invalid never enable
 * D. matchesEnvToken — enum-style comparison uses the same normalization
 * E. Cross-module agreement — the shape both call sites depend on
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeEnvToken,
  parseEnvBooleanFlag,
  isEnvFlagEnabled,
  matchesEnvToken,
} from '../env-flag-parser';

// ── A. normalizeEnvToken ──────────────────────────────────────────────────────

describe('A — normalizeEnvToken', () => {
  it('A1: trims surrounding whitespace and lowercases', () => {
    assert.equal(normalizeEnvToken('  TRUE  '), 'true');
    assert.equal(normalizeEnvToken('Apollo_Organizations'), 'apollo_organizations');
  });

  it('A2: undefined, null and whitespace-only all normalize to null', () => {
    assert.equal(normalizeEnvToken(undefined), null);
    assert.equal(normalizeEnvToken(null), null);
    assert.equal(normalizeEnvToken(''), null);
    assert.equal(normalizeEnvToken('   '), null);
    assert.equal(normalizeEnvToken('\t\n'), null);
  });

  it('A3: does not alter interior characters', () => {
    assert.equal(normalizeEnvToken(' a b '), 'a b');
  });
});

// ── B. parseEnvBooleanFlag — exact tokens only ────────────────────────────────

describe('B — parseEnvBooleanFlag recognizes only true/false', () => {
  it('B1: "true" in any casing or padding is explicit_true', () => {
    for (const raw of ['true', 'TRUE', ' True ', '\tTRUE\n']) {
      const decision = parseEnvBooleanFlag(raw);
      assert.equal(decision.enabled, true, `raw=${JSON.stringify(raw)}`);
      assert.equal(decision.source, 'explicit_true');
      assert.equal(decision.normalized, 'true');
    }
  });

  it('B2: "false" in any casing or padding is explicit_false', () => {
    for (const raw of ['false', 'FALSE', ' False ']) {
      const decision = parseEnvBooleanFlag(raw);
      assert.equal(decision.enabled, false, `raw=${JSON.stringify(raw)}`);
      assert.equal(decision.source, 'explicit_false');
      assert.equal(decision.normalized, 'false');
    }
  });
});

// ── C. Fail-closed ────────────────────────────────────────────────────────────

describe('C — fail-closed for everything else', () => {
  it('C1: absent value reports source=absent and normalized=null', () => {
    for (const raw of [undefined, null, '', '   ']) {
      const decision = parseEnvBooleanFlag(raw);
      assert.equal(decision.enabled, false);
      assert.equal(decision.source, 'absent');
      assert.equal(decision.normalized, null);
    }
  });

  it('C2: truthy-looking tokens are invalid, not true', () => {
    // These are the values a human would expect to work; the parser must
    // reject them loudly (source=invalid) instead of silently enabling spend.
    for (const raw of ['1', 'yes', 'on', 'y', 'TRUE!', 'true false', 'enabled']) {
      const decision = parseEnvBooleanFlag(raw);
      assert.equal(decision.enabled, false, `raw=${raw} must not enable`);
      assert.equal(decision.source, 'invalid', `raw=${raw}`);
      assert.equal(decision.normalized, raw.trim().toLowerCase());
    }
  });

  it('C3: "0" and "off" are invalid rather than explicit_false', () => {
    // The distinction matters for logging: an operator who wrote `off` made a
    // mistake, and that is a different fact from having written `false`.
    assert.equal(parseEnvBooleanFlag('0').source, 'invalid');
    assert.equal(parseEnvBooleanFlag('off').source, 'invalid');
  });

  it('C4: isEnvFlagEnabled agrees with parseEnvBooleanFlag on every case', () => {
    for (const raw of [undefined, null, '', 'true', 'TRUE', 'false', '1', 'yes']) {
      assert.equal(isEnvFlagEnabled(raw), parseEnvBooleanFlag(raw).enabled, `raw=${raw}`);
    }
  });
});

// ── D. matchesEnvToken ────────────────────────────────────────────────────────

describe('D — matchesEnvToken', () => {
  it('D1: compares with trim + lowercase on both sides', () => {
    assert.equal(matchesEnvToken(' Apollo_Organizations ', 'apollo_organizations'), true);
    assert.equal(matchesEnvToken('TAVILY', ' Tavily '), true);
  });

  it('D2: a different token does not match', () => {
    assert.equal(matchesEnvToken('tavily', 'apollo_organizations'), false);
  });

  it('D3: absent value never matches, not even the empty expectation', () => {
    assert.equal(matchesEnvToken(undefined, 'tavily'), false);
    assert.equal(matchesEnvToken(null, 'tavily'), false);
    assert.equal(matchesEnvToken('', ''), false);
    assert.equal(matchesEnvToken('   ', ''), false);
  });

  it('D4: partial overlap does not match — comparison is exact', () => {
    assert.equal(matchesEnvToken('apollo', 'apollo_organizations'), false);
    assert.equal(matchesEnvToken('apollo_organizations_v2', 'apollo_organizations'), false);
  });
});

// ── E. Cross-module agreement ─────────────────────────────────────────────────

describe('E — one value cannot resolve two ways', () => {
  it('E1: the padded/mixed-case values that used to diverge now agree', () => {
    // isApolloCompanySearchEnabled already trimmed+lowercased;
    // wizard-provider-resolver compared raw. ' TRUE ' was the divergence.
    const raw = ' TRUE ';
    assert.equal(isEnvFlagEnabled(raw), true);
    assert.equal(parseEnvBooleanFlag(raw).source, 'explicit_true');
  });

  it('E2: the decision record always explains the outcome', () => {
    const sources = new Set(
      [undefined, 'true', 'false', 'yes'].map((raw) => parseEnvBooleanFlag(raw).source),
    );
    assert.deepEqual(
      [...sources].sort(),
      ['absent', 'explicit_false', 'explicit_true', 'invalid'],
    );
  });
});
