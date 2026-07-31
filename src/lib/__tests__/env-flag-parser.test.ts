/**
 * Tests — env-flag-parser.ts (A1-APOLLO-BUDGET-RECONCILIATION-1)
 *
 * The parser exists because the same deployment value used to resolve
 * differently depending on which module read it. These tests pin the single
 * normalization contract so that drift becomes a test failure.
 *
 * Pure module: no network, no filesystem, no process.env.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isEnvFlagEnabled,
  matchesEnvToken,
  normalizeEnvToken,
  parseEnvBooleanFlag,
} from '../env-flag-parser';

describe('A. normalizeEnvToken', () => {
  it('trims and lowercases', () => {
    assert.equal(normalizeEnvToken('  TRUE  '), 'true');
    assert.equal(normalizeEnvToken('Apollo_Organizations'), 'apollo_organizations');
  });

  it('returns null for absent, empty and whitespace-only values', () => {
    assert.equal(normalizeEnvToken(undefined), null);
    assert.equal(normalizeEnvToken(null), null);
    assert.equal(normalizeEnvToken(''), null);
    assert.equal(normalizeEnvToken('   '), null);
    assert.equal(normalizeEnvToken('\n\t'), null);
  });
});

describe('B. parseEnvBooleanFlag — only exact tokens are booleans', () => {
  it('accepts true in any case and with surrounding whitespace', () => {
    for (const raw of ['true', 'TRUE', ' true ', 'True', '\ttrue\n']) {
      const decision = parseEnvBooleanFlag(raw);
      assert.equal(decision.enabled, true, `expected ${JSON.stringify(raw)} to enable`);
      assert.equal(decision.source, 'explicit_true');
      assert.equal(decision.normalized, 'true');
    }
  });

  it('accepts false in any case and with surrounding whitespace', () => {
    for (const raw of ['false', 'FALSE', ' false ', 'False']) {
      const decision = parseEnvBooleanFlag(raw);
      assert.equal(decision.enabled, false);
      assert.equal(decision.source, 'explicit_false');
      assert.equal(decision.normalized, 'false');
    }
  });

  it('reports an absent variable as absent, not as invalid', () => {
    for (const raw of [undefined, null, '', '   ']) {
      const decision = parseEnvBooleanFlag(raw);
      assert.equal(decision.enabled, false);
      assert.equal(decision.source, 'absent');
      assert.equal(decision.normalized, null);
    }
  });

  it('reports a truthy-looking but non-canonical value as invalid', () => {
    for (const raw of ['1', 'yes', 'on', 'TRUE!', 'truthy', 'si']) {
      const decision = parseEnvBooleanFlag(raw);
      assert.equal(decision.enabled, false, `${raw} must not enable`);
      assert.equal(decision.source, 'invalid');
      assert.equal(decision.normalized, raw.trim().toLowerCase());
    }
  });
});

describe('C. Fail-closed', () => {
  it('isEnvFlagEnabled is true ONLY for the exact token', () => {
    assert.equal(isEnvFlagEnabled('true'), true);
    assert.equal(isEnvFlagEnabled(' TRUE '), true);

    for (const raw of [undefined, null, '', 'false', '1', 'yes', 'on', 'enabled']) {
      assert.equal(isEnvFlagEnabled(raw), false, `${String(raw)} must stay OFF`);
    }
  });

  it('an unparseable value never enables a paid provider', () => {
    // The whole point: garbage in the environment must not read as "on".
    assert.equal(isEnvFlagEnabled('tru e'), false);
    assert.equal(isEnvFlagEnabled('"true"'), false);
  });
});

describe('D. matchesEnvToken — enum-style comparison', () => {
  it('uses the same normalization as the boolean parser', () => {
    assert.equal(matchesEnvToken(' Apollo_Organizations ', 'apollo_organizations'), true);
    assert.equal(matchesEnvToken('TAVILY', 'tavily'), true);
  });

  it('does not match a different token or an absent value', () => {
    assert.equal(matchesEnvToken('tavily', 'apollo_organizations'), false);
    assert.equal(matchesEnvToken(undefined, 'tavily'), false);
    assert.equal(matchesEnvToken('', 'tavily'), false);
    assert.equal(matchesEnvToken('apollo', 'apollo_organizations'), false);
  });
});

describe('E. Cross-module agreement', () => {
  it('the value both Apollo gates read resolves identically through one parser', () => {
    // wizard-provider-resolver and isApolloCompanySearchEnabled both call this.
    // If either stopped agreeing, the provider indicator could disagree with the
    // code that spends credits — the defect this parser was written to close.
    for (const raw of ['true', 'TRUE', ' true ', 'false', '1', '', undefined]) {
      const viaBoolean = isEnvFlagEnabled(raw);
      const viaDecision = parseEnvBooleanFlag(raw).enabled;
      assert.equal(viaBoolean, viaDecision, `disagreement on ${JSON.stringify(raw)}`);
    }
  });
});
