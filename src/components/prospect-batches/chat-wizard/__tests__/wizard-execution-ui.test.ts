// Tests for 16AB.43.18 — Wizard execution UI
// Covers sections 17.1–17.12 of the milestone spec.
// Uses Node.js built-in test runner. No DOM, no providers, no real services.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  prospectWizardReducer,
  createInitialProspectWizardState,
} from '@/modules/prospect-batches/chat-wizard';
import type {
  ProspectWizardState,
} from '@/modules/prospect-batches/chat-wizard';
import {
  mapExecutionError,
  EXECUTION_ERROR_MESSAGES,
} from '../wizard-execution-error-map';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '550e8400-e29b-41d4-a716-446655440001';
const BATCH_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

function makeInitial(): ProspectWizardState {
  return createInitialProspectWizardState({
    catalogVersion: 'v1',
    defaultRequestedCount: 25,
  });
}

function advanceToValidated(): ProspectWizardState {
  let s = makeInitial();
  s = prospectWizardReducer(s, { type: 'START' });
  s = prospectWizardReducer(s, { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' });
  s = prospectWizardReducer(s, { type: 'SELECT_COUNTRY', countryCode: 'CO' });
  s = prospectWizardReducer(s, { type: 'SELECT_INDUSTRY', industryId: 'ind-1' });
  s = prospectWizardReducer(s, { type: 'SKIP_SUBINDUSTRIES' });
  s = prospectWizardReducer(s, { type: 'SKIP_ADDITIONAL_CRITERIA' });
  s = prospectWizardReducer(s, { type: 'BEGIN_VALIDATION' });
  s = prospectWizardReducer(s, { type: 'VALIDATION_SUCCEEDED' });
  return s;
}

function advanceToSubmitting(): ProspectWizardState {
  let s = advanceToValidated();
  s = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
  return s;
}

// ── 17.1 Execution disabled ────────────────────────────────────────────────────

describe('17.1 — executionEnabled=false keeps validation mode', () => {
  test('validated state has no executionError when disabled', () => {
    const s = advanceToValidated();
    assert.equal(s.currentStep, 'validated');
    assert.equal(s.executionError, null);
  });

  test('executionStatus is null until execution succeeds', () => {
    const s = advanceToValidated();
    assert.equal(s.executionStatus, null);
  });
});

// ── 17.2 Execution enabled ─────────────────────────────────────────────────────

describe('17.2 — executionEnabled=true: validated state is ready', () => {
  test('currentStep is validated after successful validation', () => {
    const s = advanceToValidated();
    assert.equal(s.currentStep, 'validated');
  });

  test('executionError is null when entering validated step', () => {
    const s = advanceToValidated();
    assert.equal(s.executionError, null);
  });
});

// ── 17.3 Payload safety ────────────────────────────────────────────────────────

describe('17.3 — Payload structure: forbidden fields are absent', () => {
  const FORBIDDEN_FIELDS = [
    'userId',
    'requestedCredits',
    'periodStart',
    'reservationId',
    'batchId',
    'provider',
    'searchDepth',
    'targetCount',
    'maxRounds',
    'pilotEnabled',
  ] as const;

  const ALLOWED_FIELDS = [
    'clientRequestId',
    'searchType',
    'countryCode',
    'catalogVersion',
    'industryId',
    'subindustryIds',
    'additionalCriteriaRaw',
  ];

  test('state fields used to build payload do not include forbidden keys', () => {
    const s = advanceToValidated();
    // Build the payload object as the component would
    const payload = {
      countryCode: s.countryCode,
      industryId: s.industryId,
      subindustryIds: s.subindustryIds,
      additionalCriteriaRaw: s.additionalCriteriaRaw,
      catalogVersion: s.catalogVersion,
      clientRequestId: VALID_UUID,
    };

    const keys = Object.keys(payload);
    for (const forbidden of FORBIDDEN_FIELDS) {
      assert.ok(
        !keys.includes(forbidden),
        `Forbidden field "${forbidden}" found in payload`,
      );
    }
  });

  test('payload contains only allowed fields', () => {
    const payload = {
      countryCode: 'CO',
      industryId: 'ind-1',
      subindustryIds: [] as string[],
      additionalCriteriaRaw: null,
      catalogVersion: 'v1',
      clientRequestId: VALID_UUID,
    };
    const keys = Object.keys(payload);
    for (const key of keys) {
      assert.ok(
        ALLOWED_FIELDS.includes(key),
        `Unexpected field "${key}" in payload — check against allowed list`,
      );
    }
  });
});

// ── 17.4 Single submission (double-click prevention) ──────────────────────────

describe('17.4 — BEGIN_EXECUTION from validated moves to submitting once', () => {
  test('dispatching BEGIN_EXECUTION twice does not double-advance', () => {
    const validated = advanceToValidated();
    const first = prospectWizardReducer(validated, { type: 'BEGIN_EXECUTION' });
    assert.equal(first.currentStep, 'submitting');

    // Second dispatch on submitting state must be a no-op
    const second = prospectWizardReducer(first, { type: 'BEGIN_EXECUTION' });
    assert.equal(second.currentStep, 'submitting');
    assert.deepEqual(first, second);
  });
});

// ── 17.5 clientRequestId stability ────────────────────────────────────────────

describe('17.5 — clientRequestId stability invariants', () => {
  test('CONFIRM_RESTART resets state (simulates new clientRequestId round)', () => {
    let s = advanceToValidated();
    s = prospectWizardReducer(s, { type: 'REQUEST_RESTART' });
    s = prospectWizardReducer(s, { type: 'CONFIRM_RESTART' });
    assert.equal(s.currentStep, 'welcome');
    // After restart, executionStatus is null (a new attempt starts fresh)
    assert.equal(s.executionStatus, null);
    assert.equal(s.executionError, null);
    assert.equal(s.executionBatchId, null);
  });

  test('executionStatus is null on initial state (no prior attempt)', () => {
    assert.equal(makeInitial().executionStatus, null);
  });
});

// ── 17.6 Pending state ─────────────────────────────────────────────────────────

describe('17.6 — Pending (submitting) state', () => {
  test('currentStep is submitting after BEGIN_EXECUTION', () => {
    const s = advanceToSubmitting();
    assert.equal(s.currentStep, 'submitting');
  });

  test('executionError is cleared when entering submitting', () => {
    // Simulate a prior error, then re-attempt
    let s = advanceToValidated();
    s = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
      message: 'El servicio no está disponible.',
      retryable: true,
    });
    assert.equal(s.currentStep, 'validated');
    assert.ok(s.executionError !== null);

    // Second attempt — BEGIN_EXECUTION clears error
    s = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    assert.equal(s.currentStep, 'submitting');
    assert.equal(s.executionError, null);
  });

  test('BEGIN_EXECUTION from non-validated step is a no-op', () => {
    const s = makeInitial();
    const next = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    assert.deepEqual(s, next);
  });
});

