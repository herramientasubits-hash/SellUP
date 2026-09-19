/**
 * agent1-lusha-target-acceptance-x5-1.test.ts
 *
 * AGENT1-LUSHA-TARGET-ACCEPTANCE-X5.1 — el objetivo deja de limitar el universo,
 * y la aceptación deja de fingirse cuando no se puede medir.
 *
 * ── Los dos defectos que cierra ──────────────────────────────────────────────
 *
 * 1. `canAcceptLushaUsefulCandidate` descartaba supervivientes de una página YA
 *    PAGADA por haber llegado después del objetivo. Cuarenta empresas limpias
 *    con `target = 5` entregaban cinco y tiraban treinta y cinco.
 *
 * 2. `completeValidCandidates` valía `Math.min(insertedCount, useful.length)`:
 *    un conteo de FILAS ya recortado por el objetivo, publicado como si fuera un
 *    veredicto de completitud. La pierna Lusha no medía completitud, y el hueco
 *    se rellenó con la única cifra a mano.
 *
 * ── Los cuatro conceptos, separados ──────────────────────────────────────────
 *
 *   SURVIVORS          pasan los gates obligatorios. El objetivo NO los limita.
 *   PURCHASE CREDIT    rendimiento de lo pagado. Decide si seguir comprando.
 *   COMPLETENESS       complete | incomplete | unknown, por el contrato canónico.
 *   ACCEPTED_FOR_TARGET sólo las complete — y `null` cuando no se puede medir.
 *
 * Offline: sin red, sin Lusha, sin Apollo, sin Supabase, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  evaluateLushaSurvivorCompleteness,
  resolveLushaRunAcceptanceTruth,
  type SurvivorCompletenessInput,
} from '../lusha-run-acceptance-truth';
import { PROVIDER_PRODUCES_ALL_EVIDENCE } from '@/server/agents/prospecting-toolkit/provider-evidence-capability';
import {
  buildCandidateCompletenessCounters,
  evaluateCandidateTargetEligibility,
} from '@/server/agents/prospecting-toolkit/candidate-completeness-contract';
import {
  paidAcceptedContributionFromWriterTruth,
  CONTRIBUTOR_NOT_RUN,
} from '@/modules/prospect-batches/accepted-for-target';
import {
  canAcceptLushaUsefulCandidate,
  decideLushaProviderRequest,
  resolveLushaRemainingGap,
} from '../lusha-multibranch-execution';

// ─── Arnés ────────────────────────────────────────────────────────────────────

/**
 * Superviviente en el MEJOR caso que Lusha puede entregar.
 *
 * 🔴 X6.12 — ese «mejor caso» CAMBIÓ: la ruta ya evalúa ownership y ya persiste
 * la URL de LinkedIn acreditada, así que una candidata con las dos evidencias y
 * la macro confirmada cumple las siete condiciones. El superviviente de antes de
 * X6.12 —sin ninguna de las tres— sigue disponible como `survivorWithoutEvidence`.
 */
function survivor(overrides: Partial<SurvivorCompletenessInput> = {}): SurvivorCompletenessInput {
  return {
    employeeCount: 250,
    duplicateStatus: 'no_match',
    ownershipGate: 'pass',
    linkedinUrl: 'https://www.linkedin.com/company/acme-co',
    macroIndustryConfirmed: true,
    ...overrides,
  };
}

/** El superviviente tal como esta ruta lo producía ANTES de X6.12. */
function survivorWithoutEvidence(
  overrides: Partial<SurvivorCompletenessInput> = {},
): SurvivorCompletenessInput {
  return { employeeCount: 250, duplicateStatus: 'no_match', ...overrides };
}

/**
 * 🔴 X6.12 — los hechos de una corrida que SÍ pidió subindustria, que es el
 * único caso en el que a esta ruta le sigue faltando una condición.
 */
const SUBINDUSTRY_REQUESTED = { requestedSubindustries: ['Retail Pharmacy'] } as const;

function survivors(count: number, overrides: Partial<SurvivorCompletenessInput> = {}) {
  return Array.from({ length: count }, () => survivor(overrides));
}

