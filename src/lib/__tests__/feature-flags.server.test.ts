// Tests for src/lib/feature-flags.server.ts
// Uses Node.js built-in test runner. No DOM, no external services.

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ENV_KEY = 'ENABLE_PROSPECT_CHAT_WIZARD_EXECUTION';

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

// Import inline so each test re-evaluates the module function (not cached).
// The function reads process.env at call time, so no module-cache issues.
import { isProspectChatWizardExecutionEnabled } from '../feature-flags.server';

// ── Parser tests ──────────────────────────────────────────────────────────────

describe('isProspectChatWizardExecutionEnabled — parser', () => {
  test('"true" → true', () => {
    withEnv('true', () => {
      assert.equal(isProspectChatWizardExecutionEnabled(), true);
    });
  });

  test('"TRUE" → true (case-insensitive)', () => {
    withEnv('TRUE', () => {
      assert.equal(isProspectChatWizardExecutionEnabled(), true);
    });
  });

  test('"True" → true (mixed case)', () => {
    withEnv('True', () => {
      assert.equal(isProspectChatWizardExecutionEnabled(), true);
    });
  });

  test('" true " → true (leading/trailing whitespace)', () => {
    withEnv(' true ', () => {
      assert.equal(isProspectChatWizardExecutionEnabled(), true);
    });
  });

  test('"false" → false', () => {
    withEnv('false', () => {
      assert.equal(isProspectChatWizardExecutionEnabled(), false);
    });
  });

  test('"" → false (empty string)', () => {
    withEnv('', () => {
      assert.equal(isProspectChatWizardExecutionEnabled(), false);
    });
  });

  test('undefined → false (variable absent)', () => {
    withEnv(undefined, () => {
      assert.equal(isProspectChatWizardExecutionEnabled(), false);
    });
  });

  test('"1" → false (not the canonical value)', () => {
    withEnv('1', () => {
      assert.equal(isProspectChatWizardExecutionEnabled(), false);
    });
  });

  test('"yes" → false (not the canonical value)', () => {
    withEnv('yes', () => {
      assert.equal(isProspectChatWizardExecutionEnabled(), false);
    });
  });
});

// ── No exposure test ──────────────────────────────────────────────────────────

describe('isProspectChatWizardExecutionEnabled — structural safety', () => {
  test('returns a boolean, not the raw env string', () => {
    withEnv('true', () => {
      const result = isProspectChatWizardExecutionEnabled();
      assert.equal(typeof result, 'boolean');
    });
  });

  test('returns a boolean when disabled', () => {
    withEnv('false', () => {
      const result = isProspectChatWizardExecutionEnabled();
      assert.equal(typeof result, 'boolean');
    });
  });
});
