/**
 * cut8-acceptance-reporting-propagation.test.ts — que la verdad de ACEPTACIÓN de
 * CUT-7 llegue entera a las dos superficies que la deben decir: el mago y la
 * metadata durable del lote.
 *
 * AGENT1-LOCAL-CUT8-ACCEPTANCE-REPORTING-PROPAGATION.
 *
 * CUT-7 resolvió cuántos candidatos cuentan hacia el objetivo. Lo que NO hizo
 * —porque no era su corte— fue llevar esa respuesta a ningún sitio donde alguien
 * la pudiera leer: el panel de éxito seguía pintando el objetivo como si fuera
 * el conteo de candidatos, y la base seguía guardando un veredicto derivado de
 * filas. Este corte cierra los dos tramos.
 *
 * Cada bloque lleva su mutación en NEGATIVO: la comprobación de que la guarda
 * se pondría roja si el defecto volviera.
 *
 * Puro: sin DOM, sin red, sin Supabase, sin proveedor, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTRIBUTOR_NOT_RUN,
  ACCEPTED_FOR_TARGET_METADATA_KEY,
  paidAcceptedContributionFromWriterTruth,
  resolveAcceptedForTarget,
  toAcceptedForTargetMetadata,
  toAcceptedForTargetSummary,
  type AcceptedForTargetResult,
} from '@/modules/prospect-batches/accepted-for-target';
import {
  buildWizardAcceptedForTargetSummary,
  NOT_MEASURED_VALUE,
} from '../wizard-target-summary-copy';
import type { ProviderResultDemand } from '@/modules/prospect-batches/prepaid-novelty/provider-result-demand';

// ── Utillería ────────────────────────────────────────────────────────────────

function demand(requestedTarget: number, acceptedBeforeProvider: number): ProviderResultDemand {
  return {
    requestedTarget,
    acceptedBeforeProvider,
    remainingTarget: Math.max(0, requestedTarget - acceptedBeforeProvider),
  } as ProviderResultDemand;
}

/**
 * EL EJEMPLO DEL ENUNCIADO, resuelto por la autoridad canónica y por nadie más:
 * 10 filas durables, 7 aceptadas hacia el objetivo, 3 que faltan.
 *
 * 4 filas gratuitas (4 aceptadas) + 6 filas de pago de las que sólo 3 quedaron
 * completas y válidas ⇒ 10 durables, 7 aceptadas, 3 restantes, objetivo NO
 * alcanzado.
 */
function tenDurableSevenAccepted(): AcceptedForTargetResult {
  return resolveAcceptedForTarget({
    demand: demand(10, 4),
    freePersistedCandidates: 4,
    paid: paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: 3,
      persistedCandidates: 6,
    }),
  });
}

// ── § 1 · el ejemplo canónico ────────────────────────────────────────────────

describe('CUT-8 § 1 — 10 durables / 7 aceptadas / 3 restantes', () => {
  it('la autoridad separa el universo durable del subconjunto aceptado', () => {
    const r = tenDurableSevenAccepted();
    assert.equal(r.persistedTotalCandidates, 10, 'las 10 filas existen y se reportan');
    assert.equal(r.acceptedForTargetTotal, 7);
    assert.equal(r.remainingTarget, 3);
    assert.equal(r.targetReached, false);
    assert.equal(r.requestedTarget, 10, '🔴 el objetivo PEDIDO no se reescribe');
  });

  it('🔴 § E EN NEGATIVO — aceptar := persistidas rompe el ejemplo', () => {
    const r = tenDurableSevenAccepted();
    // La mutación E consistiría en publicar las filas como aceptación.
    const mutated = r.persistedTotalCandidates;
    assert.notEqual(
      mutated,
      r.acceptedForTargetTotal,
      '🔴 si estas dos cifras coincidieran, «persistido = aceptado» pasaría inadvertido',
    );
  });
});

// ── § 3 · la proyección que viaja a la UI ────────────────────────────────────

