/**
 * Tests — Contact Normalizer (Agente 2A, Hito 17A.3A)
 *
 * Normaliza ApolloPerson → contacto de staging. Función pura.
 * Node.js built-in test runner. Sin I/O externo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeApolloPerson,
  normalizeApolloPeople,
  normalizeSeniority,
} from '../contact-normalizer';
import type { ApolloPerson } from '@/server/integrations/apollo-client';

function makePerson(overrides: Partial<ApolloPerson> = {}): ApolloPerson {
  return {
    id: 'apollo-1',
    first_name: 'Ana',
    last_name: 'López',
    title: 'Head of People',
    email: 'ana@corp.com',
    linkedin_url: 'https://linkedin.com/in/analopez',
    phone_numbers: [{ sanitized_number: '+57300000001', type: 'work' }],
    organization: { id: 'org-1', name: 'Corp', website_url: 'https://corp.com' },
    seniority: 'head',
    departments: ['human_resources'],
    country: 'Colombia',
    ...overrides,
  };
}

describe('normalizeApolloPerson', () => {
  it('normaliza una persona completa de Apollo', () => {
    const result = normalizeApolloPerson(makePerson());
    assert.ok(result);
    assert.equal(result?.fullName, 'Ana López');
    assert.equal(result?.email, 'ana@corp.com');
    assert.equal(result?.seniority, 'director'); // head → director
    assert.equal(result?.department, 'human resources');
    assert.equal(result?.source, 'apollo');
    assert.equal(result?.sourceContactId, 'apollo-1');
    assert.ok((result?.confidence ?? 0) > 0.5);
  });

  it('devuelve null cuando no hay full_name utilizable', () => {
    const result = normalizeApolloPerson(
      makePerson({ first_name: null, last_name: null, headline: null }),
    );
    assert.equal(result, null);
  });

  it('usa headline como fallback de nombre si falta first/last', () => {
    const result = normalizeApolloPerson(
      makePerson({ first_name: null, last_name: null, headline: 'Recruiter en Corp' }),
    );
    assert.ok(result);
    assert.equal(result?.fullName, 'Recruiter en Corp');
  });

  it('descarta emails placeholder bloqueados de Apollo', () => {
    const result = normalizeApolloPerson(
      makePerson({ email: 'email_not_unlocked@domain.com' }),
    );
    assert.equal(result?.email, null);
  });

  it('normalizeApolloPeople cuenta los descartados sin full_name', () => {
    const people = [
      makePerson({ id: 'a' }),
      makePerson({ id: 'b', first_name: null, last_name: null, headline: null }),
      makePerson({ id: 'c' }),
    ];
    const { normalized, droppedNoName } = normalizeApolloPeople(people);
    assert.equal(normalized.length, 2);
    assert.equal(droppedNoName, 1);
  });
});

describe('normalizeSeniority', () => {
  it('mapea valores de Apollo al vocabulario interno', () => {
    assert.equal(normalizeSeniority('owner'), 'owner');
    assert.equal(normalizeSeniority('founder'), 'owner');
    assert.equal(normalizeSeniority('c_suite'), 'executive');
    assert.equal(normalizeSeniority('vp'), 'vp');
    assert.equal(normalizeSeniority('head'), 'director');
    assert.equal(normalizeSeniority('director'), 'director');
    assert.equal(normalizeSeniority('manager'), 'manager');
    assert.equal(normalizeSeniority('senior'), 'senior');
    assert.equal(normalizeSeniority('entry'), 'entry');
    assert.equal(normalizeSeniority('intern'), 'entry');
  });

  it('mapea valores desconocidos a employee y null a null', () => {
    assert.equal(normalizeSeniority('something_else'), 'employee');
    assert.equal(normalizeSeniority(null), null);
    assert.equal(normalizeSeniority(undefined), null);
  });
});
