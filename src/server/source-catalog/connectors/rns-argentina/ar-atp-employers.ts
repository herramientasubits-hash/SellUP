/**
 * ar-atp-employers.ts — arma filas de `source_company_snapshots` para
 * `ar_atp_employers`: sociedades argentinas ACTIVAS que en 2020 declararon
 * trabajadores en el programa ATP (Asistencia de Emergencia al Trabajo y la
 * Producción).
 *
 * SOURCES-AR-E2E-1. Puro: sin env, sin I/O, sin DB, sin reloj (la hora de
 * importación se inyecta).
 *
 * ── Por qué ATP ─────────────────────────────────────────────────────────────
 *
 * Es el ÚNICO padrón público y gratuito de Argentina con CUIT y número de
 * trabajadores por empresa (datos.gob.ar, Jefatura de Gabinete / CEP XXI,
 * CC-BY 4.0). SIPA por CUIT, Grandes Contribuyentes y el Registro MiPyME no son
 * públicos (investigado 05-10-2026). Sirve para dos cosas a la vez: amplía el
 * buscador gratuito más allá de las 6.350 proveedoras del Estado y lo limita a
 * empresas con plantilla real.
 *
 * ── Límites (van al catálogo) ───────────────────────────────────────────────
 *
 *   - Foto de 2020: empresas creadas después no están.
 *   - `cantidad_perceptores` son los trabajadores que COBRARON ATP en ese mes, no
 *     la plantilla total: es un PISO. Se toma el máximo entre meses y rondas.
 *   - La razón social y la actividad salen del Registro Nacional de Sociedades
 *     ya cargado (`ar_rns_registry`): si la sociedad ya no está activa allí, no
 *     entra.
 */

import { deriveTaxRecordIdentity } from '../../record-identity';
import type { RecordIdentityKey } from '../../record-identity';
import {
  AR_RNS_MACRO_TABLE_VERSION,
  normalizeArActivityCode,
  resolveArActivityMacro,
} from '@/server/prospect-batches/country-source-discovery/ar-rns-macro-table';
import { isLegalEntityCuit, normalizeArLegalName, normalizeCuit } from './ar-rns-snapshot-builder';

export const AR_ATP_EMPLOYERS_SOURCE_KEY = 'ar_atp_employers' as const;
export const AR_ATP_COUNTRY_CODE = 'AR' as const;

/** Trabajadores ATP mínimos para entrar (piso; la plantilla real es mayor). */
export const AR_ATP_MIN_WORKERS = 100;

/** Año de la foto ATP. */
export const AR_ATP_PERIOD_YEAR = 2020;

/** Lo que se guarda de un empleador tras leer todas las filas ATP. */
export type ArAtpEmployer = {
  cuit: string;
  /** Máximo de perceptores entre meses y rondas. */
  workers: number;
  province: string | null;
  atpSector: string | null;
};

/**
 * Lee UNA fila del CSV ATP (columnas `cuit, razon_social, cantidad_perceptores,
 * sector, provincia, ronda_atp, salario_devengado_mes`) y devuelve el empleador
 * que queda para su CUIT: la fila nueva si supera a `previous` en trabajadores,
 * o `previous` tal cual. Personas humanas, CUIT inválidas y cantidades no
 * numéricas devuelven `previous` (o `null` si no había).
 */
export function pickAtpEmployer(
  previous: ArAtpEmployer | null,
  row: Readonly<Record<string, string | undefined>>,
): ArAtpEmployer | null {
  const cuit = normalizeCuit(row['cuit']);
  if (cuit === null || !isLegalEntityCuit(cuit)) return previous;
  if (previous !== null && previous.cuit !== cuit) return previous;
  const workers = Number.parseInt((row['cantidad_perceptores'] ?? '').trim(), 10);
  if (!Number.isInteger(workers) || workers <= 0) return previous;
  if (previous !== null && previous.workers >= workers) return previous;
  return {
    cuit,
    workers,
    province: (row['provincia'] ?? '').trim() || null,
    atpSector: (row['sector'] ?? '').trim() || null,
  };
}

/** Lo que el registro ya cargado aporta de una sociedad activa. */
export type ArRegistryCompany = {
  cuit: string;
  legalName: string;
  activityCode: string | null;
};

export type ArAtpEmployerRow = {
  source_key: typeof AR_ATP_EMPLOYERS_SOURCE_KEY;
  country_code: typeof AR_ATP_COUNTRY_CODE;
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string;
  normalized_legal_name: string;
  sector: string | null;
  city: string | null;
  department: string | null;
  region: string | null;
  priority_score: number;
  signals: Record<string, unknown>;
  financials: Record<string, unknown>;
  raw_data: Record<string, unknown>;
  imported_at: string;
  record_identity_key: RecordIdentityKey | null;
};

/**
 * Fila de un empleador ATP, o `null` si no debe cargarse: menos trabajadores que
 * el mínimo, sin actividad en el registro o actividad fuera de la tabla
 * aprobada (sin macro: el buscador nunca la ofrecería). `priorityScore` (0-100)
 * es el percentil de trabajadores entre las cargadas.
 */
export function buildArAtpEmployerRow(params: {
  employer: ArAtpEmployer;
  registry: ArRegistryCompany;
  priorityScore: number;
  importedAt: string;
  minWorkers?: number;
}): ArAtpEmployerRow | null {
  const { employer, registry, priorityScore, importedAt } = params;
  if (employer.workers < (params.minWorkers ?? AR_ATP_MIN_WORKERS)) return null;
  if (registry.cuit !== employer.cuit) return null;
  const legalName = registry.legalName.trim();
  const code = normalizeArActivityCode(registry.activityCode);
  if (legalName === '' || code === null) return null;
  const macro = resolveArActivityMacro(code);
  if (macro === null) return null;
  const identity = deriveTaxRecordIdentity(employer.cuit);

  return {
    source_key: AR_ATP_EMPLOYERS_SOURCE_KEY,
    country_code: AR_ATP_COUNTRY_CODE,
    source_year: AR_ATP_PERIOD_YEAR,
    tax_id: employer.cuit,
    normalized_tax_id: employer.cuit,
    legal_name: legalName,
    normalized_legal_name: normalizeArLegalName(legalName),
    sector: employer.atpSector,
    city: null,
    department: null,
    region: employer.province,
    priority_score: Math.max(0, Math.min(100, Math.round(priorityScore * 100) / 100)),
    signals: {
      atp_workers_floor: employer.workers,
      atp_period_year: AR_ATP_PERIOD_YEAR,
    },
    financials: {},
    raw_data: {
      tax_identifier_type: 'CUIT',
      actividad_codigo: code,
      atp_sector: employer.atpSector,
      macro_industry_key: macro,
      macro_table_version: AR_RNS_MACRO_TABLE_VERSION,
      source_type: 'employment_program_and_company_registry',
      sector_source: 'arca_ciiu4_principal_activity',
      workforce_note: 'piso: trabajadores que cobraron ATP en 2020, no la plantilla total',
      human_review_required: true,
    },
    imported_at: importedAt,
    record_identity_key: identity.status === 'resolved' ? identity.recordIdentityKey : null,
  };
}
