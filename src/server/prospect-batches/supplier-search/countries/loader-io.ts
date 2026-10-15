/**
 * AGENT1-SUPPLIER-SEARCH-ALL-1 — utilidades de lectura para los lectores de los países
 * «loaded». SÓLO las usa el cargador (Node): nunca se importan desde la app.
 *
 *  - `readZipCsv`: CSV dentro de un zip (latin-1 o utf-8, cualquier separador), fila a fila.
 *  - `readJsonLinesGz`: JSONL comprimido con gzip (OCDS del OCP Data Registry), objeto a objeto.
 *  - `readZipEntries`: cada archivo de un zip (p. ej. un JSON OCDS por mes), como texto.
 *
 * Usan `unzip` del sistema (macOS/Linux) para no cargar archivos de cientos de MB en memoria.
 */

import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { CsvRowParser } from '@/server/source-catalog/connectors/rns-argentina/streaming-csv';

/** Meses de la ventana, del más viejo al más nuevo, terminando en `end`. */
export function monthsBack(end: { year: number; month: number }, months: number): Array<{ year: number; month: number }> {
  const out: Array<{ year: number; month: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const index = end.year * 12 + (end.month - 1) - i;
    out.push({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  }
  return out;
}

async function* unzipStream(file: string, entry?: string): AsyncGenerator<Buffer> {
  const child = spawn('unzip', entry ? ['-p', file, entry] : ['-p', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  for await (const chunk of child.stdout) yield chunk as Buffer;
  const code: number = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`unzip_failed:${file}:${code}`);
}

/** Lee el CSV de un zip y entrega cada fila como objeto columna → valor. */
export async function readZipCsv(
  file: string,
  options: { encoding: 'latin1' | 'utf-8'; delimiter: string; entry?: string },
  onRecord: (record: Record<string, string>) => void,
): Promise<void> {
  const decoder = new TextDecoder(options.encoding);
  const parser = new CsvRowParser(options.delimiter);
  let header: string[] | null = null;
  const feed = (rows: string[][]) => {
    for (const cells of rows) {
      if (cells.length === 1 && cells[0] === '') continue;
      if (header === null) {
        header = cells.map((c) => c.trim().replace(/^﻿/, ''));
        continue;
      }
      const record: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) record[header[i]] = cells[i] ?? '';
      onRecord(record);
    }
  };
  for await (const chunk of unzipStream(file, options.entry)) feed(parser.push(decoder.decode(chunk, { stream: true })));
  feed(parser.push(decoder.decode()));
  feed(parser.end());
}

/** Lee un JSONL.gz línea a línea (cada línea un objeto JSON). Las líneas rotas se saltan. */
export async function readJsonLinesGz(file: string, onObject: (value: unknown) => void): Promise<void> {
  const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      onObject(JSON.parse(line));
    } catch {
      // Línea corrupta: se ignora (el resumen es grueso, no contable).
    }
  }
}

/** Lista los archivos de un zip. */
export async function listZipEntries(file: string): Promise<string[]> {
  const child = spawn('unzip', ['-Z1', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  for await (const chunk of child.stdout) out += String(chunk);
  const code: number = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`unzip_list_failed:${file}:${code}`);
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Entrega cada archivo del zip (filtrado) como texto completo. Para JSON de pocos MB por archivo. */
export async function readZipEntries(
  file: string,
  include: (entry: string) => boolean,
  onEntry: (entry: string, text: string) => void,
): Promise<void> {
  for (const entry of (await listZipEntries(file)).filter(include)) {
    const chunks: Buffer[] = [];
    for await (const chunk of unzipStream(file, entry)) chunks.push(chunk);
    onEntry(entry, Buffer.concat(chunks).toString('utf-8'));
  }
}
