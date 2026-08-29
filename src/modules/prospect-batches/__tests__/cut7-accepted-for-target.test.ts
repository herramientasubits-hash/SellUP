/**
 * cut7-accepted-for-target.test.ts — la autoridad ÚNICA sobre cuántos candidatos
 * cuentan hacia el objetivo del usuario.
 *
 * AGENT1-LOCAL-CUT7-ACCEPTED-FOR-TARGET §§ 1, 4, 5, 6, 9, 10, 16, 17.
 *
 * ── Lo que se congela ────────────────────────────────────────────────────────
 *
 *   accepted_for_target_total = accepted_free + accepted_paid
 *   0 <= accepted_for_target_total <= requestedTarget
 *   remainingTarget = max(0, requestedTarget - accepted_for_target_total)
 *
 * y, sobre todo, que NINGUNA de esas cifras sea `persistedCount`.
 *
 * ── 🔴 Las demandas se CONSTRUYEN con la función real ────────────────────────
 *
 * Ningún caso escribe a mano un `ProviderResultDemand`. Todos salen de
 * `resolveProviderResultDemand` / `fullTargetResultDemand`, que es la autoridad
 * de la mitad gratuita en producción. Un objeto literal pasaría igual con el
 * hilo cortado.
 *
 * Puro: sin Supabase, sin proveedores, sin red, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTRIBUTOR_NOT_RUN,
  paidAcceptedContributionFromWriterTruth,
  resolveAcceptedForTarget,
  toAcceptedForTargetMetadata,
  type AcceptedContribution,
} from '../accepted-for-target';
import {
  fullTargetResultDemand,
  resolveProviderResultDemand,
} from '../prepaid-novelty/provider-result-demand';
import {
  buildPrePaidNoveltyContext,
  withFreeSourcePersistenceOutcome,
} from '../prepaid-novelty/prepaid-novelty-context';

const TARGET = 10;

/**
 * La demanda que la ruta de pago recibe cuando la capa gratuita aceptó
 * `acceptedFree` empresas. Sale de la autoridad real, no de un literal.
 */
function demandAfterFree(acceptedFree: number, requestedTarget = TARGET) {
  return resolveProviderResultDemand(
    {
      requestedTarget,
      acceptedBeforeProvider: acceptedFree,
      residualGap: Math.max(0, requestedTarget - acceptedFree),
      providerRequired: requestedTarget - acceptedFree > 0,
    },
    requestedTarget,
  );
}

/** Aporte de pago MEDIDO: `raw` filas escritas, `accepted` de ellas completas. */
function paidMeasured(accepted: number, persisted: number): AcceptedContribution {
  return paidAcceptedContributionFromWriterTruth({
    completeValidCandidates: accepted,
    persistedCandidates: persisted,
  });
}

// ── § 9 · los cuatro casos del enunciado ─────────────────────────────────────

