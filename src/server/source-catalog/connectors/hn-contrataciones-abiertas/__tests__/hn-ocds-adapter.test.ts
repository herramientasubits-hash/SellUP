import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { processRelease, buildCandidates } from '../hn-ocds-adapter';
import type { OcdsRelease } from '../hn-ocds-types';

function makeRelease(overrides: Partial<OcdsRelease> = {}): OcdsRelease {
  return {
    ocid: 'ocds-abc123-HN-2025-001',
    date: '2025-03-15T00:00:00Z',
    ...overrides,
  };
}

describe('processRelease — extracción de candidatos', () => {
  it('extrae supplier con HN-RTN válido', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'p1',
          name: 'Constructora Honduras SA',
          identifier: { scheme: 'HN-RTN', id: '08011977037644' },
          roles: ['supplier'],
        },
      ],
    });
    const stats = processRelease(release, acc);
    assert.equal(stats.validRtn, 1);
    assert.equal(acc.size, 1);
    const candidates = buildCandidates(acc);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].normalizedRtn, '08011977037644');
    assert.equal(candidates[0].supplierName, 'Constructora Honduras SA');
    assert.ok(candidates[0].roles.includes('supplier'));
  });

  it('extrae tenderer con HN-RTN válido', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'p2',
          name: 'Distribuidora Nacional',
          identifier: { scheme: 'HN-RTN', id: '08011977037644' },
          roles: ['tenderer'],
        },
      ],
    });
    processRelease(release, acc);
    const candidates = buildCandidates(acc);
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0].roles.includes('tenderer'));
    assert.equal(candidates[0].tendersCount, 1);
  });

  it('ignora buyer aunque tenga HN-RTN', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'b1',
          name: 'Ministerio de Salud',
          identifier: { scheme: 'HN-RTN', id: '08011977037644' },
          roles: ['buyer'],
        },
      ],
    });
    const stats = processRelease(release, acc);
    assert.equal(stats.supplierOrTendererSeen, 0);
    assert.equal(acc.size, 0);
  });

  it('ignora X-ONCAE-SUPPLIERS-HC1', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'legacy1',
          name: 'Proveedor legacy',
          identifier: { scheme: 'X-ONCAE-SUPPLIERS-HC1', id: 'HC1-99999' },
          roles: ['supplier'],
        },
      ],
    });
    const stats = processRelease(release, acc);
    assert.equal(stats.legacySchemeIgnored, 1);
    assert.equal(acc.size, 0);
  });

  it('ignora supplier sin RTN (scheme distinto)', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'p3',
          name: 'Proveedor sin RTN',
          identifier: { scheme: 'OTRO', id: '12345' },
          roles: ['supplier'],
        },
      ],
    });
    const stats = processRelease(release, acc);
    assert.equal(stats.hnRtnSeen, 0);
    assert.equal(acc.size, 0);
  });

  it('ignora supplier con RTN inválido (longitud)', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'p4',
          name: 'Proveedor RTN corto',
          identifier: { scheme: 'HN-RTN', id: '0801197703764' },
          roles: ['supplier'],
        },
      ],
    });
    const stats = processRelease(release, acc);
    assert.equal(stats.hnRtnSeen, 1);
    assert.equal(stats.invalidRtn, 1);
    assert.equal(acc.size, 0);
  });

  it('agrega OCIDs de múltiples releases para mismo RTN', () => {
    const acc = new Map();
    processRelease(
      makeRelease({
        ocid: 'ocds-hn-001',
        parties: [
          {
            id: 'p1',
            name: 'Empresa Hondureña SA',
            identifier: { scheme: 'HN-RTN', id: '08011977037644' },
            roles: ['supplier'],
          },
        ],
      }),
      acc,
    );
    processRelease(
      makeRelease({
        ocid: 'ocds-hn-002',
        parties: [
          {
            id: 'p1',
            name: 'Empresa Hondureña SA',
            identifier: { scheme: 'HN-RTN', id: '08011977037644' },
            roles: ['tenderer'],
          },
        ],
      }),
      acc,
    );
    const candidates = buildCandidates(acc);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].ocids.length, 2);
    assert.ok(candidates[0].roles.includes('supplier'));
    assert.ok(candidates[0].roles.includes('tenderer'));
  });

  it('marca likely_legal_entity cuando nombre contiene SA', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'p5',
          name: 'Inversiones del Norte SA',
          identifier: { scheme: 'HN-RTN', id: '08011977037644' },
          roles: ['supplier'],
        },
      ],
    });
    processRelease(release, acc);
    const candidates = buildCandidates(acc);
    assert.equal(candidates[0].legalEntityHint, 'likely_legal_entity');
    assert.ok(candidates[0].legalEntityReason !== null);
  });

  it('marca unknown_or_person_natural_risk cuando no hay indicador empresarial', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'p6',
          name: 'Juan Martinez',
          identifier: { scheme: 'HN-RTN', id: '08011977037644' },
          roles: ['supplier'],
        },
      ],
    });
    processRelease(release, acc);
    const candidates = buildCandidates(acc);
    assert.equal(candidates[0].legalEntityHint, 'unknown_or_person_natural_risk');
    assert.equal(candidates[0].legalEntityReason, null);
  });

  it('calcula awardsCount y totalAwardAmount desde awards del release', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'p7',
          name: 'Constructora del Valle SA',
          identifier: { scheme: 'HN-RTN', id: '08011977037644' },
          roles: ['supplier'],
        },
      ],
      awards: [
        { id: 'a1', status: 'active', value: { amount: 500000, currency: 'HNL' }, suppliers: [{ id: 'p7' }] },
      ],
    });
    processRelease(release, acc);
    const candidates = buildCandidates(acc);
    assert.equal(candidates[0].awardsCount, 1);
    assert.equal(candidates[0].totalAwardAmount, 500000);
  });

  it('no incluye datos de contacto personal ni teléfonos en candidato', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'p8',
          name: 'Empresa XYZ SA',
          identifier: { scheme: 'HN-RTN', id: '08011977037644' },
          roles: ['supplier'],
        },
      ],
    });
    processRelease(release, acc);
    const candidates = buildCandidates(acc);
    const keys = Object.keys(candidates[0]);
    assert.ok(!keys.includes('contactPoint'));
    assert.ok(!keys.includes('telephone'));
    assert.ok(!keys.includes('email'));
  });

  it('likely_legal_entity para nombre con DISTRIBUIDORA', () => {
    const acc = new Map();
    const release = makeRelease({
      parties: [
        {
          id: 'p9',
          name: 'DISTRIBUIDORA CENTRAL HN',
          identifier: { scheme: 'HN-RTN', id: '08011977037644' },
          roles: ['supplier'],
        },
      ],
    });
    processRelease(release, acc);
    const candidates = buildCandidates(acc);
    assert.equal(candidates[0].legalEntityHint, 'likely_legal_entity');
  });
});
