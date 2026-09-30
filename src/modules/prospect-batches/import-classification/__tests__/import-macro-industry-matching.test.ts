/**
 * Tests — AGENT1-IMPORT-MACRO-INDUSTRY-MATCH-1.
 *
 * El defecto real (30-09, primera importación de la dueña): un CSV con
 * «Logística y Transporte» + subindustria «Courier y Mensajería Empresarial»
 * dejó 4 de 4 filas en «Requiere revisión». El catálogo v2 de Producción tiene
 * 12 macro industrias y CERO subindustrias; la industria se llama
 * «Transporte & Logística».
 *
 * El catálogo de abajo es el de Producción tal cual (v2.0.0, 12 industrias).
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyImportRows } from '../../import-classification-service';
import type { ImportRow } from '../../import-candidates-parser';
import type { ImportClassificationCatalog } from '../import-classification-types';

const V2_NAMES = [
  'Transporte & Logística',
  'Tecnología',
  'Seguros y Servicios Financieros',
  'Salud & Farmacéuticos',
  'Retail',
  'Propiedad & Construcción',
  'Industria / Manufactura / Químicos / Automotor',
  'Gobierno',
  'Gas / Petróleo / Energía / Minería / Medio Ambiente',
  'Consumo Masivo',
  'Compañía de Servicios',
  'Agroindustria',
];

const CATALOG: ImportClassificationCatalog = {
  version: 'v2.0.0',
  industries: V2_NAMES.map((name, i) => ({
    id: `c10000${String(i + 1).padStart(2, '0')}-0000-4000-8000-000000000000`,
    name,
    slug: `slug-${i + 1}`,
    active: true,
  })),
  subindustries: [],
  aliases: [],
};

function row(index: number, industry: string | undefined, subindustry?: string): ImportRow {
  return {
    index,
    raw: {
      company_name: `Empresa ${index}`,
      country: 'Colombia',
      country_code: 'CO',
      industry,
      subindustry,
    },
    status: 'valid',
    errors: [],
    warnings: [],
    resolved_country_code: 'CO',
    country_from_default: false,
    industry_from_default: false,
    industryOriginalValue: industry ?? null,
    subindustryOriginalValue: subindustry ?? null,
  } as ImportRow;
}

function classifyOne(industry: string | undefined, subindustry?: string) {
  const result = classifyImportRows({ rows: [row(0, industry, subindustry)], catalog: CATALOG, catalogVersionId: 'v2' });
  return { result, r: result.rows[0] };
}

describe('el CSV real de la dueña (30-09) ya no queda bloqueado', () => {
  const FILE: Array<[string, string]> = [
    ['Logística y Transporte', 'Courier y Mensajería Empresarial'],
    ['Logística y Transporte', 'Operadores Logísticos 3PL y 4PL'],
    ['Logística y Transporte', 'Courier y Mensajería Empresarial'],
    ['Logística y Transporte', 'Operadores Logísticos 3PL y 4PL'],
  ];

  it('4 de 4 filas se pueden importar, en «Transporte & Logística»', () => {
    const result = classifyImportRows({
      rows: FILE.map(([ind, sub], i) => row(i, ind, sub)),
      catalog: CATALOG,
      catalogVersionId: 'v2',
    });
    assert.equal(result.valid, true, JSON.stringify(result.blockingIssues));
    for (const r of result.rows) {
      assert.equal(r.classification.industryName, 'Transporte & Logística');
      assert.equal(r.classification.requiresHumanReview, false);
    }
  });

  it('la subindustria del archivo se IGNORA: sin aviso, sin bloqueo, texto original conservado', () => {
    const { r } = classifyOne('Logística y Transporte', 'Courier y Mensajería Empresarial');
    assert.equal(r.classification.subindustryId, null);
    assert.equal(r.classification.subindustryOriginalValue, 'Courier y Mensajería Empresarial');
    assert.equal(
      r.classification.classificationWarnings.some((w) => w.field === 'subindustry'),
      false,
      'SellUp ya no maneja subindustrias: no se muestra ningún aviso por ellas',
    );
    assert.equal(r.validationStatus === 'requires_review', false);
  });
});

describe('sin subindustrias en el catálogo, NINGÚN aviso de subindustria (2ª prueba real, 30-09)', () => {
  it('fila sin columna de subindustria → cero avisos de subindustria', () => {
    const { r } = classifyOne('Logística y Transporte');
    assert.equal(
      r.classification.classificationWarnings.some((w) => w.field === 'subindustry'),
      false,
      'antes salía «El valor de subindustria está vacío o no fue proporcionado»',
    );
  });
});

describe('mismas palabras en otro orden o una sola palabra → UNA industria', () => {
  const CASES: Array<[string, string]> = [
    ['Logística y Transporte', 'Transporte & Logística'],
    ['logistica', 'Transporte & Logística'],
    ['Transporte', 'Transporte & Logística'],
    ['Manufactura', 'Industria / Manufactura / Químicos / Automotor'],
    ['Químicos', 'Industria / Manufactura / Químicos / Automotor'],
    ['Químico', 'Industria / Manufactura / Químicos / Automotor'],
    ['Energía', 'Gas / Petróleo / Energía / Minería / Medio Ambiente'],
    ['Minería y Energía', 'Gas / Petróleo / Energía / Minería / Medio Ambiente'],
    ['Salud', 'Salud & Farmacéuticos'],
    ['Construcción', 'Propiedad & Construcción'],
    ['Servicios Financieros', 'Seguros y Servicios Financieros'],
    ['Seguros', 'Seguros y Servicios Financieros'],
    ['TECNOLOGÍA', 'Tecnología'],
  ];
  for (const [input, expected] of CASES) {
    it(`«${input}» → «${expected}»`, () => {
      const { r } = classifyOne(input);
      assert.equal(r.classification.industryName, expected);
      assert.equal(r.classification.requiresHumanReview, false);
    });
  }
});

describe('lo que NO se adivina', () => {
  it('«Servicios» cabe en dos industrias → ambiguo, a revisión', () => {
    const { r } = classifyOne('Servicios');
    assert.equal(r.classification.industryMatchStatus, 'ambiguous');
    assert.equal(r.classification.requiresHumanReview, true);
  });

  it('una palabra que no está en ninguna → no encontrada, a revisión', () => {
    const { r } = classifyOne('Aeroespacial');
    assert.equal(r.classification.industryMatchStatus, 'not_found');
    assert.equal(r.classification.requiresHumanReview, true);
  });

  it('palabras de dos industrias distintas → no encontrada (no se mezclan)', () => {
    const { r } = classifyOne('Retail y Tecnología');
    assert.equal(r.classification.industryId, null);
    assert.equal(r.classification.requiresHumanReview, true);
  });

  it('sólo conectores («y de la») → no encontrada', () => {
    assert.equal(classifyOne('y de la').r.classification.industryId, null);
  });
});

describe('un catálogo CON subindustrias sigue validándolas igual que antes', () => {
  it('subindustria inexistente en un catálogo que sí las tiene → sigue a revisión', () => {
    const withSubs: ImportClassificationCatalog = {
      ...CATALOG,
      subindustries: [
        { id: 'sub-1', name: 'Courier', slug: 'courier', industryId: CATALOG.industries[0].id, applicableCountries: null, active: true },
      ] as ImportClassificationCatalog['subindustries'],
    };
    const result = classifyImportRows({
      rows: [row(0, 'Transporte & Logística', 'Algo que no existe')],
      catalog: withSubs,
      catalogVersionId: 'v2',
    });
    assert.equal(result.rows[0].classification.requiresHumanReview, true);
  });
});
