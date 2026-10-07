/**
 * pa-sources-rows.ts — filas de las fuentes oficiales de Panamá para el Agente 1.
 *
 * SOURCES-PA-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Tres fuentes gratuitas y oficiales se juntan por RUC (un RUC, una fila):
 *
 *   1. PanamaCompraEnCifras (DGCP): el buscador de proveedores (RUC, razón social,
 *      nombre comercial, dominio del correo registrado) y los actos adjudicados de
 *      2022 a 2026 (monto, entidad, provincia), más el código UNSPSC de lo
 *      adjudicado según los datos OCDS (licencia PDDL; sólo hasta abril de 2024).
 *   2. Las entidades compradoras de PanamaCompra con un RUC de entidad pública
 *      («8-NT-2-4249»).
 *   3. La lista de Grandes Contribuyentes de la DGI (Resolución 201-3486 de
 *      17-04-2025, Gaceta Oficial 30271-A): ingresos ≥ B/.20 millones Y activos
 *      ≥ B/.60 millones en 2023.
 *
 * Salen tres claves de fuente:
 *
 *   - `pa_ruc_registry`: el RUC por nombre dentro de la corrida (sociedades y
 *     entidades públicas; nunca personas naturales).
 *   - `pa_ruc_name_alias`: otros nombres de la misma fila (siglas, nombre
 *     comercial, nombre de otra fuente, clave pública), nunca el nombre propio de
 *     otro RUC.
 *   - `pa_free_directory`: la capa gratuita por industria (proveedoras relevantes
 *     con macro dominante, Grandes Contribuyentes clasificados y entidades).
 *
 * Nunca se guardan correos, nombres ni teléfonos del representante legal: del
 * correo registrado sólo llega el DOMINIO, y sólo si es corporativo.
 */

import { buildRecordIdentityKey, deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  PA_FREE_DIRECTORY_MACRO_TABLE_VERSION,
  resolvePaDirectoryMacro,
  resolvePaSupplierMacro,
  type PaDirectoryKind,
} from '@/server/prospect-batches/country-source-discovery/pa-free-directory-macro-table';
import { parsePanamaRuc } from './pa-ruc';
import { panamaNameCore, panamaPublicEntityKey, panamaRegistryAliasKeys } from './pa-name-keys';
import { panamaCompanyDomainFromEmailDomain } from './pa-domain';

export const PA_RUC_REGISTRY_SOURCE_KEY = 'pa_ruc_registry' as const;
export const PA_RUC_NAME_ALIAS_SOURCE_KEY = 'pa_ruc_name_alias' as const;
export const PA_FREE_DIRECTORY_SOURCE_KEY = 'pa_free_directory' as const;

/** Espacio de nombres de la identidad de un alias (`pa-name-alias:<RUC>:<clave>`). */
export const PA_NAME_ALIAS_IDENTITY_NAMESPACE = 'pa-name-alias' as const;

/** Categoría de contribuyente que lee el filtro de tamaño (`workforceFromRawData`). */
export const PA_LARGE_TAXPAYER_CATEGORY = 'PA_GRAN_CONTRIBUYENTE' as const;

/** Año fiscal de las declaraciones con que la DGI armó la lista 2025. */
export const PA_LARGE_TAXPAYER_FISCAL_YEAR = 2023;

/** Monto mínimo adjudicado 2022-2026 (balboas) para entrar a la capa gratuita sin ser Gran Contribuyente. */
export const PA_FREE_DIRECTORY_MIN_AWARDED_PAB = 1_000_000;

const CONSORTIUM_NAME = /^\s*["'«]?\s*(CONSORCIO|ASOCIACI[OÓ]N ACCIDENTAL|UNI[OÓ]N TEMPORAL)\b/i;

const cleanText = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
};

// ─── Entradas (líneas de los extractores) ──────────────────────────────────

/** Una línea de `pa_suppliers.jsonl` (`extract-pa-panamacompra.py`). */
export type PaSupplier = {
  ruc: string;
  name: string | null;
  names: readonly string[];
  tradeName: string | null;
  /** Marca de MIPYME registrada en AMPYME (se guarda, no decide tamaño). */
  ampyme: boolean | null;
  /** Dominio del correo registrado (nunca el correo entero). */
  emailDomain: string | null;
  awards: number;
  awardedPab: number;
  buyers: number;
  lastYear: number | null;
  region: string | null;
  /** Monto adjudicado por familia UNSPSC (4 dígitos), en balboas (OCDS). */
  fam: Readonly<Record<string, number>>;
};

