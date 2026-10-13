/**
 * uy-arce-directory-row.ts — fila de `uy_arce_directory`: una organización
 * uruguaya a la que el Estado le adjudicó compras, para el descubrimiento gratuito
 * del Agente 1.
 *
 * SOURCES-UY-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Fuentes (gratuitas, oficiales, licencia de datos abiertos del Estado uruguayo):
 *   - Adjudicaciones de ARCE en OCDS (ocds-AAAA.zip, 2022-2025), agregadas por RUT
 *     con `scripts/source-catalog/extract-uy-ocds-suppliers.py`: qué le compró el
 *     Estado (familia, subfamilia y clase del catálogo SICE), cuánto, cuántas veces
 *     y a cuántos organismos.
 *   - RUPE: la organización debe estar vigente (activa o en ingreso) y su razón
 *     social es la que se guarda (`uy_rupe_registry`).
 *   - Web: la que se comprobó por su nombre (`uy-company-web.ts`), o la del
 *     Directorio de Empresas Industriales del MIEM. El OCDS de ARCE no publica
 *     correos ni webs de sus proveedores.
 *
 * Una organización entra sólo si:
 *   - es una organización vigente del RUPE (nunca personas, consorcios ni
 *     entidades del Estado: esas van a la capa de Gobierno);
 *   - le adjudicaron al menos `UY_ARCE_MIN_AMOUNT_USD` en los años leídos y alguna
 *     vez desde `UY_ARCE_MIN_RECENT_YEAR`;
 *   - lo que vende al Estado tiene una macro dominante (`uy-arce-macro-table.ts`).
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import {
  resolveUyArceSupplierMacro,
  UY_ARCE_MACRO_TABLE_VERSION,
  type UyArceClassAmount,
} from '@/server/prospect-batches/country-source-discovery/uy-arce-macro-table';
import { uruguayNameCore } from './uy-name-keys';
import { isUruguayPublicEntityName } from './uy-public-entities';

export const UY_ARCE_DIRECTORY_SOURCE_KEY = 'uy_arce_directory' as const;

/** Monto mínimo adjudicado (USD, 2022-2025) para ofrecer la empresa. */
export const UY_ARCE_MIN_AMOUNT_USD = 50_000;

/** Año desde el que tiene que haber alguna adjudicación (la empresa sigue viva). */
export const UY_ARCE_MIN_RECENT_YEAR = 2024;

/** Lo adjudicado a un proveedor (una línea del extractor). */
export type UyArceSupplierSummary = {
  rut: string;
  name: string | null;
  amountByYear: Readonly<Record<string, number>>;
  awards: number;
  buyers: number;
  amountUsd: number;
  classes: readonly UyArceClassAmount[];
};

/** Web comprobada de la organización y de dónde salió. */
export type UyArceDirectoryWeb = {
  domain: string;
  origin: 'name_domain_verified' | 'mie_industrial_directory';
  check?: string | null;
};

