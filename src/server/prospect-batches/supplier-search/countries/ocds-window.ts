/**
 * Lector OCDS por ventana para los países «loaded» que publican en el OCP Data Registry
 * (Perú, Honduras, Guatemala). SÓLO lo usa el cargador (Node).
 *
 * El contrato de `ProcurementLoaderSource.readLines` no recibe la ventana, y estos países
 * publican por año de versión (Honduras, Guatemala) o toda la historia en un archivo
 * (Perú), así que:
 *  1. `files(end, months)` guarda la ventana y cuál es el último archivo;
 *  2. cada versión (release) se reduce a sus líneas de la ventana y se guarda por `ocid`
 *     (si el mismo proceso sale en dos años, gana el archivo más nuevo: va después);
 *  3. se juntan los números fiscales de TODOS los compradores vistos;
 *  4. al terminar el último archivo se emiten las líneas, sin los proveedores que también
 *     son compradores (otras entidades públicas: convenios entre entidades).
 */

import { basename } from 'node:path';
import type { ProcurementLine } from '../procurement-links';
import { monthsBack, readJsonLinesGz } from './loader-io';
import type { LoadedCountrySource, ProcurementLoaderSource } from './types';

/** Ventana de fechas AAAA-MM-DD (ambas inclusive). */
export type OcdsWindow = { start: string; end: string };

export function ocdsWindow(end: { year: number; month: number }, months: number): OcdsWindow {
  const first = monthsBack(end, months)[0];
  const last = new Date(Date.UTC(end.year, end.month, 0)).toISOString().slice(0, 10);
  return { start: `${first.year}-${String(first.month).padStart(2, '0')}-01`, end: last };
}

/** «2026-03-04T00:00:00-06:00» → «2026-03-04» si cae en la ventana; si no, `null`. */
export function dateInWindow(raw: unknown, window: OcdsWindow): string | null {
  const date = typeof raw === 'string' ? raw.slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= window.start && date <= window.end ? date : null;
}

/** Lo que una versión OCDS aporta: sus líneas en la ventana y sus compradores. */
export type OcdsReleaseLines = { ocid: string; lines: ProcurementLine[]; buyerTaxIds: readonly string[] };

export type OcdsReleaseReader = (release: Record<string, unknown>, window: OcdsWindow) => OcdsReleaseLines | null;

/** Reparte `amount` entre familias según su peso (sin pesos ⇒ partes iguales). */
export function splitByFamily(amount: number, weights: ReadonlyArray<{ family: string | null; weight: number }>): Array<{ family: string | null; amount: number }> {
  if (weights.length === 0) return [{ family: null, amount }];
  const total = weights.reduce((sum, w) => sum + (w.weight > 0 ? w.weight : 0), 0);
  const byFamily = new Map<string | null, number>();
  for (const w of weights) {
    const share = total > 0 ? (w.weight > 0 ? w.weight / total : 0) : 1 / weights.length;
    byFamily.set(w.family, (byFamily.get(w.family) ?? 0) + amount * share);
  }
  return [...byFamily.entries()].filter(([, a]) => a > 0 || amount === 0).map(([family, a]) => ({ family, amount: a }));
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((v): v is Record<string, unknown> => v !== null) : [];
}

export function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function asAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Lector de un país OCDS: ver la cabecera. */
export function createOcdsWindowLoader(input: {
  country: LoadedCountrySource;
  files: (end: { year: number; month: number }, months: number) => Array<{ url: string; name: string }>;
  readRelease: OcdsReleaseReader;
}): ProcurementLoaderSource {
  let window: OcdsWindow | null = null;
  let lastFile: string | null = null;
  let byOcid = new Map<string, ProcurementLine[]>();
  let buyerTaxIds = new Set<string>();

  return {
    country: input.country,
    files: (end, months) => {
      const list = input.files(end, months);
      window = ocdsWindow(end, months);
      lastFile = list.at(-1)?.name ?? null;
      byOcid = new Map();
      buyerTaxIds = new Set();
      return list;
    },
    readLines: async (filePath, onLine) => {
      const current = window;
      if (!current || !lastFile) throw new Error('ocds_window_unset: llama a files() antes de readLines()');
      await readJsonLinesGz(filePath, (value) => {
        const release = asRecord(value);
        const read = release ? input.readRelease(release, current) : null;
        if (!read) return;
        for (const taxId of read.buyerTaxIds) buyerTaxIds.add(taxId);
        if (read.lines.length > 0) byOcid.set(read.ocid, read.lines);
        else byOcid.delete(read.ocid);
      });
      if (basename(filePath) !== lastFile) return;
      for (const lines of byOcid.values()) {
        for (const line of lines) if (!buyerTaxIds.has(line.supplierTaxId)) onLine(line);
      }
      byOcid = new Map();
      buyerTaxIds = new Set();
    },
  };
}