describe('CUT-8 § 3 — la proyección para la UI no inventa aritmética', () => {
  it('cada campo del resumen es el campo homónimo del resultado canónico', () => {
    const r = tenDurableSevenAccepted();
    const s = toAcceptedForTargetSummary(r);
    assert.deepEqual(s, {
      requestedTarget: r.requestedTarget,
      acceptedForTargetTotal: r.acceptedForTargetTotal,
      remainingTarget: r.remainingTarget,
      targetReached: r.targetReached,
      persistedTotalCandidates: r.persistedTotalCandidates,
      paidAcceptanceMeasured: r.paidAcceptanceMeasured,
    });
  });

  it('🔴 § A EN NEGATIVO — las tres cifras son DISTINTAS y por eso son distinguibles', () => {
    // 🔴 En el ejemplo del enunciado las filas y el objetivo valen los dos 10, y
    // una confusión entre ambos pasaría inadvertida. Por eso el caso que separa
    // las TRES cantidades es el de 12 filas: objetivo 10, aceptadas 10,
    // durables 12. Ahí «objetivo como conteo» y «persistido como aceptado» dejan
    // huella inmediata.
    const s = toAcceptedForTargetSummary(
      resolveAcceptedForTarget({
        demand: demand(10, 4),
        freePersistedCandidates: 4,
        paid: paidAcceptedContributionFromWriterTruth({
          completeValidCandidates: 3,
          persistedCandidates: 8,
        }),
      }),
    );
    assert.equal(s.requestedTarget, 10);
    assert.equal(s.acceptedForTargetTotal, 7);
    assert.equal(s.persistedTotalCandidates, 12);
    assert.notEqual(s.persistedTotalCandidates, s.requestedTarget);
    assert.notEqual(s.acceptedForTargetTotal, s.requestedTarget);
    assert.notEqual(s.acceptedForTargetTotal, s.persistedTotalCandidates);
  });
});

// ── § 4 · el copy del panel ──────────────────────────────────────────────────

describe('CUT-8 § 4 — el resumen que el panel pinta', () => {
  const rows = (input: ReturnType<typeof toAcceptedForTargetSummary>) =>
    Object.fromEntries(
      buildWizardAcceptedForTargetSummary(input).rows.map((r) => [r.key, r.value]),
    );

  it('el ejemplo se lee como 10 guardadas, 7 que cuentan, 3 que faltan, objetivo No', () => {
    const v = rows(toAcceptedForTargetSummary(tenDurableSevenAccepted()));
    assert.equal(v.persisted_candidates, '10');
    assert.equal(v.accepted_for_target, '7');
    assert.equal(v.remaining_target, '3');
    assert.equal(v.target_reached, 'No');
  });

  it('🔴 § D — el resumen NUNCA presenta las filas guardadas como válidas', () => {
    const summary = buildWizardAcceptedForTargetSummary(
      toAcceptedForTargetSummary(tenDurableSevenAccepted()),
    );
    assert.equal(summary.claimsAllPersistedAreValid, false);
    assert.equal(summary.targetReached, false);
  });

  it('objetivo cerrado: 10 de 10 aceptadas ⇒ Sí', () => {
    const r = resolveAcceptedForTarget({
      demand: demand(10, 4),
      freePersistedCandidates: 4,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: 6,
        persistedCandidates: 6,
      }),
    });
    const v = rows(toAcceptedForTargetSummary(r));
    assert.equal(v.accepted_for_target, '10');
    assert.equal(v.remaining_target, '0');
    assert.equal(v.target_reached, 'Sí');
  });
});

// ── § F · no medir no es cero, y no es fallar ────────────────────────────────

