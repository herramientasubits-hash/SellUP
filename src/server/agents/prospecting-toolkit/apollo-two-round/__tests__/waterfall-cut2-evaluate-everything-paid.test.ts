/**
 * waterfall-cut2-evaluate-everything-paid.test.ts
 *
 * AGENT1-APOLLO-LUSHA-WATERFALL · CORTE 2 — se evalúa TODO lo que ya se pagó.
 *
 * ── 🔴 El defecto que cierra ─────────────────────────────────────────────────
 *
 * `maxRawResultsPerRun` (20 efectivo) actuaba en DOS sitios como autoridad de
 * admisión:
 *
 *   1. dentro de la ronda: la organización número 21 de una página de 100 se
 *      descartaba con `raw_result_cap_reached` — sin deduplicar, sin filtrar,
 *      sin competir por el objetivo. Se descartaba por su POSICIÓN;
 *   2. antes de la ronda 2: `totalRawResults >= maxRawResultsPerRun` cancelaba
 *      la segunda ronda. Con `per_page = 100` contra un tope de 20 eso se
 *      cumplía SIEMPRE tras la primera página, incluso con 0 empresas útiles.
 *
 * Las dos son la misma confusión: tratar el VOLUMEN devuelto como si fuera el
 * gasto. El gasto son las PÁGINAS que se compran y el enrichment que se paga;
 * leer localmente una página ya comprada no cuesta un crédito más.
 *
 * G1 · las 100 organizaciones de una página pagada se evalúan, ninguna se cae.
 * G2 · evaluar 100 no persiste 100: el objetivo sigue capando lo que se guarda.
 * G3 · la ronda 2 se decide por SUFICIENCIA, no por volumen crudo.
 * G4 · la deduplicación se aplica a todo lo evaluado, no sólo a los primeros N.
 * G5 · guardas estáticas: el tope no puede volver como filtro de admisión.
 *
 * Offline por construcción: proveedor, gates y enrichment son funciones
 * inyectadas. 0 llamadas reales · 0 créditos · 0 red · 0 Producción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
  type RawDiscoveredOrganization,
  type RoundSearchOutcome,
} from '../orchestrator';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  orgs,
  passingAssessment,
  rejectedAssessment,
  simulatedEffectiveRequestBuilder,
} from './fixtures';

/** Una página real de Apollo: `per_page = 100`. */
const APOLLO_FULL_PAGE = 100;

type AssessedOrg = { id: string; roundNumber: number };

function harness(options: {
  roundResults: RawDiscoveredOrganization[][];
  assess?: (organization: RawDiscoveredOrganization, roundNumber: number) => CheapAssessment;
}): {
  deps: ApolloTwoRoundDeps;
  assessed: AssessedOrg[];
  searchRounds: number[];
} {
  const assessed: AssessedOrg[] = [];
  const searchRounds: number[] = [];

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber }): Promise<RoundSearchOutcome> => {
      searchRounds.push(roundNumber);
      const organizations = options.roundResults[roundNumber - 1] ?? [];
      return {
        organizations,
        // El coste NO escala con lo que se evalúa: una página es una página.
        providerRequestCount: 1,
        internalRecordedCredits: 1,
      };
    },
    assessCandidate: ({ organization, roundNumber }) => {
      assessed.push({ id: organization.providerOrganizationId ?? '', roundNumber });
      return options.assess?.(organization, roundNumber) ?? passingAssessment();
    },
    enrichCandidate: async () => ({
      executed: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      internalRecordedCredits: 1,
    }),
  };

  return { deps, assessed, searchRounds };
}

function run(
  deps: ApolloTwoRoundDeps,
  overrides: Partial<ReturnType<typeof testConfig>> = {},
  remainingTarget: number | null = null,
) {
  return runApolloTwoRoundDiscovery(
    {
      config: testConfig(overrides),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
      remainingTarget,
    },
    deps,
  );
}

// ── G1 · todo lo pagado se evalúa ────────────────────────────────────────────

