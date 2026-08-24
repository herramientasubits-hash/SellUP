// Tests — atomicidad, idempotencia, reconciliación y contrato por proveedor
// (Agente 2A · AGENT2A-PHONE-WATERFALL-4F)
//
// QUÉ CIERRA ESTE ARCHIVO
//
// 4E reservaba en una llamada y creaba la corrida en otra. Entre las dos hay una ventana
// en la que la reserva ya está comprometida y la corrida todavía no existe, y la
// compensación que debía cubrirla (un release) sólo corre si el proceso sigue vivo y la
// respuesta llega — es decir, no corre precisamente en los fallos que importan. El
// resultado es una HUÉRFANA: exposición ocupando disponibilidad que nadie liquidará,
// porque la liquidación se dispara desde la corrida.
//
// 4F convierte las dos escrituras en una transacción y le añade una clave de
// idempotencia generada ANTES de la operación. Este archivo fija las cinco situaciones
// que el diseño anterior no podía resolver:
//
//   1. la RPC respondió pero la respuesta se perdió;
//   2. el reintento usa la MISMA clave;
//   3. el proceso cae después de reservar;
//   4. 23505 al crear la corrida;
//   5. timeout después del COMMIT.
//
// Y las tres propiedades que deben salir de ahí: 0 reservas activas duplicadas, 0
// corridas duplicadas, 0 reservas huérfanas — y 0 llamadas a proveedor antes de tener
// `run_id`.
//
// Además fija la RECONCILIACIÓN (F) y el CONTRATO POR PROVEEDOR (G).
//
// OFFLINE por construcción: todo se simula con la semántica de REFERENCIA de los cores
// puros. Sin red, sin DB, sin Apollo, sin Lusha, 0 créditos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  startLegacyPhoneRevealWaterfall,
  startPhoneRevealWaterfall,
  type PhoneRevealWaterfallCandidateRecord,
  type PhoneRevealWaterfallLegacyEvidence,
  type StartLegacyPhoneRevealWaterfallDeps,
  type StartPhoneRevealWaterfallDeps,
} from '../phone-reveal-waterfall-core';
import {
  decidePhoneRevealCreditSettlement,
  isPhoneRevealCreditReservationOrphan,
  simulatePhoneRevealCreditReservationAndRun,
  type PhoneRevealCreditActiveReservation,
  type PhoneRevealCreditExistingRun,
  type PhoneRevealCreditReservationAndRunRequest,
  type PhoneRevealCreditReservedLeg,
  type PhoneRevealCreditSettlementFacts,
} from '../phone-reveal-credit-reservation-core';
import {
  configuredPool,
  creditHarness,
  FIXTURE_PERIOD_END,
  FIXTURE_PERIOD_START,
  type CreditHarness,
  ACCEPTED_CEILING_NOT_UNDER_TEST,
} from './phone-reveal-credit-reservation-fixtures';
import type {
  PhoneRevealCreditPool,
  PhoneRevealCreditPoolState,
  PhoneRevealCreditProviderKey,
} from '../phone-reveal-credit-budget-core';

const NOW = '2026-08-04T12:00:00.000Z';
const ADMIN = { internalUserId: 'user-admin', roleKey: 'admin' };

function lushaCandidate(
  overrides: Partial<PhoneRevealWaterfallCandidateRecord> = {},
): PhoneRevealWaterfallCandidateRecord {
  return {
    id: 'cand-1',
    source: 'lusha',
    sourceContactId: 'v1.token-opaco',
    hasPhone: false,
    phoneRevealStatus: null,
    ...overrides,
  };
}

function legacyEvidence(): PhoneRevealWaterfallLegacyEvidence {
  return {
    candidateStatus: 'pending_review',
    phoneRevealStatus: 'no_phone_found',
    phoneRevealProvider: 'apollo',
    phoneRevealCompletedAt: '2026-07-20T09:00:00.000Z',
    hasPhone: false,
    source: 'lusha',
    sourceContactId: 'v1.token-opaco',
  };
}