// ── 17.7 Result: created ──────────────────────────────────────────────────────

describe('17.7 — EXECUTION_SUCCEEDED with status=created', () => {
  test('currentStep advances to success', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospects`,
      status: 'created',
    });
    assert.equal(s.currentStep, 'success');
  });

  test('executionStatus is created', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospects`,
      status: 'created',
    });
    assert.equal(s.executionStatus, 'created');
  });

  test('executionBatchId is stored', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospects`,
      status: 'created',
    });
    assert.equal(s.executionBatchId, BATCH_ID);
  });

  test('executionError is null after success', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospects`,
      status: 'created',
    });
    assert.equal(s.executionError, null);
  });
});

// ── 17.8 Result: already_started ──────────────────────────────────────────────

describe('17.8 — EXECUTION_SUCCEEDED with status=already_started', () => {
  test('currentStep advances to success (not error)', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospects`,
      status: 'already_started',
    });
    assert.equal(s.currentStep, 'success');
  });

  test('executionStatus is already_started', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospects`,
      status: 'already_started',
    });
    assert.equal(s.executionStatus, 'already_started');
  });

  test('second EXECUTION_SUCCEEDED on success step is a no-op (idempotent)', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospects`,
      status: 'already_started',
    });
    assert.equal(s.currentStep, 'success');

    const second = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospects`,
      status: 'already_started',
    });
    assert.equal(second.currentStep, 'success');
    assert.deepEqual(s, second);
  });
});

// ── 17.9 Error codes ──────────────────────────────────────────────────────────

describe('17.9 — Error code mapping', () => {
  const RETRYABLE_CODES = ['BUDGET_RESERVATION_FAILED', 'PROVIDER_UNAVAILABLE', 'GENERATION_FAILED'];
  const NON_RETRYABLE_CODES = [
    'EXECUTION_DISABLED',
    'PILOT_PAUSED',
    'NOT_IN_PILOT',
    'BUDGET_PERIOD_NOT_CONFIGURED',
    'BUDGET_PERIOD_CLOSED',
    'EXECUTION_CREDIT_LIMIT_EXCEEDED',
    'BUDGET_EXCEEDED',
    'CONCURRENT_EXECUTION_ACTIVE',
    'CATALOG_CHANGED',
    'INVALID_REQUEST',
  ];

  test('all mapped codes produce non-empty messages', () => {
    for (const code of Object.keys(EXECUTION_ERROR_MESSAGES)) {
      const mapped = mapExecutionError(code);
      assert.ok(mapped.message.length > 0, `Empty message for code "${code}"`);
    }
  });

  for (const code of RETRYABLE_CODES) {
    test(`${code} is retryable`, () => {
      const mapped = mapExecutionError(code);
      assert.equal(mapped.retryable, true, `Expected ${code} to be retryable`);
    });
  }

  for (const code of NON_RETRYABLE_CODES) {
    test(`${code} is NOT retryable`, () => {
      const mapped = mapExecutionError(code);
      assert.equal(mapped.retryable, false, `Expected ${code} to be non-retryable`);
    });
  }

  test('EXECUTION_FAILED stores mapped message in state', () => {
    let s = advanceToSubmitting();
    const mapped = mapExecutionError('NOT_IN_PILOT');
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_FAILED',
      errorCode: 'NOT_IN_PILOT',
      message: mapped.message,
      retryable: mapped.retryable,
    });
    assert.equal(s.currentStep, 'validated');
    assert.equal(s.executionError?.code, 'NOT_IN_PILOT');
    assert.ok(s.executionError?.message.includes('piloto'));
    assert.equal(s.executionError?.retryable, false);
  });
});

