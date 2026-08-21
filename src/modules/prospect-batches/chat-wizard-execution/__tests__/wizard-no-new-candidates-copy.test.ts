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
  toNoNewCandidatesBreakdownRows,
  IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE,
  NO_NEW_CANDIDATES_BREAKDOWN_LABELS,
  REPEATED_ACROSS_ROUNDS_HINT,
  type NoNewCandidatesBreakdown,
} from '../wizard-no-new-candidates-copy';

const OBSERVABILITY_KEY = 'apollo_two_round_discovery';

const ZERO: NoNewCandidatesBreakdown = {
  hubspotDuplicateCount: 0,
  sellupDuplicateCount: 0,
  cooldownCount: 0,
  repeatedAcrossRoundsCount: 0,
  qualityRejectedCount: 0,
  countryRejectedCount: 0,
  sectorRejectedCount: 0,
  ownershipRejectedCount: 0,
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
      countryRejectedCount: 0,
      sectorRejectedCount: 0,
      ownershipRejectedCount: 0,
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
      countryRejectedCount: 0,
      sectorRejectedCount: 0,
      ownershipRejectedCount: 0,
      noveltyExhausted: true,
    });

    assert.equal(copy.cause, 'novelty_exhausted');
    assert.ok(copy.body.includes('ya fue explorado recientemente'));
  });

  test('una ronda omitida por parámetros idénticos es nota de auditoría, no copy de usuario', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      qualityRejectedCount: 3,
      countryRejectedCount: 0,
      sectorRejectedCount: 0,
      ownershipRejectedCount: 0,
      secondRoundSkippedReason: 'identical_provider_request',
    });

    assert.equal(copy.auditNote, IDENTICAL_PROVIDER_REQUEST_AUDIT_NOTE);
    assert.ok(!copy.body.includes('segunda ronda'), 'el usuario final no lee esto');
  });

  test('otro motivo de omisión no genera nota de auditoría', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      qualityRejectedCount: 1,
      countryRejectedCount: 0,
      sectorRejectedCount: 0,
      ownershipRejectedCount: 0,
      secondRoundSkippedReason: 'target_reached',
    });

    assert.equal(copy.auditNote, null);
  });

  test('conteos negativos o fraccionarios no cambian la causa', () => {
    const copy = resolveNoNewCandidatesCopy({
      ...ZERO,
      cooldownCount: -3,
      qualityRejectedCount: 2.7,
      countryRejectedCount: 0,
      sectorRejectedCount: 0,
      ownershipRejectedCount: 0,
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
  test('ensambla las cifras del § 5 en unidades únicas, con las causas separadas', () => {
    // A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 § 6 — el desglose visible ya no
    // lleva el agregado `qualityRejectedCount`: lleva sus tres partes. Pintar el
    // agregado JUNTO a ellas contaría cada descarte dos veces, y el agregado por
    // sí solo obligaba a adivinar cuál de las tres causas había ocurrido.
    const breakdown: NoNewCandidatesBreakdown = {
      ...ZERO,
      hubspotDuplicateCount: 2,
      sellupDuplicateCount: 1,
      cooldownCount: 1,
      repeatedAcrossRoundsCount: 4,
      qualityRejectedCount: 3,
      countryRejectedCount: 1,
      sectorRejectedCount: 1,
      ownershipRejectedCount: 1,
    };

    const compact = buildNoNewCandidatesCompactBreakdown(breakdown, {
      uniqueResultsCount: 12,
      candidatesCreatedCount: 5,
    });

    // AGENT1-MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § B.6 — el desglose
    // compacto lleva además el guardrail de reconciliación. Aquí cierra:
    // 2+1+1+1+1+1+5 = 12 = empresas únicas, así que ambas cifras valen 0 y
    // ninguna de las dos filas se pintará.
    assert.deepEqual(compact, {
      uniqueResultsCount: 12,
      hubspotDuplicateCount: 2,
      sellupDuplicateCount: 1,
      cooldownCount: 1,
      repeatedAcrossRoundsCount: 4,
      countryRejectedCount: 1,
      sectorRejectedCount: 1,
      ownershipRejectedCount: 1,
      candidatesCreatedCount: 5,
      unclassifiedUniqueResultsCount: 0,
      overCountedUniqueResultsCount: 0,
    });
  });

  test('§ 6 · un descarte por ownership se pinta como ownership, no como calidad', () => {
    // Es el caso de la corrida `be181d2d`: el único descarte era ownership y la
    // única fila visible decía «país, sector o calidad».
    const rows = toNoNewCandidatesBreakdownRows(
      buildNoNewCandidatesCompactBreakdown(
        { ...ZERO, qualityRejectedCount: 1, ownershipRejectedCount: 1 },
        { uniqueResultsCount: 20, candidatesCreatedCount: 2 },
      ),
    );

    const ownershipRow = rows.find((row) => row.key === 'ownershipRejectedCount');
    assert.ok(ownershipRow, 'la fila de ownership debe pintarse');
    assert.equal(ownershipRow.count, 1);
    assert.match(ownershipRow.label, /dominio/);
    // Y ninguna fila de país o sector, porque no ocurrieron.
    assert.equal(rows.some((row) => row.key === 'countryRejectedCount'), false);
    assert.equal(rows.some((row) => row.key === 'sectorRejectedCount'), false);
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
      { ...ZERO, hubspotDuplicateCount: -2, sectorRejectedCount: 2.9 },
      { uniqueResultsCount: -1, candidatesCreatedCount: 0.5 },
    );

    assert.equal(compact.hubspotDuplicateCount, 0);
    assert.equal(compact.sectorRejectedCount, 2);
    assert.equal(compact.uniqueResultsCount, 0);
    assert.equal(compact.candidatesCreatedCount, 0);
  });
});

// ─── § 3 (FIX-1B) · empresas únicas y filas que la UI pinta ───────────────────

describe('§ 3 · empresas ÚNICAS, no resultados crudos', () => {
  test('la cifra sale de run_metrics.total_unique_organizations', () => {
    // Metadata de la corrida live `eae6d47f`: 10 resultados crudos, 5 únicas.
    const breakdown = buildNoNewCandidatesBreakdown(
      {
        [OBSERVABILITY_KEY]: {
          rounds: [
            { duplicate_in_hubspot: 4, seen_duplicates: 0, country_rejected: 0 },
            { duplicate_in_hubspot: 0, seen_duplicates: 5, country_rejected: 0 },
          ],
          run_metrics: { total_raw_results: 10, total_unique_organizations: 5 },
        },
      },
      OBSERVABILITY_KEY,
    );

    assert.equal(breakdown.uniqueResultsCount, 5, 'cinco únicas, nunca diez');
    assert.equal(breakdown.repeatedAcrossRoundsCount, 5);
    assert.equal(breakdown.hubspotDuplicateCount, 4);
  });

  test('un metadata sin run_metrics deja la cifra en 0, no la inventa', () => {
    const breakdown = buildNoNewCandidatesBreakdown(
      { [OBSERVABILITY_KEY]: { rounds: [{ seen_duplicates: 2 }] } },
      OBSERVABILITY_KEY,
    );

    assert.equal(breakdown.uniqueResultsCount, 0);
  });

  test('el desglose compacto toma las únicas del propio desglose si nadie las aporta', () => {
    const compact = buildNoNewCandidatesCompactBreakdown(
      { ...ZERO, uniqueResultsCount: 5, repeatedAcrossRoundsCount: 5 },
      { candidatesCreatedCount: 0 },
    );

    assert.equal(compact.uniqueResultsCount, 5);
    assert.equal(compact.repeatedAcrossRoundsCount, 5);
    assert.notEqual(
      compact.uniqueResultsCount,
      compact.uniqueResultsCount + compact.repeatedAcrossRoundsCount,
      'las repeticiones NUNCA se suman a las empresas únicas',
    );
  });

  test('una cifra ausente no produce NaN en ninguna fila', () => {
    const compact = buildNoNewCandidatesCompactBreakdown(ZERO, { candidatesCreatedCount: 0 });
    for (const value of Object.values(compact)) {
      assert.equal(Number.isFinite(value), true);
    }
  });
});

describe('§ 3 · filas del desglose para la UI', () => {
  test('sólo se listan las causas que ocurrieron, con el marco siempre presente', () => {
    // MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § B.6 — el desglose CIERRA
    // (4 duplicados de HubSpot sobre 4 empresas únicas), así que el guardrail de
    // reconciliación no añade fila y esta prueba sigue midiendo sólo qué causas
    // se listan. Las 5 repeticiones no participan: son eventos, no empresas.
    const rows = toNoNewCandidatesBreakdownRows(
      buildNoNewCandidatesCompactBreakdown(
        { ...ZERO, uniqueResultsCount: 4, hubspotDuplicateCount: 4, repeatedAcrossRoundsCount: 5 },
        { candidatesCreatedCount: 0 },
      ),
    );

    assert.deepEqual(
      rows.map((row) => row.key),
      [
        'uniqueResultsCount',
        'hubspotDuplicateCount',
        'repeatedAcrossRoundsCount',
        'candidatesCreatedCount',
      ],
    );
    assert.equal(rows.find((row) => row.key === 'uniqueResultsCount')?.count, 4);
  });

  test('la fila de repeticiones lleva su aclaración; ninguna otra la lleva', () => {
    const rows = toNoNewCandidatesBreakdownRows(
      buildNoNewCandidatesCompactBreakdown(
        // § B.6 — el desglose cierra (1 cooldown sobre 1 empresa única): sin
        // fila de guardrail, la aclaración sigue siendo exclusiva de las
        // repeticiones.
        { ...ZERO, uniqueResultsCount: 1, cooldownCount: 1, repeatedAcrossRoundsCount: 5 },
        { candidatesCreatedCount: 0 },
      ),
    );

    assert.equal(
      rows.find((row) => row.key === 'repeatedAcrossRoundsCount')?.hint,
      REPEATED_ACROSS_ROUNDS_HINT,
    );
    for (const row of rows.filter((r) => r.key !== 'repeatedAcrossRoundsCount')) {
      assert.equal(row.hint, null);
    }
  });

  test('cada fila trae su etiqueta del catálogo compartido, no un texto propio', () => {
    const rows = toNoNewCandidatesBreakdownRows(
      buildNoNewCandidatesCompactBreakdown(
        { ...ZERO, uniqueResultsCount: 3, sellupDuplicateCount: 2, qualityRejectedCount: 1 },
        { candidatesCreatedCount: 0 },
      ),
    );

    for (const row of rows) {
      assert.equal(row.label, NO_NEW_CANDIDATES_BREAKDOWN_LABELS[row.key]);
      assert.ok(row.label.trim().length > 0);
    }
  });
});
