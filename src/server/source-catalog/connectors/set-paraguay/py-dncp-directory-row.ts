/**
 * py-dncp-directory-row.ts — fila de `py_dncp_directory`: una sociedad paraguaya
 * que el Estado contrató, para el descubrimiento gratuito del Agente 1.
 *
 * SOURCES-PY-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Fuentes (gratuitas, oficiales, licencia CC BY 4.0):
 *   - Adjudicaciones de la DNCP en datos abiertos OCDS (awa-masivo.zip por año):
 *     qué le compró el Estado (clase UNSPSC de cada artículo), cuánto, cuántas
 *     veces y a cuántas entidades.
 *   - Ficha del proveedor en la API pública de la DNCP: tipo de sociedad, tamaño
 *     MIPYME declarado, dirección, web y correo de contacto.
 *   - Padrón de RUC de la DNIT: la sociedad debe estar ACTIVA y su razón social
 *     oficial es la que se guarda.
 *
 * Una sociedad entra sólo si:
 *   - su RUC es de sociedad (80…) y está ACTIVA en el padrón;
 *   - NO es un consorcio ni una persona física;
 *   - NO declaró ser MICRO, PEQUEÑA ni MEDIANA (Ley 4457: hasta 50 trabajadores);
 *   - lo que vende al Estado tiene una macro dominante (`py-dncp-macro-table.ts`).
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  PY_DNCP_MACRO_TABLE_VERSION,
  resolvePyDncpSupplierMacro,
} from '@/server/prospect-batches/country-source-discovery/py-dncp-macro-table';
import { paraguayNameCore } from './py-name-keys';
import { paraguayCompanyDomain } from './py-domain';

export const PY_DNCP_DIRECTORY_SOURCE_KEY = 'py_dncp_directory' as const;

/** RUC de sociedad con dígito verificador. */
const COMPANY_RUC = /^80\d{6}-\d$/;

/** Tamaños MIPYME declarados que dejan a la empresa fuera (≤ 50 trabajadores). */
const SMALL_DECLARED_SIZES: ReadonlySet<string> = new Set(['MICRO', 'PEQUEÑA', 'PEQUENA', 'MEDIANA']);

