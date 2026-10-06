/**
 * Tests — AGENT1-IMPORT-PARITY-2: identificador fiscal importado validado con
 * las reglas por país del alta manual. Avisa, no bloquea.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveImportTaxIdentifier } from '../import-tax-identifier';
import {
  calculateColombianCheckDigit,
  calculatePeruCheckDigit,
  TAX_IDENTIFIER_RULES,
} from '../tax-identifier-rules';
import { parseCsvCandidates } from '../import-candidates-parser';

const NIT = '900123456';
const DV = calculateColombianCheckDigit(NIT);
const WRONG_DV = (DV + 1) % 10;

describe('resolveImportTaxIdentifier', () => {
  it('NIT con DV correcto → válido, normalizado y con tipo NIT', () => {
    const r = resolveImportTaxIdentifier(`${NIT}-${DV}`, 'CO');
    assert.equal(r.status, 'valid');
    assert.equal(r.value, `${NIT}-${DV}`);
    assert.equal(r.type, 'NIT');
    assert.equal(r.warning, null);
  });

  it('NIT con puntos y prefijo «NIT:» se normaliza', () => {
    const r = resolveImportTaxIdentifier(`NIT: 900.123.456-${DV}`, 'co');
    assert.equal(r.status, 'valid');
    assert.equal(r.value, `${NIT}-${DV}`);
  });

  it('NIT de 9 dígitos sin DV → se calcula el DV (determinístico)', () => {
    const r = resolveImportTaxIdentifier(NIT, 'CO');
    assert.equal(r.status, 'valid_check_digit_computed');
    assert.equal(r.value, `${NIT}-${DV}`);
    assert.equal(r.type, 'NIT');
  });

  it('NIT con DV equivocado → inválido: conserva el valor original y avisa', () => {
    const r = resolveImportTaxIdentifier(`${NIT}-${WRONG_DV}`, 'CO');
    assert.equal(r.status, 'invalid');
    assert.equal(r.value, `${NIT}-${WRONG_DV}`);
    assert.equal(r.type, null);
    assert.match(r.warning ?? '', /NIT no válido/);
  });

  // AGENT1-IMPORT-PARITY-6 — el ejemplo que ve la vendedora en el formulario
  // tiene que pasar su PROPIA regla: antes CO, CL, PE y AR mostraban un ejemplo
  // que la validación rechazaba.
  const VALID_BY_COUNTRY: Record<string, string> = Object.fromEntries(
    Object.entries(TAX_IDENTIFIER_RULES).map(([cc, rule]) => [cc, rule.canonicalExample]),
  );
  for (const [cc, sample] of Object.entries(VALID_BY_COUNTRY)) {
    it(`${cc}: un identificador válido lleva su etiqueta (${TAX_IDENTIFIER_RULES[cc].label})`, () => {
      const r = resolveImportTaxIdentifier(sample, cc);
      assert.ok(r.status === 'valid', `${cc} ${sample} → ${r.status}`);
      assert.equal(r.type, TAX_IDENTIFIER_RULES[cc].label);
    });
  }

  it('el texto de ayuda («Ej. …») de cada país también es un identificador válido', () => {
    for (const [cc, rule] of Object.entries(TAX_IDENTIFIER_RULES)) {
      const example = rule.placeholder.replace(/^Ej\.\s*/, '');
      assert.ok(resolveImportTaxIdentifier(example, cc).status === 'valid', `${cc}: «${rule.placeholder}»`);
    }
  });

  it('Perú: RUC con dígito equivocado → inválido', () => {
    const body = '2012345678';
    const wrong = (Number(calculatePeruCheckDigit(body)) + 1) % 10;
    assert.equal(resolveImportTaxIdentifier(`${body}${wrong}`, 'PE').status, 'invalid');
  });

  // SOURCES-TAX-RULES-GT-HN-PA-1: Guatemala ya tiene regla; El Salvador sigue sin ella.
  it('país sin regla (p. ej. El Salvador) → se guarda tal cual, sin aviso ni tipo inventado', () => {
    const r = resolveImportTaxIdentifier(' 1234567-8 ', 'SV');
    assert.deepEqual(r, { status: 'unsupported_country', value: '1234567-8', type: null, warning: null });
  });

  it('sin país → avisa que no se pudo validar', () => {
    const r = resolveImportTaxIdentifier('123', null);
    assert.equal(r.status, 'missing_country');
    assert.ok(r.warning);
  });

  it('vacío → ausente', () => {
    assert.equal(resolveImportTaxIdentifier('  ', 'CO').status, 'absent');
  });
});

describe('parser — columnas fiscales por país y aviso en la vista previa', () => {
  for (const header of ['RUC', 'CUIT', 'CNPJ']) {
    it(`la columna «${header}» se reconoce como identificador fiscal`, () => {
      const csv = `Empresa,País,${header}\nUno SAS,Colombia,${NIT}-${DV}`;
      const parsed = parseCsvCandidates(csv);
      assert.equal(parsed.rows[0].raw.tax_identifier, `${NIT}-${DV}`);
    });
  }

  it('un NIT inválido deja la fila en warning, no en error', () => {
    const csv = `Empresa,País,NIT\nUno SAS,Colombia,${NIT}-${WRONG_DV}`;
    const parsed = parseCsvCandidates(csv);
    assert.equal(parsed.rows[0].status, 'warning');
    assert.ok(parsed.rows[0].warnings.some((w) => w.includes('NIT no válido')));
  });
});
