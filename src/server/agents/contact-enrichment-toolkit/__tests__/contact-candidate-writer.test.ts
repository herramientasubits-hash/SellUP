/**
 * Tests — Contact Candidate Writer (Agente 2A, Hito 17A.3A)
 *
 * Verifica que se omiten candidatos sin full_name y que se mapean los campos.
 * Usa inyección de dependencias (sin DB).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { writeContactCandidates } from '../contact-candidate-writer';
import type { DeduplicatedContact } from '../contact-deduplicator';

function makeDeduped(overrides: Partial<DeduplicatedContact> = {}): DeduplicatedContact {
  return {
    firstName: 'Ana',
    lastName: 'López',
    fullName: 'Ana López',
    title: 'HR Manager',
    seniority: 'manager',
    department: 'human resources',
    country: 'Colombia',
    linkedinUrl: 'https://linkedin.com/in/analopez',
    email: 'ana@corp.com',
    phone: null,
    source: 'apollo',
    sourceContactId: 'apollo-1',
    confidence: 0.8,
    enrichmentMetadata: { provider: 'apollo' },
    duplicateStatus: 'no_match',
    ...overrides,
  };
}

describe('writeContactCandidates', () => {
  it('omite candidatos sin full_name y los contabiliza', async () => {
    let insertedRows: unknown[] = [];
    const candidates = [
      makeDeduped({ fullName: 'Ana López' }),
      makeDeduped({ fullName: '   ' }), // vacío → omitido
      makeDeduped({ fullName: 'Luis García' }),
    ];

    const result = await writeContactCandidates('run-1', candidates, {
      insertRows: async (rows) => {
        insertedRows = rows;
        return {};
      },
    });

    assert.equal(result.inserted, 2);
    assert.equal(result.skippedNoName, 1);
    assert.equal(insertedRows.length, 2);
  });

  it('mapea los campos esperados de la tabla', async () => {
    let row: Record<string, unknown> = {};
    await writeContactCandidates('run-xyz', [makeDeduped()], {
      insertRows: async (rows) => {
        row = rows[0] as unknown as Record<string, unknown>;
        return {};
      },
    });

    assert.equal(row.enrichment_run_id, 'run-xyz');
    assert.equal(row.full_name, 'Ana López');
    assert.equal(row.source, 'apollo');
    assert.equal(row.status, 'pending_review');
    assert.equal(row.duplicate_status, 'no_match');
    assert.equal(row.source_contact_id, 'apollo-1');
  });

  it('devuelve error controlado si la inserción falla', async () => {
    const result = await writeContactCandidates('run-1', [makeDeduped()], {
      insertRows: async () => ({ error: 'insert failed' }),
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.error, 'insert failed');
  });

  it('no inserta nada cuando no hay candidatos válidos', async () => {
    let called = false;
    const result = await writeContactCandidates('run-1', [makeDeduped({ fullName: '' })], {
      insertRows: async () => {
        called = true;
        return {};
      },
    });
    assert.equal(result.inserted, 0);
    assert.equal(called, false);
  });
});
