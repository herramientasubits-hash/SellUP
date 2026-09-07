/**
 * wizard-breakdown-final-dispositions.test.ts
 *
 * AGENT1-WIZARD-BREAKDOWN-FINAL-DISPOSITIONS-1.
 *
 * El defecto que cierra, medido en la corrida real `362a1e98` (Gobierno / CO):
 * el pipeline persistió 18 empresas únicas con disposición nombrada —2
 * `hubspot_duplicate`, 1 `cooldown_active`, 1 `country_rejected`, 4
 * `sector_rejected`, 1 `ownership_domain_rejected`, 8
 * `enrichment_budget_exhausted` y 1 `final_validation_rejected`— y el desglose
 * del wizard mostraba 9 de ellas en «Sin clasificar». No faltaban datos: el
 * agregador sumaba SÓLO los tallies por ronda, que no tienen campo para el tope
 * de enrichment ni para el hueco del writer.
 *
 * El metadata de esta suite es el del lote real, recortado a los campos que el
 * agregador lee. Suite pura: sin React, sin I/O, sin proveedor.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNoNewCandidatesBreakdown,
  buildNoNewCandidatesCompactBreakdown,
  toNoNewCandidatesBreakdownRows,
  NO_NEW_CANDIDATES_BREAKDOWN_LABELS,
} from '../wizard-no-new-candidates-copy';

const OBSERVABILITY_KEY = 'apollo_two_round_discovery';

/**
 * Metadata REAL del lote `362a1e98-c0e9-4608-9bab-b4a10de39186`, tal como quedó
 * en `prospect_batches.metadata.apollo_two_round_discovery`.
 */
const RUN_362A1E98 = {
  [OBSERVABILITY_KEY]: {
    run_metrics: { total_unique_organizations: 18 },
    rounds: [
      {
        round_number: 1,
        duplicate_in_hubspot: 1,
        duplicate_in_sellup: 0,
        cooldown_or_prior_suggestion: 0,
        seen_duplicates: 0,
        country_rejected: 1,
        sector_rejected: 0,
        ownership_rejected: 1,
      },
      {
        round_number: 2,
        duplicate_in_hubspot: 1,
        duplicate_in_sellup: 0,
        cooldown_or_prior_suggestion: 1,
        seen_duplicates: 2,
        country_rejected: 0,
        sector_rejected: 4,
        ownership_rejected: 0,
      },
    ],
    candidate_final_dispositions: {
      total_unique_results: 18,
      unclassified_count: 0,
      breakdown: {
        hubspot_duplicate_final: 2,
        cooldown_final: 1,
        country_rejected_final: 1,
        sector_subindustry_rejected_final: 4,
        ownership_rejected_final: 1,
        enrichment_budget_exhausted_final: 8,
        provisionally_persisted_pending_writer_final: 1,
      },
    },
  },
};

/** La corrida no creó ninguna fila de candidato. */
const NO_CANDIDATES = { candidatesCreatedCount: 0 };

function compactFor(metadata: unknown, totals = NO_CANDIDATES) {
  return buildNoNewCandidatesCompactBreakdown(
    buildNoNewCandidatesBreakdown(metadata, OBSERVABILITY_KEY),
    totals,
  );
}

