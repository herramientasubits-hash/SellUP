/**
 * AGENT1-APOLLO-FINAL-SAFETY-CLOSURE · PARTE B — prueba la autoridad REAL de
 * "objetivo 10 aceptado", no sólo la demanda representada.
 *
 * El corte anterior (RESIDUAL-AND-PAGE-FENCING) probó que la DEMANDA (§ 13/§ A
 * de `apollo-two-round-residual-target.test.ts`) puede llegar a 10 sin que
 * `targetEligibleCompanies` la trunque. Esas pruebas nunca hacen competir a un
 * candidato por un enrichment: usan `passingAssessment()`, que llega con el
 * sector ya confirmado gratis. Por construcción, ninguna de ellas podía tocar
 * `config.maxEnrichmentsPerRun` / `MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX`.
 *
 * Estas pruebas cierran esa brecha: fuerzan a los 10 candidatos a necesitar
 * enrichment (`ambiguousAssessment()`) y miden qué cuenta REALMENTE hacia el
 * objetivo — `stableFinalizableCandidateCount`, no `eligibleCompaniesFound` — a
 * través de la cadena completa `remainingTarget → selección → enrichment →
 * stableFinalizableCandidateCount`.
 *
 * Offline por construcción: proveedor, gates y enrichment son funciones
 * inyectadas. LIVE_APOLLO_CALLS = 0, APOLLO_CREDITS_USED = 0.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runApolloTwoRoundDiscovery,
  type ApolloTwoRoundDeps,
  type CheapAssessment,
  type RawDiscoveredOrganization,
  type RoundSearchOutcome,
} from '../orchestrator';
import { MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX } from '../config';
import {
  testConfig,
  testCorrelation,
  testQueryContext,
  orgs,
  ambiguousAssessment,
  simulatedEffectiveRequestBuilder,
} from './fixtures';

type SearchCall = { roundNumber: number; requestedResultLimit: number };
type EnrichCall = { candidateKey: string };

function harnessAllAmbiguous(roundResults: RawDiscoveredOrganization[][]): {
  deps: ApolloTwoRoundDeps;
  searchCalls: SearchCall[];
  enrichCalls: EnrichCall[];
} {
  const searchCalls: SearchCall[] = [];
  const enrichCalls: EnrichCall[] = [];

  const deps: ApolloTwoRoundDeps = {
    buildRoundProviderRequest: simulatedEffectiveRequestBuilder(),
    searchRound: async ({ roundNumber, requestedResultLimit }): Promise<RoundSearchOutcome> => {
      searchCalls.push({ roundNumber, requestedResultLimit });
      const organizations = roundResults[roundNumber - 1] ?? [];
      return {
        organizations,
        providerRequestCount: 1,
        internalRecordedCredits: organizations.length,
      };
    },
    // TODOS ambiguos: cada candidato compite por un enrichment (sector sin
    // confirmar), exactamente el caso B1/B2 del corte.
    assessCandidate: (): CheapAssessment => ambiguousAssessment(),
    enrichCandidate: async ({ candidateKey }) => {
      enrichCalls.push({ candidateKey });
      return {
        executed: true,
        sectorEvidenceState: 'sector_evidence_confirmed',
        internalRecordedCredits: 1,
      };
    },
  };

  return { deps, searchCalls, enrichCalls };
}

function run(
  deps: ApolloTwoRoundDeps,
  remainingTarget: number | null,
  config: ReturnType<typeof testConfig>,
) {
  return runApolloTwoRoundDiscovery(
    {
      config,
      queryContext: testQueryContext(),
      correlation: testCorrelation(),
      remainingTarget,
    },
    deps,
  );
}

function config10(maxEnrichmentsPerRun: number) {
  return testConfig({
    targetEligibleCompanies: 10,
    maxResultsPerRound: 10,
    maxEnrichmentsPerRun,
  });
}

describe('AGENT1-APOLLO-FINAL-SAFETY-CLOSURE § B1 · objetivo 10 fulfillable cuando el presupuesto alcanza', () => {
  test('D4 — target=10, free=0, 10 candidatos net-new TODOS necesitan enrichment, presupuesto de enrichment = 10 ⇒ acceptedForTarget = 10', async () => {
    const { deps, enrichCalls } = harnessAllAmbiguous([orgs('a', 6), orgs('b', 6)]);

    // 🔴 maxEnrichmentsPerRun=10 se inyecta DIRECTO al orquestador — nunca pasa
    // por `resolveApolloTwoRoundConfig`/`parseApolloTwoRoundInt`, así que el
    // clamp de `MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX` (capa de entorno) no
    // interviene. Esto aísla la pregunta: ¿el ORQUESTADOR mismo tiene algún
    // techo duro de 6 en su lógica de aceptación? La respuesta es no — lo
    // único que topa en 6 es la capa de parseo de entorno.
    const result = await run(deps, 10, config10(10));

    assert.equal(result.stableFinalizableCandidateCount, 10, 'las 10 quedan finalizables de forma estable');
    assert.equal(result.targetReached, true);
    assert.equal(result.resultStatus, 'target_reached');
    assert.equal(enrichCalls.length, 10, 'se pagaron exactamente 10 enrichments, ni uno de más');
    const capReached = result.enrichmentSkips.filter((s) => s.skippedReason === 'enrichment_cap_reached');
    assert.equal(capReached.length, 0, 'con presupuesto=10 ningún candidato se salta por tope de enrichment');
  });

  test('sin evaluador de enrichment el objetivo nunca se completa (control negativo)', async () => {
    // Confirma que el escenario D4 realmente EXIGE enrichment: sin presupuesto
    // (0), ninguno de los 10 candidatos ambiguos puede volverse estable.
    const { deps } = harnessAllAmbiguous([orgs('a', 6), orgs('b', 6)]);
    const result = await run(deps, 10, config10(0));

    assert.equal(result.stableFinalizableCandidateCount, 0);
    assert.equal(result.targetReached, false);
  });
});

describe('AGENT1-APOLLO-FINAL-SAFETY-CLOSURE § B2 · identidad del tope de 6', () => {
  test('D5 — con el tope absoluto real (6), target=10 se detiene en 6, no en 10, con motivo explícito', async () => {
    const { deps, enrichCalls } = harnessAllAmbiguous([orgs('a', 6), orgs('b', 6)]);

    // MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX es el techo que
    // `resolveApolloTwoRoundConfig` NUNCA deja superar, sin importar qué pida el
    // entorno (`parseApolloTwoRoundInt` clampa a `absoluteMax`). Se usa aquí
    // literal, no hardcodeado, para que la prueba seguiera siendo válida si el
    // valor cambiara.
    const result = await run(deps, 10, config10(MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX));

    assert.equal(
      enrichCalls.length,
      MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
      'nunca se pagan más enrichments que el tope absoluto configurado',
    );
    assert.equal(
      result.stableFinalizableCandidateCount,
      MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
      '🔴 el objetivo aceptado se detiene EXACTAMENTE en el tope de enrichment, no en 10',
    );
    assert.equal(result.targetReached, false, 'con el tope real, 10 NO es alcanzable si los 10 necesitan enrichment');
    assert.equal(result.resultStatus, 'partial_target_not_reached');
    assert.equal(result.partialResultReason, 'partial_target_not_reached');
    assert.equal(
      result.projectedTargetGap,
      10 - MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
      'el hueco remanente es explícito: 10 - tope, nunca silencioso',
    );

    // Motivo explícito por candidato: los que no cupieron bajo el tope quedan
    // marcados `enrichment_cap_reached`, nunca simplemente ausentes.
    const capReached = result.enrichmentSkips.filter((s) => s.skippedReason === 'enrichment_cap_reached');
    assert.ok(
      capReached.length >= 1,
      'al menos un candidato quedó explícitamente fuera por tope de enrichment',
    );
  });

  test('D5b — el tope es GLOBAL para la corrida entera, no por ronda (opción B, no A)', async () => {
    // 6 candidatos ambiguos en CADA ronda (12 en total) con
    // maxEnrichmentsPerRun=6: si el tope fuera "6 por ronda" (opción A),
    // veríamos hasta 12 enrichments pagados. Si es "6 por toda la corrida"
    // (opción B), nunca se pagan más de 6 en total.
    const { deps, enrichCalls } = harnessAllAmbiguous([orgs('a', 6), orgs('b', 6)]);

    const result = await run(deps, 12, config10(MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX));

    assert.ok(
      enrichCalls.length <= MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
      `se pagaron ${enrichCalls.length} enrichments; el tope GLOBAL es ${MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX}`,
    );
    assert.equal(enrichCalls.length, MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX);
    assert.ok(
      result.stableFinalizableCandidateCount <= MAX_ENRICHMENTS_PER_RUN_ABSOLUTE_MAX,
      'la cuenta estable tampoco puede superar el tope global agregado entre las dos rondas',
    );
  });

  test('D5c — con N=3 disponibles, acceptedForTarget = 3, remaining = 7, sin clamp local al objetivo', async () => {
    // El "6" no es mágico: es sólo `remainingAuthorizedEnrichmentCredits`. Con
    // un techo más chico (3) el resultado escala igual — nunca hay un segundo
    // tope de "objetivo" escondido por debajo.
    const { deps, enrichCalls } = harnessAllAmbiguous([orgs('a', 6), orgs('b', 6)]);

    const result = await run(deps, 10, config10(3));

    assert.equal(enrichCalls.length, 3);
    assert.equal(result.stableFinalizableCandidateCount, 3);
    assert.equal(result.targetReached, false);
    assert.equal(result.projectedTargetGap, 7);
  });
});
