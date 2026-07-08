/**
 * Tests — Contact Completion Adapter × Apollo Person Identity Observation
 * (Agente 2A, Hito 17B.4X.3)
 *
 * Verifica que `completeContactWithApollo` adjunte la observación de
 * identidad search→match solo cuando people/match realmente se invoca, con
 * matchPerson inyectado (sin red, sin DB, sin Apollo real).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { completeContactWithApollo } from '../contact-completion-adapter';
import type { NormalizedApolloContact } from '../contact-normalizer';
import type { ApolloPerson, MatchPersonParams, ApolloEnrichResult } from '@/server/integrations/apollo-client';

function contact(overrides: Partial<NormalizedApolloContact> = {}): NormalizedApolloContact {
  return {
    firstName: 'Ana',
    lastName: 'Pérez',
    fullName: 'Ana Pérez',
    title: null,
    seniority: 'manager',
    department: 'human resources',
    country: 'Colombia',
    linkedinUrl: null,
    email: null,
    phone: null,
    source: 'apollo',
    sourceContactId: 'apollo-1',
    confidence: 0.6,
    enrichmentMetadata: {},
    ...overrides,
  };
}

describe('completeContactWithApollo — apolloPersonIdentityObservation', () => {
  it('TEST 11: match ejecutado con persona devuelta → observación con identidad de search y match', async () => {
    const candidate = contact({ sourceContactId: 'apollo-1', fullName: 'Ana Pérez' });
    const matchedPerson: ApolloPerson = {
      id: 'apollo-1',
      first_name: 'Ana',
      last_name: 'Pérez',
      title: 'HR Manager',
      email: 'ana@corp.com',
      linkedin_url: 'https://linkedin.com/in/ana',
      phone_numbers: [],
      organization: null,
    };
    const matchPerson = async (
      _params: MatchPersonParams,
    ): Promise<ApolloEnrichResult<ApolloPerson>> => ({ success: true, data: matchedPerson });

    const result = await completeContactWithApollo(
      { candidate, companyName: 'Acme' },
      { matchPerson },
    );

    assert.equal(result.status, 'completed');
    assert.ok(result.apolloPersonIdentityObservation);
    const obs = result.apolloPersonIdentityObservation!;
    assert.equal(obs.search_contact_id, 'apollo-1');
    assert.equal(obs.search_full_name, 'Ana Pérez');
    assert.equal(obs.match_contact_id, 'apollo-1');
    assert.equal(obs.match_full_name, 'Ana Pérez');
    assert.equal(obs.id_consistency, 'match');
    assert.equal(obs.name_consistency, 'match');
  });

  it('TEST 12: match ejecutado sin persona coincidente → observación con identidad de match nula', async () => {
    const candidate = contact({ sourceContactId: 'apollo-2', fullName: 'Carlos Ruiz' });
    const matchPerson = async (
      _params: MatchPersonParams,
    ): Promise<ApolloEnrichResult<ApolloPerson>> => ({ success: true, data: undefined });

    const result = await completeContactWithApollo(
      { candidate, companyName: 'Acme' },
      { matchPerson },
    );

    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'no_match_data');
    assert.ok(result.apolloPersonIdentityObservation);
    const obs = result.apolloPersonIdentityObservation!;
    assert.equal(obs.search_contact_id, 'apollo-2');
    assert.equal(obs.match_contact_id, null);
    assert.equal(obs.match_full_name, null);
    assert.equal(obs.id_consistency, 'not_available');
    assert.equal(obs.name_consistency, 'not_available');
    // Señales exactas del request realmente enviado (id fuerte disponible).
    assert.equal(obs.match_request_signals.id, true);
  });

  it('TEST 13: sin identidad mínima para match → no se invoca people/match ni se construye observación', async () => {
    const candidate = contact({
      sourceContactId: null,
      firstName: null,
      lastName: null,
      fullName: 'Solo',
      linkedinUrl: null,
      email: null,
      title: 'HR Manager',
    });
    let called = false;
    const matchPerson = async (
      _params: MatchPersonParams,
    ): Promise<ApolloEnrichResult<ApolloPerson>> => {
      called = true;
      return { success: true, data: undefined };
    };

    const result = await completeContactWithApollo({ candidate, companyName: 'Acme' }, { matchPerson });

    assert.equal(called, false);
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'insufficient_input_for_match');
    assert.equal(result.apolloPersonIdentityObservation, undefined);
  });

  it('TEST 14: comportamiento de merge existente no cambia (email/linkedin/phone se rellenan sin pisar datos)', async () => {
    const candidate = contact({
      sourceContactId: 'apollo-3',
      fullName: 'Solo',
      firstName: 'Solo',
      lastName: null,
      title: 'HR Manager',
      email: 'existing@corp.com',
      linkedinUrl: null,
    });
    const matchedPerson: ApolloPerson = {
      id: 'apollo-3',
      first_name: 'Solo',
      last_name: 'Nombre',
      title: 'HR Director',
      email: 'from-match@corp.com',
      linkedin_url: 'https://linkedin.com/in/solo',
      phone_numbers: [],
      organization: null,
    };
    const matchPerson = async (
      _params: MatchPersonParams,
    ): Promise<ApolloEnrichResult<ApolloPerson>> => ({ success: true, data: matchedPerson });

    const result = await completeContactWithApollo(
      { candidate, companyName: 'Acme' },
      { matchPerson },
    );

    assert.equal(result.status, 'completed');
    // Base ya tenía email → se conserva, no se pisa con el del match.
    assert.equal(result.contact.email, 'existing@corp.com');
    // linkedinUrl estaba vacío → se rellena desde el match.
    assert.equal(result.contact.linkedinUrl, 'https://linkedin.com/in/solo');
    // Nombre base era de un solo token → adopta el nombre completo del match (comportamiento existente).
    assert.deepEqual(result.completedFields.sort(), ['full_name', 'linkedin_url']);
  });
});
