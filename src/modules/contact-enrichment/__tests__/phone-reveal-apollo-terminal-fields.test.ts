/**
 * phone-reveal-apollo-terminal-fields.test.ts — AGENT2A-PHONE-REVEAL-4N § 6
 *
 * Paridad de persistencia del camino Apollo. Antes de este hito el camino Lusha escribía
 * `phone_revealed_at` y `phone_reveal_cost_source` y el de Apollo NO, así que un candidato
 * revelado por Apollo quedaba sin fecha de revelación y sin procedencia de su costo — el
 * hueco que la corrida live `cec34235` dejó a la vista.
 *
 * Las dos verdades se prueban por separado, porque son distintas y llegan en momentos
 * distintos:
 *
 *   * la del PROVEEDOR — lo que Apollo dijo — la escribe el webhook (`reported` / `unknown`);
 *   * la ECONÓMICA — lo que la plataforma contabilizó — la escribe la liquidación de la
 *     reserva (`assumed_cap` con el tope, cuando Apollo no reportó nada).
 *
 * Offline por completo: 0 red, 0 Supabase, 0 Apollo, 0 créditos.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloPhoneRevealWebhook,
  type ApolloPhoneRevealWebhookDeps,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
  type WebhookRevealPersistencePatch,
  type WebhookUsageLogEntry,
} from '../phone-reveal-webhook-core';
import {
  decidePhoneRevealCreditSettlement,
  resolvePhoneRevealSettledLegCost,
  type PhoneRevealCreditReservedLeg,
} from '../phone-reveal-credit-reservation-core';

const NOW = '2026-08-06T10:00:00.000Z';
const TOKEN = 'webhook-secret-token';
const REQUEST_ID = 'apollo-req-4n';
const MOBILE = '+573001112233';
/** Apollo person id sintético (24 hex), opaco e inventado. Necesario para que la
 * comprobación de supresión en vuelo sea evaluable (AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1):
 * sin él el gate ahora bloquea (`not_evaluable` ⇒ fail-closed) y el webhook no
 * llega a persistir. Este archivo prueba la paridad de campos terminales del
 * camino Apollo (§ 6), no la resolución de identidad de la supresión. */
const PERSON_ID = '4d5e6f7a8b9c0d1e2f3a4b5c';

interface Capture {
  persisted: Array<{ id: string; patch: WebhookRevealPersistencePatch }>;
  logs: WebhookUsageLogEntry[];
}

let cap: Capture;
beforeEach(() => {
  cap = { persisted: [], logs: [] };
});

function deps(candidate: WebhookCandidateRecord | null): ApolloPhoneRevealWebhookDeps {
  return {
    expectedToken: TOKEN,
    nowIso: NOW,
    loadCandidateByRequestId: async () => candidate,
    persist: async (id, patch) => {
      cap.persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      cap.logs.push(entry);
    },
    // Sin tombstone para esta persona: la supresión se evalúa y sale `allowed`,
    // que es la precondición para que estos casos lleguen a persistir.
    lookupPhoneCacheSuppression: async () => null,
  };
}

function candidate(): WebhookCandidateRecord {
  return {
    id: 'cand-4n',
    accountId: 'acct-4n',
    enrichmentMetadata: {},
    phoneRevealStatus: 'requested',
    apolloPersonId: PERSON_ID,
  };
}

async function runWebhook(payload: ApolloPhoneRevealWebhookPayload) {
  return runApolloPhoneRevealWebhook(
    { tokenProvided: TOKEN, payload },
    deps(candidate()),
  );
}

// ── El webhook: verdad del PROVEEDOR ───────────────────────────

describe('§6 — el webhook de Apollo fecha la revelación', () => {
  it('un reveal con teléfono escribe phone_revealed_at', async () => {
    const result = await runWebhook({
      request_id: REQUEST_ID,
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
    });

    assert.equal(result.outcome, 'revealed');
    const [{ patch }] = cap.persisted;
    assert.equal(patch.phone_revealed_at, NOW);
    assert.equal(patch.phone_reveal_completed_at, NOW);
  });

  it('no_phone_found NO fecha nada: no hubo revelación', async () => {
    const result = await runWebhook({ request_id: REQUEST_ID, phone_numbers: [] });

    assert.equal(result.outcome, 'no_phone_found');
    const [{ patch }] = cap.persisted;
    // Ausente, no null: el wrapper solo escribe la columna cuando el campo viene, así que
    // un no_phone_found no puede borrar la fecha de un reveal anterior.
    assert.equal(patch.phone_revealed_at, undefined);
    assert.equal(patch.phone_reveal_completed_at, NOW);
  });
});