/** El fuente del ejecutor, sin comentarios: para las guardas estáticas. */
function executorSourceWithoutComments(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, '..', 'lusha-pending-review.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

// ══ A · SUPERVIVENCIA: EL OBJETIVO NO LIMITA EL UNIVERSO ═════════════════════

describe('X5.1 § A · el objetivo no limita supervivientes', () => {
  test('12 · 40 supervivientes con objetivo 5: los 40 sobreviven', () => {
    const truth = resolveLushaRunAcceptanceTruth(survivors(40));

    assert.equal(truth.survivors, 40, 'ni uno menos: el objetivo no recorta');
    assert.equal(truth.purchaseCredit, 40);
  });

  test('9 · `purchaseCredit` ES `survivors`, sea cual sea la completitud', () => {
    // Mezcla deliberada: unos con subindustria pedida y sin respuesta (unknown)
    // y otros sin empleados (incomplete). 🔴 X6.12 — el hueco que produce
    // `unknown` ya no es constante del proveedor: es la subindustria PEDIDA.
    const mixed = [...survivors(25), ...survivors(15, { employeeCount: null })];
    const truth = resolveLushaRunAcceptanceTruth(mixed, SUBINDUSTRY_REQUESTED);

    assert.equal(truth.purchaseCredit, truth.survivors);
    assert.equal(truth.purchaseCredit, 40);
    assert.equal(truth.unknown, 25);
    assert.equal(truth.incomplete, 15);
  });

  test('🔴 X6.12 · sin subindustria pedida, el mejor caso de Lusha SÍ completa', () => {
    const truth = resolveLushaRunAcceptanceTruth(survivors(40));

    assert.equal(truth.survivors, 40, 'el universo no se recorta, como siempre');
    assert.equal(truth.complete, 40);
    assert.equal(truth.acceptanceMeasurable, true);
    assert.equal(truth.acceptedForTarget, 40, '🔴 el objetivo NO acota aquí: eso es aguas abajo');
  });

  test('invariante · survivors = complete + incomplete + unknown', () => {
    for (const mix of [
      survivors(0),
      survivors(7),
      survivors(7, { employeeCount: null }),
      [...survivors(3), ...survivors(4, { employeeCount: null })],
      [...survivors(2), ...survivors(2, { duplicateStatus: 'possible_duplicate' })],
    ]) {
      const truth = resolveLushaRunAcceptanceTruth(mix);
      assert.equal(
        truth.complete + truth.incomplete + truth.unknown,
        truth.survivors,
        'la suma tiene que cerrar sin residuo',
      );
    }
  });

  test('🔴 M8 · el cap de aceptación ya no descarta a nadie en el ejecutor', () => {
    const source = executorSourceWithoutComments();
    assert.ok(
      !source.includes('canAcceptLushaUsefulCandidate'),
      'el ejecutor no puede volver a llamar al tope de aceptación',
    );
    assert.ok(
      !source.includes("kind: 'target_overflow'"),
      'ni volver a emitir un descarte por sobrante de objetivo',
    );
  });

  test('la política pura del tope sigue existiendo, pero SIN consumidores', () => {
    // No se borra: otros cortes la citan y su suite propia la ejercita. Lo que
    // cambia es que el ejecutor ya no la usa para decidir quién existe.
    assert.equal(typeof canAcceptLushaUsefulCandidate, 'function');
  });
});

// ══ B · COMPLETITUD: COMPLETE / INCOMPLETE / UNKNOWN ═════════════════════════

describe('X5.1 § B · el veredicto ternario', () => {
  test('4/5/18 · UNKNOWN no es INCOMPLETE, no es COMPLETE y no es rechazo', () => {
    // 🔴 X6.12 — el `unknown` de esta ruta lo produce ahora la subindustria
    // PEDIDA y sin respuesta, no una constante del proveedor.
    const verdict = evaluateLushaSurvivorCompleteness(survivor(), SUBINDUSTRY_REQUESTED);

    assert.equal(verdict, 'unknown');
    assert.notEqual(verdict, 'incomplete');
    assert.notEqual(verdict, 'complete');
    // Y no existe siquiera un veredicto de rechazo: la completitud no rechaza.
    assert.ok(!['rejected', 'discarded'].includes(verdict));
  });

  test('19 · INCOMPLETE conserva su semántica: una condición EVALUADA que falla', () => {
    // `employee_count` SÍ es evaluable para Lusha. Si falta, falla de verdad.
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor({ employeeCount: null })),
      'incomplete',
    );
    // Y un duplicado conocido también es una condición evaluada y fallida.
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor({ duplicateStatus: 'possible_duplicate' })),
      'incomplete',
    );
  });

  test('20 · `unavailable` prevalece sobre `pending`', () => {
    const result = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
      pendingConditions: ['linkedin_status'],
      unavailableConditions: ['linkedin_status'],
    });

    assert.equal(result.conditionStates.linkedin_status, 'unavailable');
    assert.deepEqual(result.unavailableConditions, ['linkedin_status']);
    assert.ok(!result.pendingConditions.includes('linkedin_status'));
    assert.equal(result.completenessVerdict, 'unknown');
  });

  test('🔴 M11/M12 · ni `pending` ni `unavailable` colapsan con `failed`', () => {
    const pending = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
      pendingConditions: ['linkedin_status'],
    });
    assert.equal(pending.conditionStates.linkedin_status, 'pending');
    assert.deepEqual(pending.strictlyFailedConditions, [], 'pendiente NO es fallida');
    assert.equal(pending.completenessVerdict, 'unknown');

    const unavailable = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
      unavailableConditions: ['ownership_gate'],
    });
    assert.deepEqual(unavailable.strictlyFailedConditions, [], 'no disponible NO es fallida');
    assert.equal(unavailable.completenessVerdict, 'unknown');
  });

  test('🔴 incomplete GANA a unknown: un fallo conocido no se esconde en un hueco', () => {
    // Sin empleados (condición evaluable que falla) Y con la subindustria no
    // disponible. El dato que falta ya la descalifica: es INCOMPLETE.
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor({ employeeCount: null }), SUBINDUSTRY_REQUESTED),
      'incomplete',
    );
  });

  test('🔴 X6.12 · las tres evidencias nuevas fallan CERRADO, nunca abierto', () => {
    // Ausentes las tres —el superviviente de antes de X6.12— el ownership se
    // lee `fail` y el LinkedIn `not_returned`: condiciones EVALUADAS que fallan.
    assert.equal(evaluateLushaSurvivorCompleteness(survivorWithoutEvidence()), 'incomplete');
    // Y cada una por su cuenta descalifica.
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor({ ownershipGate: 'fail' })),
      'incomplete',
    );
    assert.equal(evaluateLushaSurvivorCompleteness(survivor({ linkedinUrl: null })), 'incomplete');
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor({ macroIndustryConfirmed: false })),
      'incomplete',
    );
  });

  test('contadores · la suma cierra y `review_only` se conserva', () => {
    const counters = buildCandidateCompletenessCounters([
      { countsTowardTarget: true, failedConditions: [] },
      { countsTowardTarget: false, failedConditions: ['x'], completenessVerdict: 'unknown' },
      { countsTowardTarget: false, failedConditions: ['y'], completenessVerdict: 'incomplete' },
    ]);

    assert.equal(counters.persisted_candidates, 3);
    assert.equal(counters.complete_valid_candidates, 1);
    assert.equal(counters.unknown_candidates, 1);
    assert.equal(counters.incomplete_candidates, 1);
    assert.equal(counters.review_only_candidates, 2, 'compatibilidad: incomplete + unknown');
    assert.equal(
      counters.complete_valid_candidates +
        counters.incomplete_candidates +
        counters.unknown_candidates,
      counters.persisted_candidates,
    );
  });

  test('sin veredicto declarado, «no completa» sigue siendo incomplete', () => {
    // Los llamadores ya escritos no distinguen: para ellos nada cambia.
    const counters = buildCandidateCompletenessCounters([
      { countsTowardTarget: false, failedConditions: ['x'] },
    ]);
    assert.equal(counters.unknown_candidates, 0, 'no se inventa un «no lo sé»');
    assert.equal(counters.incomplete_candidates, 1);
  });
});

