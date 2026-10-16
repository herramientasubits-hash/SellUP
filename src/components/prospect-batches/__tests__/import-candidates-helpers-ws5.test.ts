/**
 * Tests — AGENT1-AUDIT-WS5-IMPORT-OVERRIDES-1: lo que el drawer envía al crear
 * el lote y cómo lee la respuesta.
 *
 * Puro: cero red.
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildImportCandidates,
  readCreateImportBatchResponse,
  selectClassifiedRowsForImport,
} from '../import-candidates-helpers';
import type { ImportPreview, ImportRow } from '@/modules/prospect-batches/import-candidates-parser';
import type { ImportClassificationPreviewRow } from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

function previewRow(index: number, name: string, status: ImportRow['status'], industry?: string): ImportRow {
  return {
    index,
    raw: { company_name: name, country_code: 'CO', industry },
    status,
    errors: status === 'error' ? ['Falta país'] : [],
    warnings: [],
    resolved_country_code: status === 'error' ? null : 'CO',
    country_from_default: false,
    industry_from_default: false,
    industryOriginalValue: industry ?? null,
    subindustryOriginalValue: null,
  };
}

function classified(rowNumber: number, extra: Partial<ImportClassificationPreviewRow> = {}): ImportClassificationPreviewRow {
  return {
    rowNumber,
    companyName: '',
    countryCode: 'CO',
    industryOriginalValue: null,
    industryCanonicalId: null,
    industryCanonicalName: null,
    industryMatchStatus: 'exact_match',
    subindustryOriginalValue: null,
    subindustryCanonicalId: null,
    subindustryCanonicalName: null,
    subindustryMatchStatus: 'missing',
    validationStatus: 'valid',
    requiresHumanReview: false,
    warnings: [],
    correctionSource: 'automatic',
    ...extra,
  };
}

const PREVIEW = {
  total: 3,
  valid: 2,
  errors: 1,
  warnings_only: 0,
  recognized_columns: ['company_name'],
  unrecognized_columns: [],
  duplicateColumns: [],
  rows: [
    previewRow(0, 'Fila con error', 'error'),
    previewRow(1, 'Acme SAS', 'valid', 'tech'),
    previewRow(2, 'Beta SAS', 'valid', 'Inventada'),
  ],
  detection: 'contract',
  column_guesses: [],
} as unknown as ImportPreview;

describe('selectClassifiedRowsForImport', () => {
  it('con una fila con error antes, cada fila clasificada se empareja con SU fila (no con la de al lado)', () => {
    // La clasificación numera sólo las filas clasificables: 1 = Acme, 2 = Beta.
    const { rows } = selectClassifiedRowsForImport(PREVIEW, [classified(1), classified(2)], new Set([2]));
    assert.deepEqual(rows.map((r) => r.raw.company_name), ['Beta SAS']);
  });

  it('una corrección manual viaja como override por índice de la vista previa', () => {
    const { rows, overrides } = selectClassifiedRowsForImport(
      PREVIEW,
      [
        classified(1),
        classified(2, { correctionSource: 'manual', industryCanonicalId: 'ind-sal', validationStatus: 'valid' }),
      ],
      new Set([1, 2]),
    );
    assert.equal(rows.length, 2);
    assert.deepEqual([...overrides.entries()], [[2, { industryId: 'ind-sal', subindustryId: null }]]);
  });
});

describe('buildImportCandidates', () => {
  it('normaliza la industria igual que al clasificar y adjunta el id corregido', () => {
    const candidates = buildImportCandidates(
      [PREVIEW.rows[1], PREVIEW.rows[2]],
      false,
      new Map([[2, { industryId: 'ind-sal', subindustryId: 'sub-x' }]]),
    );
    assert.equal(candidates[0].industry, 'Tecnología'); // «tech» → como en la clasificación
    assert.equal('industry_id' in candidates[0], false);
    assert.equal((candidates[1] as Record<string, unknown>).industry_id, 'ind-sal');
    // Sin subindustrias habilitadas, la subindustria no viaja.
    assert.equal('subindustry_id' in candidates[1], false);
  });
});

describe('readCreateImportBatchResponse', () => {
  it('un 422 muestra el mensaje del servidor y no se da por importado', () => {
    const outcome = readCreateImportBatchResponse(false, {
      success: false,
      code: 'classification_review_required',
      message: '1 fila todavía requiere revisión de industria.',
    });
    assert.deepEqual(outcome, { ok: false, message: '1 fila todavía requiere revisión de industria.' });
  });

  it('un 200 sin batchId no es éxito («Se importaron undefined…»)', () => {
    assert.equal(readCreateImportBatchResponse(true, {}).ok, false);
    assert.equal(readCreateImportBatchResponse(true, null).ok, false);
  });

  it('un error con `error` en vez de `message` también se muestra', () => {
    const outcome = readCreateImportBatchResponse(false, { error: 'No autorizado' });
    assert.deepEqual(outcome, { ok: false, message: 'No autorizado' });
  });

  it('éxito con filas pendientes de revalidar', () => {
    const outcome = readCreateImportBatchResponse(true, {
      success: true,
      batchId: 'b-1',
      candidatesCreated: 3,
      pendingRevalidationCount: 2,
      stats: null,
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.candidatesCreated, 3);
      assert.equal(outcome.pendingRevalidationCount, 2);
    }
  });
});
