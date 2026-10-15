/**
 * España — lector de la sindicación 643 de la PLACSP (ATOM/CODICE) para el cargador
 * genérico (`--country ES`). Un zip por mes (~150-300 MB) con cientos de `.atom`; cada
 * `<entry>` es UNA licitación en su estado de ese momento, y la misma licitación aparece
 * muchas veces (cada cambio de estado, en el mismo mes o en otros).
 *
 *  - Se queda con la ÚLTIMA versión de cada licitación (`<updated>` mayor) de toda la
 *    ventana: por eso junta todo y entrega las líneas al leer el ÚLTIMO archivo de la lista
 *    (los anteriores informan 0 líneas en el registro del cargador).
 *  - Sólo resultados adjudicados o formalizados (códigos 8 y 9, y 1/2 de la codificación
 *    vieja), con adjudicataria EMPRESA (`parseEsCompanyNif`) y fecha de adjudicación dentro
 *    de la ventana. Monto sin IVA del lote (`TaxExclusiveAmount`, si no `PayableAmount`);
 *    con varias adjudicatarias en un resultado se reparte en partes iguales.
 *  - CPV del lote adjudicado (o el del expediente) reducido a su división (2 dígitos).
 *  - Comprador = NIF de la entidad, con el nombre de entidad más repetido entre sus órganos.
 *
 * 🔴 El servidor de la PLACSP presenta una cadena TLS que Node no valida (curl tampoco sin
 * `-k`): los zips se bajan antes con curl a ~/Documents/SellUp-data/public-procurement/es/
 * con el MISMO nombre que da `files()` y el cargador los reutiliza.
 */

import type { ProcurementLine } from '../procurement-links';
import { cpvDivision, ES_COUNTRY, esEntityNameOf, parseEsCompanyNif } from './es';
import { monthsBack, readZipEntries } from './loader-io';
import type { ProcurementLoaderSource } from './types';

export const ES_PLACSP_MONTH_URL = (year: number, month: number): string =>
  `https://contrataciondelestado.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_${year}${String(month).padStart(2, '0')}.zip`;

const AWARDED_RESULT_CODES = new Set(['1', '2', '8', '9']);

const first = (re: RegExp, text: string): string | null => re.exec(text)?.[1]?.trim() || null;

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Una licitación ya leída: su versión y sus líneas (comprador aún con el nombre del órgano). */
export type EsParsedEntry = { id: string; updated: string; lines: ProcurementLine[] };

/**
 * Lee UN `<entry>` (texto entre `<entry>` y `</entry>`). `null` sólo sin `<id>`; sin
 * adjudicación de empresa en la ventana devuelve `lines: []` (una versión más nueva sin
 * adjudicataria — anulada, desierta — reemplaza a una vieja que la tenía).
 */
