/**
 * effective-consumption-core.test.ts — AGENT2A-PHONE-REVEAL-4N
 *
 * La aritmética que decide si se gastan créditos reales, verificada OFFLINE: 0 proveedores,
 * 0 Supabase, 0 créditos. Cubre los casos obligatorios del hito y REPRODUCE las dos corridas
 * live existentes con sus cifras exactas, porque el defecto que este hito cierra apareció
 * precisamente ahí: la reserva confirmada de Apollo (8, `assumed_cap`) no entraba en ningún
 * cálculo, y sumarla sin excluir el usage log de Lusha habría dado 15 sobre un pozo de 10.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectSettledWaterfallLegs,
  computeEffectiveConsumption,
  computeEffectiveConsumptionByProvider,
  WATERFALL_USAGE_CORRELATION_KEY,
  type ReservationSnapshotRow,
  type UsageConsumptionRow,
} from '../effective-consumption-core';

// ── Fixtures ───────────────────────────────────────────────────

/** Ids reales de las dos corridas live (opacos, sin PII). */
const APOLLO_RUN_ID = 'cec34235-0dcd-4032-9467-cb37d073ef8a';
const APOLLO_GROUP_ID = '9387bc05-22b9-4bb9-9556-db6c468b8fb4';
const LUSHA_RUN_ID = '543e40ca-7f8d-43cd-ada9-179fce18b686';
const LUSHA_GROUP_ID = 'f652b311-217b-4164-acc4-12e2bbc92d6e';

function usage(
  overrides: Partial<UsageConsumptionRow> & { providerKey: string },
): UsageConsumptionRow {
  return {
    creditsUsed: null,
    estimatedCostUsd: null,
    waterfallRunId: null,
    ...overrides,
  };
}

function reservation(
  overrides: Partial<ReservationSnapshotRow> & { providerKey: string },
): ReservationSnapshotRow {
  return {
    status: 'confirmed',
    creditsReserved: null,
    creditsConfirmed: null,
    costTruth: null,
    runId: null,
    reservationGroupId: null,
    ...overrides,
  };
}

// ── Casos obligatorios (§ 7) ───────────────────────────────────

describe('§7 — Apollo assumed cap', () => {
  test('usage logs con credits NULL + reserva confirmada de 8 ⇒ consumo efectivo 8', () => {
    // Arrange — los DOS usage logs reales de la corrida (start + webhook), ambos sin cifra.
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({ providerKey: 'apollo', creditsUsed: null, waterfallRunId: APOLLO_RUN_ID }),
        usage({ providerKey: 'apollo', creditsUsed: null, waterfallRunId: APOLLO_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'apollo',
          creditsConfirmed: 8,
          costTruth: 'assumed_cap',
          runId: APOLLO_RUN_ID,
        }),
      ],
    });

    assert.equal(result.credits, 8);
    assert.equal(result.breakdown.usageLogCredits, 0);
    assert.equal(result.breakdown.confirmedReservationCredits, 8);
    // La cifra en créditos es el TOPE asumido, no un costo reportado por Apollo.
    assert.equal(result.breakdown.hasAssumedCapCredits, true);
    // available = limit − 8 (sin exposición viva).
    assert.equal(45 - result.credits - result.reservedCredits, 37);
  });
});

describe('§7 — Lusha reported: NO se cuenta dos veces', () => {
  test('usage log de 5 + reserva confirmada de 5 de la MISMA corrida ⇒ 5, no 10', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({ providerKey: 'lusha', creditsUsed: 5, waterfallRunId: LUSHA_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'lusha',
          creditsConfirmed: 5,
          costTruth: 'reported',
          runId: LUSHA_RUN_ID,
        }),
      ],
    });

    assert.equal(result.credits, 5);
    assert.equal(result.breakdown.excludedUsageLogCredits, 5);
    assert.equal(result.breakdown.excludedUsageLogCount, 1);
    assert.equal(result.breakdown.confirmedReservationCredits, 5);
    assert.equal(result.breakdown.hasAssumedCapCredits, false);
  });
});

describe('§7 — pata liberada', () => {
  test('released con credits_confirmed NULL ⇒ 0 consumo y 0 exposición', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [],
      reservations: [
        reservation({
          providerKey: 'lusha',
          status: 'released',
          creditsReserved: 5,
          creditsConfirmed: null,
          runId: APOLLO_RUN_ID,
        }),
      ],
    });

    assert.equal(result.credits, 0);
    assert.equal(result.reservedCredits, 0);
  });

  test('una pata liberada NO excluye el usage log de esa corrida', () => {
    // Si la pata se liberó, su gasto (si lo hubo) no está representado por ninguna
    // reserva, así que el usage log tiene que seguir contando o el gasto desaparece.
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({ providerKey: 'lusha', creditsUsed: 5, waterfallRunId: APOLLO_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'lusha',
          status: 'released',
          creditsReserved: 5,
          runId: APOLLO_RUN_ID,
        }),
      ],
    });

    assert.equal(result.credits, 5);
    assert.equal(result.breakdown.excludedUsageLogCount, 0);
  });
});

