/**
 * AGENT2-ROUTING-WIRE-1 — no-provider-selector + automatic-routing wiring.
 *
 * Two guards in one file:
 *
 *  1. Static source-text assertions on the wizard (and its reducer) proving the
 *     user can no longer choose a provider: no radio selector, no "Apollo o
 *     Lusha" copy, no provider-driven CTA branching, and the single CTA runs the
 *     automatic router. Same static technique as automatic-routing-wiring-
 *     static.test.ts (this repo has no live Apollo/Lusha/Postgres harness).
 *
 *  2. Pure reducer behavior for the new AUTOMATIC_ROUTING_* actions, covering
 *     the flag-on (search ran → pending_review), flag-off (safe "routing
 *     disabled" notice), and blocked (could-not-complete) outcomes.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  contactEnrichmentChatReducer,
  createInitialContactEnrichmentChatState,
} from '../contact-enrichment-chat-reducer';
import type { AutomaticRoutingUiResult } from '../contact-enrichment-chat-types';

const ROOT = process.cwd();
const wizardSource = readFileSync(
  join(ROOT, 'src/components/contact-enrichment/contact-enrichment-chat-wizard.tsx'),
  'utf-8',
);
const reducerSource = readFileSync(
  join(ROOT, 'src/components/contact-enrichment/contact-enrichment-chat-reducer.ts'),
  'utf-8',
);

// ── 1. No provider selector, no provider choice ──────────────────────────────

describe('Wizard exposes no provider selector', () => {
  it('renders no radio-based provider selector', () => {
    assert.doesNotMatch(wizardSource, /type="radio"/);
    assert.doesNotMatch(wizardSource, /name="enrichment-provider"/);
    assert.doesNotMatch(wizardSource, /function ProviderSelector/);
  });

  it('has no "choose a provider" copy (neither in the wizard nor the reducer)', () => {
    assert.doesNotMatch(wizardSource, /Apollo o Lusha/i);
    assert.doesNotMatch(wizardSource, /elige.*proveedor/i);
    assert.doesNotMatch(reducerSource, /Elige un proveedor/i);
    assert.doesNotMatch(reducerSource, /elige.*proveedor/i);
  });

  it('does not dispatch a provider selection from the UI', () => {
    assert.doesNotMatch(wizardSource, /SELECT_PROVIDER/);
  });

  it('does not offer manual per-provider CTAs', () => {
    assert.doesNotMatch(wizardSource, /Buscar contactos con Lusha/);
    assert.doesNotMatch(wizardSource, /selectedProvider === 'lusha' \? handleSearchLusha/);
  });
});

describe('Wizard CTA runs automatic routing', () => {
  it('shows the neutral "Buscar contactos con IA" CTA', () => {
    assert.match(wizardSource, /Buscar contactos con IA/);
  });

  it('the CTA is wired to the automatic-routing action + reducer actions', () => {
    assert.match(wizardSource, /runAutomaticContactEnrichmentForRequestAction/);
    assert.match(wizardSource, /AUTOMATIC_ROUTING_START/);
    assert.match(wizardSource, /AUTOMATIC_ROUTING_SETTLED/);
  });

  it('does not call the manual per-provider request actions', () => {
    assert.doesNotMatch(wizardSource, /runContactEnrichmentApolloForRequestAction/);
    assert.doesNotMatch(wizardSource, /runContactEnrichmentLushaForRequestAction/);
  });
});

describe('Phone policy is untouched by the wizard', () => {
  it('the wizard introduces no phone-reveal logic', () => {
    assert.doesNotMatch(wizardSource, /phone/i);
    assert.doesNotMatch(wizardSource, /revealPhone|phoneReveal|personal.*phone/i);
  });
});

// ── 2. Reducer behavior for the new actions ──────────────────────────────────

function doneStateWithRequest() {
  return contactEnrichmentChatReducer(createInitialContactEnrichmentChatState(), {
    type: 'REQUEST_CREATED',
    requestId: 'req-wire1',
  });
}

function automaticResult(overrides: Partial<AutomaticRoutingUiResult>): AutomaticRoutingUiResult {
  return {
    success: true,
    status: 'fallback_executed',
    automaticRoutingEnabled: true,
    fallbackExecuted: false,
    attempt1AttemptId: 'attempt-1',
    attempt2AttemptId: null,
    blockedReason: null,
    ...overrides,
  };
}

describe('AUTOMATIC_ROUTING_START', () => {
  it('moves done → searching_contacts and appends the user + assistant bubbles', () => {
    const done = doneStateWithRequest();
    const next = contactEnrichmentChatReducer(done, { type: 'AUTOMATIC_ROUTING_START' });
    assert.equal(next.step, 'searching_contacts');
    assert.equal(next.messages.length, done.messages.length + 2);
    assert.equal(next.messages.at(-2)?.content, 'Buscar contactos con IA');
  });

  it('is a no-op when not in the done step', () => {
    const initial = createInitialContactEnrichmentChatState();
    const next = contactEnrichmentChatReducer(initial, { type: 'AUTOMATIC_ROUTING_START' });
    assert.equal(next.step, initial.step);
  });
});

describe('AUTOMATIC_ROUTING_SETTLED', () => {
  it('flag ON + a search ran → done, result stored, pending-review copy (no error tone)', () => {
    const searching = contactEnrichmentChatReducer(doneStateWithRequest(), {
      type: 'AUTOMATIC_ROUTING_START',
    });
    const result = automaticResult({ automaticRoutingEnabled: true, attempt1AttemptId: 'a1' });
    const next = contactEnrichmentChatReducer(searching, { type: 'AUTOMATIC_ROUTING_SETTLED', result });
    assert.equal(next.step, 'done');
    assert.deepEqual(next.automaticResult, result);
    const last = next.messages.at(-1);
    assert.match(last?.content ?? '', /listos para tu revisión/);
    assert.match(last?.content ?? '', /requieren tu aprobación/);
    assert.equal(last?.tone, undefined);
  });

  it('flag OFF → done with a safe "routing disabled" notice (warning tone)', () => {
    const searching = contactEnrichmentChatReducer(doneStateWithRequest(), {
      type: 'AUTOMATIC_ROUTING_START',
    });
    const result = automaticResult({
      status: 'automatic_routing_disabled',
      automaticRoutingEnabled: false,
      attempt1AttemptId: null,
      blockedReason: 'automatic_routing_disabled',
    });
    const next = contactEnrichmentChatReducer(searching, { type: 'AUTOMATIC_ROUTING_SETTLED', result });
    assert.equal(next.step, 'done');
    assert.match(next.messages.at(-1)?.content ?? '', /no está activada/);
    assert.equal(next.messages.at(-1)?.tone, 'warning');
  });

  it('flag ON but blocked before any search → could-not-complete notice (warning tone)', () => {
    const searching = contactEnrichmentChatReducer(doneStateWithRequest(), {
      type: 'AUTOMATIC_ROUTING_START',
    });
    const result = automaticResult({
      status: 'fallback_provider_unavailable',
      automaticRoutingEnabled: true,
      attempt1AttemptId: null,
      blockedReason: 'fallback_provider_unavailable',
    });
    const next = contactEnrichmentChatReducer(searching, { type: 'AUTOMATIC_ROUTING_SETTLED', result });
    assert.equal(next.step, 'done');
    assert.match(next.messages.at(-1)?.content ?? '', /No fue posible completar/);
    assert.equal(next.messages.at(-1)?.tone, 'warning');
  });
});
