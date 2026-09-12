/**
 * ownership-evidence-x3.test.ts
 *
 * AGENT1-OWNERSHIP-OBSERVABILITY-X3 — la fila de descarte lleva por fin la
 * evidencia con la que se descartó.
 *
 * ── Qué fija ────────────────────────────────────────────────────────────────
 *
 * Que `evidence` de cada `prospect_discarded_dispositions` persiste:
 *
 *   provider_raw_name      el nombre CRUDO del proveedor, el que el gate juzgó
 *   linkedin_url           evidencia de propiedad que el gate NO mira (D3 sigue
 *                          fuera: se guarda, no se usa)
 *   ownership_gate         el veredicto EXACTO, o `null` si el gate no corrió
 *   ownership_gate_source  cuál de los dos casos es, nombrado
 *
 * ── Por qué contra el constructor puro y no contra el escritor ──────────────
 *
 * `pipeline-writer.server.ts` sólo se puede probar con `mock.module`, y en
 * Node 24 —el de CI— `namedExports` se ignora y el módulo real sale a la red:
 * `pipeline-writer.test.ts` es roja en Node 24 justo por eso, y no está cableada
 * en el workflow. Colgar de ahí la prueba de un corte de observabilidad habría
 * sido construir sobre arena. `buildDiscardedDispositionRows` es el mismo código,
 * extraído sin cambiarle una coma, y es puro.
 *
 * Offline: sin Supabase, sin red, sin créditos.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildDiscardedDispositionRows } from '../dispositions-row-builder';
import type { EvaluatedCandidateIdentityLike } from '../pipeline-writer.server';

const BATCH_ID = 'c7c28980-772b-425a-b548-581cfecb32f7';

/** La forma real de una candidata que el gate FINAL de ownership rechazó. */
function ownershipRejectedCandidate(): EvaluatedCandidateIdentityLike {
  return {
    candidateKey: 'apollo:5e5638784636bd0001e050c2',
    identity: {
      providerOrganizationId: '5e5638784636bd0001e050c2',
      normalizedDomain: 'copadeg.com',
      // Lo que hoy se persiste como `name`: tokens ordenados, irreversible.
      canonicalName: 'copadpharma',
      normalizedLinkedInUrl: 'linkedin.com/company/copadpharma',
    },
    providerRawName: 'Copadpharma S.A.S.',
    ownership: {
      allowed: false,
      confidence: 'reject',
      reason:
        'Domain "copadeg.com" does not match company name "Copadpharma S.A.S." (normalized: "copadpharma" vs "copadeg")',
      matchedSignals: [],
      missingSignals: ['domain_name_match'],
      evaluationName: 'Copadpharma S.A.S.',
      recoveredFromDomain: false,
      effectiveDomain: 'copadeg.com',
    },
  };
}

/** Una candidata sin dominio: murió en el gate BARATO, el ownership no la vio. */
function invalidDomainCandidate(): EvaluatedCandidateIdentityLike {
  return {
    candidateKey: 'apollo:5c283a0180f93eae1dded1b5',
    identity: {
      providerOrganizationId: '5c283a0180f93eae1dded1b5',
      normalizedDomain: null,
      canonicalName: 'postobon',
      normalizedLinkedInUrl: 'linkedin.com/company/postobon',
    },
    providerRawName: 'Postobón',
    ownership: null,
  };
}

function build(candidates: EvaluatedCandidateIdentityLike[], finalReason: string) {
  return buildDiscardedDispositionRows({
    batchId: BATCH_ID,
    requestedCountryCode: 'CO',
    requestedIndustry: 'Retail',
    sourcePrimary: 'apollo',
    evaluatedCandidates: candidates,
    finalDispositions: candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      roundNumber: 1,
      finalDisposition: 'ownership_rejected_final',
      finalReason,
    })),
  });
}

