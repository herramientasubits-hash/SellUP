/**
 * Costa Rica — lector de SICOP «Datos abiertos concursos» para el cargador genérico
 * (`scripts/source-catalog/run-public-procurement-load.ts --country CR`).
 *
 * El CSV mensual (`;`, UTF-8, una línea de título antes del encabezado) trae por línea
 * de adjudicación: procedimiento, institución (nombre), adjudicatario (nombre), monto
 * en colones y estado. Reglas:
 *  - Sólo estados con adjudicación en firme o en ejecución: «Contrato», «Acto Final en
 *    Firme», «Adjudicado», «Finiquitado». Fuera «En evaluación», apelaciones, nulidades,
 *    infructuosos.
 *  - Una misma línea (procedimiento × partida × línea × adjudicatario) se repite con otro
 *    tipo de cambio: se cuenta una vez.
 *  - Adjudicatario → cédula jurídica por nombre (`matchCrSupplier`, fuerte y única)
 *    contra el índice del registro; sin cédula de empresa, la línea no entra.
 *  - Sin fecha por línea: la ventana la dan los archivos mensuales (fecha = null).
 *
 * El índice del registro (`cr-registry-name-index.tsv`: `núcleo<TAB>cédula`, de
 * `cr_company_registry` + `cr_company_name_alias`) vive junto a los CSV. Si falta y hay
 * credenciales de servicio en el entorno, se arma con un SELECT de sólo lectura; si no,
 * el lector se detiene y explica cómo armarlo.
 */

import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { CsvRowParser } from '@/server/source-catalog/connectors/rns-argentina/streaming-csv';
import type { ProcurementLine } from '../procurement-links';
import { normalizePublicEntityName } from '../public-buyer-suppliers';
import { CR_COUNTRY, crSicopMonthUrl, matchCrSupplier, type CrNameIndex, type CrSupplierMatch } from './cr';
import { monthsBack } from './loader-io';
import type { ProcurementLoaderSource } from './types';

export const CR_NAME_INDEX_FILE = 'cr-registry-name-index.tsv';
const CR_INDEX_SOURCE_KEYS = ['cr_company_registry', 'cr_company_name_alias'] as const;
const INDEX_PAGE = 1000;

const VALID_STATES = new Set(['contrato', 'acto final en firme', 'adjudicado', 'finiquitado']);

/** «1234567.89» → número (vacío o inválido → 0). */
export function parseCrAmount(raw: string | undefined): number {
  const n = Number((raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Índice `núcleo → cédulas` desde el texto del TSV. */
export function parseCrNameIndex(text: string): CrNameIndex {
  const index = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    const [key, cedula] = line.split('\t').map((c) => c?.trim() ?? '');
    if (!key || !/^\d{10}$/.test(cedula)) continue;
    const list = index.get(key) ?? [];
    if (!list.includes(cedula)) list.push(cedula);
    index.set(key, list);
  }
  return index;
}

/** Cuenta de lo que pasó con los adjudicatarios de un archivo (para el reporte del cargador). */
export type CrMatchStats = Record<'lines' | 'name' | 'cedula_in_name' | Extract<CrSupplierMatch, { cedula: null }>['reason'], number>;

export function emptyCrMatchStats(): CrMatchStats {
  return { lines: 0, name: 0, cedula_in_name: 0, no_legal_form: 0, public_entity: 0, not_found: 0, ambiguous: 0, not_company: 0 };
}

/** Filas del CSV (ya como objetos) → líneas de proveedores empresa (puro, para las pruebas). */
export function crLinesFromRecords(
  records: Iterable<Record<string, string>>,
  index: CrNameIndex,
  onLine: (line: ProcurementLine) => void,
  stats: CrMatchStats = emptyCrMatchStats(),
): CrMatchStats {
  const seen = new Set<string>();
  const matches = new Map<string, CrSupplierMatch>();
  for (const r of records) {
    if (!VALID_STATES.has((r['Estado de procedimiento'] ?? '').trim().toLowerCase())) continue;
    const procedure = (r['Numero procedimiento'] ?? '').trim();
    const supplierName = (r['Adjudicatario'] ?? '').replace(/\s+/g, ' ').trim();
    const institution = (r['Institucion'] ?? '').replace(/\s+/g, ' ').trim();
    if (!procedure || !supplierName || !institution) continue;
    const lineKey = `${procedure}|${r['Partida']}|${r['Numero de línea']}|${supplierName}`;
    if (seen.has(lineKey)) continue;
    seen.add(lineKey);
    stats.lines += 1;
    const match = matches.get(supplierName) ?? matchCrSupplier(supplierName, index);
    matches.set(supplierName, match);
    if (match.cedula === null) {
      stats[match.reason] += 1;
      continue;
    }
    stats[match.by] += 1;
    const buyerName = normalizePublicEntityName(institution);
    onLine({
      // La institución viene sólo por nombre: el nombre normalizado es su código.
      buyerCode: buyerName,
      buyerName: institution,
      supplierTaxId: match.cedula,
      supplierName,
      amount: parseCrAmount(r['Monto adjudicado en colones']),
      orderCode: procedure,
      orderUrl: null,
      date: null,
      classificationKey: null,
    });
  }
  return stats;
}

/** Lee el CSV de SICOP fila a fila (salta la línea de título). */
async function readSicopCsv(file: string, onRecord: (record: Record<string, string>) => void): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  const parser = new CsvRowParser(';');
  let header: string[] | null = null;
  const feed = (rows: string[][]) => {
    for (const cells of rows) {
      if (header === null) {
        if ((cells[0] ?? '').replace(/^﻿/, '').trim() === 'Descripcion') header = cells.map((c) => c.trim());
        continue;
      }
      if (cells.length < 2) continue;
      const record: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) if (header[i]) record[header[i]] = cells[i] ?? '';
      onRecord(record);
    }
  };
  for await (const chunk of createReadStream(file)) feed(parser.push(decoder.decode(chunk as Buffer, { stream: true })));
  feed(parser.push(decoder.decode()));
  feed(parser.end());
}

