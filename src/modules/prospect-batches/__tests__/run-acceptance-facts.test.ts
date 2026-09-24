/**
 * AGENT1-APOLLO-CONTINUATION-ACCEPTANCE-1 — los hechos de aceptación de una
 * corrida, en forma SERIALIZABLE.
 *
 * Lo que estas pruebas fijan, dicho como defecto: sin ellas, una corrida de
 * Apollo que se pausa y termina en la continuación publica su lote SIN
 * `accepted_for_target`. El lote `c681bfcd` (2026-09-22) es exactamente eso: la
 * primera pasada se pausó sin escribir, y la continuación escribió con un
 * `run_input` leído de JSON, que no puede transportar la FUNCIÓN con la que el
 * mago resolvía la aceptación.
 *
 * La corrección no inventa una aritmética: transporta los DATOS que la función
 * cerraba —la demanda y el aporte gratuito— y la continuación vuelve a llamar a
 * la MISMA `resolveAcceptedForTarget`. Estas pruebas lo demuestran por paridad.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  PAID_ROUTE_NOT_RUN_WRITER_TRUTH,
  buildWriterAcceptedForTargetMetadata,
  paidAcceptedContributionFromWriterTruth,
  parseRunAcceptanceFacts,
  resolveAcceptedForTarget,
  resolveAcceptanceFromRunFacts,
  toAcceptedForTargetMetadata,
  type RunAcceptanceFacts,
} from '../accepted-for-target';
import {
  fullTargetResultDemand,
  resolveProviderResultDemand,
} from '../prepaid-novelty/provider-result-demand';

const FULL: RunAcceptanceFacts = {
  demand: fullTargetResultDemand(5),
  freePersistedCandidates: 0,
};

const WITH_FREE: RunAcceptanceFacts = {
  demand: resolveProviderResultDemand(
    { requestedTarget: 5, acceptedBeforeProvider: 2, residualGap: 3, providerRequired: true },
    5,
  ),
  freePersistedCandidates: 2,
};

const WRITER_OUTCOMES = [
  { completeValidCandidates: null, persistedCandidates: 0, reviewOnlyCandidates: null },
  { completeValidCandidates: null, persistedCandidates: 2, reviewOnlyCandidates: null },
  { completeValidCandidates: 0, persistedCandidates: 2, reviewOnlyCandidates: 2 },
  { completeValidCandidates: 3, persistedCandidates: 5, reviewOnlyCandidates: 2 },
  { completeValidCandidates: 8, persistedCandidates: 8, reviewOnlyCandidates: 0 },
] as const;

/**
 * La expresión que el mago tenía escrita en línea antes de este corte, copiada
 * tal cual. Es la referencia contra la que se mide la paridad.
 */
function inlineWizardExpression(
  facts: RunAcceptanceFacts,
  outcome: { completeValidCandidates: number | null; persistedCandidates: number },
): Record<string, unknown> {
  return {
    [ACCEPTED_FOR_TARGET_METADATA_KEY]: toAcceptedForTargetMetadata(
      resolveAcceptedForTarget({
        demand: facts.demand,
        freePersistedCandidates: facts.freePersistedCandidates,
        paid: paidAcceptedContributionFromWriterTruth({
          completeValidCandidates: outcome.completeValidCandidates,
          persistedCandidates: outcome.persistedCandidates,
        }),
        paidWaterfall: paidAcceptedContributionFromWriterTruth(PAID_ROUTE_NOT_RUN_WRITER_TRUTH),
        persistedUniqueCeiling: null,
      }),
    ),
  };
}

