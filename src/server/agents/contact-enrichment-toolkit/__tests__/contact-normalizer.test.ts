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
  normalizeApolloJobTitle,
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

// ── Hito 17A.9I — normalizeApolloJobTitle ───────────────────────

describe('normalizeApolloJobTitle', () => {
  it('título sin separador queda igual (unchanged)', () => {
    const r = normalizeApolloJobTitle('Human Resources Manager');
    assert.equal(r.normalizedTitle, 'Human Resources Manager');
    assert.equal(r.changed, false);
    assert.equal(r.strategy, 'unchanged');
    assert.equal(r.rawTitle, 'Human Resources Manager');
  });

  it('título con pipe extrae el primer segmento', () => {
    const r = normalizeApolloJobTitle(
      'Key Account Manager (KAM) | Estrategia Comercial B2B | Gestión Humana & Desarrollo Corporativo',
    );
    assert.equal(r.normalizedTitle, 'Key Account Manager (KAM)');
    assert.equal(r.changed, true);
    assert.equal(r.strategy, 'split_by_separator');
    assert.equal(r.separator, ' | ');
    assert.ok(r.rawTitle!.includes('Estrategia Comercial'));
  });

  it('título con bullet (•) extrae el primer segmento', () => {
    const r = normalizeApolloJobTitle('HR Manager • People Operations');
    assert.equal(r.normalizedTitle, 'HR Manager');
    assert.equal(r.changed, true);
    assert.equal(r.strategy, 'split_by_separator');
  });

  it('título con guion separado (" - ") extrae el primer segmento', () => {
    const r = normalizeApolloJobTitle('HR Manager - People Operations');
    assert.equal(r.normalizedTitle, 'HR Manager');
    assert.equal(r.changed, true);
    assert.equal(r.strategy, 'split_by_separator');
    assert.equal(r.separator, ' - ');
  });

  it('guion interno (Co-Founder) no se rompe', () => {
    const r = normalizeApolloJobTitle('Co-Founder');
    assert.equal(r.normalizedTitle, 'Co-Founder');
    assert.equal(r.changed, false);
    assert.equal(r.strategy, 'unchanged');
  });

  it('title null devuelve strategy empty y normalizedTitle null', () => {
    const r = normalizeApolloJobTitle(null);
    assert.equal(r.normalizedTitle, null);
    assert.equal(r.changed, false);
    assert.equal(r.strategy, 'empty');
    assert.equal(r.rawTitle, null);
  });

  it('title vacío devuelve strategy empty', () => {
    const r = normalizeApolloJobTitle('   ');
    assert.equal(r.normalizedTitle, null);
    assert.equal(r.strategy, 'empty');
  });

  it('fallback si el primer segmento es muy corto', () => {
    // Separador encontrado pero primer segmento < MIN_SEGMENT_LENGTH
    const r = normalizeApolloJobTitle('HR | Manager completo');
    // "HR" tiene 2 chars < 3 → fallback
    assert.equal(r.strategy, 'fallback_original');
    assert.equal(r.normalizedTitle, 'HR | Manager completo');
    assert.equal(r.changed, false);
  });

  it('preserva el raw_title completo incluso cuando changed=true', () => {
    const raw = 'CEO · Startup · Innovación';
    const r = normalizeApolloJobTitle(raw);
    assert.equal(r.rawTitle, raw);
    assert.equal(r.normalizedTitle, 'CEO');
  });
});

// ── Hito 17A.9I — normalizeApolloPerson guarda apollo_title_normalization ──

describe('normalizeApolloPerson — apollo_title_normalization en enrichmentMetadata', () => {
  it('guarda apollo_title_normalization cuando el título tiene separador', () => {
    const result = normalizeApolloPerson(
      makePerson({ title: 'Key Account Manager (KAM) | Estrategia B2B' }),
    );
    assert.ok(result);
    assert.equal(result!.title, 'Key Account Manager (KAM)');
    const norm = result!.enrichmentMetadata.apollo_title_normalization as Record<string, unknown>;
    assert.ok(norm);
    assert.equal(norm.changed, true);
    assert.equal(norm.strategy, 'split_by_separator');
    assert.ok((norm.raw_title as string).includes('Estrategia B2B'));
    assert.equal(norm.normalized_title, 'Key Account Manager (KAM)');
  });

  it('guarda apollo_title_normalization con changed=false cuando el título está limpio', () => {
    const result = normalizeApolloPerson(makePerson({ title: 'Head of People' }));
    assert.ok(result);
    assert.equal(result!.title, 'Head of People');
    const norm = result!.enrichmentMetadata.apollo_title_normalization as Record<string, unknown>;
    assert.equal(norm.changed, false);
    assert.equal(norm.strategy, 'unchanged');
  });

  it('guarda apollo_title_normalization con strategy=empty cuando title es null', () => {
    const result = normalizeApolloPerson(makePerson({ title: undefined }));
    assert.ok(result);
    assert.equal(result!.title, null);
    const norm = result!.enrichmentMetadata.apollo_title_normalization as Record<string, unknown>;
    assert.equal(norm.strategy, 'empty');
    assert.equal(norm.normalized_title, null);
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
