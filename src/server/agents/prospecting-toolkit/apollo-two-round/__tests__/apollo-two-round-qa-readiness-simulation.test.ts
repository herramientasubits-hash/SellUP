/**
 * Simulación offline end-to-end del QA de Apollo con dos rondas.
 *
 * A1-APOLLO-TWO-ROUND-QA-READINESS-1 · § 7.
 *
 * Los cinco escenarios (A–E) que la ejecución controlada tiene que poder
 * atravesar, con el caso real del QA: supermercados e hipermercados en Colombia,
 * objetivo de 5 empresas, 5/2/5/10/2.
 *
 * A diferencia de `apollo-two-round-orchestrator.test.ts` —que ejercita las
 * reglas de rondas de forma abstracta— esta suite recorre el escenario COMPLETO
 * y, en el fixture E, cruza el resultado del orquestador con lo que /ai-usage
 * mostraría para esa corrida. Ese cruce es el que evita que una operación con
 * cobro indeterminado termine leyéndose como "0 créditos" en el panel.
 *
 * Offline por construcción: proveedor, gates y enrichment son funciones
 * inyectadas.
 *
 *   LIVE_APOLLO_CALLS = 0
 *   APOLLO_CREDITS_USED = 0
 *   PRODUCTION_WRITES = 0
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
  type EnrichmentResult,
  type RawDiscoveredOrganization,
} from '../orchestrator';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  org,
  orgs,
  passingAssessment,
  ambiguousAssessment,
  rejectedAssessment,
  simulatedEffectiveRequestBuilder,
} from './fixtures';
import {
  resolveUsageCredits,
  aggregateUsageCredits,
  resolveCreditsTotalsDisplay,
  UNKNOWN_CREDITS_LABEL,
} from '@/modules/usage-tracking/credits-display';

// ─── Arnés ────────────────────────────────────────────────────────────────────

type SimulationRecorder = {
  searchCalls: number[];
  enrichCalls: string[];
  /** Lo que el ledger registraría, con la misma forma que una fila económica. */
  usageRows: Array<{ operation_key: string; credits_used: number | null }>;
};

function simulate(options: {
  roundResults: RawDiscoveredOrganization[][];
  assess?: (organization: RawDiscoveredOrganization, roundNumber: number) => CheapAssessment;
  enrich?: (candidateKey: string) => EnrichmentResult;
  searchIndeterminate?: (roundNumber: number) => boolean;
}): { deps: ApolloTwoRoundDeps; recorder: SimulationRecorder } {
  const recorder: SimulationRecorder = { searchCalls: [], enrichCalls: [], usageRows: [] };

  const deps: ApolloTwoRoundDeps = {
    // HARDENING-3 § 6 — la simulación declara EXPLÍCITAMENTE su constructor de
    // request efectivo, igual que producción. Sin él la ronda 2 no se autoriza.
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber }) => {
      recorder.searchCalls.push(roundNumber);
      const organizations = options.roundResults[roundNumber - 1] ?? [];
      const indeterminate = options.searchIndeterminate?.(roundNumber) ?? false;

      // Fila económica tal cual la escribiría el adaptador de producción: con el
      // cobro sin confirmar, `credits_used` queda en NULL A PROPÓSITO. Escribir
      // un 0 ahí sería afirmar que la búsqueda fue gratis.
      recorder.usageRows.push({
        operation_key: 'organizations_search',
        credits_used: indeterminate ? null : organizations.length,
      });

      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: indeterminate ? 0 : organizations.length,
        indeterminate,
      };
    },

    assessCandidate: ({ organization, roundNumber }) =>
      options.assess?.(organization, roundNumber) ?? passingAssessment(),

    enrichCandidate: async ({ candidateKey }) => {
      recorder.enrichCalls.push(candidateKey);
      const outcome = options.enrich?.(candidateKey) ?? {
        executed: true,
        sectorEvidenceState: 'sector_evidence_confirmed' as const,
        internalRecordedCredits: 1,
      };
      recorder.usageRows.push({
        operation_key: 'organization_enrichment',
        credits_used: outcome.indeterminate ? null : outcome.internalRecordedCredits,
      });
      return outcome;
    },
  };

  return { deps, recorder };
}

