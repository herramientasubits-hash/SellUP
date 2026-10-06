/**
 * Lectura de los archivos públicos de Ecuador para los ETL (SOURCES-EC-CLOSE-1).
 *
 * Sólo lee archivos LOCALES ya descargados; nunca sale a la red ni escribe.
 *   - Directorio de compañías de la Superintendencia (`directorio_companias.xlsx`).
 *   - Ranking empresarial de la Superintendencia (`bi_ranking.csv`).
 *   - Catastro de RUC del SRI por provincia (`SRI_RUC_<Provincia>.csv`, «|»).
 *   - Entregas OCDS de SERCOP (`<año>.jsonl.gz`, data.open-contracting.org/110).
 */

import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import * as XLSX from 'xlsx';

import {
  latestRanking,
  readEcDirectoryRecord,
  readEcRankingLine,
  type EcDirectoryRecord,
  type EcRankingMetrics,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-directory-rows';
import {
  admitEcRegistryCompany,
  pickEcRegistryEntry,
  type EcRegistryEntry,
} from '../../src/server/source-catalog/connectors/ec-scvs/ec-scvs-registry-rows';
import { readSercopPartyUrls, type EcSercopPartyUrl } from '../../src/server/source-catalog/connectors/ec-scvs/ec-sercop-domain';
import { readCsvFile } from '../../src/server/source-catalog/connectors/rns-argentina/streaming-csv';

/** Valor de `--nombre=…`, o `null`. */
export function argValue(argv: readonly string[], name: string): string | null {
  const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/** Lista separada por comas de archivos que deben existir. */
export function existingFiles(value: string | null, flag: string): string[] {
  if (value === null || value.trim() === '') return [];
  const files = value.split(',').map((f) => f.trim()).filter((f) => f.length > 0);
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`config_invalid: falta ${file} (--${flag})`);
  }
  return files;
}

/** El directorio trae filas de título antes de la cabecera: se busca la fila con «RUC». */
export function readEcDirectory(path: string): EcDirectoryRecord[] {
  const workbook = XLSX.readFile(path, { dense: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
  const headerIndex = matrix.findIndex((cells) => Array.isArray(cells) && cells.includes('RUC'));
  if (headerIndex < 0) throw new Error('config_invalid: el directorio no tiene la cabecera con «RUC»');
  const header = (matrix[headerIndex] as unknown[]).map((cell) => String(cell).trim());

  const records: EcDirectoryRecord[] = [];
  for (const cells of matrix.slice(headerIndex + 1)) {
    const row: Record<string, unknown> = {};
    header.forEach((name, i) => {
      row[name] = (cells as unknown[])[i];
    });
    const record = readEcDirectoryRecord(row);
    if (record !== null) records.push(record);
  }
  return records;
}

/** Expediente → su último año en el ranking. */
export async function readEcRanking(path: string): Promise<Map<string, EcRankingMetrics>> {
  const latest = new Map<string, EcRankingMetrics>();
  for await (const row of readCsvFile(path)) {
    const parsed = readEcRankingLine(row);
    if (parsed === null) continue;
    const [expediente, metrics] = parsed;
    latest.set(expediente, latestRanking(latest.get(expediente), metrics));
  }
  return latest;
}

/**
 * Filas de un CSV del SRI («|», sin comillas) como objetos por cabecera. Una fila
 * con otro número de columnas (una «|» dentro de un nombre) se salta.
 */
export async function* readSriCsv(path: string): AsyncGenerator<Record<string, string>> {
  const lines = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header: string[] | null = null;
  for await (const line of lines) {
    if (line.trim() === '') continue;
    const cells = line.split('|');
    if (header === null) {
      header = cells.map((cell) => cell.replace(/^﻿/, '').trim());
      continue;
    }
    if (cells.length !== header.length) continue;
    const row: Record<string, string> = {};
    header.forEach((name, i) => {
      row[name] = cells[i];
    });
    yield row;
  }
}

/** Partes con RUC de las entregas OCDS de SERCOP (`.jsonl.gz`). */
export async function readSercopParties(paths: readonly string[]): Promise<EcSercopPartyUrl[]> {
  const parties: EcSercopPartyUrl[] = [];
  for (const path of paths) {
    const lines = createInterface({ input: createReadStream(path).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.trim() === '') continue;
      try {
        parties.push(...readSercopPartyUrls(JSON.parse(line)));
      } catch {
        /* línea rota: se salta */
      }
    }
  }
  return parties;
}

/** Compañías ACTIVAS con RUC de sociedad, una por RUC, con su último año del ranking. */
export async function loadEcRegistryEntries(
  directoryPath: string,
  rankingPath: string,
): Promise<Map<string, EcRegistryEntry>> {
  const directory = readEcDirectory(directoryPath);
  const ranking = await readEcRanking(rankingPath);
  const entries = new Map<string, EcRegistryEntry>();
  for (const record of directory) {
    const ruc = admitEcRegistryCompany(record);
    if (ruc === null) continue;
    entries.set(ruc, pickEcRegistryEntry(entries.get(ruc), { record, metrics: ranking.get(record.expediente) ?? null }));
  }
  return entries;
}