/** Una línea de `pa_buyers.jsonl`. */
export type PaBuyer = { ruc: string; name: string | null; area: string | null; region: string | null };

/** Una línea de `pa_large_taxpayers.jsonl` (`extract-pa-dgi-large-taxpayers.py`). */
export type PaLargeTaxpayer = { ruc: string; name: string };

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const str = (value: unknown): string | null => (typeof value === 'string' ? cleanText(value) : null);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(str).filter((v): v is string => v !== null) : [];

/** Línea de `pa_suppliers.jsonl` → proveedora, o `null`. */
export function parsePaSupplier(raw: unknown): PaSupplier | null {
  const r = record(raw);
  const ruc = str(r?.['ruc']);
  if (r === null || ruc === null) return null;
  const fam: Record<string, number> = {};
  for (const [family, amount] of Object.entries(record(r['fam']) ?? {})) {
    if (/^\d{4}$/.test(family) && num(amount) > 0) fam[family] = num(amount);
  }
  const lastYear = num(r['last_year']);
  return {
    ruc,
    name: str(r['name']),
    names: strings(r['names']),
    tradeName: str(r['trade_name']),
    ampyme: typeof r['ampyme'] === 'boolean' ? r['ampyme'] : null,
    emailDomain: str(r['email_domain']),
    awards: Math.trunc(num(r['awards'])),
    awardedPab: num(r['awarded_pab']),
    buyers: Math.trunc(num(r['buyers'])),
    lastYear: lastYear > 0 ? Math.trunc(lastYear) : null,
    region: str(r['region']),
    fam,
  };
}

/** Línea de `pa_buyers.jsonl` → entidad compradora, o `null`. */
export function parsePaBuyer(raw: unknown): PaBuyer | null {
  const r = record(raw);
  const ruc = str(r?.['ruc']);
  if (r === null || ruc === null) return null;
  return { ruc, name: str(r['name']), area: str(r['area']), region: str(r['region']) };
}

/** Línea de `pa_large_taxpayers.jsonl` → Gran Contribuyente, o `null`. */
export function parsePaLargeTaxpayer(raw: unknown): PaLargeTaxpayer | null {
  const r = record(raw);
  const ruc = str(r?.['ruc']);
  const name = str(r?.['name']);
  return ruc !== null && name !== null ? { ruc, name } : null;
}

// ─── Unión por RUC ─────────────────────────────────────────────────────────

/** Lo que las fuentes dicen de un RUC. */
export type PaRucEntry = {
  ruc: string;
  dv: string | null;
  publicEntity: boolean;
  supplier: PaSupplier | null;
  buyer: PaBuyer | null;
  largeTaxpayer: PaLargeTaxpayer | null;
};

/** Por qué una línea no entra al registro. */
export type PaSourceExclusion = 'invalid_ruc' | 'no_name' | 'public_ruc_not_buyer';

/**
 * Junta las tres fuentes por RUC canónico. Cédulas de personas naturales y RUC de
 * relleno no entran; un RUC de entidad pública («…-NT-…») sólo vale como entidad
 * compradora.
 */
