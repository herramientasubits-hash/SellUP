// Tests — Wizard generation feedback: loader (Block A) + toast (Block B) — Hito 16AB.43.20
//
// Uses Node.js built-in test runner. No DOM, no React providers, no real services.
// State-machine tests verify the exact state that drives Block A / Block B behavior.
// Source-code structural tests verify the implementation without mounting components.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  prospectWizardReducer,
  createInitialProspectWizardState,
} from '@/modules/prospect-batches/chat-wizard';
import type { ProspectWizardState } from '@/modules/prospect-batches/chat-wizard';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BATCH_ID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';

function makeInitial(): ProspectWizardState {
  return createInitialProspectWizardState({ catalogVersion: 'v1', defaultRequestedCount: 25 });
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
  return prospectWizardReducer(advanceToValidated(), { type: 'BEGIN_EXECUTION' });
}

function advanceToSuccess(status: 'created' | 'already_started'): ProspectWizardState {
  return prospectWizardReducer(advanceToSubmitting(), {
    type: 'EXECUTION_SUCCEEDED',
    batchId: BATCH_ID,
    redirectPath: '/prospects',
    status,
  });
}

function readComponentSrc(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx',
    ),
    'utf8',
  );
}

// ── Block A: Loader state (20.A) ──────────────────────────────────────────────

describe('20.A.1 — submitting step gates the AILoader panel', () => {
  it('currentStep is submitting after BEGIN_EXECUTION', () => {
    const s = advanceToSubmitting();
    assert.equal(s.currentStep, 'submitting');
  });

  it('executionError is cleared when entering submitting (no stale error during loader)', () => {
    // Simulate: prior error → re-attempt → submitting clears error
    let s = advanceToValidated();
    s = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
      message: 'El servicio no está disponible.',
      retryable: true,
    });
    assert.ok(s.executionError !== null);

    s = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    assert.equal(s.currentStep, 'submitting');
    assert.equal(s.executionError, null);
  });

  it('submitting step is not reachable from non-validated step (no spurious loader)', () => {
    const s = makeInitial();
    const next = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    assert.notEqual(next.currentStep, 'submitting');
  });
});

describe('20.A.2 — CTA is implicitly disabled during submitting (state invariant)', () => {
  it('validated → submitting: only one step transition occurs per BEGIN_EXECUTION', () => {
    const validated = advanceToValidated();
    const first = prospectWizardReducer(validated, { type: 'BEGIN_EXECUTION' });
    const second = prospectWizardReducer(first, { type: 'BEGIN_EXECUTION' });
    // Second dispatch is a no-op — state is identical → CTA cannot re-trigger
    assert.deepEqual(first, second);
  });

  it('submitting state is terminal until a result action arrives', () => {
    const submitting = advanceToSubmitting();
    // No action other than success/failure should change the step
    const afterNoOp = prospectWizardReducer(submitting, { type: 'BEGIN_EXECUTION' });
    assert.equal(afterNoOp.currentStep, 'submitting');
    assert.deepEqual(submitting, afterNoOp);
  });
});

describe('20.A.3 — SubmittingPanel source uses AILoader card variant', () => {
  it('wizard-conversation-summary.tsx imports AILoader from @/components/ai/ai-loader', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes("import { AILoader } from '@/components/ai/ai-loader'"),
      'AILoader import not found — SubmittingPanel may be missing the AI loader',
    );
  });

  it('SubmittingPanel renders AILoader with variant="card"', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('variant="card"'),
      'variant="card" not found — SubmittingPanel is not using the card variant of AILoader',
    );
  });

  it('SubmittingPanel has role="status" and aria-live="polite" for accessibility', () => {
    const src = readComponentSrc();
    // Check that both role=status and aria-live=polite appear in the SubmittingPanel block
    assert.ok(
      src.includes('role="status"'),
      'role="status" missing — screen readers will not announce the loader',
    );
    assert.ok(
      src.includes('aria-live="polite"'),
      'aria-live="polite" missing — screen readers will not announce generation start',
    );
  });

  it('SubmittingPanel includes status="generating" label for AILoader', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('status="generating"'),
      'status="generating" not found in AILoader usage',
    );
  });
});

// ── Block B: Toast behavior (20.B) ───────────────────────────────────────────

describe('20.B.1 — executionStatus="created" drives toast.success', () => {
  it('state.executionStatus is "created" after EXECUTION_SUCCEEDED with status=created', () => {
    const s = advanceToSuccess('created');
    assert.equal(s.executionStatus, 'created');
    assert.equal(s.currentStep, 'success');
  });

  it('executionError is null when executionStatus=created (no error banner + success toast)', () => {
    const s = advanceToSuccess('created');
    assert.equal(s.executionError, null);
  });
});

describe('20.B.2 — executionStatus="already_started" drives toast.info', () => {
  it('state.executionStatus is "already_started" after EXECUTION_SUCCEEDED with that status', () => {
    const s = advanceToSuccess('already_started');
    assert.equal(s.executionStatus, 'already_started');
    assert.equal(s.currentStep, 'success');
  });

  it('executionError is null when executionStatus=already_started (no error banner)', () => {
    const s = advanceToSuccess('already_started');
    assert.equal(s.executionError, null);
  });
});

