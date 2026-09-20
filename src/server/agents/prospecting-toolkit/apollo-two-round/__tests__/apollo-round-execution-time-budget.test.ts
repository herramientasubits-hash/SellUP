/**
 * apollo-round-execution-time-budget.test.ts
 *
 * AGENT1-APOLLO-ROUND-EXECUTION-TIME-BUDGET
 *
 * ── 🔴 El defecto que cierra ─────────────────────────────────────────────────
 *
 * La corrida `7d8a9b85` (lote `a86e3fdd`, CO × Tecnología, 20-09) murió con
 * `Vercel Runtime Timeout Error: Task timed out after 300 seconds`. La evidencia
 * durable acota la causa sin ambigüedad:
 *
 *   · `provider_usage_logs`: UNA operación, `organizations_search`, 5.369 ms,
 *     `status: success`. Apollo respondió, y respondió rápido;
 *   · el checkpoint quedó en `search_round_completed` con
 *     `pending_organization_tallies = [{returned:166, retained:166}]` y
 *     `checkpoint_write_failures: []`. La escritura durable NO falló;
 *   · `round_assessment_completed` nunca se escribió.
 *
 * Es decir: los ~295 s restantes se fueron ENTRE esos dos checkpoints, en la
 * evaluación barata. Y esa evaluación era un bucle estrictamente secuencial que
 * espera, POR ORGANIZACIÓN, una verificación HTTP del sitio de la empresa
 * (`verifyWebsite`, tope de 8 s) más una comprobación de duplicados
 * (`checkCompanyDuplicate`). El coste de la ronda era la SUMA de tantas latencias
 * independientes como organizaciones trajo la búsqueda.
 *
 * 🔴 Lo que estas pruebas NO hacen: atribuir el tiempo a «166 organizaciones»
 * por correlación. Miden la ESTRUCTURA — cuántas esperas hay en serie — con I/O
 * simulado, y distinguen trabajo lento, trabajo repetido y trabajo solapable.
 *
 * G1 · el bucle secuencial pone N esperas en serie: es la forma del defecto.
 * G2 · con la espera solapada, las tandas caen a ⌈N/C⌉ y la ronda cabe.
 * G3 · solapar no cambia NADA observable: mismo orden, mismos veredictos.
 * G4 · sin tiempo, la ronda para con estado durable PARCIAL y no pierde nada.
 * G5 · parar no repite trabajo: ni una búsqueda más, ni una evaluación más.
 *
 * Offline por construcción: proveedor, gates y enrichment son funciones
 * inyectadas. 0 llamadas reales · 0 créditos · 0 red · 0 Producción.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type RawDiscoveredOrganization,
  type RoundSearchOutcome,
  type ApolloTwoRoundCheckpointSnapshot,
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

/**
 * La ronda que de verdad ocurrió: una página de 100 y otra de 66.
 * `pending_organization_tallies` del lote `a86e3fdd`.
 */
const ORGANIZATIONS_IN_PRODUCTION_ROUND = 166;

/**
 * Latencia por organización, en milisegundos SIMULADOS.
 *
 * No es una medición de producción y no se presenta como tal: es el valor que
 * hace aritméticamente visible la forma del defecto. El tope real por
 * organización es de 8.000 ms (`DEFAULT_TIMEOUT_MS` de `website-verifier.ts`),
 * así que 1.800 ms es deliberadamente conservador.
 */
const SIMULATED_LATENCY_MS = 1_800;

/** El límite de la plataforma que mató la corrida. */
const PLATFORM_LIMIT_MS = 300_000;

type Telemetry = {
  /** Número de tandas: transiciones de 0 a 1 evaluaciones en vuelo. */
  waves: number;
  /** Máximo de evaluaciones simultáneas observado. */
  maxInFlight: number;
  /** Cuántas veces se llamó a la evaluación, por organización. */
  callsByOrganization: Map<string, number>;
  /** Rondas de búsqueda ejecutadas (para probar que no se vuelve a pagar). */
  searchRounds: number[];
  /** Checkpoints escritos, en orden. */
  checkpoints: ApolloTwoRoundCheckpointSnapshot[];
  /** Orden de registro de los candidatos. */
  registeredOrder: string[];
};

/**
 * Tiempo de reloj SIMULADO de la fase de evaluación.
 *
 * Es `tandas × latencia`, no una suma de esperas reales: las tandas se miden,
 * la latencia es un parámetro declarado. Nada aquí duerme de verdad.
 */
