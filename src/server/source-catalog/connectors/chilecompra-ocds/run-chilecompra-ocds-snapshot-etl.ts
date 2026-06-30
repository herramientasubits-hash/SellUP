/**
 * ChileCompra / Mercado Público OCDS — Snapshot ETL
 *
 * Lee licitaciones/adjudicaciones OCDS y agrega proveedores adjudicados por RUT/año
 * en source_company_snapshots. ETL offline; no se ejecuta en wizard ni en Agent 1.
 *
 * Único: (source_key, country_code, source_year, normalized_tax_id)
 * → 1 fila por proveedor por año, no 1 fila por OCID.
 *
 * Reglas clave:
 * - dry-run = true por defecto. No escribe en Supabase.
 * - Si dryRun = false y months no cubre 1..12, se requiere allowPartialWrite = true.
 * - Concurrencia de detalles máximo 3.
 * - Si falta RUT del proveedor o es inválido, se descarta y se cuenta.
 * - Solo suma CLP. Otros montos → awardsInNonClpCurrency.
 * - No guarda contactPoint de compradores como datos comerciales.
 * - No crea accounts, candidates ni adapters.
 */

import { createClient } from '@supabase/supabase-js';
import {
  fetchOcdsListado,
  fetchOcdsTender,
  fetchOcdsAward,
  buildTenderUrl,
  OCDS_SERVER_MAX_LIMIT,
} from './chilecompra-ocds-client';
import type { FetchAwardResult } from './chilecompra-ocds-client';
import { normalizeRut, resolveBuyer, collectUnspsc } from './normalizers';
import type { OcdsRelease, OcdsAward } from './types';

const ETL_VERSION = 'v1.16CL-D.2';
const BATCH_SIZE = 100;
const DETAIL_CONCURRENCY = 3;
const ARRAY_MAX = 50;
const SOURCE_KEY = 'cl_chilecompra_ocds';
const COUNTRY_CODE = 'CL';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ChileCompraOcdsSnapshotEtlInput = {
  year: number;
  months?: number[];
  maxProcessesPerMonth?: number;
  offset?: number;
  dryRun?: boolean;
  allowPartialWrite?: boolean;
  /** Override listado fetcher for testing (no red real). */
  _fetchListado?: typeof fetchOcdsListado;
  /** Override tender fetcher for testing (no red real). */
  _fetchTender?: typeof fetchOcdsTender;
  /** Override award fetcher for testing (no red real). */
  _fetchAward?: (urlAward: string) => Promise<FetchAwardResult>;
};

export type ChileCompraOcdsSnapshotEtlResult = {
  ok: boolean;
  dry_run: boolean;
  year: number;
  months: number[];
  processes_scanned: number;
  details_attempted: number;
  details_success: number;
  details_failed: number;
  awarded_processes: number;
  suppliers_unique: number;
  records_found: number;
  records_upserted: number;
  processes_without_award: number;
  award_url_missing: number;
  awards_without_supplier_rut: number;
  awards_with_missing_amount: number;
  awards_in_non_clp_currency: number;
  currencies_seen: string[];
  writes_performed: number;
  run_id?: string;
  errors: string[];
  warnings: string[];
};

// ─── OCDS composed name helpers ───────────────────────────────────────────────

/**
 * Limpia un nombre OCDS compuesto con separador "|".
 *
 * Regla:
 *  - Un segmento → devuelve tal cual.
 *  - Todos iguales (case-insensitive) → devuelve el primero.
 *  - Segmentos distintos → devuelve el primero (razón social oficial principal).
 *
 * El primer segmento suele ser la razón social registrada; el segundo, el nombre
 * comercial o alias. Para enrichment usamos la razón social como fuente de verdad.
 */
export function cleanOcdsComposedName(raw: string | null | undefined): {
  cleanName: string | null;
  hadPipe: boolean;
  segments: string[];
} {
  const trimmed = typeof raw === 'string' ? raw.trim() : null;
  if (!trimmed) return { cleanName: null, hadPipe: false, segments: [] };

  const segments = trimmed
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) return { cleanName: null, hadPipe: false, segments: [] };
  if (segments.length === 1) return { cleanName: segments[0], hadPipe: false, segments };

  return { cleanName: segments[0], hadPipe: true, segments };
}

