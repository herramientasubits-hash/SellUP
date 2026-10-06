/**
 * SOURCES-MX-FREE-LAYER-RFC-1 — la capa gratuita busca el número fiscal oficial
 * de las empresas que su fuente publica sin él (DENUE México), antes del dedupe y
 * del chequeo de duplicado. Cero llamadas externas: dobles locales.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import { createSnapshotNameOfficialSourceResolver } from '@/server/agents/prospect-intake/resolvers/snapshot-name-official-source-resolver';
import { normalizeMexicoCompanyCore } from '@/server/source-catalog/connectors/compranet-mexico/mx-compranet-rfc-rows';
import {
  buildCountrySourceOfficialTaxIdLookup,
  fillMissingOfficialTaxIds,
  type LookUpCountrySourceOfficialTaxId,
} from '../country-source-official-tax-id';
import { runCountrySourcePrePaidDiscovery } from '../run-country-source-prepaid-discovery';
import type { CountrySourceCompany } from '../country-source-types';
import { sanitizeStructuredDiscoveryProvenance } from '@/server/agents/prospecting-toolkit/structured-discovery-provenance';

const MACRO = 'health_pharma';

/** Empresa sintética de DENUE: sin RFC, macro asignada por tabla oficial. */
function denue(key: string, legalName: string | null, overrides: Partial<CountrySourceCompany> = {}): CountrySourceCompany {
  return {
    recordIdentityKey: `denue:${key}`,
    legalName,
    normalizedLegalName: legalName ? normalizeMexicoCompanyCore(legalName) : null,
    taxId: null,
    taxIdentifierType: null,
    countryCode: 'MX',
    city: 'MONTERREY',
    region: 'NUEVO LEON',
    domain: null,
    declaredIndustry: 'Hospitales generales del sector privado',
    industryCode: '622111',
    coarseSector: null,
    officialMacroIndustry: { macroIndustryKeys: [MACRO], tableVersion: 'test' },
    ...overrides,
  };
}

/** Registro oficial sintético (formato CompraNet: forma societaria sin puntos). */
const REGISTRY = [
  { taxId: 'HSE930521IJ4', legalName: 'HOSPITAL SINTETICO DEL NORTE SA DE CV' },
  { taxId: 'USA060201AB2', legalName: 'UNIVERSIDAD SINTETICA AC' },
  // Dos RFC con el mismo núcleo: ambiguo, nunca fuerte.
  { taxId: 'CLA010101AA1', legalName: 'CLINICA AMBIGUA SA DE CV' },
  { taxId: 'CLA020202BB2', legalName: 'CLINICA AMBIGUA SC' },
].map((row) => ({ ...row, normalizedLegalName: normalizeMexicoCompanyCore(row.legalName) }));

const mxResolver = createSnapshotNameOfficialSourceResolver({
  countryCode: 'MX',
  sourceKey: 'mx_compranet_rfc_registry',
  taxIdentifierType: 'RFC',
  validTaxId: /^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/,
  normalizeCore: normalizeMexicoCompanyCore,
  querySnapshots: async (core) => REGISTRY.filter((row) => row.normalizedLegalName === core),
  singleWordIsSignalOnly: true,
});

function noMatch(input: DuplicateCheckInput): DuplicateCheckResult {
  return { status: 'new_candidate', confidence: 0, input, matches: [], summary: 'no_match', checkedSources: ['sellup', 'hubspot'] };
}

describe('lookup oficial por nombre (mismos resolutores que Apollo/Tavily/Claude)', () => {
  const lookUp = buildCountrySourceOfficialTaxIdLookup([mxResolver]);

  it('nombre de DENUE con puntos → RFC fuerte del registro sin puntos', async () => {
    const match = await lookUp(denue('1', 'Hospital Sintético del Norte, S.A. de C.V.'));
    assert.deepEqual(
      { taxId: match?.taxId, type: match?.taxIdentifierType, source: match?.sourceKey },
      { taxId: 'HSE930521IJ4', type: 'RFC', source: 'mx_compranet_rfc_registry' },
    );
  });

  it('«A.C.» con puntos coincide con «AC» del registro', async () => {
    const match = await lookUp(denue('2', 'UNIVERSIDAD SINTETICA, A.C.'));
    assert.equal(match?.taxId, 'USA060201AB2');
  });

  it('ambiguo (dos RFC), una sola palabra o sin coincidencia → null', async () => {
    assert.equal(await lookUp(denue('3', 'CLINICA AMBIGUA SA DE CV')), null);
    assert.equal(await lookUp(denue('4', 'Sintetica')), null);
    assert.equal(await lookUp(denue('5', 'EMPRESA QUE NO EXISTE SA DE CV')), null);
    assert.equal(await lookUp(denue('6', null)), null);
  });

  it('sin resolutor para el país → null (no inventa)', async () => {
    assert.equal(await buildCountrySourceOfficialTaxIdLookup([])(denue('7', 'Hospital Sintético del Norte SA de CV')), null);
  });
});

