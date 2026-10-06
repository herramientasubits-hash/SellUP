/**
 * cl-sii-directory-rows.ts — arma filas de `source_company_snapshots` para
 * `cl_sii_directory`: personas jurídicas chilenas del SII con 100 o más
 * trabajadores, para la capa gratuita por industria del Agente 1.
 *
 * SOURCES-CL-SII-FREE-DISCOVERY-1. Puro: sin env, sin I/O, sin DB, sin reloj (la
 * hora de importación se inyecta).
 *
 * ── De dónde salen ──────────────────────────────────────────────────────────
 *
 * De `cl_sii_registry`, que ya está cargado en Prod (1.699.728 personas jurídicas
 * activas, 02-10-2026): no se descarga nada nuevo. Cada fila trae en `raw_data`
 * el código de actividad (`activity_code`, PUB_NOM_ACTECOS), el texto de la
 * actividad (`activity`, PUB_EMPRESAS_PJ), los trabajadores dependientes
 * informados (`workers`) y su año (`metrics_year`).
 *
 * Una empresa entra sólo si (1) tiene RUT válido, (2) declara 100 o más
 * trabajadores (decisión de la dueña, 05-10-2026), y (3) su código y su texto de
 * actividad dicen lo mismo (`cl-sii-activity-catalog.ts`). Las que caen fuera de
 * la tabla de industrias también se guardan (con macro `null`): la capa gratuita
 * no las ofrece, pero si la tabla cambia no hace falta recargar.
 *
 * 🔴 «Trabajadores dependientes informados» es un estimado oficial con su año,
 * no el tamaño confirmado de la empresa.
 */

import { deriveTaxRecordIdentity, type RecordIdentityKey } from '../../record-identity';
import { normalizeChileRut } from '../res-chile/cl-res-registry-row';
import { normalizeChileSiiCore } from './cl-sii-registry-rows';
import { clSiiActivityTextMatchesCode } from './cl-sii-activity-catalog';
import {
  CL_SII_MACRO_TABLE_VERSION,
  normalizeClActivityCode,
  resolveClActivityMacro,
} from '@/server/prospect-batches/country-source-discovery/cl-sii-macro-table';

export const CL_SII_DIRECTORY_SOURCE_KEY = 'cl_sii_directory' as const;
export const CL_SII_DIRECTORY_COUNTRY_CODE = 'CL' as const;

/** Umbral de tamaño de la capa gratuita de Chile (decisión de la dueña, 05-10-2026). */
export const CL_SII_DIRECTORY_MIN_WORKERS = 100;

/** Lo que se lee de una fila de `cl_sii_registry`. */
export type ClSiiRegistryReadRow = {
  tax_id: string | null;
  legal_name: string | null;
  normalized_legal_name: string | null;
  raw_data: Record<string, unknown> | null;
};

/** Una empresa admitida, lista para construir su fila. */
export type ClSiiDirectoryCandidate = {
  rut: string;
  legalName: string;
  normalizedLegalName: string;
  activityCode: string;
  activity: string;
  workers: number;
  metricsYear: number | null;
  salesBracket: string | null;
  subtype: string | null;
};

/** Por qué una fila no entra (el cargador cuenta cada motivo). */
export type ClSiiDirectoryRejection =
  | 'invalid_rut'
  | 'no_name'
  | 'below_min_workers'
  | 'no_activity_code'
  | 'activity_text_mismatch';

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : null;
};

const integer = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
};

/** ¿Entra esta empresa? Devuelve la empresa admitida o el motivo del rechazo. */
export function admitClSiiDirectoryCompany(
  row: ClSiiRegistryReadRow,
): { ok: true; company: ClSiiDirectoryCandidate } | { ok: false; reason: ClSiiDirectoryRejection } {
  const rut = normalizeChileRut(row.tax_id);
  if (rut === null) return { ok: false, reason: 'invalid_rut' };
  const legalName = text(row.legal_name);
  if (legalName === null) return { ok: false, reason: 'no_name' };

  const raw = row.raw_data ?? {};
  const workers = integer(raw['workers']);
  if (workers === null || workers < CL_SII_DIRECTORY_MIN_WORKERS) return { ok: false, reason: 'below_min_workers' };

  const activityCode = normalizeClActivityCode(text(raw['activity_code']));
  if (activityCode === null) return { ok: false, reason: 'no_activity_code' };
  const activity = text(raw['activity']);
  if (activity === null || !clSiiActivityTextMatchesCode(activityCode, activity)) {
    return { ok: false, reason: 'activity_text_mismatch' };
  }

  const core = text(row.normalized_legal_name) ?? normalizeChileSiiCore(legalName);
  return {
    ok: true,
    company: {
      rut,
      legalName,
      normalizedLegalName: core.length > 0 ? core : legalName.toUpperCase(),
      activityCode,
      activity,
      workers,
      metricsYear: integer(raw['metrics_year']),
      salesBracket: text(raw['sales_bracket']),
      subtype: text(raw['subtype']),
    },
  };
}

export type ClSiiDirectoryRow = {
  source_key: typeof CL_SII_DIRECTORY_SOURCE_KEY;
  country_code: typeof CL_SII_DIRECTORY_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  priority_score: number;
  signals: Record<string, unknown>;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/**
 * Fila de una empresa admitida. `priorityScore` (0-100) es el percentil de sus
 * trabajadores entre todas las cargadas: la capa gratuita ordena por él sin
 * ordenar por un campo JSON.
 *
 * `workers` y `metrics_year` siguen el formato de `cl_sii_registry`, así que
 * `workforceFromRawData` los lee igual.
 */
export function buildClSiiDirectoryRow(params: {
  company: ClSiiDirectoryCandidate;
  priorityScore: number;
  importedAt: string;
}): ClSiiDirectoryRow {
  const { company, priorityScore, importedAt } = params;
  const identity = deriveTaxRecordIdentity(company.rut);
  const year = company.metricsYear ?? new Date(importedAt).getUTCFullYear();

  return {
    source_key: CL_SII_DIRECTORY_SOURCE_KEY,
    country_code: CL_SII_DIRECTORY_COUNTRY_CODE,
    source_year: year,
    tax_id: company.rut,
    normalized_tax_id: company.rut,
    legal_name: company.legalName,
    normalized_legal_name: company.normalizedLegalName,
    sector: company.activityCode,
    priority_score: Math.max(0, Math.min(100, Math.round(priorityScore * 100) / 100)),
    signals: { workers: company.workers, metrics_year: company.metricsYear },
    raw_data: {
      tax_identifier_type: 'RUT',
      subtype: company.subtype,
      activity_code: company.activityCode,
      activity: company.activity,
      macro_industry_key: resolveClActivityMacro(company.activityCode, company.rut),
      macro_table_version: CL_SII_MACRO_TABLE_VERSION,
      workers: company.workers,
      metrics_year: company.metricsYear,
      sales_bracket: company.salesBracket,
      source_type: 'tax_registry_with_workforce',
      sector_source: 'sii_ciiu4cl_2012',
      human_review_required: true,
    },
    imported_at: importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