const simulatedElapsedMs = (telemetry: Telemetry): number =>
  telemetry.waves * SIMULATED_LATENCY_MS;

function harness(options: {
  roundResults: RawDiscoveredOrganization[][];
  assessmentConcurrency?: number;
  /** Devuelve `false` cuando ya no queda tiempo. Se consulta entre tandas. */
  assessmentTimeGuard?: () => boolean;
  reject?: boolean;
}): { deps: ApolloTwoRoundDeps; telemetry: Telemetry } {
  const telemetry: Telemetry = {
    waves: 0,
    maxInFlight: 0,
    callsByOrganization: new Map(),
    searchRounds: [],
    checkpoints: [],
    registeredOrder: [],
  };
  let inFlight = 0;

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber }): Promise<RoundSearchOutcome> => {
      telemetry.searchRounds.push(roundNumber);
      return {
        organizations: options.roundResults[roundNumber - 1] ?? [],
        providerRequestCount: 1,
        internalRecordedCredits: 1,
      };
    },
    assessmentConcurrency: options.assessmentConcurrency,
    assessmentTimeGuard: options.assessmentTimeGuard,
    assessCandidate: async ({ organization }) => {
      const id = organization.providerOrganizationId ?? '';
      telemetry.callsByOrganization.set(id, (telemetry.callsByOrganization.get(id) ?? 0) + 1);

      // Una transición de 0 a 1 en vuelo abre una tanda nueva. Es la medida
      // que no presupone la implementación: un bucle secuencial abre N.
      if (inFlight === 0) telemetry.waves++;
      inFlight++;
      telemetry.maxInFlight = Math.max(telemetry.maxInFlight, inFlight);

      // I/O simulado: cede el turno al bucle de eventos sin dormir. Todo lo que
      // se lance junto entra antes de que salga nadie.
      await new Promise((resolve) => setTimeout(resolve, 0));

      inFlight--;
      telemetry.registeredOrder.push(id);
      return options.reject ? rejectedAssessment('country_incompatible') : passingAssessment();
    },
    enrichCandidate: async () => ({
      executed: true,
      sectorEvidenceState: 'sector_evidence_confirmed',
      internalRecordedCredits: 1,
    }),
    saveCheckpoint: (checkpoint) => {
      telemetry.checkpoints.push(checkpoint);
      return true;
    },
  };

  return { deps, telemetry };
}

function run(deps: ApolloTwoRoundDeps) {
  return runApolloTwoRoundDiscovery(
    {
      config: testConfig({ maxRounds: 1 }),
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
      remainingTarget: null,
    },
    deps,
  );
}

// ── G1 · la forma del defecto ────────────────────────────────────────────────

describe('§ G1 — el bucle secuencial pone una espera por organización EN SERIE', () => {
  test('166 organizaciones ⇒ 166 tandas, y eso no cabe en el límite de ejecución', async () => {
    const { deps, telemetry } = harness({
      roundResults: [orgs('a', ORGANIZATIONS_IN_PRODUCTION_ROUND)],
      // Sin `assessmentConcurrency`: comportamiento previo al corte, byte a byte.
      reject: true,
    });

    await run(deps);

    assert.equal(telemetry.maxInFlight, 1, 'el bucle previo no solapa ninguna espera');
    assert.equal(
      telemetry.waves,
      ORGANIZATIONS_IN_PRODUCTION_ROUND,
      'una tanda por organización: el coste de la ronda es la SUMA de las latencias',
    );
    assert.ok(
      simulatedElapsedMs(telemetry) > PLATFORM_LIMIT_MS - 10_000,
      `con ${SIMULATED_LATENCY_MS} ms por organización la ronda no cabe en ${PLATFORM_LIMIT_MS} ms`,
    );
  });

  test('el trabajo NO es repetido: cada organización se evalúa exactamente una vez', async () => {
    const { deps, telemetry } = harness({
      roundResults: [orgs('a', 40)],
      reject: true,
    });

    await run(deps);

    assert.equal(telemetry.callsByOrganization.size, 40);
    for (const [id, calls] of telemetry.callsByOrganization) {
      assert.equal(calls, 1, `${id} se evaluó ${calls} veces`);
    }
    // Descarta la otra hipótesis barata: no es que se busque de más.
    assert.deepEqual(telemetry.searchRounds, [1]);
  });
});

