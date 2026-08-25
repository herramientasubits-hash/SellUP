/**
 * cross-provider-phone-identity-waterfall.test.ts
 * (Agente 2A · AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1)
 *
 * Casos G, H, I del encargo, más el cableado del paso de identidad dentro de
 * `continuePhoneRevealWaterfall`.
 *
 * Lo que estos tests fijan es una propiedad POSICIONAL, y por eso no se pueden
 * escribir en el core de identidad: la búsqueda pagada tiene que quedar por DETRÁS de
 * la puerta de privacidad y por DELANTE del claim del reveal. Un candidato suprimido
 * produce 0 búsquedas Y 0 reveals, no 0 reveals a secas — y con la búsqueda mal
 * colocada, esa diferencia es un crédito gastado sobre una persona que pidió no ser
 * contactada.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  continuePhoneRevealWaterfall,
  startPhoneRevealWaterfall,
  type ContinuePhoneRevealWaterfallDeps,
  type PhoneRevealWaterfallCandidateRecord,
  type PhoneRevealWaterfallRunPatch,
  type PhoneRevealWaterfallRunRecord,
  type PhoneRevealWaterfallSuppressionState,
} from '../phone-reveal-waterfall-core';
import type { ResolveLushaIdentityResult } from '../lusha-identity-resolution-runtime-core';
import type { LushaIdentitySearchCandidateFacts } from '../lusha-identity-search-core';
import {
  configuredPool,
  creditHarness,
  ACCEPTED_CEILING_NOT_UNDER_TEST,
} from './phone-reveal-credit-reservation-fixtures';

const NOW_ISO = '2026-08-03T12:00:00.000Z';
const LUSHA_ID = 'v1.token-lusha-opaco';

const FACTS: LushaIdentitySearchCandidateFacts = {
  firstName: 'Ana',
  lastName: 'Ruiz',
  linkedinUrl: 'https://www.linkedin.com/in/ana-ruiz',
  email: 'ana@acme.com',
  companyName: 'ACME',
  companyDomain: 'acme.com',
};

/** Candidato nacido en Apollo, sin identidad Lusha todavía. */
function apolloCandidate(
  overrides: Partial<PhoneRevealWaterfallCandidateRecord> = {},
): PhoneRevealWaterfallCandidateRecord {
  return {
    id: 'candidate-1',
    source: 'apollo',
    sourceContactId: 'apollo-person-99',
    hasPhone: false,
    phoneRevealStatus: 'no_phone_found',
    providerIdentities: [],
    identitySearchFacts: FACTS,
    ...overrides,
  };
}

function activeRun(
  overrides: Partial<PhoneRevealWaterfallRunRecord> = {},
): PhoneRevealWaterfallRunRecord {
  return {
    id: 'run-1',
    candidateId: 'candidate-1',
    status: 'apollo_in_flight',
    runMode: 'full_waterfall',
    authorizedAt: NOW_ISO,
    authorizedBy: 'user-1',
    authorizedByRole: 'admin',
    maxCreditsAuthorized: 14,
    apolloAttemptedAt: NOW_ISO,
    apolloOutcome: null,
    apolloCostCredits: null,
    apolloCostSource: null,
    lushaEligible: true,
    lushaSkippedReason: null,
    lushaAttemptedAt: null,
    lushaOutcome: null,
    lushaCostCredits: null,
    lushaCostSource: null,
    finalProvider: null,
    completedAt: null,
    errorCode: null,
    creditReservationGroupId: 'group-1',
    ...overrides,
  };
}

interface WfHarness {
  deps: ContinuePhoneRevealWaterfallDeps;
  updates: Array<{ runId: string; patch: PhoneRevealWaterfallRunPatch }>;
  /** Orden REAL de los efectos observables. Es lo que prueba la posición. */
  order: string[];
  identityCalls: number;
  revealClaims: number;
  lushaCalls: number;
  lushaContactIdSeen: string | undefined;
  recordedOutcomes: Array<{ outcome: string; creditsCharged: number | null }>;
}