describe('§7 — reserva activa', () => {
  test('reserved ⇒ exposición = tope, consumo 0 por esa fila', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [],
      reservations: [
        reservation({ providerKey: 'apollo', status: 'reserved', creditsReserved: 8 }),
      ],
    });

    assert.equal(result.credits, 0);
    assert.equal(result.reservedCredits, 8);
    // available = limit − consumed − reserved
    assert.equal(45 - result.credits - result.reservedCredits, 37);
  });
});

describe('§7 — corrida terminal reconciliada dos veces', () => {
  test('el consumo efectivo se cuenta UNA sola vez', () => {
    // La reconciliación es idempotente: el índice único (grupo, proveedor) impide una
    // segunda fila y `confirm` devuelve `already_confirmed`. El snapshot, por tanto, sigue
    // teniendo UNA fila por pata por muchas veces que se reconcilie.
    const reservations: ReservationSnapshotRow[] = [
      reservation({
        providerKey: 'apollo',
        creditsConfirmed: 8,
        costTruth: 'assumed_cap',
        runId: APOLLO_RUN_ID,
        reservationGroupId: APOLLO_GROUP_ID,
      }),
    ];
    const usageLogs = [
      usage({ providerKey: 'apollo', waterfallRunId: APOLLO_RUN_ID }),
      usage({ providerKey: 'apollo', waterfallRunId: APOLLO_RUN_ID }),
    ];

    const first = computeEffectiveConsumption({ usageLogs, reservations });
    const second = computeEffectiveConsumption({ usageLogs, reservations });

    assert.equal(first.credits, 8);
    assert.equal(second.credits, 8);
  });
});

describe('§7 — usage log histórico sin waterfall', () => {
  test('sigue entrando en el consumo', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [
        // Lusha histórico (2026-08-03), sin correlación de corrida.
        usage({ providerKey: 'lusha', creditsUsed: 5, waterfallRunId: null }),
      ],
      reservations: [],
    });

    assert.equal(result.credits, 5);
    assert.equal(result.breakdown.usageLogCredits, 5);
    assert.equal(result.breakdown.excludedUsageLogCount, 0);
  });

  test('un reveal histórico de Apollo sin corrida tampoco se excluye', () => {
    // Los 5 `person_phone_reveal` del 2026-08-04 no tienen corrida. Sus créditos son NULL,
    // así que aportan 0, pero la razón importa: no se excluyen, simplemente no traen cifra.
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({ providerKey: 'apollo', creditsUsed: null, waterfallRunId: null }),
        usage({ providerKey: 'apollo', creditsUsed: 3, waterfallRunId: null }),
      ],
      reservations: [],
    });

    assert.equal(result.credits, 3);
    assert.equal(result.breakdown.excludedUsageLogCount, 0);
  });
});

describe('§7 — dos fases de Apollo', () => {
  test('start + webhook de la misma corrida no cuentan dos llamadas ni dos costos', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({ providerKey: 'apollo', creditsUsed: 8, waterfallRunId: APOLLO_RUN_ID }),
        usage({ providerKey: 'apollo', creditsUsed: 8, waterfallRunId: APOLLO_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'apollo',
          creditsConfirmed: 8,
          costTruth: 'reported',
          runId: APOLLO_RUN_ID,
        }),
      ],
    });

    // Las dos filas se excluyen; la reserva cuenta una vez.
    assert.equal(result.credits, 8);
    assert.equal(result.breakdown.excludedUsageLogCount, 2);
    assert.equal(result.breakdown.excludedUsageLogCredits, 16);
  });
});

// ── Aislamiento entre pozos ────────────────────────────────────

describe('la exclusión es por pata, no por corrida', () => {
  test('una reserva de Lusha NO cancela el usage log de Apollo de la misma corrida', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({ providerKey: 'apollo', creditsUsed: 8, waterfallRunId: APOLLO_RUN_ID }),
        usage({ providerKey: 'lusha', creditsUsed: 5, waterfallRunId: APOLLO_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'lusha',
          creditsConfirmed: 5,
          costTruth: 'reported',
          runId: APOLLO_RUN_ID,
        }),
      ],
    });

    // Apollo sigue contando sus 8 del log; Lusha aporta 5 vía reserva y excluye su log.
    assert.equal(result.credits, 13);
    assert.equal(result.breakdown.usageLogCredits, 8);
    assert.equal(result.breakdown.confirmedReservationCredits, 5);
  });
});

