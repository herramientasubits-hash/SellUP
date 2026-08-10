/**
 * wizard-breakdown-reconciliation.test.ts
 *
 * AGENT1-MULTI-SUBINDUSTRY-REQUEST-OBSERVABILITY-1 § B.6 / § B.7.
 *
 * El desglose que ve el usuario tiene que CERRAR contra el total de empresas
 * únicas. Cuando no cierra, la diferencia se declara — no se esconde.
 *
 * Suite pura: sin React, sin I/O.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNoNewCandidatesCompactBreakdown,
  computeUniqueResultReconciliation,
  toNoNewCandidatesBreakdownRows,
  NO_NEW_CANDIDATES_BREAKDOWN_LABELS,
  type NoNewCandidatesBreakdown,
} from '../wizard-no-new-candidates-copy';

/** Distribución REAL de la corrida `7d92773b`, ya con el rechazo sectorial. */
const REFERENCE_RUN: NoNewCandidatesBreakdown = {
  hubspotDuplicateCount: 8,
  sellupDuplicateCount: 0,
  cooldownCount: 7,
  repeatedAcrossRoundsCount: 0,
  qualityRejectedCount: 5,
  countryRejectedCount: 1,
  sectorRejectedCount: 1,
  ownershipRejectedCount: 3,
  uniqueResultsCount: 20,
  noveltyExhausted: false,
  secondRoundSkippedReason: null,
};

describe('§ B.6 — invariante de reconciliación', () => {
  test('la corrida de referencia cierra en 20 y deja 0 sin clasificar', () => {
    const reconciliation = computeUniqueResultReconciliation({
      uniqueResultsCount: 20,
      hubspotDuplicateCount: 8,
      sellupDuplicateCount: 0,
      cooldownCount: 7,
      countryRejectedCount: 1,
      sectorRejectedCount: 1,
      ownershipRejectedCount: 3,
      candidatesCreatedCount: 0,
    });

    assert.equal(reconciliation.uniqueProviderResults, 20);
    assert.equal(reconciliation.classifiedUniqueResults, 20);
    assert.equal(reconciliation.unclassifiedUniqueResults, 0);
    assert.equal(reconciliation.overCountedUniqueResults, 0);
  });

  test('el defecto ANTERIOR (sector sin contabilizar) deja 1 sin clasificar', () => {
    const reconciliation = computeUniqueResultReconciliation({
      uniqueResultsCount: 20,
      hubspotDuplicateCount: 8,
      sellupDuplicateCount: 0,
      cooldownCount: 7,
      countryRejectedCount: 1,
      sectorRejectedCount: 0, // ← lo que Producción escribió antes del arreglo
      ownershipRejectedCount: 3,
      candidatesCreatedCount: 0,
    });

    assert.equal(reconciliation.classifiedUniqueResults, 19);
    assert.equal(reconciliation.unclassifiedUniqueResults, 1);
  });

  test('las repeticiones entre rondas NO participan: cuentan eventos, no empresas', () => {
    const compact = buildNoNewCandidatesCompactBreakdown(
      { ...REFERENCE_RUN, repeatedAcrossRoundsCount: 5 },
      { candidatesCreatedCount: 0 },
    );

    assert.equal(compact.repeatedAcrossRoundsCount, 5);
    assert.equal(compact.unclassifiedUniqueResultsCount, 0);
    assert.equal(compact.overCountedUniqueResultsCount, 0);
  });

  test('un sobreconteo se declara, no se satura a cero', () => {
    const reconciliation = computeUniqueResultReconciliation({
      uniqueResultsCount: 10,
      hubspotDuplicateCount: 8,
      sellupDuplicateCount: 0,
      cooldownCount: 4,
      countryRejectedCount: 0,
      sectorRejectedCount: 0,
      ownershipRejectedCount: 0,
      candidatesCreatedCount: 0,
    });

    assert.equal(reconciliation.unclassifiedUniqueResults, 0);
    assert.equal(reconciliation.overCountedUniqueResults, 2);
  });

  test('los candidatos creados forman parte del cierre', () => {
    const reconciliation = computeUniqueResultReconciliation({
      uniqueResultsCount: 10,
      hubspotDuplicateCount: 4,
      sellupDuplicateCount: 1,
      cooldownCount: 2,
      countryRejectedCount: 0,
      sectorRejectedCount: 0,
      ownershipRejectedCount: 0,
      candidatesCreatedCount: 3,
    });

    assert.equal(reconciliation.classifiedUniqueResults, 10);
    assert.equal(reconciliation.unclassifiedUniqueResults, 0);
  });
});