function fullDeps(
  credit: CreditHarness,
  candidateId = 'cand-1',
): StartPhoneRevealWaterfallDeps {
  return {
    flagEnabled: true,
    actor: ADMIN,
    nowIso: NOW,
    loadCandidate: async () => lushaCandidate({ id: candidateId }),
    findActiveRun: async () => null,
    ...credit.deps,
  };
}

function legacyDeps(credit: CreditHarness): StartLegacyPhoneRevealWaterfallDeps {
  return {
    flagEnabled: true,
    actor: ADMIN,
    nowIso: NOW,
    loadLegacyEvidence: async () => legacyEvidence(),
    findActiveRun: async () => null,
    findLatestRun: async () => null,
    ...credit.deps,
  };
}

/** Pozos por proveedor con saldo EXPLÍCITO por cada uno. */
function pools(
  byProvider: Partial<Record<PhoneRevealCreditProviderKey, PhoneRevealCreditPoolState>>,
): (keys: readonly PhoneRevealCreditProviderKey[]) => readonly PhoneRevealCreditPool[] {
  return (keys) =>
    keys.map((providerKey) => ({
      providerKey,
      state: byProvider[providerKey] ?? { kind: 'not_configured' },
    }));
}

/** Pata reservada tal como la devuelve la operación atómica. */
function leg(
  providerKey: PhoneRevealCreditProviderKey,
  creditsReserved: number,
): PhoneRevealCreditReservedLeg {
  return { id: `res-${providerKey}`, providerKey, creditsReserved };
}

// ═══════════════════════════════════════════════════════════════
// D. Atomicidad: la reserva no puede quedar huérfana
// ═══════════════════════════════════════════════════════════════

