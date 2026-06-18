// Tests for 16AB.43.18.3 — Auto-show wizard execution CTA when config is valid
// Covers spec sections 12.1–12.9.
// Uses Node.js built-in test runner. No DOM, no providers, no real services.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  prospectWizardReducer,
  createInitialProspectWizardState,
  canValidateWizard,
} from '@/modules/prospect-batches/chat-wizard';
import type { ProspectWizardState } from '@/modules/prospect-batches/chat-wizard';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeInitial(): ProspectWizardState {
  return createInitialProspectWizardState({
    catalogVersion: 'v1',
    defaultRequestedCount: 25,
  });
}

function advanceToSummary(): ProspectWizardState {
  let s = makeInitial();
  s = prospectWizardReducer(s, { type: 'START' });
  s = prospectWizardReducer(s, { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' });
  s = prospectWizardReducer(s, { type: 'SELECT_COUNTRY', countryCode: 'CO' });
  s = prospectWizardReducer(s, { type: 'SELECT_INDUSTRY', industryId: 'ind-1' });
  s = prospectWizardReducer(s, { type: 'SKIP_SUBINDUSTRIES' });
  s = prospectWizardReducer(s, { type: 'SKIP_ADDITIONAL_CRITERIA' });
  return s; // currentStep === 'summary'
}

function advanceToValidated(): ProspectWizardState {
  let s = advanceToSummary();
  s = prospectWizardReducer(s, { type: 'BEGIN_VALIDATION' });
  s = prospectWizardReducer(s, { type: 'VALIDATION_SUCCEEDED' });
  return s; // currentStep === 'validated'
}

// ── 12.1 Auto-validación al completar configuración ───────────────────────────

describe('12.1 — completing last step enters summary with canValidate=true', () => {
  test('SKIP_ADDITIONAL_CRITERIA moves state to summary', () => {
    const s = advanceToSummary();
    assert.equal(s.currentStep, 'summary');
  });

  test('canValidateWizard is true when at summary with complete config', () => {
    const s = advanceToSummary();
    assert.equal(canValidateWizard(s), true);
  });

  test('no extra user action is needed — BEGIN_VALIDATION is valid immediately at summary', () => {
    const s = advanceToSummary();
    // The effect would call handleValidate which dispatches BEGIN_VALIDATION.
    // This verifies BEGIN_VALIDATION is accepted from 'summary' without any extra step.
    const next = prospectWizardReducer(s, { type: 'BEGIN_VALIDATION' });
    assert.equal(next.currentStep, 'validating');
  });
});

// ── 12.2 CTA automático con ejecución habilitada ──────────────────────────────

describe('12.2 — validated state is sufficient for CTA when executionEnabled=true', () => {
  test('reaching validated via BEGIN_VALIDATION + VALIDATION_SUCCEEDED requires no extra step', () => {
    const s = advanceToValidated();
    assert.equal(s.currentStep, 'validated');
    assert.equal(s.validationStatus, 'valid');
    assert.equal(s.executionError, null);
  });

  test('validated state does not have a legacy gate that could hide CTA', () => {
    const s = advanceToValidated();
    assert.ok(!('summaryState' in s), 'No legacy summaryState field');
    assert.ok(!('validationOnly' in s), 'No legacy validationOnly field');
    assert.ok(!('executionMode' in s), 'No legacy executionMode field');
  });
});

// ── 12.3 Sin CTA cuando ejecución está deshabilitada ─────────────────────────

describe('12.3 — validated state is identical whether executionEnabled=true or false', () => {
  test('state alone does not determine whether CTA shows — only the prop does', () => {
    // The state machine always reaches 'validated' with the same shape.
    // executionEnabled is a prop passed from the server, not a state field.
    const s = advanceToValidated();
    assert.equal(s.currentStep, 'validated');
    // No state field encodes the execution gate:
    assert.ok(!('isRealGenerationAvailable' in s));
    assert.ok(!('executionEnabled' in s));
  });
});

// ── 12.4 No autoejecución ─────────────────────────────────────────────────────

describe('12.4 — execution does not fire automatically', () => {
  test('BEGIN_EXECUTION is only valid from validated, not from summary or validating', () => {
    const atSummary = advanceToSummary();
    const afterSummaryExec = prospectWizardReducer(atSummary, { type: 'BEGIN_EXECUTION' });
    assert.equal(afterSummaryExec.currentStep, 'summary', 'BEGIN_EXECUTION at summary is a no-op');

    let atValidating = advanceToSummary();
    atValidating = prospectWizardReducer(atValidating, { type: 'BEGIN_VALIDATION' });
    const afterValidatingExec = prospectWizardReducer(atValidating, { type: 'BEGIN_EXECUTION' });
    assert.equal(afterValidatingExec.currentStep, 'validating', 'BEGIN_EXECUTION at validating is a no-op');
  });

  test('execution only triggers after explicit BEGIN_EXECUTION from validated', () => {
    const validated = advanceToValidated();
    const submitting = prospectWizardReducer(validated, { type: 'BEGIN_EXECUTION' });
    assert.equal(submitting.currentStep, 'submitting');
    // The action must come from the user clicking the CTA — not from automatic logic.
    // Verified by requiring it to be dispatched explicitly (tested here via reducer).
  });
});

// ── 12.5 Clic manual ejecuta una vez ─────────────────────────────────────────

describe('12.5 — single click: BEGIN_EXECUTION moves to submitting once', () => {
  test('dispatching BEGIN_EXECUTION once transitions to submitting', () => {
    const s = advanceToValidated();
    const next = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    assert.equal(next.currentStep, 'submitting');
    assert.equal(next.executionError, null);
  });
});

// ── 12.6 Doble clic protegido ─────────────────────────────────────────────────

describe('12.6 — double-click: second BEGIN_EXECUTION is a no-op', () => {
  test('second BEGIN_EXECUTION on submitting state does not re-trigger', () => {
    const validated = advanceToValidated();
    const first = prospectWizardReducer(validated, { type: 'BEGIN_EXECUTION' });
    assert.equal(first.currentStep, 'submitting');

    const second = prospectWizardReducer(first, { type: 'BEGIN_EXECUTION' });
    assert.equal(second.currentStep, 'submitting');
    assert.deepEqual(first, second, 'State is identical — second click is absorbed');
  });
});

// ── 12.7 clientRequestId estable ─────────────────────────────────────────────

describe('12.7 — clientRequestId stability (component-level concern, documented via state invariants)', () => {
  test('CONFIRM_RESTART resets all execution state (simulates new clientRequestId session)', () => {
    let s = advanceToValidated();
    s = prospectWizardReducer(s, { type: 'REQUEST_RESTART' });
    s = prospectWizardReducer(s, { type: 'CONFIRM_RESTART' });
    // After restart, a new clientRequestId will be assigned on the next validated entry.
    assert.equal(s.currentStep, 'welcome');
    assert.equal(s.executionBatchId, null);
    assert.equal(s.executionError, null);
    assert.equal(s.executionStatus, null);
  });

  test('validated state fields are stable across re-renders (no execution identifiers change)', () => {
    // The reducer is pure — re-applying VALIDATION_SUCCEEDED on the same input
    // produces the same state, confirming no non-determinism.
    let base = advanceToSummary();
    base = prospectWizardReducer(base, { type: 'BEGIN_VALIDATION' });

    const v1 = prospectWizardReducer(base, { type: 'VALIDATION_SUCCEEDED' });
    const v2 = prospectWizardReducer(base, { type: 'VALIDATION_SUCCEEDED' });

    assert.deepEqual(v1, v2, 'Reducer is deterministic — same inputs produce same state');
    assert.equal(v1.currentStep, 'validated');
  });
});

// ── 12.8 Editar búsqueda ──────────────────────────────────────────────────────

describe('12.8 — editing a field after seeing CTA removes CTA until config is complete again', () => {
  test('EDIT_STEP from validated moves away from validated (CTA hidden)', () => {
    const validated = advanceToValidated();
    const editing = prospectWizardReducer(validated, { type: 'EDIT_STEP', step: 'additional_criteria' });
    assert.notEqual(editing.currentStep, 'validated');
    assert.equal(editing.currentStep, 'additional_criteria');
  });

  test('after editing, reaching summary again enables canValidateWizard (CTA can reappear)', () => {
    let s = advanceToValidated();
    // User edits additional_criteria
    s = prospectWizardReducer(s, { type: 'EDIT_STEP', step: 'additional_criteria' });
    // User skips criteria again (or re-submits) — APPLY_CRITERIA_GUARD_RESULT goes to summary
    s = prospectWizardReducer(s, {
      type: 'APPLY_CRITERIA_GUARD_RESULT',
      rawValue: 'empresas de tecnología',
      result: {
        status: 'allowed',
        normalizedValue: 'empresas de tecnología',
        warnings: [],
        blockingIssues: [],
      },
    });
    assert.equal(s.currentStep, 'summary');
    assert.equal(canValidateWizard(s), true, 'Auto-validation can fire again');
  });

  test('editing via EDIT_STEP to additional_criteria then SKIP_ADDITIONAL_CRITERIA returns to summary', () => {
    let s = advanceToValidated();
    s = prospectWizardReducer(s, { type: 'EDIT_STEP', step: 'additional_criteria' });
    s = prospectWizardReducer(s, { type: 'SKIP_ADDITIONAL_CRITERIA' });
    assert.equal(s.currentStep, 'summary');
    assert.equal(canValidateWizard(s), true);
  });
});

// ── 12.9 Comenzar de nuevo ────────────────────────────────────────────────────

describe('12.9 — restarting clears state and resets CTA visibility', () => {
  test('CONFIRM_RESTART from validated returns to welcome step', () => {
    let s = advanceToValidated();
    s = prospectWizardReducer(s, { type: 'REQUEST_RESTART' });
    assert.equal(s.restartConfirmationRequired, true);
    s = prospectWizardReducer(s, { type: 'CONFIRM_RESTART' });
    assert.equal(s.currentStep, 'welcome');
  });

  test('after restart, canValidateWizard is false (CTA not visible until config re-completed)', () => {
    let s = advanceToValidated();
    s = prospectWizardReducer(s, { type: 'REQUEST_RESTART' });
    s = prospectWizardReducer(s, { type: 'CONFIRM_RESTART' });
    assert.equal(canValidateWizard(s), false);
  });

  test('after restart, state is fully clean', () => {
    let s = advanceToValidated();
    s = prospectWizardReducer(s, { type: 'REQUEST_RESTART' });
    s = prospectWizardReducer(s, { type: 'CONFIRM_RESTART' });

    assert.equal(s.countryCode, null);
    assert.equal(s.industryId, null);
    assert.deepEqual(s.subindustryIds, []);
    assert.equal(s.additionalCriteriaRaw, null);
    assert.equal(s.validationStatus, 'idle');
    assert.deepEqual(s.warnings, []);
    assert.deepEqual(s.blockingIssues, []);
    assert.equal(s.executionBatchId, null);
    assert.equal(s.executionError, null);
    assert.equal(s.executionStatus, null);
  });
});
