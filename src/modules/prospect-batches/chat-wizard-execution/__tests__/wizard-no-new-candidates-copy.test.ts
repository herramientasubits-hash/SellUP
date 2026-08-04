/**
 * wizard-no-new-candidates-copy.test.ts — El copy sale de la distribución real.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 · § 8.
 *
 * La corrida QA `edb6f40c` mostró «ya habían sido sugeridos recientemente o no
 * pasaron los filtros de calidad» con `skipped_recent_count = 0` y ninguna
 * empresa sugerida antes. La disyunción describía dos causas sin comprobar
 * ninguna.
 *
 * Offline: puro, sin React ni servidor.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNoNewCandidatesBreakdown,
  resolveNoNewCandidatesCopy,
  IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE,
} from '../wizard-no-new-candidates-copy';

const OBSERVABILITY_KEY = 'apollo_two_round_discovery';

describe('§ 8 · el copy se basa en causas reales', () => {
  test('13a. cero por historial ⇒ se afirma sólo el historial', () => {
    const copy = resolveNoNewCandidatesCopy({
      recentlySuggestedCount: 3,
      qualityRejectedCount: 0,
      noveltyExhausted: false,
    });

    assert.equal(copy.cause, 'all_recently_suggested');
    assert.equal(copy.body, 'Todos los resultados ya habían sido sugeridos recientemente.');
    assert.ok(!copy.body.includes('filtros de calidad'));
  });

  test('13b. cero por calidad ⇒ se afirma sólo la calidad', () => {
    const copy = resolveNoNewCandidatesCopy({
      recentlySuggestedCount: 0,
      qualityRejectedCount: 3,
      noveltyExhausted: false,
    });

    assert.equal(copy.cause, 'all_quality_rejected');
    assert.equal(
      copy.body,
      'Los resultados encontrados no superaron los filtros de país, sector, identidad o calidad.',
    );
    assert.ok(!copy.body.includes('sugeridos'));
  });

  test('13c. mezcla ⇒ se afirman las dos, porque las dos ocurrieron', () => {
    const copy = resolveNoNewCandidatesCopy({
      recentlySuggestedCount: 2,
      qualityRejectedCount: 1,
      noveltyExhausted: false,
    });

    assert.equal(copy.cause, 'mixed');
    assert.equal(
      copy.body,
      'Algunos resultados ya habían sido sugeridos y los demás no superaron los filtros de calidad.',
    );
  });

  test('el defecto observado: con cero y cero NO se afirma que fueron sugeridos', () => {
    const copy = resolveNoNewCandidatesCopy({
      recentlySuggestedCount: 0,
      qualityRejectedCount: 0,
      noveltyExhausted: false,
    });

    assert.equal(copy.cause, 'no_results_at_all');
    assert.ok(!copy.body.includes('sugeridos recientemente'));
    assert.ok(!copy.body.includes('filtros de calidad'));
  });

  test('el universo agotado gana sobre cualquier distribución', () => {
    const copy = resolveNoNewCandidatesCopy({
      recentlySuggestedCount: 4,
      qualityRejectedCount: 4,
      noveltyExhausted: true,
    });

    assert.equal(copy.cause, 'novelty_exhausted');
    assert.ok(copy.body.includes('ya fue explorado recientemente'));
  });

  test('una ronda omitida por parámetros idénticos es nota de auditoría, no copy de usuario', () => {
    const copy = resolveNoNewCandidatesCopy({
      recentlySuggestedCount: 0,
      qualityRejectedCount: 3,
      noveltyExhausted: false,
      secondRoundSkippedReason: 'identical_provider_request',
    });

    assert.equal(copy.auditNote, IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE);
    assert.ok(!copy.body.includes('segunda ronda'), 'el usuario final no lee esto');
  });

  test('otro motivo de omisión no genera nota de auditoría', () => {
    const copy = resolveNoNewCandidatesCopy({
      recentlySuggestedCount: 0,
      qualityRejectedCount: 1,
      noveltyExhausted: false,
      secondRoundSkippedReason: 'target_reached',
    });

    assert.equal(copy.auditNote, null);
  });

  test('conteos negativos o fraccionarios no cambian la causa', () => {
    const copy = resolveNoNewCandidatesCopy({
      recentlySuggestedCount: -3,
      qualityRejectedCount: 2.7,
      noveltyExhausted: false,
    });

    assert.equal(copy.cause, 'all_quality_rejected');
  });
});

describe('§ 8 · la distribución se deriva de la observabilidad real', () => {
  test('la corrida QA reproducida: cero historial, tres por calidad', () => {
    const breakdown = buildNoNewCandidatesBreakdown(
      {
        [OBSERVABILITY_KEY]: {
          second_round_skipped_reason: null,
          rounds: [
            {
              round_number: 1,
              known_company_duplicates: 0,
              seen_duplicates: 0,
              country_rejected: 1,
              sector_rejected: 2,
              ownership_rejected: 0,
            },
          ],
        },
      },
      OBSERVABILITY_KEY,
    );

    assert.equal(breakdown.recentlySuggestedCount, 0);
    assert.equal(breakdown.qualityRejectedCount, 3);
    assert.equal(resolveNoNewCandidatesCopy(breakdown).cause, 'all_quality_rejected');
  });

  test('suma las dos rondas y conserva el motivo de omisión', () => {
    const breakdown = buildNoNewCandidatesBreakdown(
      {
        [OBSERVABILITY_KEY]: {
          second_round_skipped_reason: 'identical_provider_request',
          rounds: [
            {
              round_number: 1,
              known_company_duplicates: 1,
              seen_duplicates: 0,
              country_rejected: 0,
              sector_rejected: 1,
              ownership_rejected: 0,
            },
            {
              round_number: 2,
              known_company_duplicates: 0,
              seen_duplicates: 3,
              country_rejected: 0,
              sector_rejected: 0,
              ownership_rejected: 1,
            },
          ],
        },
      },
      OBSERVABILITY_KEY,
    );

    assert.equal(breakdown.recentlySuggestedCount, 4);
    assert.equal(breakdown.qualityRejectedCount, 2);
    assert.equal(breakdown.secondRoundSkippedReason, 'identical_provider_request');
    assert.equal(resolveNoNewCandidatesCopy(breakdown).cause, 'mixed');
  });

  test('la ruta legacy aporta skipped_recent_count', () => {
    const breakdown = buildNoNewCandidatesBreakdown(
      { skipped_recent_count: 5 },
      OBSERVABILITY_KEY,
    );

    assert.equal(breakdown.recentlySuggestedCount, 5);
    assert.equal(breakdown.qualityRejectedCount, 0);
  });

  test('novelty_exhausted viaja tal cual', () => {
    const breakdown = buildNoNewCandidatesBreakdown(
      { novelty_exhausted: true },
      OBSERVABILITY_KEY,
    );

    assert.equal(breakdown.noveltyExhausted, true);
  });

  test('un metadata con forma inesperada produce ceros, nunca una excepción', () => {
    for (const metadata of [null, undefined, 42, 'texto', { [OBSERVABILITY_KEY]: 'no-es-objeto' }]) {
      const breakdown = buildNoNewCandidatesBreakdown(metadata, OBSERVABILITY_KEY);
      assert.equal(breakdown.recentlySuggestedCount, 0);
      assert.equal(breakdown.qualityRejectedCount, 0);
      assert.equal(resolveNoNewCandidatesCopy(breakdown).cause, 'no_results_at_all');
    }
  });
});