describe('4F · D — reserva y corrida viven o mueren juntas', () => {
  it('camino feliz: UNA corrida, UN grupo de reserva, y las dos patas ocupadas', async () => {
    const credit = creditHarness({ groupIds: ['group-1'] });
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      fullDeps(credit),
    );

    assert.equal(result.started, true);
    assert.equal(credit.createdRuns.length, 1);
    assert.equal(credit.createdRuns[0].reservationGroupId, 'group-1');
    assert.equal(credit.createdDrafts[0].creditReservationGroupId, 'group-1');
    // La exposición queda OCUPADA: la corrida está viva y todavía puede gastar.
    assert.equal(credit.active.filter((r) => r.status === 'reserved').length, 2);
  });

  it('la corrida y la reserva son la MISMA operación: nunca dos viajes', async () => {
    // Es la propiedad estructural de la que dependen todas las de abajo. Si mañana
    // alguien volviera a partirlas, este test cae antes que ninguna otra cosa.
    const credit = creditHarness();
    await startPhoneRevealWaterfall({ candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, fullDeps(credit));
    assert.equal(credit.reserveRequests.length, 1, 'una sola operación');
    assert.equal(credit.runDrafts.length, 1, 'y lleva el borrador de la corrida dentro');
  });

  it('23505 al crear la corrida ⇒ 0 corridas y 0 reservas activas', () => {
    // Directo sobre la semántica de referencia del SQL, con una corrida activa ya
    // presente: el índice único parcial de la migración 102 rechaza la segunda.
    const request: PhoneRevealCreditReservationAndRunRequest = {
      candidateId: 'cand-1',
      authorizedBy: 'user-admin',
      reservationGroupId: 'group-1',
      authorizationKey: 'key-1',
      legs: [
        {
          providerKey: 'apollo',
          credits: 8,
          limitCredits: 100,
          consumedCredits: 0,
          scopeType: 'global',
          scopeId: null,
          periodStart: FIXTURE_PERIOD_START,
          periodEnd: FIXTURE_PERIOD_END,
        },
      ],
    };
    const activeReservations: PhoneRevealCreditActiveReservation[] = [];
    const runs: PhoneRevealCreditExistingRun[] = [
      {
        runId: 'run-live',
        candidateId: 'cand-1',
        authorizationKey: 'key-previa',
        reservationGroupId: 'group-previa',
        isActive: true,
      },
    ];

    const outcome = simulatePhoneRevealCreditReservationAndRun(request, {
      activeReservations,
      runs,
    });

    assert.deepEqual(outcome, { status: 'create_conflict' });
    // El rollback es lo que hace que no haya nada que compensar.
    assert.deepEqual(activeReservations, [], '0 reservas activas duplicadas');
    assert.equal(runs.length, 1, '0 corridas duplicadas');
  });

  it('el proceso cae después de reservar: no existe ese estado que perder', async () => {
    // "Caer después de reservar" era el escenario fatal de 4E. En 4F la reserva sólo
    // existe si la corrida existe, así que el fallo no puede caer en medio: lo modelamos
    // como una excepción de transporte y comprobamos que el pozo quedó como estaba.
    const credit = creditHarness({ throws: new Error('ECONNRESET') });
    await assert.rejects(
      () => startPhoneRevealWaterfall({ candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, fullDeps(credit)),
      /ECONNRESET/,
    );
    assert.deepEqual(credit.active, [], '0 reservas huérfanas');
    assert.deepEqual(credit.createdRuns, [], '0 corridas');
  });

  it('la RPC respondió pero la respuesta se perdió: nada queda a medias del lado visible', async () => {
    // Desde la aplicación este caso es indistinguible de "no se ejecutó nada", y por eso
    // el fail-closed tiene que ser total: sin `runId` no se llama a ningún proveedor.
    const credit = creditHarness({
      outcome: { status: 'unavailable', detail: 'reserve_and_create_threw' },
    });
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      fullDeps(credit),
    );
    assert.deepEqual(result, { started: false, reason: 'run_creation_unavailable' });
    assert.deepEqual(credit.createdRuns, []);
  });

  it('un timeout después del COMMIT lo resuelve el reintento, no una compensación', () => {
    // Estado tras el COMMIT que la aplicación no llegó a ver: la corrida existe con su
    // clave. El reintento la encuentra en el cortocircuito idempotente, ANTES de
    // cualquier lock o escritura, así que no reserva por segunda vez.
    const committed: PhoneRevealCreditExistingRun[] = [
      {
        runId: 'run-commitida',
        candidateId: 'cand-1',
        authorizationKey: 'key-1',
        reservationGroupId: 'group-1',
        isActive: true,
      },
    ];
    const activeReservations: PhoneRevealCreditActiveReservation[] = [
      {
        candidateId: 'cand-1',
        providerKey: 'apollo',
        creditsReserved: 8,
        scopeType: 'global',
        scopeId: null,
        periodStart: FIXTURE_PERIOD_START,
        status: 'reserved',
      },
    ];

    const retry = simulatePhoneRevealCreditReservationAndRun(
      {
        candidateId: 'cand-1',
        authorizedBy: 'user-admin',
        reservationGroupId: 'group-2', // el reintento trae grupo nuevo…
        authorizationKey: 'key-1', // …pero la MISMA clave
        legs: [
          {
            providerKey: 'apollo',
            credits: 8,
            limitCredits: 100,
            consumedCredits: 0,
            scopeType: 'global',
            scopeId: null,
            periodStart: FIXTURE_PERIOD_START,
            periodEnd: FIXTURE_PERIOD_END,
          },
        ],
      },
      { activeReservations, runs: committed },
    );

    assert.deepEqual(retry, {
      status: 'already_created',
      runId: 'run-commitida',
      reservationGroupId: 'group-1',
    });
    assert.equal(activeReservations.length, 1, 'no se reservó una segunda vez');
    assert.equal(committed.length, 1, '0 corridas duplicadas');
  });

  it('0 llamadas a proveedor mientras no haya runId', async () => {
    // El core del arranque no tiene NINGUNA dep capaz de llamar a un proveedor: la
    // superficie completa son lecturas, presupuesto y la operación atómica. Un proveedor
    // sólo puede correr aguas abajo, y sólo con `started: true`.
    const credit = creditHarness({ outcome: { status: 'create_conflict' } });
    const deps = fullDeps(credit);
    const surface = Object.keys(deps).join(' ').toLowerCase();
    assert.equal(surface.includes('apollo'), false);
    assert.equal(surface.includes('lusha'), false);

    const result = await startPhoneRevealWaterfall({ candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, deps);
    assert.equal(result.started, false);
  });

  it('una reserva sin corrida sigue siendo DETECTABLE (barrido de huérfanas)', () => {
    // El barrido no desaparece: 4F hace que no deba encontrar nada, y esa afirmación
    // sólo vale si el barrido sigue existiendo y sabe reconocer el estado.
    assert.equal(
      isPhoneRevealCreditReservationOrphan({
        status: 'reserved',
        runId: null,
        createdAtIso: '2026-08-04T11:00:00.000Z',
        nowIso: NOW,
      }),
      true,
    );
    // Con corrida asociada —el único estado que 4F puede producir— nunca es huérfana.
    assert.equal(
      isPhoneRevealCreditReservationOrphan({
        status: 'reserved',
        runId: 'run-1',
        createdAtIso: '2026-08-04T11:00:00.000Z',
        nowIso: NOW,
      }),
      false,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// E. Idempotencia
// ═══════════════════════════════════════════════════════════════

describe('4F · E — la clave de autorización se genera ANTES y estabiliza el reintento', () => {
  it('la clave viaja en la operación y es previa a cualquier escritura', async () => {
    const credit = creditHarness({ authorizationKeys: ['key-estable'] });
    await startPhoneRevealWaterfall({ candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, fullDeps(credit));
    assert.equal(credit.reserveRequests[0].authorizationKey, 'key-estable');
    assert.equal(credit.createdRuns[0].authorizationKey, 'key-estable');
  });

  it('mismo candidato + misma clave ⇒ la MISMA operación, sin reservar de nuevo', () => {
    const runs: PhoneRevealCreditExistingRun[] = [];
    const activeReservations: PhoneRevealCreditActiveReservation[] = [];
    const request: PhoneRevealCreditReservationAndRunRequest = {
      candidateId: 'cand-1',
      authorizedBy: 'user-admin',
      reservationGroupId: 'group-1',
      authorizationKey: 'key-1',
      legs: [
        {
          providerKey: 'apollo',
          credits: 8,
          limitCredits: 100,
          consumedCredits: 0,
          scopeType: 'global',
          scopeId: null,
          periodStart: FIXTURE_PERIOD_START,
          periodEnd: FIXTURE_PERIOD_END,
        },
      ],
    };

    const first = simulatePhoneRevealCreditReservationAndRun(request, {
      activeReservations,
      runs,
    });
    assert.equal(first.status, 'created');
    if (first.status !== 'created') return;
    // El "servidor" persiste lo que la transacción escribió.
    runs.push({
      runId: first.runId,
      candidateId: 'cand-1',
      authorizationKey: 'key-1',
      reservationGroupId: first.reservationGroupId,
      isActive: true,
    });
    activeReservations.push({
      candidateId: 'cand-1',
      providerKey: 'apollo',
      creditsReserved: 8,
      scopeType: 'global',
      scopeId: null,
      periodStart: FIXTURE_PERIOD_START,
      status: 'reserved',
    });

    const second = simulatePhoneRevealCreditReservationAndRun(request, {
      activeReservations,
      runs,
    });
    assert.equal(second.status, 'already_created');
    assert.equal(second.status === 'already_created' && second.runId, first.runId);
    assert.equal(runs.length, 1, '0 corridas duplicadas');
    assert.equal(activeReservations.length, 1, '0 reservas activas duplicadas');
  });

  it('mismo candidato + autorización NUEVA ⇒ clave nueva y corrida nueva', async () => {
    // La clave es por AUTORIZACIÓN, no por candidato: si fuese por candidato, una
    // reautorización legítima quedaría bloqueada para siempre.
    const credit = creditHarness({
      authorizationKeys: ['key-1', 'key-2'],
      groupIds: ['group-1', 'group-2'],
    });
    await startPhoneRevealWaterfall({ candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST }, fullDeps(credit));

    // La primera autorización terminó y liquidó su exposición (lo hace la
    // reconciliación); su corrida ya no está activa.
    credit.active.length = 0;
    credit.createdRuns[0].isActive = false;

    const second = await startPhoneRevealWaterfall(
      { candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      fullDeps(credit),
    );
    assert.equal(second.started, true);
    assert.deepEqual(
      credit.reserveRequests.map((r) => r.authorizationKey),
      ['key-1', 'key-2'],
      'cada autorización trae su propia clave',
    );
    assert.equal(credit.createdRuns.length, 2, 'y produce su propia corrida');
    assert.notEqual(credit.createdRuns[0].runId, credit.createdRuns[1].runId);
  });

  it('una clave que reaparece bajo OTRO candidato se rechaza, no se reutiliza', () => {
    // Devolver la corrida del otro candidato le atribuiría a él el gasto de este
    // operador. Es un bug del caller y se trata como tal.
    const outcome = simulatePhoneRevealCreditReservationAndRun(
      {
        candidateId: 'cand-2',
        authorizedBy: 'user-admin',
        reservationGroupId: 'group-2',
        authorizationKey: 'key-1',
        legs: [
          {
            providerKey: 'apollo',
            credits: 8,
            limitCredits: 100,
            consumedCredits: 0,
            scopeType: 'global',
            scopeId: null,
            periodStart: FIXTURE_PERIOD_START,
            periodEnd: FIXTURE_PERIOD_END,
          },
        ],
      },
      {
        activeReservations: [],
        runs: [
          {
            runId: 'run-1',
            candidateId: 'cand-1',
            authorizationKey: 'key-1',
            reservationGroupId: 'group-1',
            isActive: true,
          },
        ],
      },
    );
    assert.deepEqual(outcome, {
      status: 'unavailable',
      detail: 'authorization_key_candidate_mismatch',
    });
  });

  it('dos candidatos DISTINTOS compitiendo por el mismo presupuesto: sólo uno reserva', async () => {
    // Pozo para exactamente UNA autorización completa.
    const credit = creditHarness({
      poolsFor: pools({ apollo: configuredPool(8), lusha: configuredPool(5) }),
      authorizationKeys: ['key-a', 'key-b'],
      groupIds: ['group-a', 'group-b'],
    });

    const a = await startPhoneRevealWaterfall(
      { candidateId: 'cand-a', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      fullDeps(credit, 'cand-a'),
    );
    const b = await startPhoneRevealWaterfall(
      { candidateId: 'cand-b', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      fullDeps(credit, 'cand-b'),
    );

    assert.equal(a.started, true);
    assert.equal(b.started === false && b.reason, 'insufficient_credits');
    assert.deepEqual(
      credit.createdRuns.map((r) => r.candidateId),
      ['cand-a'],
      'una sola corrida, y con claves distintas nunca se confunden',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// F. Reconciliación
// ═══════════════════════════════════════════════════════════════

function facts(
  overrides: Partial<PhoneRevealCreditSettlementFacts> = {},
): PhoneRevealCreditSettlementFacts {
  return {
    isTerminal: true,
    apolloAttempted: true,
    apolloCostCredits: null,
    apolloCostSource: null,
    lushaAttempted: false,
    lushaCostCredits: null,
    lushaCostSource: null,
    ...overrides,
  };
}

describe('4F · F — la exposición se mantiene hasta que el costo queda registrado', () => {
  it('costo conocido MENOR al tope ⇒ se confirma el real y se libera la diferencia', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({ apolloCostCredits: 3, apolloCostSource: 'reported' }),
      reservedLegs: [leg('apollo', 8)],
    });
    assert.deepEqual(actions, [
      {
        action: 'confirm',
        reservationId: 'res-apollo',
        providerKey: 'apollo',
        // Una pata legacy (sin operationKey) se liquida como lo que siempre fue.
        operationKey: 'phone_reveal',
        credits: 3,
        costTruth: 'reported',
      },
    ]);
    // Confirmar en 3 ES liberar los 5 de diferencia: la fila deja de estar `reserved`,
    // así que deja de ocupar el tope y sólo cuenta lo que realmente costó.
  });

  it('costo DESCONOCIDO ⇒ se confirma el TOPE con `assumed_cap`, nunca 0 y nunca release', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({ apolloCostCredits: null, apolloCostSource: 'unknown' }),
      reservedLegs: [leg('apollo', 8)],
    });
    assert.deepEqual(actions, [
      {
        action: 'confirm',
        reservationId: 'res-apollo',
        providerKey: 'apollo',
        operationKey: 'phone_reveal',
        credits: 8,
        costTruth: 'assumed_cap',
      },
    ]);
  });

  it('pata Lusha NO ejecutada ⇒ se libera ÚNICAMENTE Lusha', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({
        apolloAttempted: true,
        apolloCostCredits: 8,
        apolloCostSource: 'reported',
        lushaAttempted: false,
      }),
      reservedLegs: [leg('apollo', 8), leg('lusha', 5)],
    });
    assert.equal(actions.length, 2);
    assert.equal(actions[0].action, 'confirm');
    assert.deepEqual(actions[1], {
      action: 'release',
      reservationId: 'res-lusha',
      providerKey: 'lusha',
      operationKey: 'phone_reveal',
      reason: 'leg_never_attempted',
    });
  });

  it('usage log fallido o pendiente ⇒ NO se libera de forma insegura', () => {
    // "Pendiente" llega como pata INTENTADA sin costo reportado. La respuesta segura es
    // confirmar el tope, no liberar: liberar declararía un gasto de cero que nadie
    // verificó, y esos créditos volverían a estar disponibles aunque el proveedor los
    // haya cobrado.
    for (const source of [null, 'unknown', 'pending', 'estimated']) {
      const actions = decidePhoneRevealCreditSettlement({
        facts: facts({
          lushaAttempted: true,
          lushaCostCredits: null,
          lushaCostSource: source,
        }),
        reservedLegs: [leg('lusha', 5)],
      });
      assert.equal(actions.length, 1);
      assert.equal(actions[0].action, 'confirm', `source=${source} no puede liberar`);
      assert.equal(
        actions[0].action === 'confirm' && actions[0].credits,
        5,
        `source=${source} debe confirmar el tope`,
      );
    }
  });

  it('una cifra reportada que SUPERA el tope se confirma tal cual, no se recorta', () => {
    // Ocultar un sobregiro sería peor que registrarlo: la contabilidad dejaría de
    // reflejar lo que el proveedor cobró.
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({ apolloCostCredits: 11, apolloCostSource: 'reported' }),
      reservedLegs: [leg('apollo', 8)],
    });
    assert.equal(actions[0].action === 'confirm' && actions[0].credits, 11);
  });

  it('corrida terminal REPETIDA ⇒ reconciliación idempotente', () => {
    // La segunda pasada no recibe patas `reserved` (la primera ya las liquidó), así que
    // no hay nada que hacer. Es lo que impide una doble confirmación.
    const settled = decidePhoneRevealCreditSettlement({
      facts: facts({ apolloCostCredits: 8, apolloCostSource: 'reported' }),
      reservedLegs: [],
    });
    assert.deepEqual(settled, []);
  });

  it('corrida NO terminal ⇒ CERO acciones: la exposición se mantiene ENTERA', () => {
    // Éste es el invariante que impide el sobregasto: no puede existir un intervalo con
    // la reserva ya liberada y el consumo todavía sin contar. Mientras la operación
    // pueda gastar, el tope sigue ocupado.
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({
        isTerminal: false,
        apolloCostCredits: 3,
        apolloCostSource: 'reported',
      }),
      reservedLegs: [leg('apollo', 8), leg('lusha', 5)],
    });
    assert.deepEqual(actions, []);
  });

  it('nunca se libera una pata que SÍ se intentó, sea cual sea su costo', () => {
    // Barrido del espacio: intentada ⇒ jamás `release`.
    for (const [creditsValue, source] of [
      [null, null],
      [null, 'unknown'],
      [0, 'reported'],
      [4, 'reported'],
      [99, 'reported'],
    ] as const) {
      const actions = decidePhoneRevealCreditSettlement({
        facts: facts({
          apolloAttempted: true,
          apolloCostCredits: creditsValue,
          apolloCostSource: source,
        }),
        reservedLegs: [leg('apollo', 8)],
      });
      assert.equal(actions[0].action, 'confirm', `${creditsValue}/${source}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// G. Contrato POR PROVEEDOR
// ═══════════════════════════════════════════════════════════════

describe('4F · G — el presupuesto se exige POR PROVEEDOR, nunca combinado', () => {
  async function startFull(
    byProvider: Partial<
      Record<PhoneRevealCreditProviderKey, PhoneRevealCreditPoolState>
    >,
  ) {
    const credit = creditHarness({ poolsFor: pools(byProvider) });
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      fullDeps(credit),
    );
    return { result, credit };
  }

  it('Apollo 8 / Lusha 5 ⇒ waterfall completo PERMITIDO', async () => {
    const { result, credit } = await startFull({
      apollo: configuredPool(8),
      lusha: configuredPool(5),
    });
    assert.equal(result.started, true);
    assert.equal(result.started && result.maxCreditsAuthorized, 13);
    assert.deepEqual(
      credit.reserveRequests[0].legs.map((l) => [l.providerKey, l.credits]),
      [
        ['apollo', 8],
        ['lusha', 5],
      ],
    );
  });

  it('Apollo 8 / Lusha 4 ⇒ BLOQUEADO (el mínimo combinado 13 no existe)', async () => {
    // 8 + 4 = 12 < 13, pero el punto NO es el total: Apollo alcanza y Lusha no, y la
    // pata que no alcanza es la que bloquea. Un modelo combinado habría dejado pasar
    // combinaciones que ningún pozo real puede pagar.
    const { result, credit } = await startFull({
      apollo: configuredPool(8),
      lusha: configuredPool(4),
    });
    assert.deepEqual(result, { started: false, reason: 'insufficient_credits' });
    assert.deepEqual(credit.createdRuns, []);
  });

  it('Apollo 7 / Lusha 5 ⇒ BLOQUEADO', async () => {
    const { result, credit } = await startFull({
      apollo: configuredPool(7),
      lusha: configuredPool(5),
    });
    assert.deepEqual(result, { started: false, reason: 'insufficient_credits' });
    assert.deepEqual(credit.createdRuns, []);
  });

  it('Apollo 8 SIN regla de Lusha ⇒ budget_not_configured', async () => {
    // Un proveedor sin regla no tiene disponibilidad contra la que reservar. En 4D esto
    // se leía como `unlimited` y AUTORIZABA el gasto; desde 4E bloquea.
    const { result, credit } = await startFull({
      apollo: configuredPool(8),
      // lusha ausente ⇒ not_configured
    });
    assert.deepEqual(result, { started: false, reason: 'budget_not_configured' });
    assert.deepEqual(credit.createdRuns, []);
  });

  it('Apollo-only con Apollo 8 ⇒ PERMITIDO, y no se pregunta por Lusha', async () => {
    // Candidato sin id Lusha reutilizable: su pata Lusha es imposible, así que el pozo
    // de Lusha no puede bloquear ni ocuparse por un proveedor que no va a correr.
    const credit = creditHarness({ poolsFor: pools({ apollo: configuredPool(8) }) });
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      {
        ...fullDeps(credit),
        loadCandidate: async () =>
          lushaCandidate({ source: 'apollo', sourceContactId: '0123456789abcdef01234567' }),
      },
    );
    assert.equal(result.started, true);
    assert.equal(result.started && result.maxCreditsAuthorized, 8);
    assert.deepEqual(credit.poolQueries, [['apollo']]);
    assert.deepEqual(
      credit.reserveRequests[0].legs.map((l) => [l.providerKey, l.credits]),
      [['apollo', 8]],
    );
  });

  it('legacy con Lusha 5 ⇒ PERMITIDO, y no se pregunta por Apollo', async () => {
    const credit = creditHarness({ poolsFor: pools({ lusha: configuredPool(5) }) });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-1' },
      legacyDeps(credit),
    );
    assert.equal(result.started, true);
    assert.equal(result.started && result.maxCreditsAuthorized, 5);
    assert.deepEqual(credit.poolQueries, [['lusha']]);
    assert.deepEqual(
      credit.reserveRequests[0].legs.map((l) => [l.providerKey, l.credits]),
      [['lusha', 5]],
    );
  });

  it('legacy SIN regla de Lusha ⇒ BLOQUEADO', async () => {
    const credit = creditHarness({ poolsFor: pools({}) });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-1' },
      legacyDeps(credit),
    );
    assert.equal(result.started === false && result.reason, 'budget_not_configured');
    assert.deepEqual(credit.createdRuns, []);
  });

  it('legacy con Lusha 4 ⇒ BLOQUEADO (5 es el mínimo de su única pata)', async () => {
    const credit = creditHarness({ poolsFor: pools({ lusha: configuredPool(4) }) });
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-1' },
      legacyDeps(credit),
    );
    assert.equal(result.started === false && result.reason, 'insufficient_credits');
    assert.deepEqual(credit.createdRuns, []);
  });
});

// AGENT2A-WATERFALL-DEFAULT-REVEAL-BEHAVIOR-1: el actor de referencia «no autorizado»
// pasó de `commercial_manager` (que SÍ puede revelar teléfono) a un rol que nunca pudo.
describe('4F · G — flag OFF y rol sin permiso de revelar siguen exactamente igual', () => {
  it('flag OFF: 0 presupuestos resueltos, 0 reservas, 0 corridas', async () => {
    const credit = creditHarness();
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      { ...fullDeps(credit), flagEnabled: false },
    );
    assert.deepEqual(result, { started: false, reason: 'feature_disabled' });
    assert.deepEqual(credit.poolQueries, []);
    assert.deepEqual(credit.reserveRequests, []);
    assert.deepEqual(credit.createdRuns, []);
    assert.deepEqual(credit.active, []);
  });

  it('flag OFF en legacy: idénticas garantías de cero efectos', async () => {
    const credit = creditHarness();
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-1' },
      { ...legacyDeps(credit), flagEnabled: false },
    );
    assert.equal(result.started === false && result.reason, 'feature_disabled');
    assert.deepEqual(credit.poolQueries, []);
    assert.deepEqual(credit.reserveRequests, []);
    assert.deepEqual(credit.createdRuns, []);
  });

  it('rol sin permiso de revelar: rechazado por ROL antes de tocar el presupuesto', async () => {
    // El orden barato→caro importa: si el rol se comprobara después, un rol no
    // autorizado ya habría ocupado exposición que nadie iba a gastar.
    const credit = creditHarness();
    const result = await startPhoneRevealWaterfall(
      { candidateId: 'cand-1', acceptedMaxCredits: ACCEPTED_CEILING_NOT_UNDER_TEST },
      {
        ...fullDeps(credit),
        actor: { internalUserId: 'user-seller', roleKey: 'seller' },
      },
    );
    assert.deepEqual(result, { started: false, reason: 'role_not_allowed' });
    assert.deepEqual(credit.poolQueries, []);
    assert.deepEqual(credit.reserveRequests, []);
    assert.deepEqual(credit.active, []);
  });

  it('rol sin permiso de revelar en legacy: tampoco reserva', async () => {
    const credit = creditHarness();
    const result = await startLegacyPhoneRevealWaterfall(
      { candidateId: 'cand-1' },
      {
        ...legacyDeps(credit),
        actor: { internalUserId: 'user-seller', roleKey: 'seller' },
      },
    );
    assert.equal(result.started === false && result.reason, 'role_not_allowed');
    assert.deepEqual(credit.reserveRequests, []);
    assert.deepEqual(credit.active, []);
  });
});
