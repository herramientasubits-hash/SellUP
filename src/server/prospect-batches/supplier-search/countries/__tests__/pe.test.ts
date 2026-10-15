/**
 * Tests — Perú en «Proveedores de una empresa» (OECE Contrataciones Abiertas, OCDS):
 * reglas del RUC, lector (ventana por fecha de firma, monto en soles, UNSPSC por ítem,
 * fuera entidades públicas/consorcios/personas) y el paso de punta a punta con dobles.
 * Versiones recortadas de `full.jsonl.gz` (publicación 135 del OCP Data Registry).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runPublicBuyerSupplierStep } from '../../public-buyer-suppliers';
import { buildLoadedLinksLookups } from '../loaded-lookups.server';
import { ocdsWindow } from '../ocds-window';
import { isPeCompanySupplier, parsePeRuc, PE_COUNTRY } from '../pe';
import { PE_LOADER, peAmountInPen } from '../pe.loader';
import { aggregate, fakeClient, readWindow, writeGzFiles } from './ocds-test-helpers';

const END = { year: 2026, month: 9 };
const FILE = `pe-full-${END.year}-${END.month}.jsonl.gz`;

const inia = { id: 'PE-CONSUCODE-1972', name: 'INSTITUTO NACIONAL DE INNOVACION AGRARIA - INIA' };
const iniaParty = {
  ...inia,
  roles: ['buyer', 'procuringEntity'],
  identifier: { id: '1972', scheme: 'PE-CONSUCODE' },
  additionalIdentifiers: [{ id: '20131365994', scheme: 'PE-RUC' }],
};
const supplierParty = (ruc: string, name: string) => ({ id: `PE-RUC-${ruc}`, name, roles: ['tenderer', 'supplier'], identifier: { id: ruc, scheme: 'PE-RUC' } });
const item = (id: string, amount: number, unspsc: string | null) => ({
  id,
  totalValue: { amount, currency: 'PEN' },
  ...(unspsc ? { classification: { id: `${unspsc}00094854`, scheme: 'CUBSO' }, additionalClassifications: [{ id: unspsc, scheme: 'UNSPSC' }] } : {}),
});

/** Real (recortado): INIA contrata vigilancia con GZ PERU S.A. el 10-08-2026. */
const SECURITY = {
  ocid: 'ocds-dgv273-seacev3-1203238',
  buyer: inia,
  parties: [iniaParty, supplierParty('20601319676', 'GZ PERU S.A.')],
  awards: [{ id: '1203238-20601319676', suppliers: [{ id: 'PE-RUC-20601319676', name: 'GZ PERU S.A.' }] }],
  tender: { value: { amount: 0, currency: 'PEN', amount_PEN: 0 } },
  contracts: [
    {
      id: '2419657',
      awardID: '1203238-20601319676',
      dateSigned: '2026-08-10T00:00:00-05:00',
      value: { amount: 5_639_136, currency: 'PEN' },
      items: [item('21244318', 250_176, '92101501'), item('21244315', 480_000, '92101501')],
      documents: [{ url: 'https://prod4.seace.gob.pe:9000/api/con/documentos/descargar/153177015', documentType: 'contractSigned' }],
    },
  ],
};

/** Varios proveedores que NO entran y uno en dólares que sí. */
const MIXED = {
  ocid: 'ocds-dgv273-seacev3-9000001',
  buyer: inia,
  parties: [
    iniaParty,
    supplierParty('10456789012', 'PEREZ QUISPE JUAN'),
    supplierParty('20603200587', 'CONSORCIO  GURKAS SAC'),
    supplierParty('20172357411', 'MUNICIPALIDAD DISTRITAL DE YANAHUARA'),
    supplierParty('20307167442', 'PROMOTORA OFICIAL SAC'),
    supplierParty('20512831983', 'SOFTWARE ANDINO S.A.C.'),
  ],
  awards: ['10456789012', '20603200587', '20172357411', '20307167442', '20512831983'].map((ruc) => ({ id: `A-${ruc}`, suppliers: [{ id: `PE-RUC-${ruc}`, name: '' }] })),
  tender: { value: { amount: 20_000, currency: 'USD', amount_PEN: 70_000 } },
  contracts: ['10456789012', '20603200587', '20172357411', '20307167442', '20512831983'].map((ruc, i) => ({
    id: `C-${i}`,
    awardID: `A-${ruc}`,
    dateSigned: '2026-03-02T00:00:00-05:00',
    value: { amount: 20_000, currency: 'USD' },
    items: [item(`I-${i}`, 20_000, '81111500')],
    documents: [],
  })),
};

/** La «promotora» con RUC 20307167442 también COMPRA (es una entidad): sale de proveedores. */
const PROMPERU_AS_BUYER = {
  ocid: 'ocds-dgv273-seacev3-1254783',
  buyer: { id: 'PE-CONSUCODE-1947', name: 'PROMPERU' },
  parties: [{ id: 'PE-CONSUCODE-1947', name: 'PROMPERU', roles: ['buyer'], additionalIdentifiers: [{ id: '20307167442', scheme: 'PE-RUC' }] }],
};

/** Contrato firmado antes de la ventana: no entra. */
const OLD = { ...SECURITY, ocid: 'ocds-dgv273-seacev3-1', contracts: [{ ...SECURITY.contracts[0], id: 'OLD', dateSigned: '2024-01-10T00:00:00-05:00' }] };

