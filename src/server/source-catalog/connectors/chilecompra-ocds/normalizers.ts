/**
 * ChileCompra / Mercado Público OCDS Connector — Normalizers
 *
 * Funciones puras, sin I/O. Transforman un release OCDS crudo en un proceso
 * normalizado defensivo. No escriben en Supabase. No crean candidatos.
 *
 * Reglas clave:
 *  - ocid siempre string; si falta, el item se descarta (retorna null).
 *  - RUT siempre string (nunca number); se conserva el formato original.
 *  - normalized_tax_id = RUT sin puntos, conservando guion.
 *  - buyer/procuringEntity se resuelve por roles en parties.
 *  - supplier solo desde awards[].suppliers[]; sin award → null.
 *  - contactPoint pertenece al comprador y NO se mapea como contacto comercial.
 *  - UNSPSC se recolecta desde items[].classification (+ additionalClassifications),
 *    deduplicado por código dentro del mismo proceso.
 */

import { buildTenderUrl, extractTenderIdFromOcid } from './chilecompra-ocds-client';
import type {
  NormalizedOcdsProcess,
  OcdsAward,
  OcdsParty,
  OcdsRelease,
} from './types';

const BUYER_ROLES = ['buyer', 'procuringEntity'];
const DESCRIPTION_MAX = 280;

/** Coacciona a string no vacío o null. Nunca devuelve number. */
function toStr(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function toNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Normaliza un RUT chileno: devuelve el formato original como string y un
 * `normalizedTaxId` sin puntos (conservando el guion del dígito verificador).
 */
export function normalizeRut(raw: unknown): {
  rut: string | null;
  normalizedTaxId: string | null;
} {
  const rut = toStr(raw);
  if (!rut) return { rut: null, normalizedTaxId: null };
  const normalizedTaxId = rut.replace(/\./g, '').replace(/\s+/g, '');
  return { rut, normalizedTaxId };
}

function hasRole(party: OcdsParty, roles: string[]): boolean {
  if (!Array.isArray(party.roles)) return false;
  return party.roles.some((r) => roles.includes(r));
}

/** Resuelve el comprador desde parties (por rol) con fallback a release.buyer. */
export function resolveBuyer(release: OcdsRelease): {
  name: string | null;
  rut: string | null;
  region: string | null;
  country: string;
} {
  const parties = Array.isArray(release.parties) ? release.parties : [];

  let buyerParty = parties.find((p) => hasRole(p, BUYER_ROLES)) ?? null;

  if (!buyerParty && release.buyer?.id != null) {
    const buyerId = toStr(release.buyer.id);
    buyerParty = parties.find((p) => toStr(p.id) === buyerId) ?? null;
  }

  const name = buyerParty?.name != null ? toStr(buyerParty.name) : toStr(release.buyer?.name);
  const { rut } = normalizeRut(buyerParty?.identifier?.id);
  const region = toStr(buyerParty?.address?.region);
  const country = toStr(buyerParty?.address?.countryName) ?? 'CL';

  return { name, rut, region, country };
}

/** Resuelve la primera adjudicación con proveedor. Sin award → todo null. */
export function resolveAward(release: OcdsRelease): {
  status: string | null;
  supplierName: string | null;
  supplierRut: string | null;
} {
  const awards = Array.isArray(release.awards) ? release.awards : [];
  const award: OcdsAward | undefined =
    awards.find((a) => Array.isArray(a.suppliers) && a.suppliers.length > 0) ?? undefined;

  if (!award) return { status: null, supplierName: null, supplierRut: null };

  const supplier = (award.suppliers ?? [])[0];
  const supplierName = toStr(supplier?.name);

  // RUT del proveedor: cruzar el id del supplier contra parties.identifier
  let supplierRut: string | null = null;
  const parties = Array.isArray(release.parties) ? release.parties : [];
  const supplierId = toStr(supplier?.id);
  if (supplierId) {
    const party = parties.find((p) => toStr(p.id) === supplierId);
    supplierRut = normalizeRut(party?.identifier?.id).rut;
  }

  return { status: toStr(award.status), supplierName, supplierRut };
}

/** Recolecta códigos UNSPSC desde items[].classification, deduplicados por código. */
export function collectUnspsc(release: OcdsRelease): {
  codes: string[];
  descriptions: string[];
} {
  const items = Array.isArray(release.tender?.items) ? release.tender!.items! : [];
  const codes: string[] = [];
  const descriptions: string[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const classifications = [
      item.classification,
      ...(Array.isArray(item.additionalClassifications) ? item.additionalClassifications : []),
    ];
    for (const c of classifications) {
      if (!c) continue;
      const code = toStr(c.id);
      if (!code || seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
      descriptions.push(toStr(c.description) ?? '');
    }
  }

  return { codes, descriptions };
}

function shortenDescription(value: unknown): string | null {
  const text = toStr(value);
  if (!text) return null;
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX)}…` : text;
}

/**
 * Contexto de trazabilidad proveniente del listado, inyectado por el dry-run.
 *  - `ocid`: OCID original del listado (autoridad para trazabilidad).
 *  - `tenderId`: tender id extraído usado para llamar al endpoint de detalle.
 *  - `urlTender`: URL del listado (preferida como source_url si está presente).
 */
export type NormalizeContext = {
  ocid?: string | null;
  tenderId?: string | null;
  urlTender?: string | null;
};

/**
 * Normaliza un release OCDS a NormalizedOcdsProcess.
 * Retorna null si falta el ocid (item descartado).
 *
 * Conserva el OCID original (del listado o del release) en `ocid` y el tender id
 * extraído (usado para el detalle) en `tender_id`.
 *
 * @param release Release OCDS crudo del detalle.
 * @param context Trazabilidad del listado (ocid original, tender id, urlTender).
 */
export function normalizeOcdsRelease(
  release: OcdsRelease,
  context: NormalizeContext = {},
): NormalizedOcdsProcess | null {
  const ocid = toStr(context.ocid) ?? toStr(release.ocid);
  if (!ocid) return null;

  const tender = release.tender ?? {};
  // tender id: el extraído usado para el detalle, con fallback a derivarlo del
  // ocid original y, en último caso, al tender.id que venga en el release.
  const tenderId =
    toStr(context.tenderId) ?? extractTenderIdFromOcid(ocid) ?? toStr(tender.id);
  const buyer = resolveBuyer(release);
  const award = resolveAward(release);
  const unspsc = collectUnspsc(release);

  return {
    ocid,
    tender_id: tenderId,
    tender_title: toStr(tender.title),
    tender_description_short: shortenDescription(tender.description),
    tender_status: toStr(tender.status),
    buyer_name: buyer.name,
    buyer_rut: buyer.rut,
    buyer_region: buyer.region,
    buyer_country: buyer.country,
    tender_value_amount: toNum(tender.value?.amount),
    tender_value_currency: toStr(tender.value?.currency),
    procurement_method: toStr(tender.procurementMethod) ?? toStr(tender.procurementMethodDetails),
    tender_period_start: toStr(tender.tenderPeriod?.startDate),
    tender_period_end: toStr(tender.tenderPeriod?.endDate),
    award_status: award.status,
    awarded_supplier_name: award.supplierName,
    awarded_supplier_rut: award.supplierRut,
    unspsc_codes: unspsc.codes,
    unspsc_descriptions: unspsc.descriptions,
    source_url: toStr(context.urlTender) ?? buildTenderUrl(tenderId ?? ocid),
  };
}
