/**
 * SOURCES-DO-FREE-DISCOVERY-1 — descubrimiento gratuito de República Dominicana.
 *
 * Adapter + puerta previa al pago REAL con lecturas dobles. Cero E/S. Nombres y
 * RNC sintéticos; los textos de actividad son los que DGII guarda de verdad.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import {
  buildDoDgiiDiscoveryAdapter,
  DO_DGII_DISCOVERY_MAX_ROWS,
  DO_DGII_DISCOVERY_READ_FACTOR,
  DO_DGII_DISCOVERY_SOURCE_KEY,
  type DoDgiiActiveRow,
  type DoDgiiDiscoveryReads,
} from '../do-dgii-discovery-adapter';
import { DO_DGII_MACRO_TABLE_VERSION } from '../do-dgii-macro-table';
import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';
import {
  buildCountrySourceAdapter,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';
import { assessCountrySourceMacroPrecision } from '../country-source-macro-precision';

const TECH_TEXT = 'ACTIVIDADES DE INFORMÁTICA N.C';
const CONSTRUCTION_TEXT = 'CONSTRUCCIÓN DE ALMACENES';

function row(rnc: string, sector = TECH_TEXT, sizeTier: number | null = 2): DoDgiiActiveRow {
  return {
    record_identity_key: `rnc:${rnc}`,
    rnc,
    legal_name: `EMPRESA SINTETICA ${rnc} SRL`,
    normalized_legal_name: `EMPRESA SINTETICA ${rnc}`,
    sector,
    size_tier: sizeTier,
  };
}

/** Lectura doble: devuelve las filas tal cual (la fuente ya viene ordenada). */
function fakeReads(rows: DoDgiiActiveRow[]) {
  const calls: Array<{ macroIndustryKey: string; limit: number }> = [];
  const reads: DoDgiiDiscoveryReads = {
    async readSizedCompaniesByMacro(input) {
      calls.push(input);
      return rows.slice(0, input.limit);
    },
  };
  return { reads, calls };
}

function noMatch(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 0,
    input,
    matches: [],
    summary: 'no_match',
    checkedSources: ['sellup', 'hubspot'],
  };
}

describe('capacidad por país', () => {
  it('República Dominicana tiene fuente gratuita propia y Colombia conserva la suya', () => {
    assert.deepEqual(resolveCountrySourceCapability('do'), { countryCode: 'DO', sourceKey: 'do_dgii_discovery' });
    assert.deepEqual(resolveCountrySourceCapability('CO'), { countryCode: 'CO', sourceKey: 'co_siis_discovery' });
    assert.equal(resolveCountrySourceCapability('PE'), null);
  });

  it('la cobertura de cada país sale de SU clasificación', () => {
    assert.equal(countrySourceMacroHasCoverage('DO', 'technology'), true);
    assert.equal(countrySourceMacroHasCoverage('DO', 'no_existe'), false);
    assert.equal(countrySourceMacroHasCoverage('PE', 'technology'), false);
  });

  it('sin lecturas inyectadas no hay adapter (fail-open al pago)', () => {
    assert.equal(buildCountrySourceAdapter('DO', {}), null);
    assert.equal(buildCountrySourceAdapter('DO', { coSiisSnapshotQuery: async () => [] }), null);
    assert.ok(buildCountrySourceAdapter('DO', { doDgiiDiscoveryReads: fakeReads([]).reads }));
  });
});