describe('§ B.7 — el desglose que pinta la UI', () => {
  test('la corrida de referencia enseña las seis filas y suma 20', () => {
    const compact = buildNoNewCandidatesCompactBreakdown(REFERENCE_RUN, {
      candidatesCreatedCount: 0,
    });
    const rows = toNoNewCandidatesBreakdownRows(compact);
    const byLabel = new Map(rows.map((row) => [row.label, row.count]));

    assert.equal(byLabel.get('Empresas únicas encontradas'), 20);
    assert.equal(byLabel.get('Ya existían en HubSpot'), 8);
    assert.equal(byLabel.get('Sugeridas recientemente (en enfriamiento)'), 7);
    assert.equal(byLabel.get('Descartadas por país'), 1);
    assert.equal(byLabel.get('Descartadas por sector o subindustria'), 1);
    assert.equal(
      byLabel.get('Descartadas porque el dominio no acredita a la empresa'),
      3,
    );
    assert.equal(byLabel.get('Candidatos creados'), 0);

    const dispositions =
      compact.hubspotDuplicateCount +
      compact.sellupDuplicateCount +
      compact.cooldownCount +
      compact.countryRejectedCount +
      compact.sectorRejectedCount +
      compact.ownershipRejectedCount +
      compact.candidatesCreatedCount;
    assert.equal(dispositions, 20);
  });

  test('con el desglose cerrado, la fila «sin clasificar» NO existe', () => {
    const rows = toNoNewCandidatesBreakdownRows(
      buildNoNewCandidatesCompactBreakdown(REFERENCE_RUN, { candidatesCreatedCount: 0 }),
    );

    assert.equal(
      rows.some((row) => row.key === 'unclassifiedUniqueResultsCount'),
      false,
    );
    assert.equal(
      rows.some((row) => row.key === 'overCountedUniqueResultsCount'),
      false,
    );
  });

  test('cuando NO cierra, la fila aparece con la diferencia exacta', () => {
    const rows = toNoNewCandidatesBreakdownRows(
      buildNoNewCandidatesCompactBreakdown(
        { ...REFERENCE_RUN, sectorRejectedCount: 0, qualityRejectedCount: 4 },
        { candidatesCreatedCount: 0 },
      ),
    );

    const unclassified = rows.find((row) => row.key === 'unclassifiedUniqueResultsCount');
    assert.ok(unclassified, 'la fila de guardrail debe existir');
    assert.equal(unclassified.count, 1);
    assert.equal(
      unclassified.label,
      NO_NEW_CANDIDATES_BREAKDOWN_LABELS.unclassifiedUniqueResultsCount,
    );
    assert.ok(unclassified.hint && unclassified.hint.length > 0);
    // Va al final: es lo último que se lee, después del marco.
    assert.equal(rows[rows.length - 1]?.key, 'unclassifiedUniqueResultsCount');
  });

  test('un sobreconteo también se pinta', () => {
    const rows = toNoNewCandidatesBreakdownRows(
      buildNoNewCandidatesCompactBreakdown(
        { ...REFERENCE_RUN, uniqueResultsCount: 15 },
        { candidatesCreatedCount: 0 },
      ),
    );

    const over = rows.find((row) => row.key === 'overCountedUniqueResultsCount');
    assert.ok(over);
    assert.equal(over.count, 5);
  });
});