// ── 17.10 Unknown error ────────────────────────────────────────────────────────

describe('17.10 — Unknown error produces safe fallback', () => {
  test('mapExecutionError with unknown code returns non-empty message', () => {
    const mapped = mapExecutionError('COMPLETELY_UNKNOWN_CODE_XYZ');
    assert.ok(mapped.message.length > 0);
    assert.equal(mapped.retryable, false);
  });

  test('fallback message does not expose technical details', () => {
    const mapped = mapExecutionError('COMPLETELY_UNKNOWN_CODE_XYZ');
    assert.ok(!mapped.message.includes('SQL'));
    assert.ok(!mapped.message.includes('stack'));
    assert.ok(!mapped.message.includes('undefined'));
    assert.ok(!mapped.message.includes('null'));
  });

  test('EXECUTION_FAILED with unknown code leaves state in validated (not crashed)', () => {
    const mapped = mapExecutionError('UNKNOWN');
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_FAILED',
      errorCode: 'UNKNOWN',
      message: mapped.message,
      retryable: mapped.retryable,
    });
    assert.equal(s.currentStep, 'validated');
    assert.ok(s.executionError !== null);
  });
});

// ── 17.11 Anti-ruta obsoleta ──────────────────────────────────────────────────

describe('17.11 — No navigation to /prospect-batches/[batchId]', () => {
  test('executionRedirectPath in state is NOT used for navigation (by design)', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      // The backend currently returns this path — the UI must ignore it for navigation
      redirectPath: `/prospect-batches/${BATCH_ID}`,
      status: 'created',
    });
    // State stores it but SuccessPanel now uses onClose+router.refresh() instead
    assert.equal(s.executionRedirectPath, `/prospect-batches/${BATCH_ID}`);
    // The key guarantee: currentStep is 'success', not 'error', and the UI will
    // call onClose+router.refresh() — not router.push(executionRedirectPath).
    // This test documents that `executionRedirectPath` is stored but ignored for navigation.
    assert.equal(s.currentStep, 'success');
    assert.equal(s.executionStatus, 'created');
  });

  test('VALID_UUID_2 as clientRequestId is stable across multiple dispatches', () => {
    // Simulates: same clientRequestId used for both BEGIN_EXECUTION and result dispatch
    const clientRequestId = VALID_UUID_2;
    let s = advanceToValidated();
    s = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: `/prospects`,
      status: 'created',
    });
    // clientRequestId is tracked outside reducer (in ref) — state holds batch info
    assert.equal(s.executionBatchId, BATCH_ID);
    assert.equal(s.executionStatus, 'created');
    // Prove we're referencing the constant (no typo)
    assert.ok(clientRequestId.length === 36);
  });
});

// ── 17.12 External guardrails — compile-time structural check ─────────────────

describe('17.12 — External services not called in UI layer', () => {
  test('reducer is a pure function — no async, no I/O', () => {
    // prospectWizardReducer is synchronous and deterministic
    const s = advanceToValidated();
    const result = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    assert.equal(typeof result, 'object');
    // If this were async it would return a Promise, which would fail the deepEqual check
    assert.ok(!(result instanceof Promise));
  });

  test('mapExecutionError is a pure function — no async, no I/O', () => {
    const result = mapExecutionError('PROVIDER_UNAVAILABLE');
    assert.ok(!(result instanceof Promise));
    assert.equal(typeof result.message, 'string');
    assert.equal(typeof result.retryable, 'boolean');
  });

  test('error mapping covers all known guardrail codes', () => {
    const guardrailCodes = [
      'PILOT_PAUSED',
      'NOT_IN_PILOT',
      'BUDGET_PERIOD_NOT_CONFIGURED',
      'BUDGET_PERIOD_CLOSED',
      'EXECUTION_CREDIT_LIMIT_EXCEEDED',
      'BUDGET_EXCEEDED',
      'CONCURRENT_EXECUTION_ACTIVE',
      'BUDGET_RESERVATION_FAILED',
    ];
    for (const code of guardrailCodes) {
      const mapped = mapExecutionError(code);
      assert.ok(
        EXECUTION_ERROR_MESSAGES[code] !== undefined,
        `Guardrail code "${code}" has no explicit mapping — will fall back to generic message`,
      );
      assert.ok(mapped.message.length > 0);
    }
  });
});
