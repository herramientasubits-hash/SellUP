/**
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 4, 5 — el índice macro→CIIU se
 * DERIVA del catálogo canónico; no es una segunda taxonomía.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import { assessDeclaredMacroIndustryEvidence } from '@/modules/macro-industry-catalog/macro-industry-evidence-core';
import {
  getCiiuSectorDescriptionExact,
  getCiiuSectorDescription,
} from '@/server/source-catalog/connectors/socrata-colombia/normalizers';
import {
  listMacroCiiuCoverage,
  macroHasCiiuCoverage,
  resolveMacroCiiuCodes,
} from '../macro-ciiu-index';
import {
  assessCountrySourceMacroPrecision,
  isCountrySourceMacroPrecisionAdmitted,
} from '../country-source-macro-precision';

test('§ 5 — cada código del índice lo CONFIRMA el evaluador canónico, sin excepción', () => {
  for (const definition of MACRO_INDUSTRIES) {
    for (const code of resolveMacroCiiuCodes(definition.key)) {
      const description = getCiiuSectorDescriptionExact(code);
      assert.ok(description, `${code} debe tener descripción exacta`);
      const assessment = assessDeclaredMacroIndustryEvidence(definition, {
        declaredIndustries: [description],
        classificationText: [description],
        providerEvidenceFields: ['ciiu_description'],
      });
      assert.equal(
        assessment.verdict,
        'confirmed',
        `${code} → ${definition.key} debe ser confirmed, fue ${assessment.verdict}`,
      );
    }
  }
});

test('§ 5 — ningún código pertenece a DOS macro industrias: la pregunta no puede ser ambigua', () => {
  const owners = new Map<string, string[]>();
  for (const definition of MACRO_INDUSTRIES) {
    for (const code of resolveMacroCiiuCodes(definition.key)) {
      owners.set(code, [...(owners.get(code) ?? []), definition.key]);
    }
  }
  const ambiguous = [...owners.entries()].filter(([, keys]) => keys.length > 1);
  assert.deepEqual(ambiguous, []);
});

test('la cobertura es ESTRECHA y se declara, en vez de rellenarse con conjeturas (§ 7)', () => {
  const coverage = listMacroCiiuCoverage();
  assert.equal(coverage.length, MACRO_INDUSTRIES.length);

  // La macro del incidente de producción SÍ tiene cobertura.
  assert.ok(macroHasCiiuCoverage('health_pharma'));
  assert.ok(resolveMacroCiiuCodes('health_pharma').includes('2100'));
  assert.ok(resolveMacroCiiuCodes('health_pharma').includes('8610'));

  // Y hay macros SIN cobertura. No se inventan: la fuente devuelve cero y el
  // proveedor de pago hace lo de siempre.
  assert.ok(coverage.some((c) => c.codeCount === 0), 'alguna macro sin cobertura');
});

test('🔴 mutación — usar el lookup por PREFIJO en vez del exacto rompería la precisión', () => {
  // `getCiiuSectorDescription` degrada a 3 y luego a 2 dígitos y devuelve la
  // PRIMERA entrada que empiece igual. Un código inexistente heredaría así la
  // descripción de un vecino. Esta prueba fija la diferencia para que nadie
  // sustituya una función por la otra sin que se note.
  assert.equal(getCiiuSectorDescriptionExact('2150'), null);
  assert.ok(getCiiuSectorDescription('2150'), 'el lookup laxo SÍ inventa un vecino');
  assert.notEqual(getCiiuSectorDescription('2150'), getCiiuSectorDescriptionExact('2150'));
});

test('el cero a la izquierda se resuelve: 111 y 0111 son el mismo código', () => {
  assert.equal(getCiiuSectorDescriptionExact('111'), getCiiuSectorDescriptionExact('0111'));
  assert.ok(getCiiuSectorDescriptionExact('111'));
});

test('§ 5 — sólo `confirmed` admite; ambiguo y rechazado NO', () => {
  const confirmed = assessCountrySourceMacroPrecision({
    macroIndustryKey: 'health_pharma',
    company: { declaredIndustry: 'Fabricación de productos farmacéuticos' },
  });
  assert.equal(confirmed.verdict, 'confirmed');
  assert.equal(isCountrySourceMacroPrecisionAdmitted(confirmed), true);

  const rejected = assessCountrySourceMacroPrecision({
    macroIndustryKey: 'health_pharma',
    company: { declaredIndustry: 'Construcción de edificios residenciales' },
  });
  assert.equal(rejected.verdict, 'rejected');
  assert.equal(isCountrySourceMacroPrecisionAdmitted(rejected), false);

  const absent = assessCountrySourceMacroPrecision({
    macroIndustryKey: 'health_pharma',
    company: { declaredIndustry: null },
  });
  assert.equal(absent.verdict, 'ambiguous');
  assert.equal(isCountrySourceMacroPrecisionAdmitted(absent), false);
});

test('🔴 mutación — el SECTOR GRUESO no puede confirmar: repetiría el defecto de #306', () => {
  // Cinco «Manufacturing genérico» con score 100 en una búsqueda de salud fue el
  // defecto exacto de la corrida del 2026-08-19. Seis cubetas
  // (COMERCIO/SERVICIOS/MANUFACTURA/…) no pueden demostrar doce macro industrias,
  // así que el sector grueso NUNCA viaja como evidencia.
  for (const coarse of ['MANUFACTURA', 'SERVICIOS', 'COMERCIO', 'CONSTRUCCIÓN']) {
    const precision = assessCountrySourceMacroPrecision({
      macroIndustryKey: 'industry_manufacturing_chemicals_automotive',
      company: { declaredIndustry: coarse },
    });
    assert.notEqual(
      precision.verdict,
      'confirmed',
      `el sector grueso ${coarse} no puede confirmar por sí solo`,
    );
  }
});

test('macro irresoluble ⇒ ambiguo, jamás confirmado (fail-closed)', () => {
  const precision = assessCountrySourceMacroPrecision({
    macroIndustryKey: 'no_existe',
    company: { declaredIndustry: 'Fabricación de productos farmacéuticos' },
  });
  assert.equal(precision.verdict, 'ambiguous');
  assert.equal(isCountrySourceMacroPrecisionAdmitted(precision), false);
});
