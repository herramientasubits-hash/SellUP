/**
 * Tests — Contact Deduplicator (Agente 2A, Hito 17A.3A)
 *
 * Dedup determinístico contra snapshot existente + intra-run.
 * Node.js built-in test runner. Sin I/O externo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deduplicateContacts, type DeduplicationSnapshot } from '../contact-deduplicator';
import type { NormalizedApolloContact } from '../contact-normalizer';

function makeCandidate(
  overrides: Partial<NormalizedApolloContact> = {},
): NormalizedApolloContact {
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
    enrichmentMetadata: {},
    ...overrides,
  };
}

const emptySnapshot: DeduplicationSnapshot = {
  existingEmails: [],
  existingLinkedinUrls: [],
  existingContactNames: [],
};

describe('deduplicateContacts', () => {
  it('marca exact_duplicate por email exacto y lo omite de la inserción', () => {
    const candidates = [makeCandidate({ email: 'ana@corp.com', linkedinUrl: null })];
    const snapshot: DeduplicationSnapshot = {
      existingEmails: ['ANA@corp.com'], // distinto casing → debe normalizar
      existingLinkedinUrls: [],
      existingContactNames: [],
    };

    const result = deduplicateContacts(candidates, snapshot);

    assert.equal(result.exactDuplicateCount, 1);
    assert.equal(result.toInsert.length, 0);
    assert.equal(result.exactDuplicates[0].duplicateStatus, 'exact_duplicate');
  });

  it('marca exact_duplicate por LinkedIn exacto (normalizando trailing slash)', () => {
    const candidates = [
      makeCandidate({ email: null, linkedinUrl: 'https://linkedin.com/in/juan' }),
    ];
    const snapshot: DeduplicationSnapshot = {
      existingEmails: [],
      existingLinkedinUrls: ['https://linkedin.com/in/juan/'],
      existingContactNames: [],
    };

    const result = deduplicateContacts(candidates, snapshot);

    assert.equal(result.exactDuplicateCount, 1);
    assert.equal(result.toInsert.length, 0);
  });

  it('marca possible_duplicate por nombre igual (sin email/linkedin coincidente)', () => {
    const candidates = [
      makeCandidate({ fullName: 'Ana Lopez', email: 'otro@corp.com', linkedinUrl: null }),
    ];
    const snapshot: DeduplicationSnapshot = {
      existingEmails: [],
      existingLinkedinUrls: [],
      existingContactNames: ['Ana López'], // acento distinto → debe coincidir
    };

    const result = deduplicateContacts(candidates, snapshot);

    assert.equal(result.possibleDuplicateCount, 1);
    assert.equal(result.toInsert.length, 1);
    assert.equal(result.toInsert[0].duplicateStatus, 'possible_duplicate');
  });

  it('marca no_match cuando no hay coincidencias', () => {
    const candidates = [
      makeCandidate({ fullName: 'Nuevo Perfil', email: 'nuevo@corp.com', linkedinUrl: null }),
    ];
    const result = deduplicateContacts(candidates, emptySnapshot);

    assert.equal(result.noMatchCount, 1);
    assert.equal(result.toInsert.length, 1);
    assert.equal(result.toInsert[0].duplicateStatus, 'no_match');
  });

  it('omite exact_duplicate pero inserta no_match y possible_duplicate', () => {
    const candidates = [
      makeCandidate({ fullName: 'Dup Email', email: 'dup@corp.com', linkedinUrl: null }),
      makeCandidate({ fullName: 'Posible', email: 'posible@corp.com', linkedinUrl: null }),
      makeCandidate({ fullName: 'Nuevo', email: 'nuevo@corp.com', linkedinUrl: null }),
    ];
    const snapshot: DeduplicationSnapshot = {
      existingEmails: ['dup@corp.com'],
      existingLinkedinUrls: [],
      existingContactNames: ['Posible'],
    };

    const result = deduplicateContacts(candidates, snapshot);

    assert.equal(result.exactDuplicateCount, 1);
    assert.equal(result.possibleDuplicateCount, 1);
    assert.equal(result.noMatchCount, 1);
    assert.equal(result.toInsert.length, 2);
    assert.ok(!result.toInsert.some((c) => c.duplicateStatus === 'exact_duplicate'));
  });

  it('deduplica dentro del mismo run por email (segundo candidato = exact_duplicate)', () => {
    const candidates = [
      makeCandidate({ fullName: 'Primero', email: 'same@corp.com', linkedinUrl: null }),
      makeCandidate({ fullName: 'Segundo', email: 'same@corp.com', linkedinUrl: null }),
    ];
    const result = deduplicateContacts(candidates, emptySnapshot);

    assert.equal(result.toInsert.length, 1);
    assert.equal(result.exactDuplicateCount, 1);
  });
});