describe('CUT-8 § F — la mitad de pago sin medir', () => {
  /** El writer escribió 6 filas y NO publicó su conteo de completitud. */
  const unmeasured = (): AcceptedForTargetResult =>
    resolveAcceptedForTarget({
      demand: demand(10, 4),
      freePersistedCandidates: 4,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: null,
        persistedCandidates: 6,
      }),
    });

  it('la ausencia de medición viaja hasta el resumen', () => {
    const s = toAcceptedForTargetSummary(unmeasured());
    assert.equal(s.paidAcceptanceMeasured, false);
    assert.equal(s.persistedTotalCandidates, 10, '🔴 § 10 — las filas NO se pierden');
  });

  it('🔴 § F — lo no medido se pinta «Sin medir», jamás un cero', () => {
    const summary = buildWizardAcceptedForTargetSummary(toAcceptedForTargetSummary(unmeasured()));
    const v = Object.fromEntries(summary.rows.map((r) => [r.key, r.value]));
    assert.equal(v.accepted_for_target, NOT_MEASURED_VALUE);
    assert.equal(v.remaining_target, NOT_MEASURED_VALUE);
    assert.notEqual(v.accepted_for_target, '0');
    assert.notEqual(v.accepted_for_target, '4');
  });

  it('🔴 § F — no se infiere FALLO de objetivo desde la ausencia de medición', () => {
    const summary = buildWizardAcceptedForTargetSummary(toAcceptedForTargetSummary(unmeasured()));
    const v = Object.fromEntries(summary.rows.map((r) => [r.key, r.value]));
    assert.equal(v.target_reached, NOT_MEASURED_VALUE);
    assert.notEqual(v.target_reached, 'No', '🔴 «no se midió» no es «no se alcanzó»');
    assert.equal(summary.targetReached, null, 'null, nunca false, para un dato ausente');
  });

  it('el «Sí» SÍ sobrevive sin medición: lo gratuito solo ya cerró el objetivo', () => {
    // 10 aceptadas gratis sobre un objetivo de 10. La mitad de pago no midió,
    // pero medirla sólo podría SUMAR: el objetivo está alcanzado de todos modos.
    const r = resolveAcceptedForTarget({
      demand: demand(10, 10),
      freePersistedCandidates: 10,
      paid: paidAcceptedContributionFromWriterTruth({
        completeValidCandidates: null,
        persistedCandidates: 2,
      }),
    });
    const summary = buildWizardAcceptedForTargetSummary(toAcceptedForTargetSummary(r));
    const v = Object.fromEntries(summary.rows.map((x) => [x.key, x.value]));
    assert.equal(r.paidAcceptanceMeasured, false);
    assert.equal(v.target_reached, 'Sí');
    assert.equal(summary.targetReached, true);
    assert.equal(v.accepted_for_target, '10');
  });
});

// ── § I · el universo durable no se recorta ──────────────────────────────────

describe('CUT-8 § I — el universo durable nunca se recorta al subconjunto aceptado', () => {
  it('12 filas gratuitas con objetivo 10: 12 durables, 10 aceptadas', () => {
    const r = resolveAcceptedForTarget({
      demand: demand(10, 12),
      freePersistedCandidates: 12,
      paid: CONTRIBUTOR_NOT_RUN,
    });
    const s = toAcceptedForTargetSummary(r);
    assert.equal(s.persistedTotalCandidates, 12, '🔴 las 12 filas siguen ahí para revisar');
    assert.equal(s.acceptedForTargetTotal, 10, 'nadie acepta más de lo que se pidió');
    assert.equal(s.targetReached, true);
    const v = Object.fromEntries(
      buildWizardAcceptedForTargetSummary(s).rows.map((x) => [x.key, x.value]),
    );
    assert.equal(v.persisted_candidates, '12');
    assert.equal(v.accepted_for_target, '10');
  });
});

// ── § G · la publicación durable usa el resolver canónico ────────────────────

describe('CUT-8 § G — la metadata durable NO recalcula la aceptación', () => {
  it('el bloque publicado es exactamente la serialización del resultado canónico', () => {
    const r = tenDurableSevenAccepted();
    const block = toAcceptedForTargetMetadata(r);
    assert.equal(block.requested_target, 10);
    assert.equal(block.accepted_for_target_total, 7);
    assert.equal(block.remaining_target, 3);
    assert.equal(block.target_reached, false);
    assert.equal(block.persisted_total_candidates, 10);
    assert.equal(block.paid_acceptance_measured, true);
  });

  it('🔴 § H EN NEGATIVO — el bloque no puede afirmar objetivo alcanzado con 7 de 10', () => {
    const block = toAcceptedForTargetMetadata(tenDurableSevenAccepted());
    assert.notEqual(
      block.target_reached,
      true,
      '🔴 10 filas persistidas NO son 10 empresas aceptadas',
    );
  });

  it('la clave del bloque es única y estable', () => {
    assert.equal(ACCEPTED_FOR_TARGET_METADATA_KEY, 'accepted_for_target');
  });
});
