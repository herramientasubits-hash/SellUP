/**
 * Tests — Apollo Person Identity Observation (Agente 2A, Hito 17B.4X.3)
 *
 * Funciones puras (sin red, sin Supabase, sin IA). Verifica el contrato de
 * observación OBSERVATION_FIRST: search→match, señales de request, y
 * ausencia explícita de identity_consistency / observation_note / email crudo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeApolloMatchRequestSignals,
  computeApolloPersonIdentityObservation,
} from '../apollo-person-identity-observation';
import type { NormalizedApolloContact } from '../contact-normalizer';
import type { MatchPersonParams } from '@/server/integrations/apollo-client';

function contact(overrides: Partial<NormalizedApolloContact> = {}): NormalizedApolloContact {
  return {
    firstName: 'Ana',
    lastName: 'Pérez',
    fullName: 'Ana Pérez',
    title: 'HR Manager',
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

describe('computeApolloPersonIdentityObservation — id_consistency', () => {
  it('TEST 1: mismos IDs → match', () => {
    const search = contact({ sourceContactId: 'abc' });
    const match = contact({ sourceContactId: 'abc' });
    const obs = computeApolloPersonIdentityObservation({
      searchContact: search,
      matchContact: match,
      matchParams: { id: 'abc' },
    });
    assert.equal(obs.id_consistency, 'match');
  });

  it('TEST 2: IDs distintos → mismatch, sin identity_consistency', () => {
    const search = contact({ sourceContactId: 'abc' });
    const match = contact({ sourceContactId: 'xyz' });
    const obs = computeApolloPersonIdentityObservation({
      searchContact: search,
      matchContact: match,
      matchParams: { id: 'abc' },
    });
    assert.equal(obs.id_consistency, 'mismatch');
    assert.equal('identity_consistency' in obs, false);
  });

  it('TEST 3: search ID null → not_available', () => {
    const search = contact({ sourceContactId: null });
    const match = contact({ sourceContactId: 'xyz' });
    const obs = computeApolloPersonIdentityObservation({
      searchContact: search,
      matchContact: match,
      matchParams: {},
    });
    assert.equal(obs.id_consistency, 'not_available');
  });
});

describe('computeApolloPersonIdentityObservation — name_consistency', () => {
  it('TEST 4: nombre normalizado equivalente → match', () => {
    const search = contact({ fullName: 'María Rodas' });
    const match = contact({ fullName: ' maria   rodas ' });
    const obs = computeApolloPersonIdentityObservation({
      searchContact: search,
      matchContact: match,
      matchParams: {},
    });
    assert.equal(obs.name_consistency, 'match');
  });

  it('TEST 5: nombre distinto (aunque similar) → mismatch, observacional', () => {
    const search = contact({ fullName: 'Maria Rodas' });
    const match = contact({ fullName: 'Maria Rosa Rodas' });
    const obs = computeApolloPersonIdentityObservation({
      searchContact: search,
      matchContact: match,
      matchParams: {},
    });
    assert.equal(obs.name_consistency, 'mismatch');
  });

  it('TEST 6: match sin nombre → not_available', () => {
    const search = contact({ fullName: 'Maria Rodas' });
    const match = contact({ fullName: '' as unknown as string });
    const obs = computeApolloPersonIdentityObservation({
      searchContact: search,
      matchContact: { ...match, fullName: null as unknown as string },
      matchParams: {},
    });
    assert.equal(obs.name_consistency, 'not_available');
  });
});

describe('computeApolloMatchRequestSignals', () => {
  it('TEST 7: id + linkedin + email + first_name + organization_name → todas true salvo company solo si aplica', () => {
    const params: MatchPersonParams = {
      id: 'abc',
      linkedin_url: 'https://linkedin.com/in/ana',
      email: 'ana@corp.com',
      first_name: 'Ana',
      organization_name: 'Acme',
    };
    const signals = computeApolloMatchRequestSignals(params);
    assert.deepEqual(signals, { id: true, linkedin: true, email: true, name: true, company: true });
  });

  it('TEST 8: solo first_name + domain → id/linkedin/email false, name/company true', () => {
    const params: MatchPersonParams = { first_name: 'Ana', domain: 'acme.com' };
    const signals = computeApolloMatchRequestSignals(params);
    assert.deepEqual(signals, { id: false, linkedin: false, email: false, name: true, company: true });
  });
});

describe('computeApolloPersonIdentityObservation — safety boundary', () => {
  it('TEST 9: el email crudo no aparece en ningún valor serializado', () => {
    const search = contact({ email: 'search-secret@corp.com', sourceContactId: 'abc' });
    const match = contact({ email: 'match-secret@corp.com', sourceContactId: 'abc' });
    const obs = computeApolloPersonIdentityObservation({
      searchContact: search,
      matchContact: match,
      matchParams: { email: 'match-secret@corp.com' },
    });
    const serialized = JSON.stringify(obs);
    assert.equal(serialized.includes('secret@corp.com'), false);
  });

  it('TEST 10: no expone identity_consistency, observation_note ni provider_used_signal', () => {
    const search = contact();
    const match = contact();
    const obs = computeApolloPersonIdentityObservation({
      searchContact: search,
      matchContact: match,
      matchParams: {},
    });
    assert.equal('identity_consistency' in obs, false);
    assert.equal('observation_note' in obs, false);
    assert.equal('provider_used_signal' in obs, false);
  });

  it('search_contact_id es nullable', () => {
    const search = contact({ sourceContactId: null });
    const obs = computeApolloPersonIdentityObservation({
      searchContact: search,
      matchContact: null,
      matchParams: {},
    });
    assert.equal(obs.search_contact_id, null);
  });
});
