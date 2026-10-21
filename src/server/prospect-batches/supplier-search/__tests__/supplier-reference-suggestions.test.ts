/**
 * Tests — entidades públicas sugeridas para «Proveedores de una empresa»
 * (AGENT1-SUPPLIER-REFERENCE-SUGGEST-1, auditoría 21-10).
 *
 * Quien escribía «Seguro Social» no encontraba al «Instituto Mexicano del Seguro Social»:
 * el paso de compras públicas reconoce por nombre exacto. Ahora se sugieren entidades
 * cuyo nombre contiene lo escrito, con país y proveedores, y al elegir una el país queda
 * preseleccionado. Sin red, sin Producción.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createInitialProspectWizardState,
  prospectWizardReducer,
  type ProspectWizardAction,
  type ProspectWizardState,
} from '@/modules/prospect-batches/chat-wizard';
import {
  displayBuyerName,
  normalizeSuggestionQuery,
  suggestSupplierReferences,
  type LoadedBuyerMatch,
  type SupplierReferenceSuggestDeps,
} from '../reference-suggestions';
import { publicBuyerCountry } from '../countries';

function deps(loaded: LoadedBuyerMatch[], co: Array<{ legalName: string; normalizedLegalName: string }> = []) {
  const calls: string[] = [];
  const d: SupplierReferenceSuggestDeps = {
    searchLoadedBuyers: async (query) => (calls.push(`loaded:${query}`), loaded),
    searchCoEntities: async (query) => (calls.push(`co:${query}`), co),
  };
  return { d, calls };
}

const IMSS: LoadedBuyerMatch = {
  countryCode: 'MX',
  buyerName: 'INSTITUTO MEXICANO DEL SEGURO SOCIAL',
  buyerNameNormalized: 'INSTITUTO MEXICANO DEL SEGURO SOCIAL',
  supplierCount: 963,
};
const ESSALUD: LoadedBuyerMatch = {
  countryCode: 'PE',
  buyerName: 'SEGURO SOCIAL DE  SALUD',
  buyerNameNormalized: 'SEGURO SOCIAL DE SALUD',
  supplierCount: 421,
};
const CSS: LoadedBuyerMatch = {
  countryCode: 'PA',
  buyerName: 'Caja de Seguro Social',
  buyerNameNormalized: 'CAJA DE SEGURO SOCIAL',
  supplierCount: 211,
};

describe('1. qué se busca', () => {
  it('lo escrito se normaliza como el nombre cargado; menos de 3 letras no busca', async () => {
    assert.equal(normalizeSuggestionQuery('  seguro  sócial '), 'SEGURO SOCIAL');
    assert.equal(normalizeSuggestionQuery('ab'), null);
    const { d, calls } = deps([IMSS]);
    assert.deepEqual(await suggestSupplierReferences('se', d), []);
    assert.deepEqual(calls, []);
  });

  it('los espacios dobles del nombre cargado no se muestran', () => {
    assert.equal(displayBuyerName('SEGURO SOCIAL DE  SALUD '), 'SEGURO SOCIAL DE SALUD');
  });
});

describe('2. orden y forma', () => {
  it('primero las que empiezan por lo escrito; luego las de más proveedores; Colombia sin conteo al final', async () => {
    const { d } = deps(
      [IMSS, CSS, ESSALUD],
      [{ legalName: 'SEGURO SOCIAL DE PRUEBA E.S.E.', normalizedLegalName: 'SEGURO SOCIAL DE PRUEBA' }],
    );
    const result = await suggestSupplierReferences('Seguro Social', d);
    assert.deepEqual(
      result.map((r) => [r.countryCode, r.name, r.supplierCount]),
      [
        ['PE', 'SEGURO SOCIAL DE SALUD', 421],
        ['CO', 'SEGURO SOCIAL DE PRUEBA E.S.E.', null],
        ['MX', 'INSTITUTO MEXICANO DEL SEGURO SOCIAL', 963],
        ['PA', 'Caja de Seguro Social', 211],
      ],
    );
  });

  it('sin repetir país + nombre, y sólo países que «Proveedores» recorre', async () => {
    const { d } = deps([IMSS, { ...IMSS }, { ...IMSS, countryCode: 'BO' }]);
    const result = await suggestSupplierReferences('seguro social', d);
    assert.deepEqual(result.map((r) => r.countryCode), ['MX']);
  });

  it('a lo sumo 8', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...IMSS, buyerName: `HOSPITAL ${i}`, buyerNameNormalized: `HOSPITAL ${i}`, supplierCount: i }));
    const { d } = deps(many);
    assert.equal((await suggestSupplierReferences('hospital', d)).length, 8);
  });
});

describe('3. al elegir, el nombre coincide con lo que reconoce el paso de compras públicas', () => {
  it('nombres reales de Prod (21-10): el normalizador de cada país devuelve el nombre cargado', () => {
    const samples: Array<[string, string, string]> = [
      ['HN', 'Instituto Hondureño del Transporte Terrestre (IHTT)', 'INSTITUTO HONDURENO TRANSPORTE TERRESTRE'],
      ['CR', 'MUNICIPALIDAD DE GUaCIMO', 'MUNICIPALIDAD DE GUACIMO'],
      ['PE', 'SEGURO SOCIAL DE  SALUD', 'SEGURO SOCIAL DE SALUD'],
      ['ES', 'Comité de Dirección de Enwesa Operaciones, S.A., S.M.E.', 'COMITE DE DIRECCION DE ENWESA OPERACIONES S A S M E'],
      ['MX', 'SERVICIOS DE SALUD DEL INSTITUTO MEXICANO DEL SEGURO SOCIAL PARA EL BIENESTAR (IMSS-BIENESTAR)', 'SERVICIOS DE SALUD DEL INSTITUTO MEXICANO DEL SEGURO SOCIAL PARA EL BIENESTAR IMSS BIENESTAR'],
      ['PY', 'Gobierno Departamental de Canindeyú (CANINDEYÚ)', 'GOBIERNO DEPARTAMENTAL DE CANINDEYU CANINDEYU'],
    ];
    for (const [countryCode, raw, stored] of samples) {
      const country = publicBuyerCountry(countryCode);
      assert.ok(country && 'normalizeBuyerName' in country, countryCode);
      const normalize = (country as { normalizeBuyerName: (s: string) => string }).normalizeBuyerName;
      assert.equal(normalize(displayBuyerName(raw)), stored, countryCode);
    }
  });
});

describe('4. el asistente: el país de la entidad elegida queda preseleccionado', () => {
  const initial = (): ProspectWizardState =>
    createInitialProspectWizardState({ catalogVersion: '2.0.0', defaultRequestedCount: 10, supplierSearchEnabled: true });
  const run = (state: ProspectWizardState, actions: ProspectWizardAction[]) => actions.reduce(prospectWizardReducer, state);
  const toReference: ProspectWizardAction[] = [{ type: 'START' }, { type: 'SELECT_SEARCH_MODE', mode: 'suppliers' }];

  it('elige IMSS ⇒ nombre y México; la pregunta de país sigue (se puede cambiar)', () => {
    const state = run(initial(), [
      ...toReference,
      { type: 'SET_REFERENCE_COMPANY', value: 'INSTITUTO MEXICANO DEL SEGURO SOCIAL', suggestedCountryCode: 'MX' },
    ]);
    assert.equal(state.referenceCompanyName, 'INSTITUTO MEXICANO DEL SEGURO SOCIAL');
    assert.equal(state.countryCode, 'MX');
    assert.equal(state.currentStep, 'country');
  });

  it('un país que no existe no se toma', () => {
    const state = run(initial(), [...toReference, { type: 'SET_REFERENCE_COMPANY', value: 'Algo', suggestedCountryCode: 'ZZ' }]);
    assert.equal(state.countryCode, null);
  });

  it('desde el resumen, una entidad de OTRO país pasa por la pregunta de país antes de volver', () => {
    const summary = run(initial(), [
      ...toReference,
      { type: 'SET_REFERENCE_COMPANY', value: 'Ecopetrol' },
      { type: 'SELECT_COUNTRY', countryCode: 'CO' },
      { type: 'SELECT_INDUSTRY', industryId: '00000000-0000-4000-8000-000000000001' },
      { type: 'SKIP_ADDITIONAL_CRITERIA' },
    ]);
    assert.equal(summary.currentStep, 'summary');
    const editing = run(summary, [{ type: 'EDIT_STEP', step: 'reference_company', returnToSummary: true }]);
    const picked = run(editing, [
      { type: 'SET_REFERENCE_COMPANY', value: 'Caja de Seguro Social', suggestedCountryCode: 'PA' },
    ]);
    assert.equal(picked.countryCode, 'PA');
    assert.equal(picked.currentStep, 'country');
    const confirmed = run(picked, [{ type: 'SELECT_COUNTRY', countryCode: 'PA' }]);
    assert.equal(confirmed.currentStep, 'summary');
  });
});

describe('5. migración 154: sólo lectura y sólo service_role', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/154_suggest_public_procurement_buyers.sql'), 'utf8')
    .replace(/--.*$/gm, '');

  it('una función SECURITY INVOKER, STABLE, con EXECUTE sólo para service_role', () => {
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.suggest_public_procurement_buyers/);
    assert.match(sql, /SECURITY INVOKER/);
    assert.match(sql, /\bSTABLE\b/);
    assert.match(sql, /REVOKE ALL ON FUNCTION[^;]+FROM anon, authenticated/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION[^;]+TO service_role/);
  });

  it('no escribe nada ni crea tablas', () => {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE TABLE|ALTER TABLE|DROP)\b/i);
  });
});
