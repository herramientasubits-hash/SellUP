// Tests for isLushaPhoneRevealFallbackEnabled in feature-flags.server.ts
// (Agente 2A · LUSHA-PHONE-FALLBACK-1S). Node.js built-in test runner.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const ENV_KEY = 'ENABLE_LUSHA_PHONE_REVEAL_FALLBACK';

function withEnv(value: string | undefined, fn: () => void) {
  const saved = process.env[ENV_KEY];
  if (value === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = value;
  }
  try {
    fn();
  } finally {
    if (saved === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = saved;
    }
  }
}

import {
  isLushaPhoneRevealFallbackEnabled,
  isLushaPhoneRevealEnabled,
  LUSHA_PHONE_REVEAL_FALLBACK_FLAG,
} from '../feature-flags.server';

describe('isLushaPhoneRevealFallbackEnabled — parser', () => {
  test('env absent → false (fail-closed)', () => {
    withEnv(undefined, () => {
      assert.equal(isLushaPhoneRevealFallbackEnabled(), false);
    });
  });

  test('"false" → false', () => {
    withEnv('false', () => {
      assert.equal(isLushaPhoneRevealFallbackEnabled(), false);
    });
  });

  test('"true" → true', () => {
    withEnv('true', () => {
      assert.equal(isLushaPhoneRevealFallbackEnabled(), true);
    });
  });

  test('"TRUE" → true (case-insensitive)', () => {
    withEnv('TRUE', () => {
      assert.equal(isLushaPhoneRevealFallbackEnabled(), true);
    });
  });

  test('" true " → true (whitespace-tolerant)', () => {
    withEnv(' true ', () => {
      assert.equal(isLushaPhoneRevealFallbackEnabled(), true);
    });
  });

  test('"1" → false (not the canonical token)', () => {
    withEnv('1', () => {
      assert.equal(isLushaPhoneRevealFallbackEnabled(), false);
    });
  });

  test('"" → false (empty string)', () => {
    withEnv('', () => {
      assert.equal(isLushaPhoneRevealFallbackEnabled(), false);
    });
  });

  test('flag name constant matches expected env var', () => {
    assert.equal(LUSHA_PHONE_REVEAL_FALLBACK_FLAG, 'ENABLE_LUSHA_PHONE_REVEAL_FALLBACK');
  });
});

describe('isLushaPhoneRevealFallbackEnabled — does not affect the old ban', () => {
  test('isLushaPhoneRevealEnabled() stays hardcoded false regardless of the new flag', () => {
    withEnv('true', () => {
      assert.equal(isLushaPhoneRevealEnabled(), false);
    });
    withEnv(undefined, () => {
      assert.equal(isLushaPhoneRevealEnabled(), false);
    });
  });
});
