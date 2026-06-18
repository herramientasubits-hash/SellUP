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
 *
 * Dependencia requerida para parseo de Excel: xlsx (npm i xlsx)
 * Usar: import * as XLSX from 'xlsx'
 */

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

// ─── Normalization helpers ────────────────────────────────────────────────────

function normalizeNIT(nit: string | undefined | null): string | null {
  if (!nit) return null;
  return nit.replace(/[\.\-\s]/g, '').replace(/-\d$/, '').trim() || null;
}

function normalizeLegalName(name: string | undefined | null): string | null {
  if (!name) return null;
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove combining diacritics
      .replace(/\b(s\.a\.s\.?|sas|s\.a\.?|ltda\.?|e\.u\.?|corp\.?|inc\.?)\b/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || null
  );
}

// ─── Supabase admin client ────────────────────────────────────────────────────

function getAdminSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(url, serviceKey);
}

// ─── Excel parsing ────────────────────────────────────────────────────────────

/**
 * Parsea las filas del Excel SIIS.
 *
 * IMPORTANTE: Requiere instalar la dependencia `xlsx`:
 *   npm install xlsx
 *   o: pnpm add xlsx
 *
 * La estructura de columnas esperada del Excel SIIS (2024):
 *   Ranking, NIT, Razón Social, Supervisor, Región, Departamento, Ciudad, CIIU, Macrosector,
 *   Ingresos Operacionales Año N, Utilidad del Ejercicio Año N, Total Activos Año N,
 *   Total Pasivos Año N, Patrimonio Año N, [mismos campos Año N-1]
 */
function parseExcelRows(
  _buffer: Buffer,
  year: number,
): SiisCompanyFinancialRecord[] {
  // TODO: Implement with xlsx package
  // import * as XLSX from 'xlsx';
  // const workbook = XLSX.read(_buffer, { type: 'buffer' });
  // const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  // return rows.map(row => mapRowToRecord(row, year));

  // Stub: returns empty array until xlsx is installed and mapRowToRecord is implemented
  void _buffer;
  void year;
  return [];
}

// ─── Priority score ───────────────────────────────────────────────────────────

function computePriorityScore(rec: SiisCompanyFinancialRecord): number {
  const revenue = rec.financials?.operatingRevenueCurrent;
  if (typeof revenue !== 'number') return 0;
  if (revenue > 100_000_000_000) return 10;  // > 100B COP
  if (revenue > 10_000_000_000) return 7;   // > 10B COP
  if (revenue > 1_000_000_000) return 5;    // > 1B COP
  if (revenue > 100_000_000) return 3;      // > 100M COP
  return 1;
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
    // Best-effort — don't fail ETL because of tracking failure
  }
}

// ─── Main ETL function ────────────────────────────────────────────────────────

/**
 * Ejecuta el ETL de snapshot SIIS para un año dado.
 *
 * @param year  Año fiscal a procesar. Debe estar en SIIS_CONFIRMED_YEARS.
 * @param n     Cantidad de registros: 1000 (test) o 10000 (producción).
 * @param signal AbortSignal opcional para cancelar la descarga.
 *
 * @example
 *   // Test run con 1000 registros
 *   const result = await runSiisSnapshotEtl(2024, 1000);
 *
 *   // Production run
 *   const result = await runSiisSnapshotEtl(2024, 10000);
 */
export async function runSiisSnapshotEtl(
  year: number,
  n: 1000 | 10000 = 10000,
  signal?: AbortSignal,
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

  // Record ETL run start
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

  try {
    // Download Excel from SIIS
    const downloadResult = await downloadSiisExcel(year, n, signal);

    if (!downloadResult.ok || !downloadResult.buffer) {
      const err = downloadResult.error ?? 'Download failed';
      errors.push(err);
      await finishRun(sb, runId, 'failed', { records_found: 0, records_upserted: 0, error: err });
      return { ok: false, year, recordsFound: 0, recordsUpserted: 0, runId, errors, warnings };
    }

    // Parse Excel rows
    const records = parseExcelRows(downloadResult.buffer, year);
    const recordsFound = records.length;

    if (recordsFound === 0) {
      warnings.push(
        'No records parsed — xlsx dependency may not be installed. See parseExcelRows() for TODO.',
      );
      await finishRun(sb, runId, 'completed', { records_found: 0, records_upserted: 0 });
      return { ok: true, year, recordsFound: 0, recordsUpserted: 0, runId, errors, warnings };
    }

    // Upsert to source_company_snapshots in batches
    let recordsUpserted = 0;
    const BATCH_SIZE = 100;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const rows = batch.map((rec) => ({
        source_key: 'co_siis',
        country_code: 'CO',
        source_year: year,
        tax_id: rec.taxId ?? null,
        legal_name: rec.legalName ?? null,
        normalized_tax_id: normalizeNIT(rec.taxId),
        normalized_legal_name: normalizeLegalName(rec.legalName),
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
    await finishRun(sb, runId, 'failed', {
      records_found: 0,
      records_upserted: 0,
      error: msg,
    });
    return { ok: false, year, recordsFound: 0, recordsUpserted: 0, runId, errors, warnings };
  }
}
