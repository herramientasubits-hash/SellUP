/**
 * Tests — AGENT1-IMPORT-DUPLICATES-VISIBLE-1: los importados duplicados se ven
 * en «Descartadas», con su motivo, y son de sólo lectura.
 *
 * Caso real (30-09): Servientrega, TCC, Coordinadora y Almaviva ya estaban en
 * HubSpot → `duplicate` con `import_admission.reason = existing_in_hubspot`.
 *
 * Puro. Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IMPORT_DUPLICATE_SEND_TO_REVIEW_BLOCKED,
  importDuplicateToItem,
  isImportDuplicateCandidate,
  matchesDispositionFilter,
  resolveImportDuplicateReason,
  type ImportDuplicateCandidateRow,
} from '../import-duplicate-items';
import { evaluateSendToReviewEligibility } from '../send-to-review-eligibility';

function candidate(metadata: Record<string, unknown>, overrides: Partial<ImportDuplicateCandidateRow> = {}): ImportDuplicateCandidateRow {
  return {
    id: 'cand-1',
    batch_id: 'batch-1',
    batch: { name: 'Importación externa · 30 sept 2026', source: 'external_import', created_at: '2026-09-30T17:46:31Z' },
    name: 'Servientrega',
    domain: 'servientrega.com',
    country_code: 'CO',
    industry: 'Transporte & Logística',
    source_primary: 'external_import',
    status: 'duplicate',
    created_at: '2026-09-30T17:46:31Z',
    updated_at: '2026-09-30T17:46:31Z',
    metadata,
    ...overrides,
  };
}

describe('resolveImportDuplicateReason', () => {
  it('ya existe en HubSpot → hubspot_duplicate (el caso real)', () => {
    const r = resolveImportDuplicateReason({ import_admission: { decision: 'duplicate', reason: 'existing_in_hubspot' } });
    assert.equal(r.disposition, 'hubspot_duplicate');
    assert.match(r.reasonDetail, /HubSpot/);
  });

  it('ya es cuenta en SellUp → sellup_duplicate', () => {
    assert.equal(resolveImportDuplicateReason({ import_admission: { reason: 'existing_account' } }).disposition, 'sellup_duplicate');
  });

  it('activa en otro lote → sellup_duplicate', () => {
    assert.equal(resolveImportDuplicateReason({ import_admission: { reason: 'active_candidate_domain' } }).disposition, 'sellup_duplicate');
  });

  it('repetida en el archivo → dice con qué fila', () => {
    const r = resolveImportDuplicateReason({ import_admission: { reason: 'intra_file_duplicate', duplicate_of_row: 3 } });
    assert.equal(r.disposition, 'other');
    assert.match(r.reasonDetail, /fila 3/);
  });

  it('perdió el reclamo global frente a otro vendedor → lo dice, gane lo que diga la admisión', () => {
    const r = resolveImportDuplicateReason({
      import_admission: { decision: 'admitted' },
      global_identity_claim_conflict: { held_by_candidate_id: 'x', held_by_batch_id: 'y' },
    });
    assert.equal(r.reasonCode, 'import_claimed_by_other_seller');
    assert.match(r.reasonDetail, /Otro vendedor/);
  });

  it('sin motivo guardado → «Duplicada al importar»', () => {
    assert.equal(resolveImportDuplicateReason(null).reasonCode, 'import_duplicate');
  });
});

describe('importDuplicateToItem', () => {
  const item = importDuplicateToItem(candidate({ import_admission: { reason: 'existing_in_hubspot' } }));

  it('es una fila de la pestaña con su motivo y su fecha (para la etiqueta «Nuevo»)', () => {
    assert.equal(item.itemId, 'candidate:cand-1');
    assert.equal(item.disposition, 'hubspot_duplicate');
    assert.equal(item.createdAt, '2026-09-30T17:46:31Z');
    assert.equal(item.batchName, 'Importación externa · 30 sept 2026');
  });

  it('es de SÓLO LECTURA, con el motivo explicado', () => {
    assert.equal(item.sendToReviewBlockedReason, IMPORT_DUPLICATE_SEND_TO_REVIEW_BLOCKED);
  });

  it('y el servidor también rechaza enviarla a revisión (defensa en profundidad)', () => {
    assert.equal(evaluateSendToReviewEligibility({ status: 'duplicate' }).decision, 'reject');
  });
});

describe('isImportDuplicateCandidate', () => {
  it('sólo importados en estado duplicate', () => {
    assert.equal(isImportDuplicateCandidate({ status: 'duplicate', source_primary: 'external_import' }), true);
    assert.equal(isImportDuplicateCandidate({ status: 'duplicate', source_primary: 'apollo' }), false);
    assert.equal(isImportDuplicateCandidate({ status: 'needs_review', source_primary: 'external_import' }), false);
  });
});

describe('matchesDispositionFilter', () => {
  const item = importDuplicateToItem(candidate({ import_admission: { reason: 'existing_in_hubspot' } }));
  it('sin filtro entra; con el filtro de su motivo entra; con otro no', () => {
    assert.equal(matchesDispositionFilter(item, undefined), true);
    assert.equal(matchesDispositionFilter(item, 'hubspot_duplicate'), true);
    assert.equal(matchesDispositionFilter(item, 'country_rejected'), false);
  });
});
