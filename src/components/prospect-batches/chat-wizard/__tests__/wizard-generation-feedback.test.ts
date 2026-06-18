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

describe('20.A.3 — SubmittingPanel source uses full gradient overlay (Hito 16AB.43.22)', () => {
  it('wizard-conversation-summary.tsx does NOT import AILoader (overlay replaces it)', () => {
    const src = readComponentSrc();
    assert.ok(
      !src.includes("import { AILoader }"),
      'AILoader import still present — SubmittingPanel must use WizardGenerationOverlay, not AILoader card',
    );
  });

  it('WizardGenerationOverlay is defined in wizard-conversation-summary.tsx', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('WizardGenerationOverlay'),
      'WizardGenerationOverlay not found — full gradient overlay must be defined',
    );
  });

  it('SubmittingPanel renders WizardGenerationOverlay (not AILoader card)', () => {
    const src = readComponentSrc();
    const panelStart = src.indexOf('function SubmittingPanel');
    const panelEnd = src.indexOf('\nfunction ', panelStart + 1);
    const panelSrc = panelEnd > panelStart ? src.slice(panelStart, panelEnd) : src.slice(panelStart);
    assert.ok(
      panelSrc.includes('WizardGenerationOverlay'),
      'SubmittingPanel does not render WizardGenerationOverlay — approved overlay must be used',
    );
    assert.ok(
      !panelSrc.includes('AILoader'),
      'AILoader still rendered inside SubmittingPanel — must be replaced with WizardGenerationOverlay',
    );
  });

  it('WizardGenerationOverlay has role="status" and aria-live="polite" for accessibility', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('role="status"'),
      'role="status" missing — screen readers will not announce the loader',
    );
    assert.ok(
      src.includes('aria-live="polite"'),
      'aria-live="polite" missing — screen readers will not announce generation start',
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

// ── Block A: Approved loader copy text (21.A) — Hito 16AB.43.21 ──────────────

describe('21.A.1 — SubmittingPanel uses approved overlay copy (Hito 16AB.43.22)', () => {
  it('overlay contains "Filtrando resultados y preparando candidatos para revisión"', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('Filtrando resultados y preparando candidatos para revisión'),
      'Approved overlay body text not found in WizardGenerationOverlay',
    );
  });

  it('overlay does NOT contain the old "filtrando duplicados" copy', () => {
    const src = readComponentSrc();
    assert.ok(
      !src.includes('filtrando duplicados'),
      'Old copy "filtrando duplicados" found — must be replaced with approved overlay text',
    );
  });

  it('overlay does NOT use AILoader description prop (no legacy card loader text)', () => {
    const src = readComponentSrc();
    assert.ok(
      !src.includes('Estamos buscando, filtrando y preparando resultados para tu revisión.'),
      'Legacy AILoader description text still present — SubmittingPanel must use the gradient overlay',
    );
  });
});

describe('21.A.2 — SubmittingPanel uses full gradient overlay, not bare spinner (Hito 16AB.43.22)', () => {
  it('SubmittingPanel does not use a bare Loader2 as primary feedback', () => {
    const src = readComponentSrc();
    const panelStart = src.indexOf('function SubmittingPanel');
    const panelEnd = src.indexOf('\nfunction ', panelStart + 1);
    const panelSrc = panelEnd > panelStart ? src.slice(panelStart, panelEnd) : src.slice(panelStart);
    const hasLoader2Only = panelSrc.includes('Loader2') && !panelSrc.includes('WizardGenerationOverlay');
    assert.ok(!hasLoader2Only, 'SubmittingPanel uses bare Loader2 without WizardGenerationOverlay — use full gradient overlay');
  });

  it('WizardGenerationOverlay uses su-ai-stop gradient tokens (full gradient background)', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('su-ai-stop'),
      'su-ai-stop gradient tokens not found in WizardGenerationOverlay — must use approved gradient background',
    );
  });

  it('WizardGenerationOverlay shows "Generando empresas candidatas" copy', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('Generando empresas candidatas'),
      '"Generando empresas candidatas" text not found in overlay',
    );
  });

  it('WizardGenerationOverlay shows "Procesando búsqueda con IA" copy', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('Procesando búsqueda con IA'),
      '"Procesando búsqueda con IA" text not found in overlay',
    );
  });

  it('WizardGenerationOverlay includes a progress indicator', () => {
    const src = readComponentSrc();
    const hasProgressBar = src.includes('progress') || src.includes('h-2 w-full rounded-full');
    assert.ok(hasProgressBar, 'No progress indicator found in WizardGenerationOverlay');
  });

  it('WizardGenerationOverlay includes mirror shine sweep animation (animate-su-mirror-shine)', () => {
    const src = readComponentSrc();
    assert.ok(
      src.includes('animate-su-mirror-shine'),
      'animate-su-mirror-shine not found — overlay must include mirror shine effect',
    );
  });
});

describe('21.A.3 — CTA button absent in submitting state (double-submit prevention)', () => {
  it('BEGIN_EXECUTION transitions state to submitting synchronously', () => {
    const validated = advanceToValidated();
    const submitting = prospectWizardReducer(validated, { type: 'BEGIN_EXECUTION' });
    assert.equal(submitting.currentStep, 'submitting');
  });

  it('cannot dispatch BEGIN_EXECUTION again from submitting (guard prevents double-submit)', () => {
    const submitting = advanceToSubmitting();
    // Dispatching BEGIN_EXECUTION from submitting should not change step
    // (the handleExecute guard checks currentStep === 'validated')
    const stillSubmitting = prospectWizardReducer(submitting, { type: 'BEGIN_EXECUTION' });
    assert.equal(stillSubmitting.currentStep, 'submitting');
  });

  it('state machine never returns to validated once submitting without explicit EXECUTION_FAILED', () => {
    const submitting = advanceToSubmitting();
    // Only EXECUTION_FAILED should take us back; success goes to success step
    const success = prospectWizardReducer(submitting, {
      type: 'EXECUTION_SUCCEEDED',
      batchId: BATCH_ID,
      redirectPath: '/prospects',
      status: 'created',
    });
    assert.equal(success.currentStep, 'success');
    assert.notEqual(success.currentStep, 'validated');
  });
});
