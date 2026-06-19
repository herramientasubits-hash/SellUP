/**
 * SIIS Snapshot ETL
 *
 * Descarga y procesa el Excel de SIIS Supersociedades para poblar source_company_snapshots.
 *
 * IMPORTANTE:
 * - No ejecutar en cada búsqueda del wizard.
 * - Solo ejecutar manualmente o por job programado (batch ETL).
 * - No descargar todos los años por defecto.
 * - Requiere SUPABASE_SERVICE_ROLE_KEY en el entorno.
 */

import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';
import { downloadSiisExcel, SIIS_CONFIRMED_YEARS } from './siis-client';
import type { SiisCompanyFinancialRecord } from './types';

// ─── Result type ──────────────────────────────────────────────────────────────

export type SiisSnapshotEtlResult = {
  ok: boolean;
  year: number;
  recordsFound: number;
  recordsUpserted: number;
  runId?: string;
  errors: string[];
  warnings: string[];
};

// ─── Normalization helpers (exported for testing) ─────────────────────────────

/** Normaliza NIT colombiano: elimina DV, puntos, espacios */
export function normalizeSiisNIT(nit: string | undefined | null): string | null {
  if (!nit) return null;
  const s = String(nit).trim();
  if (!s) return null;
  const withoutDV = s.replace(/-\d{1,2}$/, '');
  const cleaned = withoutDV.replace(/[\.\s]/g, '');
  return cleaned || null;
}

/** Normaliza razón social: minúsculas, sin tildes, sin sufijos legales */
export function normalizeSiisLegalName(name: string | undefined | null): string | null {
  if (!name) return null;
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\b(s\.a\.s\.?|sas|s\.a\.?|ltda\.?|e\.u\.?|e\.i\.r\.l\.?|corp\.?|inc\.?|llc|s\.r\.l\.?)\b/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || null
  );
}

// ─── Financial value parser (exported for testing) ───────────────────────────

