/**
 * Tests — Pending Candidate Cross-Run Duplicate Check (Agente 2A, Hito 17B.4X.7C.3H.3)
 *
 * Verifica la función pura findMatchingPendingCandidate contra las 4 señales
 * de match (email, linkedin_url, source_contact_id, full_name+title) y sus
 * casos negativos. Sin red, sin DB — readPendingCandidatesForSameAccount
 * (que sí toca Supabase) se ejercita indirectamente vía los tests de
 * contact-candidate-writer.test.ts con loadExistingPendingCandidates inyectado.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findMatchingPendingCandidate,
  type CandidateForPendingCheck,
  type PendingCandidateRecord,
} from '../pending-candidate-cross-run-check';

function candidate(overrides: Partial<CandidateForPendingCheck> = {}): CandidateForPendingCheck {
  return {
    email: null,
    linkedinUrl: null,
    sourceContactId: null,
    source: 'apollo',
    fullName: 'Camila Fino Morales',
    title: 'CHRO',
    ...overrides,
  };
}

function pending(overrides: Partial<PendingCandidateRecord> = {}): PendingCandidateRecord {
  return {
    id: 'pending-1',
    email: null,
    linkedinUrl: null,
    sourceContactId: null,
    source: 'apollo',
    fullName: 'Camila Fino Morales',
    title: 'CHRO',
    ...overrides,
  };
}

describe('findMatchingPendingCandidate', () => {
  it('A. email normalizado igual → match', () => {
    const match = findMatchingPendingCandidate(
      candidate({ email: 'Camila.Fino@Siesa.com' }),
      [pending({ email: 'camila.fino@siesa.com', fullName: 'Otra Persona' })],
    );
    assert.ok(match);
    assert.equal(match?.matchedBy, 'email');
    assert.equal(match?.candidateId, 'pending-1');
  });

  it('B. linkedin_url normalizado igual (con/sin slash final) → match', () => {
    const match = findMatchingPendingCandidate(
      candidate({ linkedinUrl: 'https://linkedin.com/in/camilafino/' }),
      [pending({ linkedinUrl: 'https://linkedin.com/in/camilafino', fullName: 'Otra Persona' })],
    );
    assert.ok(match);
    assert.equal(match?.matchedBy, 'linkedin_url');
  });

  it('C. source_contact_id igual + mismo source → match', () => {
    const match = findMatchingPendingCandidate(
      candidate({ sourceContactId: 'apollo-person-123', source: 'apollo', fullName: 'Otra Persona' }),
      [pending({ sourceContactId: 'apollo-person-123', source: 'apollo', fullName: 'Camila Fino Morales' })],
    );
    assert.ok(match);
    assert.equal(match?.matchedBy, 'source_contact_id');
  });

  it('C-neg. source_contact_id igual pero distinto source → NO match', () => {
    const match = findMatchingPendingCandidate(
      candidate({ sourceContactId: 'shared-id-1', source: 'lusha', fullName: 'Otra Persona' }),
      [pending({ sourceContactId: 'shared-id-1', source: 'apollo', fullName: 'Camila Fino Morales' })],
    );
    assert.equal(match, null);
  });

  it('D. full_name igual + title compatible (ambos CHRO) → match', () => {
    const match = findMatchingPendingCandidate(
      candidate({ fullName: 'Camila Fino Morales', title: 'CHRO' }),
      [pending({ fullName: 'Camila Fino Morales', title: 'CHRO' })],
    );
    assert.ok(match);
    assert.equal(match?.matchedBy, 'full_name_same_account');
  });

  it('D. full_name igual (con acentos/mayúsculas distintas) + un title vacío → match', () => {
    const match = findMatchingPendingCandidate(
      candidate({ fullName: 'CAMILA FIÑO MORALES', title: null }),
      [pending({ fullName: 'camila fino morales', title: 'CHRO' })],
    );
    assert.ok(match);
    assert.equal(match?.matchedBy, 'full_name_same_account');
  });

  it('D-neg. full_name igual pero titles distintos y ambos presentes → NO match (evita falso positivo entre homónimos)', () => {
    const match = findMatchingPendingCandidate(
      candidate({ fullName: 'Camila Fino Morales', title: 'Sales Rep' }),
      [pending({ fullName: 'Camila Fino Morales', title: 'CHRO' })],
    );
    assert.equal(match, null);
  });

  it('G. candidato genuinamente nuevo → sin match', () => {
    const match = findMatchingPendingCandidate(
      candidate({ email: 'nueva.persona@corp.com', fullName: 'Persona Nueva', title: 'HR Manager' }),
      [pending({ email: 'existente@corp.com', fullName: 'Otra Persona', title: 'CHRO' })],
    );
    assert.equal(match, null);
  });

  it('sin candidatos pendientes existentes → sin match', () => {
    const match = findMatchingPendingCandidate(candidate({ email: 'a@corp.com' }), []);
    assert.equal(match, null);
  });

  it('prioriza email sobre nombre cuando ambos podrían aplicar', () => {
    const match = findMatchingPendingCandidate(
      candidate({ email: 'shared@corp.com', fullName: 'Nombre Distinto' }),
      [pending({ email: 'shared@corp.com', fullName: 'Otro Nombre Totalmente Distinto' })],
    );
    assert.equal(match?.matchedBy, 'email');
  });
});
