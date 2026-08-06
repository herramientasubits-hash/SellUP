/**
 * Tests — copy y desglose de la persistencia PARCIAL.
 *
 * AGENT1-APOLLO-CANDIDATE-INSERT-FORENSICS-1 · § 7.
 *
 * La corrida `9a9acf99-79e4-406f-a7cb-5784c88ac965` intentó 4 escrituras, guardó
 * 3 y perdió una —la única con subindustria confirmada, es decir la única que
 * contaba hacia el objetivo—. La UI no tenía forma de decirlo: sólo sabía
 * anunciar «todo bien» o «no pudimos guardar nada», y la corrida no era ninguna
 * de las dos cosas.
 *
 * Puro: sin red, sin Supabase, sin React.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PERSISTENCE_FAILED_HEADING,
  PERSISTENCE_PARTIAL_HEADING,
  WIZARD_PERSISTENCE_BREAKDOWN_LABELS,
  buildWizardPersistenceBreakdown,
  resolveWizardPersistenceCounts,
  resolveWizardPersistenceStatus,
  resolveWizardResultCopy,
  type WizardPersistenceBreakdownRowKey,
  type WizardPersistenceOutcome,
} from '../wizard-result-copy';
import { NOT_MEASURED_VALUE } from '../wizard-target-summary-copy';

const WRITE_FAILED_CODE = 'prospect_candidate_write_failed';

/** La corrida real: 4 intentos, 3 filas, 1 violación de CHECK, 0 completas. */
function run9a9acf99(): WizardPersistenceOutcome {
  return {
    eligibleBeforePersistence: 4,
    persistedCandidates: 3,
    persistenceFailureCount: 1,
    persistenceFailed: true,
    persistenceErrorCode: WRITE_FAILED_CODE,
    persistenceStatus: 'partial_failure',
    persistenceAttemptedCount: 4,
    persistenceSucceededCount: 3,
    persistenceFailedCount: 1,
    persistenceGap: 1,
    lateDuplicateCount: 0,
    completeValidCandidates: 0,
    reviewOnlyCandidates: 3,
  };
}

function valueOf(
  rows: ReturnType<typeof buildWizardPersistenceBreakdown>,
  key: WizardPersistenceBreakdownRowKey,
): string {
  const row = rows.find((candidate) => candidate.key === key);
  assert.ok(row, `falta la fila ${key}`);
  return row.value;
}

// ── § 7 — el texto exacto de 3 de 4 ───────────────────────────────────────────

describe('§ 7 — persistencia parcial: ni éxito total ni error total', () => {
  it('la corrida 9a9acf99 dice «Se guardaron 3 de 4 candidatos. Uno no pudo guardarse.»', () => {
    const copy = resolveWizardResultCopy({ persistence: run9a9acf99() });
    assert.equal(copy.source, 'persistence_failure');
    assert.equal(copy.cause, 'persistence_partial');
    assert.equal(copy.heading, PERSISTENCE_PARTIAL_HEADING);
    assert.ok(
      copy.body.startsWith('Se guardaron 3 de 4 candidatos. Uno no pudo guardarse.'),
      `el cuerpo no empieza con la frase exigida: ${copy.body}`,
    );
  });

  it('no se anuncia como éxito ni como fracaso total', () => {
    const copy = resolveWizardResultCopy({ persistence: run9a9acf99() });
    assert.notEqual(copy.heading, PERSISTENCE_FAILED_HEADING);
    assert.doesNotMatch(copy.body, /no fue posible guardarl/i);
    assert.doesNotMatch(copy.body, /correctamente/i);
  });

  it('sigue advirtiendo que el gasto ya ocurrió y que no se repita', () => {
    const copy = resolveWizardResultCopy({ persistence: run9a9acf99() });
    assert.match(copy.body, /No vuelvas a generar/i);
    assert.match(copy.body, /cr.{0,2}ditos/i);
  });

  it('no habla de historial ni de resultados ya sugeridos', () => {
    const copy = resolveWizardResultCopy({
      persistence: run9a9acf99(),
      noNewCandidates: {
        hubspotDuplicateCount: 3,
        sellupDuplicateCount: 0,
        cooldownCount: 5,
        repeatedAcrossRoundsCount: 0,
        qualityRejectedCount: 0,
        countryRejectedCount: 0,
        sectorRejectedCount: 0,
        ownershipRejectedCount: 0,
        noveltyExhausted: false,
        secondRoundSkippedReason: null,
      },
    });
    assert.equal(copy.claimsRecentlySuggested, false);
    assert.doesNotMatch(copy.body, /sugerid/i);
  });

  it('no filtra el código técnico ni el mensaje del motor', () => {
    const copy = resolveWizardResultCopy({ persistence: run9a9acf99() });
    assert.doesNotMatch(copy.body, /check constraint/i);
    assert.doesNotMatch(copy.body, /classification_source/);
    assert.doesNotMatch(copy.body, /23514/);
  });
});

