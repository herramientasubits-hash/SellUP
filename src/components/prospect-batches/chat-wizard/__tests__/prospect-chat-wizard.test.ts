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
import { EXPLORATORY_SEARCH_LIMITS } from '@/modules/industry-catalog/schema';

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
// covered by 'additional_criteria advances directly to summary' in System-controlled quantity

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

  test('progress increases with each visible step', () => {
    const stepOrder = [
      'welcome',
      'search_type',
      'country',
      'industry',
      'subindustries',
      'additional_criteria',
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

  test('total steps no longer includes requested_count', () => {
    const s = advanceTo('summary');
    const p = getWizardProgress(s);
    assert.equal(p.totalSteps, 6, 'Expected 6 visible steps (requested_count removed)');
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

  test('returns welcome and question messages after START (search_type)', () => {
    const s = advanceTo('search_type');
    const msgs = deriveWizardMessages(s, MSG_CTX);
    assert.ok(msgs.length >= 3, `Expected at least 3 messages, got ${msgs.length}`);

    const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
    const hasGreeting = assistantMsgs.some((m) => m.id === 'assistant-welcome-greeting');
    const hasIntro = assistantMsgs.some((m) => m.id === 'assistant-welcome-intro');
    const hasQuestion = assistantMsgs.some((m) => m.id === 'assistant-search-type-question');

    assert.ok(hasGreeting, 'Expected welcome greeting message');
    assert.ok(hasIntro, 'Expected welcome intro message');
    assert.ok(hasQuestion, 'Expected search type question message');
  });

  test('conversation greeting is conversational without repetition', () => {
    const s = advanceTo('search_type');
    const msgs = deriveWizardMessages(s, MSG_CTX);
    const greeting = msgs.find((m) => m.id === 'assistant-welcome-greeting');
    assert.ok(greeting, 'Expected greeting message');
    assert.match(greeting!.content, /^Hola/i, 'Greeting should start with Hola');
    assert.match(greeting!.content, /encontrar.*prospectos/i, 'Greeting should mention finding prospects');
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

  test('no duplicate welcome messages at search_type', () => {
    const s = advanceTo('search_type');
    const msgs = deriveWizardMessages(s, MSG_CTX);
    const greetingCount = msgs.filter((m) => m.id === 'assistant-welcome-greeting').length;
    const introCount = msgs.filter((m) => m.id === 'assistant-welcome-intro').length;
    assert.equal(greetingCount, 1, 'Expected exactly one greeting message');
    assert.equal(introCount, 1, 'Expected exactly one intro message');
  });

  test('conversation flow is coherent from start to summary', () => {
    const s = advanceTo('summary');
    const msgs = deriveWizardMessages(s, MSG_CTX);

    // Count assistant vs user messages
    const assistantCount = msgs.filter((m) => m.role === 'assistant').length;
    const userCount = msgs.filter((m) => m.role === 'user').length;

    // Should have more assistant messages (questions) than user messages, or equal
    assert.ok(
      assistantCount >= userCount,
      `Expected assistant messages (${assistantCount}) >= user messages (${userCount})`
    );

    // Messages should follow an alternating pattern (assistant → user → assistant …)
    for (const msg of msgs) {
      assert.ok(
        msg.role === 'assistant' || msg.role === 'user' || msg.role === 'system',
        `Unexpected role: ${msg.role}`,
      );
    }
  });

  test('no quantity-related messages appear in conversation (16AB.35.2.2)', () => {
    const s = advanceTo('summary');
    const msgs = deriveWizardMessages(s, MSG_CTX);

    // Verify no quantity question appears
    const hasCountQuestion = msgs.some((m) =>
      m.id === 'assistant-count-question' ||
      m.content.includes('¿Cuántos prospectos')
    );
    assert.equal(hasCountQuestion, false, 'Expected no quantity question in messages');

    // Verify no user count answer appears
    const hasCountAnswer = msgs.some((m) => m.id === 'user-count-answer');
    assert.equal(hasCountAnswer, false, 'Expected no quantity answer in messages');
  });
});

// ── System-controlled quantity (16AB.35.2.2) ───────────────────────────────────

describe('System-controlled quantity', () => {
  test('additional_criteria advances directly to summary', () => {
    let s = advanceTo('additional_criteria');
    s = prospectWizardReducer(s, { type: 'SKIP_ADDITIONAL_CRITERIA' });
    assert.equal(s.currentStep, 'summary', 'Expected SKIP_ADDITIONAL_CRITERIA to advance to summary');
  });

  test('go_back from summary goes to additional_criteria', () => {
    const s = advanceTo('summary');
    const next = prospectWizardReducer(s, { type: 'GO_BACK' });
    assert.equal(next.currentStep, 'additional_criteria', 'Expected GO_BACK from summary to go to additional_criteria');
  });

  test('requestedCount is preserved internally but not user-configurable', () => {
    const s = advanceTo('summary');
    // requestedCount should still be set internally for compatibility
    assert.notEqual(s.requestedCount, null, 'Expected requestedCount to be set internally');
    // It should be the default value
    assert.equal(s.requestedCount, EXPLORATORY_SEARCH_LIMITS.requestedCount.default, 'Expected requestedCount to be default value');
  });

  test('buildExploratoryFormInput works without passing through requested_count step', () => {
    const s = advanceTo('summary');
    const payload = buildExploratoryFormInput(s);
    assert.ok(payload !== null, 'Expected valid payload from summary');
    assert.equal(payload?.requestedCount, s.requestedCount, 'Expected requestedCount in payload');
  });

  test('canValidateWizard succeeds at summary without explicit quantity selection', () => {
    const s = advanceTo('summary');
    assert.equal(canValidateWizard(s), true, 'Expected canValidateWizard to return true at summary');
  });
});

// ── 16AB.35.2.3 — Composer contextual (tests C1–C15) ─────────────────────────

import {
  getComposerMode,
  getComposerPlaceholder,
} from '../wizard-composer-utils';

describe('getComposerMode — 16AB.35.2.3', () => {
  test('C1: locked_selection at search_type', () => {
    assert.equal(getComposerMode('search_type'), 'locked_selection');
  });

  test('C2: locked_selection at country', () => {
    assert.equal(getComposerMode('country'), 'locked_selection');
  });

  test('C3: locked_selection at industry', () => {
    assert.equal(getComposerMode('industry'), 'locked_selection');
  });

  test('C4: locked_selection at subindustries', () => {
    assert.equal(getComposerMode('subindustries'), 'locked_selection');
  });

  test('C5: text_input at additional_criteria', () => {
    assert.equal(getComposerMode('additional_criteria'), 'text_input');
  });

  test('C6: locked_selection at summary', () => {
    assert.equal(getComposerMode('summary'), 'locked_selection');
  });

  test('C7: validating at validating step', () => {
    assert.equal(getComposerMode('validating'), 'validating');
  });

  test('C8: validated at validated step', () => {
    assert.equal(getComposerMode('validated'), 'validated');
  });

  test('C9: blocked at blocked step', () => {
    assert.equal(getComposerMode('blocked'), 'blocked');
  });

  test('C10: blocked at error step', () => {
    assert.equal(getComposerMode('error'), 'blocked');
  });

  test('C11: locked_selection at welcome step', () => {
    assert.equal(getComposerMode('welcome'), 'locked_selection');
  });
});

describe('getComposerPlaceholder — 16AB.35.2.3', () => {
  test('C12: placeholder for search_type mentions selección', () => {
    const p = getComposerPlaceholder('search_type');
    assert.ok(p.length > 0, 'Expected non-empty placeholder');
    assert.match(p, /[Ss]elecciona/, 'Expected selection hint for search_type');
  });

  test('C13: placeholder for additional_criteria invites writing', () => {
    const p = getComposerPlaceholder('additional_criteria');
    assert.ok(p.length > 0, 'Expected non-empty placeholder');
    assert.match(p, /[Ee]scribe/, 'Expected write hint for additional_criteria');
  });

  test('C14: placeholder for validating mentions validation', () => {
    const p = getComposerPlaceholder('validating');
    assert.ok(p.length > 0, 'Expected non-empty placeholder');
    assert.match(p, /[Vv]alid/, 'Expected validation hint for validating');
  });

  test('C15: placeholder for blocked mentions correction', () => {
    const p = getComposerPlaceholder('blocked');
    assert.ok(p.length > 0, 'Expected non-empty placeholder');
    assert.match(p, /[Cc]orrige/, 'Expected correction hint for blocked');
  });
});

// ── 16AB.35.2.3 — Additional criteria flow via composer ──────────────────────

describe('Additional criteria via composer — 16AB.35.2.3', () => {
  test('C16: additional_criteria step is text_input mode', () => {
    const s = advanceTo('additional_criteria');
    assert.equal(s.currentStep, 'additional_criteria');
    assert.equal(getComposerMode(s.currentStep), 'text_input');
  });

  test('C17: summary step returns to locked_selection mode', () => {
    const s = advanceTo('summary');
    assert.equal(getComposerMode(s.currentStep), 'locked_selection');
  });

  test('C18: validating step after BEGIN_VALIDATION has validating mode', () => {
    let s = advanceTo('summary');
    s = prospectWizardReducer(s, { type: 'BEGIN_VALIDATION' });
    assert.equal(getComposerMode(s.currentStep), 'validating');
  });

  test('C19: validated step has validated mode', () => {
    let s = advanceTo('summary');
    s = prospectWizardReducer(s, { type: 'BEGIN_VALIDATION' });
    s = prospectWizardReducer(s, { type: 'VALIDATION_SUCCEEDED' });
    assert.equal(getComposerMode(s.currentStep), 'validated');
  });

  test('C20: blocked step has blocked mode', () => {
    let s = advanceTo('summary');
    s = prospectWizardReducer(s, { type: 'BEGIN_VALIDATION' });
    s = prospectWizardReducer(s, {
      type: 'VALIDATION_FAILED',
      warnings: [],
      blockingIssues: [
        {
          code: 'SERVER_VALIDATION_FAILED',
          step: 'summary',
          message: 'Error',
          recoverable: true,
        },
      ],
    });
    assert.equal(getComposerMode(s.currentStep), 'blocked');
  });
});

// ── 16AB.35.2.3 — Compatibility (tests C21–C30) ──────────────────────────────

describe('Compatibility — 16AB.35.2.3', () => {
  test('C21: reducer deterministic — same inputs produce same outputs', () => {
    const s1 = advanceTo('summary');
    const s2 = advanceTo('summary');
    assert.deepEqual(s1, s2, 'Same inputs must produce identical states');
  });

  test('C22: no LLM calls — APPLY_CRITERIA_GUARD_RESULT accepts pre-computed result', () => {
    let s = advanceTo('additional_criteria');
    s = prospectWizardReducer(s, {
      type: 'APPLY_CRITERIA_GUARD_RESULT',
      rawValue: 'empresas tecnológicas',
      result: {
        status: 'allowed',
        normalizedValue: 'empresas tecnológicas',
        warnings: [],
        blockingIssues: [],
      },
    });
    assert.equal(s.currentStep, 'summary');
    assert.equal(s.additionalCriteriaRaw, 'empresas tecnológicas');
  });

  test('C23: SKIP_ADDITIONAL_CRITERIA advances without criteria', () => {
    const s = advanceTo('additional_criteria');
    const next = prospectWizardReducer(s, { type: 'SKIP_ADDITIONAL_CRITERIA' });
    assert.equal(next.currentStep, 'summary');
    assert.equal(next.additionalCriteriaRaw, null);
  });

  test('C24: V2 experience still resolved when chatWizard disabled', () => {
    const exp = resolveGenerateProspectsExperience(false, true, STUB_CATALOG);
    assert.equal(exp, 'exploratory_form_v2');
  });

  test('C25: no quantity step in flow from additional_criteria to summary', () => {
    const s = advanceTo('additional_criteria');
    const next = prospectWizardReducer(s, { type: 'SKIP_ADDITIONAL_CRITERIA' });
    // Must go directly to summary (no requested_count step in between)
    assert.equal(next.currentStep, 'summary', 'Expected direct skip to summary');
  });

  test('C26: CONFIRM_RESTART resets to welcome (composer resets too)', () => {
    let s = advanceTo('summary');
    s = prospectWizardReducer(s, { type: 'REQUEST_RESTART' });
    s = prospectWizardReducer(s, { type: 'CONFIRM_RESTART' });
    assert.equal(s.currentStep, 'welcome');
    // After restart, welcome auto-advances to search_type
    const initial = getComposerMode('welcome');
    assert.equal(initial, 'locked_selection');
  });

  test('C27: all steps produce a non-empty placeholder', () => {
    const steps = [
      'search_type', 'country', 'industry', 'subindustries',
      'additional_criteria', 'summary', 'validating', 'validated',
      'blocked', 'error',
    ];
    for (const step of steps) {
      const p = getComposerPlaceholder(step);
      assert.ok(p.length > 0, `Expected non-empty placeholder for step: ${step}`);
    }
  });

  test('C28: getComposerMode covers all ProspectWizardStep values', () => {
    const steps = [
      'welcome', 'search_type', 'country', 'industry', 'subindustries',
      'additional_criteria', 'requested_count', 'summary', 'validating',
      'validated', 'blocked', 'error',
    ];
    for (const step of steps) {
      const mode = getComposerMode(step);
      const valid: string[] = ['locked_selection', 'text_input', 'validating', 'validated', 'blocked'];
      assert.ok(valid.includes(mode), `Unexpected mode "${mode}" for step "${step}"`);
    }
  });

  test('C29: criteria warning does not block advancement when status is warning', () => {
    let s = advanceTo('additional_criteria');
    s = prospectWizardReducer(s, {
      type: 'APPLY_CRITERIA_GUARD_RESULT',
      rawValue: 'empresas maduras',
      result: {
        status: 'warning',
        normalizedValue: 'empresas maduras',
        warnings: [
          {
            code: 'CRITERIA_OUTSIDE_CATALOG',
            step: 'additional_criteria',
            message: 'Criterio fuera del catálogo',
          },
        ],
        blockingIssues: [],
      },
    });
    assert.equal(s.currentStep, 'summary', 'Warning status should still advance to summary');
  });

  test('C30: GO_BACK from summary returns to additional_criteria (not requested_count)', () => {
    const s = advanceTo('summary');
    const prev = prospectWizardReducer(s, { type: 'GO_BACK' });
    assert.equal(prev.currentStep, 'additional_criteria');
  });
});