describe('A — la corrida 362a1e98 explica 18/18 y deja 0 sin clasificar', () => {
  test('cada bucket coincide con la disposición persistida', () => {
    const compact = compactFor(RUN_362A1E98);

    assert.equal(compact.uniqueResultsCount, 18);
    assert.equal(compact.hubspotDuplicateCount, 2);
    assert.equal(compact.sellupDuplicateCount, 0);
    assert.equal(compact.cooldownCount, 1);
    assert.equal(compact.countryRejectedCount, 1);
    assert.equal(compact.sectorRejectedCount, 4);
    assert.equal(compact.ownershipRejectedCount, 1);
    assert.equal(compact.enrichmentBudgetExhaustedCount, 8);
    assert.equal(compact.finalValidationRejectedCount, 1);
    assert.equal(compact.candidatesCreatedCount, 0);
    assert.equal(compact.unclassifiedUniqueResultsCount, 0);
    assert.equal(compact.overCountedUniqueResultsCount, 0);
  });

  test('la suma de destinos es exactamente el total de empresas únicas', () => {
    const compact = compactFor(RUN_362A1E98);

    const destinations =
      compact.hubspotDuplicateCount +
      compact.sellupDuplicateCount +
      compact.cooldownCount +
      compact.countryRejectedCount +
      compact.sectorRejectedCount +
      compact.ownershipRejectedCount +
      compact.enrichmentBudgetExhaustedCount +
      compact.notSelectedForEnrichmentCount +
      compact.targetCapCount +
      compact.insufficientEvidenceNotEnrichedCount +
      compact.finalValidationRejectedCount +
      compact.candidatesCreatedCount;

    assert.equal(destinations, 18);
    assert.equal(destinations, compact.uniqueResultsCount);
  });

  test('las filas que pinta la UI son las de la validación esperada', () => {
    const rows = toNoNewCandidatesBreakdownRows(compactFor(RUN_362A1E98));
    const byLabel = new Map(rows.map((row) => [row.label, row.count]));

    assert.equal(byLabel.get('Empresas únicas encontradas'), 18);
    assert.equal(byLabel.get('Ya existían en HubSpot'), 2);
    assert.equal(byLabel.get('Sugeridas recientemente (en enfriamiento)'), 1);
    assert.equal(byLabel.get('Repeticiones de la misma empresa entre rondas'), 2);
    assert.equal(byLabel.get('Descartadas por país'), 1);
    assert.equal(byLabel.get('Descartadas por sector o subindustria'), 4);
    assert.equal(byLabel.get('Descartadas porque el dominio no acredita a la empresa'), 1);
    assert.equal(byLabel.get('Límite de enriquecimiento alcanzado'), 8);
    assert.equal(byLabel.get('Rechazadas durante validación final'), 1);
    assert.equal(byLabel.get('Candidatos creados'), 0);
    assert.equal(byLabel.get(NO_NEW_CANDIDATES_BREAKDOWN_LABELS.unclassifiedUniqueResultsCount), 0);
  });

  test('«sin clasificar» se pinta en 0 y sin aclaración de avería', () => {
    const rows = toNoNewCandidatesBreakdownRows(compactFor(RUN_362A1E98));
    const unclassified = rows.find((row) => row.key === 'unclassifiedUniqueResultsCount');

    assert.ok(unclassified, 'el cierre en cero tiene que verse, no deducirse');
    assert.equal(unclassified.count, 0);
    assert.equal(unclassified.hint, null);
    assert.equal(rows[rows.length - 1]?.key, 'unclassifiedUniqueResultsCount');
  });
});

describe('B — legacy: sin candidate_final_dispositions, el desglose de antes', () => {
  test('los buckets nuevos quedan en 0 y el residual es el de siempre', () => {
    const block = RUN_362A1E98[OBSERVABILITY_KEY];
    const legacy = compactFor({
      // El mismo bloque, SIN `candidate_final_dispositions`: una corrida
      // anterior a la taxonomía final.
      [OBSERVABILITY_KEY]: { run_metrics: block.run_metrics, rounds: block.rounds },
    });

    assert.equal(legacy.enrichmentBudgetExhaustedCount, 0);
    assert.equal(legacy.notSelectedForEnrichmentCount, 0);
    assert.equal(legacy.targetCapCount, 0);
    assert.equal(legacy.insufficientEvidenceNotEnrichedCount, 0);
    assert.equal(legacy.finalValidationRejectedCount, 0);
    // 18 − (2 + 1 + 1 + 4 + 1) = 9: exactamente lo que la UI mostraba antes.
    assert.equal(legacy.unclassifiedUniqueResultsCount, 9);
  });

  test('un metadata sin bloque de observabilidad tampoco inventa buckets', () => {
    const compact = compactFor({ skipped_recent_count: 3 });

    assert.equal(compact.cooldownCount, 3);
    assert.equal(compact.enrichmentBudgetExhaustedCount, 0);
    assert.equal(compact.finalValidationRejectedCount, 0);
  });

  test('un breakdown con forma inesperada no lanza y no aporta cifras', () => {
    const compact = compactFor({
      [OBSERVABILITY_KEY]: {
        run_metrics: { total_unique_organizations: 2 },
        rounds: [],
        candidate_final_dispositions: { breakdown: 'no-es-un-objeto' },
      },
    });

    assert.equal(compact.enrichmentBudgetExhaustedCount, 0);
    assert.equal(compact.unclassifiedUniqueResultsCount, 2);
  });
});