export type UyArceDirectoryRow = {
  source_key: typeof UY_ARCE_DIRECTORY_SOURCE_KEY;
  country_code: 'UY';
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

/** Por qué una organización no entra (para el informe de la carga). */
export type UyArceDirectoryExclusion =
  | 'invalid_rut'
  | 'not_in_registry'
  | 'public_entity'
  | 'below_amount'
  | 'no_recent_award'
  | 'no_dominant_macro';

const cleanText = (value: string | null | undefined): string | null => {
  const text = value?.replace(/\s+/g, ' ').trim() ?? '';
  return text.length > 0 ? text : null;
};

/** Puntos extra de una organización con web: se ofrece antes que las que no la tienen. */
export const UY_ARCE_WEB_PRIORITY_BONUS = 1_000_000;

/**
 * Relevancia para ordenar dentro de una macro: primero las que ya tienen web (cuentan
 * para la meta sin rescate ni pago; decisión de la dueña, 13-10-2026: en UY×Tecnología
 * las 10 que más venden no tenían web), luego a cuántos organismos distintos vende
 * (quien abastece a muchos es grande) y cuántas adjudicaciones. El monto no ordena:
 * hay compras marco con montos absurdos.
 */
export function uyArcePriorityScore(
  summary: Pick<UyArceSupplierSummary, 'awards' | 'buyers'>,
  hasWeb = false,
): number {
  return (hasWeb ? UY_ARCE_WEB_PRIORITY_BONUS : 0) + Math.min(summary.buyers, 999) * 1000 + Math.min(summary.awards, 999);
}

/** Construye la fila, o dice por qué la organización no entra. */
export function buildUyArceDirectoryRow(params: {
  summary: UyArceSupplierSummary;
  /** Razón social del RUPE si es una organización vigente; `null` si no. */
  registryLegalName: string | null;
  /** Departamento del RUPE, si lo hay. */
  department?: string | null;
  /** Rubro en palabras de cada clase «f-s-k» (catálogo SICE). */
  classLabels?: Readonly<Record<string, string>>;
  web?: UyArceDirectoryWeb | null;
  sourceYear: number;
  importedAt: string;
}): { row: UyArceDirectoryRow } | { excluded: UyArceDirectoryExclusion } {
  const { summary, registryLegalName, sourceYear, importedAt } = params;
  const rut = summary.rut.trim();
  if (!/^\d{12}$/.test(rut)) return { excluded: 'invalid_rut' };
  const legalName = cleanText(registryLegalName);
  if (legalName === null) return { excluded: 'not_in_registry' };
  if (isUruguayPublicEntityName(legalName)) return { excluded: 'public_entity' };
  if (summary.amountUsd < UY_ARCE_MIN_AMOUNT_USD) return { excluded: 'below_amount' };
  const lastYear = Math.max(0, ...Object.keys(summary.amountByYear).map(Number).filter(Number.isInteger));
  if (lastYear < UY_ARCE_MIN_RECENT_YEAR) return { excluded: 'no_recent_award' };
  const macro = resolveUyArceSupplierMacro(summary.classes);
  if (macro === null) return { excluded: 'no_dominant_macro' };

  const klass = `${macro.family}-${macro.subfamily}-${macro.klass}`;
  const identity = deriveTaxRecordIdentity(rut);
  return {
    row: {
      source_key: UY_ARCE_DIRECTORY_SOURCE_KEY,
      country_code: 'UY',
      source_year: sourceYear,
      tax_id: rut,
      normalized_tax_id: rut,
      legal_name: legalName,
      normalized_legal_name: uruguayNameCore(legalName),
      city: null,
      region: cleanText(params.department ?? null),
      priority_score: uyArcePriorityScore(summary, Boolean(params.web)),
      raw_data: {
        macro_industry_key: macro.macro,
        macro_share: Math.round(macro.share * 100) / 100,
        macro_table_version: UY_ARCE_MACRO_TABLE_VERSION,
        sice_class: klass,
        activity_text: cleanText(params.classLabels?.[klass] ?? null),
        awards: summary.awards,
        buyers: summary.buyers,
        amount_usd: Math.round(summary.amountUsd),
        last_award_year: lastYear,
        ...(params.web
          ? {
              website_domain: params.web.domain,
              website_origin: params.web.origin,
              ...(params.web.check ? { website_check: params.web.check } : {}),
            }
          : {}),
      },
      imported_at: importedAt,
      record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
    },
  };
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const positive = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** Línea del extractor (`extract-uy-ocds-suppliers.py`) → resumen, o `null`. */
export function parseUyArceSupplierLine(raw: unknown): UyArceSupplierSummary | null {
  const r = record(raw);
  const rut = typeof r?.['rut'] === 'string' ? r['rut'].trim() : '';
  if (r === null || !/^\d{12}$/.test(rut)) return null;
  const years = record(r['years']) ?? {};
  const amountByYear: Record<string, number> = {};
  for (const [year, usd] of Object.entries(years)) if (/^\d{4}$/.test(year)) amountByYear[year] = positive(usd);
  const classes: UyArceClassAmount[] = [];
  if (Array.isArray(r['classes'])) {
    for (const item of r['classes']) {
      if (!Array.isArray(item) || item.length !== 4 || !item.every((n) => typeof n === 'number')) continue;
      const [family, subfamily, klass, usd] = item as number[];
      classes.push([family, subfamily, klass, positive(usd)]);
    }
  }
  return {
    rut,
    name: typeof r['name'] === 'string' ? cleanText(r['name']) : null,
    amountByYear,
    awards: Math.trunc(positive(r['awards'])),
    buyers: Math.trunc(positive(r['buyers'])),
    amountUsd: positive(r['amount_usd']),
    classes,
  };
}
