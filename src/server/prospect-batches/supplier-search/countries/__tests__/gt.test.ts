/**
 * Tests — Guatemala en «Proveedores de una empresa» (Guatecompras, OCDS): NIT con dígito
 * verificador, personas/copropiedades fuera, la regla del doble conteo (la misma
 * adjudicación repetida por dueño), contrato > adjudicación, UNSPSC del proceso y el paso
 * de punta a punta. Versiones recortadas de la publicación 142 del OCP Data Registry.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runPublicBuyerSupplierStep } from '../../public-buyer-suppliers';
import { gtCompanySupplier, GT_COUNTRY } from '../gt';
import { gtFiles, gtProcessUrl, GT_LOADER } from '../gt.loader';
import { buildLoadedLinksLookups } from '../loaded-lookups.server';
import { ocdsWindow } from '../ocds-window';
import { aggregate, fakeClient, readWindow, writeGzFiles } from './ocds-test-helpers';

const OJ_PARTY = {
  id: 'GT-CISP-11120002',
  name: 'ORGANISMO JUDICIAL',
  roles: ['buyer'],
  details: { entityType: { id: '4', description: 'Administración Central' } },
};

/** Real (recortado, 2020): el Organismo Judicial adjudica un equipo a SISTEMAS APLICATIVOS. */
const CONVERGENT = {
  ocid: 'ocds-xqjsxa-12935913',
  buyer: { id: 'GT-NIT-3377725', name: 'ORGANISMO JUDICIAL' },
  parties: [OJ_PARTY],
  tender: { id: 'GT-NOG-12935913', items: [{ classification: { id: '86141703', scheme: 'UNSPSC' } }] },
  awards: [
    {
      id: 'GT-ADJ-12935913-12513687',
      date: '2020-09-29T12:48:04-06:00',
      title: 'COTIZACIÓN 28-2020 «ADQUISICIÓN DE 1 EQUIPO DE SOLUCIÓN CONVERGENTE»',
      value: { amount: 452_427, currency: 'GTQ' },
      status: 'active',
      suppliers: [{ id: 'GT-NIT-12513687', name: 'SISTEMAS APLICATIVOS, SOCIEDAD ANONIMA' }],
    },
  ],
  contracts: [{ id: 'NOG-12935913-CON-F467', awardID: 'GT-ADJ-12935913-12513687', value: { amount: 400_000, currency: 'GTQ' } }],
};

/**
 * Doble conteo (forma real de los arrendamientos de la PNC, NOG 24992704: una adjudicación
 * por copropietario con el monto completo repetido), aquí con dos sociedades.
 */
const REPEATED = {
  ocid: 'ocds-xqjsxa-24992704',
  buyer: { id: 'GT-NIT-3377725', name: 'ORGANISMO JUDICIAL' },
  parties: [OJ_PARTY],
  tender: { id: 'GT-NOG-24992704', items: [{ classification: { id: '80131502', scheme: 'UNSPSC' } }] },
  awards: ['7477279', '735442', '28869222'].map((nit, i) => ({
    id: `GT-ADJ-24992704-${nit}`,
    date: '2020-12-10T14:16:28-06:00',
    title: 'ARRENDAMIENTO DE BIEN INMUEBLE',
    value: { amount: 144_000, currency: 'GTQ' },
    status: 'active',
    suppliers: [{ id: `GT-NIT-${nit}`, name: ['AGENCIA FARMACEUTICA INTERNACIONAL SOCIEDAD ANONIMA', 'CENTRO DISTRIBUIDOR SOCIEDAD ANONIMA', 'MORÁN,MOREIRA,,ABNER,DAVID'][i] }],
  })),
};

/** El IGSS (NIT 2342855) también aparece como proveedor de otra entidad: fuera. */
const PUBLIC_SUPPLIER = {
  ocid: 'ocds-xqjsxa-1',
  buyer: { id: 'GT-NIT-2342855', name: 'INSTITUTO GUATEMALTECO DE SEGURIDAD SOCIAL -IGSS-' },
  parties: [],
  tender: { id: 'GT-NOG-1', items: [] },
  awards: [],
};
const BUYS_FROM_IGSS = {
  ocid: 'ocds-xqjsxa-2',
  buyer: { id: 'GT-NIT-3377725', name: 'ORGANISMO JUDICIAL' },
  parties: [OJ_PARTY],
  tender: { id: 'GT-NOG-2', items: [{ classification: { id: '84131600', scheme: 'UNSPSC' } }] },
  awards: [{ id: 'X', date: '2020-11-01T00:00:00-06:00', status: 'active', value: { amount: 900_000 }, suppliers: [{ id: 'GT-NIT-2342855', name: 'SEGUROS DEL IGSS SA' }] }],
};

const END = { year: 2020, month: 12 };

describe('Guatemala — reglas', () => {
  it('empresa: NIT válido y nombre que no es de persona, copropiedad ni entidad', () => {
    assert.deepEqual(gtCompanySupplier('GT-NIT-12513687', 'SISTEMAS APLICATIVOS, SOCIEDAD ANONIMA'), { nit: '12513687', name: 'SISTEMAS APLICATIVOS, SOCIEDAD ANONIMA' });
    assert.equal(gtCompanySupplier('GT-NIT-12513688', 'SISTEMAS APLICATIVOS, SOCIEDAD ANONIMA'), null, 'dígito verificador malo');
    assert.equal(gtCompanySupplier('GT-NIT-28869222', 'MORÁN,MOREIRA,,ABNER,DAVID'), null);
    assert.equal(gtCompanySupplier('GT-NIT-12513687', 'CONSTRUCTORA IZABAL - COPROPIEDAD'), null);
    assert.equal(gtCompanySupplier('GT-NIT-12513687', 'MUNICIPALIDAD DE MIXCO'), null);
  });

  it('archivos y página del proceso por NOG', () => {
    assert.deepEqual(gtFiles({ year: 2026, month: 9 }, 12).map((f) => f.name), ['gt-2025.jsonl.gz', 'gt-2026-hasta-9.jsonl.gz']);
    assert.equal(gtProcessUrl('GT-NOG-12935913'), 'https://www.guatecompras.gt/concursos/consultaConcurso.aspx?nog=12935913');
    assert.equal(gtProcessUrl('X'), null);
  });
});