describe('§6 — el webhook declara la procedencia del costo', () => {
  it('Apollo sin créditos reportados ⇒ unknown, nunca assumed_cap', async () => {
    // Es el caso REAL: los usage logs de Apollo llevan credits_used NULL. El webhook no
    // puede afirmar un tope que nadie le dijo; eso lo decide la liquidación.
    await runWebhook({
      request_id: REQUEST_ID,
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
    });

    const [{ patch }] = cap.persisted;
    assert.equal(patch.phone_reveal_cost_credits, null);
    assert.equal(patch.phone_reveal_cost_source, 'unknown');
    assert.notEqual(patch.phone_reveal_cost_source, 'assumed_cap');
  });

  it('Apollo con créditos reportados ⇒ reported y la cifra reportada', async () => {
    // `credits_consumed` viaja POR TELÉFONO en el payload de Apollo, no en la raíz.
    await runWebhook({
      request_id: REQUEST_ID,
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 8 }],
    });

    const [{ patch }] = cap.persisted;
    assert.equal(patch.phone_reveal_cost_credits, 8);
    assert.equal(patch.phone_reveal_cost_source, 'reported');
  });

  it('no_phone_found también declara la procedencia', async () => {
    await runWebhook({ request_id: REQUEST_ID, phone_numbers: [] });

    const [{ patch }] = cap.persisted;
    assert.equal(patch.phone_reveal_cost_source, 'unknown');
  });

  it('el patch NUNCA lleva teléfono en las columnas de costo', async () => {
    await runWebhook({
      request_id: REQUEST_ID,
      phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }],
    });

    const [{ patch }] = cap.persisted;
    assert.notEqual(patch.phone_reveal_cost_source, MOBILE);
    assert.equal(JSON.stringify(patch.phone_reveal_cost_source).includes(MOBILE), false);
  });
});

// ── La liquidación: verdad ECONÓMICA ───────────────────────────

describe('§6 — la liquidación aporta la cifra económica', () => {
  const APOLLO_LEG: PhoneRevealCreditReservedLeg = {
    id: 'res-apollo',
    providerKey: 'apollo',
    creditsReserved: 8,
  };
  const LUSHA_LEG: PhoneRevealCreditReservedLeg = {
    id: 'res-lusha',
    providerKey: 'lusha',
    creditsReserved: 5,
  };

  it('Apollo intentado sin costo reportado ⇒ 8 créditos con assumed_cap', () => {
    const settlement = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: true,
        apolloCostCredits: null,
        apolloCostSource: 'unknown',
        lushaAttempted: false,
        lushaCostCredits: null,
        lushaCostSource: null,
      },
      reservedLegs: [APOLLO_LEG, LUSHA_LEG],
    });

    const cost = resolvePhoneRevealSettledLegCost({
      providerKey: 'apollo',
      settlement,
    });

    // Exactamente el contrato que pide § 6 para el caso real de Apollo.
    assert.deepEqual(cost, { credits: 8, costSource: 'assumed_cap' });
  });

  it('Apollo con costo reportado ⇒ esa cifra con reported', () => {
    const settlement = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: true,
        apolloCostCredits: 3,
        apolloCostSource: 'reported',
        lushaAttempted: false,
        lushaCostCredits: null,
        lushaCostSource: null,
      },
      reservedLegs: [APOLLO_LEG],
    });

    assert.deepEqual(resolvePhoneRevealSettledLegCost({ providerKey: 'apollo', settlement }), {
      credits: 3,
      costSource: 'reported',
    });
  });

  it('una pata liberada NO produce costo: null, nunca 0', () => {
    // Declarar 0 sería afirmar que no se cobró; la ausencia de cifra es lo honesto.
    const settlement = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: true,
        apolloCostCredits: null,
        apolloCostSource: 'unknown',
        lushaAttempted: false,
        lushaCostCredits: null,
        lushaCostSource: null,
      },
      reservedLegs: [APOLLO_LEG, LUSHA_LEG],
    });

    assert.equal(resolvePhoneRevealSettledLegCost({ providerKey: 'lusha', settlement }), null);
  });

  it('una corrida NO terminal no produce costo de ninguna pata', () => {
    const settlement = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: false,
        apolloAttempted: true,
        apolloCostCredits: null,
        apolloCostSource: 'unknown',
        lushaAttempted: false,
        lushaCostCredits: null,
        lushaCostSource: null,
      },
      reservedLegs: [APOLLO_LEG],
    });

    assert.equal(resolvePhoneRevealSettledLegCost({ providerKey: 'apollo', settlement }), null);
  });

  it('la cifra del candidato y la de la reserva salen de la MISMA decisión', () => {
    // Si divergieran, el candidato diría un costo y el presupuesto otro.
    const settlement = decidePhoneRevealCreditSettlement({
      facts: {
        isTerminal: true,
        apolloAttempted: true,
        apolloCostCredits: null,
        apolloCostSource: 'unknown',
        lushaAttempted: true,
        lushaCostCredits: 5,
        lushaCostSource: 'reported',
      },
      reservedLegs: [APOLLO_LEG, LUSHA_LEG],
    });

    for (const providerKey of ['apollo', 'lusha']) {
      const confirmed = settlement.find(
        (action) => action.action === 'confirm' && action.providerKey === providerKey,
      );
      const cost = resolvePhoneRevealSettledLegCost({ providerKey, settlement });
      assert.ok(confirmed && confirmed.action === 'confirm');
      assert.equal(cost?.credits, confirmed.credits);
      assert.equal(cost?.costSource, confirmed.costTruth);
    }
  });
});