describe('fillMissingOfficialTaxIds', () => {
  it('sólo busca las que llegan sin número; deja la traza; no muta la entrada', async () => {
    const asked: string[] = [];
    const lookUp: LookUpCountrySourceOfficialTaxId = async (company) => {
      asked.push(company.recordIdentityKey);
      return { taxId: 'HSE930521IJ4', taxIdentifierType: 'RFC', sourceKey: 'mx_compranet_rfc_registry', confidence: 0.85 };
    };
    const withTax = denue('a', 'YA TIENE SA DE CV', { taxId: 'YAT010101AA1', taxIdentifierType: 'RFC' });
    const input = [denue('b', 'HOSPITAL SINTETICO DEL NORTE SA DE CV'), withTax];
    const out = await fillMissingOfficialTaxIds(input, lookUp);
    assert.deepEqual(asked, ['denue:b']);
    assert.equal(out[0].taxId, 'HSE930521IJ4');
    assert.deepEqual(out[0].officialTaxIdLookup, { sourceKey: 'mx_compranet_rfc_registry', confidence: 0.85 });
    assert.equal(out[1], withTax);
    assert.equal(input[0].taxId, null);
  });

  it('un tropiezo del lookup deja la empresa como venía', async () => {
    const out = await fillMissingOfficialTaxIds([denue('c', 'X SA DE CV')], async () => {
      throw new Error('db down');
    });
    assert.equal(out[0].taxId, null);
  });

  it('vencido el plazo no empieza búsquedas nuevas', async () => {
    let clock = 0;
    let calls = 0;
    const out = await fillMissingOfficialTaxIds(
      [denue('d', 'A SA DE CV'), denue('e', 'B SA DE CV')],
      async () => {
        calls++;
        clock += 100;
        return null;
      },
      { nowMs: () => clock, deadlineMs: 50, concurrency: 1 },
    );
    assert.equal(calls, 1);
    assert.equal(out.length, 2);
  });
});

describe('runCountrySourcePrePaidDiscovery con lookup', () => {
  const adapter = (companies: CountrySourceCompany[]) => async () => ({ sourceKey: 'mx_denue', companies, recordsRead: companies.length });

  it('el chequeo de duplicado recibe el RFC; dos sucursales del mismo RFC cuentan una vez', async () => {
    const seen: DuplicateCheckInput[] = [];
    const result = await runCountrySourcePrePaidDiscovery(
      { countryCode: 'MX', macroIndustryKey: MACRO, requestedTarget: 5 },
      {
        adapter: adapter([
          denue('1', 'Hospital Sintético del Norte, S.A. de C.V.'),
          denue('2', 'HOSPITAL SINTETICO DEL NORTE SA DE CV'),
          denue('3', 'EMPRESA SIN REGISTRO SA DE CV'),
        ]),
        checkCompanyDuplicate: async (input) => {
          seen.push(input);
          return noMatch(input);
        },
        lookUpOfficialTaxId: buildCountrySourceOfficialTaxIdLookup([mxResolver]),
      },
    );
    assert.equal(result.outcome.macroConfirmed, 3);
    assert.equal(result.acceptedCompanies.length, 2);
    assert.deepEqual(seen.map((input) => input.taxIdentifier), ['HSE930521IJ4', null]);
    assert.equal(result.acceptedCompanies[0].taxIdentifierType, 'RFC');
  });

  it('lo rechazado por la macro no se busca', async () => {
    const asked: string[] = [];
    await runCountrySourcePrePaidDiscovery(
      { countryCode: 'MX', macroIndustryKey: MACRO, requestedTarget: 5 },
      {
        adapter: adapter([denue('x', 'OTRA SA DE CV', { officialMacroIndustry: { macroIndustryKeys: ['technology'], tableVersion: 'test' } })]),
        checkCompanyDuplicate: async (input) => noMatch(input),
        lookUpOfficialTaxId: async (company) => {
          asked.push(company.recordIdentityKey);
          return null;
        },
      },
    );
    assert.deepEqual(asked, []);
  });

  it('sin lookup se comporta como antes (sin RFC)', async () => {
    const result = await runCountrySourcePrePaidDiscovery(
      { countryCode: 'MX', macroIndustryKey: MACRO, requestedTarget: 5 },
      { adapter: adapter([denue('1', 'HOSPITAL SINTETICO DEL NORTE SA DE CV')]), checkCompanyDuplicate: async (input) => noMatch(input) },
    );
    assert.equal(result.acceptedCompanies[0].taxId, null);
  });
});

describe('la traza del lookup llega a la fila (lista cerrada de procedencia)', () => {
  it('se conserva válida y se omite malformada', () => {
    assert.deepEqual(
      sanitizeStructuredDiscoveryProvenance({ official_tax_id_lookup: { source_key: 'mx_compranet_rfc_registry', confidence: 0.85, raw: 'x' } }),
      { official_tax_id_lookup: { source_key: 'mx_compranet_rfc_registry', confidence: 0.85 } },
    );
    assert.deepEqual(sanitizeStructuredDiscoveryProvenance({ official_tax_id_lookup: { source_key: 'DROP TABLE', confidence: 0.85 } }), {});
    assert.deepEqual(sanitizeStructuredDiscoveryProvenance({ official_tax_id_lookup: { source_key: 'mx', confidence: 7 } }), {});
    assert.deepEqual(sanitizeStructuredDiscoveryProvenance({ official_tax_id_lookup: 'mx' }), {});
  });
});
