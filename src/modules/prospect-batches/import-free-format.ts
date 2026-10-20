/**
 * IMPORT-FREE-FORMAT-1 — leer empresas que NO vienen en el formato oficial.
 *
 * El contrato oficial (`EXTERNAL_IMPORT_CONTRACT`) espera una tabla con
 * encabezados conocidos («Empresa», «País»…). Lo que pegue o suba la vendedora
 * puede ser cualquier otra cosa:
 *   - una tabla con encabezados propios («Cliente», «Pág.», «Doc.»…) o sin ellos;
 *   - una lista, una empresa por línea, con viñetas o números y a veces la web,
 *     el NIT o el país en la misma línea;
 *   - texto corrido (un correo, notas de una reunión).
 *
 * Aquí se resuelven gratis los dos primeros, mirando el CONTENIDO de cada
 * columna o línea (una URL es web, «900123456-7» es identificador fiscal, «Chile»
 * es país). El texto corrido se marca `needs_ai`: lo lee Claude en el servidor
 * (`import-ai-extraction.ts`). Lo que falte (web, identificador fiscal, sector,
 * tamaño) lo completa la importación con las mismas herramientas del Agente 1.
 *
 * Puro y apto para cliente: sin E/S.
 */

import type { ParsedImportRow } from './import-candidates-parser';

export type ImportDetectionMode =
  /** Tabla con los encabezados del contrato oficial. */
  | 'contract'
  /** Tabla con encabezados propios o sin ellos: columnas reconocidas por su contenido. */
  | 'columns_by_content'
  /** Una empresa por línea. */
  | 'company_list'
  /** Texto corrido: hay que leerlo con IA. */
  | 'needs_ai'
  /** Leído con IA (Claude) en el servidor. */
  | 'ai_extracted';

export type ImportFieldKey = keyof ParsedImportRow;

export interface ImportColumnGuess {
  /** Encabezado tal cual vino, o «Columna N» si no había. */
  column: string;
  field: ImportFieldKey | null;
}

export interface FreeFormParse {
  mode: Exclude<ImportDetectionMode, 'contract' | 'ai_extracted'>;
  rows: ParsedImportRow[];
  columnGuesses: ImportColumnGuess[];
}

// ── Reconocer un valor por su forma ──────────────────────────────────────────

type ValueKind = 'linkedin' | 'email' | 'website' | 'tax_identifier' | 'country' | 'company_size' | 'text' | 'other';

const COUNTRY_NAMES: Record<string, string> = {
  colombia: 'CO', chile: 'CL', mexico: 'MX', argentina: 'AR', brasil: 'BR', brazil: 'BR',
  peru: 'PE', uruguay: 'UY', ecuador: 'EC', paraguay: 'PY', bolivia: 'BO', venezuela: 'VE',
  guatemala: 'GT', honduras: 'HN', 'el salvador': 'SV', nicaragua: 'NI', 'costa rica': 'CR',
  panama: 'PA', 'republica dominicana': 'DO', 'rep. dominicana': 'DO', 'estados unidos': 'US',
  'united states': 'US', usa: 'US', espana: 'ES', spain: 'ES',
};

