/**
 * Tests — Paraguay en «Proveedores de una empresa» (DNCP, ZIP masivo de adjudicaciones):
 * RUC de empresa, unión de los CSV (comprador, adjudicación, proveedor, ítems, documento),
 * UNSPSC desde el catálogo DNCP de nivel 5 y el paso de punta a punta con dobles.
 * Filas reales recortadas de `awa-masivo.zip` 2026 (MSPBS × QUIMFA, fórmulas enterales).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runPublicBuyerSupplierStep } from '../../public-buyer-suppliers';
import { buildLoadedLinksLookups } from '../loaded-lookups.server';
import { ocdsWindow } from '../ocds-window';
import { pyCompanySupplier, PY_COUNTRY } from '../py';
import { pyFiles, PY_LOADER } from '../py.loader';
import { aggregate, fakeClient, readWindow } from './ocds-test-helpers';

const REL = '438044-lpn-n-08-2024-adquisicion-formulas-nutricionales-enterales-mspybs-1-1772110657.154704';
const AW = '438044-quimfa-s-a-14';
const AW2 = '438044-maria-gonzalez-15';
const P = 'compiledRelease/';
const A = `${P}awards/0/`;

function csv(header: string[], rows: string[][]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

/** Escribe el zip anual con los cinco CSV que usa el lector (con `zip` del sistema). */
function writeAwardsZip(dir: string, name: string): void {
  const files: Record<string, string> = {
    'records.csv': csv(
      [`${P}id`, `${P}buyer/id`, `${P}buyer/name`],
      [[REL, 'DNCP-SICP-CODE-306', 'Ministerio de Salud Pública y Bienestar Social (MSPBS)']],
    ),
    'awards.csv': csv(
      [`${P}id`, `${A}id`, `${A}status`, `${A}date`, `${A}value/amount`, `${A}value/currency`],
      [
        [REL, AW, 'active', '2024-11-01T12:00:00-04:00', '3538200000', 'PYG'],
        [REL, AW2, 'active', '2024-11-01T12:00:00-04:00', '900000000', 'PYG'],
        [REL, 'cancelada', 'cancelled', '2024-11-01T12:00:00-04:00', '900000000', 'PYG'],
      ],
    ),
    'awa_suppliers.csv': csv(
      [`${P}id`, `${A}id`, `${A}suppliers/0/id`, `${A}suppliers/0/name`],
      [
        [REL, AW, 'PY-RUC-80074991-0', 'QUIMFA S.A.'],
        [REL, AW2, 'PY-RUC-1234567-8', 'MARIA GONZALEZ'],
      ],
    ),
    'awa_items.csv': csv(
      [`${P}id`, `${A}id`, `${A}items/0/classification/id`, `${A}items/0/quantity`, `${A}items/0/unit/value/amount`],
      [
        [REL, AW, '42231803-002', '2160000', '311'],
        [REL, AW, '42231806-024', '2040000', '1079'],
        [REL, AW, '42231806-007', '2160000', '308'],
      ],
    ),
    'awa_documents.csv': csv(
      [`${P}id`, `${A}id`, `${A}documents/0/url`],
      [[REL, AW, 'https://www.contrataciones.gov.py/documentos/download/adjudicacion/%252BzYyF3hcP2U%253D']],
    ),
  };
  const src = mkdtempSync(join(tmpdir(), 'py-csv-'));
  for (const [file, text] of Object.entries(files)) writeFileSync(join(src, file), text);
  execFileSync('zip', ['-q', '-j', join(dir, name), ...Object.keys(files).map((f) => join(src, f))]);
}

// Ventana de dos meses (nov–dic 2024): un solo zip anual.
const END = { year: 2024, month: 12 };
const MONTHS = 2;

describe('Paraguay — reglas', () => {
  it('RUC de empresa (≥ 80.000.000 con DV), sin consorcios ni entidades', () => {
    assert.deepEqual(pyCompanySupplier('PY-RUC-80074991-0', 'QUIMFA S.A.'), { ruc: '80074991-0', name: 'QUIMFA S.A.' });
    assert.equal(pyCompanySupplier('PY-RUC-1234567-8', 'MARIA GONZALEZ'), null, 'persona física');
    assert.equal(pyCompanySupplier('PY-RUC-80099999-1', 'CONSORCIO DYSA/CASA BOLLER S.A.'), null);
    assert.equal(pyCompanySupplier('PY-RUC-80099999-1', 'Administración Nacional de Electricidad (ANDE)'), null);
    assert.equal(pyCompanySupplier('trafigura-pte-ltd', 'TRAFIGURA PTE LTD'), null, 'extranjera sin RUC');
  });

  it('archivos: años de la ventana; el del mes final lleva el mes', () => {
    assert.deepEqual(pyFiles({ year: 2026, month: 9 }, 12).map((f) => f.name), ['py-awa-2025.zip', 'py-awa-2026-hasta-9.zip']);
  });
});

describe('Paraguay — lector del ZIP masivo', () => {
  it('une los CSV: monto de la adjudicación repartido por UNSPSC de sus ítems; personas y canceladas fuera', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'py-zip-'));
    writeAwardsZip(dir, 'py-awa-2024-hasta-12.zip');
    const lines = await readWindow(PY_LOADER, dir, END, MONTHS);
    assert.deepEqual([...new Set(lines.map((l) => l.supplierTaxId))], ['80074991-0']);
    assert.equal(Math.round(lines.reduce((s, l) => s + l.amount, 0)), 3_538_200_000);
    assert.deepEqual(lines.map((l) => l.classificationKey), ['4223']);
    assert.equal(lines[0].buyerCode, 'DNCP-SICP-CODE-306');
    assert.equal(lines[0].date, '2024-11-01');
    assert.equal(lines[0].orderUrl, 'https://www.contrataciones.gov.py/documentos/download/adjudicacion/%252BzYyF3hcP2U%253D');
  });
});

describe('Paraguay — paso de punta a punta (dobles)', () => {
  it('«Ministerio de Salud» × Salud: QUIMFA con web del directorio DNCP', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'py-zip-'));
    writeAwardsZip(dir, 'py-awa-2024-hasta-12.zip');
    const rows = aggregate(PY_LOADER, await readWindow(PY_LOADER, dir, END, MONTHS), ocdsWindow(END, MONTHS));
    const client = fakeClient({
      public_procurement_supplier_links: rows,
      source_company_snapshots: [{ tax_id: '80074991-0', normalized_tax_id: '80074991-0', source_key: 'py_dncp_directory', raw_data: { website_domain: 'quimfa.com.py' } }],
    });
    const written: string[] = [];
    const outcome = await runPublicBuyerSupplierStep(
      { batchId: 'b1', referenceCompanyName: 'Ministerio de Salud', countryCode: 'PY', macroIndustryKey: 'health_pharma', nowIso: '2025-11-15T00:00:00Z' },
      {
        ...buildLoadedLinksLookups(PY_COUNTRY, client),
        writeWithWebsite: async (companies) => (written.push(...companies.map((c) => `${c.taxId}|${c.domain}|${c.taxIdentifierType}`)), { written: companies.length, failed: false }),
        recordWithoutWebsite: async () => 0,
      },
    );
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.taxId, 'DNCP-SICP-CODE-306');
    assert.equal(outcome.buyer.matchedBy, 'prefix');
    assert.deepEqual(written, ['80074991-0|quimfa.com.py|RUC']);
  });
});