export function mergePanamaRucSources(input: {
  suppliers: readonly PaSupplier[];
  buyers: readonly PaBuyer[];
  largeTaxpayers: readonly PaLargeTaxpayer[];
}): { entries: Map<string, PaRucEntry>; excluded: Record<string, Record<PaSourceExclusion, number>> } {
  const entries = new Map<string, PaRucEntry>();
  const excluded: Record<string, Record<PaSourceExclusion, number>> = {};
  const skip = (source: string, reason: PaSourceExclusion): void => {
    excluded[source] = excluded[source] ?? { invalid_ruc: 0, no_name: 0, public_ruc_not_buyer: 0 };
    excluded[source][reason]++;
  };
  const entryFor = (parsed: NonNullable<ReturnType<typeof parsePanamaRuc>>): PaRucEntry => {
    const existing = entries.get(parsed.ruc);
    if (existing) {
      if (existing.dv === null && parsed.dv !== null) existing.dv = parsed.dv;
      return existing;
    }
    const created: PaRucEntry = {
      ruc: parsed.ruc,
      dv: parsed.dv,
      publicEntity: parsed.publicEntity,
      supplier: null,
      buyer: null,
      largeTaxpayer: null,
    };
    entries.set(parsed.ruc, created);
    return created;
  };

  for (const supplier of input.suppliers) {
    const parsed = parsePanamaRuc(supplier.ruc);
    if (parsed === null) skip('panamacompra_supplier', 'invalid_ruc');
    else if (parsed.publicEntity) skip('panamacompra_supplier', 'public_ruc_not_buyer');
    else if (supplier.name === null) skip('panamacompra_supplier', 'no_name');
    else entryFor(parsed).supplier = supplier;
  }
  for (const buyer of input.buyers) {
    const parsed = parsePanamaRuc(buyer.ruc);
    if (parsed === null) skip('panamacompra_buyer', 'invalid_ruc');
    else if (buyer.name === null) skip('panamacompra_buyer', 'no_name');
    else entryFor(parsed).buyer = buyer;
  }
  for (const taxpayer of input.largeTaxpayers) {
    // La lista de la DGI sólo trae sociedades: vale el tomo corto («82-30-15216»).
    const parsed = parsePanamaRuc(taxpayer.ruc, { allowShortTomo: true });
    if (parsed === null) skip('dgi_large_taxpayer', 'invalid_ruc');
    else if (parsed.publicEntity) skip('dgi_large_taxpayer', 'public_ruc_not_buyer');
    else entryFor(parsed).largeTaxpayer = taxpayer;
  }
  return { entries, excluded };
}

/**
 * La razón social que se guarda: la de la entidad compradora o la de la DGI (la
 * autoridad tributaria; leída por OCR, así que va detrás de la del buscador de
 * proveedores cuando el núcleo coincide) y, si no, la más usada en PanamaCompra.
 */
export function paPreferredLegalName(entry: PaRucEntry): string | null {
  const supplierName = cleanText(entry.supplier?.name);
  const dgiName = cleanText(entry.largeTaxpayer?.name);
  if (dgiName !== null && supplierName !== null && panamaNameCore(dgiName) === panamaNameCore(supplierName)) {
    return supplierName;
  }
  return cleanText(entry.buyer?.name) ?? dgiName ?? supplierName;
}

/** Todos los nombres que las fuentes dan a un RUC (sin repetir). */
export function paAllNames(entry: PaRucEntry): string[] {
  const names = [
    entry.buyer?.name,
    entry.largeTaxpayer?.name,
    entry.supplier?.name,
    entry.supplier?.tradeName,
    ...(entry.supplier?.names ?? []),
  ]
    .map((name) => cleanText(name))
    .filter((name): name is string => name !== null);
  return [...new Set(names)];
}

// ─── pa_ruc_registry ───────────────────────────────────────────────────────