// ── G2 · la corrección ───────────────────────────────────────────────────────

describe('§ G2 — con la espera solapada la ronda cabe', () => {
  test('166 organizaciones con concurrencia 8 ⇒ 21 tandas', async () => {
    const { deps, telemetry } = harness({
      roundResults: [orgs('a', ORGANIZATIONS_IN_PRODUCTION_ROUND)],
      assessmentConcurrency: 8,
      reject: true,
    });

    await run(deps);

    assert.equal(telemetry.maxInFlight, 8, 'la concurrencia declarada es la observada');
    assert.equal(telemetry.waves, Math.ceil(ORGANIZATIONS_IN_PRODUCTION_ROUND / 8));
    assert.ok(
      simulatedElapsedMs(telemetry) < PLATFORM_LIMIT_MS / 4,
      'la fase de evaluación deja margen de sobra para enrichment y escritura',
    );
  });

  test('todas las organizaciones pagadas se siguen evaluando: ninguna se recorta', async () => {
    const { deps, telemetry } = harness({
      roundResults: [orgs('a', ORGANIZATIONS_IN_PRODUCTION_ROUND)],
      assessmentConcurrency: 8,
      reject: true,
    });

    const result = await run(deps);

    assert.equal(telemetry.callsByOrganization.size, ORGANIZATIONS_IN_PRODUCTION_ROUND);
    assert.equal(result.rounds[0]!.normalizedResults, ORGANIZATIONS_IN_PRODUCTION_ROUND);
  });

  test('concurrencia 1 y concurrencia ausente son el MISMO comportamiento', async () => {
    const sequential = harness({ roundResults: [orgs('a', 20)], reject: true });
    const explicitOne = harness({
      roundResults: [orgs('a', 20)],
      assessmentConcurrency: 1,
      reject: true,
    });

    await run(sequential.deps);
    await run(explicitOne.deps);

    assert.equal(sequential.telemetry.waves, explicitOne.telemetry.waves);
    assert.deepEqual(sequential.telemetry.registeredOrder, explicitOne.telemetry.registeredOrder);
  });
});

// ── G3 · solapar no cambia nada observable ───────────────────────────────────

describe('§ G3 — mismos veredictos y mismo orden con y sin solape', () => {
  test('el orden de registro y las métricas de ronda son idénticos', async () => {
    const sequential = harness({ roundResults: [orgs('a', 50)] });
    const overlapped = harness({ roundResults: [orgs('a', 50)], assessmentConcurrency: 8 });

    const sequentialResult = await run(sequential.deps);
    const overlappedResult = await run(overlapped.deps);

    assert.deepEqual(
      overlappedResult.rounds[0],
      sequentialResult.rounds[0],
      'las métricas de la ronda no pueden depender de cuántas esperas se solapan',
    );
    assert.deepEqual(
      overlappedResult.persisted.map((c) => c.candidateKey),
      sequentialResult.persisted.map((c) => c.candidateKey),
      'el ORDEN de los candidatos es el del proveedor, no el de resolución de promesas',
    );
  });

  test('la deduplicación sigue siendo determinista con el solape activo', async () => {
    // La misma organización repetida: sólo la primera puede sobrevivir.
    const duplicated = [...orgs('a', 10), ...orgs('a', 10)];
    const sequential = harness({ roundResults: [duplicated] });
    const overlapped = harness({ roundResults: [duplicated], assessmentConcurrency: 8 });

    const sequentialResult = await run(sequential.deps);
    const overlappedResult = await run(overlapped.deps);

    assert.equal(overlappedResult.rounds[0]!.newUniqueResults, 10);
    assert.deepEqual(overlappedResult.rounds[0], sequentialResult.rounds[0]);
    // Una organización deduplicada no llega a los gates: no se evalúa dos veces.
    assert.equal(overlapped.telemetry.callsByOrganization.size, 10);
  });
});

// ── G4 · sin tiempo, estado durable PARCIAL ──────────────────────────────────

