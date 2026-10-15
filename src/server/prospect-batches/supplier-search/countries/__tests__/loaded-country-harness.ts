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

/** Doble de Supabase: filtra por `eq` y `like` (prefijo) sobre las filas de cada tabla. */
export function fakeClient(dataByTable: Record<string, Array<Record<string, unknown>>>): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'in', 'or', 'order', 'limit']) builder[op] = () => builder;
      builder.eq = (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder);
      builder.like = (column: string, pattern: string) => {
        const prefix = pattern.replace(/%$/, '');
        filters.push((row) => String(row[column] ?? '').startsWith(prefix));
        return builder;
      };
      builder.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: (dataByTable[table] ?? []).filter((row) => filters.every((f) => f(row))), error: null });
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
