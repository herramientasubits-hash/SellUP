/**
 * México — lector de «Contratos de la Plataforma Integral Compras MX» (un CSV por año,
 * latin-1, coma, 73 columnas) para el cargador genérico (`--country MX`).
 *
 * DESCARGA A MANO: el portal (comprasmx.buengobierno.gob.mx/datos-abiertos) firma cada
 * descarga en el navegador como protección antibots; no se imita desde un script. La
 * persona baja «Contratos … Compras MX <año>» y deja `contratos_comprasmx_<año>.csv` en
 * ~/Documents/SellUp-data/public-procurement/mx/; el cargador sólo lee esos archivos.
 *
 * Sólo personas morales mexicanas (RFC de 12), sin entidades públicas ni proveedores
 * MICRO/PEQUEÑA. Ventana por la fecha de firma del contrato (o la de inicio si falta).
 * El monto de una línea con varias partidas se reparte en partes iguales; un mismo
 * contrato que salga en los dos archivos cuenta una vez.
 */

import { createReadStream } from 'node:fs';
import { CsvRowParser } from '@/server/source-catalog/connectors/rns-argentina/streaming-csv';
import type { ProcurementLine } from '../procurement-links';
import { MX_COUNTRY, MX_MXN_PER, isMxPublicBodyName, isMxSmallStratification, parseMxCompanyRfc } from './mx';
import { MX_HEALTH_INTEGRATED_SERVICES_FAMILY, splitMxPartidas } from './mx-partida-macro-table';
import { monthsBack } from './loader-io';
import type { ProcurementLoaderSource } from './types';

export const MX_COMPRASMX_OPEN_DATA_PAGE = 'https://comprasmx.buengobierno.gob.mx/datos-abiertos';

/** Ramos de salud: Salud, IMSS, ISSSTE y Servicios de Salud del IMSS-Bienestar. */
const MX_HEALTH_RAMOS = new Set(['12', '50', '51', '56']);

/** «2026-03-23 00:00:00» o «24/03/2026» → «2026-03-23». */
export function parseMxDate(signed: string | null | undefined, start: string | null | undefined): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec((signed ?? '').trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec((start ?? '').trim());
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null;
}

/** «Importe DRC» en pesos («63666.95», moneda «MXN»), o 0. */
export function mxAmountInPesos(amountRaw: string | null | undefined, currencyRaw: string | null | undefined): number {
  const amount = Number((amountRaw ?? '').replace(/,/g, '').trim());
  const rate = MX_MXN_PER[(currencyRaw ?? '').trim().toUpperCase() || 'MXN'];
  return Number.isFinite(amount) && amount > 0 && rate !== undefined ? amount * rate : 0;
}

function httpsOrNull(raw: string | null | undefined): string | null {
  const url = (raw ?? '').trim();
  return url.startsWith('https://') ? url : null;
}

/** Una fila del CSV → líneas en formato común (una por partida genérica), o ninguna. */
export function mxLinesFromRecord(r: Record<string, string>, window: { start: string; end: string } | null): ProcurementLine[] {
  const date = parseMxDate(r['Fecha de firma del contrato'], r['Fecha de inicio del contrato']);
  if (window && (!date || date < window.start || date > window.end)) return [];
  const rfc = parseMxCompanyRfc(r['rfc'], r['País de la empresa']);
  const supplierName = (r['Proveedor o contratista'] ?? '').trim();
  if (!rfc || !supplierName || isMxPublicBodyName(supplierName) || isMxSmallStratification(r['Estratificación'])) return [];
  const buyerCode = (r['Clave Institución'] ?? '').trim();
  const buyerName = (r['Institución'] ?? '').trim();
  const orderCode = (r['Código del contrato'] ?? '').trim() || (r['Núm. del contrato'] ?? '').trim();
  if (!buyerCode || !buyerName || !orderCode) return [];
  const amount = mxAmountInPesos(r['Importe DRC'], r['Moneda']);
  const healthBuyer = MX_HEALTH_RAMOS.has((r['Clave Ramo'] ?? '').trim());
  const families = splitMxPartidas(r['Partida específica']).map((f) => (f === '339' && healthBuyer ? MX_HEALTH_INTEGRATED_SERVICES_FAMILY : f));
  const parts: Array<string | null> = families.length > 0 ? families : [null];
  return parts.map((family) => ({
    buyerCode,
    buyerName,
    supplierTaxId: rfc,
    supplierName,
    amount: amount / parts.length,
    orderCode,
    orderUrl: httpsOrNull(r['Dirección del anuncio']),
    date,
    classificationKey: family,
  }));
}

function lastDay(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Lee un CSV latin-1 fila a fila. Columnas repetidas («Moneda»): gana la PRIMERA (la del importe). */
async function readLatin1Csv(filePath: string, onRecord: (record: Record<string, string>) => void): Promise<void> {
  const decoder = new TextDecoder('latin1');
  const parser = new CsvRowParser(',');
  let header: string[] | null = null;
  const feed = (rows: string[][]) => {
    for (const cells of rows) {
      if (cells.length === 1 && cells[0] === '') continue;
      if (header === null) {
        header = cells.map((c) => c.trim().replace(/^﻿/, ''));
        if (!header.includes('rfc') || !header.includes('Clave Institución')) {
          throw new Error(`mx_csv_no_reconocido:${filePath} — baja «Contratos … Compras MX» a mano desde ${MX_COMPRASMX_OPEN_DATA_PAGE}`);
        }
        continue;
      }
      const record: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) if (!(header[i] in record)) record[header[i]] = cells[i] ?? '';
      onRecord(record);
    }
  };
  for await (const chunk of createReadStream(filePath)) feed(parser.push(decoder.decode(chunk as Buffer, { stream: true })));
  feed(parser.push(decoder.decode()));
  feed(parser.end());
}

/** Lector con su ventana (la fija `files()`, que el cargador llama antes de leer). */
export function createMxLoader(): ProcurementLoaderSource {
  let window: { start: string; end: string } | null = null;
  const seenContracts = new Set<string>();
  return {
    country: MX_COUNTRY,
    files: (end, months) => {
      const first = monthsBack(end, months)[0];
      window = { start: `${first.year}-${String(first.month).padStart(2, '0')}-01`, end: lastDay(end.year, end.month) };
      seenContracts.clear();
      const files: Array<{ url: string; name: string }> = [];
      for (let year = first.year; year <= end.year; year++) {
        files.push({ url: `manual:${MX_COMPRASMX_OPEN_DATA_PAGE}`, name: `contratos_comprasmx_${year}.csv` });
      }
      return files;
    },
    readLines: async (filePath, onLine) => {
      await readLatin1Csv(filePath, (record) => {
        const lines = mxLinesFromRecord(record, window);
        if (lines.length === 0) return;
        const key = `${lines[0].orderCode}|${lines[0].supplierTaxId}`;
        if (seenContracts.has(key)) return;
        seenContracts.add(key);
        for (const line of lines) onLine(line);
      });
    },
  };
}

export const MX_LOADER: ProcurementLoaderSource = createMxLoader();
