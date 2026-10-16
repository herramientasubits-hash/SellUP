/**
 * Arnés de pruebas para países «loaded» (España, Argentina, Uruguay): resume líneas con el
 * agregador común, sirve las filas con un doble mínimo de Supabase y corre el paso
 * `runPublicBuyerSupplierStep` de punta a punta con las consultas genéricas del país.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import { ProcurementLinksAggregator, type ProcurementLine, type ProcurementLinkRow } from '../../procurement-links';
import { runPublicBuyerSupplierStep, type PublicBuyerStepOutcome } from '../../public-buyer-suppliers';
import { buildLoadedLinksLookups } from '../loaded-lookups.server';
import type { LoadedCountrySource } from '../types';

export function aggregate(country: LoadedCountrySource, lines: readonly ProcurementLine[], minPairAmount = country.minPairAmount): ProcurementLinkRow[] {
  const agg = new ProcurementLinksAggregator({
    countryCode: country.countryCode,
    sourceKey: country.sourceKey,
    currency: country.currency,
    normalizeBuyerName: country.normalizeBuyerName,
  });
  for (const line of lines) agg.add(line);
  return agg.rows({ windowStart: '2025-01-01', windowEnd: '2025-12-31', minPairAmount });
}

/**
 * Doble de Supabase: filtra por `eq`, `like` (prefijo) y `gt`, ordena (`order`) y corta
 * (`limit`, `range`) como PostgREST, sobre las filas de cada tabla. `queries` cuenta las
 * consultas por tabla (para probar la paginación).
 */
export function fakeClient(
  dataByTable: Record<string, Array<Record<string, unknown>>>,
  queries: Record<string, number> = {},
): SupabaseClient {
  return {
    from(table: string) {
      queries[table] = (queries[table] ?? 0) + 1;
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const orders: Array<{ column: string; ascending: boolean }> = [];
      let window: { from: number; to: number } | null = null;
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'in', 'or']) builder[op] = () => builder;
      builder.eq = (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder);
      builder.gt = (column: string, value: string) => (filters.push((row) => String(row[column] ?? '') > value), builder);
      builder.like = (column: string, pattern: string) => {
        const prefix = pattern.replace(/%$/, '');
        filters.push((row) => String(row[column] ?? '').startsWith(prefix));
        return builder;
      };
      builder.order = (column: string, options?: { ascending?: boolean }) => (orders.push({ column, ascending: options?.ascending !== false }), builder);
      builder.limit = (n: number) => ((window = { from: 0, to: n - 1 }), builder);
      builder.range = (from: number, to: number) => ((window = { from, to }), builder);
      builder.then = (resolve: (v: unknown) => unknown) => {
        const compare = (a: Record<string, unknown>, b: Record<string, unknown>) => {
          for (const { column, ascending } of orders) {
            const x = a[column] as string | number;
            const y = b[column] as string | number;
            if (x !== y) return (x < y ? -1 : 1) * (ascending ? 1 : -1);
          }
          return 0;
        };
        const rows = (dataByTable[table] ?? []).filter((row) => filters.every((f) => f(row))).sort(compare);
        return resolve({ data: window ? rows.slice(window.from, window.to + 1) : rows, error: null });
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

export async function runStep(
  country: LoadedCountrySource,
  links: readonly ProcurementLinkRow[],
  snapshots: Array<Record<string, unknown>>,
  input: { referenceCompanyName: string; macroIndustryKey: string },
): Promise<{ outcome: PublicBuyerStepOutcome; written: CountrySourceCompany[]; recorded: CountrySourceCompany[] }> {
  const client = fakeClient({ public_procurement_supplier_links: [...links] as Array<Record<string, unknown>>, source_company_snapshots: snapshots });
  const written: CountrySourceCompany[] = [];
  const recorded: CountrySourceCompany[] = [];
  const outcome = await runPublicBuyerSupplierStep(
    { batchId: 'b1', countryCode: country.countryCode, nowIso: '2026-10-15T00:00:00Z', ...input },
    {
      ...buildLoadedLinksLookups(country, client),
      writeWithWebsite: async (companies) => (written.push(...companies), { written: companies.length, failed: false }),
      recordWithoutWebsite: async (companies) => (recorded.push(...companies), companies.length),
    },
  );
  return { outcome, written, recorded };
}
