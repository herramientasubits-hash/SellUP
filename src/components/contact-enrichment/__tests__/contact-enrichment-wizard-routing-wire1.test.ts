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
  buildAutomaticRoutingMessage,
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
    reusedExistingCandidates: 0,
    providerCandidatesCreated: { apollo: 3, lusha: null },
    failedProviders: [],
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
    assert.match(last?.content ?? '', /^Encontré 3 contactos para revisar\. No creé contactos finales/);
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

// ── AGENT2A-ZERO-CANDIDATES-MESSAGE (backlog A3/A6) ──────────────────────────

describe('buildAutomaticRoutingMessage — total count only, sources named only when they fail', () => {
  it('candidates from Apollo + Lusha → one total, no source names', () => {
    const msg = buildAutomaticRoutingMessage(
      automaticResult({ status: 'fallback_executed', providerCandidatesCreated: { apollo: 1, lusha: 2 } }),
    );
    assert.equal(
      msg.content,
      'Encontré 3 contactos para revisar. No creé contactos finales: requieren tu aprobación.',
    );
    assert.doesNotMatch(msg.content, /Apollo|Lusha/);
    assert.equal(msg.tone, undefined);
  });

  it('singular when exactly one contact', () => {
    const msg = buildAutomaticRoutingMessage(
      automaticResult({ status: 'no_fallback_needed', providerCandidatesCreated: { apollo: 1, lusha: null } }),
    );
    assert.match(msg.content, /^Encontré 1 contacto para revisar\./);
  });

  it('candidates found but one source failed → count + "Fuente X falló."', () => {
    const msg = buildAutomaticRoutingMessage(
      automaticResult({
        status: 'fallback_executed',
        providerCandidatesCreated: { apollo: 2, lusha: 0 },
        failedProviders: ['Lusha'],
      }),
    );
    assert.match(msg.content, /^Encontré 2 contactos para revisar\./);
    assert.match(msg.content, /Fuente Lusha falló\.$/);
  });

  it('0 candidates and nothing pending → "No se encontraron contactos.", warning', () => {
    const msg = buildAutomaticRoutingMessage(
      automaticResult({ status: 'fallback_executed', providerCandidatesCreated: { apollo: 0, lusha: 0 } }),
    );
    assert.equal(msg.content, 'No se encontraron contactos.');
    assert.equal(msg.tone, 'warning');
  });

  it('0 candidates and Lusha unavailable → names the failed source at the end', () => {
    const msg = buildAutomaticRoutingMessage(
      automaticResult({
        status: 'fallback_provider_unavailable',
        providerCandidatesCreated: { apollo: 0, lusha: null },
        failedProviders: ['Lusha'],
      }),
    );
    assert.equal(msg.content, 'No se encontraron contactos. Fuente Lusha falló.');
    assert.equal(msg.tone, 'warning');
  });

  it('both sources failed → plural note', () => {
    const msg = buildAutomaticRoutingMessage(
      automaticResult({
        providerCandidatesCreated: { apollo: 0, lusha: 0 },
        failedProviders: ['Apollo', 'Lusha'],
      }),
    );
    assert.equal(msg.content, 'No se encontraron contactos. Fuentes Apollo y Lusha fallaron.');
  });

  it('0 new but pending candidates reused → tells how many are already waiting', () => {
    const msg = buildAutomaticRoutingMessage(
      automaticResult({
        status: 'fallback_skipped_local_reuse',
        reusedExistingCandidates: 2,
        providerCandidatesCreated: { apollo: 0, lusha: null },
      }),
    );
    assert.equal(
      msg.content,
      'Esta búsqueda no trajo contactos nuevos, pero ya tienes 2 contactos pendientes de revisión para esta empresa.',
    );
    assert.equal(msg.tone, undefined);
  });

  it('attempt exists but Apollo was never called → could-not-complete notice', () => {
    const msg = buildAutomaticRoutingMessage(
      automaticResult({
        status: 'attempt1_provider_not_called',
        providerCandidatesCreated: { apollo: null, lusha: null },
      }),
    );
    assert.match(msg.content, /No fue posible completar/);
    assert.equal(msg.tone, 'warning');
  });

  it('the reducer uses the same message on AUTOMATIC_ROUTING_SETTLED', () => {
    const searching = contactEnrichmentChatReducer(doneStateWithRequest(), {
      type: 'AUTOMATIC_ROUTING_START',
    });
    const result = automaticResult({ providerCandidatesCreated: { apollo: 0, lusha: 0 } });
    const next = contactEnrichmentChatReducer(searching, { type: 'AUTOMATIC_ROUTING_SETTLED', result });
    assert.equal(next.messages.at(-1)?.content, 'No se encontraron contactos.');
    assert.equal(next.messages.at(-1)?.tone, 'warning');
  });
});
