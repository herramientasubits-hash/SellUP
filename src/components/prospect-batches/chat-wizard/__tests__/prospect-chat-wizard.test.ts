// Tests for 16AB.35.2 — Chat-driven wizard UI logic
// Uses Node.js built-in test runner (no jest/vitest needed)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  prospectWizardReducer,
  createInitialProspectWizardState,
  getWizardProgress,
  canValidateWizard,
  buildExploratoryFormInput,
  deriveWizardMessages,
} from '@/modules/prospect-batches/chat-wizard';
import type {
  ProspectWizardState,
  WizardMessageContext,
} from '@/modules/prospect-batches/chat-wizard';
import {
  resolveGenerateProspectsExperience,
} from '@/components/prospect-batches/generate-ai-batch-experience';
import type { ActiveIndustryCatalog } from '@/modules/industry-catalog/types';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeInitial(): ProspectWizardState {
  return createInitialProspectWizardState({
    catalogVersion: 'v1',
    defaultRequestedCount: 25,
  });
}

const STUB_CATALOG: ActiveIndustryCatalog = {
  version: 'v1',
  industries: [
    { id: 'ind-1', name: 'Tecnología', slug: 'tecnologia', description: null, sortOrder: 1 },
    { id: 'ind-2', name: 'Finanzas', slug: 'finanzas', description: null, sortOrder: 2 },
  ],
  subindustries: [
    {
      id: 'sub-1',
      name: 'SaaS',
      slug: 'saas',
      description: null,
      industryId: 'ind-1',
      applicableCountries: null,
      sortOrder: 1,
    },
    {
      id: 'sub-2',
      name: 'Fintech Colombia',
      slug: 'fintech-colombia',
      description: null,
      industryId: 'ind-2',
      applicableCountries: ['CO'],
      sortOrder: 2,
    },
  ],
};

const MSG_CTX: WizardMessageContext = {
  countries: [
    { code: 'CO', name: 'Colombia' },
    { code: 'MX', name: 'México' },
  ],
  industries: STUB_CATALOG.industries.map((i) => ({ id: i.id, name: i.name })),
  subindustries: STUB_CATALOG.subindustries.map((s) => ({
    id: s.id,
    name: s.name,
  })),
};

