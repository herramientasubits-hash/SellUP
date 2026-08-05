// Tests — ciclo de vida PURO de la reserva de créditos del reveal de teléfono
// (Agente 2A · AGENT2A-PHONE-WATERFALL-4E)
//
// OFFLINE por construcción: el módulo bajo prueba no tiene I/O, así que aquí no hay red,
// ni DB, ni Apollo, ni Lusha, ni un solo crédito. La disponibilidad y las reservas vivas
// se inyectan como dato.
//
// Lo que se fija es exactamente lo que cuesta dinero si se rompe:
//   * la aritmética de la reserva: `limit - consumed - reservado activo`, POR POZO;
//   * ALL-OR-NOTHING: una pata sin espacio rechaza la autorización completa;
//   * CONCURRENCIA: dos autorizaciones no pueden consumir la misma disponibilidad;
//   * sin regla de crédito NO se reserva (no se inventa un techo);
//   * la liquidación: costo reportado ⇒ ese costo; costo DESCONOCIDO ⇒ el TOPE, nunca 0
//     y nunca un release; pata no intentada ⇒ release (el único caso demostrable);
//   * huérfanas: reservada + sin corrida + vencida, y jamás por una fecha ilegible.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPhoneRevealCreditReservationLegs,
  decidePhoneRevealCreditSettlement,
  isPhoneRevealCreditReservationOrphan,
  simulatePhoneRevealCreditReservation,
  PHONE_REVEAL_CREDIT_RESERVATION_COST_TRUTHS,
  PHONE_REVEAL_CREDIT_RESERVATION_ORPHAN_MINUTES,
  PHONE_REVEAL_CREDIT_RESERVATION_RELEASE_REASONS,
  PHONE_REVEAL_CREDIT_RESERVATION_STATUSES,
  type PhoneRevealCreditActiveReservation,
  type PhoneRevealCreditReservationLeg,
  type PhoneRevealCreditReservationRequest,
  type PhoneRevealCreditSettlementFacts,
} from '../phone-reveal-credit-reservation-core';
import {
  PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS,
  PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS,
  type PhoneRevealCreditBudgetInput,
  type PhoneRevealCreditBudgetMode,
} from '../phone-reveal-credit-budget-core';

const PERIOD_START = '2026-08-01T00:00:00.000Z';
const PERIOD_END = '2026-08-31T23:59:59.999Z';

function budget(
  available: Partial<Record<'apollo' | 'lusha', number | 'not_configured' | 'unavailable'>>,
): PhoneRevealCreditBudgetInput {
  return {
    model: 'per_provider',
    pools: Object.entries(available).map(([providerKey, value]) => ({
      providerKey: providerKey as 'apollo' | 'lusha',
      state:
        value === 'not_configured'
          ? { kind: 'not_configured' as const }
          : value === 'unavailable'
            ? { kind: 'unavailable' as const }
            : {
                kind: 'configured' as const,
                limitCredits: value as number,
                consumedCredits: 0,
                scopeType: 'global' as const,
                scopeId: null,
                periodStart: PERIOD_START,
                periodEnd: PERIOD_END,
              },
    })),
  };
}

function request(
  candidateId: string,
  mode: PhoneRevealCreditBudgetMode,
  pools: Parameters<typeof budget>[0],
  groupId = `group-${candidateId}`,
): PhoneRevealCreditReservationRequest {
  return {
    candidateId,
    authorizedBy: 'user-admin',
    reservationGroupId: groupId,
    legs: buildPhoneRevealCreditReservationLegs({ mode, budget: budget(pools) }),
  };
}

