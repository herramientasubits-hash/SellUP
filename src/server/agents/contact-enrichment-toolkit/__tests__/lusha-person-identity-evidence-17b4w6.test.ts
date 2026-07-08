/**
 * Tests — Lusha Person Identity Evidence · 17B.4W.6
 *
 * Cubre la observación determinista de consistencia de identidad entre la
 * identidad de prospecting (usada para pedir el enrich) y la identidad devuelta
 * por el enrich. Sin red, sin Supabase, sin Lusha, sin IA.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLushaPersonIdentityEvidence,
  computeOverallIdentityConsistency,
  computePersonIdConsistency,
  computePersonNameConsistency,
  normalizePersonNameForIdentity,
} from '../lusha-person-identity-evidence';

describe('normalizePersonNameForIdentity', () => {
  it('null/vacío → null', () => {
    assert.equal(normalizePersonNameForIdentity(null), null);
    assert.equal(normalizePersonNameForIdentity('   '), null);
  });

  it('minúsculas + colapsa espacios + quita acentos', () => {
    assert.equal(
      normalizePersonNameForIdentity('  Cláudia   Barrera '),
      'claudia barrera',
    );
  });
});

describe('computePersonIdConsistency', () => {
  it('mismo id exacto → match', () => {
    assert.equal(computePersonIdConsistency('cid-1', 'cid-1'), 'match');
  });
  it('id distinto → mismatch', () => {
    assert.equal(computePersonIdConsistency('cid-1', 'cid-2'), 'mismatch');
  });
  it('falta alguno → not_available (sin fallback al nombre)', () => {
    assert.equal(computePersonIdConsistency('cid-1', null), 'not_available');
    assert.equal(computePersonIdConsistency(null, 'cid-2'), 'not_available');
  });
});

describe('17B.4W.6 identity consistency — casos requeridos', () => {
  // TEST 1
  it('mismo contactId + mismo nombre normalizado → consistent', () => {
    const ev = buildLushaPersonIdentityEvidence({
      prospectContactId: 'cid-abc',
      prospectFullName: 'Carolina Herrera',
      prospectLinkedinUrl: 'https://linkedin.com/in/carolina',
      enrichContactId: 'cid-abc',
      enrichFullName: 'Carolina Herrera',
      enrichLinkedinUrl: 'https://linkedin.com/in/carolina',
    });
    assert.equal(ev.id_consistency, 'match');
    assert.equal(ev.name_consistency, 'match');
    assert.equal(ev.identity_consistency, 'consistent');
  });

  // TEST 2
  it('provider contactId distinto → mismatch (aunque el nombre coincida)', () => {
    const ev = buildLushaPersonIdentityEvidence({
      prospectContactId: 'cid-abc',
      prospectFullName: 'Carolina Herrera',
      prospectLinkedinUrl: null,
      enrichContactId: 'cid-XYZ',
      enrichFullName: 'Carolina Herrera',
      enrichLinkedinUrl: null,
    });
    assert.equal(ev.id_consistency, 'mismatch');
    assert.equal(ev.identity_consistency, 'mismatch');
  });

  // TEST 3
  it('mismo id + nombres normalizados distintos → mismatch', () => {
    const ev = buildLushaPersonIdentityEvidence({
      prospectContactId: 'cid-abc',
      prospectFullName: 'Carolina Herrera',
      prospectLinkedinUrl: null,
      enrichContactId: 'cid-abc',
      enrichFullName: 'Claudia Barrera',
      enrichLinkedinUrl: null,
    });
    assert.equal(ev.name_consistency, 'mismatch');
    assert.equal(ev.identity_consistency, 'mismatch');
  });

  // TEST 4
  it('falta identidad de enrich → insufficient_evidence', () => {
    const ev = buildLushaPersonIdentityEvidence({
      prospectContactId: 'cid-abc',
      prospectFullName: 'Carolina Herrera',
      prospectLinkedinUrl: null,
      enrichContactId: null,
      enrichFullName: null,
      enrichLinkedinUrl: null,
    });
    assert.equal(ev.id_consistency, 'not_available');
    assert.equal(ev.name_consistency, 'not_available');
    assert.equal(ev.identity_consistency, 'insufficient_evidence');
  });

  // TEST 5
  it('diferencia solo de acento/mayúsculas en el nombre → name match', () => {
    assert.equal(
      computePersonNameConsistency('Cláudia Barrera', 'claudia barrera'),
      'match',
    );
    const ev = buildLushaPersonIdentityEvidence({
      prospectContactId: 'cid-abc',
      prospectFullName: 'Cláudia Barrera',
      prospectLinkedinUrl: null,
      enrichContactId: 'cid-abc',
      enrichFullName: 'claudia barrera',
      enrichLinkedinUrl: null,
    });
    assert.equal(ev.name_consistency, 'match');
    assert.equal(ev.identity_consistency, 'consistent');
  });

  it('id match pero nombre not_available → insufficient_evidence', () => {
    assert.equal(
      computeOverallIdentityConsistency('match', 'not_available'),
      'insufficient_evidence',
    );
  });
});

describe('17B.4W.6 runner wiring — evidencia por candidato (sin Lusha)', () => {
  // Espeja el mapeo exacto del runner company-first:
  //   prospect: candidate.contactId / candidate.name / candidate.linkedinUrl
  //   enrich:   contact.id / (firstName+lastName || fullName) / contact.linkedinUrl
  type ProspectCandidate = {
    contactId: string;
    name: string | null;
    linkedinUrl: string | null;
  };
  type EnrichResult = {
    id: string | null;
    firstName?: string | null;
    lastName?: string | null;
    fullName?: string | null;
    linkedinUrl?: string | null;
  };

  function evidenceForIteration(candidate: ProspectCandidate, contact: EnrichResult) {
    const enrichFullName =
      [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
      contact.fullName ||
      null;
    return buildLushaPersonIdentityEvidence({
      prospectContactId: candidate.contactId,
      prospectFullName: candidate.name ?? null,
      prospectLinkedinUrl: candidate.linkedinUrl ?? null,
      enrichContactId: contact.id ?? null,
      enrichFullName,
      enrichLinkedinUrl: contact.linkedinUrl ?? null,
    });
  }

  it('cada candidato conserva la evidencia de SU iteración (sin fuga)', () => {
    const iterations: Array<{ candidate: ProspectCandidate; contact: EnrichResult }> = [
      {
        candidate: { contactId: 'cid-A', name: 'Carolina Herrera', linkedinUrl: 'https://li/in/a' },
        contact: { id: 'cid-A', firstName: 'Carolina', lastName: 'Herrera', linkedinUrl: 'https://li/in/a' },
      },
      {
        candidate: { contactId: 'cid-B', name: 'Claudia Barrera', linkedinUrl: 'https://li/in/b' },
        contact: { id: 'cid-DIFF', firstName: 'Otra', lastName: 'Persona', linkedinUrl: 'https://li/in/x' },
      },
    ];

    const evidences = iterations.map(({ candidate, contact }) =>
      evidenceForIteration(candidate, contact),
    );

    // Iteración A: evidencia consistente, tomada de A.
    assert.equal(evidences[0]?.prospect_contact_id, 'cid-A');
    assert.equal(evidences[0]?.enrich_contact_id, 'cid-A');
    assert.equal(evidences[0]?.prospect_full_name, 'Carolina Herrera');
    assert.equal(evidences[0]?.enrich_full_name, 'Carolina Herrera');
    assert.equal(evidences[0]?.identity_consistency, 'consistent');

    // Iteración B: id distinto → mismatch; NO hereda datos de A.
    assert.equal(evidences[1]?.prospect_contact_id, 'cid-B');
    assert.equal(evidences[1]?.enrich_contact_id, 'cid-DIFF');
    assert.equal(evidences[1]?.prospect_full_name, 'Claudia Barrera');
    assert.equal(evidences[1]?.enrich_full_name, 'Otra Persona');
    assert.equal(evidences[1]?.identity_consistency, 'mismatch');
  });

  it('no persiste payload crudo del proveedor: solo campos tipados', () => {
    const ev = evidenceForIteration(
      { contactId: 'cid-A', name: 'Carolina Herrera', linkedinUrl: null },
      { id: 'cid-A', firstName: 'Carolina', lastName: 'Herrera' },
    );
    assert.deepEqual(Object.keys(ev).sort(), [
      'enrich_contact_id',
      'enrich_full_name',
      'enrich_linkedin_url',
      'id_consistency',
      'identity_consistency',
      'name_consistency',
      'prospect_contact_id',
      'prospect_full_name',
      'prospect_linkedin_url',
    ]);
  });
});
