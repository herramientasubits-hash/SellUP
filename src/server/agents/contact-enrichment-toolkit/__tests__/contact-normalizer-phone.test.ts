/**
 * Tests — Contact Normalizer phone metadata (Agente 2A, PHONE-3A)
 *
 * Verifica que normalizeApolloPerson conserva el tipo/fuente/raw_type del
 * teléfono que Apollo entrega en la búsqueda, SIN cambiar el comportamiento
 * del resto de campos (nombre, email, LinkedIn, título).
 *
 * Función pura. Sin red, sin DB. Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeApolloPerson } from '../contact-normalizer';
import type { ApolloPerson } from '@/server/integrations/apollo-client';
import type { ContactCandidatePhoneMetadata } from '@/modules/contact-enrichment/types';

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

function phoneMeta(result: NonNullable<ReturnType<typeof normalizeApolloPerson>>): ContactCandidatePhoneMetadata {
  return result.enrichmentMetadata.phone as ContactCandidatePhoneMetadata;
}

describe('normalizeApolloPerson — phone scalar preserved (PHONE-3A)', () => {
  it('conserva el teléfono escalar en el mismo campo con un único número', () => {
    const result = normalizeApolloPerson(
      makePerson({ phone_numbers: [{ sanitized_number: '+57300000001', type: 'work' }] }),
    );
    assert.ok(result);
    assert.equal(result?.phone, '+57300000001');
  });

  it('phone escalar sigue null cuando no hay teléfonos', () => {
    const result = normalizeApolloPerson(makePerson({ phone_numbers: [] }));
    assert.ok(result);
    assert.equal(result?.phone, null);
  });
});

describe('normalizeApolloPerson — phone metadata (PHONE-3A)', () => {
  it('escoge mobile por prioridad y guarda type/source/raw_type', () => {
    const result = normalizeApolloPerson(
      makePerson({
        phone_numbers: [
          { sanitized_number: '+571111111', type: 'work' },
          { sanitized_number: '+573001111111', type: 'mobile' },
        ],
      }),
    );
    assert.ok(result);
    // scalar = número priorizado (mobile)
    assert.equal(result?.phone, '+573001111111');
    const meta = phoneMeta(result!);
    assert.equal(meta.number, '+573001111111');
    assert.equal(meta.type, 'mobile');
    assert.equal(meta.source, 'apollo_search');
    assert.equal(meta.raw_type, 'mobile');
  });

  it('work_hq se normaliza a hq conservando raw_type', () => {
    const result = normalizeApolloPerson(
      makePerson({ phone_numbers: [{ sanitized_number: '+571', type: 'work_hq' }] }),
    );
    assert.ok(result);
    const meta = phoneMeta(result!);
    assert.equal(meta.type, 'hq');
    assert.equal(meta.raw_type, 'work_hq');
    assert.equal(meta.source, 'apollo_search');
  });

  it('tipo desconocido → unknown, raw_type conserva el valor original', () => {
    const result = normalizeApolloPerson(
      makePerson({ phone_numbers: [{ sanitized_number: '+571', type: 'satellite' }] }),
    );
    assert.ok(result);
    const meta = phoneMeta(result!);
    assert.equal(meta.type, 'unknown');
    assert.equal(meta.raw_type, 'satellite');
  });

  it('NO agrega metadata phone cuando no hay teléfono utilizable', () => {
    const result = normalizeApolloPerson(makePerson({ phone_numbers: [] }));
    assert.ok(result);
    assert.equal(result?.enrichmentMetadata.phone, undefined);
  });

  it('NO agrega metadata phone cuando todos los números están vacíos', () => {
    const result = normalizeApolloPerson(
      makePerson({
        phone_numbers: [
          { sanitized_number: '', type: 'mobile' },
          { sanitized_number: '   ', type: 'work' },
        ],
      }),
    );
    assert.ok(result);
    assert.equal(result?.enrichmentMetadata.phone, undefined);
    assert.equal(result?.phone, null);
  });
});

describe('normalizeApolloPerson — otros campos intactos (PHONE-3A)', () => {
  it('no cambia name / email / linkedin / title al preservar el teléfono', () => {
    const result = normalizeApolloPerson(
      makePerson({
        phone_numbers: [{ sanitized_number: '+573001111111', type: 'mobile' }],
      }),
    );
    assert.ok(result);
    assert.equal(result?.fullName, 'Ana López');
    assert.equal(result?.firstName, 'Ana');
    assert.equal(result?.lastName, 'López');
    assert.equal(result?.email, 'ana@corp.com');
    assert.equal(result?.linkedinUrl, 'https://linkedin.com/in/analopez');
    assert.equal(result?.title, 'Head of People');
    assert.equal(result?.source, 'apollo');
  });

  it('confidence no depende del teléfono (con y sin phone da lo mismo)', () => {
    const withPhone = normalizeApolloPerson(
      makePerson({ phone_numbers: [{ sanitized_number: '+571', type: 'mobile' }] }),
    );
    const withoutPhone = normalizeApolloPerson(makePerson({ phone_numbers: [] }));
    assert.ok(withPhone);
    assert.ok(withoutPhone);
    assert.equal(withPhone?.confidence, withoutPhone?.confidence);
  });
});