function wfHarness(opts: {
  suppression?: PhoneRevealWaterfallSuppressionState;
  suppressionThrows?: boolean;
  identity?: ResolveLushaIdentityResult;
  candidate?: PhoneRevealWaterfallCandidateRecord;
  /** Sin resolutor: comportamiento anterior al hito. */
  withoutIdentityDep?: boolean;
  /** Corrida alternativa (tope autorizado, modalidad…). */
  run?: PhoneRevealWaterfallRunRecord;
} = {}): WfHarness {
  const updates: Array<{ runId: string; patch: PhoneRevealWaterfallRunPatch }> = [];
  const order: string[] = [];
  let claimedOnce = false;

  const h: WfHarness = {
    updates,
    order,
    identityCalls: 0,
    revealClaims: 0,
    lushaCalls: 0,
    lushaContactIdSeen: undefined,
    recordedOutcomes: [],
    deps: {
      flagEnabled: true,
      lushaFallbackFlagEnabled: true,
      nowIso: NOW_ISO,
      findActiveRun: async () => opts.run ?? activeRun(),
      loadCandidate: async () => opts.candidate ?? apolloCandidate(),
      updateRun: async (runId, patch) => {
        order.push('update-run');
        updates.push({ runId, patch });
      },
      checkSuppressionAndDoNotContact: async () => {
        order.push('suppression-check');
        if (opts.suppressionThrows) throw new Error('driver detail');
        return opts.suppression ?? 'clear';
      },
      claimLushaAttempt: async () => {
        order.push('reveal-claim');
        h.revealClaims += 1;
        if (claimedOnce) return false;
        claimedOnce = true;
        return true;
      },
      callLushaLeg: async (args) => {
        order.push('lusha-reveal');
        h.lushaCalls += 1;
        h.lushaContactIdSeen = args.lushaContactId;
        return { status: 'revealed', creditsCharged: 5, errorCode: null };
      },
      ...(opts.withoutIdentityDep
        ? {}
        : {
            resolveLushaIdentity: async () => {
              order.push('identity-search');
              h.identityCalls += 1;
              return (
                opts.identity ?? {
                  status: 'ready',
                  contactId: LUSHA_ID,
                  searched: true,
                  runOutcome: 'resolved',
                  searchCreditsCharged: 1,
                }
              );
            },
            recordIdentitySearchOutcome: async (args) => {
              order.push('record-identity-outcome');
              h.recordedOutcomes.push({
                outcome: args.outcome,
                creditsCharged: args.creditsCharged,
              });
            },
          }),
    },
  };
  return h;
}

// ═══════════════════════════════════════════════════════════════
// Camino feliz + posición
// ═══════════════════════════════════════════════════════════════

describe('el paso de identidad va DESPUÉS de privacidad y ANTES del claim del reveal', () => {
  test('orden exacto de efectos en el camino feliz', async () => {
    const h = wfHarness();
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_revealed');
    assert.deepEqual(h.order, [
      'suppression-check',
      'identity-search',
      'record-identity-outcome',
      'reveal-claim',
      'lusha-reveal',
      'update-run',
    ]);
  });

  test('el reveal recibe el id NATIVO resuelto, no el del candidato Apollo', async () => {
    const h = wfHarness();
    await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(h.lushaContactIdSeen, LUSHA_ID);
    assert.notEqual(h.lushaContactIdSeen, 'apollo-person-99');
  });

  test('el desenlace de la búsqueda se sella con lo que costó', async () => {
    const h = wfHarness();
    await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.deepEqual(h.recordedOutcomes, [{ outcome: 'resolved', creditsCharged: 1 }]);
  });
});

// ═══════════════════════════════════════════════════════════════
// G — supresión
// ═══════════════════════════════════════════════════════════════

