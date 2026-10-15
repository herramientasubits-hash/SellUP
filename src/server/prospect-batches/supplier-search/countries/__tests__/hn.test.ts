/**
 * Tests — Honduras en «Proveedores de una empresa» (ONCAE/HonduCompras, OCDS): RTN
 * jurídico, institución por `memberOf`, nombre del comprador, monto (contrato >
 * adjudicación > ítems), versión más nueva entre años y el paso de punta a punta.
 * Versiones recortadas de la publicación 122 del OCP Data Registry (2026).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runPublicBuyerSupplierStep } from '../../public-buyer-suppliers';
import { hnCompanySupplier, HN_COUNTRY, normalizeHnBuyerName } from '../hn';
import { hnFiles, hnInstitution, HN_LOADER } from '../hn.loader';
import { buildLoadedLinksLookups } from '../loaded-lookups.server';
import { ocdsWindow } from '../ocds-window';
import { aggregate, fakeClient, readWindow, writeGzFiles } from './ocds-test-helpers';

const END = { year: 2026, month: 9 };

const SESAL_PARTIES = [
  { id: 'mrYzL9', name: 'Secretaria de Estado en el Despacho de Salud Pública (SESAL)', roles: ['buyer'] },
  { id: 'WRzd0L-mrYzL9', name: 'Hospital San Lorenzo', roles: ['buyer'], memberOf: [{ id: 'mrYzL9', name: 'Secretaria de Estado en el Despacho de Salud Pública (SESAL)' }] },
];

/** Real (recortado): el Hospital San Lorenzo (SESAL) le compra químicos a INVERSIONES JBM SUPPLY. */
const HOSPITAL = {
  ocid: 'ocds-lcuori-WRzd0L-UE-028-2026-1',
  date: '2026-05-03T23:11:12.890000-06:00',
  buyer: { id: 'WRzd0L-mrYzL9', name: 'Hospital San Lorenzo' },
  parties: SESAL_PARTIES,
  awards: [
    {
      id: 'WRzd0L-UE-028-2026-1',
      suppliers: [{ id: 'HN-RTN-17099025179707', name: 'INVERSIONES JBM SUPPLY S. DE R.L DE C.V *CM' }],
      items: [
        { quantity: 1, unit: { value: { amount: 449_506.96 } }, classification: { id: '12352104', scheme: 'UNSPSC' } },
        { quantity: 1, unit: { value: { amount: 0 } }, classification: { id: '12352104', scheme: 'UNSPSC' } },
      ],
    },
  ],
  contracts: [
    {
      id: 'WRzd0L-UE-037-2026',
      awardID: 'WRzd0L-UE-028-2026-1',
      value: { amount: 449_506.96, currency: 'HNL' },
      dateSigned: '2026-05-28T00:00:00-06:00',
      documents: [{ url: 'http://h1.honducompras.gob.hn/Docs/Con110UE-037-20261200-ContratouOrdendeCompra.pdf', documentType: 'contractSigned' }],
    },
  ],
};

/** Sin contrato ni valor: monto = cantidad × precio de los ítems; persona natural fuera. */
const BY_ITEMS = {
  ocid: 'ocds-lcuori-0rw29R-CM-SDE-133-2026-1',
  date: '2026-08-12T09:08:17.440000-06:00',
  buyer: { id: 'WRzd0L-mrYzL9', name: 'Hospital San Lorenzo' },
  parties: SESAL_PARTIES,
  awards: [
    {
      id: 'A1',
      suppliers: [{ id: 'HN-RTN-08019005005053', name: 'AUTOSERVICIOS SAN IGNACIO S. DE R.L.' }],
      items: [
        { quantity: 10, unit: { value: { amount: 20_000 } }, classification: { id: '25171718', scheme: 'UNSPSC' } },
        { quantity: 2, unit: { value: { amount: 50_000 } }, classification: { id: '42131600', scheme: 'UNSPSC' } },
      ],
    },
    { id: 'A2', suppliers: [{ id: 'HN-RTN-08011972078434', name: 'NELSON ALBERTO, CRUZ GODOY (REPRESENTACIONES NC)' }], items: [] },
  ],
};

