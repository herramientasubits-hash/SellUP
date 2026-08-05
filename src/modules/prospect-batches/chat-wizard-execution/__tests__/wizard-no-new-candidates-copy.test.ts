/**
 * wizard-no-new-candidates-copy.test.ts — El copy sale de la distribución real,
 * causa por causa.
 *
 * A1-APOLLO-TWO-ROUND-QUERY-QUALITY-2 § 8 · AGENT1-APOLLO-SCALE-AND-SECOND-ROUND-FIX-1 § 8.
 *
 * La corrida QA `edb6f40c` mostró «ya habían sido sugeridos recientemente o no
 * pasaron los filtros de calidad» con `skipped_recent_count = 0` y ninguna
 * empresa sugerida antes. LIVE-QA-2 (`62fdf47b`) fue más sutil: la UI dijo
 * «sugeridos recientemente» sobre tres duplicados de HubSpot que nunca habían
 * sido sugeridos por SellUp. Ninguna disyunción ni ninguna suma sin desglosar
 * puede volver a producir ese texto.
 *
 * Offline: puro, sin React ni servidor.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNoNewCandidatesBreakdown,
  buildNoNewCandidatesCompactBreakdown,
  resolveNoNewCandidatesCopy,
  IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE,
  type NoNewCandidatesBreakdown,
} from '../wizard-no-new-candidates-copy';

const OBSERVABILITY_KEY = 'apollo_two_round_discovery';

const ZERO: NoNewCandidatesBreakdown = {
  hubspotDuplicateCount: 0,
  sellupDuplicateCount: 0,
  cooldownCount: 0,
  repeatedAcrossRoundsCount: 0,
  qualityRejectedCount: 0,
  noveltyExhausted: false,
  secondRoundSkippedReason: null,
};

describe('§ 8 · el copy se basa en causas reales, una por una', () => {
  test('solo cooldown ⇒ causa cooldown, sin mencionar duplicados ni filtros', () => {
    const copy = resolveNoNewCandidatesCopy({ ...ZERO, cooldownCount: 3 });

    assert.equal(copy.cause, 'cooldown');
    assert.equal(copy.body, 'Algunas empresas ya habían sido sugeridas recientemente.');
    assert.ok(!copy.body.includes('SellUp'));
    assert.ok(!copy.body.includes('HubSpot'));
  });

  test('solo HubSpot ⇒ causa duplicates, sin afirmar cooldown', () => {
    const copy = resolveNoNewCandidatesCopy({ ...ZERO, hubspotDuplicateCount: 3 });

    assert.equal(copy.cause, 'duplicates');
    assert.equal(copy.body, 'Los resultados encontrados ya existen en SellUp o HubSpot.');
    assert.ok(!copy.body.includes('sugeridas recientemente'));
  });

  test('solo SellUp ⇒ también causa duplicates', () => {
    const copy = resolveNoNewCandidatesCopy({ ...ZERO, sellupDuplicateCount: 2 });

    assert.equal(copy.cause, 'duplicates');
    assert.equal(copy.body, 'Los resultados encontrados ya existen en SellUp o HubSpot.');
  });

  test('HubSpot + SellUp juntos siguen siendo una sola causa, no mixed', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      hubspotDuplicateCount: 2,
      sellupDuplicateCount: 1,
    });

    assert.equal(copy.cause, 'duplicates');
  });

  test('solo sector/calidad ⇒ causa insufficient_evidence', () => {
    const copy = resolveNoNewCandidatesCopy({ ...ZERO, qualityRejectedCount: 3 });

    assert.equal(copy.cause, 'insufficient_evidence');
    assert.equal(
      copy.body,
      'Las empresas encontradas no cumplieron los criterios de sector y calidad.',
    );
    assert.ok(!copy.body.includes('sugeridas'));
  });

  test('mezcla de causas ⇒ mixed, sin nombrar sólo una', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      cooldownCount: 1,
      hubspotDuplicateCount: 1,
      qualityRejectedCount: 1,
    });

    assert.equal(copy.cause, 'mixed');
    assert.equal(
      copy.body,
      'No se encontraron empresas nuevas que cumplieran todos los criterios. ' +
        'Revisa el desglose de duplicados y validaciones.',
    );
  });

  test('cooldown + duplicados (sin calidad) también es mixed', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      cooldownCount: 2,
      sellupDuplicateCount: 2,
    });

    assert.equal(copy.cause, 'mixed');
  });

  test('repetidos entre rondas NUNCA participa en la causa ni duplica el conteo', () => {
    const soloRepetidos = resolveNoNewCandidatesCopy({
      ...ZERO,
      repeatedAcrossRoundsCount: 5,
    });
    assert.equal(soloRepetidos.cause, 'no_results_at_all');

    const conCausaReal = resolveNoNewCandidatesCopy({
      ...ZERO,
      cooldownCount: 1,
      repeatedAcrossRoundsCount: 5,
    });
    assert.equal(conCausaReal.cause, 'cooldown', 'un número grande de repetidos no vuelve mixed la causa');
  });

  test('el defecto observado: con todo en cero NO se afirma ninguna causa falsa', () => {
    const copy = resolveNoNewCandidatesCopy(ZERO);

    assert.equal(copy.cause, 'no_results_at_all');
    assert.ok(!copy.body.includes('sugeridas'));
    assert.ok(!copy.body.includes('SellUp'));
    assert.ok(!copy.body.includes('HubSpot'));
    assert.ok(!copy.body.includes('criterios de sector'));
  });

  test('el universo agotado gana sobre cualquier distribución', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      cooldownCount: 4,
      hubspotDuplicateCount: 4,
      qualityRejectedCount: 4,
      noveltyExhausted: true,
    });

    assert.equal(copy.cause, 'novelty_exhausted');
    assert.ok(copy.body.includes('ya fue explorado recientemente'));
  });

  test('una ronda omitida por parámetros idénticos es nota de auditoría, no copy de usuario', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      qualityRejectedCount: 3,
      secondRoundSkippedReason: 'identical_provider_request',
    });

    assert.equal(copy.auditNote, IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE);
    assert.ok(!copy.body.includes('segunda ronda'), 'el usuario final no lee esto');
  });

  test('otro motivo de omisión no genera nota de auditoría', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      qualityRejectedCount: 1,
      secondRoundSkippedReason: 'target_reached',
    });

    assert.equal(copy.auditNote, null);
  });

  test('conteos negativos o fraccionarios no cambian la causa', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      cooldownCount: -3,
      qualityRejectedCount: 2.7,
    });

    assert.equal(copy.cause, 'insufficient_evidence');
  });
});

describe('§ 8 · la distribución se deriva de la observabilidad real, sin conflación', () => {
  test('la corrida QA reproducida: cero historial, tres por calidad', () => {
    const breakdown = buildNoNewCandidatesBreakdown(
      {
        [OBSERVABILITY_KEY]: {
          second_round_skipped_reason: null,
          rounds: [
            {
              round_number: 1,
              duplicate_in_hubspot: 0,
              duplicate_in_sellup: 0,
              cooldown_or_prior_suggestion: 0,
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

    assert.equal(breakdown.hubspotDuplicateCount, 0);
    assert.equal(breakdown.sellupDuplicateCount, 0);
    assert.equal(breakdown.cooldownCount, 0);
    assert.equal(breakdown.qualityRejectedCount, 3);
    assert.equal(resolveNoNewCandidatesCopy(breakdown).cause, 'insufficient_evidence');
  });

  test('HubSpot, SellUp y cooldown llegan en cubetas separadas, no sumadas', () => {
    const breakdown = buildNoNewCandidatesBreakdown(
      {
        [OBSERVABILITY_KEY]: {
          second_round_skipped_reason: 'identical_provider_request',
          rounds: [
            {
              round_number: 1,
              duplicate_in_hubspot: 3,
              duplicate_in_sellup: 1,
              cooldown_or_prior_suggestion: 2,
              seen_duplicates: 0,
              country_rejected: 0,
              sector_rejected: 1,
              ownership_rejected: 0,
            },
            {
              round_number: 2,
              duplicate_in_hubspot: 0,
              duplicate_in_sellup: 0,
              cooldown_or_prior_suggestion: 0,
              seen_duplicates: 5,
              country_rejected: 0,
              sector_rejected: 0,
              ownership_rejected: 1,
            },
          ],
        },
      },
      OBSERVABILITY_KEY,
    );

    assert.equal(breakdown.hubspotDuplicateCount, 3);
    assert.equal(breakdown.sellupDuplicateCount, 1);
    assert.equal(breakdown.cooldownCount, 2);
    assert.equal(breakdown.repeatedAcrossRoundsCount, 5);
    assert.equal(breakdown.qualityRejectedCount, 2);
    assert.equal(breakdown.secondRoundSkippedReason, 'identical_provider_request');
    assert.equal(resolveNoNewCandidatesCopy(breakdown).cause, 'mixed');
  });

  test('la ruta legacy aporta skipped_recent_count como cooldown, no como duplicado', () => {
    const breakdown = buildNoNewCandidatesBreakdown(
      { skipped_recent_count: 5 },
      OBSERVABILITY_KEY,
    );

    assert.equal(breakdown.cooldownCount, 5);
    assert.equal(breakdown.hubspotDuplicateCount, 0);
    assert.equal(breakdown.sellupDuplicateCount, 0);
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
      assert.equal(breakdown.hubspotDuplicateCount, 0);
      assert.equal(breakdown.sellupDuplicateCount, 0);
      assert.equal(breakdown.cooldownCount, 0);
      assert.equal(breakdown.qualityRejectedCount, 0);
      assert.equal(resolveNoNewCandidatesCopy(breakdown).cause, 'no_results_at_all');
    }
  });

  test('metadata legacy (sin campos granulares de duplicados) no reparte a ciegas', () => {
    const breakdown = buildNoNewCandidatesBreakdown(
      {
        [OBSERVABILITY_KEY]: {
          rounds: [
            {
              round_number: 1,
              // Escrito antes de este hito: sólo el agregado, sin desglose.
              known_company_duplicates: 3,
              seen_duplicates: 0,
              country_rejected: 0,
              sector_rejected: 0,
              ownership_rejected: 0,
            },
          ],
        },
      },
      OBSERVABILITY_KEY,
    );

    assert.equal(breakdown.hubspotDuplicateCount, 0);
    assert.equal(breakdown.sellupDuplicateCount, 0);
    assert.equal(breakdown.cooldownCount, 0);
  });
});

describe('§ 5 · desglose compacto para la UI', () => {
  test('ensambla las siete cifras del § 5, en unidades únicas', () => {
    const breakdown: NoNewCandidatesBreakdown = {
      ...ZERO,
      hubspotDuplicateCount: 2,
      sellupDuplicateCount: 1,
      cooldownCount: 1,
      repeatedAcrossRoundsCount: 4,
      qualityRejectedCount: 3,
    };

    const compact = buildNoNewCandidatesCompactBreakdown(breakdown, {
      uniqueResultsCount: 12,
      candidatesCreatedCount: 5,
    });

    assert.deepEqual(compact, {
      uniqueResultsCount: 12,
      hubspotDuplicateCount: 2,
      sellupDuplicateCount: 1,
      cooldownCount: 1,
      repeatedAcrossRoundsCount: 4,
      qualityRejectedCount: 3,
      candidatesCreatedCount: 5,
    });
  });

  test('cinco candidatos creados se reflejan en el desglose sin tocar las causas de rechazo', () => {
    const compact = buildNoNewCandidatesCompactBreakdown(ZERO, {
      uniqueResultsCount: 5,
      candidatesCreatedCount: 5,
    });

    assert.equal(compact.candidatesCreatedCount, 5);
    assert.equal(compact.hubspotDuplicateCount, 0);
  });

  test('negativos y fraccionarios se normalizan a enteros no negativos', () => {
    const compact = buildNoNewCandidatesCompactBreakdown(
      { ...ZERO, hubspotDuplicateCount: -2, qualityRejectedCount: 2.9 },
      { uniqueResultsCount: -1, candidatesCreatedCount: 0.5 },
    );

    assert.equal(compact.hubspotDuplicateCount, 0);
    assert.equal(compact.qualityRejectedCount, 2);
    assert.equal(compact.uniqueResultsCount, 0);
    assert.equal(compact.candidatesCreatedCount, 0);
  });
});