/**
 * Expande un nombre OCDS compuesto con "|" en segmentos únicos (dedup case-insensitive).
 *
 * Útil para buyer_names donde organismo + unidad compradora son entidades distintas
 * que aportan información diferente y deben conservarse por separado.
 */
export function expandOcdsComposedName(raw: string | null | undefined): string[] {
  const trimmed = typeof raw === 'string' ? raw.trim() : null;
  if (!trimmed) return [];

  const segments = trimmed
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const s of segments) {
    const key = s.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(s);
    }
  }
  return result;
}

// ─── Supplier accumulator ──────────────────────────────────────────────────────

type SupplierAcc = {
  taxId: string;
  normalizedTaxId: string;
  legalName: string | null;
  /** Nombre original (antes de limpiar el pipe) para trazabilidad. Solo primer caso. */
  originalLegalNameSample: string | null;
  totalAwardedAmountClp: number;
  awardsCount: number;
  lastAwardDate: string | null;
  buyerNames: Set<string>;
  buyerRuts: Set<string>;
  /** code → description (preserva correspondencia sin repetir código). */
  unspscMap: Map<string, string>;
  ocids: Set<string>;
  sourceUrls: Set<string>;
  procurementMethods: Set<string>;
  awardsWithMissingAmount: number;
  awardsInNonClpCurrency: number;
  currenciesSeen: Set<string>;
};

function makeAcc(taxId: string, normalizedTaxId: string, legalName: string | null, originalLegalNameSample: string | null = null): SupplierAcc {
  return {
    taxId,
    normalizedTaxId,
    legalName,
    originalLegalNameSample,
    totalAwardedAmountClp: 0,
    awardsCount: 0,
    lastAwardDate: null,
    buyerNames: new Set(),
    buyerRuts: new Set(),
    unspscMap: new Map(),
    ocids: new Set(),
    sourceUrls: new Set(),
    procurementMethods: new Set(),
    awardsWithMissingAmount: 0,
    awardsInNonClpCurrency: 0,
    currenciesSeen: new Set(),
  };
}

function addToSet<T>(set: Set<T>, value: T | null | undefined): void {
  if (value != null) set.add(value);
}

function cappedArray<T>(set: Set<T> | T[]): T[] {
  const arr = Array.isArray(set) ? set : Array.from(set);
  return arr.slice(0, ARRAY_MAX);
}