// ══ C · ACEPTACIÓN NO MEDIDA ════════════════════════════════════════════════

describe('X5.1 § C · UNMEASURED no es cero', () => {
  test('1/2 · con subindustria PEDIDA la aceptación no se puede medir ⇒ `null`', () => {
    const truth = resolveLushaRunAcceptanceTruth(survivors(40), SUBINDUSTRY_REQUESTED);

    assert.equal(truth.acceptanceMeasurable, false);
    assert.equal(truth.acceptedForTarget, null);
    assert.notEqual(truth.acceptedForTarget, 0, 'un 0 afirmaría haber medido');
  });

  test('3/7 · el vocabulario `acceptance_not_measured` se conserva hasta el aporte', () => {
    const truth = resolveLushaRunAcceptanceTruth(survivors(40), SUBINDUSTRY_REQUESTED);
    const contribution = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: truth.acceptedForTarget,
      persistedCandidates: 40,
    });

    assert.equal(contribution.measured, false);
    assert.ok(!contribution.measured && contribution.reason === 'acceptance_not_measured');
    // 🔴 Y las FILAS sí se conocen: el universo durable no se pierde.
    assert.equal(contribution.persistedCandidates, 40);
  });

  test('🔴 M13 · `0 medido` y `null no medido` son estados DISTINTOS', () => {
    const notMeasured = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: null,
      persistedCandidates: 40,
    });
    const measuredZero = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: 0,
      persistedCandidates: 40,
    });

    assert.equal(notMeasured.measured, false);
    assert.equal(measuredZero.measured, true);
    assert.equal(measuredZero.measured && measuredZero.acceptedForTarget, 0);
    assert.notDeepEqual(notMeasured, measuredZero);
  });

  test('🔴 M14 · un aporte no medido SIEMPRE lleva motivo', () => {
    const contribution = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: null,
      persistedCandidates: 12,
    });
    assert.equal(contribution.measured, false);
    assert.ok(
      !contribution.measured && typeof contribution.reason === 'string' && contribution.reason.length > 0,
    );
  });

  test('un proveedor que NO escribió nada sí sabe su aceptación: es cero', () => {
    const contribution = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: null,
      persistedCandidates: 0,
    });
    assert.deepEqual(contribution, CONTRIBUTOR_NOT_RUN);
    assert.equal(contribution.measured, true, 'cero filas es una medición, no un hueco');
  });

  test('16 · un proveedor que SÍ satisface CUT-7 produce aceptación MEDIDA', () => {
    assert.deepEqual(PROVIDER_PRODUCES_ALL_EVIDENCE.unavailableConditions, []);

    const complete = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'confirmed',
      duplicateStatus: 'no_match',
      ownershipGate: 'pass',
      qualityGate: 'pass',
      unavailableConditions: PROVIDER_PRODUCES_ALL_EVIDENCE.unavailableConditions,
    });
    assert.equal(complete.completenessVerdict, 'complete');
    assert.equal(complete.countsTowardTarget, true);

    const contribution = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: 3,
      persistedCandidates: 10,
    });
    assert.equal(contribution.measured, true);
    assert.equal(contribution.measured && contribution.acceptedForTarget, 3);
  });

  test('🔴 M22 · la medibilidad sale del REGISTRO, no del nombre del proveedor', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const truthSource = readFileSync(join(here, '..', 'lusha-run-acceptance-truth.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');

    assert.ok(!/provider\s*===/.test(truthSource), 'ninguna rama compara el proveedor');
    assert.ok(
      truthSource.includes('unavailableConditions.length === 0'),
      'la medibilidad se deriva de la capacidad declarada',
    );
  });

  test('🔴 M21 · ignorar `unavailable` cambiaría el veredicto: la capacidad SE USA', () => {
    const ignoringCapability = evaluateCandidateTargetEligibility({
      persistenceSuccess: true,
      subindustryMatch: 'not_confirmed',
      employeeCountStatus: 'confirmed',
      linkedinStatus: 'not_returned',
      duplicateStatus: 'no_match',
      ownershipGate: 'fail',
      qualityGate: 'pass',
      // Sin declarar la capacidad: las tres se leen como FALLIDAS.
    });
    assert.equal(ignoringCapability.completenessVerdict, 'incomplete');

    // Declarándola, la condición sin respuesta es un hueco y el veredicto es
    // UNKNOWN. 🔴 X6.12 — la capacidad ya no es una constante: se RESUELVE con
    // los hechos de la corrida, y por eso el caso vive donde el hueco existe.
    assert.equal(
      evaluateLushaSurvivorCompleteness(survivor(), SUBINDUSTRY_REQUESTED),
      'unknown',
    );
  });
});

