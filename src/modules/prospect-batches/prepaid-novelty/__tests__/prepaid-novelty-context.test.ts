/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 — el plan previo al pago.
 *
 * Cubre § 14 (hueco residual y su invariante), § 12 (fail-open) y § 13 (sólo lo
 * persistido cierra hueco).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPrePaidNoveltyContext,
  failedFreeSourceOutcome,
  notAttemptedFreeSourceOutcome,
  providerOnlyPrePaidNoveltyContext,
  withFreeSourcePersistenceOutcome,
  type PrePaidFreeSourceOutcome,
} from '../prepaid-novelty-context';

function outcome(overrides: Partial<PrePaidFreeSourceOutcome> = {}): PrePaidFreeSourceOutcome {
  return {
    sourceKey: 'co_siis_discovery',
    attempted: true,
    rawReturned: 0,
    macroConfirmed: 0,
    ambiguous: 0,
    rejected: 0,
    sellupKnown: 0,
    hubspotKnown: 0,
    acceptedNovel: 0,
    failed: false,
    failureCode: null,
    ...overrides,
  };
}

test('§ 14 — el ejemplo del enunciado: 8 crudas, 4 confirmadas, 1 conocida, 1 en HubSpot, 2 nuevas', () => {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: 5,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: outcome({
      rawReturned: 8,
      macroConfirmed: 4,
      sellupKnown: 1,
      hubspotKnown: 1,
      acceptedNovel: 2,
    }),
  });

  assert.equal(context.acceptedBeforeProvider, 2);
  assert.equal(context.residualGap, 3);
  assert.equal(context.providerRequired, true);
  // 🔴 El objetivo del usuario NO se reescribe.
  assert.equal(context.requestedTarget, 5);
});

test('§ 22(A) — la fuente cierra el objetivo entero ⇒ el proveedor NO es necesario', () => {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: 5,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: outcome({ rawReturned: 12, macroConfirmed: 5, acceptedNovel: 5 }),
  });

  assert.equal(context.residualGap, 0);
  assert.equal(context.providerRequired, false);
});

test('§ 22(C) — todo lo que la fuente trajo ya se conocía ⇒ el respaldo de pago se conserva', () => {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: 5,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: outcome({
      rawReturned: 10,
      macroConfirmed: 10,
      sellupKnown: 6,
      hubspotKnown: 4,
      acceptedNovel: 0,
    }),
  });

  assert.equal(context.acceptedBeforeProvider, 0);
  assert.equal(context.residualGap, 5);
  assert.equal(context.providerRequired, true);
});

test('§ 22(F) — la fuente falló ⇒ fail-open, y sus parciales NO reducen el hueco', () => {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: 5,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    // Un desenlace fallido que, además, trae un `acceptedNovel` sucio.
    freeSource: { ...failedFreeSourceOutcome('co_siis_discovery', 'source_unavailable'), acceptedNovel: 4 },
  });

  assert.equal(context.acceptedBeforeProvider, 0);
  assert.equal(context.residualGap, 5);
  assert.equal(context.providerRequired, true);
  assert.equal(context.freeSource.failureCode, 'source_unavailable');
});

test('§ 22(G) — país sin fuente ⇒ el hueco es el objetivo entero y nada se marca como intentado', () => {
  const context = providerOnlyPrePaidNoveltyContext({
    requestedTarget: 5,
    countryCode: 'MX',
    macroIndustryKey: 'health_pharma',
    failureCode: 'country_without_source',
  });

  assert.equal(context.freeSource.attempted, false);
  assert.equal(context.freeSource.sourceKey, null);
  assert.equal(context.residualGap, 5);
  assert.equal(context.providerRequired, true);
});

test('§ 14 — la invariante se cumple por CONSTRUCCIÓN: aceptar de más se recorta al objetivo', () => {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: 5,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: outcome({ acceptedNovel: 9 }),
  });

  assert.equal(context.acceptedBeforeProvider, 5);
  assert.equal(context.residualGap, 0);
  // Nunca negativo: un hueco negativo se propagaría como «pide de más».
  assert.ok(context.residualGap >= 0);
});

test('§ 13 — sólo lo PERSISTIDO cierra hueco: si la escritura guardó menos, el hueco se reabre', () => {
  const found = buildPrePaidNoveltyContext({
    requestedTarget: 5,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: outcome({ macroConfirmed: 5, acceptedNovel: 5 }),
  });
  assert.equal(found.providerRequired, false);

  const persisted = withFreeSourcePersistenceOutcome(found, { persistedCount: 0 });
  assert.equal(persisted.acceptedBeforeProvider, 0);
  assert.equal(persisted.residualGap, 5);
  assert.equal(persisted.providerRequired, true);
  // Los conteos de DESCUBRIMIENTO se conservan: eso sí pasó.
  assert.equal(persisted.freeSource.macroConfirmed, 5);

  const partial = withFreeSourcePersistenceOutcome(found, { persistedCount: 2 });
  assert.equal(partial.residualGap, 3);
});

test('sin fuente intentada el contexto es indistinguible del comportamiento previo al hito', () => {
  const context = buildPrePaidNoveltyContext({
    requestedTarget: 5,
    countryCode: 'CO',
    freeSource: notAttemptedFreeSourceOutcome(),
  });
  assert.equal(context.residualGap, context.requestedTarget);
  assert.equal(context.providerRequired, true);
  assert.deepEqual([...context.knownSuppressionDomains], []);
});
