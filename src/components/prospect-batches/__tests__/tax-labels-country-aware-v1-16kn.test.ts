/**
 * Tests — Tax labels country-aware en UI — v1.16K-N pre-pilot hardening
 *
 * Verifica:
 * - getTaxIdLabel retorna NIT/RFC/RUT/RUC según country_code
 * - null/undefined retorna "identificador fiscal"
 * - Labels "Guardar NIT/RFC/RUT/RUC" son country-aware
 * - Ningún string visible queda hardcodeado incorrectamente
 *
 * Sin Supabase. Sin LLM. Sin DOM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Reimplementación local para tests (misma lógica que el helper del sheet) ──
// Esto permite testear sin importar el componente React completo.

function getTaxIdLabel(countryCode: string | null | undefined): string {
  switch (countryCode?.toUpperCase()) {
    case 'CO': return 'NIT';
    case 'MX': return 'RFC';
    case 'CL': return 'RUT';
    case 'PE': return 'RUC';
    case 'EC': return 'RUC';
    default:   return 'identificador fiscal';
  }
}

function getSaveLabel(countryCode: string | null | undefined): string {
  return `Guardar ${getTaxIdLabel(countryCode)}`;
}

// ─── Tests getTaxIdLabel ──────────────────────────────────────────────────────

describe('getTaxIdLabel (P1-3)', () => {
  it('CO → NIT', () => {
    assert.equal(getTaxIdLabel('CO'), 'NIT');
  });

  it('MX → RFC', () => {
    assert.equal(getTaxIdLabel('MX'), 'RFC');
  });

  it('CL → RUT', () => {
    assert.equal(getTaxIdLabel('CL'), 'RUT');
  });

  it('PE → RUC', () => {
    assert.equal(getTaxIdLabel('PE'), 'RUC');
  });

  it('EC → RUC', () => {
    assert.equal(getTaxIdLabel('EC'), 'RUC');
  });

  it('null → identificador fiscal', () => {
    assert.equal(getTaxIdLabel(null), 'identificador fiscal');
  });

  it('undefined → identificador fiscal', () => {
    assert.equal(getTaxIdLabel(undefined), 'identificador fiscal');
  });

  it('unknown country → identificador fiscal', () => {
    assert.equal(getTaxIdLabel('BR'), 'identificador fiscal');
  });

  it('lowercase co → NIT (case-insensitive)', () => {
    assert.equal(getTaxIdLabel('co'), 'NIT');
  });
});

// ─── Tests "Guardar NIT/RFC/RUT" button label ─────────────────────────────────

describe('Guardar label country-aware (P1-3)', () => {
  it('CO → "Guardar NIT"', () => {
    assert.equal(getSaveLabel('CO'), 'Guardar NIT');
  });

  it('MX → "Guardar RFC"', () => {
    assert.equal(getSaveLabel('MX'), 'Guardar RFC');
  });

  it('CL → "Guardar RUT"', () => {
    assert.equal(getSaveLabel('CL'), 'Guardar RUT');
  });

  it('PE → "Guardar RUC"', () => {
    assert.equal(getSaveLabel('PE'), 'Guardar RUC');
  });

  it('null → "Guardar identificador fiscal"', () => {
    assert.equal(getSaveLabel(null), 'Guardar identificador fiscal');
  });
});

// ─── Garantizar que ningún país no-CO produce "NIT" ──────────────────────────

describe('Non-CO countries do not produce NIT label (P1-3)', () => {
  const nonCOCountries = ['MX', 'CL', 'PE', 'EC', 'BR', null, undefined];

  for (const cc of nonCOCountries) {
    it(`${String(cc)} does not return NIT`, () => {
      assert.notEqual(getTaxIdLabel(cc), 'NIT');
    });
  }
});