describe('CUT-7 § 9 · la política de completitud', () => {
  it('CASO A — free acepta el objetivo entero ⇒ hueco 0 y objetivo alcanzado', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(TARGET),
      freePersistedCandidates: TARGET,
      paid: CONTRIBUTOR_NOT_RUN,
    });

    assert.equal(result.acceptedFreeForTarget, TARGET);
    assert.equal(result.acceptedPaidForTarget, 0);
    assert.equal(result.acceptedForTargetTotal, TARGET);
    assert.equal(result.remainingTarget, 0, '🔴 sin hueco no hay ruta de pago que autorizar');
    assert.equal(result.targetReached, true);
  });

  it('CASO B — free PERSISTE 10 y ACEPTA 7 ⇒ hueco 3, y la ruta de pago sigue viva', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(7),
      freePersistedCandidates: 10,
      paid: CONTRIBUTOR_NOT_RUN,
    });

    assert.equal(
      result.persistedFreeCandidates,
      10,
      '🔴 § 10 — las 10 filas siguen existiendo: nada se borra para cuadrar',
    );
    assert.equal(result.acceptedFreeForTarget, 7);
    assert.equal(result.acceptedForTargetTotal, 7);
    assert.equal(result.remainingTarget, 3, '🔴 el hueco lo fija lo ACEPTADO, no lo persistido');
    assert.equal(result.targetReached, false, '🔴 10 filas NO son 10 empresas');
  });

  it('CASO C — free 4 + paid 8 crudas de las que sólo 4 cuentan ⇒ total 8, nunca 10', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(4),
      freePersistedCandidates: 4,
      // 8 filas escritas; 4 son duplicados o filas de sólo revisión.
      paid: paidMeasured(4, 8),
    });

    assert.equal(result.acceptedPaidForTarget, 4);
    assert.equal(result.acceptedForTargetTotal, 8, '🔴 4 + 4, jamás 4 + 8');
    assert.equal(result.persistedTotalCandidates, 12, '§ 10 — el universo durable es OTRA cifra');
    assert.equal(result.remainingTarget, 2);
    assert.equal(result.targetReached, false);
  });

  it('CASO D — paid acepta MÁS que el hueco ⇒ se recorta al hueco, total exacto', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(4),
      freePersistedCandidates: 4,
      paid: paidMeasured(9, 9),
    });

    assert.equal(result.acceptedPaidForTarget, 6, '🔴 el hueco era 6: no se acepta un séptimo');
    assert.equal(result.acceptedForTargetTotal, TARGET);
    assert.equal(result.remainingTarget, 0);
    assert.equal(result.targetReached, true);
  });
});

// ── § 16 · cobertura mínima ──────────────────────────────────────────────────

describe('CUT-7 § 16 · invariantes de la ecuación', () => {
  it('16.3 — free 4 + paid 6 ⇒ total 10 y objetivo alcanzado', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(4),
      freePersistedCandidates: 4,
      paid: paidMeasured(6, 6),
    });
    assert.equal(result.acceptedForTargetTotal, TARGET);
    assert.equal(result.targetReached, true);
  });

  it('16.4 — free 4 + paid 6 crudas con 2 duplicados ⇒ 8, no 10', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(4),
      freePersistedCandidates: 4,
      // El writer escribió 4: los 2 duplicados no llegaron a ser fila.
      paid: paidMeasured(4, 4),
    });
    assert.equal(result.acceptedForTargetTotal, 8);
    assert.equal(result.targetReached, false);
  });

  it('16.5 — persistido y aceptado son campos DISTINTOS y ambos sobreviven', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(3),
      freePersistedCandidates: 5,
      paid: paidMeasured(2, 7),
    });

    assert.equal(result.acceptedFreeForTarget, 3);
    assert.equal(result.persistedFreeCandidates, 5);
    assert.equal(result.acceptedPaidForTarget, 2);
    assert.equal(result.persistedPaidCandidates, 7);
    assert.equal(result.acceptedForTargetTotal, 5);
    assert.equal(result.persistedTotalCandidates, 12);
    assert.notEqual(
      result.acceptedForTargetTotal,
      result.persistedTotalCandidates,
      '🔴 el corte entero consiste en que estas dos cifras no sean la misma',
    );
  });

  it('16.6/16.7 — el total NUNCA excede el objetivo y el hueco NUNCA es negativo', () => {
    for (const free of [0, 3, 7, 10, 14]) {
      for (const paid of [0, 1, 6, 12, 40]) {
        const result = resolveAcceptedForTarget({
          demand: demandAfterFree(free),
          freePersistedCandidates: free,
          paid: paidMeasured(paid, paid),
        });
        assert.ok(
          result.acceptedForTargetTotal <= result.requestedTarget,
          `🔴 sobrellenado con free=${free} paid=${paid}`,
        );
        assert.ok(result.remainingTarget >= 0, `🔴 hueco negativo con free=${free} paid=${paid}`);
        assert.equal(
          result.remainingTarget,
          Math.max(0, result.requestedTarget - result.acceptedForTargetTotal),
          '🔴 el hueco se DERIVA del total aceptado',
        );
      }
    }
  });

  it('un objetivo de 0 NO se declara alcanzado con 0 empresas', () => {
    const result = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(0),
      freePersistedCandidates: 0,
      paid: CONTRIBUTOR_NOT_RUN,
    });
    assert.equal(result.targetReached, false);
  });
});