function activeLeg(
  candidateId: string,
  providerKey: string,
  creditsReserved: number,
): PhoneRevealCreditActiveReservation {
  return {
    candidateId,
    providerKey,
    creditsReserved,
    scopeType: 'global',
    scopeId: null,
    periodStart: PERIOD_START,
    status: 'reserved',
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. Patas a reservar: una por proveedor, con la identidad del pozo
// ═══════════════════════════════════════════════════════════════

describe('reserva — patas construidas desde la modalidad y el presupuesto', () => {
  test('el waterfall completo reserva DOS patas: Apollo 8 y Lusha 5, nunca una de 13', () => {
    const legs = buildPhoneRevealCreditReservationLegs({
      mode: 'full_waterfall',
      budget: budget({ apollo: 100, lusha: 50 }),
    });
    assert.deepEqual(
      legs.map((l) => [l.providerKey, l.credits, l.limitCredits]),
      [
        ['apollo', 8, 100],
        ['lusha', 5, 50],
      ],
    );
    // No existe ninguna pata de 13: no hay un pozo que la pueda pagar.
    assert.equal(
      legs.some((l) => l.credits === 13),
      false,
    );
  });

  test('legacy reserva SOLO contra Lusha; Apollo no aparece', () => {
    const legs = buildPhoneRevealCreditReservationLegs({
      mode: 'legacy_lusha_only',
      budget: budget({ lusha: 50 }),
    });
    assert.deepEqual(
      legs.map((l) => [l.providerKey, l.credits]),
      [['lusha', 5]],
    );
  });

  test('la pata arrastra la identidad del pozo (scope + período): sin ella se sumarían pozos distintos', () => {
    const legs = buildPhoneRevealCreditReservationLegs({
      mode: 'apollo_only',
      budget: {
        model: 'per_provider',
        pools: [
          {
            providerKey: 'apollo',
            state: {
              kind: 'configured',
              limitCredits: 20,
              consumedCredits: 3,
              scopeType: 'user',
              scopeId: 'user-77',
              periodStart: PERIOD_START,
              periodEnd: PERIOD_END,
            },
          },
        ],
      },
    });
    assert.deepEqual(legs[0], {
      providerKey: 'apollo',
      credits: 8,
      limitCredits: 20,
      consumedCredits: 3,
      scopeType: 'user',
      scopeId: 'user-77',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    } satisfies PhoneRevealCreditReservationLeg);
  });

  test('un pozo sin regla viaja con limitCredits null (defensa en profundidad)', () => {
    // Así la RPC vuelve a rechazarlo por su cuenta aunque alguien se salte el preflight.
    const legs = buildPhoneRevealCreditReservationLegs({
      mode: 'apollo_only',
      budget: budget({ apollo: 'not_configured' }),
    });
    assert.equal(legs[0].limitCredits, null);
    assert.notEqual(legs[0].limitCredits, 0, 'null ≠ 0: 0 sería "sin saldo"');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Aritmética y ALL-OR-NOTHING (espejo del SQL)
// ═══════════════════════════════════════════════════════════════

describe('reserva — disponibilidad = limit - consumed - reservado activo', () => {
  test('pozo vacío de reservas: la autorización cabe y devuelve una pata por proveedor', () => {
    const outcome = simulatePhoneRevealCreditReservation(
      request('cand-1', 'full_waterfall', { apollo: 8, lusha: 5 }),
      [],
    );
    assert.equal(outcome.status, 'reserved');
    assert.deepEqual(
      outcome.status === 'reserved'
        ? outcome.reservations.map((r) => [r.providerKey, r.creditsReserved])
        : null,
      [
        ['apollo', 8],
        ['lusha', 5],
      ],
    );
  });

  test('el consumo YA registrado descuenta: limit 10 y consumed 3 no cubren 8', () => {
    const outcome = simulatePhoneRevealCreditReservation(
      {
        candidateId: 'cand-1',
        authorizedBy: 'user-admin',
        reservationGroupId: 'group-1',
        legs: [
          {
            providerKey: 'apollo',
            credits: 8,
            limitCredits: 10,
            consumedCredits: 3,
            scopeType: 'global',
            scopeId: null,
            periodStart: PERIOD_START,
            periodEnd: PERIOD_END,
          },
        ],
      },
      [],
    );
    assert.equal(outcome.status, 'insufficient_credits');
    assert.deepEqual(
      outcome.status === 'insufficient_credits' ? outcome.legs : null,
      [{ providerKey: 'apollo', requiredCredits: 8, availableCredits: 7 }],
    );
  });

  test('la exposición ya reservada por OTRO candidato descuenta igual que el consumo', () => {
    const outcome = simulatePhoneRevealCreditReservation(
      request('cand-2', 'apollo_only', { apollo: 13 }),
      [activeLeg('cand-1', 'apollo', 8)],
    );
    assert.equal(outcome.status, 'insufficient_credits');
    assert.deepEqual(
      outcome.status === 'insufficient_credits'
        ? outcome.legs.map((l) => l.availableCredits)
        : null,
      [5],
    );
  });

  test('ALL-OR-NOTHING: si solo falla Lusha, tampoco se reserva Apollo', () => {
    const outcome = simulatePhoneRevealCreditReservation(
      request('cand-1', 'full_waterfall', { apollo: 1_000, lusha: 4 }),
      [],
    );
    assert.equal(outcome.status, 'insufficient_credits');
    // Reservar solo la pata pagable gastaría los 8 de Apollo en un waterfall cuya 2ª
    // pata ya se sabe impagable.
    assert.deepEqual(
      outcome.status === 'insufficient_credits'
        ? outcome.legs.map((l) => l.providerKey)
        : null,
      ['lusha'],
    );
  });

  test('las reservas de OTRO pozo (otro scope o período) no descuentan', () => {
    const otherPool: PhoneRevealCreditActiveReservation = {
      ...activeLeg('cand-1', 'apollo', 8),
      scopeType: 'user',
      scopeId: 'user-99',
    };
    const otherPeriod: PhoneRevealCreditActiveReservation = {
      ...activeLeg('cand-3', 'apollo', 8),
      periodStart: '2026-07-01T00:00:00.000Z',
    };
    const outcome = simulatePhoneRevealCreditReservation(
      request('cand-2', 'apollo_only', { apollo: 8 }),
      [otherPool, otherPeriod],
    );
    assert.equal(outcome.status, 'reserved');
  });

  test('una reserva ya confirmada o liberada NO sigue ocupando', () => {
    const outcome = simulatePhoneRevealCreditReservation(
      request('cand-2', 'apollo_only', { apollo: 8 }),
      [
        { ...activeLeg('cand-1', 'apollo', 8), status: 'confirmed' },
        { ...activeLeg('cand-4', 'apollo', 8), status: 'released' },
      ],
    );
    assert.equal(outcome.status, 'reserved');
  });

  test('sin regla de crédito ⇒ budget_not_configured, y NUNCA reserved', () => {
    const outcome = simulatePhoneRevealCreditReservation(
      request('cand-1', 'full_waterfall', { apollo: 'not_configured', lusha: 50 }),
      [],
    );
    assert.equal(outcome.status, 'budget_not_configured');
    assert.deepEqual(
      outcome.status === 'budget_not_configured'
        ? outcome.legs.map((l) => [l.providerKey, l.availableCredits])
        : null,
      [['apollo', null]],
    );
  });

  test('el mismo candidato no puede tomar exposición dos veces', () => {
    const outcome = simulatePhoneRevealCreditReservation(
      request('cand-1', 'apollo_only', { apollo: 1_000 }),
      [activeLeg('cand-1', 'lusha', 5)],
    );
    assert.equal(outcome.status, 'already_reserved');
  });

  test('una petición sin patas o con créditos no positivos es NO evaluable (fail-closed)', () => {
    assert.equal(
      simulatePhoneRevealCreditReservation(
        { candidateId: 'c', authorizedBy: 'u', reservationGroupId: 'g', legs: [] },
        [],
      ).status,
      'unavailable',
    );
    assert.equal(
      simulatePhoneRevealCreditReservation(
        {
          candidateId: 'c',
          authorizedBy: 'u',
          reservationGroupId: 'g',
          legs: [
            {
              providerKey: 'apollo',
              credits: 0,
              limitCredits: 100,
              consumedCredits: 0,
              scopeType: 'global',
              scopeId: null,
              periodStart: PERIOD_START,
              periodEnd: PERIOD_END,
            },
          ],
        },
        [],
      ).status,
      'unavailable',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Concurrencia: dos autorizaciones no comparten disponibilidad
// ═══════════════════════════════════════════════════════════════

describe('reserva — concurrencia (el caso que el preflight solo no puede cubrir)', () => {
  test('dos waterfalls completos con 13 disponibles: solo UNO reserva', () => {
    const active: PhoneRevealCreditActiveReservation[] = [];
    const outcomes = ['cand-a', 'cand-b'].map((candidateId) => {
      const req = request(candidateId, 'full_waterfall', { apollo: 13, lusha: 13 });
      const outcome = simulatePhoneRevealCreditReservation(req, active);
      if (outcome.status === 'reserved') {
        for (const leg of req.legs) {
          active.push(activeLeg(candidateId, leg.providerKey, leg.credits));
        }
      }
      return outcome.status;
    });
    // El segundo no cabe: Apollo tenía 13 y la primera pata ya se llevó 8.
    assert.deepEqual(outcomes, ['reserved', 'insufficient_credits']);
    assert.equal(active.length, 2, 'solo las dos patas de la PRIMERA autorización');
  });

  test('dos candidatos legacy con 5 disponibles: solo UNO reserva', () => {
    const active: PhoneRevealCreditActiveReservation[] = [];
    const outcomes = ['cand-a', 'cand-b'].map((candidateId) => {
      const req = request(candidateId, 'legacy_lusha_only', { lusha: 5 });
      const outcome = simulatePhoneRevealCreditReservation(req, active);
      if (outcome.status === 'reserved') {
        active.push(activeLeg(candidateId, 'lusha', 5));
      }
      return outcome.status;
    });
    assert.deepEqual(outcomes, ['reserved', 'insufficient_credits']);
  });

  test('liberar la primera devuelve la disponibilidad y la segunda ya cabe', () => {
    const active: PhoneRevealCreditActiveReservation[] = [activeLeg('cand-a', 'lusha', 5)];
    assert.equal(
      simulatePhoneRevealCreditReservation(
        request('cand-b', 'legacy_lusha_only', { lusha: 5 }),
        active,
      ).status,
      'insufficient_credits',
    );
    active.length = 0; // release
    assert.equal(
      simulatePhoneRevealCreditReservation(
        request('cand-b', 'legacy_lusha_only', { lusha: 5 }),
        active,
      ).status,
      'reserved',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Liquidación contra el costo real
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

const APOLLO_LEG = { id: 'res-apollo', providerKey: 'apollo' as const, creditsReserved: 8 };
const LUSHA_LEG = { id: 'res-lusha', providerKey: 'lusha' as const, creditsReserved: 5 };

describe('liquidación — costo reportado, costo desconocido y pata no ejecutada', () => {
  test('corrida NO terminal: NADA se liquida (la exposición se mantiene ENTERA)', () => {
    assert.deepEqual(
      decidePhoneRevealCreditSettlement({
        facts: facts({ isTerminal: false }),
        reservedLegs: [APOLLO_LEG, LUSHA_LEG],
      }),
      [],
    );
  });

  test('costo REPORTADO menor que el tope: se confirma el costo real, no el tope', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({ apolloCostCredits: 3, apolloCostSource: 'reported' }),
      reservedLegs: [APOLLO_LEG],
    });
    assert.deepEqual(actions, [
      {
        action: 'confirm',
        reservationId: 'res-apollo',
        providerKey: 'apollo',
        credits: 3,
        costTruth: 'reported',
      },
    ]);
  });

  test('costo reportado 0 explícito se confirma como 0 REPORTADO (no como cap)', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({ apolloCostCredits: 0, apolloCostSource: 'reported' }),
      reservedLegs: [APOLLO_LEG],
    });
    assert.equal(actions[0].action === 'confirm' && actions[0].credits, 0);
    assert.equal(actions[0].action === 'confirm' && actions[0].costTruth, 'reported');
  });

  test('costo DESCONOCIDO: se confirma el TOPE con assumed_cap — nunca 0, nunca release', () => {
    for (const source of [null, 'unknown', 'assumed_cap']) {
      const actions = decidePhoneRevealCreditSettlement({
        facts: facts({ apolloCostCredits: null, apolloCostSource: source }),
        reservedLegs: [APOLLO_LEG],
      });
      assert.equal(actions[0].action, 'confirm', String(source));
      assert.equal(actions[0].action === 'confirm' && actions[0].credits, 8, String(source));
      assert.equal(
        actions[0].action === 'confirm' && actions[0].costTruth,
        'assumed_cap',
        String(source),
      );
    }
  });

  test('una cifra presente pero SIN `reported` tampoco se toma por verdad: manda el tope', () => {
    // Un `apollo_cost_credits` con `cost_source = unknown` es exactamente el caso en el
    // que la columna trae un número que nadie confirmó.
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({ apolloCostCredits: 2, apolloCostSource: 'unknown' }),
      reservedLegs: [APOLLO_LEG],
    });
    assert.equal(actions[0].action === 'confirm' && actions[0].credits, 8);
    assert.equal(actions[0].action === 'confirm' && actions[0].costTruth, 'assumed_cap');
  });

  test('cifras rotas (NaN / Infinity) NO se confirman como costo: manda el tope', () => {
    for (const credits of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const actions = decidePhoneRevealCreditSettlement({
        facts: facts({ apolloCostCredits: credits, apolloCostSource: 'reported' }),
        reservedLegs: [APOLLO_LEG],
      });
      assert.equal(actions[0].action === 'confirm' && actions[0].credits, 8, String(credits));
      assert.equal(
        actions[0].action === 'confirm' && actions[0].costTruth,
        'assumed_cap',
        String(credits),
      );
    }
  });

  test('pata Lusha NUNCA intentada: se LIBERA (el único caso demostrable)', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({
        apolloCostCredits: 8,
        apolloCostSource: 'reported',
        lushaAttempted: false,
      }),
      reservedLegs: [APOLLO_LEG, LUSHA_LEG],
    });
    assert.deepEqual(actions, [
      {
        action: 'confirm',
        reservationId: 'res-apollo',
        providerKey: 'apollo',
        credits: 8,
        costTruth: 'reported',
      },
      {
        action: 'release',
        reservationId: 'res-lusha',
        providerKey: 'lusha',
        reason: 'leg_never_attempted',
      },
    ]);
  });

  test('pata Lusha intentada con costo desconocido: se CONFIRMA el tope, no se libera', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({ lushaAttempted: true, lushaCostCredits: null, lushaCostSource: null }),
      reservedLegs: [LUSHA_LEG],
    });
    assert.equal(actions[0].action, 'confirm');
    assert.equal(actions[0].action === 'confirm' && actions[0].credits, 5);
    assert.notEqual(actions[0].action, 'release', 'liberar regalaría créditos ya gastados');
  });

  test('modalidad legacy: Apollo no corrió bajo esta autorización ⇒ su pata se libera', () => {
    const actions = decidePhoneRevealCreditSettlement({
      facts: facts({ apolloAttempted: false, lushaAttempted: true, lushaCostCredits: 5, lushaCostSource: 'reported' }),
      reservedLegs: [APOLLO_LEG, LUSHA_LEG],
    });
    assert.equal(actions[0].action, 'release');
    assert.equal(actions[1].action === 'confirm' && actions[1].credits, 5);
  });

  test('los topes de la liquidación son los del preflight (8 y 5)', () => {
    assert.equal(APOLLO_LEG.creditsReserved, PHONE_REVEAL_CREDIT_BUDGET_APOLLO_ONLY_REQUIRED_CREDITS);
    assert.equal(LUSHA_LEG.creditsReserved, PHONE_REVEAL_CREDIT_BUDGET_LEGACY_REQUIRED_CREDITS);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Huérfanas
// ═══════════════════════════════════════════════════════════════

describe('reserva — detección de huérfanas', () => {
  const NOW = '2026-08-04T12:00:00.000Z';
  const minutesAgo = (m: number): string =>
    new Date(new Date(NOW).getTime() - m * 60_000).toISOString();

  test('reservada, sin corrida y vencida ⇒ huérfana', () => {
    assert.equal(
      isPhoneRevealCreditReservationOrphan({
        status: 'reserved',
        runId: null,
        createdAtIso: minutesAgo(PHONE_REVEAL_CREDIT_RESERVATION_ORPHAN_MINUTES + 1),
        nowIso: NOW,
      }),
      true,
    );
  });

  test('recién creada (dentro de la ventana) NO es huérfana: es la carrera normal', () => {
    assert.equal(
      isPhoneRevealCreditReservationOrphan({
        status: 'reserved',
        runId: null,
        createdAtIso: minutesAgo(1),
        nowIso: NOW,
      }),
      false,
    );
  });

  test('con corrida asociada NUNCA es huérfana, por vieja que sea', () => {
    assert.equal(
      isPhoneRevealCreditReservationOrphan({
        status: 'reserved',
        runId: 'run-1',
        createdAtIso: minutesAgo(10_000),
        nowIso: NOW,
      }),
      false,
    );
  });

  test('ya confirmada o liberada no es huérfana (no ocupa exposición)', () => {
    for (const status of ['confirmed', 'released'] as const) {
      assert.equal(
        isPhoneRevealCreditReservationOrphan({
          status,
          runId: null,
          createdAtIso: minutesAgo(10_000),
          nowIso: NOW,
        }),
        false,
        status,
      );
    }
  });

  test('una fecha ilegible NO se declara huérfana: no se libera a ciegas', () => {
    assert.equal(
      isPhoneRevealCreditReservationOrphan({
        status: 'reserved',
        runId: null,
        createdAtIso: 'no-es-una-fecha',
        nowIso: NOW,
      }),
      false,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Vocabularios cerrados
// ═══════════════════════════════════════════════════════════════

describe('reserva — vocabularios', () => {
  test('los estados son exactamente reserved | confirmed | released', () => {
    assert.deepEqual([...PHONE_REVEAL_CREDIT_RESERVATION_STATUSES], [
      'reserved',
      'confirmed',
      'released',
    ]);
  });

  test('la procedencia del costo NO admite `unknown`: una confirmación siempre trae cifra', () => {
    assert.deepEqual([...PHONE_REVEAL_CREDIT_RESERVATION_COST_TRUTHS], [
      'reported',
      'assumed_cap',
    ]);
    assert.equal(
      (PHONE_REVEAL_CREDIT_RESERVATION_COST_TRUTHS as readonly string[]).includes('unknown'),
      false,
    );
  });

  test('los motivos de liberación describen SOLO casos de no-ejecución demostrable', () => {
    assert.deepEqual([...PHONE_REVEAL_CREDIT_RESERVATION_RELEASE_REASONS], [
      'run_creation_failed',
      'create_conflict',
      'leg_never_attempted',
      'orphan_sweep',
    ]);
    // Ningún motivo puede significar "el costo era desconocido": eso se confirma.
    assert.equal(
      (PHONE_REVEAL_CREDIT_RESERVATION_RELEASE_REASONS as readonly string[]).some((r) =>
        r.includes('unknown'),
      ),
      false,
    );
  });
});
