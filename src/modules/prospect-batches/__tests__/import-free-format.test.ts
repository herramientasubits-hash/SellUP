/**
 * Tests — IMPORT-FREE-FORMAT-1: leer empresas que no vienen en el formato oficial.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseCompanyList, parseMatrixByContent } from '../import-free-format';
import { parseMatrixToRows, parsePastedCandidates } from '../import-candidates-parser';

const DEFAULTS = { country: 'Colombia', countryCode: 'CO' };

describe('formato oficial: no cambia', () => {
  it('una tabla con encabezados del contrato se lee como siempre', () => {
    const result = parsePastedCandidates('Empresa\tPaís\tSitio web\nAcme\tChile\tacme.cl', DEFAULTS);
    assert.equal(result.detection, 'contract');
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].raw.company_name, 'Acme');
    assert.equal(result.rows[0].raw.website, 'acme.cl');
  });

  it('una sola columna con el encabezado «Empresa» no importa «Empresa» como empresa', () => {
    const result = parsePastedCandidates('Empresa\nRappi\nPlatzi', DEFAULTS);
    assert.equal(result.detection, 'contract');
    assert.deepEqual(result.rows.map((r) => r.raw.company_name), ['Rappi', 'Platzi']);
  });

  it('la respuesta de Gemini con texto antes y después sigue siendo formato oficial', () => {
    const text = [
      'Claro, aquí tienes las empresas:',
      '',
      '| Empresa | País | Sitio web |',
      '|---|---|---|',
      '| Rappi | Colombia | rappi.com |',
      '| Platzi | Colombia | platzi.com |',
      '',
      '¿Quieres que busque más?',
    ].join('\n');
    const result = parsePastedCandidates(text, DEFAULTS);
    assert.equal(result.detection, 'contract');
    assert.deepEqual(result.rows.map((r) => r.raw.company_name), ['Rappi', 'Platzi']);
  });
});

describe('tablas con encabezados propios o sin encabezados', () => {
  it('reconoce cada columna por su contenido, sin encabezados', () => {
    const text = [
      'Bancolombia\tbancolombia.com\t890903938-8\tColombia',
      'Grupo Éxito\tgrupoexito.com.co\t890900608-9\tColombia',
      'Falabella\tfalabella.com\t\tChile',
    ].join('\n');
    const result = parsePastedCandidates(text, DEFAULTS);
    assert.equal(result.detection, 'columns_by_content');
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0].raw.company_name, 'Bancolombia');
    assert.equal(result.rows[0].raw.website, 'bancolombia.com');
    assert.equal(result.rows[0].raw.tax_identifier, '890903938-8');
    assert.equal(result.rows[2].raw.country, 'Chile');
    assert.equal(result.rows[2].raw.country_code, 'CL');
  });

  it('con encabezados que no son del contrato, salta la fila de encabezados', () => {
    const text = ['Cliente;Pág.;Doc.', 'Alpina;alpina.com;860025900-2', 'Postobón;postobon.com;890903939-5'].join('\n');
    const result = parsePastedCandidates(text, DEFAULTS);
    assert.equal(result.detection, 'columns_by_content');
    assert.deepEqual(result.rows.map((r) => r.raw.company_name), ['Alpina', 'Postobón']);
    assert.deepEqual(
      result.column_guesses.map((g) => [g.column, g.field]),
      [['Cliente', 'company_name'], ['Pág.', 'website'], ['Doc.', 'tax_identifier']],
    );
  });

  it('una hoja de Excel con columnas propias se lee por contenido', () => {
    const matrix = [
      ['Cuentas objetivo', 'Correo', 'Notas internas'],
      ['Siigo', 'ventas@siigo.com', 'Software contable con presencia en varios países de la región'],
      ['Alegra', 'hola@alegra.com', 'Facturación electrónica para pymes de América Latina y más'],
    ];
    const result = parseMatrixToRows(matrix, DEFAULTS);
    assert.equal(result.detection, 'columns_by_content');
    assert.equal(result.rows[0].raw.company_name, 'Siigo');
    assert.equal(result.rows[0].raw.contact_email, 'ventas@siigo.com');
    assert.match(result.rows[0].raw.description ?? '', /Software contable/);
  });

  it('sin columna de nombres no inventa empresas', () => {
    assert.equal(parseMatrixByContent([['acme.com', '900123456-7'], ['beta.com', '800123456-1']]), null);
  });
});

describe('listas: una empresa por línea', () => {
  it('quita viñetas y números y saca web, NIT y país de la misma línea', () => {
    const text = [
      'Empresas para prospectar:',
      '1. Bancolombia - bancolombia.com',
      '2. Grupo Nutresa (Colombia) NIT 890900050-1',
      '- Falabella, Chile',
      '• Mercado Libre https://www.mercadolibre.com',
    ].join('\n');
    const result = parsePastedCandidates(text, DEFAULTS);
    assert.equal(result.detection, 'company_list');
    const raw = result.rows.map((r) => r.raw);
    assert.deepEqual(raw.map((r) => r.company_name), ['Bancolombia', 'Grupo Nutresa', 'Falabella', 'Mercado Libre']);
    assert.equal(raw[0].website, 'bancolombia.com');
    assert.equal(raw[1].country, 'Colombia');
    assert.equal(raw[1].tax_identifier, '890900050-1');
    assert.equal(raw[2].country, 'Chile');
    assert.equal(raw[3].website, 'https://www.mercadolibre.com');
  });

  it('nombres sueltos: el país sale del país del lote', () => {
    const result = parsePastedCandidates('Rappi\nPlatzi\nHabi', DEFAULTS);
    assert.equal(result.detection, 'company_list');
    assert.equal(result.rows.length, 3);
    assert.ok(result.rows.every((r) => r.status !== 'error'));
    assert.ok(result.rows.every((r) => r.raw.country_code === 'CO' && r.country_from_default));
  });

  it('varias empresas en una sola línea separadas por comas', () => {
    const result = parseCompanyList('Rappi, Platzi, Habi, Addi');
    assert.deepEqual(result.rows.map((r) => r.company_name), ['Rappi', 'Platzi', 'Habi', 'Addi']);
  });

  it('no parte la razón social en la coma de «S.A.»', () => {
    const result = parseCompanyList('Cementos Argos, S.A.\nGrupo Aval, S.A.');
    assert.deepEqual(result.rows.map((r) => r.company_name), ['Cementos Argos, S.A.', 'Grupo Aval, S.A.']);
    assert.ok(result.rows.every((r) => !r.website));
  });

  it('no repite la misma empresa', () => {
    const result = parseCompanyList('Rappi\nrappi\nPlatzi');
    assert.deepEqual(result.rows.map((r) => r.company_name), ['Rappi', 'Platzi']);
  });
});

describe('texto corrido: lo lee la IA', () => {
  it('un párrafo se marca para leer con IA y no devuelve filas', () => {
    const text = [
      'Hola equipo, en la reunión de ayer con el cliente hablamos de varias empresas que podrían interesarnos.',
      'La primera es Bancolombia, que está renovando su programa de formación de líderes este año.',
      'También mencionaron a Grupo Éxito y a una startup de pagos llamada Addi que crece muy rápido.',
    ].join('\n');
    const result = parsePastedCandidates(text, DEFAULTS);
    assert.equal(result.detection, 'needs_ai');
    assert.equal(result.rows.length, 0);
  });
});
