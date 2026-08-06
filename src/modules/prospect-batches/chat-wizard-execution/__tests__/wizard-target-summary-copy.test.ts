/**
 * wizard-target-summary-copy.test.ts
 *
 * AGENT1-APOLLO-LINKEDIN-QUALITY-INTEGRATION-1 · § H.
 *
 * Lo que estas pruebas impiden: que el panel vuelva a presentar cinco filas
 * guardadas como cinco empresas válidas.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWizardTargetSummary,
  PERSISTED_CANDIDATES_LABEL,
  COMPLETE_VALID_CANDIDATES_LABEL,
  REVIEW_ONLY_CANDIDATES_LABEL,
  TARGET_REACHED_LABEL,
  NOT_MEASURED_VALUE,
} from '../wizard-target-summary-copy';

function rowValue(
  summary: ReturnType<typeof buildWizardTargetSummary>,
  key: string,
): string {
  const row = summary.rows.find((entry) => entry.key === key);
  assert.ok(row, `falta la fila ${key}`);
  return row.value;
}

describe('§ H · el resumen muestra las cuatro cifras por separado', () => {
  test('las cuatro filas existen y llevan las etiquetas del contrato', () => {
    const summary = buildWizardTargetSummary({
      persistedCandidates: 5,
      completeValidCandidates: 2,
      reviewOnlyCandidates: 3,
      targetEligibleCompanies: 5,
    });

    assert.deepEqual(
      summary.rows.map((row) => row.key),
      [
        'persisted_candidates',
        'complete_valid_candidates',
        'review_only_candidates',
        'target_reached',
      ],
    );
    assert.deepEqual(
      summary.rows.map((row) => row.label),
      [
        PERSISTED_CANDIDATES_LABEL,
        COMPLETE_VALID_CANDIDATES_LABEL,
        REVIEW_ONLY_CANDIDATES_LABEL,
        TARGET_REACHED_LABEL,
      ],
    );
  });

  test('5 guardadas / 2 válidas / 3 en revisión / objetivo NO alcanzado', () => {
    const summary = buildWizardTargetSummary({
      persistedCandidates: 5,
      completeValidCandidates: 2,
      reviewOnlyCandidates: 3,
      targetEligibleCompanies: 5,
    });

    assert.equal(rowValue(summary, 'persisted_candidates'), '5');
    assert.equal(rowValue(summary, 'complete_valid_candidates'), '2');
    assert.equal(rowValue(summary, 'review_only_candidates'), '3');
    assert.equal(rowValue(summary, 'target_reached'), 'No');
    assert.equal(summary.targetReached, false);
  });

  test('nunca se muestran cinco «válidas» cuando tres son sólo de revisión', () => {
    const summary = buildWizardTargetSummary({
      persistedCandidates: 5,
      completeValidCandidates: 2,
      reviewOnlyCandidates: 3,
      targetEligibleCompanies: 5,
    });

    assert.notEqual(rowValue(summary, 'complete_valid_candidates'), '5');
    assert.equal(summary.claimsAllPersistedAreValid, false);
  });

  test('el objetivo alcanzado se afirma sobre las completas', () => {
    const summary = buildWizardTargetSummary({
      persistedCandidates: 7,
      completeValidCandidates: 5,
      reviewOnlyCandidates: 2,
      targetEligibleCompanies: 5,
    });

    assert.equal(rowValue(summary, 'target_reached'), 'Sí');
    assert.equal(summary.targetReached, true);
  });

  test('sin medición, se dice «sin medir» y NUNCA cero ni «sí»', () => {
    const summary = buildWizardTargetSummary({
      persistedCandidates: 5,
      completeValidCandidates: null,
      reviewOnlyCandidates: null,
      targetEligibleCompanies: 5,
    });

    assert.equal(rowValue(summary, 'complete_valid_candidates'), NOT_MEASURED_VALUE);
    assert.equal(rowValue(summary, 'review_only_candidates'), NOT_MEASURED_VALUE);
    assert.equal(rowValue(summary, 'target_reached'), NOT_MEASURED_VALUE);
    assert.equal(summary.targetReached, null);
  });

  test('sin objetivo conocido tampoco se afirma que se alcanzó', () => {
    const summary = buildWizardTargetSummary({
      persistedCandidates: 5,
      completeValidCandidates: 5,
      reviewOnlyCandidates: 0,
      targetEligibleCompanies: null,
    });

    assert.equal(summary.targetReached, null);
    assert.equal(rowValue(summary, 'target_reached'), NOT_MEASURED_VALUE);
  });

  test('cero completas se muestra como 0 y el objetivo como No', () => {
    const summary = buildWizardTargetSummary({
      persistedCandidates: 3,
      completeValidCandidates: 0,
      reviewOnlyCandidates: 3,
      targetEligibleCompanies: 5,
    });

    // Cero MEDIDO sí es cero: lo que no puede confundirse con cero es la ausencia.
    assert.equal(rowValue(summary, 'complete_valid_candidates'), '0');
    assert.equal(summary.targetReached, false);
  });
});
