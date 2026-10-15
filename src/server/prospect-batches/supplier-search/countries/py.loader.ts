/**
 * Paraguay — lector del ZIP masivo de adjudicaciones de la DNCP (OCDS aplanado en CSV)
 * para el cargador genérico (`scripts/source-catalog/run-public-procurement-load.ts --country PY`).
 *
 * Fuente: `https://www.contrataciones.gov.py/images/opendata-v3/final/ocds/<año>/awa-masivo.zip`
 * (61–82 MB/año, sin token, actualizado a diario). Se leen los años que toca la ventana;
 * el del mes `end` lleva el mes en el nombre para que cada refresco lo baje de nuevo.
 *
 * Cinco CSV del zip unidos por versión (`compiledRelease/id`) y adjudicación:
 *  - `records.csv`: comprador (código SICP de la unidad de contratación y su nombre);
 *  - `awards.csv`: adjudicaciones `active` con fecha en la ventana, monto y moneda;
 *  - `awa_suppliers.csv`: proveedor (RUC de empresa, sin consorcios ni entidades);
 *  - `awa_items.csv`: ítems adjudicados (catálogo DNCP de nivel 5 «72131701-023», cuyos
 *    8 primeros dígitos son el UNSPSC) con cantidad × precio para repartir el monto;
 *  - `awa_documents.csv`: el primer documento de la adjudicación como prueba.
 * Si una adjudicación sale en dos años, manda el archivo más nuevo.
 * Cautela (Fase 0): el monto puede ser el techo de un contrato marco, no gasto real.
 */

import { basename } from 'node:path';
import { httpsUrl, type ProcurementLine } from '../procurement-links';
import { unspscFamily } from '../unspsc-classifier';
import { monthsBack, readZipCsv } from './loader-io';
import { dateInWindow, ocdsWindow, splitByFamily, type OcdsWindow } from './ocds-window';
import { pyCompanySupplier, PY_COUNTRY } from './py';
import type { ProcurementLoaderSource } from './types';

export const PY_DNCP_AWARDS_URL = (year: number) => `https://www.contrataciones.gov.py/images/opendata-v3/final/ocds/${year}/awa-masivo.zip`;

/** Guaraníes por unidad cuando la adjudicación no viene en PYG (sólo para el piso). */
const PYG_PER_UNIT: Readonly<Record<string, number>> = { PYG: 1, USD: 7_800 };

const P = 'compiledRelease/';
const A = `${P}awards/0/`;
const CSV = { encoding: 'utf-8' as const, delimiter: ',' };

