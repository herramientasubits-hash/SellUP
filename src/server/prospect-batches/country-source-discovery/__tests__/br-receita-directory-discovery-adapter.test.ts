/**
 * SOURCES-BR-LIGHT-1 — buscador gratuito de Brasil (Receita, subconjunto liviano):
 * adapter, lectura y cableado en la capa gratuita por país.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BR_RECEITA_DIRECTORY_DISCOVERY_MAX_ROWS,
  BR_RECEITA_DIRECTORY_DISCOVERY_SOURCE_KEY,
  buildBrReceitaDirectoryDiscoveryAdapter,
  type BrReceitaDirectorySnapshotReadRow,
} from '../br-receita-directory-discovery-adapter';
import { toBrReceitaDirectoryRow } from '../br-receita-directory-snapshot-query';
import { BR_RECEITA_MACRO_TABLE_VERSION } from '../br-receita-macro-table';
import {
  buildCountrySourceAdapter,
  COUNTRY_SOURCE_DISCOVERY_COUNTRIES,
  countrySourceMacroHasCoverage,
  resolveCountrySourceCapability,
} from '../country-source-capability';
import { computeBrazilCnpjCheckDigits } from '@/server/source-catalog/connectors/br-receita-cnpj/br-cnpj';

const cnpj = (base12: string): string => `${base12}${computeBrazilCnpjCheckDigits(base12)}`;

function readRow(overrides: Partial<BrReceitaDirectorySnapshotReadRow> = {}): BrReceitaDirectorySnapshotReadRow {
  return {
    record_identity_key: `tax:${cnpj('844296950001')}`,
    cnpj: cnpj('844296950001'),
    legal_name: 'WEG SA',
    normalized_legal_name: 'WEG',
    city: 'JARAGUA DO SUL',
    region: 'SC',
    cnae: '2710401',
    activity_text: 'Fabricação de geradores de corrente contínua e alternada',
    website_domain: 'weg.net',
    public_entity: false,
    porte: '05',
    ...overrides,
  };
}

function adapterWith(rows: BrReceitaDirectorySnapshotReadRow[]) {
  const asked: { macroIndustryKey: string; limit: number }[] = [];
  const adapter = buildBrReceitaDirectoryDiscoveryAdapter({
    readCompaniesByMacro: async (input) => {
      asked.push(input);
      return rows;
    },
  });
  return { adapter, asked };
}

const criteria = (macroIndustryKey: string, limit = 50) =>
  ({ countryCode: 'BR', macroIndustryKey, limit }) as Parameters<ReturnType<typeof buildBrReceitaDirectoryDiscoveryAdapter>>[0];

describe('Brasil — buscador gratuito (br_receita_directory)', () => {
  it('ofrece la empresa con CNPJ, web, actividad y la macro de la tabla aprobada', async () => {
    const { adapter, asked } = adapterWith([readRow()]);
    const result = await adapter(criteria('industry_manufacturing_chemicals_automotive'));
    assert.equal(result.sourceKey, BR_RECEITA_DIRECTORY_DISCOVERY_SOURCE_KEY);
    assert.equal(result.companies.length, 1);
    const [company] = result.companies;
    assert.equal(company.taxId, cnpj('844296950001'));
    assert.equal(company.taxIdentifierType, 'CNPJ');
    assert.equal(company.countryCode, 'BR');
    assert.equal(company.domain, 'weg.net');
    assert.equal(company.industryCode, '2710401');
    assert.deepEqual(company.officialMacroIndustry, {
      macroIndustryKeys: ['industry_manufacturing_chemicals_automotive'],
      tableVersion: BR_RECEITA_MACRO_TABLE_VERSION,
    });
    assert.deepEqual(asked, [{ macroIndustryKey: 'industry_manufacturing_chemicals_automotive', limit: 50 }]);
  });

  it('la tabla de HOY manda; ME/EPP, holdings y CNPJ inválidos nunca salen; un CNPJ una vez', async () => {
    const { adapter } = adapterWith([
      readRow(),
      readRow(),
      readRow({ cnpj: cnpj('111111110001'), cnae: '6201501' }),
      readRow({ cnpj: cnpj('222222220001'), porte: '03' }),
      readRow({ cnpj: cnpj('333333330001'), cnae: '6462000' }),
      readRow({ cnpj: '84429695000100' }),
    ]);
    const result = await adapter(criteria('industry_manufacturing_chemicals_automotive'));
    assert.deepEqual(result.companies.map((c) => c.taxId), [cnpj('844296950001')]);
    assert.equal(result.recordsRead, 6);
  });

  it('entes públicos: entran por su macro guardada (Gobierno) aunque su CNAE sea otra', async () => {
    const { adapter } = adapterWith([
      readRow({ legal_name: 'MUNICIPIO DE CANDOI', cnae: '8411600', public_entity: true, porte: '05', website_domain: 'candoi.pr.gov.br' }),
    ]);
    const result = await adapter(criteria('government'));
    assert.equal(result.companies.length, 1);
    assert.equal(result.companies[0].domain, 'candoi.pr.gov.br');
  });

  it('una empresa por web aunque quede una fila vieja del mismo grupo', async () => {
    const { adapter } = adapterWith([
      readRow({ cnpj: cnpj('404325440001'), legal_name: 'CLARO S.A.', cnae: '6110801', website_domain: 'claro.com.br' }),
      readRow({ cnpj: cnpj('669702290001'), legal_name: 'CLARO NXT TELECOMUNICACOES S/A', cnae: '6110801', website_domain: 'claro.com.br' }),
      readRow({ cnpj: cnpj('317481740001'), legal_name: 'VERO S.A.', cnae: '6110801', website_domain: null }),
    ]);
    const result = await adapter(criteria('technology'));
    assert.deepEqual(result.companies.map((c) => c.legalName), ['CLARO S.A.', 'VERO S.A.']);
  });

  it('una macro sin actividades no consulta; el tope es 200', async () => {
    const empty = adapterWith([readRow()]);
    const none = await empty.adapter(criteria('education'));
    assert.equal(none.companies.length, 0);
    assert.equal(empty.asked.length, 0);
    const capped = adapterWith([]);
    await capped.adapter(criteria('technology', 5000));
    assert.equal(capped.asked[0].limit, BR_RECEITA_DIRECTORY_DISCOVERY_MAX_ROWS);
  });

  it('lectura: raw_data → fila del adapter', () => {
    const mapped = toBrReceitaDirectoryRow({
      record_identity_key: 'tax:x',
      normalized_tax_id: cnpj('844296950001'),
      legal_name: 'WEG SA',
      normalized_legal_name: 'WEG',
      city: 'JARAGUA DO SUL',
      region: 'SC',
      raw_data: { cnae_principal: '2710401', activity_text: 'Geradores', website_domain: 'weg.net', br_porte: '05', public_entity: true },
    });
    assert.equal(mapped.cnae, '2710401');
    assert.equal(mapped.website_domain, 'weg.net');
    assert.equal(mapped.porte, '05');
    assert.equal(mapped.public_entity, true);
  });
});

describe('Brasil — cableado en la capa gratuita por país', () => {
  it('BR está en la lista y tiene su capacidad', () => {
    assert.ok((COUNTRY_SOURCE_DISCOVERY_COUNTRIES as readonly string[]).includes('BR'));
    assert.deepEqual(resolveCountrySourceCapability('br'), {
      countryCode: 'BR',
      sourceKey: BR_RECEITA_DIRECTORY_DISCOVERY_SOURCE_KEY,
    });
    assert.ok(countrySourceMacroHasCoverage('BR', 'technology'));
    assert.ok(countrySourceMacroHasCoverage('BR', 'government'));
    assert.ok(!countrySourceMacroHasCoverage('BR', 'education'));
  });

  it('sin la lectura inyectada no hay adapter (fail-open hacia el pago)', () => {
    assert.equal(buildCountrySourceAdapter('BR', {}), null);
    const adapter = buildCountrySourceAdapter('BR', {
      brReceitaDirectoryDiscoveryReads: { readCompaniesByMacro: async () => [] },
    });
    assert.equal(typeof adapter, 'function');
  });
});