describe('Perú — reglas', () => {
  it('RUC: prefijo del OCDS fuera; 11 dígitos', () => {
    assert.equal(parsePeRuc('PE-RUC-20601319676'), '20601319676');
    assert.equal(parsePeRuc('L0000005736'), null, 'extranjero sin RUC');
    assert.equal(parsePeRuc('1712345'), null, 'consorcio sin RUC');
  });

  it('empresa = RUC 20 que no es consorcio ni entidad pública', () => {
    assert.equal(isPeCompanySupplier('20601319676', 'GZ PERU S.A.'), true);
    assert.equal(isPeCompanySupplier('10456789012', 'PEREZ QUISPE JUAN'), false);
    assert.equal(isPeCompanySupplier('20603200587', 'CONSORCIO  GURKAS SAC'), false);
    assert.equal(isPeCompanySupplier('20131365994', 'Gobierno Regional de Cusco'), false);
    assert.equal(isPeCompanySupplier('20100000001', 'UNIVERSIDAD DEL PACIFICO'), true, 'universidad privada sí');
  });

  it('nombre del comprador como lo escribe la persona', () => {
    assert.equal(PE_COUNTRY.normalizeBuyerName('Instituto Nacional de Innovación Agraria - INIA'), 'INSTITUTO NACIONAL DE INNOVACION AGRARIA INIA');
  });

  it('monto en soles: cambio del propio proceso; si no, el aproximado', () => {
    assert.equal(peAmountInPen({ amount: 100, currency: 'PEN' }, null), 100);
    assert.equal(peAmountInPen({ amount: 100, currency: 'USD' }, { amount: 200, currency: 'USD', amount_PEN: 740 }), 370);
    assert.equal(peAmountInPen({ amount: 100, currency: 'USD' }, null), 340);
    assert.equal(peAmountInPen({ amount: 100, currency: 'JPY' }, null), 0);
  });
});

describe('Perú — lector OCDS', () => {
  it('ventana por fecha de firma, sólo empresas, sin las que también compran; la versión más nueva manda', async () => {
    const dir = writeGzFiles({ [FILE]: [OLD, SECURITY, MIXED, PROMPERU_AS_BUYER] });
    const lines = await readWindow(PE_LOADER, dir, END, 12);
    assert.deepEqual([...new Set(lines.map((l) => l.supplierTaxId))].sort(), ['20512831983', '20601319676']);
    const gz = lines.filter((l) => l.supplierTaxId === '20601319676');
    assert.equal(gz.length, 1, 'dos ítems de la misma familia ⇒ una línea');
    assert.deepEqual(
      { ...gz[0] },
      {
        buyerCode: 'PE-CONSUCODE-1972',
        buyerName: 'INSTITUTO NACIONAL DE INNOVACION AGRARIA - INIA',
        buyerTaxId: '20131365994',
        supplierTaxId: '20601319676',
        supplierName: 'GZ PERU S.A.',
        amount: 5_639_136,
        orderCode: '2419657',
        orderUrl: 'https://prod4.seace.gob.pe:9000/api/con/documentos/descargar/153177015',
        date: '2026-08-10',
        classificationKey: '9210',
      },
    );
    assert.equal(lines.find((l) => l.supplierTaxId === '20512831983')?.amount, 70_000, 'USD con el cambio del proceso');
  });

  it('sin files() primero, el lector se niega (no sabe la ventana)', async () => {
    const { createOcdsWindowLoader } = await import('../ocds-window');
    const loader = createOcdsWindowLoader({ country: PE_COUNTRY, files: () => [], readRelease: () => null });
    await assert.rejects(loader.readLines('/no/existe.gz', () => undefined), /ocds_window_unset/);
  });
});

describe('Perú — paso de punta a punta (dobles)', () => {
  it('INIA × Servicios: GZ PERU con web y trabajadores de SUNAT, prueba = contrato en SEACE', async () => {
    const dir = writeGzFiles({ [FILE]: [SECURITY, MIXED, PROMPERU_AS_BUYER] });
    const rows = aggregate(PE_LOADER, await readWindow(PE_LOADER, dir, END, 12), ocdsWindow(END, 12));
    assert.equal(rows.length, 2);
    const client = fakeClient({
      public_procurement_supplier_links: rows,
      source_company_snapshots: [
        { tax_id: '20601319676', normalized_tax_id: '20601319676', source_key: 'pe_sunat_directory', raw_data: { website_domain: 'gz-peru.pe', workers: 1450, metrics_year: 2026 } },
      ],
    });
    const written: string[] = [];
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'Instituto Nacional de Innovación Agraria', countryCode: 'PE', macroIndustryKey: 'services_company', nowIso: '2026-10-15T00:00:00Z' },
      {
        ...buildLoadedLinksLookups(PE_COUNTRY, client),
        writeWithWebsite: async (companies) => (written.push(...companies.map((c) => `${c.taxId}|${c.domain}|${c.taxIdentifierType}`)), { written: companies.length, failed: false }),
        recordWithoutWebsite: async () => 0,
      },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.matchedBy, 'prefix');
    assert.equal(outcome.sourceKey, 'pe_oece_contracts');
    assert.deepEqual(written, ['20601319676|gz-peru.pe|RUC']);
    assert.equal(outcome.outsideIndustry, 1, 'el de software no es de Servicios');
    assert.match(outcome.relationships[0].evidence, /\(seguridad y vigilancia\) con Instituto Nacional de Innovación Agraria en compras públicas desde 2025/);
    assert.equal(outcome.relationships[0].evidenceUrl, 'https://prod4.seace.gob.pe:9000/api/con/documentos/descargar/153177015');
  });
});