function toStr(v: unknown): string | null {
  if (typeof v === 'string') { const t = v.trim(); return t.length > 0 ? t : null; }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

// ─── Release processor ─────────────────────────────────────────────────────────

export type ProcessReleaseCounters = {
  processesWithoutAward: number;
  awardsWithoutSupplierRut: number;
  awardsWithMissingAmount: number;
  awardsInNonClpCurrency: number;
  currenciesSeen: Set<string>;
};

/**
 * Procesa un release OCDS y acumula proveedores en `map`.
 * Retorna true si el proceso tenía al menos un award con supplier válido.
 */
export function processRelease(
  release: OcdsRelease,
  ocid: string,
  urlTender: string | null,
  map: Map<string, SupplierAcc>,
  counters: ProcessReleaseCounters,
): boolean {
  const awards: OcdsAward[] = Array.isArray(release.awards) ? release.awards : [];
  const validAwards = awards.filter(
    (a) => Array.isArray(a.suppliers) && a.suppliers.length > 0,
  );

  if (validAwards.length === 0) {
    counters.processesWithoutAward++;
    return false;
  }

  const buyer = resolveBuyer(release);
  const unspsc = collectUnspsc(release);
  const tender = release.tender ?? {};
  const procurementMethod =
    toStr(tender.procurementMethod) ?? toStr(tender.procurementMethodDetails);
  const parties = Array.isArray(release.parties) ? release.parties : [];

  // Extraer fecha de adjudicación desde award.contractPeriod o award.date si existe
  // El tipo OcdsAward no incluye date/contractPeriod, usamos acceso genérico defensivo.
  function getAwardDate(award: OcdsAward): string | null {
    const a = award as Record<string, unknown>;
    const d = toStr(a['date']) ?? toStr((a['contractPeriod'] as Record<string, unknown> | undefined)?.['startDate']);
    return d;
  }

  let hadValidSupplier = false;

  for (const award of validAwards) {
    const suppliers = award.suppliers ?? [];

    for (const supplier of suppliers) {
      const supplierId = toStr(supplier.id);
      const rawSupplierName = toStr(supplier.name);
      const { cleanName: supplierName, hadPipe: supplierNameHadPipe } =
        cleanOcdsComposedName(rawSupplierName);

      // Resolver RUT del proveedor cruzando contra parties
      let supplierRut: string | null = null;
      if (supplierId) {
        const party = parties.find((p) => toStr(p.id) === supplierId);
        if (party?.identifier?.id != null) {
          supplierRut = normalizeRut(party.identifier.id).rut;
        }
      }

      if (!supplierRut) {
        counters.awardsWithoutSupplierRut++;
        continue;
      }

      const { normalizedTaxId } = normalizeRut(supplierRut);
      if (!normalizedTaxId || normalizedTaxId.length === 0) {
        counters.awardsWithoutSupplierRut++;
        continue;
      }

      hadValidSupplier = true;

      if (!map.has(normalizedTaxId)) {
        map.set(
          normalizedTaxId,
          makeAcc(
            supplierRut,
            normalizedTaxId,
            supplierName,
            supplierNameHadPipe ? rawSupplierName : null,
          ),
        );
      }

      const acc = map.get(normalizedTaxId)!;

      // Actualizar nombre si aún no tenemos uno
      if (!acc.legalName && supplierName) acc.legalName = supplierName;
      // Conservar primera muestra del nombre original con pipe para trazabilidad
      if (!acc.originalLegalNameSample && supplierNameHadPipe && rawSupplierName) {
        acc.originalLegalNameSample = rawSupplierName;
      }

      // Monto
      const awardValue = (award as Record<string, unknown>)['value'] as
        | { amount?: unknown; currency?: unknown }
        | undefined;
      const amount = typeof awardValue?.amount === 'number' && Number.isFinite(awardValue.amount)
        ? awardValue.amount
        : null;
      const currency = toStr(awardValue?.currency);

      if (currency) {
        acc.currenciesSeen.add(currency);
        counters.currenciesSeen.add(currency);
      }

      if (amount === null) {
        acc.awardsWithMissingAmount++;
        counters.awardsWithMissingAmount++;
      } else if (currency !== 'CLP') {
        acc.awardsInNonClpCurrency++;
        counters.awardsInNonClpCurrency++;
      } else {
        acc.totalAwardedAmountClp += amount;
      }

      acc.awardsCount++;

      // Fecha última adjudicación
      const awardDate = getAwardDate(award);
      if (awardDate) {
        if (!acc.lastAwardDate || awardDate > acc.lastAwardDate) {
          acc.lastAwardDate = awardDate;
        }
      }

      // Compradores — expandir nombres compuestos con "|" en segmentos únicos
      for (const segment of expandOcdsComposedName(buyer.name)) {
        addToSet(acc.buyerNames, segment);
      }
      if (buyer.rut) addToSet(acc.buyerRuts, buyer.rut);

      // UNSPSC (dedup por código dentro del proceso; merge al acumulador)
      for (let i = 0; i < unspsc.codes.length; i++) {
        const code = unspsc.codes[i];
        const desc = unspsc.descriptions[i] ?? '';
        if (!acc.unspscMap.has(code)) acc.unspscMap.set(code, desc);
      }

      // OCID / URL / método
      addToSet(acc.ocids, ocid);
      addToSet(acc.sourceUrls, urlTender ?? buildTenderUrl(ocid));
      if (procurementMethod) addToSet(acc.procurementMethods, procurementMethod);
    }
  }

  return hadValidSupplier;
}

// ─── Priority score ────────────────────────────────────────────────────────────

export function computePriorityScore(totalClp: number, awardsCount: number): number {
  if (totalClp > 10_000_000_000) return 10;
  if (totalClp > 1_000_000_000) return 7;
  if (totalClp > 100_000_000) return 5;
  if (totalClp > 10_000_000) return 3;
  if (awardsCount > 5) return 2;
  return 1;
}

// ─── Legal name normalizer ─────────────────────────────────────────────────────

export function normalizeChileanLegalName(name: string | null | undefined): string | null {
  if (!name) return null;
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\b(s\.a\.p\.i?\.?|s\.p\.a\.?|spa|s\.a\.s\.?|sas|s\.a\.?|ltda\.?|e\.i\.r\.l\.?|corp\.?|inc\.?|llc|s\.r\.l\.?)\b/gi, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || null
  );
}