// ── Asociación reserva ↔ corrida ───────────────────────────────

describe('correlación por grupo cuando run_id no se escribió', () => {
  test('la huella autoritativa (grupo → corrida) también excluye', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({ providerKey: 'lusha', creditsUsed: 5, waterfallRunId: LUSHA_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'lusha',
          creditsConfirmed: 5,
          costTruth: 'reported',
          // run_id ausente: es el lado de conveniencia y puede no haberse escrito.
          runId: null,
          reservationGroupId: LUSHA_GROUP_ID,
        }),
      ],
      runIdByReservationGroupId: new Map([[LUSHA_GROUP_ID, LUSHA_RUN_ID]]),
    });

    assert.equal(result.credits, 5);
    assert.equal(result.breakdown.excludedUsageLogCount, 1);
  });

  test('sin mapa de grupos NO se pierde gasto: se cuenta de más, nunca de menos', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({ providerKey: 'lusha', creditsUsed: 5, waterfallRunId: LUSHA_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'lusha',
          creditsConfirmed: 5,
          costTruth: 'reported',
          runId: null,
          reservationGroupId: LUSHA_GROUP_ID,
        }),
      ],
      // El mapa no se pudo resolver (tabla de corridas ilegible).
    });

    // 5 del log + 5 de la reserva: sobre-cuenta. Bloquear es recuperable; regalar no.
    assert.equal(result.credits, 10);
  });

  test('collectSettledWaterfallLegs solo mira reservas confirmadas', () => {
    const settled = collectSettledWaterfallLegs({
      reservations: [
        reservation({ providerKey: 'apollo', status: 'reserved', runId: APOLLO_RUN_ID }),
        reservation({ providerKey: 'lusha', status: 'released', runId: APOLLO_RUN_ID }),
      ],
    });

    assert.equal(settled.size, 0);
  });
});

// ── USD ────────────────────────────────────────────────────────

describe('USD nunca se excluye', () => {
  test('un log excluido de créditos SIGUE aportando su dólar reportado', () => {
    // Las reservas no llevan USD: descartar el dólar de un log excluido lo perdería sin
    // que nada lo reemplace.
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({
          providerKey: 'lusha',
          creditsUsed: 5,
          estimatedCostUsd: 0.42,
          waterfallRunId: LUSHA_RUN_ID,
        }),
      ],
      reservations: [
        reservation({
          providerKey: 'lusha',
          creditsConfirmed: 5,
          costTruth: 'reported',
          runId: LUSHA_RUN_ID,
        }),
      ],
    });

    assert.equal(result.credits, 5);
    assert.equal(result.usd, 0.42);
    assert.equal(result.hasUnknownCost, false);
  });

  test('estimated_cost_usd NULL marca hasUnknownCost aunque el log esté excluido', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [
        usage({ providerKey: 'apollo', estimatedCostUsd: null, waterfallRunId: APOLLO_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'apollo',
          creditsConfirmed: 8,
          costTruth: 'assumed_cap',
          runId: APOLLO_RUN_ID,
        }),
      ],
    });

    assert.equal(result.usd, 0);
    assert.equal(result.hasUnknownCost, true);
  });
});

// ── Cifras rotas ───────────────────────────────────────────────

describe('cifras no legibles', () => {
  test('una confirmada sin cifra cuenta 0 pero queda VISIBLE, no desaparece', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [],
      reservations: [
        reservation({ providerKey: 'apollo', status: 'confirmed', creditsConfirmed: null }),
      ],
    });

    assert.equal(result.credits, 0);
    assert.equal(result.breakdown.malformedConfirmedReservationCount, 1);
  });

  test('NaN en credits_used no envenena el total', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [usage({ providerKey: 'apollo', creditsUsed: Number.NaN })],
      reservations: [],
    });

    assert.equal(result.credits, 0);
    assert.ok(Number.isFinite(result.credits));
  });

  test('una reserva activa sin cifra no libera disponibilidad', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [],
      reservations: [
        reservation({ providerKey: 'apollo', status: 'reserved', creditsReserved: null }),
      ],
    });

    // No se puede sumar lo que no se puede leer, pero tampoco se resta nada del pozo.
    assert.equal(result.reservedCredits, 0);
    assert.ok(Number.isFinite(result.reservedCredits));
  });
});

// ── Replay de las corridas live (§ 3 del reporte) ──────────────