describe('§ 7 — la frase se generaliza a otras cantidades', () => {
  it('5 de 8 con 3 perdidos usa el plural', () => {
    const copy = resolveWizardResultCopy({
      persistence: {
        ...run9a9acf99(),
        persistenceAttemptedCount: 8,
        persistenceSucceededCount: 5,
        persistenceFailedCount: 3,
        persistenceGap: 3,
      },
    });
    assert.ok(
      copy.body.startsWith('Se guardaron 5 de 8 candidatos. 3 no pudieron guardarse.'),
      copy.body,
    );
  });

  it('un solo fallo siempre dice «Uno», nunca «1»', () => {
    const copy = resolveWizardResultCopy({
      persistence: {
        ...run9a9acf99(),
        persistenceAttemptedCount: 10,
        persistenceSucceededCount: 9,
        persistenceFailedCount: 1,
        persistenceGap: 1,
      },
    });
    assert.match(copy.body, /Se guardaron 9 de 10 candidatos\. Uno no pudo guardarse\./);
  });

  it('cero guardados sigue siendo fallo total, no parcial', () => {
    const copy = resolveWizardResultCopy({
      persistence: {
        ...run9a9acf99(),
        persistenceStatus: 'failed',
        persistedCandidates: 0,
        persistenceSucceededCount: 0,
        persistenceFailedCount: 4,
        persistenceGap: 4,
      },
    });
    assert.equal(copy.cause, 'persistence_failed');
    assert.equal(copy.heading, PERSISTENCE_FAILED_HEADING);
  });
});

// ── Cifras normalizadas ───────────────────────────────────────────────────────