describe('CORTE 2 § G1 — una página de 100 se evalúa entera', () => {
  test('las 100 organizaciones llegan a los gates, con el tope crudo en 10', async () => {
    // `maxRawResultsPerRun: 10` es el tope MÁS restrictivo posible aquí. Antes
    // del corte habría dejado 90 organizaciones sin evaluar.
    const { deps, assessed } = harness({
      roundResults: [orgs('a', APOLLO_FULL_PAGE), []],
      // Ninguna útil: así la corrida no se detiene por objetivo alcanzado y se
      // observa el recorrido COMPLETO de la página.
      assess: () => rejectedAssessment('country_incompatible'),
    });

    const result = await run(deps, { maxRawResultsPerRun: 10 });

    assert.equal(assessed.length, APOLLO_FULL_PAGE, 'toda la página pagada tiene que evaluarse');
    assert.equal(result.rounds[0]!.normalizedResults, APOLLO_FULL_PAGE);
  });

  test('la organización número 21 —la primera que el tope tiraba— sí se evalúa', async () => {
    const { deps, assessed } = harness({
      roundResults: [orgs('a', APOLLO_FULL_PAGE), []],
      assess: () => rejectedAssessment('country_incompatible'),
    });

    await run(deps, { maxRawResultsPerRun: 10 });

    const evaluatedIds = new Set(assessed.map((entry) => entry.id));
    for (const position of [11, 21, 50, 100]) {
      assert.ok(
        evaluatedIds.has(`a${position}`),
        `la organización en posición ${position} quedó sin evaluar`,
      );
    }
  });

  test('ninguna ronda reporta rechazos por tope de resultados crudos', async () => {
    const { deps } = harness({
      roundResults: [orgs('a', APOLLO_FULL_PAGE), orgs('b', APOLLO_FULL_PAGE)],
      assess: () => rejectedAssessment('country_incompatible'),
    });

    const result = await run(deps, { maxRawResultsPerRun: 10 });

    for (const round of result.rounds) {
      const reasons = JSON.stringify(round);
      assert.equal(
        reasons.includes('raw_result_cap'),
        false,
        'el vocabulario del tope crudo no puede reaparecer en las métricas',
      );
    }
  });
});

// ── G2 · evaluar todo no es persistir todo ───────────────────────────────────

describe('CORTE 2 § G2 — evaluar 100 no persiste 100', () => {
  test('el objetivo sigue capando lo persistido aunque se evalúe la página entera', async () => {
    const { deps, assessed } = harness({
      roundResults: [orgs('a', APOLLO_FULL_PAGE), []],
    });

    const result = await run(deps, { maxRawResultsPerRun: 10 });

    assert.equal(assessed.length, APOLLO_FULL_PAGE, 'se evaluó toda la página');
    assert.ok(
      result.persistedCandidates <= result.targetEligibleCompanies,
      `persistió ${result.persistedCandidates} con objetivo ${result.targetEligibleCompanies}`,
    );
  });

  test('el tope crudo no gobierna el gasto: una página es una petición', async () => {
    const { deps, searchRounds } = harness({
      roundResults: [orgs('a', APOLLO_FULL_PAGE), []],
    });

    const result = await run(deps, { maxRawResultsPerRun: 10 });

    assert.equal(searchRounds.length, result.roundsExecuted);
    assert.ok(
      result.roundsExecuted <= testConfig().maxRounds,
      'evaluar más resultados no puede comprar más rondas',
    );
  });
});

// ── G3 · la ronda 2 se decide por suficiencia ────────────────────────────────