// ══ D · COMPRA: purchaseCredit Y NADA MÁS ═══════════════════════════════════

describe('X5.1 § D · la compra no mira la aceptación', () => {
  test('10/11 · ni `acceptedForTarget` ni `completeValidCandidates` deciden comprar', () => {
    const source = executorSourceWithoutComments();

    // Las cuatro decisiones de hueco leen `purchaseCreditSoFar()`.
    const gapCalls = source.match(/resolveLushaRemainingGap\([^)]*\)/g) ?? [];
    assert.ok(gapCalls.length >= 4, `se esperaban >=4 llamadas, hubo ${gapCalls.length}`);
    for (const call of gapCalls) {
      assert.ok(
        !call.includes('acceptedForTarget'),
        `🔴 M9 · la aceptación no puede decidir compras: ${call}`,
      );
      assert.ok(
        !call.includes('completeValidCandidates'),
        `🔴 M10 · la completitud no puede decidir compras: ${call}`,
      );
    }
  });

  test('8/15 · UNMEASURED no abre compra: el hueco se cierra con supervivientes', () => {
    const truth = resolveLushaRunAcceptanceTruth(survivors(40), SUBINDUSTRY_REQUESTED);
    assert.equal(truth.acceptedForTarget, null, 'no medida…');

    // …y aun así el hueco está cerrado, porque lo cierra `purchaseCredit`.
    assert.equal(resolveLushaRemainingGap(5, truth.purchaseCredit), 0);
    assert.deepEqual(
      decideLushaProviderRequest({
        remainingGap: resolveLushaRemainingGap(5, truth.purchaseCredit),
        providerRequestsUsed: 1,
        providerRequestsAllowed: 10,
        rawResultsTotal: 40,
      }),
      { allowed: false, stopReason: 'target_reached' },
      'ninguna página adicional se autoriza',
    );
  });

  test('🔴 M15 · UNKNOWN tampoco abre compra: 40 unknown cierran un hueco de 5', () => {
    const truth = resolveLushaRunAcceptanceTruth(survivors(40), SUBINDUSTRY_REQUESTED);
    assert.equal(truth.unknown, 40);
    assert.equal(truth.complete, 0);
    assert.equal(resolveLushaRemainingGap(5, truth.purchaseCredit), 0);
  });

  test('🔴 X6.12 · tampoco al revés: 40 COMPLETAS no compran más que 40 unknown', () => {
    // La compra se cierra con supervivientes, y eso no cambia porque ahora las
    // candidatas SÍ puedan completar. Si la aceptación entrara aquí, este par
    // de corridas pediría un número distinto de páginas.
    const measured = resolveLushaRunAcceptanceTruth(survivors(40));
    const unmeasured = resolveLushaRunAcceptanceTruth(survivors(40), SUBINDUSTRY_REQUESTED);

    assert.equal(measured.complete, 40);
    assert.equal(unmeasured.complete, 0);
    assert.equal(measured.purchaseCredit, unmeasured.purchaseCredit);
    assert.equal(
      resolveLushaRemainingGap(5, measured.purchaseCredit),
      resolveLushaRemainingGap(5, unmeasured.purchaseCredit),
    );
  });

  test('17 · quitar el cap NO aumenta páginas: cierra el hueco ANTES, no después', () => {
    // Con el cap, `useful` se quedaba en 5 y el hueco cerraba en 5.
    // Sin el cap, `useful` llega a 40 y cierra igual — nunca más tarde.
    const conCap = resolveLushaRemainingGap(5, 5);
    const sinCap = resolveLushaRemainingGap(5, 40);
    assert.equal(conCap, 0);
    assert.equal(sinCap, 0);
    assert.ok(sinCap <= conCap, 'más supervivientes no puede abrir más hueco');
  });

  test('7 · el request cap sigue gobernando el máximo físico de páginas', () => {
    assert.deepEqual(
      decideLushaProviderRequest({
        remainingGap: 5,
        providerRequestsUsed: 4,
        providerRequestsAllowed: 4,
        rawResultsTotal: 0,
      }),
      { allowed: false, stopReason: 'request_cap_reached' },
    );
  });
});

