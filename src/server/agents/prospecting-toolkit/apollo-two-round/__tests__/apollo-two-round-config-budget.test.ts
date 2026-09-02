/**
 * Configuración central y presupuesto del peor caso.
 *
 * A1-APOLLO-TWO-ROUND-QUALITY-1 · § 2 y § 10 · casos 18, 19 y 30.
 *
 * Offline: los parsers reciben los valores crudos por parámetro, así que ni un
 * solo test toca `process.env`.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseApolloTwoRoundInt,
  resolveApolloTwoRoundConfig,
  defaultApolloTwoRoundConfig,
  toApolloTwoRoundConfigDiagnostics,
  TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX,
  MAX_SEARCH_ROUNDS_ABSOLUTE_MAX,
  MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
} from '../config';
import {
  estimateApolloTwoRoundBudget,
  buildApolloTwoRoundSpendAccounting,
  BUDGET_EXCEEDED_TWO_ROUND_APOLLO,
} from '../budget';
import { testConfig } from './fixtures';
import {
  APOLLO_PRICING_VERSION,
  APOLLO_PRICING_VERSION_V1_PER_RESULT,
} from '../../apollo-operation-pricing';

// ─── § 2: configuración ───────────────────────────────────────────────────────

describe('§ 2 · configuración central', () => {
  test('los defaults son los del contrato AGENT1-APOLLO-RESIDUAL-AND-PAGE-FENCING: 10 / 2 / 10 / 20 / 2', () => {
    // targetEligibleCompanies y maxResultsPerRound suben a su propio tope
    // absoluto (10) para que la demanda residual del wizard (hasta
    // WIZARD_APOLLO_TARGET_PERSISTIBLE_CANDIDATES=10) no se trunque por un
    // default de QA. maxRawResultsPerRun sube en consecuencia (2 rondas × 10 =
    // 20), vía la MISMA invariante `Math.max(default, alcanzable)` de siempre.
    // maxEnrichmentsPerRun NO cambia: sigue siendo la autoridad de presupuesto.
    assert.deepEqual(defaultApolloTwoRoundConfig(), {
      targetEligibleCompanies: 10,
      maxRounds: 2,
      maxResultsPerRound: 10,
      maxRawResultsPerRun: 20,
      maxEnrichmentsPerRun: 2,
    });
  });

  test('aplica trim y normaliza antes de interpretar', () => {
    const parsed = parseApolloTwoRoundInt('  3  ', {
      fallback: 5,
      absoluteMax: 5,
      allowZero: false,
    });
    assert.deepEqual(parsed, { value: 3, source: 'env_override' });
  });

  test('rechaza negativos, cero inválido y no-enteros con el default seguro', () => {
    const cases: Array<string> = ['-1', '0', '2.5', 'abc', '1e3', '+5', ''];
    for (const raw of cases) {
      const parsed = parseApolloTwoRoundInt(raw, {
        fallback: 5,
        absoluteMax: 5,
        allowZero: false,
      });
      assert.equal(parsed.value, 5, `"${raw}" debería caer al default`);
    }
  });

  test('cero es válido sólo donde significa algo: "no pagues enrichment"', () => {
    const enrichments = parseApolloTwoRoundInt('0', {
      fallback: 2,
      absoluteMax: 2,
      allowZero: true,
    });
    assert.deepEqual(enrichments, { value: 0, source: 'env_override' });

    const rounds = parseApolloTwoRoundInt('0', {
      fallback: 2,
      absoluteMax: 2,
      allowZero: false,
    });
    assert.equal(rounds.value, 2);
    assert.equal(rounds.source, 'env_invalid_fallback_default');
  });

  test('un override nunca supera el tope absoluto: falla hacia ABAJO', () => {
    const resolution = resolveApolloTwoRoundConfig({
      targetEligibleCompanies: '99',
      maxRounds: '7',
      maxResultsPerRound: '50',
      maxRawResultsPerRun: '500',
      maxEnrichmentsPerRun: '25',
    });

    assert.equal(
      resolution.config.targetEligibleCompanies,
      TARGET_ELIGIBLE_COMPANIES_ABSOLUTE_MAX,
    );
    assert.equal(resolution.config.maxRounds, MAX_SEARCH_ROUNDS_ABSOLUTE_MAX);
    assert.equal(resolution.config.maxEnrichmentsPerRun, MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX);
    assert.equal(resolution.sources.maxRounds, 'env_clamped_to_absolute_max');
  });

  test('un override puede BAJAR los límites', () => {
    const resolution = resolveApolloTwoRoundConfig({
      maxRounds: '1',
      maxEnrichmentsPerRun: '0',
    });

    assert.equal(resolution.config.maxRounds, 1);
    assert.equal(resolution.config.maxEnrichmentsPerRun, 0);
  });

  test('el tope de crudos nunca queda por debajo de lo que las rondas pueden traer', () => {
    const resolution = resolveApolloTwoRoundConfig({ maxRawResultsPerRun: '1' });
    // 2 rondas × 10 por ronda = 20 alcanzables: un tope de 1 cortaría la ronda 2
    // a mitad y haría irreproducible el conteo.
    assert.equal(resolution.config.maxRawResultsPerRun, 20);
  });

  test('el diagnóstico expone valores resueltos y su origen, nunca valores crudos', () => {
    const diagnostics = toApolloTwoRoundConfigDiagnostics(
      resolveApolloTwoRoundConfig({ maxRounds: '9' }),
    );

    assert.equal(diagnostics.apollo_target_eligible_companies_resolved, 10);
    assert.equal(diagnostics.apollo_max_search_rounds_resolved, 2);
    assert.equal(diagnostics.apollo_max_results_per_round_resolved, 10);
    assert.equal(diagnostics.apollo_max_raw_results_per_run_resolved, 20);
    assert.equal(diagnostics.apollo_max_enrichments_per_run_resolved, 2);
    assert.equal(
      diagnostics.apollo_two_round_config_sources.max_search_rounds,
      'env_clamped_to_absolute_max',
    );
    // Ningún valor crudo se filtra al diagnóstico.
    assert.ok(!JSON.stringify(diagnostics).includes('"9"'));
  });
});

// ─── § 10: presupuesto ────────────────────────────────────────────────────────

describe('§ 10 · presupuesto', () => {
  test('caso 18 — el máximo interno registrable es doce', () => {
    const breakdown = estimateApolloTwoRoundBudget(testConfig());

    assert.equal(breakdown.searchRound1Maximum, 5);
    assert.equal(breakdown.searchRound2Maximum, 5);
    assert.equal(breakdown.enrichmentMaximum, 2);
    assert.equal(breakdown.maximumInternalRecordedCredits, 12);
  });

  test('caso 19 — el peor caso requerido es el que la reserva tiene que cubrir', () => {
    // A1-APOLLO-TWO-ROUND-QUALITY-1-FINAL-FIX § 10: el bloqueo lo decide la
    // reserva atómica del wizard (`reserveWizardPilotCredits`), que lee el
    // presupuesto disponible y el tope por ejecución dentro de la propia RPC. Lo
    // que este módulo aporta es el NÚMERO que hay que cubrir —el peor caso— y el
    // código explicativo con el que el bloqueo real se anota.
    const breakdown = estimateApolloTwoRoundBudget(testConfig());
    assert.equal(breakdown.maximumInternalRecordedCredits, 12);
    assert.equal(BUDGET_EXCEEDED_TWO_ROUND_APOLLO, 'BUDGET_EXCEEDED_TWO_ROUND_APOLLO');
  });

  test('la reserva NO descuenta la parada temprana', () => {
    // Aunque la ronda 1 pueda completar el objetivo, la reserva cubre las dos:
    // si no, la ronda 2 se quedaría sin cobertura justo cuando hace falta.
    const breakdown = estimateApolloTwoRoundBudget(testConfig());
    assert.equal(breakdown.searchCreditsPerRound.length, 2);
    assert.deepEqual(breakdown.searchCreditsPerRound, [5, 5]);
  });

  test('con el enrichment desactivado el peor caso baja a diez', () => {
    const breakdown = estimateApolloTwoRoundBudget(testConfig({ maxEnrichmentsPerRun: 0 }));
    assert.equal(breakdown.enrichmentMaximum, 0);
    assert.equal(breakdown.maximumInternalRecordedCredits, 10);
  });

  test('caso 30 — confirmedProviderCredits es null sin evidencia externa aislable', () => {
    const accounting = buildApolloTwoRoundSpendAccounting({
      estimatedCredits: 12,
      reservedCredits: 12,
      recordedUsageCredits: 7,
    });

    assert.equal(accounting.confirmedProviderCredits, null);
    // Y NUNCA se deriva del ledger interno, por mucho que éste tenga un número.
    assert.notEqual(accounting.confirmedProviderCredits, accounting.recordedUsageCredits);
  });

  test('las cuatro cantidades se mantienen separadas', () => {
    const accounting = buildApolloTwoRoundSpendAccounting({
      estimatedCredits: 12,
      reservedCredits: 12,
      recordedUsageCredits: 4,
      providerConfirmedEvidence: { credits: 5 },
    });

    assert.deepEqual(accounting, {
      estimatedCredits: 12,
      reservedCredits: 12,
      recordedUsageCredits: 4,
      confirmedProviderCredits: 5,
    });
  });

  test('el pricing sale de la tabla compartida, no de números sueltos', () => {
    const breakdown = estimateApolloTwoRoundBudget(testConfig());
    assert.equal(breakdown.pricingSource, 'apollo_operation_pricing_table');
    // AGENT1-APOLLO-BILLING-MODE-V2 — la versión que la tabla estampa es v2
    // (cobro por página no vacía). Fijar aquí la cadena v1 habría convertido
    // esta prueba en un trinquete que defiende el modelo por resultado.
    assert.equal(breakdown.pricingVersion, APOLLO_PRICING_VERSION);
    assert.notEqual(breakdown.pricingVersion, APOLLO_PRICING_VERSION_V1_PER_RESULT);
  });
});
