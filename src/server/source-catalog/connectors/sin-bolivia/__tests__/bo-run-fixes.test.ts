/**
 * SOURCES-BO-CLOSE-1 — arreglos de la corrida BO×Tecnología bdc00381 (07-10):
 *   1. en el objeto social manda la actividad que aparece PRIMERO;
 *   2. siglas oficiales por NIT (`bo_name_alias`) para que el rescate encuentre la web
 *      (TELECEL, DMC, DISMATEC, ENTEL de gob.bo); el país entre paréntesis no es sigla;
 *   3. Bolivia en los nombres oficiales del rescate.
 * Razones sociales y objetos sociales tal como los devolvió el SEPREC. Cero E/S.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { classifyBoliviaActivity, matchBoActivityRule } from '@/server/prospect-batches/country-source-discovery/bo-activity-macro-table';
import { boliviaLegalNameAliases } from '@/server/source-catalog/connectors/seprec-bolivia/bo-company-name-core';
import { buildBoLargeTaxpayerRow, type BoSeprecCrawlRecord } from '../bo-large-taxpayer-rows';
import { buildBoNameAliasRows, BO_NAME_ALIAS_SOURCE_KEY } from '../bo-name-alias-rows';
import { getSourceFamily } from '@/server/source-catalog/record-identity';
import {
  OFFICIAL_NAME_COUNTRIES,
  officialTradeNameWebsite,
  registryFirstWordWebsite,
} from '@/server/agents/prospecting-toolkit/claude-classifier/rescue/domain-search';

const record = (nit: string, legalName: string, socialPurpose: string | null = null): BoSeprecCrawlRecord => ({
  nit,
  flags: ['graco'],
  found: true,
  legalName,
  status: 'ACTIVO',
  unitTypeCode: '07',
  unitType: 'SOCIEDAD ANONIMA',
  renewalCode: '0',
  department: 'LA PAZ',
  socialPurpose,
});

function row(nit: string, legalName: string, socialPurpose: string | null = null) {
  const result = buildBoLargeTaxpayerRow(record(nit, legalName, socialPurpose));
  assert.ok('row' in result, legalName);
  return result.row;
}

describe('objeto social: manda la actividad que aparece primero', () => {
  it('autopartes antes que «celulares» → vehículos y repuestos (Retail), no Tecnología', () => {
    const c = classifyBoliviaActivity(
      'SUNRISE AUTOPARTS S.R.L.',
      'IMPORTACION, EXPORTACION, COMPRA Y VENTA DE AUTOPARTES, MONOPARTES, BATERIAS, NEUMATICOS, LUBRICANTES, ELECTRODOMESTICOS, COMPUTADORAS, CELULARES',
    );
    assert.equal(c.macroIndustryKey, 'retail');
    assert.equal(c.rule, 'vehículos y repuestos');
  });

  it('«importación… de equipos de telecomunicaciones» → Tecnología: lo genérico (importar) no gana a lo específico', () => {
    const c = classifyBoliviaActivity('ZTE BOLIVIA S.R.L.', 'ACTIVIDADES DE IMPORTACIÓN, EXPORTACIÓN, DISTRIBUCIÓN Y COMERCIALIZACIÓN DE EQUIPOS DE TELECOMUNICACIONES');
    assert.equal(c.macroIndustryKey, 'technology');
  });

  it('sólo genérico → comercio (Retail); la razón social sigue mandando sobre el objeto social', () => {
    assert.equal(classifyBoliviaActivity('HERGO LTDA.', 'IMPORTACION Y COMERCIALIZACION DE PRODUCTOS EN GENERAL').macroIndustryKey, 'retail');
    assert.equal(classifyBoliviaActivity('EMPRESA CONSTRUCTORA GISHAY S.R.L.', 'VENTA DE CELULARES').macroIndustryKey, 'property_construction');
    assert.equal(matchBoActivityRule('AUTOPARTES Y CELULARES', 'social_purpose')?.ciiu, '45');
  });
});

describe('siglas oficiales por NIT (bo_name_alias)', () => {
  it('el país entre paréntesis no es sigla; una sigla de 3 letras detrás de la forma sí', () => {
    assert.deepEqual(boliviaLegalNameAliases('HUAWEI TECHNOLOGIES (BOLIVIA) S.R.L.'), []);
    assert.deepEqual(boliviaLegalNameAliases('DISTRIBUIDOR MAYORISTA DE COMPUTADORAS S.A. DMC S.A.'), ['DMC']);
    assert.deepEqual(boliviaLegalNameAliases('TELEFÓNICA CELULAR DE BOLIVIA (TELECEL) S.A.'), ['TELECEL']);
  });

  it('siglas de la razón social y de gob.bo (empresa pública con el mismo nombre), una vez por NIT', () => {
    const rows = buildBoNameAliasRows(
      [
        row('1020255020', 'TELEFÓNICA CELULAR DE BOLIVIA (TELECEL) S.A.'),
        row('1020703023', 'EMPRESA NACIONAL DE TELECOMUNICACIONES SOCIEDAD ANONIMA'),
        row('1028679029', 'DISTRIBUIDOR MAYORISTA DE COMPUTADORAS S.A. DMC S.A.'),
        row('147612027', 'HUAWEI TECHNOLOGIES (BOLIVIA) S.R.L.'),
      ],
      [
        { normalizedLegalName: 'EMPRESA NACIONAL DE TELECOMUNICACIONES', acronym: 'ENTEL S.A.' },
        { normalizedLegalName: 'EMPRESA NACIONAL DE TELECOMUNICACIONES', acronym: 'ENTEL S.A.' },
        { normalizedLegalName: 'OTRA ENTIDAD', acronym: 'OE' },
      ],
    );
    assert.deepEqual(
      rows.map((r) => [r.tax_id, r.normalized_legal_name, r.raw_data.alias_source, r.record_identity_key]),
      [
        ['1020255020', 'TELECEL', 'legal_name', 'bo-alias:1020255020:TELECEL'],
        ['1020703023', 'ENTEL', 'gobbo_acronym', 'bo-alias:1020703023:ENTEL'],
        ['1028679029', 'DMC', 'legal_name', 'bo-alias:1028679029:DMC'],
      ],
    );
    assert.equal(rows[0].source_key, BO_NAME_ALIAS_SOURCE_KEY);
    assert.equal(getSourceFamily(BO_NAME_ALIAS_SOURCE_KEY), 'NATIVE_RECORD_GRAIN');
  });
});

describe('rescate: nombres oficiales de Bolivia', () => {
  it('Bolivia está en los países con nombres oficiales y su fuente es bo_name_alias', () => {
    assert.equal(OFFICIAL_NAME_COUNTRIES.has('BO'), true);
    const server = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server.ts'),
      'utf8',
    );
    assert.match(server, /BO: \['bo_name_alias'\]/);
  });

  it('la web cuya etiqueta es la sigla oficial es la de ese NIT (también con «bolivia»/«bo» pegado)', () => {
    assert.equal(officialTradeNameWebsite('https://www.entel.bo/', ['ENTEL'], 'EMPRESA NACIONAL DE TELECOMUNICACIONES SOCIEDAD ANONIMA')?.domain, 'entel.bo');
    assert.equal(officialTradeNameWebsite('https://dmc.com.bo', ['DMC'], 'DISTRIBUIDOR MAYORISTA DE COMPUTADORAS S.A. DMC S.A.')?.domain, 'dmc.com.bo');
    assert.equal(officialTradeNameWebsite('https://dismatecbolivia.com', ['DISMATEC'], 'DISMATEC')?.domain, 'dismatecbolivia.com');
    assert.equal(officialTradeNameWebsite('https://www.tigo.com.bo', ['TELECEL'], 'TELECEL'), null);
  });

  it('primera palabra propia de la razón social (a propósito en Bolivia): huawei.com ← HUAWEI TECHNOLOGIES', () => {
    assert.equal(registryFirstWordWebsite('https://www.huawei.com/bo/', 'HUAWEI TECHNOLOGIES (BOLIVIA) S.R.L.')?.domain, 'huawei.com');
  });
});
