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
import type { PendingCandidateRecord } from '../pending-candidate-cross-run-check';

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

// ── Hito 17B.4X.7C.3H.3 — dedup cross-run contra pending_review ──────────

describe('writeContactCandidates — cross-run pending duplicate check', () => {
  function makePendingExisting(overrides: Partial<PendingCandidateRecord> = {}): PendingCandidateRecord {
    return {
      id: 'existing-pending-1',
      email: 'ana@corp.com',
      linkedinUrl: 'https://linkedin.com/in/analopez',
      sourceContactId: 'apollo-1',
      source: 'apollo',
      fullName: 'Ana López',
      title: 'HR Manager',
      ...overrides,
    };
  }

  it('A. email cross-run duplicado (misma cuenta) → no inserta, cuenta skippedExistingPending, no llama insertRows', async () => {
    let insertCalled = false;
    const result = await writeContactCandidates(
      'run-2',
      [makeDeduped({ email: 'ana@corp.com', linkedinUrl: null, sourceContactId: null })],
      {
        accountId: 'account-1',
        loadExistingPendingCandidates: async () => [makePendingExisting({ fullName: 'Ana Distinta' })],
        insertRows: async () => {
          insertCalled = true;
          return {};
        },
      },
    );
    assert.equal(result.inserted, 0);
    assert.equal(result.skippedExistingPending, 1);
    assert.equal(insertCalled, false);
  });

  it('B. linkedin_url cross-run duplicado (misma cuenta) → no inserta', async () => {
    const result = await writeContactCandidates(
      'run-2',
      [makeDeduped({ email: null, linkedinUrl: 'https://linkedin.com/in/analopez/', sourceContactId: null })],
      {
        accountId: 'account-1',
        loadExistingPendingCandidates: async () => [makePendingExisting({ email: null, fullName: 'Otro Nombre' })],
        insertRows: async () => ({}),
      },
    );
    assert.equal(result.inserted, 0);
    assert.equal(result.skippedExistingPending, 1);
  });

  it('C. source_contact_id cross-run duplicado (mismo proveedor) → no inserta', async () => {
    const result = await writeContactCandidates(
      'run-2',
      [makeDeduped({ email: null, linkedinUrl: null, sourceContactId: 'apollo-1', source: 'apollo' })],
      {
        accountId: 'account-1',
        loadExistingPendingCandidates: async () => [
          makePendingExisting({ email: null, linkedinUrl: null, fullName: 'Otro Nombre' }),
        ],
        insertRows: async () => ({}),
      },
    );
    assert.equal(result.inserted, 0);
    assert.equal(result.skippedExistingPending, 1);
  });

  it('D. full_name + cuenta (fallback) cross-run duplicado, title compatible → no inserta', async () => {
    const result = await writeContactCandidates(
      'run-2',
      [
        makeDeduped({
          email: null,
          linkedinUrl: null,
          sourceContactId: null,
          fullName: 'Ana López',
          title: 'HR Manager',
        }),
      ],
      {
        accountId: 'account-1',
        loadExistingPendingCandidates: async () => [
          makePendingExisting({ email: null, linkedinUrl: null, sourceContactId: null }),
        ],
        insertRows: async () => ({}),
      },
    );
    assert.equal(result.inserted, 0);
    assert.equal(result.skippedExistingPending, 1);
  });

  it('E. diferente cuenta (loadExistingPendingCandidates no retorna nada para esa cuenta) → SÍ inserta', async () => {
    let insertedRows: unknown[] = [];
    const result = await writeContactCandidates(
      'run-2',
      [makeDeduped({ email: 'ana@corp.com' })],
      {
        accountId: 'account-DIFERENTE',
        // El query real está scoped por account_id — para account-DIFERENTE no hay
        // pending candidates de account-1, así que retorna vacío.
        loadExistingPendingCandidates: async () => [],
        insertRows: async (rows) => {
          insertedRows = rows;
          return {};
        },
      },
    );
    assert.equal(result.inserted, 1);
    assert.equal(result.skippedExistingPending, 0);
    assert.equal(insertedRows.length, 1);
  });

  it('accountId ausente (empresa HubSpot-only / manual, V1) → NO consulta pending candidates, inserta normalmente', async () => {
    let loadCalled = false;
    const result = await writeContactCandidates('run-2', [makeDeduped({ email: 'ana@corp.com' })], {
      accountId: null,
      loadExistingPendingCandidates: async () => {
        loadCalled = true;
        return [makePendingExisting()];
      },
      insertRows: async () => ({}),
    });
    assert.equal(loadCalled, false, 'no debe consultar pending candidates sin accountId (alcance V1)');
    assert.equal(result.inserted, 1);
    assert.equal(result.skippedExistingPending, 0);
  });

  it('G. candidato genuinamente nuevo (misma cuenta, sin match) → sí inserta', async () => {
    const result = await writeContactCandidates(
      'run-2',
      [makeDeduped({ email: 'nueva@corp.com', linkedinUrl: null, sourceContactId: null, fullName: 'Persona Nueva' })],
      {
        accountId: 'account-1',
        loadExistingPendingCandidates: async () => [makePendingExisting()],
        insertRows: async () => ({}),
      },
    );
    assert.equal(result.inserted, 1);
    assert.equal(result.skippedExistingPending, 0);
  });

  it('mezcla: 1 duplicado cross-run + 1 nuevo → solo el nuevo se inserta', async () => {
    let insertedRows: Array<Record<string, unknown>> = [];
    const result = await writeContactCandidates(
      'run-2',
      [
        makeDeduped({ email: 'ana@corp.com', linkedinUrl: null, sourceContactId: null, fullName: 'Ana López' }),
        makeDeduped({
          email: 'nueva@corp.com',
          linkedinUrl: null,
          sourceContactId: null,
          fullName: 'Persona Nueva',
        }),
      ],
      {
        accountId: 'account-1',
        loadExistingPendingCandidates: async () => [makePendingExisting({ fullName: 'Ana Distinta' })],
        insertRows: async (rows) => {
          insertedRows = rows as unknown as Array<Record<string, unknown>>;
          return {};
        },
      },
    );
    assert.equal(result.inserted, 1);
    assert.equal(result.skippedExistingPending, 1);
    assert.equal(insertedRows.length, 1);
    assert.equal(insertedRows[0]?.email, 'nueva@corp.com');
  });
});