// ─── Accumulator → snapshot row ───────────────────────────────────────────────

export function accToSnapshotRow(
  acc: SupplierAcc,
  year: number,
  scannedMonths: number[],
  generatedAt: string,
): Record<string, unknown> {
  const unspscCodes = cappedArray(acc.unspscMap.keys() as unknown as Set<string>);
  const unspscDescs = unspscCodes.map((code) => acc.unspscMap.get(code) ?? '');

  return {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    source_year: year,
    tax_id: acc.taxId,
    normalized_tax_id: acc.normalizedTaxId,
    legal_name: acc.legalName ?? null,
    normalized_legal_name: normalizeChileanLegalName(acc.legalName),
    sector: null,
    city: null,
    department: null,
    region: null,
    priority_score: computePriorityScore(acc.totalAwardedAmountClp, acc.awardsCount),
    signals: {
      total_awarded_amount_clp: acc.totalAwardedAmountClp,
      awards_count: acc.awardsCount,
      last_award_date: acc.lastAwardDate,
      buyer_names: cappedArray(acc.buyerNames),
      buyer_ruts: cappedArray(acc.buyerRuts),
      unspsc_codes: unspscCodes,
      unspsc_descriptions: unspscDescs,
      ocids: cappedArray(acc.ocids),
      source_urls: cappedArray(acc.sourceUrls),
      procurement_methods: cappedArray(acc.procurementMethods),
      awards_with_missing_amount: acc.awardsWithMissingAmount,
      awards_in_non_clp_currency: acc.awardsInNonClpCurrency,
      currencies_seen: cappedArray(acc.currenciesSeen),
    },
    financials: {},
    raw_data: {
      sample_ocid: Array.from(acc.ocids)[0] ?? null,
      scanned_months: scannedMonths,
      etl_version: ETL_VERSION,
      generated_at: generatedAt,
      source: 'chilecompra_ocds',
      original_supplier_name_sample: acc.originalLegalNameSample ?? null,
    },
    imported_at: generatedAt,
  };
}

// ─── Concurrency helper ────────────────────────────────────────────────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  const count = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

// ─── Supabase admin client ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAdminSupabase(): any {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://lrdruowtadwbdulndlph.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return createClient(url, serviceKey);
}

// ─── Run tracker helpers ───────────────────────────────────────────────────────

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

// ─── Main ETL ──────────────────────────────────────────────────────────────────

/**
 * Ejecuta el ETL de snapshot ChileCompra OCDS para el año indicado.
 *
 * @param input.year                 Año obligatorio.
 * @param input.months               Meses a escanear (default 1..12).
 * @param input.maxProcessesPerMonth Límite de procesos por mes (útil para pruebas).
 * @param input.offset               Offset inicial en el listado del primer mes.
 * @param input.dryRun               Default true. Si true, no escribe en DB.
 * @param input.allowPartialWrite    Requerido si dryRun=false y months ≠ 1..12.
 */
