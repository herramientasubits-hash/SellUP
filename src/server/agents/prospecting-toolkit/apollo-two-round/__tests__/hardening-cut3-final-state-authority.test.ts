/**
 * hardening-cut3-final-state-authority.test.ts — la comprobación 6 del estado
 * final compara `target_reached` contra la cifra que de verdad lo produce.
 *
 * AGENT1-HARDENING-CUT-3.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * `run-final-state-consistency.ts` derivaba `target_reached` de
 * `run_metrics.total_eligible_companies`. El orquestador NO lo emite así: lo
 * emite como `stableFinalizableCandidateCount >= target` (ver el docstring de
 * `targetReached` en `orchestrator.ts`, STABLE-TARGET-WRITER-PARITY § 11).
 *
 * Las dos cifras no responden a la misma pregunta. `total_eligible_companies`
 * es más laxa por construcción: un elegible sin `employee_count`, sin LinkedIn
 * o con subindustria ambigua se persiste como `needs_review` y no cuenta hacia
 * el objetivo. Así que toda corrida parcial con `eligible >= target` y
 * `stable < target` —el caso NORMAL de una corrida parcial— fabricaba un
 * conflicto que no existía, y ese ruido tapa a los conflictos de verdad.
 *
 * Puro: sin red, sin base, sin proveedor, sin reloj.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  evaluateApolloTwoRoundFinalStateConsistency,
  type FinalStateCandidateView,
  type FinalStateRoundView,
} from '../run-final-state-consistency';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function round(overrides: Partial<FinalStateRoundView> = {}): FinalStateRoundView {
  return {
    roundNumber: 1,
    knownCompanyDuplicates: 0,
    countryRejected: 0,
    sectorRejected: 0,
    ownershipRejected: 0,
    ...overrides,
  };
}

function eligibleCandidate(key: string): FinalStateCandidateView {
  return { candidate_key: key, eligible: true, finally_rejected_or_duplicated: false };
}

const CONFLICT_CODE = 'target_reached_disagrees_with_finalizable_count';

/**
 * Una corrida PARCIAL realista: 6 empresas elegibles, de las que sólo 3 cumplen
 * todas las condiciones del contrato canónico. Objetivo 5.
 *
 *   eligible (6) >= target (5)      ← la cifra laxa diría «alcanzado»
 *   stable   (3)  < target (5)      ← la autoridad dice «parcial», y acierta
 *
 * El orquestador emite `targetReached: false`, que es lo correcto. Antes del
 * corte, la comprobación 6 lo contradecía.
 */
function partialRun(input: { targetReached: boolean }) {
  const candidates = Array.from({ length: 6 }, (_unused, i) => eligibleCandidate(`apollo:${i}`));
  return evaluateApolloTwoRoundFinalStateConsistency({
    rounds: [round({ knownCompanyDuplicates: 3 })],
    candidates,
    runMetrics: {
      totalUniqueOrganizations: 6,
      totalEligibleCompanies: 6,
      persistedCandidates: 3,
    },
    targetEligibleCompanies: 5,
    targetReached: input.targetReached,
    stableFinalizableCandidateCount: 3,
  });
}

// ─── § 1 · el conflicto FALSO desaparece ─────────────────────────────────────

describe('CUT-3 § 1 · eligible >= target con stable < target NO es un conflicto', () => {
  test('la corrida parcial honesta no produce el conflicto de la comprobación 6', () => {
    const consistency = partialRun({ targetReached: false });
    assert.equal(
      consistency.conflicts.some((c) => c.code === CONFLICT_CODE),
      false,
      '🔴 6 elegibles contra un objetivo de 5 NO contradicen un `target_reached: false` ' +
        'cuando sólo 3 son finalizables: son dos preguntas distintas',
    );
  });

  test('y no se compensa fabricando otro conflicto en su lugar', () => {
    const consistency = partialRun({ targetReached: false });
    assert.deepEqual(
      consistency.conflicts.map((c) => c.code),
      [],
      `sin conflictos: ${JSON.stringify(consistency.conflicts)}`,
    );
    assert.equal(consistency.ok, true);
  });
});

// ─── § 2 · la divergencia REAL se sigue nombrando ────────────────────────────

