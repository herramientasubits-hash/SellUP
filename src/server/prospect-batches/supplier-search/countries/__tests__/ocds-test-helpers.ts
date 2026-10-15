/**
 * Ayudas de prueba de los países OCDS «loaded» (Perú, Honduras, Guatemala): escribir
 * versiones en un JSONL.gz temporal, pasarlas por el lector y el agregador, y servir las
 * filas resultantes con un doble mínimo de Supabase para correr el paso de punta a punta.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ProcurementLinksAggregator, type ProcurementLine, type ProcurementLinkRow } from '../../procurement-links';
import type { ProcurementLoaderSource } from '../types';

/** Escribe cada archivo (nombre → versiones) como JSONL.gz en una carpeta temporal. */
export function writeGzFiles(files: Record<string, unknown[]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ocds-test-'));
  for (const [name, releases] of Object.entries(files)) {
    writeFileSync(join(dir, name), gzipSync(releases.map((r) => JSON.stringify(r)).join('\n')));
  }
  return dir;
}

/** Corre el lector sobre los archivos de la ventana (deben existir en `dir`). */
export async function readWindow(
  loader: ProcurementLoaderSource,
  dir: string,
  end: { year: number; month: number },
  months: number,
): Promise<ProcurementLine[]> {
  const lines: ProcurementLine[] = [];
  for (const file of loader.files(end, months)) await loader.readLines(join(dir, file.name), (line) => lines.push(line));
  return lines;
}

export function aggregate(loader: ProcurementLoaderSource, lines: readonly ProcurementLine[], window: { start: string; end: string }): ProcurementLinkRow[] {
  const { country } = loader;
  const agg = new ProcurementLinksAggregator({
    countryCode: country.countryCode,
    sourceKey: country.sourceKey,
    currency: country.currency,
    normalizeBuyerName: country.normalizeBuyerName,
  });
  for (const line of lines) agg.add(line);
  return agg.rows({ windowStart: window.start, windowEnd: window.end, minPairAmount: country.minPairAmount });
}

/** Doble mínimo del cliente de Supabase: devuelve las filas de cada tabla sin filtrar. */
export function fakeClient(dataByTable: Record<string, unknown[]>): SupabaseClient {
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const op of ['select', 'eq', 'in', 'like', 'or', 'order', 'limit']) builder[op] = () => builder;
      builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: dataByTable[table] ?? [], error: null });
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}