export async function runChileCompraOcdsSnapshotEtl(
  input: ChileCompraOcdsSnapshotEtlInput,
): Promise<ChileCompraOcdsSnapshotEtlResult> {
  const {
    year,
    months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    maxProcessesPerMonth,
    offset: initialOffset = 0,
    dryRun = true,
    allowPartialWrite = false,
    _fetchListado = fetchOcdsListado,
    _fetchTender = fetchOcdsTender,
    _fetchAward = fetchOcdsAward,
  } = input;

  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Partial write guard ──────────────────────────────────────────────────────
  const isFullYear =
    months.length === 12 &&
    [1,2,3,4,5,6,7,8,9,10,11,12].every((m) => months.includes(m));

  if (!dryRun && !isFullYear && !allowPartialWrite) {
    return {
      ok: false,
      dry_run: dryRun,
      year,
      months,
      processes_scanned: 0,
      details_attempted: 0,
      details_success: 0,
      details_failed: 0,
      awarded_processes: 0,
      suppliers_unique: 0,
      records_found: 0,
      records_upserted: 0,
      processes_without_award: 0,
      award_url_missing: 0,
      awards_without_supplier_rut: 0,
      awards_with_missing_amount: 0,
      awards_in_non_clp_currency: 0,
      currencies_seen: [],
      writes_performed: 0,
      errors: [
        'Partial write blocked: months does not cover the full year (1..12). ' +
          'Pass allowPartialWrite=true to override.',
      ],
      warnings: [],
    };
  }

  // ── Counters ─────────────────────────────────────────────────────────────────
  let processesScanned = 0;
  let detailsAttempted = 0;
  let detailsSuccess = 0;
  let detailsFailed = 0;
  let awardedProcesses = 0;
  let awardUrlMissing = 0;

  const globalCounters: ProcessReleaseCounters = {
    processesWithoutAward: 0,
    awardsWithoutSupplierRut: 0,
    awardsWithMissingAmount: 0,
    awardsInNonClpCurrency: 0,
    currenciesSeen: new Set(),
  };

  const supplierMap = new Map<string, SupplierAcc>();

  // ── Scan months ───────────────────────────────────────────────────────────────
  for (const month of months) {
    let offset = initialOffset;
    let fetchedThisMonth = 0;
    const monthMax = maxProcessesPerMonth ?? Infinity;

    for (;;) {
      const remaining = monthMax === Infinity
        ? OCDS_SERVER_MAX_LIMIT
        : Math.min(OCDS_SERVER_MAX_LIMIT, monthMax - fetchedThisMonth);
      if (remaining <= 0) break;

      const listResult = await _fetchListado({ year, month, offset, limit: remaining });

      if (!listResult.ok) {
        errors.push(`Listado ${year}/${month} offset=${offset}: ${listResult.error}`);
        break;
      }

      const items = listResult.items ?? [];
      if (items.length === 0) break;

      processesScanned += items.length;
      fetchedThisMonth += items.length;

      // Fetch detalles con concurrencia acotada
      const detailResults = await mapWithConcurrency(
        items,
        DETAIL_CONCURRENCY,
        async (item) => {
          detailsAttempted++;
          const tenderResult = await _fetchTender(item.ocid);
          if (!tenderResult.ok) {
            detailsFailed++;
            errors.push(`Detalle ${item.ocid}: ${tenderResult.error}`);
            return null;
          }
          detailsSuccess++;

          // Usar award endpoint cuando urlAward está disponible en el listado
          let release = tenderResult.release;
          if (item.urlAward) {
            const awardResult = await _fetchAward(item.urlAward);
            if (awardResult.ok) {
              const awardRelease = awardResult.release;
              release = {
                ...release,
                // Awards provienen del endpoint dedicado
                awards: awardRelease.awards ?? release.awards,
                // Parties: combinar tender + award para resolver suppliers por RUT
                parties: [
                  ...(release.parties ?? []),
                  ...(awardRelease.parties ?? []),
                ],
              };
            } else {
              errors.push(`Award ${item.urlAward}: ${awardResult.error}`);
            }
          } else {
            awardUrlMissing++;
          }

          return { release, item };
        },
      );

      for (const res of detailResults) {
        if (!res) continue;
        const hadValid = processRelease(
          res.release,
          res.item.ocid,
          res.item.urlTender ?? null,
          supplierMap,
          globalCounters,
        );
        if (hadValid) awardedProcesses++;
      }

      // Paginar o parar
      if (items.length < remaining) break;
      if (listResult.total !== null && offset + items.length >= listResult.total) break;
      offset += items.length;
    }
  }

  const generatedAt = new Date().toISOString();
  const rows = Array.from(supplierMap.values()).map((acc) =>
    accToSnapshotRow(acc, year, months, generatedAt),
  );

  const recordsFound = rows.length;
  const suppliersUnique = recordsFound;

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      year,
      months,
      processes_scanned: processesScanned,
      details_attempted: detailsAttempted,
      details_success: detailsSuccess,
      details_failed: detailsFailed,
      awarded_processes: awardedProcesses,
      suppliers_unique: suppliersUnique,
      records_found: recordsFound,
      records_upserted: 0,
      processes_without_award: globalCounters.processesWithoutAward,
      award_url_missing: awardUrlMissing,
      awards_without_supplier_rut: globalCounters.awardsWithoutSupplierRut,
      awards_with_missing_amount: globalCounters.awardsWithMissingAmount,
      awards_in_non_clp_currency: globalCounters.awardsInNonClpCurrency,
      currencies_seen: Array.from(globalCounters.currenciesSeen),
      writes_performed: 0,
      errors,
      warnings,
    };
  }

  // ── Write mode ────────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sb: any;
  let runId: string | undefined;
  let recordsUpserted = 0;
  let writesPerformed = 0;

  try {
    sb = getAdminSupabase();

    try {
      const { data: runData } = await sb
        .from('source_snapshot_runs')
        .insert({
          source_key: SOURCE_KEY,
          country_code: COUNTRY_CODE,
          status: 'running',
          started_at: generatedAt,
          source_year: year,
          metadata: {
            months,
            max_processes_per_month: maxProcessesPerMonth ?? null,
            etl_version: ETL_VERSION,
          },
        })
        .select('id')
        .single();
      runId = (runData as { id?: string } | null)?.id;
    } catch {
      warnings.push('Could not record ETL run start in source_snapshot_runs');
    }

    if (rows.length > 0) {
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const { error: upsertErr } = await sb
          .from('source_company_snapshots')
          .upsert(batch, {
            onConflict: 'source_key,country_code,source_year,normalized_tax_id',
          });
        if (upsertErr) {
          errors.push(`Batch upsert error at offset ${i}: ${upsertErr.message}`);
        } else {
          recordsUpserted += batch.length;
          writesPerformed += batch.length;
        }
      }
    }

    const finalStatus = errors.length > 0 ? 'failed' : 'completed';
    await finishRun(sb, runId, finalStatus, {
      records_found: recordsFound,
      records_upserted: recordsUpserted,
      error: errors[0],
    });

    return {
      ok: errors.length === 0,
      dry_run: false,
      year,
      months,
      processes_scanned: processesScanned,
      details_attempted: detailsAttempted,
      details_success: detailsSuccess,
      details_failed: detailsFailed,
      awarded_processes: awardedProcesses,
      suppliers_unique: suppliersUnique,
      records_found: recordsFound,
      records_upserted: recordsUpserted,
      processes_without_award: globalCounters.processesWithoutAward,
      award_url_missing: awardUrlMissing,
      awards_without_supplier_rut: globalCounters.awardsWithoutSupplierRut,
      awards_with_missing_amount: globalCounters.awardsWithMissingAmount,
      awards_in_non_clp_currency: globalCounters.awardsInNonClpCurrency,
      currencies_seen: Array.from(globalCounters.currenciesSeen),
      writes_performed: writesPerformed,
      run_id: runId,
      errors,
      warnings,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(msg);
    if (sb) {
      await finishRun(sb, runId, 'failed', {
        records_found: recordsFound,
        records_upserted: recordsUpserted,
        error: msg,
      });
    }
    return {
      ok: false,
      dry_run: false,
      year,
      months,
      processes_scanned: processesScanned,
      details_attempted: detailsAttempted,
      details_success: detailsSuccess,
      details_failed: detailsFailed,
      awarded_processes: awardedProcesses,
      suppliers_unique: suppliersUnique,
      records_found: recordsFound,
      records_upserted: recordsUpserted,
      processes_without_award: globalCounters.processesWithoutAward,
      award_url_missing: awardUrlMissing,
      awards_without_supplier_rut: globalCounters.awardsWithoutSupplierRut,
      awards_with_missing_amount: globalCounters.awardsWithMissingAmount,
      awards_in_non_clp_currency: globalCounters.awardsInNonClpCurrency,
      currencies_seen: Array.from(globalCounters.currenciesSeen),
      writes_performed: writesPerformed,
      run_id: runId,
      errors,
      warnings,
    };
  }
}
