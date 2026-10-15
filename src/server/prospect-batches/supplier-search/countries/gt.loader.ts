/**
 * Guatemala — lector de Guatecompras (OCDS) para el cargador genérico
 * (`scripts/source-catalog/run-public-procurement-load.ts --country GT`).
 *
 * Fuente: OCP Data Registry, publicación 142 (Ministerio de Finanzas Públicas), un
 * `AAAA.jsonl.gz` por año de versión (~330 MB/año, sin token). Se leen los años que toca
 * la ventana (el del mes `end` lleva el mes en el nombre para bajarlo de nuevo); si un
 * proceso (NOG) sale en dos años, manda la versión más nueva.
 *
 * Reglas:
 *  - Adjudicaciones `active` con fecha de adjudicación en la ventana; comprador = NIT de
 *    `buyer` (GT-NIT-…). Los proveedores que también compran (NIT de comprador) salen.
 *  - 🔴 Doble conteo (Fase 0): una adjudicación con varios dueños (copropietarios de un
 *    inmueble, socios) se publica UNA VEZ POR DUEÑO con el monto COMPLETO repetido. Regla:
 *    dentro del mismo proceso, las adjudicaciones con igual monto, fecha y título son la
 *    misma y el monto se reparte entre ellas; si la adjudicación tiene contrato ligado
 *    (`awardID`), manda el valor del contrato. Así un proveedor recibe su parte, no el total
 *    de cada copia. (Las «miles de adjudicaciones» de un mismo proveedor del IGSS no son
 *    doble conteo: son miles de procesos distintos, uno por NOG.)
 *  - Industria = UNSPSC de `tender.items` (Guatecompras no clasifica lo adjudicado): el
 *    monto se reparte entre las familias del proceso según cuántos ítems tiene cada una.
 */

import type { ProcurementLine } from '../procurement-links';
import { unspscFamily } from '../unspsc-classifier';
import { gtCompanySupplier, GT_COUNTRY, parseGtNit } from './gt';
import { monthsBack } from './loader-io';
import { asAmount, asList, asRecord, asText, createOcdsWindowLoader, dateInWindow, splitByFamily, type OcdsReleaseReader } from './ocds-window';

export const GT_GUATECOMPRAS_YEAR_URL = (year: number) => `https://data.open-contracting.org/en/publication/142/download?name=${year}.jsonl.gz`;

/** Quetzales por unidad cuando no viene en GTQ (sólo para el piso). */
const GTQ_PER_UNIT: Readonly<Record<string, number>> = { GTQ: 1, USD: 7.7 };

function inGtq(value: Record<string, unknown> | null): number {
  const amount = asAmount(value?.amount);
  const rate = GTQ_PER_UNIT[(asText(value?.currency) ?? 'GTQ').toUpperCase()];
  return rate ? amount * rate : 0;
}

/** Página pública del proceso en Guatecompras por su NOG («GT-NOG-12935913»). */
export function gtProcessUrl(tenderId: string | null): string | null {
  const nog = /^GT-NOG-(\d+)$/.exec(tenderId ?? '')?.[1];
  return nog ? `https://www.guatecompras.gt/concursos/consultaConcurso.aspx?nog=${nog}` : null;
}

/** Clave de «la misma adjudicación repetida por dueño». */
function repeatKey(award: Record<string, unknown>): string {
  return `${asAmount(asRecord(award.value)?.amount)}|${asText(award.date) ?? ''}|${asText(award.title) ?? ''}`;
}

export const readGtRelease: OcdsReleaseReader = (release, window) => {
  const ocid = asText(release.ocid);
  if (!ocid) return null;
  const lines: ProcurementLine[] = [];
  const buyer = asRecord(release.buyer);
  const buyerId = asText(buyer?.id);
  const buyerName = asText(buyer?.name);
  const buyerNit = parseGtNit(buyerId);
  const buyerTaxIds = buyerNit ? [buyerNit] : [];
  if (!buyerId || !buyerName) return { ocid, lines, buyerTaxIds };
  const buyerParty = asList(release.parties).find((p) => (Array.isArray(p.roles) ? p.roles : []).includes('buyer') && !p.memberOf);
  const buyerSector = asText(asRecord(asRecord(buyerParty?.details)?.entityType)?.description);

  const tender = asRecord(release.tender);
  const weights = asList(tender?.items).map((item) => {
    const cls = asRecord(item.classification);
    return { family: (asText(cls?.scheme) ?? '').toUpperCase() === 'UNSPSC' ? unspscFamily(asText(cls?.id)) : null, weight: 1 };
  });
  const orderUrl = gtProcessUrl(asText(tender?.id));
  const contractTotal = new Map<string, number>();
  for (const c of asList(release.contracts)) {
    const awardId = asText(c.awardID);
    if (awardId) contractTotal.set(awardId, (contractTotal.get(awardId) ?? 0) + inGtq(asRecord(c.value)));
  }
  const awards = asList(release.awards).filter((a) => asText(a.status) === 'active');
  const copies = new Map<string, number>();
  for (const a of awards) copies.set(repeatKey(a), (copies.get(repeatKey(a)) ?? 0) + 1);

  for (const award of awards) {
    const date = dateInWindow(award.date, window);
    const awardId = asText(award.id);
    if (!date || !awardId) continue;
    const suppliers = asList(award.suppliers)
      .map((s) => gtCompanySupplier(s.id, s.name))
      .filter((s): s is { nit: string; name: string } => s !== null);
    if (suppliers.length === 0) continue;
    const contracted = contractTotal.get(awardId) ?? 0;
    const amount = contracted > 0 ? contracted : inGtq(asRecord(award.value)) / (copies.get(repeatKey(award)) ?? 1);
    const parts = splitByFamily(amount / asList(award.suppliers).length, weights);
    for (const supplier of suppliers) {
      for (const part of parts) {
        lines.push({
          buyerCode: buyerNit ?? buyerId,
          buyerName,
          buyerTaxId: buyerNit,
          buyerSector,
          supplierTaxId: supplier.nit,
          supplierName: supplier.name,
          amount: part.amount,
          orderCode: awardId,
          orderUrl,
          date,
          classificationKey: part.family,
        });
      }
    }
  }
  return { ocid, lines, buyerTaxIds };
};

/** Años de versión que toca la ventana; el último lleva el mes (`gt-2026-hasta-9`). */
export function gtFiles(end: { year: number; month: number }, months: number): Array<{ url: string; name: string }> {
  const years = [...new Set(monthsBack(end, months).map((m) => m.year))];
  return years.map((year) => ({
    url: GT_GUATECOMPRAS_YEAR_URL(year),
    name: year === end.year ? `gt-${year}-hasta-${end.month}.jsonl.gz` : `gt-${year}.jsonl.gz`,
  }));
}

export const GT_LOADER = createOcdsWindowLoader({ country: GT_COUNTRY, files: gtFiles, readRelease: readGtRelease });