describe('G — supresión: 0 search y 0 reveal', () => {
  test('un tombstone confirmado corta ANTES de la búsqueda pagada', async () => {
    const h = wfHarness({ suppression: 'blocked_suppressed' });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.identityCalls, 0, '0 búsquedas pagadas');
    assert.equal(h.revealClaims, 0);
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.order.includes('identity-search'), false);
  });

  test('«no se pudo verificar» también corta antes de gastar', async () => {
    const h = wfHarness({ suppressionThrows: true });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.identityCalls, 0);
    assert.equal(h.lushaCalls, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// H — DNC
// ═══════════════════════════════════════════════════════════════

describe('H — do-not-contact: 0 search y 0 reveal', () => {
  test('un DNC corta antes de la búsqueda', async () => {
    const h = wfHarness({ suppression: 'do_not_contact' });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.identityCalls, 0);
    assert.equal(h.lushaCalls, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// I — presupuesto insuficiente
// ═══════════════════════════════════════════════════════════════

describe('I — presupuesto insuficiente: 0 search, 0 reveal, 0 corrida', () => {
  test('sin saldo de Lusha para 6 no se crea corrida ni se llama a nadie', async () => {
    const credits = creditHarness({
      // 5 alcanzaba para el reveal solo; ya no alcanza para búsqueda + reveal.
      poolsFor: (providerKeys) =>
        providerKeys.map((providerKey) => ({
          providerKey,
          state: configuredPool(providerKey === 'lusha' ? 5 : 100),
        })),
    });
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'candidate-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      {
        flagEnabled: true,
        nowIso: NOW_ISO,
        actor: { internalUserId: 'user-1', roleKey: 'admin' },
        loadCandidate: async () => apolloCandidate(),
        findActiveRun: async () => null,
        ...credits.deps,
      },
    );
    assert.equal(result.started, false);
    if (result.started) return;
    assert.equal(result.reason, 'insufficient_credits');
    assert.equal(
      credits.reserveRequests.length,
      0,
      'ni se intenta reservar: el preflight puro ya sabe que no alcanza',
    );
  });

  test('con 6 de Lusha sí arranca, y el tope autorizado es 14', async () => {
    const credits = creditHarness({
      poolsFor: (providerKeys) =>
        providerKeys.map((providerKey) => ({
          providerKey,
          state: configuredPool(providerKey === 'lusha' ? 6 : 100),
        })),
    });
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'candidate-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      {
        flagEnabled: true,
        nowIso: NOW_ISO,
        actor: { internalUserId: 'user-1', roleKey: 'admin' },
        loadCandidate: async () => apolloCandidate(),
        findActiveRun: async () => null,
        ...credits.deps,
      },
    );
    assert.equal(result.started, true);
    if (!result.started) return;
    assert.equal(result.maxCreditsAuthorized, 14);
    assert.equal(result.lushaEligible, true);
    assert.equal(result.requiresIdentitySearch, true);
  });

  test('con la identidad YA persistida el tope baja a 13 y basta con 5 de Lusha', async () => {
    const credits = creditHarness({
      poolsFor: (providerKeys) =>
        providerKeys.map((providerKey) => ({
          providerKey,
          state: configuredPool(providerKey === 'lusha' ? 5 : 100),
        })),
    });
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'candidate-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      {
        flagEnabled: true,
        nowIso: NOW_ISO,
        actor: { internalUserId: 'user-1', roleKey: 'admin' },
        loadCandidate: async () =>
          apolloCandidate({
            providerIdentities: [
              {
                candidateId: 'candidate-1',
                providerKey: 'lusha',
                providerContactId: LUSHA_ID,
                resolutionSource: 'provider_search_linkedin_url',
              },
            ],
          }),
        findActiveRun: async () => null,
        ...credits.deps,
      },
    );
    assert.equal(result.started, true);
    if (!result.started) return;
    assert.equal(result.maxCreditsAuthorized, 13, 'no se cobra por lo que ya sabemos');
    assert.equal(result.requiresIdentitySearch, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// REGRESIÓN PRISCILLA — Apollo SIN regla de crédito, Lusha CON regla
// ═══════════════════════════════════════════════════════════════
//
// AGENT2A-PHONE-REVEAL-NO-BUDGET-RULE-UNLIMITED-1.
//
// LOS HECHOS DE PRODUCCIÓN. La ficha ofrecía el CTA, la capacidad de la M128 existía y la
// vista previa decía 14. Tras el clic: 0 corridas, 0 reservas, 0 `provider_usage_logs`,
// 0 filas de teléfono, 0 llamadas a Apollo, 0 a Lusha y 0 créditos. La causa no era la
// privacidad, ni el flag, ni la identidad: era el presupuesto. `budget_rules` tiene una
// regla de Lusha (rol admin, 500 créditos/mes, activa) y NINGUNA de Apollo, y un
// proveedor sin regla se traducía a `budget_not_configured`, que BLOQUEA.
//
// Desde este hito «sin regla» significa lo que literalmente es: no hay TOPE
// PRESUPUESTARIO INTERNO que aplicar. La autorización arranca, Lusha sigue respetando su
// límite al dígito y Apollo no aparece en la reserva porque no hay pozo al que
// descontarle — no porque Apollo vaya a ser gratis.
//
// Se mide sobre el START CORE REAL contra el almacén de corridas inyectado del fixture:
// lo que se comprueba es que la corrida EXISTA y que las patas reservadas sean
// exactamente dos, no que alguien delegara una vez.

describe('REGRESIÓN PRISCILLA — Apollo sin regla + Lusha con regla', () => {
  /** Los pozos EXACTOS de Producción: Apollo sin regla, Lusha admin con 500. */
  const priscillaPools = (
    providerKeys: readonly ('apollo' | 'lusha')[],
  ) =>
    providerKeys.map((providerKey) => ({
      providerKey,
      state:
        providerKey === 'lusha'
          ? configuredPool(500)
          : ({ kind: 'not_configured' } as const),
    }));

  async function startPriscilla(credits: ReturnType<typeof creditHarness>) {
    return startPhoneRevealWaterfall(
      { candidateId: 'candidate-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      {
        flagEnabled: true,
        nowIso: NOW_ISO,
        actor: { internalUserId: 'user-1', roleKey: 'admin' },
        // Nacida en Apollo, sin identidad Lusha persistida: la búsqueda hay que pagarla.
        loadCandidate: async () => apolloCandidate(),
        findActiveRun: async () => null,
        ...credits.deps,
      },
    );
  }

  test('el clic AUTORIZA: 1 corrida, tope 14 y búsqueda de identidad incluida', async () => {
    const credits = creditHarness({ poolsFor: priscillaPools });
    const result = await startPriscilla(credits);

    assert.equal(result.started, true, 'esto es lo que en Producción devolvía 0 corridas');
    if (!result.started) return;
    // El tope humano NO cambia por no haber regla de Apollo: 8 + 1 + 5.
    assert.equal(result.maxCreditsAuthorized, 14);
    assert.equal(result.lushaEligible, true);
    assert.equal(result.requiresIdentitySearch, true);
    // Y la corrida está ESCRITA en el almacén, que es lo que hace alcanzable el pipeline
    // de proveedores: nada se llama sin `runId`.
    assert.equal(credits.createdRuns.length, 1);
    assert.equal(credits.createdRuns[0].runId, result.runId);
  });

  test('se reservan SÓLO las dos patas de Lusha (1 + 5); Apollo no aparece', async () => {
    const credits = creditHarness({ poolsFor: priscillaPools });
    await startPriscilla(credits);

    assert.equal(credits.reserveRequests.length, 1, 'una sola autorización');
    assert.deepEqual(
      credits.reserveRequests[0].legs.map((l) => [
        l.providerKey,
        l.operationKey,
        l.credits,
        l.limitCredits,
      ]),
      [
        ['lusha', 'contact_search', 1, 500],
        ['lusha', 'phone_reveal', 5, 500],
      ],
    );
    assert.equal(
      credits.reserveRequests[0].legs.some((l) => l.providerKey === 'apollo'),
      false,
      'un pozo UNBOUNDED no puede producir una fila de reserva',
    );
    // La exposición viva es la de Lusha y nada más: 6 créditos en dos operaciones.
    assert.deepEqual(
      credits.active.map((r) => [r.providerKey, r.creditsReserved]),
      [
        ['lusha', 1],
        ['lusha', 5],
      ],
    );
  });

  test('el límite de Lusha SIGUE mandando: con 5 no alcanza para 6 y no hay corrida', async () => {
    // Lo que este hito elimina es el bloqueo por AUSENCIA de regla. La regla que SÍ
    // existe se respeta exactamente igual que antes.
    const credits = creditHarness({
      poolsFor: (providerKeys) =>
        providerKeys.map((providerKey) => ({
          providerKey,
          state:
            providerKey === 'lusha'
              ? configuredPool(5)
              : ({ kind: 'not_configured' } as const),
        })),
    });
    const result = await startPriscilla(credits);

    assert.equal(result.started, false);
    assert.equal(result.started === false && result.reason, 'insufficient_credits');
    assert.deepEqual(credits.createdRuns, []);
    assert.deepEqual(credits.reserveRequests, []);
  });

  test('si el pozo de Lusha NO se puede leer, sigue sin arrancar', async () => {
    // La asimetría del contrato: «Apollo no tiene regla» autoriza; «no se pudo leer la
    // regla de Lusha» no. Fail-closed: 0 corrida, 0 proveedor, 0 créditos.
    const credits = creditHarness({
      poolsFor: (providerKeys) =>
        providerKeys.map((providerKey) => ({
          providerKey,
          state:
            providerKey === 'lusha'
              ? ({ kind: 'unavailable' } as const)
              : ({ kind: 'not_configured' } as const),
        })),
    });
    const result = await startPriscilla(credits);

    assert.equal(result.started, false);
    assert.equal(
      result.started === false && result.reason,
      'credit_balance_unavailable',
    );
    assert.deepEqual(credits.createdRuns, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// Desenlaces terminales de identidad
// ═══════════════════════════════════════════════════════════════

describe('identidad no resuelta ⇒ terminal SIN reveal', () => {
  for (const [skippedReason, runOutcome] of [
    ['lusha_identity_not_found', 'not_found'],
    ['lusha_identity_ambiguous', 'ambiguous'],
    ['lusha_identity_error', 'error'],
    ['lusha_identity_unresolvable', 'no_identifier'],
    // PR331-R2, BLOCKER 1: identidad resuelta Y COBRADA que no se pudo almacenar. El
    // reveal se retiene aquí igual que en los otros cuatro, y por la misma razón que
    // este bloque entero existe: sin identidad utilizable no se le pide un teléfono a
    // Lusha. La diferencia es que su reserva de búsqueda SÍ se liquida.
    ['lusha_identity_not_persisted', 'resolved_not_persisted'],
  ] as const) {
    test(`${skippedReason}: 0 reveal, corrida abortada con su motivo propio`, async () => {
      const h = wfHarness({
        identity: {
          status: 'blocked',
          skippedReason,
          runOutcome,
          searched: runOutcome !== 'no_identifier',
          searchCreditsCharged: runOutcome === 'no_identifier' ? null : 1,
        },
      });
      const result = await continuePhoneRevealWaterfall(
        { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
        h.deps,
      );
      assert.equal(result.outcome, 'lusha_identity_unresolved');
      assert.equal(result.reason, skippedReason);
      assert.equal(result.lushaCalled, false);
      assert.equal(h.revealClaims, 0, 'el claim del reveal ni se toca: su reserva se libera entera');
      assert.equal(h.lushaCalls, 0);
      assert.equal(h.updates[0].patch.status, 'aborted');
      assert.equal(h.updates[0].patch.lushaSkippedReason, skippedReason);
      assert.equal(h.updates[0].patch.finalProvider, 'none');
    });
  }

  test('persistencia fallida: el reveal NUNCA se reclama, así que su reserva queda intacta', async () => {
    const h = wfHarness({
      identity: {
        status: 'blocked',
        skippedReason: 'lusha_identity_not_persisted',
        runOutcome: 'resolved_not_persisted',
        searched: true,
        searchCreditsCharged: 1,
      },
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.lushaCalled, false, 'reveal calls = 0');
    assert.equal(h.revealClaims, 0, 'sin claim, la reserva del reveal se libera entera');
    assert.equal(h.lushaCalls, 0);
    // Y el sello conserva la evidencia económica de la búsqueda que sí se pagó.
    assert.deepEqual(h.recordedOutcomes, [
      { outcome: 'resolved_not_persisted', creditsCharged: 1 },
    ]);
  });

  test('el claim de la BÚSQUEDA perdido no escribe nada ni toca el reveal', async () => {
    const h = wfHarness({ identity: { status: 'claim_lost', reason: 'already_claimed' } });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_identity_claim_lost');
    assert.equal(result.reason, 'already_claimed');
    assert.equal(h.updates.length, 0, '0 escrituras');
    assert.equal(h.revealClaims, 0);
    assert.equal(h.lushaCalls, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// O — sin la dep, el comportamiento es el de antes del hito
// ═══════════════════════════════════════════════════════════════

describe('O — sin resolutor de identidad, nada cambia', () => {
  test('un candidato Lusha nativo llega al reveal igual que siempre', async () => {
    const h = wfHarness({
      withoutIdentityDep: true,
      candidate: apolloCandidate({ source: 'lusha', sourceContactId: LUSHA_ID }),
    });
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(result.outcome, 'lusha_revealed');
    assert.equal(h.identityCalls, 0);
    assert.equal(h.lushaContactIdSeen, undefined, 'el ejecutor lo deriva como siempre');
    assert.deepEqual(h.order, ['suppression-check', 'reveal-claim', 'lusha-reveal', 'update-run']);
  });

  test('Apollo reveló: ni privacidad ni identidad ni reveal se tocan', async () => {
    const h = wfHarness();
    const result = await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'revealed', apolloCostCredits: 8 },
      h.deps,
    );
    assert.equal(result.outcome, 'closed_without_lusha');
    assert.equal(h.identityCalls, 0);
    assert.equal(h.lushaCalls, 0);
    assert.equal(h.order.includes('identity-search'), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// La búsqueda PAGADA exige una autorización que la haya reservado
// ═══════════════════════════════════════════════════════════════
//
// PR331-R2. El flag enciende el cableado, pero el flag no es una autorización: sigue
// habiendo corridas VIVAS cuyo tope nunca incluyó el crédito de búsqueda — una corrida
// `legacy_lusha_only` del motor manual (tope 5) o cualquier corrida `full_waterfall`
// creada antes de encender el flag (tope 13). Si la búsqueda corriera en ellas gastaría
// un crédito que nadie reservó y que el operador nunca vio en su confirmación.

describe('la búsqueda pagada exige un tope que la incluya', () => {
  for (const [label, maxCredits] of [
    ['corrida legacy del motor manual (5)', 5],
    ['corrida anterior a encender el flag (13)', 13],
    ['sólo Apollo (8)', 8],
  ] as const) {
    test(`${label}: 0 búsquedas, y el cierre es el de antes del hito`, async () => {
      const h = wfHarness({ run: activeRun({ maxCreditsAuthorized: maxCredits }) });
      const result = await continuePhoneRevealWaterfall(
        { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
        h.deps,
      );

      assert.equal(h.identityCalls, 0, 'el resolutor no se consulta: gastaría sin reserva');
      assert.equal(h.lushaCalls, 0);
      assert.equal(h.revealClaims, 0);
      // Y el registro dice la VERDAD para esa corrida: bajo esta autorización el
      // candidato no tiene identificador de Lusha reutilizable.
      assert.equal(h.updates[0]?.patch.lushaSkippedReason, 'missing_lusha_contact_id');
      assert.equal(result.outcome, 'closed_without_lusha');
    });
  }

  test('con tope 14 sí se consulta: es lo que el operador autorizó', async () => {
    const h = wfHarness({ run: activeRun({ maxCreditsAuthorized: 14 }) });
    await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(h.identityCalls, 1);
    assert.equal(h.lushaCalls, 1);
  });

  test('un candidato con identidad Lusha YA persistida pasa con tope 13: cuesta 0', async () => {
    // Reutilizar no es comprar. Bloquear el reuso en una corrida de tope 13 impediría un
    // reveal que esa autorización SÍ cubre entera (los 5 del teléfono).
    const h = wfHarness({
      run: activeRun({ maxCreditsAuthorized: 13 }),
      candidate: apolloCandidate({
        providerIdentities: [
          {
            candidateId: 'candidate-1',
            providerKey: 'lusha',
            providerContactId: LUSHA_ID,
            resolutionSource: 'provider_search_linkedin_url',
          },
        ],
      }),
      identity: {
        status: 'ready',
        contactId: LUSHA_ID,
        searched: false,
        runOutcome: 'reused_persisted',
        searchCreditsCharged: null,
      },
    });
    await continuePhoneRevealWaterfall(
      { candidateId: 'candidate-1', apolloOutcome: 'no_phone_found', apolloCostCredits: null },
      h.deps,
    );
    assert.equal(h.identityCalls, 1, 'se consulta, y contesta gratis');
    assert.equal(h.lushaCalls, 1, 'el reveal sí corre');
    assert.equal(h.lushaContactIdSeen, LUSHA_ID);
    assert.deepEqual(h.recordedOutcomes, [
      { outcome: 'reused_persisted', creditsCharged: null },
    ]);
  });
});