describe('CORTE 2 § G3 — el volumen crudo ya no cancela la ronda 2', () => {
  test('R1 devuelve 100 crudos y 3 útiles ⇒ la ronda 2 SÍ se ejecuta', async () => {
    // Éste es el caso que el tope rompía: 100 >= 20 cancelaba la ronda 2 aunque
    // faltaran empresas útiles.
    const usefulInRoundOne = new Set(['a1', 'a2', 'a3']);
    const { deps, searchRounds } = harness({
      roundResults: [orgs('a', APOLLO_FULL_PAGE), orgs('b', APOLLO_FULL_PAGE)],
      assess: (organization) =>
        usefulInRoundOne.has(organization.providerOrganizationId ?? '')
          ? passingAssessment()
          : rejectedAssessment('country_incompatible'),
    });

    const result = await run(deps, { maxRawResultsPerRun: 10 });

    assert.deepEqual(searchRounds, [1, 2], 'la ronda 2 tiene que ejecutarse con el objetivo abierto');
    assert.equal(result.roundsExecuted, 2);
    assert.equal(result.secondRoundSkippedReason, null);
  });

  test('R1 cubre el objetivo ⇒ la ronda 2 se salta por SUFICIENCIA, no por volumen', async () => {
    const { deps, searchRounds } = harness({
      roundResults: [orgs('a', APOLLO_FULL_PAGE), orgs('b', APOLLO_FULL_PAGE)],
    });

    const result = await run(deps, { maxRawResultsPerRun: 10 });

    assert.deepEqual(searchRounds, [1], 'con el objetivo cubierto no se compra una segunda ronda');
    assert.equal(result.secondRoundSkippedReason, 'target_reached');
  });
});

// ── G4 · la deduplicación alcanza a todo lo evaluado ─────────────────────────

describe('CORTE 2 § G4 — dedupe sobre la página entera, no sobre los primeros N', () => {
  test('los repetidos de la ronda 1 en la ronda 2 se detectan más allá del tope viejo', async () => {
    // La ronda 2 devuelve EXACTAMENTE las mismas 100 organizaciones.
    const page = orgs('a', APOLLO_FULL_PAGE);
    const { deps } = harness({
      roundResults: [page, page],
      assess: () => rejectedAssessment('country_incompatible'),
    });

    const result = await run(deps, { maxRawResultsPerRun: 10 });

    if (result.roundsExecuted === 2) {
      const secondRound = result.rounds[1]!;
      assert.equal(
        secondRound.newUniqueResults,
        0,
        'ninguna organización repetida puede contarse como nueva',
      );
      assert.equal(secondRound.seenDuplicates, APOLLO_FULL_PAGE);
    }
  });

  test('los duplicados dentro de UNA misma respuesta se detectan en toda la página', async () => {
    const duplicated = [...orgs('a', APOLLO_FULL_PAGE), ...orgs('a', APOLLO_FULL_PAGE)];
    const { deps } = harness({
      roundResults: [duplicated, []],
      assess: () => rejectedAssessment('country_incompatible'),
    });

    const result = await run(deps, { maxRawResultsPerRun: 10 });

    const firstRound = result.rounds[0]!;
    assert.equal(firstRound.normalizedResults, duplicated.length);
    assert.equal(firstRound.newUniqueResults, APOLLO_FULL_PAGE);
    assert.equal(firstRound.seenDuplicates, APOLLO_FULL_PAGE);
  });
});

// ── G5 · guardas estáticas ───────────────────────────────────────────────────

describe('CORTE 2 § G5 — el tope no puede volver como autoridad de admisión', () => {
  const orchestratorPath = path.join(import.meta.dirname, '../orchestrator.ts');

  /** Un comentario que NOMBRA el tope retirado no es el tope vivo. */
  function liveSource(): string {
    return readFileSync(orchestratorPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
  }

  test('el orquestador no compara nada contra `maxRawResultsPerRun`', () => {
    assert.equal(
      /maxRawResultsPerRun/.test(liveSource()),
      false,
      'volvió una comparación contra el tope de resultados crudos',
    );
  });

  test('`raw_result_cap_reached` salió del vocabulario vivo', () => {
    assert.equal(
      /raw_result_cap_reached/.test(liveSource()),
      false,
      'el motivo de rechazo por tope crudo volvió a existir',
    );
  });

  test('no hay truncamiento posicional de las organizaciones de una ronda', () => {
    const source = liveSource();
    assert.equal(
      /organizations\s*\.\s*slice\s*\(/.test(source),
      false,
      'una organización no puede quedarse fuera por su posición en la lista',
    );
  });
});