describe('buildDoDgiiDiscoveryAdapter', () => {
  it('lee la fuente con tamaño de esa macro y respeta su orden', async () => {
    const { reads, calls } = fakeReads([row('100000003', TECH_TEXT, 1), row('100000002'), row('100000004', TECH_TEXT, 4)]);
    const result = await buildDoDgiiDiscoveryAdapter(reads)({
      countryCode: 'DO',
      macroIndustryKey: 'technology',
      limit: 10,
    });

    assert.equal(result.sourceKey, DO_DGII_DISCOVERY_SOURCE_KEY);
    assert.equal(result.recordsRead, 3);
    assert.deepEqual(result.companies.map((c) => c.taxId), ['100000003', '100000002', '100000004']);
    assert.deepEqual(calls, [{ macroIndustryKey: 'technology', limit: 10 * DO_DGII_DISCOVERY_READ_FACTOR }]);
  });

  it('cada empresa lleva RNC, industria oficial y la macro de la tabla aprobada', async () => {
    const { reads } = fakeReads([row('100000009')]);
    const [company] = (
      await buildDoDgiiDiscoveryAdapter(reads)({ countryCode: 'DO', macroIndustryKey: 'technology', limit: 5 })
    ).companies;

    assert.equal(company.countryCode, 'DO');
    assert.equal(company.taxId, '100000009');
    assert.equal(company.taxIdentifierType, 'RNC');
    assert.equal(company.domain, null);
    assert.match(company.industryCode ?? '', /^72\d{4}$/);
    assert.ok(company.declaredIndustry && company.declaredIndustry.length > 0);
    assert.deepEqual(company.officialMacroIndustry, {
      macroIndustryKeys: ['technology'],
      tableVersion: DO_DGII_MACRO_TABLE_VERSION,
    });
  });

  it('respeta el límite pedido y el techo de 200', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`10000010${i}`));
    const adapter = buildDoDgiiDiscoveryAdapter(fakeReads(rows).reads);
    assert.equal((await adapter({ countryCode: 'DO', macroIndustryKey: 'technology', limit: 2 })).companies.length, 2);
    assert.equal(DO_DGII_DISCOVERY_MAX_ROWS, 200);
    assert.equal((await adapter({ countryCode: 'DO', macroIndustryKey: 'technology', limit: 0 })).companies.length, 0);

    const { reads, calls } = fakeReads(rows);
    await buildDoDgiiDiscoveryAdapter(reads)({ countryCode: 'DO', macroIndustryKey: 'technology', limit: 999 });
    assert.equal(calls[0].limit, DO_DGII_DISCOVERY_MAX_ROWS * DO_DGII_DISCOVERY_READ_FACTOR);
  });

  it('una macro sin actividades clasificadas no consulta nada', async () => {
    const { reads, calls } = fakeReads([row('100000001')]);
    const result = await buildDoDgiiDiscoveryAdapter(reads)({
      countryCode: 'DO',
      macroIndustryKey: 'no_existe',
      limit: 5,
    });
    assert.equal(result.companies.length, 0);
    assert.equal(calls.length, 0);
  });

  it('descarta RNC inválidos, duplicados y filas sin nivel de tamaño válido', async () => {
    const { reads } = fakeReads([
      row('100000001'),
      row('100000001'),
      row('12345'),
      { ...row('100000002'), rnc: null },
      row('100000005', TECH_TEXT, null),
      row('100000006', TECH_TEXT, 7),
      { ...row('100000007'), legal_name: '  ' },
    ]);
    const result = await buildDoDgiiDiscoveryAdapter(reads)({
      countryCode: 'DO',
      macroIndustryKey: 'technology',
      limit: 5,
    });
    assert.deepEqual(result.companies.map((c) => c.taxId), ['100000001']);
  });

  it('la tabla de HOY manda: una fila guardada con otra macro o con texto ya ambiguo no se ofrece', async () => {
    const { reads } = fakeReads([
      row('100000001', CONSTRUCTION_TEXT),
      row('100000002', 'FABRICACIÓN DE PRODUCTOS DE LA'),
      row('100000003'),
    ]);
    const tech = await buildDoDgiiDiscoveryAdapter(reads)({ countryCode: 'DO', macroIndustryKey: 'technology', limit: 5 });
    assert.deepEqual(tech.companies.map((c) => c.taxId), ['100000003']);
    const health = await buildDoDgiiDiscoveryAdapter(reads)({ countryCode: 'DO', macroIndustryKey: 'health_pharma', limit: 5 });
    assert.equal(health.companies.length, 0);
  });

  it('sin filas legibles no ofrece nada', async () => {
    const result = await buildDoDgiiDiscoveryAdapter(fakeReads([]).reads)({
      countryCode: 'DO',
      macroIndustryKey: 'technology',
      limit: 5,
    });
    assert.equal(result.companies.length, 0);
  });
});

describe('pertenencia por tabla oficial', () => {
  const official = { macroIndustryKeys: ['technology'], tableVersion: DO_DGII_MACRO_TABLE_VERSION };

  it('confirma sólo la macro asignada por la tabla, aunque el texto no tenga palabras clave', () => {
    const confirmed = assessCountrySourceMacroPrecision({
      macroIndustryKey: 'technology',
      company: { declaredIndustry: 'texto sin palabras clave', officialMacroIndustry: official },
    });
    assert.equal(confirmed.verdict, 'confirmed');
    assert.deepEqual(confirmed.assessment.matchedConfirmingTerms, [DO_DGII_MACRO_TABLE_VERSION]);

    const rejected = assessCountrySourceMacroPrecision({
      macroIndustryKey: 'retail',
      company: { declaredIndustry: 'Venta al por menor', officialMacroIndustry: official },
    });
    assert.equal(rejected.verdict, 'rejected');
  });

  it('sin tabla oficial sigue mandando el evaluador canónico (Colombia intacta)', () => {
    const colombia = assessCountrySourceMacroPrecision({
      macroIndustryKey: 'health_pharma',
      company: { declaredIndustry: 'Fabricación de productos farmacéuticos' },
    });
    assert.equal(colombia.verdict, 'confirmed');
    assert.notDeepEqual(colombia.assessment.matchedConfirmingTerms, [DO_DGII_MACRO_TABLE_VERSION]);
  });
});

describe('puerta previa al pago con República Dominicana', () => {
  function gate(rows: DoDgiiActiveRow[], macroIndustryKey = 'technology') {
    return runPrePaidNoveltyGate(
      { provider: 'lusha', countryCode: 'DO', macroIndustryKey, requestedTarget: 2 },
      {
        countrySourceAdapter: buildDoDgiiDiscoveryAdapter(fakeReads(rows).reads),
        checkCompanyDuplicate: async (input) => noMatch(input),
        listKnownExclusionDomains: async () => [],
      },
    );
  }

  it('dos empresas con tamaño nuevas cierran el objetivo sin pagar (igual que Colombia)', async () => {
    const result = await gate([row('100000002', TECH_TEXT, 1), row('100000001')]);
    assert.equal(result.context.freeSource.macroConfirmed, 2);
    assert.equal(result.context.residualGap, 0);
    assert.equal(result.context.providerRequired, false);
    assert.deepEqual(result.acceptedCompanies.map((c) => c.taxId), ['100000002', '100000001']);
  });

  it('las de otra macro no cierran hueco', async () => {
    const result = await gate([row('100000001', CONSTRUCTION_TEXT)], 'technology');
    assert.equal(result.acceptedCompanies.length, 0);
    assert.equal(result.context.residualGap, 2);
    assert.equal(result.context.providerRequired, true);
  });

  it('una macro sin cobertura en DGII ni siquiera consulta', async () => {
    const result = await gate([row('100000001')], 'no_existe');
    assert.equal(result.context.freeSource.attempted, false);
    assert.equal(result.context.residualGap, 2);
  });
});