/** Tipos de proveedor que no son una empresa a prospectar. */
const EXCLUDED_ENTITY_TYPE = /CONSORCIO|PERSONA F[IÍ]SICA/i;
const CONSORTIUM_NAME = /^\s*["'«]?\s*CONSORCIO\b/i;

/** Lo adjudicado a un proveedor en los años leídos (agregado de los CSV OCDS). */
export type PyDncpAwardSummary = {
  ruc: string;
  /** Monto adjudicado en USD por familia UNSPSC (4 dígitos). */
  amountByFamily: Readonly<Record<string, number>>;
  awards: number;
  buyers: number;
  lastAwardYear: number | null;
  /** Descripción de la clase UNSPSC que más le adjudicaron (catálogo de la DNCP). */
  activityText?: string | null;
};

/** Lo que la ficha de la API de la DNCP dice del proveedor. */
export type PyDncpSupplierProfile = {
  legalEntityType: string | null;
  size: string | null;
  url: string | null;
  email: string | null;
  locality: string | null;
  region: string | null;
};

export type PyDncpDirectoryRow = {
  source_key: typeof PY_DNCP_DIRECTORY_SOURCE_KEY;
  country_code: 'PY';
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

/** Por qué una sociedad no entra (para el informe de la carga). */
export type PyDncpDirectoryExclusion =
  | 'invalid_ruc'
  | 'not_active_in_registry'
  | 'consortium_or_person'
  | 'declared_small'
  | 'no_dominant_macro';

const cleanText = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
};

/**
 * Relevancia para ordenar dentro de una macro: a cuántas entidades distintas
 * vende primero (una empresa que abastece a muchas es grande), luego cuántas
 * adjudicaciones. El monto no ordena: hay montos marco y de consorcios absurdos.
 */
export function pyDncpPriorityScore(summary: Pick<PyDncpAwardSummary, 'awards' | 'buyers'>): number {
  return Math.min(summary.buyers, 999) * 1000 + Math.min(summary.awards, 999);
}

/** Construye la fila, o dice por qué la sociedad no entra. */
export function buildPyDncpDirectoryRow(params: {
  summary: PyDncpAwardSummary;
  profile: PyDncpSupplierProfile | null;
  /** Razón social del padrón si la sociedad está ACTIVA; `null` si no. */
  registryLegalName: string | null;
  sourceYear: number;
  importedAt: string;
}): { row: PyDncpDirectoryRow } | { excluded: PyDncpDirectoryExclusion } {
  const { summary, profile, registryLegalName, sourceYear, importedAt } = params;
  const ruc = summary.ruc.trim();
  if (!COMPANY_RUC.test(ruc)) return { excluded: 'invalid_ruc' };
  const legalName = cleanText(registryLegalName);
  if (legalName === null) return { excluded: 'not_active_in_registry' };
  if (CONSORTIUM_NAME.test(legalName) || EXCLUDED_ENTITY_TYPE.test(profile?.legalEntityType ?? '')) {
    return { excluded: 'consortium_or_person' };
  }
  const size = cleanText(profile?.size)?.toUpperCase() ?? null;
  if (size !== null && SMALL_DECLARED_SIZES.has(size)) return { excluded: 'declared_small' };
  const macro = resolvePyDncpSupplierMacro(summary.amountByFamily);
  if (macro === null) return { excluded: 'no_dominant_macro' };

  const core = paraguayNameCore(legalName);
  const domain = paraguayCompanyDomain({ url: profile?.url ?? null, email: profile?.email ?? null });
  const dominantFamily =
    Object.entries(summary.amountByFamily).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const identity = deriveTaxRecordIdentity(ruc);
  return {
    row: {
      source_key: PY_DNCP_DIRECTORY_SOURCE_KEY,
      country_code: 'PY',
      source_year: sourceYear,
      tax_id: ruc,
      normalized_tax_id: ruc,
      legal_name: legalName,
      normalized_legal_name: core,
      city: cleanText(profile?.locality),
      region: cleanText(profile?.region),
      priority_score: pyDncpPriorityScore(summary),
      raw_data: {
        macro_industry_key: macro.macroIndustryKey,
        macro_share: Math.round(macro.share * 100) / 100,
        macro_table_version: PY_DNCP_MACRO_TABLE_VERSION,
        unspsc_family: dominantFamily,
        activity_text: cleanText(summary.activityText ?? null),
        awards: summary.awards,
        buyers: summary.buyers,
        last_award_year: summary.lastAwardYear,
        declared_size: size,
        legal_entity_type: cleanText(profile?.legalEntityType),
        ...(domain ? { website_domain: domain.domain, website_origin: domain.origin } : {}),
      },
      imported_at: importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const str = (value: unknown): string | null => (typeof value === 'string' ? cleanText(value) : null);

/**
 * RUC de una ficha de la API de la DNCP («80027374-5»; el `id` OCDS lleva el
 * prefijo «PY-RUC-»), o `null`.
 */
export function pyDncpProfileRuc(raw: unknown): string | null {
  const r = record(raw);
  const id = str(record(r?.['identifier'])?.['id']) ?? str(r?.['id'])?.replace(/^PY-RUC-/, '') ?? null;
  return id !== null && COMPANY_RUC.test(id) ? id : null;
}

/** Ficha de la API de la DNCP (`/search/suppliers` o `/suppliers/{ruc}`) → perfil. */
export function parsePyDncpSupplierProfile(raw: unknown): PyDncpSupplierProfile | null {
  const r = record(raw);
  if (r === null) return null;
  const details = record(r['details']);
  const contact = record(r['contactPoint']);
  const address = record(r['address']);
  const locality = str(address?.['locality']);
  return {
    legalEntityType: str(details?.['legalEntityTypeDetail']),
    size: str(details?.['size']),
    url: str(contact?.['url']),
    email: str(contact?.['email']),
    // Algunas fichas traen un código numérico de localidad en vez del nombre.
    locality: locality !== null && /^\d+$/.test(locality) ? null : locality,
    region: str(address?.['region']),
  };
}

/** Línea del resumen de adjudicaciones (`extract-py-dncp-suppliers.py`) → resumen. */
export function parsePyDncpAwardSummary(raw: unknown): PyDncpAwardSummary | null {
  const r = record(raw);
  const ruc = str(r?.['ruc']);
  const families = record(r?.['fam']);
  if (r === null || ruc === null || families === null) return null;
  const amountByFamily: Record<string, number> = {};
  for (const [family, amount] of Object.entries(families)) {
    if (/^\d{4}$/.test(family) && typeof amount === 'number' && Number.isFinite(amount) && amount > 0) {
      amountByFamily[family] = amount;
    }
  }
  const int = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0);
  const lastYear = int(r['last_year']);
  return {
    ruc,
    amountByFamily,
    awards: int(r['awards']),
    buyers: int(r['buyers']),
    lastAwardYear: lastYear > 0 ? lastYear : null,
    activityText: str(r['activity']),
  };
}

/** Tamaño MIPYME declarado de una ficha, si es uno de los tres tramos. */
export function pyDncpDeclaredMipymeSize(profile: PyDncpSupplierProfile | null): 'MICRO' | 'PEQUEÑA' | 'MEDIANA' | null {
  const size = profile?.size?.toUpperCase().replace('PEQUENA', 'PEQUEÑA') ?? null;
  return size === 'MICRO' || size === 'PEQUEÑA' || size === 'MEDIANA' ? size : null;
}
