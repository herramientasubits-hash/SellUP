/**
 * Tests — estado de la subindustria pedida en el detalle del candidato, y
 * procedencia Apollo del candidato.
 *
 * AGENT1-APOLLO-CANDIDATE-INSERT-FORENSICS-1 · § 10 y § 11.
 *
 * La corrida `9a9acf99` guardó tres empresas con la subindustria AMBIGUA (Juan
 * Valdez, Alpina, Grupo Diana) y la ficha no lo decía en ninguna parte, mientras
 * etiquetaba a esas mismas filas como «Web/IA» aunque cada uno de sus campos
 * citaba a Apollo.
 *
 * Puro: sin red, sin Supabase, sin React.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SUBINDUSTRY_NOT_MEASURED_VALUE,
  SUBINDUSTRY_REVIEW_REASON_LABELS,
  SUBINDUSTRY_VERDICT_LABELS,
  resolveCandidateSubindustryStatus,
} from '../candidate-subindustry-status-display';
import {
  CANDIDATE_SOURCE_LABELS,
  VENDOR_CANDIDATE_SOURCE_LABELS,
} from '../types';

const REQUESTED = 'Supermercados e Hipermercados';

/** Metadata de un candidato ambiguo tal como la escribe el writer. */
function ambiguousCandidateMetadata(overrides?: {
  failedConditions?: string[];
  icpDecision?: string;
}): Record<string, unknown> {
  return {
    apollo_enrichment_capture: {
      subindustry: null,
      precision: {
        requested_subindustry: REQUESTED,
        subindustry_mapped: true,
        industry_match: 'broad_compatible',
        subindustry_match: 'ambiguous',
        subindustry_confidence: 0,
        subindustry_evidence: [],
        classification_source: 'none',
        disqualifying_signals: [],
        verdict_reason: 'broad_industry_only',
      },
    },
    target_completeness: {
      counts_toward_target: false,
      failed_conditions: overrides?.failedConditions ?? ['subindustry_match'],
      base_status: 'high_quality_new',
      persisted_status: 'needs_review',
    },
    ...(overrides?.icpDecision ? { icp_size_gate: { decision: overrides.icpDecision } } : {}),
  };
}

// ── § 11 — veredicto y objetivo ───────────────────────────────────────────────

describe('§ 11 — la subindustria ambigua NO se lee como confirmada', () => {
  it('Juan Valdez / Alpina / Grupo Diana: veredicto Ambigua', () => {
    const status = resolveCandidateSubindustryStatus(ambiguousCandidateMetadata());
    assert.equal(status.verdict, 'ambiguous');
    assert.equal(status.verdictLabel, 'Ambigua');
    assert.notEqual(status.verdictLabel, SUBINDUSTRY_VERDICT_LABELS.confirmed);
  });

  it('la subindustria PEDIDA se muestra tal como se pidió', () => {
    const status = resolveCandidateSubindustryStatus(ambiguousCandidateMetadata());
    assert.equal(status.requestedSubindustry, REQUESTED);
  });

  it('se niega explícitamente la pertenencia, nombrando la subindustria', () => {
    const status = resolveCandidateSubindustryStatus(ambiguousCandidateMetadata());
    assert.ok(status.notConfirmedMessage !== null);
    assert.match(String(status.notConfirmedMessage), /No se confirmó/);
    assert.ok(String(status.notConfirmedMessage).includes(REQUESTED));
  });

  it('no cuenta hacia el objetivo, y se dice con un «No» explícito', () => {
    const status = resolveCandidateSubindustryStatus(ambiguousCandidateMetadata());
    assert.equal(status.countsTowardTarget, false);
    assert.equal(status.countsTowardTargetLabel, 'No');
  });

  it('el motivo de revisión es «Subindustria ambigua»', () => {
    const status = resolveCandidateSubindustryStatus(ambiguousCandidateMetadata());
    assert.deepEqual(
      status.reviewReasons.map((reason) => reason.key),
      ['subindustry_ambiguous'],
    );
    assert.equal(status.reviewReasons[0].label, 'Subindustria ambigua');
  });
});

describe('§ 11 — una subindustria confirmada sí lo dice', () => {
  const confirmed = {
    apollo_enrichment_capture: {
      subindustry: REQUESTED,
      precision: {
        requested_subindustry: REQUESTED,
        subindustry_match: 'confirmed',
        classification_source: 'provider_industry',
      },
    },
    target_completeness: {
      counts_toward_target: true,
      failed_conditions: [],
    },
  };

  it('veredicto Confirmada y objetivo Sí', () => {
    const status = resolveCandidateSubindustryStatus(confirmed);
    assert.equal(status.verdictLabel, 'Confirmada');
    assert.equal(status.countsTowardTargetLabel, 'Sí');
  });

  it('no se niega una pertenencia que sí se demostró', () => {
    assert.equal(resolveCandidateSubindustryStatus(confirmed).notConfirmedMessage, null);
  });

  it('sin condiciones incumplidas no hay motivos de revisión', () => {
    assert.deepEqual(resolveCandidateSubindustryStatus(confirmed).reviewReasons, []);
  });
});

describe('§ 11 — una subindustria rechazada se nombra Rechazada', () => {
  it('rejected produce su propia etiqueta y niega la pertenencia', () => {
    const status = resolveCandidateSubindustryStatus({
      apollo_enrichment_capture: {
        precision: { requested_subindustry: REQUESTED, subindustry_match: 'rejected' },
      },
      target_completeness: { counts_toward_target: false, failed_conditions: ['subindustry_match'] },
    });
    assert.equal(status.verdictLabel, 'Rechazada');
    // AGENT1-SUBINDUSTRY-FAIL-CLOSED-TARGET-INTEGRITY-1 § 5 — «rechazada» dejó de
    // redactarse como una ambigüedad. «No se confirmó» describe una carencia de
    // evidencia; aquí la evidencia existe y CONTRADICE lo pedido, y leerlo como
    // lo primero hacía parecer que la empresa «casi» calificaba.
    assert.match(String(status.notConfirmedMessage), /no coincide con/);
    assert.doesNotMatch(String(status.notConfirmedMessage), /No se confirmó/);
    assert.deepEqual(
      status.reviewReasons.map((reason) => reason.key),
      ['subindustry_rejected'],
    );
  });
});

