/**
 * Tests — copy del resultado del wizard con prioridad de causas.
 *
 * A1-APOLLO-PERSISTENCE-READINESS-4 · § 14, casos 8, 9, 10 y 11 (copy).
 *
 * Puro: sin red, sin Supabase, sin React.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isPersistenceFailureRelevant,
  resolveWizardResultCopy,
  PERSISTENCE_FAILED_HEADING,
  PERSISTENCE_PARTIAL_HEADING,
  type WizardPersistenceOutcome,
} from '../wizard-result-copy';
import { buildNoNewCandidatesBreakdown } from '../wizard-no-new-candidates-copy';
import { APOLLO_TWO_ROUND_OBSERVABILITY_KEY } from '@/server/agents/prospecting-toolkit/apollo-two-round';
import {
  buildQa2NoNewCandidatesBreakdown,
  buildQa2TwoRoundObservability,
} from '@/server/agents/prospecting-toolkit/__tests__/qa2-persistence-fixture';

const IDENTITY_KEY_CODE = 'prospect_candidates_identity_key_unavailable';

function qa2Persistence(): WizardPersistenceOutcome {
  return {
    eligibleBeforePersistence: 1,
    persistedCandidates: 0,
    persistenceFailureCount: 1,
    persistenceFailed: true,
    persistenceErrorCode: IDENTITY_KEY_CODE,
  };
}

describe('§ 14.8 — elegible + writer fallido NO produce copy de recientes', () => {
  it('el caso QA-2 exacto: 1 elegible, 0 guardados, 8 descartes de historial', () => {
    const copy = resolveWizardResultCopy({
      persistence: qa2Persistence(),
      noNewCandidates: buildQa2NoNewCandidatesBreakdown(),
    });

    assert.equal(copy.source, 'persistence_failure');
    assert.equal(copy.cause, 'persistence_failed');
    assert.equal(copy.claimsRecentlySuggested, false);
    assert.equal(copy.heading, PERSISTENCE_FAILED_HEADING);
    assert.doesNotMatch(copy.body, /sugerid/i);
    assert.doesNotMatch(copy.body, /recientemente/i);
  });

  it('el cuerpo dice lo que se encontró, que no se pudo guardar y que NO se repita', () => {
    const copy = resolveWizardResultCopy({ persistence: qa2Persistence() });
    assert.match(copy.body, /1 empresa candidata/);
    assert.match(copy.body, /no fue posible guardarla/i);
    assert.match(copy.body, /No vuelvas a generar/i);
    assert.match(copy.body, /cr.{0,2}ditos/i);
  });

  it('la observabilidad REAL de QA-2 sigue produciendo 8 descartes de historial', () => {
    // Deliberado: el hito no baja este número. Lo que cambia es que ya no gana.
    const breakdown = buildNoNewCandidatesBreakdown(
      buildQa2TwoRoundObservability(),
      APOLLO_TWO_ROUND_OBSERVABILITY_KEY,
    );
    assert.equal(breakdown.recentlySuggestedCount, 8);
    assert.equal(breakdown.qualityRejectedCount, 0);

    const copy = resolveWizardResultCopy({
      persistence: qa2Persistence(),
      noNewCandidates: breakdown,
    });
    assert.equal(copy.cause, 'persistence_failed');
  });

  it('el fallo de almacenamiento gana incluso sobre el universo agotado', () => {
    const copy = resolveWizardResultCopy({
      persistence: qa2Persistence(),
      noNewCandidates: {
        recentlySuggestedCount: 0,
        qualityRejectedCount: 0,
        noveltyExhausted: true,
        secondRoundSkippedReason: null,
      },
    });
    assert.equal(copy.cause, 'persistence_failed');
  });

  it('pluraliza cuando se pierden varias', () => {
    const copy = resolveWizardResultCopy({
      persistence: {
        eligibleBeforePersistence: 3,
        persistedCandidates: 0,
        persistenceFailureCount: 3,
        persistenceFailed: true,
        persistenceErrorCode: IDENTITY_KEY_CODE,
      },
    });
    assert.match(copy.body, /3 empresas candidatas/);
    assert.match(copy.body, /guardarlas/);
  });

  it('el cuerpo no filtra el código técnico ni el mensaje del motor', () => {
    const copy = resolveWizardResultCopy({ persistence: qa2Persistence() });
    assert.doesNotMatch(copy.body, /identity_key/);
    assert.doesNotMatch(copy.body, /PGRST/);
    assert.doesNotMatch(copy.body, /schema cache/);
  });
});

describe('§ 14.9 — persistencia parcial', () => {
  const partial: WizardPersistenceOutcome = {
    eligibleBeforePersistence: 4,
    persistedCandidates: 1,
    persistenceFailureCount: 3,
    persistenceFailed: true,
    persistenceErrorCode: IDENTITY_KEY_CODE,
  };

  it('produce su propia causa y titular, no el de «nada se guardó»', () => {
    const copy = resolveWizardResultCopy({ persistence: partial });
    assert.equal(copy.cause, 'persistence_partial');
    assert.equal(copy.heading, PERSISTENCE_PARTIAL_HEADING);
    assert.match(copy.body, /Guardamos 1 de 4/);
    assert.equal(copy.claimsRecentlySuggested, false);
  });

  it('también advierte que el gasto ya ocurrió', () => {
    const copy = resolveWizardResultCopy({ persistence: partial });
    assert.match(copy.body, /No vuelvas a generar/i);
  });
});

describe('§ 14.10 — el historial REAL conserva su copy', () => {
  it('sin fallo de persistencia y con historial > 0, gana el historial', () => {
    const copy = resolveWizardResultCopy({
      persistence: {
        eligibleBeforePersistence: 0,
        persistedCandidates: 0,
        persistenceFailureCount: 0,
        persistenceFailed: false,
        persistenceErrorCode: null,
      },
      noNewCandidates: {
        recentlySuggestedCount: 5,
        qualityRejectedCount: 0,
        noveltyExhausted: false,
        secondRoundSkippedReason: null,
      },
    });
    assert.equal(copy.source, 'no_new_candidates');
    assert.equal(copy.cause, 'all_recently_suggested');
    assert.equal(copy.claimsRecentlySuggested, true);
    assert.match(copy.body, /sugerid/i);
  });

  it('sin cifras de persistencia (corrida previa al hito) el comportamiento es el de antes', () => {
    const copy = resolveWizardResultCopy({
      noNewCandidates: {
        recentlySuggestedCount: 2,
        qualityRejectedCount: 0,
        noveltyExhausted: false,
        secondRoundSkippedReason: null,
      },
    });
    assert.equal(copy.cause, 'all_recently_suggested');
  });
});

describe('§ 14.11 — la calidad REAL conserva su copy', () => {
  it('sin fallo de persistencia y con calidad > 0, gana la calidad', () => {
    const copy = resolveWizardResultCopy({
      persistence: {
        eligibleBeforePersistence: 0,
        persistedCandidates: 0,
        persistenceFailureCount: 0,
        persistenceFailed: false,
        persistenceErrorCode: null,
      },
      noNewCandidates: {
        recentlySuggestedCount: 0,
        qualityRejectedCount: 4,
        noveltyExhausted: false,
        secondRoundSkippedReason: null,
      },
    });
    assert.equal(copy.cause, 'all_quality_rejected');
    assert.equal(copy.claimsRecentlySuggested, false);
    assert.match(copy.body, /filtros/i);
  });

  it('ambos en cero sigue diciendo «no hubo resultados que clasificar»', () => {
    const copy = resolveWizardResultCopy({});
    assert.equal(copy.cause, 'no_results_at_all');
    assert.equal(copy.claimsRecentlySuggested, false);
  });
});

describe('§ 8 — relevancia del fallo: dos señales, no una', () => {
  it('un fallo declarado SIN empresas elegibles no secuestra el copy', () => {
    const copy = resolveWizardResultCopy({
      persistence: {
        eligibleBeforePersistence: 0,
        persistedCandidates: 0,
        persistenceFailureCount: 1,
        persistenceFailed: true,
        persistenceErrorCode: IDENTITY_KEY_CODE,
      },
      noNewCandidates: {
        recentlySuggestedCount: 3,
        qualityRejectedCount: 0,
        noveltyExhausted: false,
        secondRoundSkippedReason: null,
      },
    });
    assert.equal(copy.source, 'no_new_candidates');
  });

  it('una corrida completamente exitosa no produce aviso de almacenamiento', () => {
    const ok: WizardPersistenceOutcome = {
      eligibleBeforePersistence: 5,
      persistedCandidates: 5,
      persistenceFailureCount: 0,
      persistenceFailed: false,
      persistenceErrorCode: null,
    };
    assert.equal(isPersistenceFailureRelevant(ok), false);
    assert.equal(resolveWizardResultCopy({ persistence: ok }).source, 'no_new_candidates');
  });

  it('la nota de auditoría de ronda 2 idéntica sigue viajando en el camino normal', () => {
    const copy = resolveWizardResultCopy({
      noNewCandidates: {
        recentlySuggestedCount: 0,
        qualityRejectedCount: 2,
        noveltyExhausted: false,
        secondRoundSkippedReason: 'identical_provider_request',
      },
    });
    assert.notEqual(copy.auditNote, null);
    assert.match(String(copy.auditNote), /segunda ronda/i);
  });
});