export type PaSnapshotRow = {
  source_key: string;
  country_code: 'PA';
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  city: string | null;
  region: string | null;
  priority_score: number;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/** Datos del Gran Contribuyente que leen el filtro de tamaño y la ficha. */
function largeTaxpayerRaw(entry: PaRucEntry): Record<string, unknown> {
  return entry.largeTaxpayer
    ? {
        dgi_large_taxpayer: true,
        taxpayer_category: PA_LARGE_TAXPAYER_CATEGORY,
        metrics_year: PA_LARGE_TAXPAYER_FISCAL_YEAR,
        official_size_band: 'large',
      }
    : {};
}

/** Fila del registro de RUC, o `null` si el RUC no tiene un nombre utilizable. */
export function buildPaRucRegistryRow(
  entry: PaRucEntry,
  params: { sourceYear: number; importedAt: string },
): PaSnapshotRow | null {
  const legalName = paPreferredLegalName(entry);
  const core = legalName === null ? '' : panamaNameCore(legalName);
  if (legalName === null || core.length < 2) return null;
  const identity = deriveTaxRecordIdentity(entry.ruc);
  const origins = [
    entry.supplier ? 'panamacompra_supplier' : null,
    entry.buyer ? 'panamacompra_buyer' : null,
    entry.largeTaxpayer ? 'dgi_large_taxpayer' : null,
  ].filter((origin): origin is string => origin !== null);
  return {
    source_key: PA_RUC_REGISTRY_SOURCE_KEY,
    country_code: 'PA',
    source_year: params.sourceYear,
    tax_id: entry.ruc,
    normalized_tax_id: entry.ruc,
    legal_name: legalName,
    normalized_legal_name: core,
    city: null,
    region: cleanText(entry.buyer?.region ?? entry.supplier?.region),
    priority_score: 0,
    raw_data: {
      tax_identifier_type: 'RUC',
      origins,
      ...(entry.dv !== null ? { dv: entry.dv } : {}),
      ...(entry.publicEntity ? { public_entity: true, public_entity_area: cleanText(entry.buyer?.area) } : {}),
      ...(entry.supplier
        ? {
            trade_name: cleanText(entry.supplier.tradeName),
            awarded_pab: Math.round(entry.supplier.awardedPab),
            awards: entry.supplier.awards,
            last_award_year: entry.supplier.lastYear,
            ...(entry.supplier.ampyme !== null ? { ampyme: entry.supplier.ampyme } : {}),
          }
        : {}),
      ...largeTaxpayerRaw(entry),
    },
    imported_at: params.importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}

/** Los nombres PROPIOS de una fila del registro: su núcleo y su clave pública. */
export function paOwnNameKeys(row: Pick<PaSnapshotRow, 'legal_name' | 'normalized_legal_name'>): string[] {
  const keys = row.normalized_legal_name.length >= 2 ? [row.normalized_legal_name] : [];
  const publicKey = panamaPublicEntityKey(row.legal_name);
  if (publicKey !== null && !keys.includes(publicKey)) keys.push(publicKey);
  return keys;
}

/**
 * Claves EXTRA de un RUC: los núcleos de sus otros nombres (de otras fuentes, el
 * nombre comercial) y las claves de alias de cada nombre (sigla, nombre comercial
 * tras la forma, partes, clave pública). Sin el núcleo propio.
 */
export function paEntryAliasKeys(entry: PaRucEntry, mainCore: string): string[] {
  const keys: string[] = [];
  const push = (key: string): void => {
    if (key.length >= 2 && key !== mainCore && !keys.includes(key)) keys.push(key);
  };
  for (const name of paAllNames(entry)) {
    // Un consorcio o asociación accidental es OTRA entidad (varias socias): su
    // nombre nunca es alias del RUC de una de ellas (visto en Prod el 07-10:
    // «CONSORCIO ALIANZA POR SAN MIGUELITO» colgado del RUC de una socia).
    if (CONSORTIUM_NAME.test(name)) continue;
    push(panamaNameCore(name));
    for (const key of panamaRegistryAliasKeys(name)) push(key);
  }
  // «… TERMINAL PMA» (la DGI abrevia Panamá): también con «PANAMA», que el
  // candidato puede quitar o poner (`panamaCandidateNameVariants`).
  for (const key of [mainCore, ...keys]) {
    if (/ PMA$/.test(key)) {
      push(key.replace(/ PMA$/, ' PANAMA'));
      push(key.replace(/ PMA$/, ''));
    }
  }
  return keys;
}

/** Filas de alias de un RUC (ya sin las claves que son el nombre propio de otro RUC). */
export function buildPaRucNameAliasRows(params: { registryRow: PaSnapshotRow; keys: readonly string[] }): PaSnapshotRow[] {
  const { registryRow, keys } = params;
  const rows: PaSnapshotRow[] = [];
  const seen = new Set<string>([registryRow.normalized_legal_name]);
  for (const key of keys) {
    const core = key.trim();
    if (core.length < 2 || seen.has(core)) continue;
    seen.add(core);
    const identity = buildRecordIdentityKey(PA_NAME_ALIAS_IDENTITY_NAMESPACE, `${registryRow.tax_id}:${core}`);
    rows.push({
      ...registryRow,
      source_key: PA_RUC_NAME_ALIAS_SOURCE_KEY,
      normalized_legal_name: core,
      raw_data: { ...registryRow.raw_data, alias_of: registryRow.normalized_legal_name },
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    });
  }
  return rows;
}

// ─── pa_free_directory ─────────────────────────────────────────────────────

/** Por qué un RUC no entra en la capa gratuita. */
export type PaDirectoryExclusion =
  | 'no_name'
  | 'consortium'
  | 'not_relevant'
  | 'no_dominant_macro';

/**
 * Relevancia para ordenar dentro de una macro: primero los Grandes Contribuyentes
 * y las entidades públicas, luego a cuántas entidades distintas vende y cuántas
 * adjudicaciones tiene (igual que Paraguay y Guatemala: el monto no ordena).
 */
export function paFreeDirectoryPriorityScore(input: { largeTaxpayer: boolean; publicEntity: boolean; buyers: number; awards: number }): number {
  return (
    (input.largeTaxpayer || input.publicEntity ? 1_000_000 : 0) +
    Math.min(input.buyers, 999) * 1000 +
    Math.min(input.awards, 999)
  );
}

/** Qué fuente clasifica la fila (y con qué código), o `null`. */
function directoryClassification(entry: PaRucEntry): { kind: PaDirectoryKind; code: string; share: number | null } | null {
  if (entry.publicEntity) return entry.buyer ? { kind: 'public_entity', code: entry.ruc, share: null } : null;
  const fam = entry.supplier?.fam ?? {};
  const supplierMacro = resolvePaSupplierMacro(fam);
  if (supplierMacro !== null) {
    const dominantFamily = Object.entries(fam)
      .filter(([family]) => resolvePaDirectoryMacro('panamacompra_supplier', family) === supplierMacro.macroIndustryKey)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (dominantFamily !== undefined) return { kind: 'panamacompra_supplier', code: dominantFamily, share: supplierMacro.share };
  }
  if (entry.largeTaxpayer && resolvePaDirectoryMacro('large_taxpayer', entry.ruc) !== null) {
    return { kind: 'large_taxpayer', code: entry.ruc, share: null };
  }
  return null;
}

/**
 * Fila de la capa gratuita, o por qué no entra. Relevancia (aprobada por la dueña
 * el 07-10-2026): Gran Contribuyente, entidad compradora con RUC, o al menos
 * B/.1 millón adjudicado en 2022-2026. `sharedDomains`: dominios que usan dos o
 * más RUC (correos de grupo o de un despacho): no identifican a una sola empresa.
 */
export function buildPaFreeDirectoryRow(
  entry: PaRucEntry,
  params: { sourceYear: number; importedAt: string; sharedDomains: ReadonlySet<string> },
): { row: PaSnapshotRow } | { excluded: PaDirectoryExclusion } {
  const legalName = paPreferredLegalName(entry);
  if (legalName === null || panamaNameCore(legalName).length < 2) return { excluded: 'no_name' };
  if (CONSORTIUM_NAME.test(legalName) || CONSORTIUM_NAME.test(entry.supplier?.name ?? '')) {
    return { excluded: 'consortium' };
  }
  const largeTaxpayer = entry.largeTaxpayer !== null;
  const awardedPab = entry.supplier?.awardedPab ?? 0;
  if (!entry.publicEntity && !largeTaxpayer && awardedPab < PA_FREE_DIRECTORY_MIN_AWARDED_PAB) {
    return { excluded: 'not_relevant' };
  }
  const classification = directoryClassification(entry);
  if (classification === null) return { excluded: 'no_dominant_macro' };
  const macro = resolvePaDirectoryMacro(classification.kind, classification.code)!;

  const domain = entry.publicEntity ? null : panamaCompanyDomainFromEmailDomain(entry.supplier?.emailDomain);
  const identity = deriveTaxRecordIdentity(entry.ruc);
  return {
    row: {
      source_key: PA_FREE_DIRECTORY_SOURCE_KEY,
      country_code: 'PA',
      source_year: params.sourceYear,
      tax_id: entry.ruc,
      normalized_tax_id: entry.ruc,
      legal_name: legalName,
      normalized_legal_name: panamaNameCore(legalName),
      city: null,
      region: cleanText(entry.buyer?.region ?? entry.supplier?.region),
      priority_score: paFreeDirectoryPriorityScore({
        largeTaxpayer,
        publicEntity: entry.publicEntity,
        buyers: entry.supplier?.buyers ?? 0,
        awards: entry.supplier?.awards ?? 0,
      }),
      raw_data: {
        directory_kind: classification.kind,
        activity_code: classification.code,
        macro_industry_key: macro,
        ...(classification.share !== null ? { macro_share: Math.round(classification.share * 100) / 100 } : {}),
        macro_table_version: PA_FREE_DIRECTORY_MACRO_TABLE_VERSION,
        ...(entry.publicEntity ? { public_entity_area: cleanText(entry.buyer?.area) } : {}),
        ...(entry.supplier
          ? {
              awards: entry.supplier.awards,
              buyers: entry.supplier.buyers,
              awarded_pab: Math.round(entry.supplier.awardedPab),
              last_award_year: entry.supplier.lastYear,
            }
          : {}),
        ...largeTaxpayerRaw(entry),
        ...(domain !== null && !params.sharedDomains.has(domain)
          ? { website_domain: domain, website_origin: 'email' }
          : {}),
      },
      imported_at: params.importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}
