/**
 * streaming-csv.ts — lector CSV por partes (RFC 4180) para archivos que no caben
 * en memoria (el Registro Nacional de Sociedades pesa ~890 MB descomprimido).
 *
 * SOURCES-AR-RNS-1. Puro salvo `readCsvFile`, que sólo LEE un archivo local.
 *
 * Soporta comillas dobles, comillas escapadas (""), comas y saltos de línea
 * dentro de un campo entrecomillado, CRLF y LF, y un BOM inicial. No interpreta
 * tipos: todo es texto.
 */

import { createReadStream } from 'node:fs';

/** Analizador incremental: alimenta trozos de texto, recibe filas completas. */
export class CsvRowParser {
  private field = '';
  private row: string[] = [];
  private inQuotes = false;
  private pendingQuote = false; // vimos una comilla dentro de comillas
  private pendingCr = false;
  private started = false;

  /** `delimiter`: «,» por defecto; el RUPE de Uruguay usa «;» (SOURCES-UY-RUT-BY-NAME-1). */
  constructor(private readonly delimiter: string = ',') {}

  /** Procesa un trozo y devuelve las filas que quedaron completas. */
  push(chunk: string): string[][] {
    const rows: string[][] = [];
    let text = chunk;
    if (!this.started) {
      this.started = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (this.pendingCr) {
        this.pendingCr = false;
        if (ch === '\n') continue; // el LF de un CRLF ya cerró la fila
      }

      if (this.inQuotes) {
        if (this.pendingQuote) {
          this.pendingQuote = false;
          if (ch === '"') {
            this.field += '"';
            continue;
          }
          this.inQuotes = false; // la comilla anterior cerraba el campo; sigue normal
        } else if (ch === '"') {
          this.pendingQuote = true;
          continue;
        } else {
          this.field += ch;
          continue;
        }
      }

      if (ch === '"' && this.field === '') {
        this.inQuotes = true;
      } else if (ch === this.delimiter) {
        this.row.push(this.field);
        this.field = '';
      } else if (ch === '\n' || ch === '\r') {
        this.row.push(this.field);
        this.field = '';
        rows.push(this.row);
        this.row = [];
        if (ch === '\r') this.pendingCr = true;
      } else {
        this.field += ch;
      }
    }
    return rows;
  }

  /** Cierra el archivo: devuelve la última fila si no terminaba en salto de línea. */
  end(): string[][] {
    if (this.pendingQuote) {
      this.pendingQuote = false;
      this.inQuotes = false;
    }
    if (this.field !== '' || this.row.length > 0) {
      this.row.push(this.field);
      const last = this.row;
      this.field = '';
      this.row = [];
      return [last];
    }
    return [];
  }
}

/**
 * Lee un CSV local fila a fila. La primera fila es la cabecera y cada fila se
 * entrega como objeto columna → valor. Las filas vacías se saltan.
 */
export async function* readCsvFile(
  path: string,
  options: { delimiter?: string } = {},
): AsyncGenerator<Record<string, string>, void, undefined> {
  const parser = new CsvRowParser(options.delimiter ?? ',');
  let header: string[] | null = null;

  const toRecord = function* (rows: string[][]) {
    for (const cells of rows) {
      if (cells.length === 1 && cells[0] === '') continue;
      if (header === null) {
        header = cells.map((cell) => cell.trim());
        continue;
      }
      const record: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) record[header[i]] = cells[i] ?? '';
      yield record;
    }
  };

  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 1 << 20 });
  for await (const chunk of stream) {
    yield* toRecord(parser.push(chunk as string));
  }
  yield* toRecord(parser.end());
}