describe('Guatemala — lector OCDS', () => {
  it('contrato > adjudicación; la adjudicación repetida por dueño se reparte; entidades fuera', async () => {
    const dir = writeGzFiles({ 'gt-2020-hasta-12.jsonl.gz': [CONVERGENT, REPEATED, PUBLIC_SUPPLIER, BUYS_FROM_IGSS] });
    const lines = await readWindow(GT_LOADER, dir, END, 12);
    const byNit = Object.fromEntries(lines.map((l) => [l.supplierTaxId, l]));
    assert.deepEqual(Object.keys(byNit).sort(), ['12513687', '735442', '7477279']);
    assert.equal(byNit['12513687'].amount, 400_000, 'valor del contrato');
    assert.equal(byNit['12513687'].classificationKey, '8614');
    assert.equal(byNit['12513687'].buyerTaxId, '3377725');
    assert.equal(byNit['12513687'].buyerSector, 'Administración Central');
    assert.equal(byNit['7477279'].amount, 48_000, '144.000 repetido tres veces ⇒ un tercio');
    assert.equal(byNit['735442'].amount, 48_000);
  });
});

/** Real (recortado, 2026): el Ministerio Público le compra computadoras a SERVICOMP. */
const COMPUTERS = {
  ocid: 'ocds-xqjsxa-27522199',
  buyer: { id: 'GT-NIT-7522517', name: 'MINISTERIO PÚBLICO' },
  parties: [{ id: 'GT-CISP-11140022', name: 'MINISTERIO PÚBLICO', roles: ['buyer'], details: { entityType: { id: '4', description: 'Administración Central' } } }],
  tender: { id: 'GT-NOG-27522199', items: [{ classification: { id: '43211508', scheme: 'UNSPSC' } }, { classification: { id: '43211507', scheme: 'UNSPSC' } }] },
  awards: [
    {
      id: 'GT-ADJ-27522199-37391917',
      date: '2026-03-17T10:16:13-06:00',
      title: 'ADQUISICIÓN DE COMPUTADORAS PARA USO DEL MINISTERIO PÚBLICO, MP-L-16-2025',
      value: { amount: 2_396_395, currency: 'GTQ' },
      status: 'active',
      suppliers: [{ id: 'GT-NIT-37391917', name: 'SERVICOMP DE GUATEMALA SOCIEDAD ANONIMA' }],
    },
  ],
  contracts: [{ id: 'NOG-27522199-CON-E7B0', awardID: 'GT-ADJ-27522199-37391917', value: { amount: 2_396_395, currency: 'GTQ' } }],
};

describe('Guatemala — paso de punta a punta (dobles)', () => {
  it('Ministerio Público × Tecnología: SERVICOMP con web del directorio y el NOG como prueba', async () => {
    const end = { year: 2026, month: 9 };
    const dir = writeGzFiles({ 'gt-2025.jsonl.gz': [], 'gt-2026-hasta-9.jsonl.gz': [COMPUTERS] });
    const rows = aggregate(GT_LOADER, await readWindow(GT_LOADER, dir, end, 12), ocdsWindow(end, 12));
    assert.deepEqual(rows.map((r) => [r.buyer_code, r.supplier_tax_id, r.total_amount]), [['7522517', '37391917', 2_396_395]]);
    const client = fakeClient({
      public_procurement_supplier_links: rows,
      source_company_snapshots: [{ tax_id: '37391917', normalized_tax_id: '37391917', source_key: 'gt_guatecompras_directory', raw_data: { website_domain: 'servicomp.com.gt' } }],
    });
    const written: string[] = [];
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'Ministerio Público', countryCode: 'GT', macroIndustryKey: 'technology', nowIso: '2026-10-15T00:00:00Z' },
      {
        ...buildLoadedLinksLookups(GT_COUNTRY, client),
        writeWithWebsite: async (companies) => (written.push(...companies.map((c) => `${c.taxId}|${c.domain}|${c.taxIdentifierType}`)), { written: companies.length, failed: false }),
        recordWithoutWebsite: async () => 0,
      },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.matchedBy, 'exact');
    assert.deepEqual(written, ['37391917|servicomp.com.gt|NIT']);
    assert.equal(outcome.relationships[0].evidenceUrl, 'https://www.guatecompras.gt/concursos/consultaConcurso.aspx?nog=27522199');
  });

  it('las copias repartidas de una adjudicación pueden quedar bajo el piso', async () => {
    const dir = writeGzFiles({ 'gt-2020-hasta-12.jsonl.gz': [CONVERGENT, REPEATED] });
    const rows = aggregate(GT_LOADER, await readWindow(GT_LOADER, dir, END, 12), ocdsWindow(END, 12));
    assert.deepEqual(rows.map((r) => r.supplier_tax_id), ['12513687'], '48.000 < piso de 77.000; sin repartir habrían entrado con 144.000');
  });
});