function run(deps: ApolloTwoRoundDeps) {
  return runApolloTwoRoundDiscovery(
    {
      config: testConfig(),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
    },
    deps,
  );
}

/** Créditos internos registrados por la corrida, sumando sólo lo que se registró. */
function internalCreditsRecorded(recorder: SimulationRecorder): number {
  return recorder.usageRows.reduce(
    (total, row) => total + (row.credits_used ?? 0),
    0,
  );
}

// ─── Fixture A — objetivo alcanzado en la ronda 1 ─────────────────────────────

describe('§ 7 · fixture A — objetivo alcanzado en la ronda 1', () => {
  test('5 raw / 5 únicas / 5 elegibles / 1 ronda / 5 persistidas', async () => {
    const { deps, recorder } = simulate({ roundResults: [orgs('co', 5), orgs('extra', 5)] });

    const result = await run(deps);

    assert.equal(result.runMetrics.totalRawResults, 5);
    assert.equal(result.runMetrics.totalUniqueOrganizations, 5);
    assert.equal(result.eligibleCompaniesFound, 5);
    assert.equal(result.roundsExecuted, 1);
    assert.equal(result.persistedCandidates, 5);
    assert.equal(result.targetReached, true);
    assert.equal(result.resultStatus, 'target_reached');

    // La ronda 2 no se emite: alcanzado el objetivo, no hay más gasto que hacer.
    assert.deepEqual(recorder.searchCalls, [1]);
    assert.equal(recorder.enrichCalls.length, 0);
    assert.ok(internalCreditsRecorded(recorder) <= 12, 'nunca por encima del techo interno');
  });
});

// ─── Fixture B — la segunda ronda completa el objetivo ────────────────────────

describe('§ 7 · fixture B — la ronda 2 completa el objetivo', () => {
  test('3 elegibles en la ronda 1 + 2 nuevas en la ronda 2 = 5 persistidas', async () => {
    const round1 = orgs('r1', 5);
    const round2 = orgs('r2', 5);
    // Sólo las tres primeras de la ronda 1 y las dos primeras de la ronda 2
    // superan los gates. El resto se descarta gratis.
    const eligible = new Set(['r11', 'r12', 'r13', 'r21', 'r22']);

    const { deps, recorder } = simulate({
      roundResults: [round1, round2],
      assess: (organization) =>
        eligible.has(organization.providerOrganizationId as string)
          ? passingAssessment()
          : rejectedAssessment('sector_not_mapped'),
    });

    const result = await run(deps);

    assert.equal(result.roundsExecuted, 2);
    assert.equal(result.runMetrics.totalRawResults, 10);
    assert.equal(result.eligibleCompaniesFound, 5);
    assert.equal(result.persistedCandidates, 5);
    assert.equal(result.targetReached, true);
    assert.deepEqual(recorder.searchCalls, [1, 2]);

    // Las dos rondas se distinguen en las métricas: sin eso no se puede auditar
    // de dónde salió cada empresa.
    assert.equal(result.rounds.length, 2);
    assert.equal(result.rounds[0].newEligibleCompaniesAdded, 3);
    assert.equal(result.rounds[1].newEligibleCompaniesAdded, 2);
  });
});

// ─── Fixture C — duplicado conocido, descartado antes del gasto ───────────────