// ── Fail-closed ──────────────────────────────────────────────────────────────

describe('CUT-7 · no medir no es cumplir', () => {
  it('un pipeline que escribió filas y NO midió completitud aporta CERO', () => {
    const paid = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: null,
      persistedCandidates: 9,
    });
    assert.equal(paid.measured, false);

    const result = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: 0,
      paid,
    });

    assert.equal(result.acceptedPaidForTarget, 0, '🔴 la ausencia NUNCA se sustituye por las filas');
    assert.equal(result.persistedPaidCandidates, 9, '§ 10 — las filas siguen contándose como filas');
    assert.equal(result.targetReached, false);
    assert.deepEqual(result.acceptanceUnknownReasons, ['acceptance_not_measured']);
  });

  it('un pipeline que no escribió NADA sí conoce su aceptación: es cero medido', () => {
    const paid = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: undefined,
      persistedCandidates: 0,
    });
    assert.equal(paid.measured, true, '🔴 cero filas no es una medición ausente');

    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(TARGET),
      freePersistedCandidates: TARGET,
      paid,
    });
    assert.equal(result.targetReached, true, 'la mitad gratuita ya lo había cerrado');
    assert.deepEqual(result.acceptanceUnknownReasons, []);
  });

  it('una aceptación mayor que las filas escritas se recorta a las filas', () => {
    const result = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: 0,
      paid: paidMeasured(8, 3),
    });
    assert.equal(result.acceptedPaidForTarget, 3, '🔴 un aceptado es una FILA, no una promesa');
  });

  it('cifras no finitas o negativas se sanean a 0 en vez de propagarse', () => {
    const result = resolveAcceptedForTarget({
      demand: fullTargetResultDemand(TARGET),
      freePersistedCandidates: Number.NaN,
      paid: paidMeasured(-4, Number.POSITIVE_INFINITY),
    });
    assert.equal(result.acceptedFreeForTarget, 0);
    assert.equal(result.acceptedPaidForTarget, 0);
    assert.equal(result.remainingTarget, TARGET);
  });
});

// ── § 2 · la capa gratuita: persistir sólo puede RECORTAR ────────────────────

describe('CUT-7 § 2 · `withFreeSourcePersistenceOutcome` nunca sube la aceptación', () => {
  const found = buildPrePaidNoveltyContext({
    requestedTarget: TARGET,
    countryCode: 'CO',
    macroIndustryKey: 'health_pharma',
    freeSource: {
      sourceKey: 'co_siis_discovery',
      attempted: true,
      rawReturned: 12,
      macroConfirmed: 7,
      ambiguous: 0,
      rejected: 5,
      sellupKnown: 0,
      hubspotKnown: 0,
      acceptedNovel: 7,
      failed: false,
      failureCode: null,
    },
  });

  it('guardar MENOS de lo aceptado reabre el hueco (comportamiento previo, intacto)', () => {
    const after = withFreeSourcePersistenceOutcome(found, { persistedCount: 2 });
    assert.equal(after.acceptedBeforeProvider, 2);
    assert.equal(after.residualGap, TARGET - 2);
  });

  it('🔴 guardar MÁS filas que lo aceptado NO sube la aceptación', () => {
    const after = withFreeSourcePersistenceOutcome(found, { persistedCount: 10 });
    assert.equal(
      after.acceptedBeforeProvider,
      7,
      '🔴 persistir no acredita aceptación: la acredita la puerta previa al pago',
    );
    assert.equal(after.residualGap, 3, '🔴 el hueco sigue abierto en 3');
  });
});

// ── § 17 · negativos: el corte no es sólo nomenclatura ───────────────────────