describe('§ 1 — una sola autoridad: los hechos reproducen la expresión del mago', () => {
  for (const [label, facts] of [
    ['sin capa gratuita', FULL],
    ['con aporte gratuito', WITH_FREE],
  ] as const) {
    for (const outcome of WRITER_OUTCOMES) {
      test(`${label} · cvc=${String(outcome.completeValidCandidates)} persistidas=${outcome.persistedCandidates}`, () => {
        assert.deepEqual(
          buildWriterAcceptedForTargetMetadata(facts, outcome),
          inlineWizardExpression(facts, outcome),
        );
      });
    }
  }

  test('`resolveAcceptanceFromRunFacts` con la pierna Lusha y el techo sigue siendo `resolveAcceptedForTarget`', () => {
    const paid = { completeValidCandidates: 1, persistedCandidates: 2 };
    const waterfall = { completeValidCandidates: 2, persistedCandidates: 3 };
    assert.deepEqual(
      resolveAcceptanceFromRunFacts(WITH_FREE, paid, waterfall, 7),
      resolveAcceptedForTarget({
        demand: WITH_FREE.demand,
        freePersistedCandidates: WITH_FREE.freePersistedCandidates,
        paid: paidAcceptedContributionFromWriterTruth(paid),
        paidWaterfall: paidAcceptedContributionFromWriterTruth(waterfall),
        persistedUniqueCeiling: 7,
      }),
    );
  });

  test('🔴 `null` en `completeValidCandidates` sigue siendo «no medido», nunca las persistidas', () => {
    const block = buildWriterAcceptedForTargetMetadata(FULL, {
      completeValidCandidates: null,
      persistedCandidates: 2,
    })[ACCEPTED_FOR_TARGET_METADATA_KEY] as Record<string, unknown>;
    assert.equal(block.accepted_paid_for_target, 0);
    assert.equal(block.paid_acceptance_measured, false);
  });
});

describe('§ 2 — los hechos sobreviven al viaje por JSON, que es por donde pasa la cola', () => {
  test('ida y vuelta por JSON ⇒ los mismos hechos, campo por campo', () => {
    for (const facts of [FULL, WITH_FREE]) {
      assert.deepEqual(parseRunAcceptanceFacts(JSON.parse(JSON.stringify(facts))), facts);
    }
  });

  test('las claves de más se ignoran: lo que sale es sólo lo que la aceptación usa', () => {
    const noisy = JSON.parse(JSON.stringify({ ...WITH_FREE, extra: 'x', demand: { ...WITH_FREE.demand, extra: 1 } }));
    assert.deepEqual(parseRunAcceptanceFacts(noisy), WITH_FREE);
  });
});

describe('§ 3 — lo que llega de la base es dato NO confiable: se valida, y si no cuadra NO se inventa', () => {
  const valid = JSON.parse(JSON.stringify(WITH_FREE)) as Record<string, unknown>;
  const demand = valid.demand as Record<string, unknown>;
  const broken: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['un texto', 'facts'],
    ['un array', [WITH_FREE]],
    ['sin demanda', { freePersistedCandidates: 2 }],
    ['demanda no objeto', { demand: 5, freePersistedCandidates: 2 }],
    ['objetivo negativo', { ...valid, demand: { ...demand, requestedTarget: -1 } }],
    ['objetivo decimal', { ...valid, demand: { ...demand, requestedTarget: 4.5 } }],
    ['objetivo como texto', { ...valid, demand: { ...demand, requestedTarget: '5' } }],
    ['hueco mayor que el objetivo', { ...valid, demand: { ...demand, remainingTarget: 6 } }],
    ['aceptadas previas mayores que el objetivo', { ...valid, demand: { ...demand, acceptedBeforeProvider: 6 } }],
    ['`providerRequired` que contradice su propio hueco', { ...valid, demand: { ...demand, providerRequired: false } }],
    ['`providerRequired` no booleano', { ...valid, demand: { ...demand, providerRequired: 'true' } }],
    ['origen desconocido', { ...valid, demand: { ...demand, source: 'otro' } }],
    ['aporte gratuito negativo', { ...valid, freePersistedCandidates: -2 }],
    ['aporte gratuito ausente', { demand }],
  ];
  for (const [label, value] of broken) {
    test(`${label} ⇒ null, sin lanzar`, () => {
      assert.equal(parseRunAcceptanceFacts(value), null);
    });
  }
});
