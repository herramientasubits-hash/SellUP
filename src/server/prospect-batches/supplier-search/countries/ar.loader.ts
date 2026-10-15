/**
 * Argentina — lector de «Adjudicaciones 2016-2026» de COMPR.AR (datos.gob.ar) para el
 * cargador genérico (`--country AR`). Es UN solo CSV (88 MB, refresco semestral) con toda
 * la historia: la ventana se filtra por `Fecha_de_Adjudicacion` (la fija `files()`).
 *
 * Sólo «Proceso de Compra» («Genera Recursos» = el Estado vende) y sólo CUIT de empresa
 * válidos (30/33/34, dígito verificador; los de 12 dígitos se corrigen o se descartan),
 * sin organismos públicos. El monto de una línea con varios rubros se reparte en partes
 * iguales entre ellos; las monedas extranjeras pasan a pesos con `AR_ARS_PER`.
 */

import { createReadStream } from 'node:fs';
import { CsvRowParser } from '@/server/source-catalog/connectors/rns-argentina/streaming-csv';
import type { ProcurementLine } from '../procurement-links';
import { AR_ARS_PER, AR_COUNTRY, isArCompanyCuit, isArPublicBodyName, parseArCuit } from './ar';
import { normalizeArRubro, splitArRubros } from './ar-rubro-macro-table';
import { monthsBack } from './loader-io';
import type { ProcurementLoaderSource } from './types';

export const AR_COMPRAR_ADJUDICATIONS_URL =
  'https://infra.datos.gob.ar/catalog/jgm/dataset/4/distribution/4.22/download/Adjudicaciones.csv';

/** «28/12/2016 04:05:45 p.m.» → «2016-12-28». */
export function parseArDate(raw: string | null | undefined): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((raw ?? '').trim());
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

/** Monto del CSV («1230000.00») en pesos, o 0. */
export function arAmountInPesos(amountRaw: string | null | undefined, currencyRaw: string | null | undefined): number {
  const amount = Number((amountRaw ?? '').trim());
  const rate = AR_ARS_PER[normalizeArRubro(currencyRaw) ?? ''];
  return Number.isFinite(amount) && amount > 0 && rate !== undefined ? amount * rate : 0;
}

/** Una fila del CSV → líneas en formato común (una por rubro), o ninguna. */
export function arLinesFromRecord(r: Record<string, string>, window: { start: string; end: string } | null): ProcurementLine[] {
  if ((r['Tipo_de_Operacion'] ?? '').trim() !== 'Proceso de Compra') return [];
  const date = parseArDate(r['Fecha_de_Adjudicacion']);
  if (window && (!date || date < window.start || date > window.end)) return [];
  const cuit = parseArCuit(r['CUIT']);
  const supplierName = (r['Descripcion_Proveedor'] ?? '').trim();
  if (!cuit || !isArCompanyCuit(cuit) || isArPublicBodyName(supplierName)) return [];
  const saf = (r['Nro_SAF'] ?? '').trim();
  const buyerName = (r['Descripcion_SAF'] ?? '').replace(/^\s*\d+\s*-\s*/, '').trim();
  const orderCode = (r['Documento_Contractual'] ?? '').trim() || (r['Numero_Proceso'] ?? '').trim();
  if (!saf || !buyerName || !orderCode) return [];
  const amount = arAmountInPesos(r['Monto'], r['Moneda']);
  const rubros = splitArRubros(r['Rubros']);
  const parts: Array<string | null> = rubros.length > 0 ? rubros : [null];
  return parts.map((rubro) => ({
    buyerCode: `SAF-${saf}`,
    buyerName,
    supplierTaxId: cuit,
    supplierName,
    amount: amount / parts.length,
    orderCode,
    orderUrl: null,
    date,
    classificationKey: rubro,
  }));
}

function lastDay(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Lector con su ventana (la fija `files()`, que el cargador llama antes de leer). */
export function createArLoader(): ProcurementLoaderSource {
  let window: { start: string; end: string } | null = null;
  return {
    country: AR_COUNTRY,
    files: (end, months) => {
      const first = monthsBack(end, months)[0];
      window = { start: `${first.year}-${String(first.month).padStart(2, '0')}-01`, end: lastDay(end.year, end.month) };
      // El archivo se baja con la fecha de la ventana en el nombre: una recarga posterior baja el nuevo.
      return [{ url: AR_COMPRAR_ADJUDICATIONS_URL, name: `ar-adjudicaciones-hasta-${end.year}-${end.month}.csv` }];
    },
    readLines: async (filePath, onLine) => {
      // Se juntan las líneas de la ventana (unas 40 mil) para nombrar cada SAF como en su
      // adjudicación MÁS RECIENTE: el SAF 310 se llamó «Secretaría de Gobierno de Salud» y
      // hoy es «Ministerio de Salud» (el agregador se queda con el primer nombre que ve).
      const lines: ProcurementLine[] = [];
      const latestName = new Map<string, { date: string; name: string }>();
      const decoder = new TextDecoder('utf-8');
      const parser = new CsvRowParser(',');
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
          for (const line of arLinesFromRecord(record, window)) {
            lines.push(line);
            const seen = latestName.get(line.buyerCode);
            const date = line.date ?? '';
            if (!seen || date >= seen.date) latestName.set(line.buyerCode, { date, name: line.buyerName });
          }
        }
      };
      for await (const chunk of createReadStream(filePath)) feed(parser.push(decoder.decode(chunk as Buffer, { stream: true })));
      feed(parser.push(decoder.decode()));
      feed(parser.end());
      for (const line of lines) onLine({ ...line, buyerName: latestName.get(line.buyerCode)?.name ?? line.buyerName });
    },
  };
}

export const AR_LOADER: ProcurementLoaderSource = createArLoader();