describe('20.B.3 — Error path must NOT reach success step (no false success toast)', () => {
  it('EXECUTION_FAILED keeps currentStep=validated, never success', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_FAILED',
      errorCode: 'GENERATION_FAILED',
      message: 'Falló la generación.',
      retryable: true,
    });
    assert.equal(s.currentStep, 'validated');
    assert.notEqual(s.currentStep, 'success');
  });

  it('executionStatus remains null after EXECUTION_FAILED (toast is not triggered)', () => {
    let s = advanceToSubmitting();
    s = prospectWizardReducer(s, {
      type: 'EXECUTION_FAILED',
      errorCode: 'BUDGET_EXCEEDED',
      message: 'Presupuesto excedido.',
      retryable: false,
    });
    assert.equal(s.executionStatus, null);
  });

  it('all known error codes keep executionStatus=null', () => {
    const ERROR_CODES = [
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
      'BUDGET_RESERVATION_FAILED',
      'PROVIDER_UNAVAILABLE',
      'GENERATION_FAILED',
    ];

    for (const code of ERROR_CODES) {
      let s = advanceToSubmitting();
      s = prospectWizardReducer(s, {
        type: 'EXECUTION_FAILED',
        errorCode: code,
        message: 'Error.',
        retryable: false,
      });
      assert.equal(
        s.executionStatus,
        null,
        `Error code "${code}" should not set executionStatus — success toast would fire incorrectly`,
      );
    }
  });
});

describe('20.B.4 — SuccessPanel source calls correct toast variants', () => {
  it('wizard-conversation-summary.tsx imports toast from sonner', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes("import { toast } from 'sonner'"),
      'toast import from sonner not found',
    );
  });

  it('SuccessPanel calls toast.success for created status', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('toast.success('),
      'toast.success not found in wizard-conversation-summary.tsx — Block B is not implemented',
    );
  });

  it('SuccessPanel calls toast.info for already_started status', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('toast.info('),
      'toast.info not found in wizard-conversation-summary.tsx — already_started branch missing',
    );
  });

  it('SuccessPanel dispatches toast in a useEffect (not inline render)', () => {
    const src = readComponentSrc();
    // Both toast calls must appear after "useEffect" and before the JSX return
    // Structural check: useEffect appears before toast calls in the file
    const useEffectIdx = src.indexOf('React.useEffect');
    const toastSuccessIdx = src.indexOf('toast.success(');
    const toastInfoIdx = src.indexOf('toast.info(');
    assert.ok(useEffectIdx !== -1, 'React.useEffect not found in component');
    assert.ok(
      toastSuccessIdx > useEffectIdx,
      'toast.success appears before useEffect — toast must be called inside the effect',
    );
    assert.ok(
      toastInfoIdx > useEffectIdx,
      'toast.info appears before useEffect — toast must be called inside the effect',
    );
  });
});

// ── Block B: No toast on submitting (loader visible) ─────────────────────────

describe('20.B.5 — No toast fires during submitting (loader is the only feedback)', () => {
  it('executionStatus is null during submitting (toast cannot fire yet)', () => {
    const s = advanceToSubmitting();
    assert.equal(s.currentStep, 'submitting');
    assert.equal(s.executionStatus, null);
  });

  it('submitting step transitions directly to success, never back to validated on success', () => {
    const submitting = advanceToSubmitting();
    const success = prospectWizardReducer(submitting, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: '/prospects',
      status: 'created',
    });
    // submitting → success (not submitting → validated → success)
    assert.equal(submitting.currentStep, 'submitting');
    assert.equal(success.currentStep, 'success');
  });
});

// ── Regression: Block A + B do not interfere with error path ─────────────────

describe('20.R — Error path regression after Block A/B changes', () => {
  it('error after retry shows correct step and no spurious success state', () => {
    let s = advanceToValidated();

    // First attempt fails
    s = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    assert.equal(s.currentStep, 'submitting');

    s = prospectWizardReducer(s, {
      type: 'EXECUTION_FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
      message: 'No disponible.',
      retryable: true,
    });
    assert.equal(s.currentStep, 'validated');
    assert.equal(s.executionStatus, null);
    assert.ok(s.executionError !== null);

    // Second attempt succeeds
    s = prospectWizardReducer(s, { type: 'BEGIN_EXECUTION' });
    assert.equal(s.currentStep, 'submitting');
    assert.equal(s.executionError, null);

    s = prospectWizardReducer(s, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: '/prospects',
      status: 'created',
    });
    assert.equal(s.currentStep, 'success');
    assert.equal(s.executionStatus, 'created');
  });

  it('wizard-conversation-summary.tsx does not use toast.error (errors use inline UI, not toasts)', () => {
    const src = readComponentSrc();
    // Error feedback must go through the inline error banner in ValidatedPanel,
    // not through toast — to avoid toast stacking on retryable errors.
    assert.ok(
      !src.includes('toast.error('),
      'toast.error found — error handling must use inline UI, not toasts',
    );
  });
});