describe('C — unclassified_final sigue siendo residual de verdad', () => {
  test('la única disposición que nadie sabe nombrar cae en «sin clasificar»', () => {
    const compact = compactFor({
      [OBSERVABILITY_KEY]: {
        run_metrics: { total_unique_organizations: 3 },
        rounds: [{ round_number: 1, country_rejected: 1 }],
        candidate_final_dispositions: {
          total_unique_results: 3,
          unclassified_count: 2,
          breakdown: { country_rejected_final: 1, unclassified_final: 2 },
        },
      },
    });

    assert.equal(compact.unclassifiedUniqueResultsCount, 2);

    const rows = toNoNewCandidatesBreakdownRows(compact);
    const unclassified = rows.find((row) => row.key === 'unclassifiedUniqueResultsCount');
    assert.ok(unclassified);
    assert.equal(unclassified.count, 2);
    assert.ok(unclassified.hint && unclassified.hint.length > 0);
  });
});

describe('D — enrichment_budget_exhausted_final aparece con su nombre', () => {
  test('la fila existe, con su cifra y su etiqueta', () => {
    const rows = toNoNewCandidatesBreakdownRows(compactFor(RUN_362A1E98));
    const row = rows.find((entry) => entry.key === 'enrichmentBudgetExhaustedCount');

    assert.ok(row, 'el tope de enrichment tiene que tener fila propia');
    assert.equal(row.count, 8);
    assert.equal(row.label, 'Límite de enriquecimiento alcanzado');
  });
});

describe('E — provisionally_persisted_pending_writer_final = validación final', () => {
  test('una candidata entregada al writer que no dejó fila se nombra', () => {
    const rows = toNoNewCandidatesBreakdownRows(compactFor(RUN_362A1E98));
    const row = rows.find((entry) => entry.key === 'finalValidationRejectedCount');

    assert.ok(row);
    assert.equal(row.count, 1);
    assert.equal(row.label, 'Rechazadas durante validación final');
  });

  test('cuando el writer SÍ creó la fila, no hay rechazo de validación final', () => {
    const compact = compactFor(RUN_362A1E98, { candidatesCreatedCount: 1 });

    assert.equal(compact.finalValidationRejectedCount, 0);
    assert.equal(compact.candidatesCreatedCount, 1);
    // El universo pre-writer es 1: creada ⇒ no hay hueco, y el desglose sigue
    // cerrando en 18.
    assert.equal(compact.unclassifiedUniqueResultsCount, 0);
    assert.equal(compact.overCountedUniqueResultsCount, 0);
  });
});

describe('F — persisted_review_only_final no se cuenta dos veces', () => {
  test('las dos disposiciones pre-writer se reparten con las filas creadas', () => {
    const metadata = {
      [OBSERVABILITY_KEY]: {
        run_metrics: { total_unique_organizations: 5 },
        rounds: [{ round_number: 1, country_rejected: 2 }],
        candidate_final_dispositions: {
          total_unique_results: 5,
          unclassified_count: 0,
          breakdown: {
            country_rejected_final: 2,
            provisionally_persisted_pending_writer_final: 2,
            persisted_review_only_final: 1,
          },
        },
      },
    };

    // 3 pre-writer, 2 filas creadas ⇒ 1 hueco. Nunca 3 + 2 = 5.
    const compact = compactFor(metadata, { candidatesCreatedCount: 2 });
    assert.equal(compact.finalValidationRejectedCount, 1);
    assert.equal(compact.candidatesCreatedCount, 2);
    assert.equal(compact.unclassifiedUniqueResultsCount, 0);
    assert.equal(compact.overCountedUniqueResultsCount, 0);

    // Con las tres creadas el hueco es 0 y el desglose sigue cerrando.
    const allCreated = compactFor(metadata, { candidatesCreatedCount: 3 });
    assert.equal(allCreated.finalValidationRejectedCount, 0);
    assert.equal(allCreated.unclassifiedUniqueResultsCount, 0);
    assert.equal(allCreated.overCountedUniqueResultsCount, 0);
  });

  test('más filas creadas que pre-writer declaradas nunca da una cifra negativa', () => {
    const compact = compactFor(RUN_362A1E98, { candidatesCreatedCount: 5 });

    assert.equal(compact.finalValidationRejectedCount, 0);
  });
});

