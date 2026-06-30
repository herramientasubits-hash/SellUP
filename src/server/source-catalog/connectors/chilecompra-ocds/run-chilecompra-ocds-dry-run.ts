/**
 * ChileCompra / Mercado Público OCDS — Dry-run preview (read-only)
 *
 * Lista procesos del mes, toma una muestra, consulta el detalle de cada uno
 * (concurrencia acotada máx. 3) y normaliza cada release OCDS.
 *
 * NO escribe en Supabase. NO crea cuentas, candidatos ni oportunidades.
 * Si un detalle falla, se cuenta el fallo y se continúa con el resto.
 */

import {
  extractTenderIdFromOcid,
  fetchOcdsListado,
  fetchOcdsTender,
} from './chilecompra-ocds-client';
import { normalizeOcdsRelease } from './normalizers';
import type {
  ChileCompraOcdsDryRunInput,
  ChileCompraOcdsDryRunReport,
  ChileCompraOcdsListItem,
  NormalizedOcdsProcess,
} from './types';

const DEFAULT_SAMPLE_SIZE = 5;
const MAX_SAMPLE_SIZE = 20;
const DETAIL_CONCURRENCY = 3;
const PREVIEW_MESSAGE = 'Preview read-only. No crea cuentas, candidatos ni oportunidades.';

/** Ejecuta `fn` sobre `items` con un pool de concurrencia acotado. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function uniqueCount(values: Array<string | null>): number {
  const set = new Set<string>();
  for (const v of values) {
    if (v) set.add(v);
  }
  return set.size;
}

export async function runChileCompraOcdsDryRun(
  input: ChileCompraOcdsDryRunInput,
): Promise<ChileCompraOcdsDryRunReport> {
  const executedAt = new Date().toISOString();
  const sampleSize = Math.max(1, Math.min(input.sampleSize ?? DEFAULT_SAMPLE_SIZE, MAX_SAMPLE_SIZE));
  const offset = Math.max(0, input.offset ?? 0);
  const warnings: string[] = [];

  const emptyReport = (
    extra: Partial<ChileCompraOcdsDryRunReport['summary']> = {},
    warning?: string,
  ): ChileCompraOcdsDryRunReport => ({
    executedAt,
    year: input.year,
    month: input.month,
    sampleSize,
    offset,
    items: [],
    summary: {
      requested_sample_size: sampleSize,
      listed_count: 0,
      details_attempted: 0,
      details_success: 0,
      details_failed: 0,
      total_month_processes: null,
      awarded_count: 0,
      suppliers_detected_count: 0,
      unique_buyers_count: 0,
      unique_suppliers_count: 0,
      writes_performed: 0,
      ...extra,
    },
    warnings: warning ? [...warnings, warning] : warnings,
    message: PREVIEW_MESSAGE,
  });

  // 1. Listado
  const listado = await fetchOcdsListado({
    year: input.year,
    month: input.month,
    offset,
    limit: sampleSize,
  });

  if (!listado.ok) {
    return emptyReport({}, listado.error);
  }

  const items: ChileCompraOcdsListItem[] = listado.items ?? [];
  if (items.length === 0) {
    return emptyReport(
      { total_month_processes: listado.total },
      'No se encontraron procesos para el mes consultado.',
    );
  }

  // 2. Muestra
  const sample = items.slice(0, sampleSize);

  // 3. Detalle con concurrencia acotada (máx 3). Cada fallo se cuenta y se continúa.
  const detailResults = await mapWithConcurrency(
    sample,
    DETAIL_CONCURRENCY,
    async (listItem): Promise<NormalizedOcdsProcess | null> => {
      // El listado trae OCID completos; el detalle se consulta con el tender id.
      const tenderId = extractTenderIdFromOcid(listItem.ocid);
      const detail = await fetchOcdsTender(tenderId);
      if (!detail.ok) return null;
      // Conservar el OCID original del listado para trazabilidad.
      return normalizeOcdsRelease(detail.release, {
        ocid: listItem.ocid,
        tenderId,
        urlTender: listItem.urlTender,
      });
    },
  );

  const normalized = detailResults.filter((x): x is NormalizedOcdsProcess => x !== null);
  const detailsAttempted = sample.length;
  const detailsSuccess = normalized.length;
  const detailsFailed = detailsAttempted - detailsSuccess;

  if (detailsFailed > 0) {
    warnings.push(`${detailsFailed}/${detailsAttempted} detalles no pudieron normalizarse.`);
  }

  const awardedCount = normalized.filter((p) => p.award_status !== null).length;
  const suppliersDetected = normalized.filter((p) => p.awarded_supplier_name !== null).length;

  return {
    executedAt,
    year: input.year,
    month: input.month,
    sampleSize,
    offset,
    items: normalized,
    summary: {
      requested_sample_size: sampleSize,
      listed_count: items.length,
      details_attempted: detailsAttempted,
      details_success: detailsSuccess,
      details_failed: detailsFailed,
      total_month_processes: listado.total,
      awarded_count: awardedCount,
      suppliers_detected_count: suppliersDetected,
      unique_buyers_count: uniqueCount(normalized.map((p) => p.buyer_rut ?? p.buyer_name)),
      unique_suppliers_count: uniqueCount(
        normalized.map((p) => p.awarded_supplier_rut ?? p.awarded_supplier_name),
      ),
      writes_performed: 0,
    },
    warnings,
    message: PREVIEW_MESSAGE,
  };
}