describe('§ 1 · la evidencia del gate llega a la fila', () => {
  test('🔴 provider_raw_name persiste el nombre CRUDO, no el canónico', () => {
    const candidate = ownershipRejectedCandidate();
    const { rows } = build([candidate], 'ownership_mismatch');
    assert.equal(rows.length, 1);
    const evidence = rows[0].evidence as Record<string, unknown>;

    assert.equal(evidence.provider_raw_name, 'Copadpharma S.A.S.');
    // Y el canónico sigue donde siempre, sin sustituir al crudo.
    assert.equal(rows[0].name, 'copadpharma');
    assert.notEqual(evidence.provider_raw_name, rows[0].name);
  });

  test('🔴 linkedin_url viaja — se guarda, NO entra en ninguna decisión', () => {
    const { rows } = build([ownershipRejectedCandidate()], 'ownership_mismatch');
    const evidence = rows[0].evidence as Record<string, unknown>;
    assert.equal(evidence.linkedin_url, 'linkedin.com/company/copadpharma');
  });

  test('🔴 ownership_gate persiste el veredicto exacto, campo a campo', () => {
    const { rows } = build([ownershipRejectedCandidate()], 'ownership_mismatch');
    const evidence = rows[0].evidence as Record<string, unknown>;

    assert.deepEqual(evidence.ownership_gate, {
      allowed: false,
      confidence: 'reject',
      reason:
        'Domain "copadeg.com" does not match company name "Copadpharma S.A.S." (normalized: "copadpharma" vs "copadeg")',
      matched_signals: [],
      missing_signals: ['domain_name_match'],
      evaluation_name: 'Copadpharma S.A.S.',
      recovered_from_domain: false,
      effective_domain: 'copadeg.com',
    });
    assert.equal(evidence.ownership_gate_source, 'pre_writer_final_gate');
  });

  test('🔴 sin veredicto: null + not_evaluated, nunca un rechazo inventado', () => {
    const { rows } = build([invalidDomainCandidate()], 'invalid_domain');
    const evidence = rows[0].evidence as Record<string, unknown>;

    assert.equal(evidence.ownership_gate, null);
    assert.equal(evidence.ownership_gate_source, 'not_evaluated');
    // El nombre crudo y el LinkedIn SÍ viajan aunque el gate no corriera.
    assert.equal(evidence.provider_raw_name, 'Postobón');
    assert.equal(evidence.linkedin_url, 'linkedin.com/company/postobon');
  });

  test('la mezcla de la certificación: 7 con veredicto + 8 sin evaluar', () => {
    const evaluated = Array.from({ length: 7 }, (_u, i) => {
      const candidate = ownershipRejectedCandidate();
      candidate.candidateKey = `apollo:mismatch-${i}`;
      candidate.identity = { ...candidate.identity, normalizedDomain: `empresa${i}.com` };
      return candidate;
    });
    const notEvaluated = Array.from({ length: 8 }, (_u, i) => {
      const candidate = invalidDomainCandidate();
      candidate.candidateKey = `apollo:sin-dominio-${i}`;
      candidate.identity = { ...candidate.identity, canonicalName: `sin dominio ${i}` };
      return candidate;
    });

    const { rows } = build([...evaluated, ...notEvaluated], 'ownership_mismatch');
    assert.equal(rows.length, 15);

    const bySource = rows.reduce<Record<string, number>>((acc, row) => {
      const source = String((row.evidence as Record<string, unknown>).ownership_gate_source);
      acc[source] = (acc[source] ?? 0) + 1;
      return acc;
    }, {});
    // 7 + 8 = las 15 `ownership_rejected_final`, cada una declarando de cuál de
    // los dos gates viene. Ésa es la reconciliación que antes no existía.
    assert.deepEqual(bySource, { pre_writer_final_gate: 7, not_evaluated: 8 });
  });
});

describe('§ 2 · X3 no toca nada de lo que ya se persistía', () => {
  test('los campos previos de la fila siguen intactos', () => {
    const { rows } = build([ownershipRejectedCandidate()], 'ownership_mismatch');
    const row = rows[0];

    assert.equal(row.batchId, BATCH_ID);
    assert.equal(row.providerIdentifier, '5e5638784636bd0001e050c2');
    assert.equal(row.sourceKey, 'domain:copadeg.com');
    assert.equal(row.domain, 'copadeg.com');
    assert.equal(row.countryCode, 'CO');
    assert.equal(row.industry, 'Retail');
    assert.equal(row.sourcePrimary, 'apollo');
    assert.equal(row.roundOrigin, 'round_1');
    assert.equal(row.disposition, 'ownership_domain_rejected');
    assert.equal(row.reasonCode, 'ownership_rejected_final');
    assert.equal(row.reasonDetail, 'ownership_mismatch');

    const evidence = row.evidence as Record<string, unknown>;
    assert.equal(evidence.candidate_key, 'apollo:5e5638784636bd0001e050c2');
    assert.equal(evidence.round_number, 1);
    assert.equal(evidence.final_disposition, 'ownership_rejected_final');
    assert.equal(evidence.final_reason, 'ownership_mismatch');
    assert.equal(evidence.writer_gap, null);
  });

  test('una candidata sin los campos de X3 sigue produciendo su fila', () => {
    // Compatibilidad hacia atrás: la pierna de Lusha y cualquier llamador que
    // todavía no informe la evidencia nueva no se rompe, y sus filas declaran
    // honestamente que nadie evaluó ownership.
    const legacy: EvaluatedCandidateIdentityLike = {
      candidateKey: 'apollo:legacy',
      identity: {
        providerOrganizationId: 'org-legacy',
        normalizedDomain: 'legacy.com',
        canonicalName: 'legacy',
      },
    };
    const { rows } = build([legacy], 'ownership_mismatch');
    assert.equal(rows.length, 1);
    const evidence = rows[0].evidence as Record<string, unknown>;
    assert.equal(evidence.provider_raw_name, null);
    assert.equal(evidence.linkedin_url, null);
    assert.equal(evidence.ownership_gate, null);
    assert.equal(evidence.ownership_gate_source, 'not_evaluated');
  });

  test('la deduplicación por source_key sigue mandando', () => {
    const a = ownershipRejectedCandidate();
    const b = ownershipRejectedCandidate();
    b.candidateKey = 'apollo:duplicado';
    b.providerRawName = 'Otro Nombre';
    const { rows } = buildDiscardedDispositionRows({
      batchId: BATCH_ID,
      requestedCountryCode: 'CO',
      requestedIndustry: 'Retail',
      sourcePrimary: 'apollo',
      evaluatedCandidates: [a, b],
      finalDispositions: [a, b].map((candidate) => ({
        candidateKey: candidate.candidateKey,
        roundNumber: 1,
        finalDisposition: 'ownership_rejected_final',
        finalReason: 'ownership_mismatch',
      })),
    });
    // Dos filas construidas con la MISMA source_key: la deduplicación final vive
    // en el escritor, así que aquí siguen siendo dos. Lo que este test fija es
    // que X3 no alteró la clave.
    assert.equal(rows.length, 2);
    assert.equal(rows[0].sourceKey, rows[1].sourceKey);
  });
});