// ══ E · CONTABILIDAD: UNA FUENTE, UNA EXPRESIÓN ═════════════════════════════

describe('X5.1 § E · metadata y usage log leen lo mismo', () => {
  test('15 · el ejecutor evalúa la aceptación con UNA sola definición', () => {
    const source = executorSourceWithoutComments();
    const evaluations = source.match(/resolveLushaRunAcceptanceTruth\(/g) ?? [];

    // 🔴 X6.12 — el ejecutor evalúa DOS veces a propósito: antes de escribir
    // (la metadata del lote se escribe cuando las filas todavía no existen) y
    // después, sobre lo que el writer confirmó. Lo que M14-contabilidad prohíbe
    // no es evaluar dos veces: es que existan dos DEFINICIONES de «completa».
    assert.ok(
      evaluations.length >= 1 && evaluations.length <= 2,
      `🔴 a lo sumo dos evaluaciones —pre y post escritura—; hubo ${evaluations.length}`,
    );

    // La invariante de verdad: las dos leen el MISMO proyector y los MISMOS
    // hechos. Con una sola proyección no puede haber dos veredictos distintos
    // para la misma candidata.
    const projections = source.match(/toLushaSurvivorCompletenessInput/g) ?? [];
    assert.equal(
      projections.length,
      evaluations.length + 1,
      '🔴 cada evaluación proyecta con el ÚNICO proyector (+1 por su declaración)',
    );
    const facts = source.match(/acceptanceFacts/g) ?? [];
    assert.equal(
      facts.length,
      evaluations.length + 1,
      '🔴 y con los MISMOS hechos de corrida (+1 por su declaración)',
    );
  });

  test('13/14 · `accepted <= survivorsPersisted <= survivors`', () => {
    const truth = resolveLushaRunAcceptanceTruth(survivors(40));
    const insertedCount = 37; // la base confirmó menos filas de las admitidas
    const survivorsPersisted = Math.min(insertedCount, truth.survivors);

    assert.ok(survivorsPersisted <= truth.survivors);
    assert.equal(survivorsPersisted, 37);

    // Con aceptación medible, jamás puede superar lo persistido: es el clamp
    // aprobado —contra la REALIDAD de la base, no contra el objetivo—.
    const paid = paidAcceptedContributionFromWriterTruth({
      completeValidCandidates: 99,
      persistedCandidates: survivorsPersisted,
    });
    assert.equal(paid.measured, true);
    assert.equal(paid.measured && paid.acceptedForTarget, 99, 'el aporte crudo no se recorta…');
    assert.equal(paid.persistedCandidates, survivorsPersisted, '…y las filas viajan aparte');
  });

  test('🔴 M5/M6/M7 · ningún `Math.min` contra el objetivo en el ejecutor', () => {
    const source = executorSourceWithoutComments();
    const mins = source.match(/Math\.min\([^;]*?\)/g) ?? [];
    for (const expression of mins) {
      assert.ok(
        !/\btarget(Gap)?\b/.test(expression),
        `el objetivo no puede recortar nada aquí: ${expression.slice(0, 120)}`,
      );
    }
  });
});