const TAX_PREFIX = /^(nit|rut|rfc|ruc|cuit|cnpj|cif|nif|rtn|rif)\s*[:.#]?\s*/i;
const TAX_NUMERIC = /^\d[\d.\s]{4,}\d(-?[\dkK])?$/;
/** RFC de persona moral (México): 3 letras, fecha AAMMDD y homoclave. */
const TAX_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i;
const WEBSITE = /^(https?:\/\/)?(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINKEDIN = /linkedin\.com\/(company|school|showcase)\//i;
const SIZE = /^(\d{1,6}\s*(-|–|a|to)\s*\d{1,6}|\d{1,6}\s*\+|\+\s*\d{1,6}|\d{1,6}\s*(empleados|employees|trabajadores))$/i;

function fold(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function countryCodeFromName(value: string): string | null {
  return COUNTRY_NAMES[fold(value).replace(/\s+/g, ' ')] ?? null;
}

function isTaxIdentifier(value: string): boolean {
  const hadPrefix = TAX_PREFIX.test(value.trim());
  const compact = value.trim().replace(TAX_PREFIX, '');
  if (TAX_RFC.test(compact)) return true;
  if (!TAX_NUMERIC.test(compact)) return false;
  // Un número suelto puede ser cualquier cosa (teléfono, empleados): pide el
  // prefijo, o la forma de un identificador (guion de verificación o 8+ dígitos).
  const digits = compact.replace(/\D/g, '').length;
  return hadPrefix || /-[\dkK]$/.test(compact) || (digits >= 8 && digits <= 14);
}

function classifyValue(raw: string): ValueKind {
  const value = raw.trim();
  if (!value) return 'other';
  if (LINKEDIN.test(value)) return 'linkedin';
  if (EMAIL.test(value)) return 'email';
  if (!/\s/.test(value) && WEBSITE.test(value) && /[a-z]/i.test(value.split('.').pop() ?? '')) return 'website';
  if (isTaxIdentifier(value)) return 'tax_identifier';
  if (countryCodeFromName(value)) return 'country';
  if (SIZE.test(value)) return 'company_size';
  if (/[a-záéíóúñü]/i.test(value) && value.length <= 160) return 'text';
  return 'other';
}

// ── Tablas sin encabezados conocidos ─────────────────────────────────────────

/** Fracción de valores no vacíos de una columna que deben tener la misma forma. */
const COLUMN_KIND_MIN_SHARE = 0.6;

/** Palabras con las que un encabezado de columna de nombres suele empezar. */
const NAME_HEADER_HINTS = [
  'empresa', 'empresas', 'cliente', 'clientes', 'cuenta', 'cuentas', 'compania', 'companias',
  'organizacion', 'organizaciones', 'prospecto', 'prospectos', 'nombre', 'razon', 'lista', 'listado',
  'company', 'companies', 'account', 'accounts', 'organization', 'name',
];

/**
 * AGENT1-AUDIT-WS5-IMPORT-HEADER-HINTS-1 — el encabezado es una PISTA para los
 * números: «Teléfono»/«Celular» nunca es identificador fiscal aunque sus valores
 * tengan 10 dígitos, y «NIT»/«RUT»/«RUC»… gana sobre otra columna numérica que
 * aparezca antes (antes ganaba la primera columna: el teléfono quedaba como NIT
 * y el NIT real se perdía).
 */
const PHONE_HEADER = /^(tel|tel\.|telefono|telefonos|celular|cel|movil|phone|mobile|whatsapp|fax)(\s|$|[.:#])/;
const TAX_HEADER = /(^|[\s(/])(nit|rut|ruc|rfc|cuit|cnpj|cif|nif|rtn|rif)($|[\s).:#/])|identificacion fiscal|numero fiscal|tax id/;

type HeaderHint = 'tax' | 'phone' | null;

function headerHint(header: string | undefined): HeaderHint {
  const folded = fold(header ?? '');
  if (!folded) return null;
  if (TAX_HEADER.test(folded)) return 'tax';
  if (PHONE_HEADER.test(folded)) return 'phone';
  return null;
}

const KIND_TO_FIELD: Partial<Record<ValueKind, ImportFieldKey>> = {
  linkedin: 'linkedin_url',
  email: 'contact_email',
  website: 'website',
  tax_identifier: 'tax_identifier',
  country: 'country',
  company_size: 'company_size',
};

function dominantKind(values: string[]): { kind: ValueKind; share: number } {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (filled.length === 0) return { kind: 'other', share: 0 };
  const counts = new Map<ValueKind, number>();
  for (const value of filled) {
    const kind = classifyValue(value);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const [kind, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { kind, share: count / filled.length };
}

function averageLength(values: string[]): number {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (filled.length === 0) return 0;
  return filled.reduce((sum, v) => sum + v.length, 0) / filled.length;
}

function looksLikeHeaderRow(firstRow: string[], columnKinds: ValueKind[]): boolean {
  // Una columna cuyo cuerpo tiene forma clara (web, correo, NIT, país) y cuya
  // primera celda NO la tiene: esa primera fila es un encabezado.
  for (let i = 0; i < columnKinds.length; i++) {
    const kind = columnKinds[i];
    if (!KIND_TO_FIELD[kind]) continue;
    const cell = firstRow[i]?.trim() ?? '';
    if (cell && classifyValue(cell) !== kind) return true;
  }
  return firstRow.some((cell) => NAME_HEADER_HINTS.includes(fold(cell).split(/\s+/)[0] ?? ''));
}

/**
 * Lee una matriz de celdas cuyos encabezados no son los del contrato (o que no
 * tiene encabezados). Devuelve `null` si no encuentra una columna de nombres.
 */
export function parseMatrixByContent(matrix: string[][]): FreeFormParse | null {
  const rows = matrix.filter((cells) => cells.some((c) => c.trim()));
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((r) => r.length));

  const kindsOf = (body: string[][]) =>
    Array.from({ length: width }, (_, i) => dominantKind(body.map((r) => r[i] ?? '')));

  // Primero se mira el cuerpo sin la primera fila para decidir si es encabezado.
  const bodyKinds = rows.length > 1 ? kindsOf(rows.slice(1)) : kindsOf(rows);
  const hasHeader =
    rows.length > 1 &&
    looksLikeHeaderRow(
      rows[0],
      bodyKinds.map((k) => (k.share >= COLUMN_KIND_MIN_SHARE ? k.kind : 'other')),
    );
  const header = hasHeader ? rows[0] : [];
  const body = hasHeader ? rows.slice(1) : rows;
  const kinds = kindsOf(body);

  const fields: Array<ImportFieldKey | null> = Array.from({ length: width }, () => null);
  const used = new Set<ImportFieldKey>();
  const hints = Array.from({ length: width }, (_, i) => headerHint(header[i]));
  const assign = (i: number) => {
    const { kind, share } = kinds[i];
    const field = KIND_TO_FIELD[kind];
    if (!field || share < COLUMN_KIND_MIN_SHARE || used.has(field)) return;
    // Un teléfono nunca es identificador fiscal.
    if (field === 'tax_identifier' && hints[i] === 'phone') return;
    fields[i] = field;
    used.add(field);
  };
  // Primero las columnas cuyo encabezado dice que son identificador fiscal.
  kinds.forEach((_, i) => {
    if (hints[i] === 'tax') assign(i);
  });
  kinds.forEach((_, i) => {
    if (fields[i] === null && hints[i] !== 'tax') assign(i);
  });

  // La columna de nombres: la de texto corto; si el encabezado lo dice, ésa.
  const textColumns = kinds
    .map((k, i) => ({ i, ...k, avg: averageLength(body.map((r) => r[i] ?? '')) }))
    .filter((c) => fields[c.i] === null && c.kind === 'text' && c.share >= COLUMN_KIND_MIN_SHARE);
  if (textColumns.length === 0) return null;
  const hinted = textColumns.find((c) => NAME_HEADER_HINTS.includes(fold(header[c.i] ?? '').split(/\s+/)[0] ?? ''));
  const nameColumn = hinted ?? textColumns.find((c) => c.avg <= 80) ?? textColumns[0];
  fields[nameColumn.i] = 'company_name';

  // Un texto largo que queda suelto es la descripción de la empresa.
  const longText = textColumns.find((c) => c.i !== nameColumn.i && c.avg > 40);
  if (longText) fields[longText.i] = 'description';

  const columnGuesses: ImportColumnGuess[] = Array.from({ length: width }, (_, i) => ({
    column: header[i]?.trim() || `Columna ${i + 1}`,
    field: fields[i],
  }));

  const parsed: ParsedImportRow[] = body
    .map((cells) => {
      const row: Record<string, string> = {};
      fields.forEach((field, i) => {
        const value = cells[i]?.trim();
        if (field && value) row[field] = cleanValue(field, value);
      });
      return row as unknown as ParsedImportRow;
    })
    .filter((row) => row.company_name);

  return parsed.length > 0 ? { mode: 'columns_by_content', rows: parsed, columnGuesses } : null;
}

function cleanValue(field: ImportFieldKey, value: string): string {
  if (field === 'tax_identifier') return value.replace(TAX_PREFIX, '').trim();
  if (field === 'company_name') return cleanCompanyName(value);
  return value;
}

// ── Listas: una empresa por línea ────────────────────────────────────────────

/** Una línea con más palabras que esto ya no es un nombre: es una oración. */
const LIST_NAME_MAX_WORDS = 10;
const LIST_NAME_MAX_CHARS = 90;
/** Fracción de líneas que deben parecer nombres para tratar el texto como lista. */
const LIST_MIN_NAME_SHARE = 0.7;

const BULLET = /^\s*(?:[-*•·▪►✓✔]|\d{1,4}\s*[.)\-:]|[a-z]\))\s*/i;
const URL_IN_TEXT = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s,;|)]*)?/gi;
const EMAIL_IN_TEXT = /[^\s@,;|()<>]+@[^\s@,;|()<>]+\.[a-z]{2,}/gi;
const TAX_IN_TEXT = /\b(?:nit|rut|rfc|ruc|cuit|cnpj|cif|nif|rtn|rif)\s*[:.#]?\s*[A-ZÑ&0-9][A-ZÑ&0-9.\-\s]{4,}[0-9kK]\b/gi;

function cleanCompanyName(value: string): string {
  return value
    .replace(/\*\*|__|`/g, '')
    .replace(/^[\s\-–—|:;,.]+|[\s\-–—|:;,]+$/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

interface ListLine {
  row: ParsedImportRow;
  nameLike: boolean;
}

function parseListLine(rawLine: string): ListLine | null {
  let line = rawLine.trim();
  if (!line || /^#{1,6}\s/.test(line) || /:\s*$/.test(line)) return null;
  line = line.replace(BULLET, '');
  const row: Record<string, string> = {};

  line = line.replace(EMAIL_IN_TEXT, (email) => {
    row.contact_email ??= email;
    return ' ';
  });
  line = line.replace(TAX_IN_TEXT, (tax) => {
    row.tax_identifier ??= tax.replace(TAX_PREFIX, '').trim();
    return ' ';
  });
  line = line.replace(URL_IN_TEXT, (url) => {
    // «S.A.» o «Cía.» no son dominios: exige al menos una letra en la terminación y
    // que no sea parte de una sigla societaria.
    if (/^(s\.a|s\.a\.s|ltda|cia|s\.r\.l|s\.l|inc|corp)\b/i.test(url)) return url;
    const host = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    if (!/^(https?:|www\.)/i.test(url) && (host.split('.')[0] ?? '').length < 2) return url;
    if (LINKEDIN.test(url)) row.linkedin_url ??= url;
    else row.website ??= url;
    return ' ';
  });

  // El país puede venir entre paréntesis o tras un separador: «Acme (Chile)», «Acme - Perú».
  const parts = line.split(/\s[-–—|]\s|[|;,]|\(|\)/).map((p) => p.trim()).filter(Boolean);
  const nameParts: string[] = [];
  for (const part of parts) {
    if (!row.country && countryCodeFromName(part)) {
      row.country = part;
      continue;
    }
    if (!row.company_size && SIZE.test(part)) {
      row.company_size = part;
      continue;
    }
    nameParts.push(part);
  }
  // El nombre es el primer trozo; si hay más, la razón social quedó partida por
  // una coma («Acme, S.A.») y se vuelve a unir.
  const name = cleanCompanyName(
    nameParts.length > 1 && /^(s\.?a\.?|s\.?a\.?s\.?|ltda\.?|inc\.?|s\.?r\.?l\.?|s\.?l\.?|cia\.?)$/i.test(nameParts[1])
      ? `${nameParts[0]}, ${nameParts[1]}`
      : (nameParts[0] ?? ''),
  );
  if (!name) return null;
  row.company_name = name;

  const words = name.split(/\s+/).length;
  // Un punto final con pocas palabras es de una sigla («S.A.», «Cía.»), no de una oración.
  const endsLikeSentence = /[!?]$/.test(name) || (/\.$/.test(name) && words >= 6);
  const nameLike = words <= LIST_NAME_MAX_WORDS && name.length <= LIST_NAME_MAX_CHARS && !endsLikeSentence;
  return { row: row as unknown as ParsedImportRow, nameLike };
}

/**
 * Lee una lista de empresas, una por línea (o varias en una sola línea separadas
 * por comas). Si demasiadas líneas parecen oraciones, devuelve `needs_ai`.
 */
export function parseCompanyList(text: string): FreeFormParse {
  let lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Una sola línea con varias empresas separadas por comas o punto y coma.
  if (lines.length === 1 && /[,;]/.test(lines[0]) && lines[0].split(/[,;]/).every((p) => p.trim().split(/\s+/).length <= 6)) {
    lines = lines[0].split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  }
  const parsed = lines.map(parseListLine).filter((l): l is ListLine => l !== null);
  const nameLike = parsed.filter((l) => l.nameLike);
  if (nameLike.length === 0 || nameLike.length / parsed.length < LIST_MIN_NAME_SHARE) {
    return { mode: 'needs_ai', rows: [], columnGuesses: [] };
  }
  const seen = new Set<string>();
  const rows = nameLike
    .map((l) => l.row)
    .filter((row) => {
      const key = fold(row.company_name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    mode: 'company_list',
    rows,
    columnGuesses: [{ column: 'Línea de texto', field: 'company_name' }],
  };
}
