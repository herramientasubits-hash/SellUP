/**
 * Tests — España en «Proveedores de una empresa» (PLACSP, AGENT1-SUPPLIER-SEARCH-ALL-1).
 * La licitación de prueba es real (sindicación 643, 30-09-2025: limpieza de los centros de
 * FREMAP, tres lotes, uno desierto), recortada a lo que lee el lector y sin contactos. El
 * lote 3 lleva aquí CPV 72 (en la real es 90911200, como los otros) para probar el CPV por lote.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ES_FREE_DIRECTORY_MACRO_TABLE_VERSION } from '@/server/prospect-batches/country-source-discovery/es-free-directory-macro-table';
import { cpvDivision, ES_COUNTRY, ES_CPV_CLASSIFIER, ES_CPV_DIVISION_LABEL, esEntityNameOf, parseEsCompanyNif } from '../es';
import { createEsLoader, esBuyerNames, parseEsEntry } from '../es.loader';
import { ES_PLACSP_AWARDS_CATALOG_SOURCE } from '../es.catalog';
import { aggregate, runStep } from './loaded-country-harness';

const RESULT = (code: string, lot: string, winner: string | null, amount: string | null, date = '2025-09-22') => `
  <cac:TenderResult>
    <cbc:ResultCode listURI="http://contrataciondelestado.es/codice/cl/2.09/TenderResultCode-2.09.gc">${code}</cbc:ResultCode>
    <cbc:AwardDate>${date}</cbc:AwardDate>
    ${winner ?? ''}
    <cac:AwardedTenderedProject>
      <cbc:ProcurementProjectLotID>${lot}</cbc:ProcurementProjectLotID>
      ${amount ? `<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="EUR">${amount}</cbc:TaxExclusiveAmount><cbc:PayableAmount currencyID="EUR">1</cbc:PayableAmount></cac:LegalMonetaryTotal>` : ''}
    </cac:AwardedTenderedProject>
  </cac:TenderResult>`;

const WINNER = (scheme: string, id: string, name: string) =>
  `<cac:WinningParty><cac:PartyIdentification><cbc:ID schemeName="${scheme}">${id}</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>${name}</cbc:Name></cac:PartyName></cac:WinningParty>`;

const ENTRY = (options: { updated?: string; organ?: string; results?: string } = {}) => `
  <id>https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/17620274</id>
  <link href="https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&amp;idEvl=9MnAIcA2N0ydkQsA7ROvsg%3D%3D"/>
  <updated>${options.updated ?? '2025-09-30T16:42:14.247+02:00'}</updated>
  <cac-place-ext:ContractFolderStatus>
    <cbc:ContractFolderID>LICT/99/159/2024/0238</cbc:ContractFolderID>
    <cac-place-ext:LocatedContractingParty>
      <cac:Party>
        <cac:PartyIdentification><cbc:ID schemeName="NIF">G28207017</cbc:ID></cac:PartyIdentification>
        <cac:PartyName><cbc:Name>${options.organ ?? 'Director Gerente de FREMAP'}</cbc:Name></cac:PartyName>
      </cac:Party>
      <cac-place-ext:ParentLocatedParty><cac:PartyName><cbc:Name>Mutuas</cbc:Name></cac:PartyName></cac-place-ext:ParentLocatedParty>
    </cac-place-ext:LocatedContractingParty>
    <cac:ProcurementProject>
      <cbc:Name>Contratación del servicio de limpieza en los Centros de FREMAP</cbc:Name>
      <cac:RequiredCommodityClassification><cbc:ItemClassificationCode listURI="x">90911200</cbc:ItemClassificationCode></cac:RequiredCommodityClassification>
    </cac:ProcurementProject>
    <cac:ProcurementProjectLot>
      <cbc:ID schemeName="ID_LOTE">1</cbc:ID>
      <cac:ProcurementProject><cac:RequiredCommodityClassification><cbc:ItemClassificationCode listURI="x">90911200</cbc:ItemClassificationCode></cac:RequiredCommodityClassification></cac:ProcurementProject>
    </cac:ProcurementProjectLot>
    <cac:ProcurementProjectLot>
      <cbc:ID schemeName="ID_LOTE">3</cbc:ID>
      <cac:ProcurementProject><cac:RequiredCommodityClassification><cbc:ItemClassificationCode listURI="x">72000000</cbc:ItemClassificationCode></cac:RequiredCommodityClassification></cac:ProcurementProject>
    </cac:ProcurementProjectLot>
    ${
      options.results ??
      [
        RESULT('8', '1', WINNER('NIF', 'B30132724', 'LIMCAMAR SL'), '105007.92'),
        RESULT('3', '2', null, null, '2025-09-19'),
        RESULT('8', '3', WINNER('NIF', 'B30132724', 'LIMCAMAR SL'), '171526.08'),
      ].join('')
    }
  </cac-place-ext:ContractFolderStatus>`;

const WINDOW = { start: '2025-09-01', end: '2026-08-31' };

describe('1. NIF, nombres y CPV', () => {
  it('sólo NIF de empresa con control válido: fuera organismos, UTE, asociaciones y personas', () => {
    assert.equal(parseEsCompanyNif('B30132724'), 'B30132724');
    assert.equal(parseEsCompanyNif('a28476208'), 'A28476208');
    assert.equal(parseEsCompanyNif('B30132725'), null, 'control incorrecto');
    assert.equal(parseEsCompanyNif('Q2812001B'), null, 'organismo autónomo');
    assert.equal(parseEsCompanyNif('P2807900B'), null, 'corporación local');
    assert.equal(parseEsCompanyNif('G28207017'), null, 'asociación/mutua');
    assert.equal(parseEsCompanyNif('12345678Z'), null, 'DNI');
    assert.equal(parseEsCompanyNif('X1234567L'), null, 'NIE');
  });

  it('órgano de contratación → entidad', () => {
    assert.equal(esEntityNameOf('Alcaldía del Ayuntamiento de Arévalo'), 'Ayuntamiento de Arévalo');
    assert.equal(esEntityNameOf('Junta de Gobierno Local del Ayuntamiento de Rivas Vaciamadrid'), 'Ayuntamiento de Rivas Vaciamadrid');
    assert.equal(esEntityNameOf('Área de Gobierno de Economía, Innovación y Hacienda del Ayuntamiento de Madrid'), 'Ayuntamiento de Madrid');
    assert.equal(esEntityNameOf('Presidencia de la Autoridad Portuaria de A Coruña'), 'Autoridad Portuaria de A Coruña');
    assert.equal(esEntityNameOf('Director Gerente de FREMAP'), 'FREMAP');
    assert.equal(esEntityNameOf('ADIF - Presidencia'), 'ADIF');
    assert.equal(esEntityNameOf('Aena. Dirección de Contratación'), 'Aena');
    assert.equal(esEntityNameOf('Departamento de Salud Alicante. Dirección Económica-Gerencia'), 'Departamento de Salud Alicante');
    assert.equal(esEntityNameOf('Dirección Provincial de Educación en Burgos'), 'Dirección Provincial de Educación en Burgos');
    assert.equal(ES_COUNTRY.normalizeBuyerName('Ayuntamiento de Arévalo'), 'AYUNTAMIENTO DE AREVALO');
  });

  it('CPV → división', () => {
    assert.equal(cpvDivision('72212000-4'), '72');
    assert.equal(cpvDivision('45500000'), '45');
    assert.equal(cpvDivision('455'), null);
  });
});

describe('2. lector ATOM/CODICE', () => {
  it('lotes adjudicados con su CPV y monto sin IVA; el desierto no cuenta', () => {
    const parsed = parseEsEntry(ENTRY(), WINDOW);
    assert.ok(parsed);
    assert.equal(parsed.id, 'https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/17620274');
    assert.deepEqual(parsed.lines.map((l) => [l.supplierTaxId, l.amount, l.classificationKey]), [
      ['B30132724', 105007.92, '90'],
      ['B30132724', 171526.08, '72'],
    ]);
    const line = parsed.lines[0];
    assert.equal(line.buyerCode, 'G28207017');
    assert.equal(line.buyerName, 'FREMAP');
    assert.equal(line.orderCode, '17620274');
    assert.equal(line.orderUrl, 'https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=9MnAIcA2N0ydkQsA7ROvsg%3D%3D');
    assert.equal(line.date, '2025-09-22');
  });

  it('fuera de la ventana o sin empresa adjudicataria ⇒ sin líneas (pero la versión cuenta)', () => {
    assert.deepEqual(parseEsEntry(ENTRY(), { start: '2025-10-01', end: '2026-09-30' })?.lines, []);
    const ute = parseEsEntry(ENTRY({ results: RESULT('9', '1', WINNER('UTE', 'U12345678', 'UTE LIMPIEZAS'), '50000') }), WINDOW);
    assert.deepEqual(ute?.lines, []);
  });

  it('varias adjudicatarias: el monto se reparte entre TODAS (también la que no es empresa)', () => {
    const shared = parseEsEntry(
      ENTRY({ results: RESULT('9', '1', WINNER('NIF', 'B30132724', 'LIMCAMAR SL') + WINNER('NIF', '12345678Z', 'Persona'), '100000') }),
      WINDOW,
    );
    assert.deepEqual(shared?.lines.map((l) => [l.supplierTaxId, l.amount]), [['B30132724', 50_000]]);
  });

  it('nombre del comprador: el más repetido entre sus órganos', () => {
    const a = parseEsEntry(ENTRY({ organ: 'Alcaldía del Ayuntamiento de Madrid' }), WINDOW)!;
    const b = parseEsEntry(ENTRY({ organ: 'Área de Gobierno de Hacienda del Ayuntamiento de Madrid' }), WINDOW)!;
    const c = parseEsEntry(ENTRY({ organ: 'Distrito de Chamartín' }), WINDOW)!;
    assert.equal(esBuyerNames([a, b, c]).get('G28207017'), 'Ayuntamiento de Madrid');
  });

  it('files(): un zip por mes, del más viejo al más nuevo', () => {
    const files = createEsLoader().files({ year: 2026, month: 9 }, 12);
    assert.equal(files.length, 12);
    assert.equal(files[0].name, 'es-2025-10.zip');
    assert.equal(files[11].url, 'https://contrataciondelestado.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_202609.zip');
  });
});

describe('3. tabla CPV aprobada', () => {
  it('usa la tabla CPV de la capa gratuita española (regla del 50 %)', () => {
    assert.equal(ES_CPV_CLASSIFIER.tableVersion, ES_FREE_DIRECTORY_MACRO_TABLE_VERSION);
    assert.deepEqual(ES_CPV_CLASSIFIER.classify({ '72': 60, '90': 40 }), { macroIndustryKey: 'technology', share: 0.6 });
    assert.equal(ES_CPV_CLASSIFIER.classify({ '80': 100 }), null, 'educación (80) no tiene macro');
    assert.equal(ES_CPV_CLASSIFIER.classify({ '72': 40, '80': 60 }), null);
    assert.equal(ES_CPV_CLASSIFIER.rubroOf('90'), 'Saneamiento, limpieza y medio ambiente');
    assert.equal(Object.keys(ES_CPV_DIVISION_LABEL).length, 41);
  });
});

describe('4. de punta a punta: «FREMAP» × Energía y medio ambiente', () => {
  it('reconoce la entidad y ofrece al proveedor con su web', async () => {
    const parsed = parseEsEntry(ENTRY({ results: RESULT('8', '1', WINNER('NIF', 'B30132724', 'LIMCAMAR SL'), '105007.92') }), WINDOW)!;
    const links = aggregate(ES_COUNTRY, parsed.lines);
    const { outcome, written } = await runStep(
      ES_COUNTRY,
      links,
      [{ country_code: 'ES', source_key: 'es_free_directory', tax_id: 'B30132724', normalized_tax_id: 'B30132724', raw_data: { website_domain: 'limcamar.es', workers: 900, metrics_year: 2025 } }],
      { referenceCompanyName: 'FREMAP', macroIndustryKey: 'energy_mining_environment' },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.matchedBy, 'exact');
    assert.deepEqual(written.map((c) => [c.taxId, c.domain, c.taxIdentifierType]), [['B30132724', 'limcamar.es', 'NIF']]);
    assert.match(outcome.relationships[0].evidence, /saneamiento, limpieza y medio ambiente/);
  });
});

describe('5. Catálogo de fuentes', () => {
  it('connected_free_discovery, pendiente de validar, compras públicas', () => {
    assert.equal(ES_PLACSP_AWARDS_CATALOG_SOURCE.key, ES_COUNTRY.sourceKey);
    assert.equal(ES_PLACSP_AWARDS_CATALOG_SOURCE.aiFlowStatus, 'connected_free_discovery');
    assert.equal(ES_PLACSP_AWARDS_CATALOG_SOURCE.operationalStatus, 'pending_validation');
    assert.equal(ES_PLACSP_AWARDS_CATALOG_SOURCE.type, 'procurement');
  });
});