describe('CUT-3 § 2 · cuando las autoridades divergen de verdad, hay conflicto', () => {
  test('`target_reached: true` con 3 finalizables contra un objetivo de 5 se nombra', () => {
    const consistency = partialRun({ targetReached: true });
    const conflict = consistency.conflicts.find((c) => c.code === CONFLICT_CODE);
    assert.ok(conflict, '🔴 declarar alcanzado lo que la autoridad no alcanzó sigue siendo mentira');
    assert.match(conflict.detail, /finalizables=3/);
    assert.match(conflict.detail, /elegibles=6/, 'la cifra laxa viaja en el detalle, no en el juicio');
    assert.equal(consistency.ok, false);
  });

  test('`target_reached: false` con los finalizables cubriendo el objetivo también se nombra', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: [round()],
      candidates: [eligibleCandidate('apollo:0'), eligibleCandidate('apollo:1')],
      runMetrics: {
        totalUniqueOrganizations: 2,
        totalEligibleCompanies: 2,
        persistedCandidates: 2,
      },
      targetEligibleCompanies: 2,
      targetReached: false,
      stableFinalizableCandidateCount: 2,
    });
    assert.equal(
      consistency.conflicts.some((c) => c.code === CONFLICT_CODE),
      true,
      '🔴 la comprobación es simétrica: negar un objetivo alcanzado también es una mentira',
    );
  });

  test('la cifra laxa NO puede por sí sola declarar el objetivo alcanzado', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: [round()],
      candidates: [eligibleCandidate('apollo:0')],
      runMetrics: {
        totalUniqueOrganizations: 1,
        totalEligibleCompanies: 99,
        persistedCandidates: 0,
      },
      targetEligibleCompanies: 5,
      targetReached: false,
      stableFinalizableCandidateCount: 0,
    });
    assert.equal(
      consistency.conflicts.some((c) => c.code === CONFLICT_CODE),
      false,
      '🔴 99 elegibles no alcanzan un objetivo que 0 finalizables no alcanzan',
    );
  });
});

// ─── § 3 · las otras cinco comprobaciones no se mueven ───────────────────────

describe('CUT-3 § 3 · el corte no toca las otras comprobaciones', () => {
  test('persisted_exceeds_eligible sigue midiéndose contra los ELEGIBLES', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: [round()],
      candidates: [eligibleCandidate('apollo:0')],
      runMetrics: {
        totalUniqueOrganizations: 1,
        totalEligibleCompanies: 1,
        persistedCandidates: 3,
      },
      targetEligibleCompanies: 1,
      targetReached: true,
      stableFinalizableCandidateCount: 1,
    });
    assert.equal(
      consistency.conflicts.some((c) => c.code === 'persisted_exceeds_eligible'),
      true,
      '🔴 «no se persiste más de lo elegible» es otra pregunta y conserva su fuente',
    );
  });

  test('un valor imposible de finalizables se sanea, no revienta', () => {
    const consistency = evaluateApolloTwoRoundFinalStateConsistency({
      rounds: [round()],
      candidates: [],
      runMetrics: {
        totalUniqueOrganizations: 0,
        totalEligibleCompanies: 0,
        persistedCandidates: 0,
      },
      targetEligibleCompanies: 5,
      targetReached: false,
      stableFinalizableCandidateCount: Number.NaN,
    });
    assert.equal(consistency.conflicts.some((c) => c.code === CONFLICT_CODE), false);
  });
});

// ─── § 4 · guarda estática — la autoridad no puede volver atrás ──────────────

function code(relativePath: string): string {
  return fs
    .readFileSync(path.join(process.cwd(), relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const MODULE = 'src/server/agents/prospecting-toolkit/apollo-two-round/run-final-state-consistency.ts';
const RUNNER = 'src/server/agents/prospecting-toolkit/apollo-two-round/production-runner.server.ts';

describe('CUT-3 § 4 · guarda estática — la comprobación 6 conserva su autoridad', () => {
  test('`derivedTargetReached` sale de los finalizables', () => {
    const src = code(MODULE);
    assert.match(
      src,
      /const derivedTargetReached = finalizable >= safeCount\(input\.targetEligibleCompanies\);/,
    );
    assert.equal(
      /const derivedTargetReached = declaredEligible/.test(src),
      false,
      '🔴 volver a `total_eligible_companies` reintroduce el conflicto falso',
    );
  });

  test('el nombre del conflicto no puede volver a nombrar la cifra laxa', () => {
    const src = code(MODULE);
    assert.equal(
      src.includes('target_reached_disagrees_with_eligible_count'),
      false,
      '🔴 un código que nombra la autoridad equivocada es la confusión escrita en la metadata',
    );
  });

  test('el runner pasa la cifra REAL de la corrida, no una copia ni un literal', () => {
    const src = code(RUNNER);
    assert.match(
      src,
      /stableFinalizableCandidateCount: runResult\.stableFinalizableCandidateCount,/,
    );
  });
});