function num(raw: string | undefined): number {
  const n = Number((raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

type AwardState = {
  buyerCode: string;
  buyerName: string;
  date: string;
  amount: number;
  orderCode: string;
  suppliers: Array<{ ruc: string; name: string }>;
  allSuppliers: number;
  weights: Array<{ family: string | null; weight: number }>;
  url: string | null;
};

/** Lee un zip anual y devuelve sus adjudicaciones de la ventana (clave = id de adjudicación). */
export async function readPyAwardsZip(file: string, window: OcdsWindow): Promise<Map<string, AwardState>> {
  const buyers = new Map<string, { code: string; name: string }>();
  await readZipCsv(file, { ...CSV, entry: 'records.csv' }, (r) => {
    const code = (r[`${P}buyer/id`] || r[`${P}tender/procuringEntity/id`] || '').trim();
    const name = (r[`${P}buyer/name`] || r[`${P}tender/procuringEntity/name`] || '').trim();
    if (code && name) buyers.set(r[`${P}id`], { code, name });
  });

  const awards = new Map<string, AwardState>();
  const key = (r: Record<string, string>) => `${r[`${P}id`]}|${r[`${A}id`]}`;
  await readZipCsv(file, { ...CSV, entry: 'awards.csv' }, (r) => {
    if ((r[`${A}status`] ?? '').trim() !== 'active') return;
    const date = dateInWindow(r[`${A}date`], window);
    const buyer = buyers.get(r[`${P}id`]);
    const rate = PYG_PER_UNIT[(r[`${A}value/currency`] || 'PYG').trim().toUpperCase()];
    if (!date || !buyer || !rate) return;
    awards.set(key(r), {
      buyerCode: buyer.code,
      buyerName: buyer.name,
      date,
      amount: num(r[`${A}value/amount`]) * rate,
      orderCode: r[`${A}id`].trim(),
      suppliers: [],
      allSuppliers: 0,
      weights: [],
      url: null,
    });
  });
  await readZipCsv(file, { ...CSV, entry: 'awa_suppliers.csv' }, (r) => {
    const award = awards.get(key(r));
    if (!award) return;
    award.allSuppliers += 1;
    const supplier = pyCompanySupplier(r[`${A}suppliers/0/id`], r[`${A}suppliers/0/name`]);
    if (supplier && !award.suppliers.some((s) => s.ruc === supplier.ruc)) award.suppliers.push(supplier);
  });
  await readZipCsv(file, { ...CSV, entry: 'awa_items.csv' }, (r) => {
    const award = awards.get(key(r));
    if (!award) return;
    const family = unspscFamily((r[`${A}items/0/classification/id`] ?? '').slice(0, 8));
    award.weights.push({ family, weight: num(r[`${A}items/0/quantity`]) * num(r[`${A}items/0/unit/value/amount`]) });
  });
  await readZipCsv(file, { ...CSV, entry: 'awa_documents.csv' }, (r) => {
    const award = awards.get(key(r));
    if (award && !award.url) award.url = httpsUrl(r[`${A}documents/0/url`]);
  });

  const byAward = new Map<string, AwardState>();
  for (const award of awards.values()) if (award.suppliers.length > 0) byAward.set(award.orderCode, award);
  return byAward;
}

export function pyAwardLines(award: AwardState): ProcurementLine[] {
  const parts = splitByFamily(award.amount / Math.max(1, award.allSuppliers), award.weights);
  return award.suppliers.flatMap((supplier) =>
    parts.map((part) => ({
      buyerCode: award.buyerCode,
      buyerName: award.buyerName,
      buyerTaxId: null,
      supplierTaxId: supplier.ruc,
      supplierName: supplier.name,
      amount: part.amount,
      orderCode: award.orderCode,
      orderUrl: award.url,
      date: award.date,
      classificationKey: part.family,
    })),
  );
}

/** Años que toca la ventana; el último lleva el mes (`py-awa-2026-hasta-9.zip`). */
export function pyFiles(end: { year: number; month: number }, months: number): Array<{ url: string; name: string }> {
  const years = [...new Set(monthsBack(end, months).map((m) => m.year))];
  return years.map((year) => ({
    url: PY_DNCP_AWARDS_URL(year),
    name: year === end.year ? `py-awa-${year}-hasta-${end.month}.zip` : `py-awa-${year}.zip`,
  }));
}

function createPyLoader(): ProcurementLoaderSource {
  let window: OcdsWindow | null = null;
  let lastFile: string | null = null;
  let pending = new Map<string, AwardState>();
  return {
    country: PY_COUNTRY,
    files: (end, months) => {
      const list = pyFiles(end, months);
      window = ocdsWindow(end, months);
      lastFile = list.at(-1)?.name ?? null;
      pending = new Map();
      return list;
    },
    readLines: async (filePath, onLine) => {
      if (!window || !lastFile) throw new Error('py_window_unset: llama a files() antes de readLines()');
      for (const [id, award] of await readPyAwardsZip(filePath, window)) pending.set(id, award);
      if (basename(filePath) !== lastFile) return;
      for (const award of pending.values()) for (const line of pyAwardLines(award)) onLine(line);
      pending = new Map();
    },
  };
}

export const PY_LOADER = createPyLoader();