// Helper: advance wizard to a given step by dispatching the minimum actions
function advanceTo(step: string): ProspectWizardState {
  let s = makeInitial();
  if (step === 'welcome') return s;

  s = prospectWizardReducer(s, { type: 'START' });
  if (step === 'search_type') return s;

  s = prospectWizardReducer(s, { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' });
  if (step === 'country') return s;

  s = prospectWizardReducer(s, { type: 'SELECT_COUNTRY', countryCode: 'CO' });
  if (step === 'industry') return s;

  s = prospectWizardReducer(s, { type: 'SELECT_INDUSTRY', industryId: 'ind-1' });
  if (step === 'subindustries') return s;

  s = prospectWizardReducer(s, { type: 'SKIP_SUBINDUSTRIES' });
  if (step === 'additional_criteria') return s;

  s = prospectWizardReducer(s, { type: 'SKIP_ADDITIONAL_CRITERIA' });
  if (step === 'requested_count') return s;

  s = prospectWizardReducer(s, { type: 'SET_REQUESTED_COUNT', value: 25 });
  if (step === 'summary') return s;

  return s;
}

// ── resolveGenerateProspectsExperience ─────────────────────────────────────────

describe('resolveGenerateProspectsExperience', () => {
  test('returns chat_wizard when chatWizardEnabled and catalog present', () => {
    const exp = resolveGenerateProspectsExperience(true, false, STUB_CATALOG);
    assert.equal(exp, 'chat_wizard');
  });

  test('chat_wizard takes precedence over v2 when both enabled', () => {
    const exp = resolveGenerateProspectsExperience(true, true, STUB_CATALOG);
    assert.equal(exp, 'chat_wizard');
  });

  test('returns exploratory_form_v2 when only v2 enabled and catalog present', () => {
    const exp = resolveGenerateProspectsExperience(false, true, STUB_CATALOG);
    assert.equal(exp, 'exploratory_form_v2');
  });

  test('returns legacy when chatWizard flag on but catalog is null', () => {
    const exp = resolveGenerateProspectsExperience(true, true, null);
    assert.equal(exp, 'legacy');
  });

  test('returns legacy when all flags off', () => {
    const exp = resolveGenerateProspectsExperience(false, false, STUB_CATALOG);
    assert.equal(exp, 'legacy');
  });
});

// ── Initial state ──────────────────────────────────────────────────────────────

describe('createInitialProspectWizardState', () => {
  test('starts at welcome step', () => {
    const s = makeInitial();
    assert.equal(s.currentStep, 'welcome');
  });

  test('defaultRequestedCount set on initial state', () => {
    const s = makeInitial();
    assert.equal(s.requestedCount, 25);
  });

  test('no blocking issues on initial state', () => {
    const s = makeInitial();
    assert.equal(s.blockingIssues.length, 0);
  });
});

// ── START transition ───────────────────────────────────────────────────────────

describe('START action', () => {
  test('moves from welcome to search_type', () => {
    const s = prospectWizardReducer(makeInitial(), { type: 'START' });
    assert.equal(s.currentStep, 'search_type');
  });
});

// ── SELECT_SEARCH_MODE ─────────────────────────────────────────────────────────

describe('SELECT_SEARCH_MODE action', () => {
  test('exploratory mode advances to country', () => {
    const s = advanceTo('search_type');
    const next = prospectWizardReducer(s, { type: 'SELECT_SEARCH_MODE', mode: 'exploratory' });
    assert.equal(next.currentStep, 'country');
    assert.equal(next.searchMode, 'exploratory');
  });

  test('coming_soon mode adds warning and stays on search_type', () => {
    const s = advanceTo('search_type');
    const next = prospectWizardReducer(s, {
      type: 'SELECT_SEARCH_MODE',
      mode: 'competitors',
    });
    assert.equal(next.currentStep, 'search_type');
    const warning = next.warnings.find((w) => w.code === 'MODE_COMING_SOON');
    assert.ok(warning, 'Expected MODE_COMING_SOON warning');
  });
});

// ── SELECT_COUNTRY ─────────────────────────────────────────────────────────────

describe('SELECT_COUNTRY action', () => {
  test('sets country and advances to industry', () => {
    const s = advanceTo('country');
    const next = prospectWizardReducer(s, {
      type: 'SELECT_COUNTRY',
      countryCode: 'MX',
    });
    assert.equal(next.countryCode, 'MX');
    assert.equal(next.currentStep, 'industry');
  });
});

// ── RECONCILE_COUNTRY_SUBINDUSTRIES ───────────────────────────────────────────

describe('RECONCILE_COUNTRY_SUBINDUSTRIES action', () => {
  test('removes incompatible subindustry ids from state', () => {
    let s = advanceTo('country');
    s = prospectWizardReducer(s, { type: 'SELECT_COUNTRY', countryCode: 'CO' });
    s = prospectWizardReducer(s, { type: 'SELECT_INDUSTRY', industryId: 'ind-2' });
    // Pretend sub-2 was selected then country changed to MX
    s = { ...s, subindustryIds: ['sub-2'] };
    const next = prospectWizardReducer(s, {
      type: 'RECONCILE_COUNTRY_SUBINDUSTRIES',
      compatibleSubindustryIds: [],
    });
    assert.equal(next.subindustryIds.length, 0);
  });
});

// ── SKIP_SUBINDUSTRIES ────────────────────────────────────────────────────────

describe('SKIP_SUBINDUSTRIES action', () => {
  test('skipping subindustries moves to additional_criteria', () => {
    const s = advanceTo('subindustries');
    const next = prospectWizardReducer(s, { type: 'SKIP_SUBINDUSTRIES' });
    assert.equal(next.currentStep, 'additional_criteria');
    assert.equal(next.subindustryIds.length, 0);
  });
});

// ── SET_SUBINDUSTRIES ─────────────────────────────────────────────────────────

describe('SET_SUBINDUSTRIES action', () => {
  test('setting subindustries advances to additional_criteria', () => {
    const s = advanceTo('subindustries');
    const next = prospectWizardReducer(s, {
      type: 'SET_SUBINDUSTRIES',
      subindustryIds: ['sub-1'],
    });
    assert.equal(next.currentStep, 'additional_criteria');
    assert.deepEqual(next.subindustryIds, ['sub-1']);
  });
});

// ── SKIP_ADDITIONAL_CRITERIA ──────────────────────────────────────────────────

describe('SKIP_ADDITIONAL_CRITERIA action', () => {
  test('skip advances to requested_count', () => {
    const s = advanceTo('additional_criteria');
    const next = prospectWizardReducer(s, { type: 'SKIP_ADDITIONAL_CRITERIA' });
    assert.equal(next.currentStep, 'requested_count');
    assert.equal(next.additionalCriteriaRaw, null);
  });
});

// ── SET_REQUESTED_COUNT ───────────────────────────────────────────────────────

describe('SET_REQUESTED_COUNT action', () => {
  test('sets count and advances to summary', () => {
    const s = advanceTo('requested_count');
    const next = prospectWizardReducer(s, {
      type: 'SET_REQUESTED_COUNT',
      value: 10,
    });
    assert.equal(next.currentStep, 'summary');
    assert.equal(next.requestedCount, 10);
  });
});

// ── EDIT_STEP ─────────────────────────────────────────────────────────────────

describe('EDIT_STEP action', () => {
  test('navigates back to country from summary', () => {
    const s = advanceTo('summary');
    const next = prospectWizardReducer(s, {
      type: 'EDIT_STEP',
      step: 'country',
    });
    assert.equal(next.currentStep, 'country');
  });

  test('navigates back to industry from summary', () => {
    const s = advanceTo('summary');
    const next = prospectWizardReducer(s, {
      type: 'EDIT_STEP',
      step: 'industry',
    });
    assert.equal(next.currentStep, 'industry');
  });
});

// ── REQUEST_RESTART / CONFIRM_RESTART / CANCEL_RESTART ───────────────────────

describe('Restart flow', () => {
  test('REQUEST_RESTART sets restartConfirmationRequired', () => {
    const s = advanceTo('summary');
    const next = prospectWizardReducer(s, { type: 'REQUEST_RESTART' });
    assert.equal(next.restartConfirmationRequired, true);
  });

  test('CANCEL_RESTART clears restartConfirmationRequired', () => {
    let s = advanceTo('summary');
    s = prospectWizardReducer(s, { type: 'REQUEST_RESTART' });
    const next = prospectWizardReducer(s, { type: 'CANCEL_RESTART' });
    assert.equal(next.restartConfirmationRequired, false);
    assert.equal(next.currentStep, 'summary');
  });

  test('CONFIRM_RESTART resets to welcome', () => {
    let s = advanceTo('summary');
    s = prospectWizardReducer(s, { type: 'REQUEST_RESTART' });
    const next = prospectWizardReducer(s, { type: 'CONFIRM_RESTART' });
    assert.equal(next.currentStep, 'welcome');
    assert.equal(next.countryCode, null);
    assert.equal(next.industryId, null);
  });
});

// ── BEGIN_VALIDATION / VALIDATION_SUCCEEDED / VALIDATION_FAILED ──────────────

describe('Validation transitions', () => {
  test('BEGIN_VALIDATION moves to validating', () => {
    const s = advanceTo('summary');
    const next = prospectWizardReducer(s, { type: 'BEGIN_VALIDATION' });
    assert.equal(next.currentStep, 'validating');
  });

  test('VALIDATION_SUCCEEDED moves to validated', () => {
    let s = advanceTo('summary');
    s = prospectWizardReducer(s, { type: 'BEGIN_VALIDATION' });
    const next = prospectWizardReducer(s, { type: 'VALIDATION_SUCCEEDED' });
    assert.equal(next.currentStep, 'validated');
  });

  test('VALIDATION_FAILED with blocking issues moves to blocked', () => {
    let s = advanceTo('summary');
    s = prospectWizardReducer(s, { type: 'BEGIN_VALIDATION' });
    const next = prospectWizardReducer(s, {
      type: 'VALIDATION_FAILED',
      warnings: [],
      blockingIssues: [
        {
          code: 'SERVER_VALIDATION_FAILED',
          step: 'summary',
          message: 'Error de validación',
          recoverable: true,
        },
      ],
    });
    assert.equal(next.currentStep, 'blocked');
    assert.equal(next.blockingIssues.length, 1);
  });
});

// ── getWizardProgress ─────────────────────────────────────────────────────────

describe('getWizardProgress', () => {
  test('welcome step has 0% progress', () => {
    const p = getWizardProgress(makeInitial());
    assert.equal(p.percentage, 0);
  });

  test('summary step has 100% progress', () => {
    const s = advanceTo('summary');
    const p = getWizardProgress(s);
    assert.ok(p.percentage >= 100, `Expected 100%, got ${p.percentage}%`);
  });

  test('progress increases with each step', () => {
    const stepOrder = [
      'welcome',
      'search_type',
      'country',
      'industry',
      'subindustries',
      'additional_criteria',
      'requested_count',
      'summary',
    ] as const;
    let prev = -1;
    for (const step of stepOrder) {
      const s = advanceTo(step);
      const p = getWizardProgress(s);
      assert.ok(
        p.percentage >= prev,
        `Progress went backwards at step ${step}: ${p.percentage} < ${prev}`,
      );
      prev = p.percentage;
    }
  });
});

// ── canValidateWizard ─────────────────────────────────────────────────────────

describe('canValidateWizard', () => {
  test('returns false before summary step', () => {
    const s = advanceTo('country');
    assert.equal(canValidateWizard(s), false);
  });

  test('returns true at summary step with all required fields', () => {
    const s = advanceTo('summary');
    assert.equal(canValidateWizard(s), true);
  });
});

// ── buildExploratoryFormInput ─────────────────────────────────────────────────

describe('buildExploratoryFormInput', () => {
  test('returns null when wizard is incomplete', () => {
    const s = advanceTo('country');
    assert.equal(buildExploratoryFormInput(s), null);
  });

  test('returns valid payload at summary step', () => {
    const s = advanceTo('summary');
    const payload = buildExploratoryFormInput(s);
    assert.ok(payload !== null, 'Expected non-null payload at summary');
    assert.equal(payload?.countryCode, 'CO');
    assert.equal(payload?.industryId, 'ind-1');
    assert.equal(payload?.requestedCount, 25);
  });
});

// ── deriveWizardMessages ──────────────────────────────────────────────────────

describe('deriveWizardMessages', () => {
  test('returns empty array at welcome step', () => {
    const msgs = deriveWizardMessages(makeInitial(), MSG_CTX);
    assert.equal(msgs.length, 0);
  });

  test('returns messages after advancing past welcome', () => {
    const s = advanceTo('search_type');
    const msgs = deriveWizardMessages(s, MSG_CTX);
    assert.ok(msgs.length > 0, 'Expected messages after START');
  });

  test('includes user message with country name after country selection', () => {
    const s = advanceTo('industry');
    const msgs = deriveWizardMessages(s, MSG_CTX);
    const userMsgs = msgs.filter((m) => m.role === 'user');
    const hasColombia = userMsgs.some((m) => m.content.includes('Colombia'));
    assert.ok(hasColombia, 'Expected a user message mentioning Colombia');
  });

  test('all derived messages have unique ids', () => {
    const s = advanceTo('summary');
    const msgs = deriveWizardMessages(s, MSG_CTX);
    const ids = msgs.map((m) => m.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, 'Expected all message ids to be unique');
  });
});