describe('§ 7 — las cifras se reconstruyen sin inventar', () => {
  it('una corrida previa al hito reconstruye intentos, guardados y fallidos', () => {
    const counts = resolveWizardPersistenceCounts({
      eligibleBeforePersistence: 4,
      persistedCandidates: 1,
      persistenceFailureCount: 3,
      persistenceFailed: true,
      persistenceErrorCode: WRITE_FAILED_CODE,
    });
    assert.deepEqual(
      { attempted: counts.attempted, succeeded: counts.succeeded, failed: counts.failed },
      { attempted: 4, succeeded: 1, failed: 3 },
    );
  });

  it('lo no medido queda en null, nunca en cero', () => {
    const counts = resolveWizardPersistenceCounts({
      eligibleBeforePersistence: 4,
      persistedCandidates: 1,
      persistenceFailureCount: 3,
      persistenceFailed: true,
      persistenceErrorCode: WRITE_FAILED_CODE,
    });
    assert.equal(counts.lateDuplicates, null);
    assert.equal(counts.completeValid, null);
    assert.equal(counts.reviewOnly, null);
  });

  it('los duplicados tardíos salen del hueco menos los fallos', () => {
    const counts = resolveWizardPersistenceCounts({
      eligibleBeforePersistence: 5,
      persistedCandidates: 3,
      persistenceFailureCount: 1,
      persistenceFailed: true,
      persistenceErrorCode: WRITE_FAILED_CODE,
      persistenceAttemptedCount: 5,
      persistenceSucceededCount: 3,
      persistenceFailedCount: 1,
      persistenceGap: 2,
    });
    assert.equal(counts.lateDuplicates, 1);
  });

  it('nunca se muestra un «3 de 2»: los intentos cubren guardados más fallidos', () => {
    const counts = resolveWizardPersistenceCounts({
      eligibleBeforePersistence: 2,
      persistedCandidates: 3,
      persistenceFailureCount: 1,
      persistenceFailed: true,
      persistenceErrorCode: WRITE_FAILED_CODE,
    });
    assert.equal(counts.attempted, 4);
  });

  it('el estado del servidor manda sobre la reconstrucción', () => {
    assert.equal(resolveWizardPersistenceStatus(run9a9acf99()), 'partial_failure');
    assert.equal(
      resolveWizardPersistenceStatus({
        eligibleBeforePersistence: 4,
        persistedCandidates: 3,
        persistenceFailureCount: 1,
        persistenceFailed: true,
        persistenceErrorCode: WRITE_FAILED_CODE,
      }),
      'partial_failure',
    );
  });
});

// ── Desglose administrativo ───────────────────────────────────────────────────

describe('§ 7 — desglose administrativo de cinco filas', () => {
  it('trae las cinco filas exigidas, en su orden', () => {
    const rows = buildWizardPersistenceBreakdown(run9a9acf99());
    assert.deepEqual(
      rows.map((row) => row.key),
      [
        'persisted',
        'persistence_failures',
        'late_duplicates',
        'complete_valid',
        'review_only',
      ],
    );
  });

  it('las etiquetas son las administrativas, no las de marketing', () => {
    assert.deepEqual(WIZARD_PERSISTENCE_BREAKDOWN_LABELS, {
      persisted: 'Guardados',
      persistence_failures: 'Fallos de persistencia',
      late_duplicates: 'Duplicados tardíos',
      complete_valid: 'Candidatos completos',
      review_only: 'Candidatos para revisión',
    });
  });

  it('la corrida 9a9acf99: 3 guardados, 1 fallo, 0 duplicados, 0 completos, 3 en revisión', () => {
    const rows = buildWizardPersistenceBreakdown(run9a9acf99());
    assert.equal(valueOf(rows, 'persisted'), '3');
    assert.equal(valueOf(rows, 'persistence_failures'), '1');
    assert.equal(valueOf(rows, 'late_duplicates'), '0');
    assert.equal(valueOf(rows, 'complete_valid'), '0');
    assert.equal(valueOf(rows, 'review_only'), '3');
  });

  it('«guardados» y «candidatos completos» no son la misma cifra', () => {
    const rows = buildWizardPersistenceBreakdown(run9a9acf99());
    assert.notEqual(valueOf(rows, 'persisted'), valueOf(rows, 'complete_valid'));
  });

  it('lo no medido se muestra como «Sin medir», nunca como 0', () => {
    const rows = buildWizardPersistenceBreakdown({
      eligibleBeforePersistence: 4,
      persistedCandidates: 3,
      persistenceFailureCount: 1,
      persistenceFailed: true,
      persistenceErrorCode: WRITE_FAILED_CODE,
    });
    assert.equal(valueOf(rows, 'complete_valid'), NOT_MEASURED_VALUE);
    assert.equal(valueOf(rows, 'review_only'), NOT_MEASURED_VALUE);
    assert.equal(valueOf(rows, 'late_duplicates'), NOT_MEASURED_VALUE);
  });

  it('sin cifras de persistencia no se pinta una tabla de ceros', () => {
    assert.deepEqual(buildWizardPersistenceBreakdown(null), []);
    assert.deepEqual(buildWizardPersistenceBreakdown(undefined), []);
  });
});