describe('CUT-7 § 17 · mutaciones deliberadas', () => {
  const demand = demandAfterFree(4);

  it('NEGATIVO A — `accepted := persisted` produce una respuesta DISTINTA', () => {
    const honest = resolveAcceptedForTarget({
      demand: demandAfterFree(7),
      freePersistedCandidates: 10,
      paid: paidMeasured(3, 6),
    });
    // La mutación: cada mitad cuenta sus FILAS.
    const mutated = honest.persistedFreeCandidates + honest.persistedPaidCandidates;

    assert.equal(honest.acceptedForTargetTotal, 10 - 10 + 7 + 3);
    assert.notEqual(mutated, honest.acceptedForTargetTotal, '🔴 16 filas no son 10 aceptadas');
    assert.equal(honest.targetReached, true);
    assert.ok(mutated > honest.requestedTarget, '🔴 la mutación sobrellenaría el objetivo');
  });

  it('NEGATIVO B — un duplicado no llega a fila y por tanto no cuenta', () => {
    const withDuplicates = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 4,
      paid: paidMeasured(4, 4),
    });
    const withoutDuplicates = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 4,
      paid: paidMeasured(6, 6),
    });
    assert.equal(withDuplicates.acceptedForTargetTotal, 8);
    assert.equal(withoutDuplicates.acceptedForTargetTotal, 10);
    assert.notEqual(
      withDuplicates.targetReached,
      withoutDuplicates.targetReached,
      '🔴 si los duplicados contaran, los dos casos serían indistinguibles',
    );
  });

  it('NEGATIVO C — una fila de SÓLO REVISIÓN no cierra hueco', () => {
    // 6 filas escritas, 2 completas: 4 existen para que alguien las revise.
    const result = resolveAcceptedForTarget({
      demand,
      freePersistedCandidates: 4,
      paid: paidMeasured(2, 6),
    });
    assert.equal(result.persistedPaidCandidates, 6);
    assert.equal(result.acceptedPaidForTarget, 2);
    assert.equal(result.targetReached, false, '🔴 10 filas con 6 aceptadas NO es objetivo cumplido');
  });

  it('NEGATIVO D — `remainingTarget` derivado de las filas daría otro número', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(7),
      freePersistedCandidates: 10,
      paid: CONTRIBUTOR_NOT_RUN,
    });
    const mutated = Math.max(0, result.requestedTarget - result.persistedFreeCandidates);
    assert.equal(result.remainingTarget, 3);
    assert.equal(mutated, 0);
    assert.notEqual(result.remainingTarget, mutated, '🔴 el hueco de las filas cerraría la corrida');
  });

  it('NEGATIVO E — el total no puede exceder el objetivo por mucho que aporten las mitades', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(9),
      freePersistedCandidates: 9,
      paid: paidMeasured(50, 50),
    });
    assert.equal(result.acceptedForTargetTotal, TARGET);
    assert.equal(result.acceptedPaidForTarget, 1);
  });
});

// ── Telemetría ───────────────────────────────────────────────────────────────

describe('CUT-7 · el bloque de metadata', () => {
  it('publica las dos familias de cifras por separado y sin PII', () => {
    const result = resolveAcceptedForTarget({
      demand: demandAfterFree(4),
      freePersistedCandidates: 6,
      paid: paidMeasured(3, 5),
    });
    const meta = toAcceptedForTargetMetadata(result);

    assert.deepEqual(meta, {
      requested_target: 10,
      accepted_free_for_target: 4,
      accepted_paid_for_target: 3,
      accepted_for_target_total: 7,
      remaining_target: 3,
      target_reached: false,
      persisted_free_candidates: 6,
      persisted_paid_candidates: 5,
      persisted_total_candidates: 11,
      paid_acceptance_measured: true,
      acceptance_unknown_reasons: [],
    });
    assert.ok(
      Object.keys(meta).every((key) => key === key.toLowerCase()),
      'snake_case, como el resto de la metadata de corrida',
    );
  });
});