// ── § 11 — vocabulario cerrado de motivos ─────────────────────────────────────

describe('§ 11 — los motivos de revisión tienen vocabulario cerrado', () => {
  it('mapea las condiciones del contrato a sus motivos en español', () => {
    const status = resolveCandidateSubindustryStatus(
      ambiguousCandidateMetadata({
        failedConditions: ['subindustry_match', 'linkedin_status', 'employee_count_status'],
      }),
    );
    assert.deepEqual(
      status.reviewReasons.map((reason) => reason.label),
      ['Subindustria ambigua', 'LinkedIn ausente', 'Número de empleados ausente'],
    );
  });

  it('el gate de tamaño bloqueado aparece como «Tamaño fuera de ICP»', () => {
    const status = resolveCandidateSubindustryStatus(
      ambiguousCandidateMetadata({ icpDecision: 'block' }),
    );
    assert.ok(status.reviewReasons.some((reason) => reason.key === 'size_outside_icp'));
    assert.equal(SUBINDUSTRY_REVIEW_REASON_LABELS.size_outside_icp, 'Tamaño fuera de ICP');
  });

  it('un gate de tamaño que NO bloquea no inventa el motivo', () => {
    const status = resolveCandidateSubindustryStatus(
      ambiguousCandidateMetadata({ icpDecision: 'pass' }),
    );
    assert.ok(!status.reviewReasons.some((reason) => reason.key === 'size_outside_icp'));
  });

  it('una condición sin motivo propio cae en «Otro» en vez de desaparecer', () => {
    const status = resolveCandidateSubindustryStatus(
      ambiguousCandidateMetadata({ failedConditions: ['ownership_gate', 'quality_gate'] }),
    );
    assert.deepEqual(
      status.reviewReasons.map((reason) => reason.key),
      ['other'],
    );
    assert.equal(status.reviewReasons[0].label, 'Otro');
  });

  it('el orden de presentación es estable y no depende del orden recibido', () => {
    const status = resolveCandidateSubindustryStatus(
      ambiguousCandidateMetadata({
        failedConditions: ['employee_count_status', 'subindustry_match', 'linkedin_status'],
      }),
    );
    assert.deepEqual(
      status.reviewReasons.map((reason) => reason.key),
      ['subindustry_ambiguous', 'linkedin_missing', 'employee_count_missing'],
    );
  });
});

// ── § 11 — fail-closed ────────────────────────────────────────────────────────

describe('§ 11 — lo no medido no se convierte en un sí', () => {
  it('un candidato de otra modalidad no trae datos y no se pinta el bloque', () => {
    for (const metadata of [null, undefined, {}, 'texto', [], { otra_cosa: 1 }]) {
      assert.equal(resolveCandidateSubindustryStatus(metadata).hasData, false);
    }
  });

  it('sin veredicto se muestra «Sin medir», nunca «Confirmada»', () => {
    const status = resolveCandidateSubindustryStatus({
      target_completeness: { counts_toward_target: false, failed_conditions: [] },
    });
    assert.equal(status.verdict, null);
    assert.equal(status.verdictLabel, SUBINDUSTRY_NOT_MEASURED_VALUE);
  });

  it('sin medición de objetivo se muestra «Sin medir», nunca «Sí»', () => {
    const status = resolveCandidateSubindustryStatus({
      apollo_enrichment_capture: {
        precision: { requested_subindustry: REQUESTED, subindustry_match: 'ambiguous' },
      },
    });
    assert.equal(status.countsTowardTarget, null);
    assert.equal(status.countsTowardTargetLabel, SUBINDUSTRY_NOT_MEASURED_VALUE);
  });

  it('un veredicto desconocido no se cuela como válido', () => {
    const status = resolveCandidateSubindustryStatus({
      apollo_enrichment_capture: { precision: { subindustry_match: 'probablemente' } },
    });
    assert.equal(status.verdict, null);
  });

  it('sin subindustria declarada la negación sigue siendo explícita', () => {
    const status = resolveCandidateSubindustryStatus({
      apollo_enrichment_capture: { precision: { subindustry_match: 'ambiguous' } },
    });
    assert.match(String(status.notConfirmedMessage), /No se confirmó la subindustria solicitada/);
  });
});

// ── § 10 — procedencia Apollo ─────────────────────────────────────────────────

describe('§ 10 — un candidato de Apollo se etiqueta Apollo, nunca Web/IA', () => {
  it('la etiqueta de vendedor de `apollo` es exactamente «Apollo»', () => {
    assert.equal(VENDOR_CANDIDATE_SOURCE_LABELS.apollo, 'Apollo');
    assert.equal(CANDIDATE_SOURCE_LABELS.apollo, 'Apollo');
  });

  it('«Web/IA» sigue siendo la etiqueta de `web_ai` y de nadie más', () => {
    assert.equal(VENDOR_CANDIDATE_SOURCE_LABELS.web_ai, 'Web/IA');
    const apolloLabelledKeys = Object.entries(VENDOR_CANDIDATE_SOURCE_LABELS)
      .filter(([, label]) => label === 'Web/IA')
      .map(([key]) => key);
    assert.deepEqual(apolloLabelledKeys, ['web_ai']);
  });
});