/** Arma el índice con un SELECT de sólo lectura (PostgREST, service_role del entorno). */
async function fetchCrNameIndexTsv(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const lines: string[] = [];
  for (let offset = 0; ; offset += INDEX_PAGE) {
    const query = new URLSearchParams({
      select: 'normalized_legal_name,normalized_tax_id',
      country_code: 'eq.CR',
      source_key: `in.(${CR_INDEX_SOURCE_KEYS.join(',')})`,
      order: 'normalized_tax_id.asc,normalized_legal_name.asc',
      limit: String(INDEX_PAGE),
      offset: String(offset),
    });
    const response = await fetch(`${url}/rest/v1/source_company_snapshots?${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(`cr_name_index_fetch_failed:${response.status}`);
    const page = (await response.json()) as Array<{ normalized_legal_name: string | null; normalized_tax_id: string | null }>;
    for (const row of page) if (row.normalized_legal_name && row.normalized_tax_id) lines.push(`${row.normalized_legal_name}\t${row.normalized_tax_id}`);
    if (page.length < INDEX_PAGE) break;
  }
  return lines.join('\n');
}

const indexByDir = new Map<string, CrNameIndex>();

async function loadCrNameIndex(dir: string): Promise<CrNameIndex> {
  const cached = indexByDir.get(dir);
  if (cached) return cached;
  const path = join(dir, CR_NAME_INDEX_FILE);
  if (!existsSync(path)) {
    const tsv = await fetchCrNameIndexTsv();
    if (tsv === null) {
      throw new Error(
        `Falta ${path}. Ármalo (sólo lectura) con: SELECT normalized_legal_name, normalized_tax_id FROM source_company_snapshots WHERE country_code='CR' AND source_key IN ('cr_company_registry','cr_company_name_alias') — una fila por línea, separadas por TAB — o corre el cargador con --env-dir (service_role) para que lo arme solo.`,
      );
    }
    writeFileSync(path, tsv);
  }
  const index = parseCrNameIndex(readFileSync(path, 'utf-8'));
  indexByDir.set(dir, index);
  return index;
}

export const CR_LOADER: ProcurementLoaderSource = {
  country: CR_COUNTRY,
  files: (end, months) =>
    monthsBack(end, months).map(({ year, month }) => ({ url: crSicopMonthUrl(year, month), name: `cr-${year}-${String(month).padStart(2, '0')}.csv` })),
  readLines: async (filePath, onLine) => {
    const index = await loadCrNameIndex(dirname(filePath));
    const records: Record<string, string>[] = [];
    await readSicopCsv(filePath, (r) => records.push(r));
    const s = crLinesFromRecords(records, index, onLine);
    console.log(
      `    ${basename(filePath)}: ${s.lines} líneas adjudicadas · cédula por nombre ${s.name} · escrita ${s.cedula_in_name} · ` +
        `sin forma societaria ${s.no_legal_form} · no está ${s.not_found} · ambigua ${s.ambiguous} · pública/no empresa ${s.public_entity + s.not_company}`,
    );
  },
};
