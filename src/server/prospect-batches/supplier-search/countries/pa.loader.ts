/**
 * Panamá — lector de PanamaCompra en Cifras (OCDS mensual de la DGCP) para el cargador
 * genérico (`scripts/source-catalog/run-public-procurement-load.ts --country PA`).
 *
 * Cada mes es un zip con un JSON OCDS (`records[].compiledRelease`). De cada
 * adjudicación no cancelada sale una línea por familia UNSPSC de sus ítems: el monto
 * adjudicado se reparte según el valor de cada ítem. Sólo proveedores con RUC de
 * persona JURÍDICA (`isPaCompanyRuc`) y que no sean otra entidad compradora.
 *
 * Una adjudicación puede volver a publicarse en un mes posterior (11 de ~3.300 entre
 * ago y sep 2026): el lector la cuenta una sola vez por corrida.
 */

import type { ProcurementLine } from '../procurement-links';
import { unspscFamily } from '../unspsc-classifier';
import { isPaCompanyRuc, normalizePaRuc, PA_COUNTRY } from './pa';
import { monthsBack, readZipEntries } from './loader-io';
import type { ProcurementLoaderSource } from './types';

export const PA_PANAMACOMPRA_MONTH_URL = (year: number, month: number): string =>
  `https://v2.panamacompraencifras.gob.pa/api/v1/file/panamacompra_v3/json/${year}/${String(month).padStart(2, '0')}`;

type Json = Record<string, unknown>;

function rec(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function list(value: unknown): Json[] {
  return Array.isArray(value) ? value.flatMap((v) => (rec(v) ? [v as Json] : [])) : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isCancelled(award: Json): boolean {
  const status = `${str(award.status)} ${str(award.statusDetails)}`.toLowerCase();
  return status.includes('cancel') || status.includes('desiert') || status.includes('unsuccessful');
}

/** Monto por familia UNSPSC de una adjudicación (el total repartido según sus ítems). */
export function paAwardFamilies(award: Json): Array<{ family: string | null; amount: number }> {
  const items = list(award.items);
  const byFamily = new Map<string | null, number>();
  let itemsTotal = 0;
  for (const item of items) {
    const classification = rec(item.classification);
    const family = str(classification?.scheme).toUpperCase() === 'UNSPSC' ? unspscFamily(str(classification?.id)) : null;
    const value = num(rec(item.totalValue)?.amount);
    itemsTotal += value;
    byFamily.set(family, (byFamily.get(family) ?? 0) + value);
  }
  const awarded = num(rec(award.value)?.amount) || itemsTotal;
  if (awarded <= 0) return [];
  if (itemsTotal <= 0) {
    const first = items.map((i) => rec(i.classification)).find((c) => c && str(c.scheme).toUpperCase() === 'UNSPSC');
    return [{ family: first ? unspscFamily(str(first.id)) : null, amount: awarded }];
  }
  return [...byFamily.entries()].filter(([, v]) => v > 0).map(([family, v]) => ({ family, amount: (awarded * v) / itemsTotal }));
}

/**
 * Lector con su propio estado (adjudicaciones ya contadas y compradores vistos en la
 * corrida). `knownBuyers` acumula los códigos de entidad de todos los meses leídos: un
 * proveedor que también compra es otra entidad pública y no entra.
 */
export function createPaReader(): (text: string, onLine: (line: ProcurementLine) => void) => void {
  const seenAwards = new Set<string>();
  const knownBuyers = new Set<string>();
  return (text, onLine) => {
    const records = list(rec(JSON.parse(text))?.records).map((r) => rec(r.compiledRelease)).filter((r): r is Json => r !== null);
    for (const release of records) {
      const buyerId = normalizePaRuc(str(rec(release.buyer)?.id));
      if (buyerId) knownBuyers.add(buyerId);
    }
    for (const release of records) {
      const buyer = rec(release.buyer);
      const buyerCode = normalizePaRuc(str(buyer?.id));
      const buyerName = str(buyer?.name);
      if (!buyerCode || !buyerName) continue;
      const ocid = str(release.ocid);
      const orderUrl = str(rec(release.tender)?.uri) || null;
      for (const award of list(release.awards)) {
        const awardId = str(award.id);
        const key = `${ocid}|${awardId}`;
        if (!awardId || isCancelled(award) || seenAwards.has(key)) continue;
        seenAwards.add(key);
        const suppliers = list(award.suppliers).flatMap((s) => {
          const ruc = normalizePaRuc(str(s.id));
          return ruc && isPaCompanyRuc(ruc) && !knownBuyers.has(ruc) ? [{ ruc, name: str(s.name) }] : [];
        });
        if (suppliers.length === 0) continue;
        const date = str(award.date).slice(0, 10) || null;
        for (const { family, amount } of paAwardFamilies(award)) {
          for (const supplier of suppliers) {
            onLine({
              buyerCode,
              buyerName,
              buyerTaxId: buyerCode,
              supplierTaxId: supplier.ruc,
              supplierName: supplier.name,
              amount: amount / suppliers.length,
              orderCode: awardId,
              orderUrl,
              date,
              classificationKey: family,
            });
          }
        }
      }
    }
  };
}

const readPaMonth = createPaReader();

export const PA_LOADER: ProcurementLoaderSource = {
  country: PA_COUNTRY,
  files: (end, months) =>
    monthsBack(end, months).map(({ year, month }) => ({ url: PA_PANAMACOMPRA_MONTH_URL(year, month), name: `pa-${year}-${month}.zip` })),
  readLines: (filePath, onLine) => readZipEntries(filePath, (entry) => entry.toLowerCase().endsWith('.json'), (_entry, text) => readPaMonth(text, onLine)),
};
