/**
 * A1-APOLLO-QUALITY-PERSISTENCE-HARDENING-1 § 6 — ownership separado de calidad.
 *
 * El hecho que motiva el hito: en la corrida `be181d2d…` el ÚNICO descarte fue
 * `company_ownership:reject` y `writer_summary.quality_skipped_count` valía 1.
 * Quien leyera el resumen buscaría un problema de calidad que no existía.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateSkipBreakdown,
  classifyCandidateSkipReason,
  toCandidateSkipBreakdownMetadata,
} from '../candidate-skip-reason-taxonomy';

describe('§ 6 · ownership no es calidad', () => {
  test('un descarte de ownership cae en su propia cubeta', () => {
    assert.equal(classifyCandidateSkipReason('company_ownership:reject'), 'ownership_rejected');
    assert.equal(classifyCandidateSkipReason('company_ownership:low'), 'ownership_rejected');
  });

  test('la corrida live: 1 descarte, y es ownership, no calidad', () => {
    const breakdown = buildCandidateSkipBreakdown([{ reason: 'company_ownership:reject' }]);

    assert.equal(breakdown.ownership_rejected, 1);
    assert.equal(breakdown.quality_rejected, 0);

    const metadata = toCandidateSkipBreakdownMetadata(breakdown);
    assert.equal(metadata['ownership_rejected_count'], 1);
    assert.equal(metadata['quality_rejected_count'], 0);
  });
});

describe('§ 6 · cada motivo a su cubeta', () => {
  const cases: [string, string][] = [
    ['qualityLabel=discard', 'quality_rejected'],
    ['business_fit:not_a_direct_vendor', 'quality_rejected'],
    ['external_platform:linkedin', 'quality_rejected'],
    ['source_url_quality:low', 'quality_rejected'],
    ['evidence_policy:insufficient', 'quality_rejected'],
    ['content_page', 'quality_rejected'],
    ['apollo_sector_relevance:insufficient_sector_evidence', 'sector_rejected'],
    ['country_incompatible', 'country_rejected'],
    ['country_incompatible:domain_tld', 'country_rejected'],
    ['missing_country_code', 'country_rejected'],
    ['seen_in_previous_batch_recently', 'novelty_rejected'],
    ['confirmed_duplicate_previous', 'novelty_rejected'],
    ['rejected_recently', 'cooldown'],
    ['negative_memory_rejected_recently', 'cooldown'],
    ['non_company_phrase', 'identity_gate_rejected'],
    ['non_official_source_domain', 'identity_gate_rejected'],
    ['intra_batch_identity_duplicate', 'identity_gate_rejected'],
    ['duplicate_guard:same_canonical_identity', 'duplicate_sellup'],
    ['target_cap', 'target_cap'],
    ['persistence_failed:schema_cache_miss', 'persistence_failed'],
  ];

  for (const [reason, expected] of cases) {
    test(`«${reason}» ⇒ ${expected}`, () => {
      assert.equal(classifyCandidateSkipReason(reason), expected);
    });
  }

  test('un motivo desconocido cae en `other`, jamás en calidad', () => {
    // El sesgo por defecto que este hito elimina: atribuir a calidad lo que no se
    // sabe clasificar. Si la taxonomía se queda corta, tiene que decirlo.
    assert.equal(classifyCandidateSkipReason('motivo_que_nadie_declaró'), 'other');
    const breakdown = buildCandidateSkipBreakdown([{ reason: 'motivo_que_nadie_declaró' }]);
    assert.equal(breakdown.quality_rejected, 0);
    assert.equal(breakdown.other, 1);
  });

  test('el prefijo más largo gana sobre uno más corto que también encaje', () => {
    assert.equal(classifyCandidateSkipReason('country_incompatible:tld'), 'country_rejected');
  });
});

describe('§ 6 · invariante del desglose', () => {
  test('las cubetas suman exactamente el número de descartes', () => {
    const skipped = [
      { reason: 'company_ownership:reject' },
      { reason: 'company_ownership:low' },
      { reason: 'qualityLabel=discard' },
      { reason: 'country_incompatible' },
      { reason: 'apollo_sector_relevance:insufficient_sector_evidence' },
      { reason: 'seen_in_previous_batch_recently' },
      { reason: 'rejected_recently' },
      { reason: 'target_cap' },
      { reason: 'motivo_sin_clasificar' },
    ];

    const breakdown = buildCandidateSkipBreakdown(skipped);
    const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    assert.equal(total, skipped.length);

    assert.equal(breakdown.ownership_rejected, 2);
    assert.equal(breakdown.quality_rejected, 1);
    assert.equal(breakdown.country_rejected, 1);
    assert.equal(breakdown.sector_rejected, 1);
    assert.equal(breakdown.novelty_rejected, 1);
    assert.equal(breakdown.cooldown, 1);
    assert.equal(breakdown.target_cap, 1);
    assert.equal(breakdown.other, 1);
  });

  test('sin descartes todas las cubetas están presentes en cero', () => {
    const metadata = toCandidateSkipBreakdownMetadata(buildCandidateSkipBreakdown([]));
    for (const value of Object.values(metadata)) assert.equal(value, 0);
    // Presentes, no ausentes: un desglose que omite las cubetas vacías obliga a
    // interpretar el hueco, y ésa es la ambigüedad que el § 6 elimina.
    assert.ok('ownership_rejected_count' in metadata);
    assert.ok('quality_rejected_count' in metadata);
    assert.ok('sector_rejected_count' in metadata);
    assert.ok('country_rejected_count' in metadata);
    assert.ok('duplicate_hubspot_count' in metadata);
    assert.ok('duplicate_sellup_count' in metadata);
    assert.ok('cooldown_count' in metadata);
  });
});