describe('§ G4 — quedarse sin tiempo deja trabajo recuperable, no una corrida perdida', () => {
  test('la ronda para, y las organizaciones sin evaluar quedan pendientes', async () => {
    let wavesAllowed = 2;
    const { deps, telemetry } = harness({
      roundResults: [orgs('a', 100)],
      assessmentConcurrency: 8,
      assessmentTimeGuard: () => wavesAllowed-- > 0,
      reject: true,
    });

    await run(deps);

    // 8 por tanda: la primera no consulta la guarda, y la guarda concede 2 más.
    const assessed = telemetry.callsByOrganization.size;
    assert.equal(assessed, 24, 'se evaluó exactamente lo que el presupuesto permitió');

    const partial = telemetry.checkpoints.filter(
      (c) => c.reason === 'round_assessment_partial',
    );
    assert.equal(partial.length, 1, 'el tercer estado se escribe una vez');

    const pending =
      partial[0]!.resume.pendingRoundOrganizations?.find((e) => e.roundNumber === 1)
        ?.organizations ?? [];
    assert.equal(
      pending.length,
      100 - assessed,
      'las no evaluadas viajan ENTERAS en el estado recuperable',
    );
  });

  test('una ronda parcial no publica sus métricas ni se declara completa', async () => {
    let wavesAllowed = 1;
    const { deps, telemetry } = harness({
      roundResults: [orgs('a', 100)],
      assessmentConcurrency: 8,
      assessmentTimeGuard: () => wavesAllowed-- > 0,
      reject: true,
    });

    const result = await run(deps);

    assert.equal(
      result.rounds.length,
      0,
      'publicar las métricas de una ronda a medias afirmaría un recuento que no es el suyo',
    );
    assert.ok(
      !telemetry.checkpoints.some((c) => c.reason === 'round_assessment_completed'),
      'una ronda parcial NO puede escribir el checkpoint de ronda completada',
    );
    // § 4 — el tercer estado es LEGIBLE desde fuera: «me quedé sin reloj» no es
    // lo mismo que «no llegué al objetivo», y confundirlos diagnostica
    // agotamiento del universo donde hubo agotamiento del tiempo.
    assert.equal(result.assessmentDeadlineReached, true);
  });

  test('sin guarda de tiempo el comportamiento es el de siempre: ningún parcial', async () => {
    const { deps, telemetry } = harness({
      roundResults: [orgs('a', 100)],
      assessmentConcurrency: 8,
      reject: true,
    });

    const result = await run(deps);

    assert.equal(telemetry.callsByOrganization.size, 100);
    assert.ok(
      !telemetry.checkpoints.some((c) => c.reason === 'round_assessment_partial'),
      'sin presupuesto de tiempo no hay parcial que escribir',
    );
    assert.equal(result.assessmentDeadlineReached, false);
  });
});

// ── G5 · parar no repite trabajo ni gasto ────────────────────────────────────

describe('§ G5 — la parada por tiempo no compra ni evalúa nada de más', () => {
  test('ni una búsqueda extra, ni una evaluación repetida', async () => {
    let wavesAllowed = 2;
    const { deps, telemetry } = harness({
      roundResults: [orgs('a', 100)],
      assessmentConcurrency: 8,
      assessmentTimeGuard: () => wavesAllowed-- > 0,
      reject: true,
    });

    await run(deps);

    assert.deepEqual(telemetry.searchRounds, [1], 'la búsqueda ya pagada no se repite');
    for (const [id, calls] of telemetry.callsByOrganization) {
      assert.equal(calls, 1, `${id} se evaluó ${calls} veces`);
    }
  });

  test('las organizaciones pendientes y las evaluadas son conjuntos DISJUNTOS', async () => {
    let wavesAllowed = 2;
    const { deps, telemetry } = harness({
      roundResults: [orgs('a', 100)],
      assessmentConcurrency: 8,
      assessmentTimeGuard: () => wavesAllowed-- > 0,
      reject: true,
    });

    await run(deps);

    const partial = telemetry.checkpoints.find(
      (c) => c.reason === 'round_assessment_partial',
    );
    const pendingIds = new Set(
      (
        partial?.resume.pendingRoundOrganizations?.find((e) => e.roundNumber === 1)
          ?.organizations ?? []
      ).map((o) => o.providerOrganizationId ?? ''),
    );
    for (const id of telemetry.callsByOrganization.keys()) {
      assert.ok(!pendingIds.has(id), `${id} está evaluada Y pendiente a la vez`);
    }
    assert.equal(pendingIds.size + telemetry.callsByOrganization.size, 100);
  });
});