describe('§ 7 · fixture C — duplicado conocido', () => {
  test('citi.com se descarta antes del enrichment: 0 créditos de enrichment', async () => {
    const known = org('citi', { providerRank: 1, domain: 'citi.com' });
    const rest = orgs('nueva', 4).map((o, index) => ({ ...o, providerRank: index + 2 }));

    const { deps, recorder } = simulate({
      roundResults: [[known, ...rest], []],
      assess: (organization) =>
        organization.domain === 'citi.com'
          ? rejectedAssessment('duplicate_in_hubspot')
          : passingAssessment(),
    });

    const result = await run(deps);

    // El duplicado no llega a elegible y NUNCA se paga un enrichment por él.
    assert.equal(recorder.enrichCalls.length, 0);
    assert.equal(
      recorder.usageRows.filter((r) => r.operation_key === 'organization_enrichment').length,
      0,
    );
    assert.ok(result.observedRejectionReasons.includes('duplicate_in_hubspot'));

    const rejected = result.evaluatedCandidates.filter(
      (c) => c.assessment.rejection === 'duplicate_in_hubspot',
    );
    assert.equal(rejected.length, 1, 'el descarte queda registrado con su motivo');
    assert.equal(result.eligibleCompaniesFound, 4);
  });
});

// ─── Fixture D — calidad insuficiente ─────────────────────────────────────────

describe('§ 7 · fixture D — calidad insuficiente', () => {
  test('10 raw / 3 elegibles → parcial, sin relajar ningún gate', async () => {
    const eligible = new Set(['a1', 'a2', 'b1']);

    const { deps, recorder } = simulate({
      roundResults: [orgs('a', 5), orgs('b', 5)],
      assess: (organization) =>
        eligible.has(organization.providerOrganizationId as string)
          ? passingAssessment()
          : rejectedAssessment('country_incompatible'),
    });

    const result = await run(deps);

    assert.equal(result.runMetrics.totalRawResults, 10);
    assert.equal(result.eligibleCompaniesFound, 3);
    assert.equal(result.targetReached, false);
    assert.equal(result.resultStatus, 'partial_target_not_reached');
    assert.equal(result.partialResultReason, 'partial_target_not_reached');

    // Las dos rondas corrieron y ahí se acabó: no hay tercera ronda ni un
    // segundo intento con los gates relajados para "llegar a cinco".
    assert.deepEqual(recorder.searchCalls, [1, 2]);
    assert.equal(result.rounds.length, 2);

    // Un candidato rechazado sigue rechazado: el estado parcial no lo reconvierte.
    const stillRejected = result.evaluatedCandidates.filter(
      (c) => c.assessment.rejection !== null,
    );
    assert.equal(stillRejected.length, 7);
    assert.equal(result.persistedCandidates, 3);
  });

  test('un candidato ambiguo NO se promueve sin la evidencia del enrichment', async () => {
    const { deps } = simulate({
      roundResults: [orgs('amb', 5), []],
      assess: () => ambiguousAssessment(),
      enrich: () => ({
        executed: true,
        // El enrichment se pagó y devolvió que el sector NO corresponde.
        sectorEvidenceState: 'sector_evidence_contradictory',
        internalRecordedCredits: 1,
      }),
    });

    const result = await run(deps);

    assert.equal(result.targetReached, false);
    assert.equal(result.resultStatus, 'partial_target_not_reached');
    assert.equal(result.eligibleCompaniesFound, 0);
  });
});

// ─── Fixture E — timeout ambiguo ──────────────────────────────────────────────

