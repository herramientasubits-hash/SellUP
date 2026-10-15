/**
 * Honduras — lector de ONCAE/HonduCompras (OCDS) para el cargador genérico
 * (`scripts/source-catalog/run-public-procurement-load.ts --country HN`).
 *
 * Fuente: OCP Data Registry, publicación 122, un `AAAA.jsonl.gz` por año de versión
 * (16–28 MB/año, sin token). Se leen los años que toca la ventana; el del mes `end` lleva
 * el mes en el nombre para que cada refresco lo baje de nuevo. Si un proceso sale en dos
 * años, manda la versión más nueva.
 *
 * Reglas:
 *  - Comprador = la INSTITUCIÓN (se sube por `memberOf` desde la unidad ejecutora hasta la
 *    parte sin padre: «Región Departamental de Salud…» → SESAL). No tiene RTN: su código
 *    ONCAE (`X-HN-ONCAE-CE`) es el `buyerCode`.
 *  - Fecha = firma del contrato de esa adjudicación; si no la hay, la de la versión (las
 *    adjudicaciones casi nunca traen fecha).
 *  - Monto (sólo 1 de cada 5 adjudicaciones trae `value`): valor del contrato ligado
 *    (`awardID`) > valor de la adjudicación > Σ cantidad × precio unitario de sus ítems (cuadra
 *    con el contrato en el 94 % de los casos medidos en 2026). Con varios proveedores en una
 *    adjudicación, se reparte.
 *  - Industria = UNSPSC de los ítems adjudicados, con el monto repartido por su valor.
 */

import { httpsUrl, type ProcurementLine } from '../procurement-links';
import { unspscFamily } from '../unspsc-classifier';
import { monthsBack } from './loader-io';
import { hnCompanySupplier, HN_COUNTRY } from './hn';
import { asAmount, asList, asRecord, asText, createOcdsWindowLoader, dateInWindow, splitByFamily, type OcdsReleaseReader } from './ocds-window';

export const HN_ONCAE_YEAR_URL = (year: number) => `https://data.open-contracting.org/en/publication/122/download?name=${year}.jsonl.gz`;

/** Lempiras por unidad cuando el contrato no viene en HNL (sólo para el piso). */
const HNL_PER_UNIT: Readonly<Record<string, number>> = { HNL: 1, USD: 26 };

function inHnl(value: Record<string, unknown> | null): number {
  const amount = asAmount(value?.amount);
  const rate = HNL_PER_UNIT[(asText(value?.currency) ?? 'HNL').toUpperCase()];
  return rate ? amount * rate : 0;
}

/** Sube por `memberOf` hasta la institución (la parte sin padre). */
export function hnInstitution(parties: readonly Record<string, unknown>[], buyerId: string): { code: string; name: string } | null {
  const byId = new Map(parties.map((p) => [asText(p.id), p]));
  let current = byId.get(buyerId);
  for (let depth = 0; current && depth < 6; depth++) {
    const parentId = asText(asList(current.memberOf)[0]?.id);
    const parent = parentId ? byId.get(parentId) : undefined;
    if (!parent) {
      const code = parentId ?? asText(current.id);
      const name = parentId ? asText(asList(current.memberOf)[0]?.name) : asText(current.name);
      return code && name ? { code, name } : null;
    }
    current = parent;
  }
  return null;
}

function itemWeights(items: readonly Record<string, unknown>[]): Array<{ family: string | null; weight: number }> {
  return items.map((item) => {
    const cls = asRecord(item.classification);
    const family = (asText(cls?.scheme) ?? '').toUpperCase() === 'UNSPSC' ? unspscFamily(asText(cls?.id)) : null;
    const unit = asAmount(asRecord(asRecord(item.unit)?.value)?.amount);
    const quantity = asAmount(item.quantity) || 1;
    return { family, weight: unit * quantity };
  });
}

export const readHnRelease: OcdsReleaseReader = (release, window) => {
  const ocid = asText(release.ocid);
  if (!ocid) return null;
  const lines: ProcurementLine[] = [];
  const buyerId = asText(asRecord(release.buyer)?.id);
  const institution = buyerId ? hnInstitution(asList(release.parties), buyerId) : null;
  if (!institution) return { ocid, lines, buyerTaxIds: [] };
  const contracts = new Map(asList(release.contracts).map((c) => [asText(c.awardID), c]));

  for (const award of asList(release.awards)) {
    const contract = contracts.get(asText(award.id));
    const date = dateInWindow(asText(contract?.dateSigned) ?? asText(award.date) ?? release.date, window);
    if (!date) continue;
    const suppliers = asList(award.suppliers)
      .map((s) => hnCompanySupplier(s.id, s.name))
      .filter((s): s is { rtn: string; name: string } => s !== null);
    if (suppliers.length === 0) continue;
    const items = asList(award.items);
    const weights = itemWeights(items);
    const total = inHnl(asRecord(contract?.value)) || inHnl(asRecord(award.value)) || weights.reduce((sum, w) => sum + w.weight, 0);
    const parts = splitByFamily(total / asList(award.suppliers).length, weights);
    const orderCode = asText(contract?.id) ?? asText(award.id) ?? ocid;
    const docs = asList(contract?.documents);
    const orderUrl = httpsUrl(asText((docs.find((d) => asText(d.documentType) === 'contractSigned') ?? docs[0])?.url));
    for (const supplier of suppliers) {
      for (const part of parts) {
        lines.push({
          buyerCode: institution.code,
          buyerName: institution.name,
          buyerTaxId: null,
          supplierTaxId: supplier.rtn,
          supplierName: supplier.name,
          amount: part.amount,
          orderCode,
          orderUrl,
          date,
          classificationKey: part.family,
        });
      }
    }
  }
  return { ocid, lines, buyerTaxIds: [] };
};

/** Años de versión que toca la ventana; el último lleva el mes (`hn-2026-hasta-9`). */
export function hnFiles(end: { year: number; month: number }, months: number): Array<{ url: string; name: string }> {
  const years = [...new Set(monthsBack(end, months).map((m) => m.year))];
  return years.map((year) => ({
    url: HN_ONCAE_YEAR_URL(year),
    name: year === end.year ? `hn-${year}-hasta-${end.month}.jsonl.gz` : `hn-${year}.jsonl.gz`,
  }));
}

export const HN_LOADER = createOcdsWindowLoader({ country: HN_COUNTRY, files: hnFiles, readRelease: readHnRelease });
