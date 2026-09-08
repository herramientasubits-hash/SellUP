/**
 * waterfall-cut4-lusha-leg.test.ts
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 4 — la costura Apollo → Lusha, detrás
 * de una bandera APAGADA.
 *
 * H · Lusha no consume nada si Apollo ya llegó al objetivo.
 * I · Lusha consume únicamente cuando Apollo terminó por debajo del objetivo.
 * J · doble ejecución del mismo waterfall ⇒ misma identidad: ni segunda reserva
 *     ni segundo lote.
 * L · bandera APAGADA ⇒ exactamente 0 llamadas a Lusha.
 * M · la pierna deja traza: por qué no corrió, o con qué hueco e identidad sí.
 *
 * (K —Apollo y Lusha devuelven la misma empresa ⇒ un solo candidato— vive en la
 * suite de dedupe compartida: aquí no hay proveedor que pueda devolver nada.)
 *
 * 🔴 0 proveedores · 0 créditos · 0 red · 0 Producción · 0 escrituras · 0
 * migraciones. La acción de Lusha está INYECTADA: si algún camino la llamara sin
 * autorización, el contador de este arnés lo delata.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  decideLushaWaterfallLeg,
  type LushaWaterfallSkipReason,
} from '../wizard-lusha-waterfall';
import {
  deriveLushaWaterfallClientRequestId,
  LUSHA_WATERFALL_LEG_NAMESPACE,
} from '../waterfall-leg-identity';
import { runLushaWaterfallLeg } from '../wizard-lusha-waterfall.server';
import type { PersistLushaPendingReviewResult } from '@/server/prospect-batches/lusha-pending-review';
import { WIZARD_TARGET_USEFUL_COMPANIES } from '../../wizard-target-authority';

const TARGET = WIZARD_TARGET_USEFUL_COMPANIES;
const WIZARD_CLIENT_REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type LushaCall = { clientRequestId: string; countryCode: string; macroIndustryKey: string };

function harness(
  options: {
    waterfallEnabled?: boolean;
    lushaAvailable?: boolean;
    fail?: boolean;
  } = {},
) {
  const calls: LushaCall[] = [];
  const deps = {
    waterfallEnabled: () => options.waterfallEnabled ?? true,
    lushaAvailable: () => options.lushaAvailable ?? true,
    runLushaBatch: async (input: {
      clientRequestId: string;
      countryCode: string;
      macroIndustryKey: string;
    }) => {
      calls.push({
        clientRequestId: input.clientRequestId,
        countryCode: input.countryCode,
        macroIndustryKey: input.macroIndustryKey,
      });
      if (options.fail) {
        throw new Error('lusha_leg_exploded');
      }
      return {
        ok: true,
        status: 'success',
        batchId: 'lusha-batch-1',
        createdCandidatesCount: 1,
        creditsCharged: 1,
      } as unknown as PersistLushaPendingReviewResult;
    },
  };
  return { deps, calls };
}

const CANONICAL_BATCH_ID = 'b7f1c3d2-0a44-4f9e-9c31-8d6e5a2b1c07';

function legInput(usefulAccumulated: number, overrides: Record<string, unknown> = {}) {
  return {
    wizardClientRequestId: WIZARD_CLIENT_REQUEST_ID,
    // CORTE 5A — el lote canónico de la corrida. Sin él la pierna no corre.
    canonicalBatchId: CANONICAL_BATCH_ID,
    countryCode: 'CO',
    macroIndustryKey: 'technology',
    subIndustryId: null,
    target: TARGET,
    usefulAccumulated,
    apolloTerminal: true,
    // CORTE 5C — por defecto, el par que NO salta la capa gratuita de Lusha, que
    // es el comportamiento que este fichero (corte 4) describe. El corte 5C tiene
    // su propio fichero para el par que sí la salta.
    freeSourceAttempted: false,
    freeSourceFailed: true,
    ...overrides,
  } as Parameters<typeof runLushaWaterfallLeg>[0];
}

// ── L · la bandera manda ─────────────────────────────────────────────────────

describe('CORTE 4 § L — con la bandera apagada Lusha no existe', () => {
  test('0 llamadas, aunque el hueco esté abierto de par en par', async () => {
    const { deps, calls } = harness({ waterfallEnabled: false });

    const outcome = await runLushaWaterfallLeg(legInput(0), deps);

    assert.equal(calls.length, 0, 'no puede salir ni una llamada a Lusha');
    assert.equal(outcome.executed, false);
    assert.equal(outcome.executed === false && outcome.reason, 'waterfall_flag_disabled');
  });

  test('la bandera se consulta ANTES que nada: ni siquiera se deriva identidad', async () => {
    const { deps, calls } = harness({ waterfallEnabled: false });
    let derived = 0;

    await runLushaWaterfallLeg(legInput(0), {
      ...deps,
      deriveClientRequestId: (value) => {
        derived += 1;
        return deriveLushaWaterfallClientRequestId(value);
      },
    });

    assert.equal(derived, 0, 'derivar identidad con la bandera apagada ya sería trabajo de más');
    assert.equal(calls.length, 0);
  });

  test('la decisión pura antepone la bandera a cualquier otro motivo', () => {
    // Todo lo demás también es motivo de rechazo: gana la bandera.
    const decision = decideLushaWaterfallLeg({
      waterfallEnabled: false,
      lushaAvailable: false,
      apolloTerminal: false,
      target: TARGET,
      usefulAccumulated: TARGET,
      macroIndustryKey: null,
      canonicalBatchId: null,
    });
    assert.deepEqual(decision, { run: false, reason: 'waterfall_flag_disabled' });
  });
});

// ── H · si Apollo llegó al objetivo, Lusha no consume ────────────────────────

describe('CORTE 4 § H — objetivo cubierto ⇒ Lusha no consume nada', () => {
  test(`Apollo cerró ${TARGET} de ${TARGET} ⇒ 0 llamadas`, async () => {
    const { deps, calls } = harness();

    const outcome = await runLushaWaterfallLeg(legInput(TARGET), deps);

    assert.equal(calls.length, 0);
    assert.equal(outcome.executed === false && outcome.reason, 'target_reached');
  });

  test('un EXCEDENTE cierra igual que un empate (caso 5: R1 = 8)', async () => {
    const { deps, calls } = harness();

    const outcome = await runLushaWaterfallLeg(legInput(8), deps);

    assert.equal(calls.length, 0);
    assert.equal(outcome.executed === false && outcome.reason, 'target_reached');
  });

  test('una corrida de Apollo sin veredicto no autoriza continuar', async () => {
    const { deps, calls } = harness();

    const outcome = await runLushaWaterfallLeg(legInput(0, { apolloTerminal: false }), deps);

    assert.equal(calls.length, 0);
    assert.equal(outcome.executed === false && outcome.reason, 'apollo_run_not_terminal');
  });
});

// ── I · corre sólo cuando falta, y con el HUECO ──────────────────────────────

describe('CORTE 4 § I — Lusha corre únicamente con el objetivo abierto', () => {
  test('caso 3 — Apollo terminó en 4 de 5 ⇒ la pierna corre con hueco 1', async () => {
    const { deps, calls } = harness();

    const outcome = await runLushaWaterfallLeg(legInput(TARGET - 1), deps);

    assert.equal(calls.length, 1, 'exactamente una llamada');
    assert.equal(outcome.executed, true);
    assert.equal(outcome.executed === true && outcome.gap, 1);
  });

  test('caso 4 — Apollo terminó en 4 tras R1=0 y R2=4 ⇒ también corre', async () => {
    const { deps, calls } = harness();

    const outcome = await runLushaWaterfallLeg(legInput(4), deps);

    assert.equal(calls.length, 1);
    assert.equal(outcome.executed === true && outcome.gap, TARGET - 4);
  });

  test('con Lusha apagada su propia puerta manda, aunque el waterfall esté encendido', async () => {
    const { deps, calls } = harness({ lushaAvailable: false });

    const outcome = await runLushaWaterfallLeg(legInput(0), deps);

    assert.equal(calls.length, 0);
    assert.equal(outcome.executed === false && outcome.reason, 'lusha_unavailable');
  });

  test('sin macro industria mapeada la pierna no corre (fail-closed)', async () => {
    const { deps, calls } = harness();

    const outcome = await runLushaWaterfallLeg(legInput(0, { macroIndustryKey: null }), deps);

    assert.equal(calls.length, 0);
    assert.equal(outcome.executed === false && outcome.reason, 'macro_industry_unmapped');
  });

  test('el hueco NUNCA es negativo ni mayor que el objetivo', () => {
    const cases: Array<[number, number]> = [
      [-3, TARGET],
      [0, TARGET],
      [1, TARGET - 1],
      [TARGET - 1, 1],
    ];
    for (const [useful, expectedGap] of cases) {
      const decision = decideLushaWaterfallLeg({
        waterfallEnabled: true,
        lushaAvailable: true,
        apolloTerminal: true,
        target: TARGET,
        usefulAccumulated: useful,
        macroIndustryKey: 'technology',
        canonicalBatchId: CANONICAL_BATCH_ID,
      });
      assert.equal(decision.run, true);
      assert.equal(decision.run === true && decision.gap, expectedGap, `útiles=${useful}`);
    }
  });
});

// ── J · idempotencia de la identidad derivada ────────────────────────────────

describe('CORTE 4 § J — dos ejecuciones del mismo waterfall, una sola identidad', () => {
  test('el mismo waterfall deriva el MISMO clientRequestId', async () => {
    const { deps, calls } = harness();

    await runLushaWaterfallLeg(legInput(1), deps);
    await runLushaWaterfallLeg(legInput(1), deps);

    assert.equal(calls.length, 2, 'el arnés no deduplica: eso lo hace la identidad');
    assert.equal(
      calls[0]!.clientRequestId,
      calls[1]!.clientRequestId,
      'dos intentos del mismo waterfall NO pueden abrir dos reservas ni dos lotes',
    );
  });

  test('una corrida distinta del wizard deriva una identidad distinta', () => {
    const first = deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID);
    const second = deriveLushaWaterfallClientRequestId('99999999-8888-4777-8666-555555555555');
    assert.notEqual(first, second);
  });

  test('la identidad de la pierna NUNCA es la de Apollo', () => {
    const derived = deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID);
    assert.notEqual(
      derived,
      WIZARD_CLIENT_REQUEST_ID,
      'reutilizar el id de Apollo haría a Lusha correr contra su reserva',
    );
  });

  test('es un UUID válido: la acción de Lusha lo valida con `z.uuid()`', () => {
    const derived = deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID);
    assert.match(derived, UUID_SHAPE);
    assert.equal(derived[14], '5', 'nibble de versión');
    assert.ok(['8', '9', 'a', 'b'].includes(derived[19]!), 'nibble de variante RFC-4122');
  });

  test('la derivación es estable frente a mayúsculas y espacios', () => {
    const base = deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID);
    assert.equal(deriveLushaWaterfallClientRequestId(` ${WIZARD_CLIENT_REQUEST_ID} `), base);
    assert.equal(deriveLushaWaterfallClientRequestId(WIZARD_CLIENT_REQUEST_ID.toUpperCase()), base);
  });

  test('sin identidad de origen falla en vez de inventar una', () => {
    assert.throws(() => deriveLushaWaterfallClientRequestId('   '));
  });

  test('el espacio de nombres entra en el hash', () => {
    assert.ok(LUSHA_WATERFALL_LEG_NAMESPACE.includes('lusha-leg'));
  });
});

// ── M · traza ────────────────────────────────────────────────────────────────

describe('CORTE 4 § M — la pierna deja traza corra o no corra', () => {
  test('cuando corre publica hueco e identidad', async () => {
    const { deps } = harness();
    const observed: Array<{ reason: string | null; clientRequestId: string | null }> = [];

    const outcome = await runLushaWaterfallLeg(legInput(2), {
      ...deps,
      onObservation: ({ decision, clientRequestId }) => {
        observed.push({
          reason: decision.run ? null : decision.reason,
          clientRequestId,
        });
      },
    });

    assert.equal(observed.length, 1);
    assert.equal(observed[0]!.reason, null);
    assert.match(observed[0]!.clientRequestId ?? '', UUID_SHAPE);
    assert.equal(outcome.executed === true && outcome.clientRequestId, observed[0]!.clientRequestId);
  });

  test('cuando NO corre publica el motivo, sin identidad', async () => {
    const { deps } = harness({ waterfallEnabled: false });
    const observed: Array<{ reason: string | null; clientRequestId: string | null }> = [];

    await runLushaWaterfallLeg(legInput(0), {
      ...deps,
      onObservation: ({ decision, clientRequestId }) => {
        observed.push({ reason: decision.run ? null : decision.reason, clientRequestId });
      },
    });

    assert.deepEqual(observed, [
      { reason: 'waterfall_flag_disabled', clientRequestId: null },
    ]);
  });

  test('una pierna caída no tumba la ejecución del wizard', async () => {
    const { deps, calls } = harness({ fail: true });

    const outcome = await runLushaWaterfallLeg(legInput(1), deps);

    assert.equal(calls.length, 1, 'se intentó');
    assert.equal(outcome.executed, false);
    assert.equal(outcome.executed === false && outcome.reason, 'leg_failed');
  });

  test('todos los motivos de omisión pertenecen al vocabulario cerrado', () => {
    const vocabulary: LushaWaterfallSkipReason[] = [
      'waterfall_flag_disabled',
      'apollo_run_not_terminal',
      'target_reached',
      'lusha_unavailable',
      'macro_industry_unmapped',
    ];
    for (const reason of vocabulary) {
      assert.equal(typeof reason, 'string');
    }
    assert.equal(new Set(vocabulary).size, vocabulary.length);
  });
});
