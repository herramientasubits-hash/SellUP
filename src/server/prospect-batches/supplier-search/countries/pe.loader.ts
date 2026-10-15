/**
 * Perú — lector de OECE Contrataciones Abiertas (OCDS) para el cargador genérico
 * (`scripts/source-catalog/run-public-procurement-load.ts --country PE`).
 *
 * Fuente: OCP Data Registry, publicación 135 (SEACE v3), `full.jsonl.gz` (~1,97 GB, toda
 * la historia, versiones compiladas, actualizada a diario; CC BY 4.0). La API en vivo
 * de OECE responde 403 sin credencial, por eso se carga.
 *
 * Refresco mensual: `--end <último mes cerrado>`. El archivo local lleva el mes en el
 * nombre (`pe-full-<end>.jsonl.gz`), así que cada mes se baja la historia nueva una vez
 * (~40 min) y el lector filtra por fecha de FIRMA del contrato dentro de la ventana.
 * Borrar los `pe-full-*.jsonl.gz` viejos después de cargar.
 *
 * Reglas: una línea por contrato firmado y familia UNSPSC de sus ítems (el monto del
 * contrato se reparte según el valor de cada ítem); proveedor = RUC 20 que no sea
 * consorcio ni entidad pública (por nombre, o porque también compra en el OCDS);
 * comprador = `PE-CONSUCODE-<id>` con su RUC de `additionalIdentifiers`.
 */

import { httpsUrl, type ProcurementLine } from '../procurement-links';
import { unspscFamily } from '../unspsc-classifier';
import { asAmount, asList, asRecord, asText, createOcdsWindowLoader, dateInWindow, splitByFamily, type OcdsReleaseReader } from './ocds-window';
import { isPeCompanySupplier, parsePeRuc, PE_COUNTRY } from './pe';

export const PE_OECE_FULL_URL = 'https://data.open-contracting.org/en/publication/135/download?name=full.jsonl.gz';

/** Cambio aproximado a soles cuando el contrato no viene en PEN (sólo para el piso). */
const PEN_PER_UNIT: Readonly<Record<string, number>> = { PEN: 1, USD: 3.4, EUR: 3.7 };

/** Monto del contrato en soles; el cambio del propio proceso manda si lo trae. */
export function peAmountInPen(value: Record<string, unknown> | null, tenderValue: Record<string, unknown> | null): number {
  const amount = asAmount(value?.amount);
  const currency = (asText(value?.currency) ?? 'PEN').toUpperCase();
  if (currency === 'PEN') return amount;
  const tenderAmount = asAmount(tenderValue?.amount);
  const tenderPen = asAmount(tenderValue?.amount_PEN);
  if (tenderAmount > 0 && tenderPen > 0 && (asText(tenderValue?.currency) ?? '').toUpperCase() === currency) {
    return amount * (tenderPen / tenderAmount);
  }
  const rate = PEN_PER_UNIT[currency];
  return rate ? amount * rate : 0;
}

/** Familia UNSPSC de un ítem (en `additionalClassifications`; CUBSO empieza por el UNSPSC). */
function itemFamily(item: Record<string, unknown>): string | null {
  for (const c of asList(item.additionalClassifications)) {
    if ((asText(c.scheme) ?? '').toUpperCase() === 'UNSPSC') return unspscFamily(asText(c.id));
  }
  const main = asRecord(item.classification);
  return (asText(main?.scheme) ?? '').toUpperCase() === 'CUBSO' ? unspscFamily(asText(main?.id)?.slice(0, 8)) : null;
}

function contractUrl(contract: Record<string, unknown>): string | null {
  const docs = asList(contract.documents);
  const signed = docs.find((d) => asText(d.documentType) === 'contractSigned') ?? docs[0];
  return httpsUrl(asText(signed?.url));
}

export const readPeRelease: OcdsReleaseReader = (release, window) => {
  const ocid = asText(release.ocid);
  if (!ocid) return null;
  const parties = asList(release.parties);
  const buyerTaxIds = parties
    .filter((p) => (Array.isArray(p.roles) ? p.roles : []).includes('buyer'))
    .flatMap((p) => asList(p.additionalIdentifiers).map((i) => parsePeRuc(asText(i.id))))
    .filter((t): t is string => t !== null);
  const buyer = asRecord(release.buyer);
  const buyerCode = asText(buyer?.id);
  const buyerName = asText(buyer?.name);
  const lines: ProcurementLine[] = [];
  if (!buyerCode || !buyerName) return { ocid, lines, buyerTaxIds };
  const buyerParty = parties.find((p) => asText(p.id) === buyerCode);
  const buyerTaxId = asList(buyerParty?.additionalIdentifiers).map((i) => parsePeRuc(asText(i.id))).find(Boolean) ?? null;
  const suppliersById = new Map(parties.map((p) => [asText(p.id), p]));
  const awards = new Map(asList(release.awards).map((a) => [asText(a.id), a]));
  const tenderValue = asRecord(asRecord(release.tender)?.value);

  for (const contract of asList(release.contracts)) {
    const date = dateInWindow(contract.dateSigned, window);
    const orderCode = asText(contract.id);
    if (!date || !orderCode) continue;
    const award = awards.get(asText(contract.awardID));
    const suppliers = asList(award?.suppliers).flatMap((s) => {
      const party = suppliersById.get(asText(s.id));
      const ruc = parsePeRuc(asText(asRecord(party?.identifier)?.id) ?? asText(s.id));
      const name = asText(s.name) ?? asText(party?.name) ?? '';
      return ruc && isPeCompanySupplier(ruc, name) ? [{ ruc, name }] : [];
    });
    if (suppliers.length === 0) continue;
    const amount = peAmountInPen(asRecord(contract.value), tenderValue) / suppliers.length;
    const parts = splitByFamily(
      amount,
      asList(contract.items).map((item) => ({ family: itemFamily(item), weight: asAmount(asRecord(item.totalValue)?.amount) })),
    );
    const orderUrl = contractUrl(contract);
    for (const supplier of suppliers) {
      for (const part of parts) {
        lines.push({
          buyerCode,
          buyerName,
          buyerTaxId,
          supplierTaxId: supplier.ruc,
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
  return { ocid, lines, buyerTaxIds };
};

export const PE_LOADER = createOcdsWindowLoader({
  country: PE_COUNTRY,
  // Un solo archivo: la historia completa; el mes en el nombre fuerza la descarga nueva.
  files: (end) => [{ url: PE_OECE_FULL_URL, name: `pe-full-${end.year}-${end.month}.jsonl.gz` }],
  readRelease: readPeRelease,
});