describe('replay de los fixtures live de Producción', () => {
  test('Apollo: 37 no-waterfall + 8 confirmados = 45 efectivos sobre un límite de 45', () => {
    // Arrange — agosto 2026 real: Agente 1 gastó 32 en organizations_search y 5 en
    // organization_enrichment; los 7 `person_phone_reveal` llevan credits_used NULL.
    const usageLogs: UsageConsumptionRow[] = [
      ...Array.from({ length: 8 }, () =>
        usage({ providerKey: 'apollo', creditsUsed: 4 }),
      ), // organizations_search = 32
      ...Array.from({ length: 5 }, () =>
        usage({ providerKey: 'apollo', creditsUsed: 1 }),
      ), // organization_enrichment = 5
      // 5 reveals históricos sin corrida (2026-08-04), sin cifra.
      ...Array.from({ length: 5 }, () => usage({ providerKey: 'apollo', creditsUsed: null })),
      // 2 filas de la corrida waterfall (start + webhook), sin cifra.
      usage({ providerKey: 'apollo', creditsUsed: null, waterfallRunId: APOLLO_RUN_ID }),
      usage({ providerKey: 'apollo', creditsUsed: null, waterfallRunId: APOLLO_RUN_ID }),
    ];

    const result = computeEffectiveConsumption({
      usageLogs,
      reservations: [
        reservation({
          providerKey: 'apollo',
          creditsConfirmed: 8,
          costTruth: 'assumed_cap',
          runId: APOLLO_RUN_ID,
          reservationGroupId: APOLLO_GROUP_ID,
        }),
      ],
    });

    assert.equal(result.breakdown.usageLogCredits, 37);
    assert.equal(result.breakdown.confirmedReservationCredits, 8);
    assert.equal(result.credits, 45);
    assert.equal(result.reservedCredits, 0);
    assert.equal(45 - result.credits - result.reservedCredits, 0, 'available Apollo = 0');
  });

  test('Lusha: 5 históricos + 5 confirmados = 10, NUNCA 15', () => {
    const result = computeEffectiveConsumption({
      usageLogs: [
        // 2026-08-03, sin corrida: consumo histórico.
        usage({ providerKey: 'lusha', creditsUsed: 5, waterfallRunId: null }),
        // 2026-08-05, corrida legacy: Lusha SÍ reportó 5.
        usage({ providerKey: 'lusha', creditsUsed: 5, waterfallRunId: LUSHA_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'lusha',
          creditsConfirmed: 5,
          costTruth: 'reported',
          runId: LUSHA_RUN_ID,
          reservationGroupId: LUSHA_GROUP_ID,
        }),
        // La pata Lusha de la corrida de Apollo se liberó sin intentarse.
        reservation({
          providerKey: 'lusha',
          status: 'released',
          creditsReserved: 5,
          runId: APOLLO_RUN_ID,
          reservationGroupId: APOLLO_GROUP_ID,
        }),
      ],
    });

    assert.equal(result.credits, 10);
    assert.notEqual(result.credits, 15);
    assert.equal(result.breakdown.usageLogCredits, 5);
    assert.equal(result.breakdown.confirmedReservationCredits, 5);
    assert.equal(10 - result.credits - result.reservedCredits, 0, 'available Lusha = 0');
  });

  test('por proveedor, en una pasada: Apollo 45 y Lusha 10 sin cruzarse', () => {
    const byProvider = computeEffectiveConsumptionByProvider({
      usageLogs: [
        usage({ providerKey: 'apollo', creditsUsed: 37 }),
        usage({ providerKey: 'apollo', creditsUsed: null, waterfallRunId: APOLLO_RUN_ID }),
        usage({ providerKey: 'lusha', creditsUsed: 5 }),
        usage({ providerKey: 'lusha', creditsUsed: 5, waterfallRunId: LUSHA_RUN_ID }),
      ],
      reservations: [
        reservation({
          providerKey: 'apollo',
          creditsConfirmed: 8,
          costTruth: 'assumed_cap',
          runId: APOLLO_RUN_ID,
        }),
        reservation({
          providerKey: 'lusha',
          creditsConfirmed: 5,
          costTruth: 'reported',
          runId: LUSHA_RUN_ID,
        }),
      ],
    });

    assert.equal(byProvider.get('apollo')?.credits, 45);
    assert.equal(byProvider.get('lusha')?.credits, 10);
  });
});

// ── Contrato de la clave de correlación ────────────────────────

describe('clave de correlación', () => {
  test('es la que escriben los caminos de gasto del waterfall', () => {
    // Si esta clave cambiara en los writers y no aquí, la exclusión dejaría de aplicarse y
    // el doble conteo volvería en silencio.
    assert.equal(WATERFALL_USAGE_CORRELATION_KEY, 'phone_reveal_waterfall_id');
  });
});
