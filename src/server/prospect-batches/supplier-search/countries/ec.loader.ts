/**
 * Ecuador — lector de SERCOP Datos Abiertos (OCDS en CSV) para el cargador genérico
 * (`scripts/source-catalog/run-public-procurement-load.ts --country EC`).
 *
 * SERCOP publica UN zip por año de proceso (`releases`, `awards`, `suppliers`… en CSV)
 * y un proceso de un año puede adjudicarse en el siguiente. Por eso se bajan los años
 * que toca la ventana y cada adjudicación se filtra por su fecha: la ventana va en el
 * nombre del archivo (`ec-2025-2025-10_2026-09.zip`), así el año en curso se vuelve a
 * bajar en cada recarga (el archivo crece cada día).
 *
 * Reglas:
 *  - Comprador = RUC de `releases.buyer_id` (sin sufijo); proveedor = RUC de
 *    `suppliers.id` (sin sufijo), sólo sociedades privadas (`isEcCompanyRuc`).
 *  - Adjudicaciones con estado `active` o vacío (SERCOP deja vacío el de los procesos
 *    de régimen común y subasta, ya adjudicados); nunca canceladas ni desiertas.
 *  - Monto = `awards.amount`. Si una adjudicación tuviera varios proveedores, el monto
 *    se reparte en partes iguales (medido 15-10-2026: 0 casos en 2025–2026, todas
 *    traen uno solo), para no contar el total completo a cada uno.
 *  - Fecha = la de la adjudicación; si viene vacía (catálogo electrónico), la del
 *    proceso (`releases.date`).
 */

import { basename } from 'node:path';
import type { ProcurementLine } from '../procurement-links';
import { EC_COUNTRY, EC_SERCOP_YEAR_URL, ecProcedureUrl, isEcCompanyRuc, parseEcRuc } from './ec';
import { listZipEntries, monthsBack, readZipCsv } from './loader-io';
import type { ProcurementLoaderSource } from './types';

const VALID_AWARD_STATUS = new Set(['active', '']);

type Window = { from: string; to: string };

const ym = (p: { year: number; month: number }) => `${p.year}-${String(p.month).padStart(2, '0')}`;

/** Ventana escrita en el nombre del archivo, o `null` (sin filtro). */
export function ecWindowFromFileName(file: string): Window | null {
  const match = /-(\d{4}-\d{2})_(\d{4}-\d{2})\.zip$/.exec(basename(file));
  return match ? { from: match[1], to: match[2] } : null;
}

type Release = { buyerRuc: string; buyerName: string; date: string | null };
type Award = { amount: number; date: string | null; valid: boolean };

function isoDate(raw: string | undefined): string | null {
  const text = (raw ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** Monto «103723.20» → número (vacío o inválido → 0). */
export function parseEcAmount(raw: string | undefined): number {
  const n = Number((raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type EcCsvTables = {
  releases: readonly Record<string, string>[];
  awards: readonly Record<string, string>[];
  suppliers: readonly Record<string, string>[];
};

/** Junta las tres tablas OCDS en líneas de proveedores empresa (puro, para las pruebas). */
export function ecLinesFromTables(tables: EcCsvTables, window: Window | null, onLine: (line: ProcurementLine) => void): void {
  const releases = new Map<string, Release>();
  for (const r of tables.releases) {
    const buyerRuc = parseEcRuc(r['buyer_id']);
    const ocid = (r['ocid'] ?? '').trim();
    if (!buyerRuc || !ocid) continue;
    releases.set(ocid, { buyerRuc, buyerName: (r['buyer_name'] ?? '').trim(), date: isoDate(r['date']) });
  }
  const awards = new Map<string, Award>();
  for (const a of tables.awards) {
    awards.set(`${a['ocid']}|${a['id']}`, {
      amount: parseEcAmount(a['amount']),
      date: isoDate(a['date']),
      valid: VALID_AWARD_STATUS.has((a['status'] ?? '').trim().toLowerCase()),
    });
  }
  const suppliersPerAward = new Map<string, number>();
  for (const s of tables.suppliers) {
    const key = `${s['ocid']}|${s['award_id']}`;
    suppliersPerAward.set(key, (suppliersPerAward.get(key) ?? 0) + 1);
  }
  for (const s of tables.suppliers) {
    const supplierRuc = parseEcRuc(s['id']);
    if (!supplierRuc || !isEcCompanyRuc(supplierRuc)) continue;
    const ocid = (s['ocid'] ?? '').trim();
    const key = `${ocid}|${s['award_id']}`;
    const award = awards.get(key);
    const release = releases.get(ocid);
    if (!award?.valid || !release) continue;
    const date = award.date ?? release.date;
    if (window && (!date || date.slice(0, 7) < window.from || date.slice(0, 7) > window.to)) continue;
    onLine({
      buyerCode: release.buyerRuc,
      buyerName: release.buyerName,
      buyerTaxId: release.buyerRuc,
      supplierTaxId: supplierRuc,
      supplierName: (s['name'] ?? '').trim(),
      amount: award.amount / (suppliersPerAward.get(key) ?? 1),
      orderCode: `${ocid}/${(s['award_id'] ?? '').trim()}`,
      orderUrl: ecProcedureUrl(ocid),
      date,
      classificationKey: null,
    });
  }
}

/** Filas de un CSV del zip, en memoria (los de un año pesan decenas de MB: caben). */
async function zipRows(file: string, entry: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  await readZipCsv(file, { encoding: 'utf-8', delimiter: ',', entry }, (r) => rows.push(r));
  return rows;
}

export const EC_LOADER: ProcurementLoaderSource = {
  country: EC_COUNTRY,
  files: (end, months) => {
    const window = monthsBack(end, months);
    const from = ym(window[0]);
    const to = ym(window[window.length - 1]);
    const years = [...new Set(window.map((m) => m.year))];
    return years.map((year) => ({ url: EC_SERCOP_YEAR_URL(year), name: `ec-${year}-${from}_${to}.zip` }));
  },
  readLines: async (filePath, onLine) => {
    const entries = await listZipEntries(filePath);
    const entry = (prefix: string) => {
      const found = entries.find((e) => basename(e).startsWith(prefix) && e.endsWith('.csv'));
      if (!found) throw new Error(`ec_sercop_missing_${prefix}:${filePath}`);
      return found;
    };
    ecLinesFromTables(
      {
        releases: await zipRows(filePath, entry('releases_')),
        awards: await zipRows(filePath, entry('awards_')),
        suppliers: await zipRows(filePath, entry('suppliers_')),
      },
      ecWindowFromFileName(filePath),
      onLine,
    );
  },
};
