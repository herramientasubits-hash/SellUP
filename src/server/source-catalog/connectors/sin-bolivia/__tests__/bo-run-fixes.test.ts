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

describe('razón social: «tecnología», «sistemas», «digital» sólo deciden si nada más lo hace (corrida 6a7af4ea)', () => {
  it('el sector de la razón social gana a la palabra genérica', () => {
    assert.equal(classifyBoliviaActivity('TECNOLOGIA EN PREFABRICADOS PARA LA CONSTRUCCION TECNOPRECO S.R.L.', null).macroIndustryKey, 'property_construction');
    assert.equal(classifyBoliviaActivity('TECNOLOGIA EN ALIMENTOS S.A. "TECALIM S.A."', null).macroIndustryKey, 'consumer_goods');
    assert.equal(classifyBoliviaActivity('TECNOLOGIAS METALURGICAS S.R.L.', null).macroIndustryKey, 'industry_manufacturing_chemicals_automotive');
  });

  it('comercio o consultoría + tecnología = mayorista o consultora informática (Tecnología, tabla AR v2)', () => {
    const dismatec = classifyBoliviaActivity('DISTRIBUIDORA MAYORISTA DE TECNOLOGIA S.A. "DISMATEC S.A."', null);
    assert.equal(dismatec.macroIndustryKey, 'technology');
    assert.equal(dismatec.ciiu, '4651');
    assert.equal(classifyBoliviaActivity('INTEGRADORES & CONSULTORES EN TECNOLOGIA S.R.L.', null).macroIndustryKey, 'technology');
  });

  it('sólo la palabra genérica ⇒ Tecnología, como antes', () => {
    assert.equal(classifyBoliviaActivity('ALPHA SYSTEMS S.R.L.', null).macroIndustryKey, 'technology');
    assert.equal(classifyBoliviaActivity('NEXUS TECHNOLOGY BOLIVIA S.A.', null).macroIndustryKey, 'technology');
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
    assert.equal(officialTradeNameWebsite('https://www.entel.bo/', ['ENTEL'], 'EMPRESA NACIONAL DE TELECOMUNICACIONES SOCIEDAD ANONIMA', 'BO')?.domain, 'entel.bo');
    assert.equal(officialTradeNameWebsite('https://dmc.com.bo', ['DMC'], 'DISTRIBUIDOR MAYORISTA DE COMPUTADORAS S.A. DMC S.A.', 'BO')?.domain, 'dmc.com.bo');
    assert.equal(officialTradeNameWebsite('https://dismatecbolivia.com', ['DISMATEC'], 'DISMATEC', 'BO')?.domain, 'dismatecbolivia.com');
    assert.equal(officialTradeNameWebsite('https://www.tigo.com.bo', ['TELECEL'], 'TELECEL', 'BO'), null);
  });

  it('el sufijo es del país de la fila: Bolivia no acepta «…ec», Ecuador no acepta «…bo»/«…bolivia»', () => {
    assert.equal(officialTradeNameWebsite('https://dmcec.com', ['DMC'], 'DMC', 'BO'), null);
    assert.equal(officialTradeNameWebsite('https://tiabo.com', ['TIA'], 'TIA', 'EC'), null);
    assert.equal(officialTradeNameWebsite('https://tiabolivia.com', ['TIA'], 'TIA'), null);
    assert.equal(officialTradeNameWebsite('https://tiaecuador.com', ['TIA'], 'TIA')?.domain, 'tiaecuador.com');
    assert.equal(registryFirstWordWebsite('https://huaweibolivia.com', 'HUAWEI TECHNOLOGIES ECUADOR', 'EC'), null);
    assert.equal(registryFirstWordWebsite('https://huaweibolivia.com', 'HUAWEI TECHNOLOGIES (BOLIVIA) S.R.L.', 'BO')?.domain, 'huaweibolivia.com');
  });

  it('el rescate pasa el país de la fila a las dos comprobaciones', () => {
    const batch = readFileSync(
      join(process.cwd(), 'src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.ts'),
      'utf8',
    );
    assert.match(batch, /officialTradeNameWebsite\(claimedUrl, officialNames, dispositionDisplayName\(row\), country\)/);
    assert.match(batch, /registryFirstWordWebsite\(claimedUrl, dispositionDisplayName\(row\), country\)/);
  });

  it('primera palabra propia de la razón social (a propósito en Bolivia): huawei.com ← HUAWEI TECHNOLOGIES', () => {
    assert.equal(registryFirstWordWebsite('https://www.huawei.com/bo/', 'HUAWEI TECHNOLOGIES (BOLIVIA) S.R.L.', 'BO')?.domain, 'huawei.com');
  });
});