describe('§ 7 · fixture E — timeout ambiguo', () => {
  test('cobro sin confirmar ⇒ indeterminado, retry sin llamadas nuevas, /ai-usage pendiente', async () => {
    const { deps, recorder } = simulate({
      roundResults: [orgs('t', 5), orgs('u', 5)],
      // La ronda 2 sale, pero su resultado o su cobro quedan sin confirmar.
      searchIndeterminate: (roundNumber) => roundNumber === 2,
      assess: (organization) =>
        organization.providerOrganizationId === 't1'
          ? passingAssessment()
          : rejectedAssessment('sector_not_mapped'),
    });

    const result = await run(deps);

    // 1. La corrida NO se declara cerrada.
    assert.equal(result.resultStatus, 'apollo_operation_indeterminate');
    assert.equal(result.manualReconciliationRequired, true);
    assert.equal(result.indeterminateOperations.length, 1);
    assert.equal(result.indeterminateOperations[0].roundNumber, 2);
    assert.equal(result.indeterminateOperations[0].operationKey, 'organizations_search');
    assert.equal(result.indeterminateOperations[0].reason, 'provider_outcome_unknown');

    // 2. La fila económica lleva credits_used = NULL, jamás 0.
    const indeterminateRow = recorder.usageRows[recorder.usageRows.length - 1];
    assert.equal(indeterminateRow.credits_used, null);

    // 3. Un reintento con las claves ya conocidas no emite ninguna llamada nueva.
    const searchCallsBeforeRetry = recorder.searchCalls.length;
    const usageRowsBeforeRetry = recorder.usageRows.length;
    await runApolloTwoRoundDiscovery(
      {
        config: testConfig(),
        queryContext: testQueryContext(),
        correlation: testCorrelation(),
        completedOperationKeys: [
          ...result.completedOperationKeys,
          ...result.indeterminateOperationKeys,
        ],
      },
      deps,
    );
    assert.equal(
      recorder.searchCalls.length,
      searchCallsBeforeRetry,
      'el reintento no vuelve a llamar al proveedor',
    );
    assert.equal(
      recorder.usageRows.length,
      usageRowsBeforeRetry,
      'el reintento no escribe una segunda fila económica por la misma operación',
    );

    // 4. /ai-usage presenta esa operación como pendiente, no como cero.
    const totals = aggregateUsageCredits(
      recorder.usageRows.map((row) => resolveUsageCredits(row.credits_used)),
    );
    assert.equal(totals.unknownCreditOperations, 1);
    assert.equal(totals.hasUnknownCredits, true);
    assert.equal(totals.knownCreditsTotal, 5, 'la ronda 1 sí aporta su consumo conocido');

    const display = resolveCreditsTotalsDisplay({ totals });
    assert.equal(display.label, '5+', 'un total con pendientes es cota inferior');
    assert.equal(display.isPartial, true);
    assert.notEqual(display.label, '5');
  });

  test('si nada se pudo confirmar, el panel no muestra un cero', async () => {
    const { deps, recorder } = simulate({
      roundResults: [orgs('z', 5), []],
      searchIndeterminate: () => true,
    });

    await run(deps);

    const totals = aggregateUsageCredits(
      recorder.usageRows.map((row) => resolveUsageCredits(row.credits_used)),
    );
    const display = resolveCreditsTotalsDisplay({ totals });
    assert.equal(display.label, UNKNOWN_CREDITS_LABEL);
    assert.doesNotMatch(display.label, /^0/);
  });
});

// ─── Techo económico compartido por los cinco fixtures ────────────────────────

describe('§ 7/§ 8 · techo interno de la modalidad', () => {
  test('ningún fixture puede registrar más de 12 créditos internos', async () => {
    const scenarios: Array<() => ReturnType<typeof simulate>> = [
      () => simulate({ roundResults: [orgs('a', 5), orgs('b', 5)] }),
      () =>
        simulate({
          roundResults: [orgs('c', 5), orgs('d', 5)],
          assess: () => ambiguousAssessment(),
        }),
    ];

    for (const scenario of scenarios) {
      const { deps, recorder } = scenario();
      await run(deps);

      const searchCredits = recorder.usageRows
        .filter((r) => r.operation_key === 'organizations_search')
        .reduce((t, r) => t + (r.credits_used ?? 0), 0);
      const enrichmentCredits = recorder.usageRows
        .filter((r) => r.operation_key === 'organization_enrichment')
        .reduce((t, r) => t + (r.credits_used ?? 0), 0);

      assert.ok(searchCredits <= 10, `búsqueda por encima del tope: ${searchCredits}`);
      assert.ok(enrichmentCredits <= 2, `enrichment por encima del tope: ${enrichmentCredits}`);
      assert.ok(searchCredits + enrichmentCredits <= 12);
      assert.ok(recorder.searchCalls.length <= 2);
      assert.ok(recorder.enrichCalls.length <= 2);
    }
  });
});