describe('Honduras — reglas', () => {
  it('RTN jurídico (5.º dígito 9); fuera personas, consorcios y entidades del Estado', () => {
    assert.deepEqual(hnCompanySupplier('HN-RTN-17099025179707', 'INVERSIONES JBM SUPPLY S. DE R.L DE C.V *CM'), { rtn: '17099025179707', name: 'INVERSIONES JBM SUPPLY S. DE R.L DE C.V' });
    assert.equal(hnCompanySupplier('HN-RTN-08011972078434', 'NELSON ALBERTO, CRUZ GODOY'), null);
    assert.equal(hnCompanySupplier('HN-RTN-08019999000001', 'CONSORCIO VIAL NORTE'), null);
    assert.equal(hnCompanySupplier('HN-RTN-08019995000001', 'Empresa Nacional de Energía Eléctrica (ENEE)'), null);
  });

  it('comprador: «Secretaría de Salud» reconoce a SESAL por el comienzo', () => {
    const stored = normalizeHnBuyerName('Secretaria de Estado en el Despacho de Salud Pública (SESAL)');
    assert.equal(stored, 'SECRETARIA SALUD PUBLICA');
    assert.ok(stored.startsWith(`${normalizeHnBuyerName('Secretaría de Salud')} `));
    assert.equal(normalizeHnBuyerName('Municipalidad de Omoa, Cortés'), 'ALCALDIA OMOA');
  });

  it('institución: se sube por memberOf desde la unidad ejecutora', () => {
    assert.deepEqual(hnInstitution(SESAL_PARTIES, 'WRzd0L-mrYzL9'), { code: 'mrYzL9', name: 'Secretaria de Estado en el Despacho de Salud Pública (SESAL)' });
    const nested = [
      { id: 'yjZGgy', name: 'Aguas de Choloma SA de CV' },
      { id: 'yjZGgy-byP1K8', name: 'Gerencia Central', memberOf: [{ id: 'yjZGgy' }] },
      { id: 'yjZGgy-byP1K8-byP1K8', name: 'Gerencia Administrativa', memberOf: [{ id: 'yjZGgy-byP1K8' }] },
    ];
    assert.equal(hnInstitution(nested, 'yjZGgy-byP1K8-byP1K8')?.name, 'Aguas de Choloma SA de CV');
  });

  it('archivos: años de la ventana; el del mes final lleva el mes', () => {
    assert.deepEqual(hnFiles(END, 12).map((f) => f.name), ['hn-2025.jsonl.gz', 'hn-2026-hasta-9.jsonl.gz']);
  });
});

describe('Honduras — lector OCDS', () => {
  it('monto del contrato o de los ítems, UNSPSC por ítem, la versión más nueva manda', async () => {
    const stale = { ...HOSPITAL, contracts: [{ ...HOSPITAL.contracts[0], value: { amount: 1, currency: 'HNL' } }] };
    const dir = writeGzFiles({ 'hn-2025.jsonl.gz': [stale], 'hn-2026-hasta-9.jsonl.gz': [HOSPITAL, BY_ITEMS] });
    const lines = await readWindow(HN_LOADER, dir, END, 12);
    const jbm = lines.filter((l) => l.supplierTaxId === '17099025179707');
    assert.equal(jbm.length, 1);
    assert.equal(Math.round(jbm[0].amount), 449_507, 'la versión de 2026, no la de 2025');
    assert.equal(jbm[0].buyerCode, 'mrYzL9');
    assert.equal(jbm[0].date, '2026-05-28');
    assert.equal(jbm[0].classificationKey, '1235');
    assert.equal(jbm[0].orderUrl, 'https://h1.honducompras.gob.hn/Docs/Con110UE-037-20261200-ContratouOrdendeCompra.pdf');
    const byItems = lines.filter((l) => l.supplierTaxId === '08019005005053').map((l) => [l.classificationKey, l.amount, l.date]);
    assert.deepEqual(byItems, [['2517', 200_000, '2026-08-12'], ['4213', 100_000, '2026-08-12']]);
    assert.equal(lines.some((l) => l.supplierTaxId === '08011972078434'), false, 'persona natural fuera');
  });
});

describe('Honduras — paso de punta a punta (dobles)', () => {
  it('Secretaría de Salud × Industria: JBM sin web va a Descartadas con su RTN', async () => {
    const dir = writeGzFiles({ 'hn-2025.jsonl.gz': [], 'hn-2026-hasta-9.jsonl.gz': [HOSPITAL, BY_ITEMS] });
    const rows = aggregate(HN_LOADER, await readWindow(HN_LOADER, dir, END, 12), ocdsWindow(END, 12));
    assert.deepEqual(rows.map((r) => r.supplier_tax_id), ['17099025179707', '08019005005053']);
    const recorded: string[] = [];
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'Secretaría de Salud', countryCode: 'HN', macroIndustryKey: 'industry_manufacturing_chemicals_automotive', nowIso: '2026-10-15T00:00:00Z' },
      {
        ...buildLoadedLinksLookups(HN_COUNTRY, fakeClient({ public_procurement_supplier_links: rows })),
        writeWithWebsite: async () => ({ written: 0, failed: false }),
        recordWithoutWebsite: async (companies) => (recorded.push(...companies.map((c) => `${c.taxId}|${c.taxIdentifierType}`)), companies.length),
      },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.taxId, 'mrYzL9');
    assert.deepEqual(recorded, ['17099025179707|RTN']);
    assert.equal(outcome.outsideIndustry, 1);
  });
});