export function parseSiisFinancialValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s || s === '-' || /^(n\/?a|nulo|null|none|cero)$/i.test(s)) return null;
    let cleaned = s.replace(/[$€¥£₡\s]/g, '');
    if (cleaned.includes(',') && cleaned.includes('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (cleaned.includes(',')) {
      const lastComma = cleaned.lastIndexOf(',');
      const afterComma = cleaned.slice(lastComma + 1);
      if (/^\d{1,2}$/.test(afterComma)) {
        cleaned = cleaned.replace(',', '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    } else {
      cleaned = cleaned.replace(/\./g, '');
    }
    cleaned = cleaned.replace(/[^0-9.\-]/g, '');
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

// ─── Column header normalizer ─────────────────────────────────────────────────

function normalizeColumnHeader(header: string): string {
  return header
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\-–—/]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

// ─── Excel row mapping ────────────────────────────────────────────────────────

/**
 * Encuentra la primera clave en el row que coincide con algún patrón regex.
 */
function findColumnKey(
  keys: string[],
  patterns: RegExp[],
): string | undefined {
  return keys.find((k) => {
    const trimmed = k.trim();
    if (patterns.some((p) => p.test(trimmed))) return true;
    const normalized = normalizeColumnHeader(k);
    return patterns.some((p) => p.test(normalized));
  });
}

/**
 * Convierte una fila del Excel SIIS en un SiisCompanyFinancialRecord.
 * Retorna null si no tiene NIT o Razón Social.
 */
export function mapRowToRecord(
  row: Record<string, unknown>,
  year: number,
): SiisCompanyFinancialRecord | null {
  const keys = Object.keys(row);
  const prevYear = year - 1;

  const strVal = (key: string | undefined): string | undefined =>
    key ? (row[key] ?? undefined) as string | undefined : undefined;

  const numVal = (key: string | undefined): number | null =>
    key ? parseSiisFinancialValue(row[key]) : null;

  const find = (patterns: RegExp[]): string | undefined => findColumnKey(keys, patterns);

  const nit = strVal(find([/^NIT$/i]));
  const legalName = strVal(find([/^RAZ[OÓ]N\s+SOCIAL/i, /^RAZON_SOCIAL/i, /^EMPRESA/i]));

  if (!nit || !legalName) return null;

  return {
    sourceKey: 'co_siis',
    countryCode: 'CO',
    sourceYear: year,
    taxId: nit.trim(),
    legalName: legalName.trim(),
    supervisor: strVal(find([/^SUPERVISOR/i])),
    region: strVal(find([/^REGI[OÓ]N\s*(DOMICILIO)?$/i, /^REGION/i])),
    department: strVal(find([/^DEPARTAMENTO/i])),
    city: strVal(find([/^CIUDAD/i])),
    ciiu: strVal(find([/^CIIU$/i])),
    macrosector: strVal(find([/^MACROSECTOR/i])),
    financials: {
      currentYear: year,
      previousYear: prevYear,
      operatingRevenueCurrent: numVal(find([new RegExp(`INGRESOS.*OPERACIONALES.*${year}`, 'i'), /INGRESOS.*OPERACIONALES.*CORRIENTE/i, /INGRESOS.*OPERACIONALES.*N\b/i])),
      profitLossCurrent: numVal(find([new RegExp(`GANANCIA.*PERDIDA.*${year}`, 'i'), new RegExp(`UTILIDAD.*EJERCICIO.*${year}`, 'i'), /GANANCIA.*PERDIDA.*CORRIENTE/i, /UTILIDAD.*EJERCICIO.*CORRIENTE/i])),
      totalAssetsCurrent: numVal(find([new RegExp(`TOTAL.*ACTIVOS.*${year}`, 'i'), /TOTAL.*ACTIVOS.*CORRIENTE/i, /TOTAL.*ACTIVOS.*N\b/i])),
      totalLiabilitiesCurrent: numVal(find([new RegExp(`TOTAL.*PASIVOS.*${year}`, 'i'), /TOTAL.*PASIVOS.*CORRIENTE/i, /TOTAL.*PASIVOS.*N\b/i])),
      totalEquityCurrent: numVal(find([new RegExp(`TOTAL.*PATRIMONIO.*${year}`, 'i'), /TOTAL.*PATRIMONIO.*CORRIENTE/i, /TOTAL.*PATRIMONIO.*N\b/i])),
      operatingRevenuePrevious: numVal(find([new RegExp(`INGRESOS.*OPERACIONALES.*${prevYear}`, 'i'), /INGRESOS.*OPERACIONALES.*ANTERIOR/i, /INGRESOS.*OPERACIONALES.*N[\s-]1/i])),
      profitLossPrevious: numVal(find([new RegExp(`GANANCIA.*PERDIDA.*${prevYear}`, 'i'), new RegExp(`UTILIDAD.*EJERCICIO.*${prevYear}`, 'i'), /GANANCIA.*PERDIDA.*ANTERIOR/i, /UTILIDAD.*EJERCICIO.*ANTERIOR/i])),
      totalAssetsPrevious: numVal(find([new RegExp(`TOTAL.*ACTIVOS.*${prevYear}`, 'i'), /TOTAL.*ACTIVOS.*ANTERIOR/i, /TOTAL.*ACTIVOS.*N[\s-]1/i])),
      totalLiabilitiesPrevious: numVal(find([new RegExp(`TOTAL.*PASIVOS.*${prevYear}`, 'i'), /TOTAL.*PASIVOS.*ANTERIOR/i, /TOTAL.*PASIVOS.*N[\s-]1/i])),
      totalEquityPrevious: numVal(find([new RegExp(`TOTAL.*PATRIMONIO.*${prevYear}`, 'i'), /TOTAL.*PATRIMONIO.*ANTERIOR/i, /TOTAL.*PATRIMONIO.*N[\s-]1/i])),
    },
    raw: row as Record<string, unknown>,
  };
}

// ─── Excel parsing ────────────────────────────────────────────────────────────

/**
 * Parsea el buffer de un Excel SIIS y devuelve registros financieros.
 * Descarta filas sin NIT o sin Razón Social.
 */
export function parseExcelRows(
  buffer: Buffer,
  year: number,
): SiisCompanyFinancialRecord[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  return rawRows
    .map((row) => mapRowToRecord(row, year))
    .filter((r): r is SiisCompanyFinancialRecord => r !== null);
}

// ─── Priority score ───────────────────────────────────────────────────────────

function computePriorityScore(rec: SiisCompanyFinancialRecord): number {
  const revenue = rec.financials?.operatingRevenueCurrent;
  if (typeof revenue !== 'number') return 0;
  if (revenue > 100_000_000_000) return 10;
  if (revenue > 10_000_000_000) return 7;
  if (revenue > 1_000_000_000) return 5;
  if (revenue > 100_000_000) return 3;
  return 1;
}

// ─── Supabase admin client ────────────────────────────────────────────────────

function getAdminSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(url, serviceKey);
}

// ─── Run tracker helpers ──────────────────────────────────────────────────────

async function finishRun(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  runId: string | undefined,
  status: 'completed' | 'failed',
  meta: { records_found: number; records_upserted: number; error?: string },
): Promise<void> {
  if (!runId) return;
  try {
    await sb
      .from('source_snapshot_runs')
      .update({
        status,
        completed_at: new Date().toISOString(),
        records_found: meta.records_found,
        records_upserted: meta.records_upserted,
        error_message: meta.error ?? null,
      })
      .eq('id', runId);
  } catch {
    // Best-effort
  }
}

// ─── Main ETL function ────────────────────────────────────────────────────────

/**
 * Ejecuta el ETL de snapshot SIIS para un año dado.
 *
 * @param year   Año fiscal a procesar.
 * @param n      Cantidad de registros: 1000 o 10000.
 * @param options.dryRun  Si es true, parsea pero no escribe en DB ni registra run.
 * @param options.signal  AbortSignal opcional.
 */
export async function runSiisSnapshotEtl(
  year: number,
  n: 1000 | 10000 = 10000,
  options?: { dryRun?: boolean; signal?: AbortSignal },
): Promise<SiisSnapshotEtlResult> {
  if (!SIIS_CONFIRMED_YEARS.includes(year)) {
    return {
      ok: false,
      year,
      recordsFound: 0,
      recordsUpserted: 0,
      errors: [`Year ${year} not in SIIS_CONFIRMED_YEARS`],
      warnings: [],
    };
  }

  const sb = getAdminSupabase();
  const errors: string[] = [];
  const warnings: string[] = [];
  let runId: string | undefined;
  const dryRun = options?.dryRun ?? false;

  if (!dryRun) {
    try {
      const { data: runData } = await sb
        .from('source_snapshot_runs')
        .insert({
          source_key: 'co_siis',
          country_code: 'CO',
          status: 'running',
          started_at: new Date().toISOString(),
          source_year: year,
          metadata: { n },
        })
        .select('id')
        .single();
      runId = (runData as { id?: string } | null)?.id;
    } catch {
      warnings.push('Could not record ETL run start in source_snapshot_runs');
    }
  }

  try {
    const downloadResult = await downloadSiisExcel(year, n, options?.signal);

    if (!downloadResult.ok || !downloadResult.buffer) {
      const err = downloadResult.error ?? 'Download failed';
      errors.push(err);
      if (!dryRun) {
        await finishRun(sb, runId, 'failed', { records_found: 0, records_upserted: 0, error: err });
      }
      return { ok: false, year, recordsFound: 0, recordsUpserted: 0, runId, errors, warnings };
    }

    const records = parseExcelRows(downloadResult.buffer, year);
    const recordsFound = records.length;

    if (recordsFound === 0) {
      warnings.push('No records parsed from SIIS Excel — check column format or year.');
      if (!dryRun) {
        await finishRun(sb, runId, 'completed', { records_found: 0, records_upserted: 0 });
      }
      return { ok: true, year, recordsFound: 0, recordsUpserted: 0, runId, errors, warnings };
    }

    if (dryRun) {
      return {
        ok: true,
        year,
        recordsFound,
        recordsUpserted: 0,
        runId: undefined,
        errors,
        warnings: [...warnings, `DRY RUN — ${recordsFound} records parsed, no writes performed.`],
      };
    }

    let recordsUpserted = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const rows = batch.map((rec) => ({
        source_key: 'co_siis' as const,
        country_code: 'CO' as const,
        source_year: year,
        tax_id: rec.taxId ?? null,
        legal_name: rec.legalName ?? null,
        normalized_tax_id: normalizeSiisNIT(rec.taxId),
        normalized_legal_name: normalizeSiisLegalName(rec.legalName),
        sector: rec.macrosector ?? rec.ciiu ?? null,
        city: rec.city ?? null,
        department: rec.department ?? null,
        region: rec.region ?? null,
        priority_score: computePriorityScore(rec),
        financials: rec.financials ?? {},
        signals: { supervisor: rec.supervisor, ciiu: rec.ciiu, ranking: rec.ranking },
        raw_data: rec.raw ?? {},
        imported_at: new Date().toISOString(),
      }));

      const { error: upsertErr } = await sb
        .from('source_company_snapshots')
        .upsert(rows, { onConflict: 'source_key,country_code,source_year,normalized_tax_id' });

      if (upsertErr) {
        errors.push(`Batch upsert error at offset ${i}: ${upsertErr.message}`);
      } else {
        recordsUpserted += batch.length;
      }
    }

    await finishRun(sb, runId, 'completed', {
      records_found: recordsFound,
      records_upserted: recordsUpserted,
    });
    return { ok: true, year, recordsFound, recordsUpserted, runId, errors, warnings };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    if (!dryRun) {
      await finishRun(sb, runId, 'failed', {
        records_found: 0,
        records_upserted: 0,
        error: msg,
      });
    }
    return { ok: false, year, recordsFound: 0, recordsUpserted: 0, runId, errors, warnings };
  }
}