describe('G — un bucket nuevo en cero no añade fila', () => {
  test('las disposiciones que no ocurrieron no se pintan', () => {
    const rows = toNoNewCandidatesBreakdownRows(compactFor(RUN_362A1E98));
    const keys = rows.map((row) => row.key);

    assert.equal(keys.includes('notSelectedForEnrichmentCount'), false);
    assert.equal(keys.includes('targetCapCount'), false);
    assert.equal(keys.includes('insufficientEvidenceNotEnrichedCount'), false);
    assert.equal(keys.includes('sellupDuplicateCount'), false);
  });

  test('cuando SÍ ocurren, cada una tiene su etiqueta', () => {
    const compact = compactFor({
      [OBSERVABILITY_KEY]: {
        run_metrics: { total_unique_organizations: 3 },
        rounds: [],
        candidate_final_dispositions: {
          total_unique_results: 3,
          unclassified_count: 0,
          breakdown: {
            not_selected_for_enrichment_final: 1,
            target_cap_final: 1,
            insufficient_evidence_not_enriched_final: 1,
          },
        },
      },
    });

    assert.equal(compact.unclassifiedUniqueResultsCount, 0);

    const byKey = new Map(
      toNoNewCandidatesBreakdownRows(compact).map((row) => [row.key, row.label]),
    );
    assert.equal(
      byKey.get('notSelectedForEnrichmentCount'),
      'No compitieron por enriquecimiento (objetivo ya cubierto)',
    );
    assert.equal(byKey.get('targetCapCount'), 'Fuera por tope de objetivo alcanzado');
    assert.equal(
      byKey.get('insufficientEvidenceNotEnrichedCount'),
      'Sin evidencia suficiente y sin enriquecimiento',
    );
  });
});

describe('H — las repeticiones entre rondas siguen fuera del denominador', () => {
  test('se muestran como tales y no participan en el cierre de las 18', () => {
    const compact = compactFor(RUN_362A1E98);

    assert.equal(compact.repeatedAcrossRoundsCount, 2);
    assert.equal(compact.uniqueResultsCount, 18);
    assert.equal(compact.unclassifiedUniqueResultsCount, 0);
    // Si las repeticiones entraran en la suma, el desglose declararía 20 causas
    // sobre 18 empresas y aparecería un sobreconteo de 2.
    assert.equal(compact.overCountedUniqueResultsCount, 0);
  });

  test('subir las repeticiones no mueve ni el total ni el residual', () => {
    const block = RUN_362A1E98[OBSERVABILITY_KEY];
    const inflated = compactFor({
      [OBSERVABILITY_KEY]: {
        ...block,
        rounds: [block.rounds[0], { ...block.rounds[1], seen_duplicates: 9 }],
      },
    });

    assert.equal(inflated.repeatedAcrossRoundsCount, 9);
    assert.equal(inflated.uniqueResultsCount, 18);
    assert.equal(inflated.unclassifiedUniqueResultsCount, 0);
    assert.equal(inflated.overCountedUniqueResultsCount, 0);
  });

  test('la fila de repeticiones conserva su aclaración', () => {
    const row = toNoNewCandidatesBreakdownRows(compactFor(RUN_362A1E98)).find(
      (entry) => entry.key === 'repeatedAcrossRoundsCount',
    );

    assert.ok(row);
    assert.ok(row.hint && row.hint.length > 0);
  });
});