export function parseEsEntry(entry: string, window: { start: string; end: string } | null): EsParsedEntry | null {
  const id = first(/<id>([^<]+)<\/id>/, entry);
  const updated = first(/<updated>([^<]+)<\/updated>/, entry) ?? '';
  if (!id) return null;
  const none: EsParsedEntry = { id, updated, lines: [] };
  if (!entry.includes('<cac:WinningParty>')) return none;
  const party = /<cac-place-ext:LocatedContractingParty>[\s\S]*?<cac:Party>([\s\S]*?)<\/cac:Party>/.exec(entry)?.[1];
  if (!party) return none;
  const buyerNif = first(/<cbc:ID schemeName="NIF">([^<]+)<\/cbc:ID>/, party)?.toUpperCase() ?? null;
  const buyerCode = buyerNif ?? first(/<cbc:ID schemeName="DIR3">([^<]+)<\/cbc:ID>/, party) ?? first(/<cbc:ID schemeName="ID_PLATAFORMA">([^<]+)<\/cbc:ID>/, party);
  const organName = first(/<cac:PartyName>\s*<cbc:Name>([^<]+)<\/cbc:Name>/, party);
  if (!buyerCode || !organName) return none;
  const buyerName = esEntityNameOf(decodeXml(organName));
  const orderCode = id.replace(/^.*\//, '');
  const orderUrl = first(/<link href="([^"]+)"/, entry)?.replace(/&amp;/g, '&') ?? null;

  // CPV del expediente (el primer ProcurementProject, antes de los lotes) y de cada lote.
  const folderProject = /<cac:ProcurementProject>([\s\S]*?)<\/cac:ProcurementProject>/.exec(entry)?.[1] ?? '';
  const folderCpv = cpvDivision(first(/<cbc:ItemClassificationCode[^>]*>([^<]+)</, folderProject));
  const lotCpv = new Map<string, string | null>();
  for (const lot of entry.matchAll(/<cac:ProcurementProjectLot>([\s\S]*?)<\/cac:ProcurementProjectLot>/g)) {
    const lotId = first(/<cbc:ID schemeName="ID_LOTE">([^<]+)</, lot[1]);
    if (lotId) lotCpv.set(lotId, cpvDivision(first(/<cbc:ItemClassificationCode[^>]*>([^<]+)</, lot[1])));
  }

  const lines: ProcurementLine[] = [];
  for (const match of entry.matchAll(/<cac:TenderResult>([\s\S]*?)<\/cac:TenderResult>/g)) {
    const result = match[1];
    if (!AWARDED_RESULT_CODES.has(first(/<cbc:ResultCode[^>]*>(\d+)</, result) ?? '')) continue;
    const date = first(/<cbc:AwardDate>(\d{4}-\d{2}-\d{2})/, result);
    if (window && (!date || date < window.start || date > window.end)) continue;
    const amountText =
      first(/<cbc:TaxExclusiveAmount[^>]*>([\d.]+)</, result.split('<cac:LegalMonetaryTotal>')[1] ?? '') ??
      first(/<cbc:PayableAmount[^>]*>([\d.]+)</, result);
    const amount = Number(amountText ?? '0');
    const lotId = first(/<cbc:ProcurementProjectLotID>([^<]+)</, result);
    const division = (lotId ? lotCpv.get(lotId) : null) ?? folderCpv;
    const winners: Array<{ nif: string; name: string }> = [];
    for (const w of result.matchAll(/<cac:WinningParty>([\s\S]*?)<\/cac:WinningParty>/g)) {
      const scheme = first(/<cbc:ID schemeName="([^"]+)">/, w[1]);
      const nif = scheme === 'NIF' ? parseEsCompanyNif(first(/<cbc:ID schemeName="NIF">([^<]+)</, w[1])) : null;
      const name = first(/<cac:PartyName>\s*<cbc:Name>([^<]+)<\/cbc:Name>/, w[1]);
      if (nif && name) winners.push({ nif, name: decodeXml(name) });
    }
    const winnerCount = result.split('<cac:WinningParty>').length - 1;
    for (const winner of winners) {
      lines.push({
        buyerCode,
        buyerName,
        buyerTaxId: buyerNif,
        supplierTaxId: winner.nif,
        supplierName: winner.name,
        // Repartido entre TODAS las adjudicatarias del resultado (también las que no son empresa).
        amount: Number.isFinite(amount) && amount > 0 ? amount / Math.max(winnerCount, 1) : 0,
        orderCode,
        orderUrl,
        date,
        classificationKey: division,
      });
    }
  }
  return { id, updated, lines };
}

/** Nombre más repetido por comprador (desempate: el más corto, que suele ser la entidad). */
export function esBuyerNames(entries: Iterable<EsParsedEntry>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    const line = entry.lines[0];
    if (!line) continue;
    const byName = counts.get(line.buyerCode) ?? new Map<string, number>();
    byName.set(line.buyerName, (byName.get(line.buyerName) ?? 0) + 1);
    counts.set(line.buyerCode, byName);
  }
  const out = new Map<string, string>();
  for (const [code, byName] of counts) {
    const best = [...byName.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0];
    out.set(code, best[0]);
  }
  return out;
}

function lastDay(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** Lector con su ventana y la última versión de cada licitación (ver cabecera). */
export function createEsLoader(): ProcurementLoaderSource {
  let window: { start: string; end: string } | null = null;
  let lastFile: string | null = null;
  const latest = new Map<string, EsParsedEntry>();
  return {
    country: ES_COUNTRY,
    files: (end, months) => {
      const list = monthsBack(end, months);
      window = { start: `${list[0].year}-${String(list[0].month).padStart(2, '0')}-01`, end: lastDay(end.year, end.month) };
      const files = list.map(({ year, month }) => ({ url: ES_PLACSP_MONTH_URL(year, month), name: `es-${year}-${month}.zip` }));
      lastFile = files[files.length - 1].name;
      latest.clear();
      return files;
    },
    readLines: async (filePath, onLine) => {
      await readZipEntries(
        filePath,
        (entry) => entry.endsWith('.atom'),
        (_entry, text) => {
          for (const chunk of text.split('<entry>').slice(1)) {
            const parsed = parseEsEntry(chunk.split('</entry>')[0], window);
            if (!parsed) continue;
            const seen = latest.get(parsed.id);
            if (!(seen ? parsed.updated >= seen.updated : parsed.lines.length > 0)) continue;
            // Copia de verdad (clave incluida): en V8 una subcadena de regex retiene el .atom
            // entero (15 MB); sin copiar, un mes llega a 3-4 GB de memoria.
            const copy = JSON.parse(Buffer.from(JSON.stringify(parsed)).toString()) as EsParsedEntry;
            latest.set(copy.id, copy);
          }
        },
      );
      if (lastFile !== null && !filePath.endsWith(`/${lastFile}`) && filePath !== lastFile) return;
      const names = esBuyerNames(latest.values());
      for (const entry of latest.values()) {
        for (const line of entry.lines) onLine({ ...line, buyerName: names.get(line.buyerCode) ?? line.buyerName });
      }
      latest.clear();
    },
  };
}

export const ES_LOADER: ProcurementLoaderSource = createEsLoader();
