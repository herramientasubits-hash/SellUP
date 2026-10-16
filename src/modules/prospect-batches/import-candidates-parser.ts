import { resolveImportTaxIdentifier } from './import-tax-identifier';
import { IMPORT_BATCH_MAX_ROWS } from './import-batch-schema';
import {
  parseCompanyList,
  parseMatrixByContent,
  type FreeFormParse,
  type ImportColumnGuess,
  type ImportDetectionMode,
  type ImportFieldKey,
} from './import-free-format';

export type { ImportColumnGuess, ImportDetectionMode } from './import-free-format';

// ── Tipos ─────────────────────────────────────────────────────

export type ImportMethod = 'paste' | 'csv' | 'xlsx';

export interface ImportDefaults {
  country?: string;
  countryCode?: string;
  industry?: string;
  subindustry?: string;
}

export interface ParsedImportRow {
  company_name: string;
  country?: string;
  country_code?: string;
  website?: string;
  industry?: string;
  subindustry?: string;
  city?: string;
  region?: string;
  tax_identifier?: string;
  tax_identifier_type?: string;
  linkedin_url?: string;
  company_size?: string;
  description?: string;
  notes?: string;
  source_url?: string;
  contact_name?: string;
  contact_role?: string;
  contact_email?: string;
  owner_email?: string;
  source_evidence?: string;
  confidence?: string;
}

export type RowStatus = 'valid' | 'error' | 'warning';

export interface ImportRow {
  index: number;
  raw: ParsedImportRow;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  resolved_country_code: string | null;
  country_from_default: boolean;
  industry_from_default: boolean;
  industryOriginalValue: string | null;
  subindustryOriginalValue: string | null;
}

export interface ImportPreview {
  total: number;
  valid: number;
  errors: number;
  warnings_only: number;
  recognized_columns: string[];
  unrecognized_columns: string[];
  rows: ImportRow[];
  duplicateColumns: string[];
  /** IMPORT-FREE-FORMAT-1 — cómo se leyó lo que entró. */
  detection: ImportDetectionMode;
  column_guesses: ImportColumnGuess[];
}

function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-]/g, ' ')
    .replace(/\s+/g, ' ');
}

export interface ImportColumnDefinition {
  field: keyof ParsedImportRow;
  officialHeader: string;
  aliases: string[];
  required: boolean;
  recommended: boolean;
  description: string;
  example: string;
}

export const EXTERNAL_IMPORT_CONTRACT: readonly ImportColumnDefinition[] = [
  {
    field: 'company_name',
    officialHeader: 'Empresa',
    aliases: ['empresa', 'nombre empresa', 'nombre de empresa', 'razon social', 'company', 'company name', 'organization', 'organization name', 'nombre'],
    required: true,
    recommended: true,
    description: 'Nombre de la empresa o razón social.',
    example: 'Acme Learning Chile',
  },
  {
    field: 'country',
    officialHeader: 'País',
    aliases: ['pais', 'country'],
    required: false,
    recommended: true,
    description: 'País de operación de la empresa.',
    example: 'Chile',
  },
  {
    field: 'country_code',
    officialHeader: 'Código País',
    aliases: ['country_code', 'codigo pais', 'iso country', 'iso'],
    required: false,
    recommended: false,
    description: 'Código ISO de 2 letras del país.',
    example: 'CL',
  },
  {
    field: 'industry',
    officialHeader: 'Sector',
    aliases: [
      'sector', 'industria', 'industry', 'vertical', 'rubro', 'giro',
      'sector economico', 'sector económico', 'categoria', 'categoría',
    ],
    required: false,
    recommended: true,
    description: 'Sector o industria de la empresa.',
    example: 'Educación',
  },
  {
    field: 'subindustry',
    officialHeader: 'Subindustria',
    aliases: [
      'subindustria', 'sub industria', 'sub-industry', 'subindustry',
      'subsector', 'sub sector', 'subcategoría', 'subcategoria', 'subcategory',
      'vertical específica', 'vertical especifica',
    ],
    required: false,
    recommended: false,
    description: 'Subindustria o subsector específico de la empresa.',
    example: 'SaaS Empresarial',
  },
  {
    field: 'website',
    officialHeader: 'Sitio web',
    aliases: ['sitio web', 'web', 'website', 'url', 'dominio', 'domain'],
    required: false,
    recommended: true,
    description: 'Sitio web oficial de la empresa.',
    example: 'https://acme.cl',
  },
  {
    field: 'linkedin_url',
    officialHeader: 'LinkedIn',
    aliases: ['linkedin', 'linkedin url', 'linkedin company', 'perfil linkedin', 'linkedin_url'],
    required: false,
    recommended: false,
    description: 'URL del perfil de LinkedIn de la empresa.',
    example: 'https://linkedin.com/company/acme',
  },
  {
    field: 'city',
    officialHeader: 'Ciudad',
    aliases: ['ciudad', 'city'],
    required: false,
    recommended: false,
    description: 'Ciudad de la sede principal.',
    example: 'Santiago',
  },
  {
    field: 'region',
    officialHeader: 'Región',
    aliases: ['region', 'departamento', 'estado', 'provincia'],
    required: false,
    recommended: false,
    description: 'Región, estado o departamento.',
    example: 'Metropolitana',
  },
  {
    field: 'company_size',
    officialHeader: 'Tamaño estimado',
    aliases: ['tamano', 'tamano empresa', 'company_size', 'empleados', 'tamano estimado', 'employees', 'estimated size', 'company size'],
    required: false,
    recommended: false,
    description: 'Número aproximado de empleados.',
    example: '50-100',
  },
  {
    field: 'description',
    officialHeader: 'Descripción',
    aliases: ['descripcion', 'description', 'que hace'],
    required: false,
    recommended: false,
    description: 'Resumen o descripción de lo que hace la empresa.',
    example: 'Proveedor de capacitación corporativa y software educativo.',
  },
  {
    field: 'source_url',
    officialHeader: 'URL evidencia principal',
    aliases: ['url evidencia principal', 'evidencia principal', 'evidence url', 'source url', 'fuente url', 'source_url', 'evidence_url'],
    required: false,
    recommended: false,
    description: 'URL del sitio o noticia donde se encontró.',
    example: 'https://diario.cl/noticia-acme',
  },
  {
    field: 'source_evidence',
    officialHeader: 'Fuente / evidencia',
    aliases: ['fuente / evidencia', 'fuente evidencia', 'fuente', 'evidencia', 'source evidence', 'source_evidence'],
    required: false,
    recommended: false,
    description: 'Texto descriptivo de la fuente o evidencia encontrada.',
    example: 'Aparece en el ranking de EdTech 2026 de Latam.',
  },
  {
    field: 'confidence',
    officialHeader: 'Confianza',
    aliases: ['confianza', 'confidence', 'nivel de confianza'],
    required: false,
    recommended: false,
    description: 'Nivel de confianza en los datos (ej: alta, media, baja).',
    example: 'alta',
  },
  {
    field: 'notes',
    officialHeader: 'Notas',
    aliases: ['notas', 'notes', 'observaciones'],
    required: false,
    recommended: false,
    description: 'Notas adicionales sobre la empresa o la investigación.',
    example: 'Se observa crecimiento reciente en su equipo de ventas.',
  },
  {
    field: 'tax_identifier',
    officialHeader: 'Identificación Fiscal',
    aliases: [
      'nit', 'rut', 'rfc', 'ruc', 'cuit', 'cnpj',
      'identificacion fiscal', 'identificacion tributaria', 'tax id', 'tax_identifier', 'tax identifier', 'id fiscal',
    ],
    required: false,
    recommended: false,
    description: 'Identificador fiscal (NIT en Colombia, RUT en Chile, RFC en México, RUC en Perú y Ecuador, CUIT en Argentina, CNPJ en Brasil).',
    example: '901234567-8',
  },
  {
    field: 'contact_name',
    officialHeader: 'Contacto',
    aliases: ['contacto', 'contact_name', 'nombre contacto', 'contact name'],
    required: false,
    recommended: false,
    description: 'Nombre del contacto principal.',
    example: 'Juan Pérez',
  },
  {
    field: 'contact_role',
    officialHeader: 'Cargo',
    aliases: ['cargo', 'contact_role', 'rol'],
    required: false,
    recommended: false,
    description: 'Cargo o rol del contacto.',
    example: 'Director de RRHH',
  },
  {
    field: 'contact_email',
    officialHeader: 'Email contacto',
    aliases: ['email contacto', 'contact_email', 'correo contacto'],
    required: false,
    recommended: false,
    description: 'Correo electrónico del contacto.',
    example: 'juan.perez@acme.cl',
  },
  {
    field: 'owner_email',
    officialHeader: 'Responsable',
    aliases: ['owner_email', 'responsable', 'asignado'],
    required: false,
    recommended: false,
    description: 'Email del ejecutivo asignado en SellUp.',
    example: 'ejecutivo@ubits.com',
  }
];

// Construir COLUMN_ALIASES a partir de EXTERNAL_IMPORT_CONTRACT
const COLUMN_ALIASES: Record<string, string> = {};
for (const col of EXTERNAL_IMPORT_CONTRACT) {
  // Primero mapear el header oficial
  const officialKey = normalizeHeader(col.officialHeader);
  COLUMN_ALIASES[officialKey] = col.field;
  
  // Mapear todos los aliases asociados
  for (const alias of col.aliases) {
    const aliasKey = normalizeHeader(alias);
    COLUMN_ALIASES[aliasKey] = col.field;
  }
}

// ── Mapeo país → código ISO ────────────────────────────────────

const COUNTRY_TO_CODE: Record<string, string> = {
  colombia: 'CO',
  chile: 'CL',
  mexico: 'MX',
  méxico: 'MX',
  argentina: 'AR',
  brasil: 'BR',
  brazil: 'BR',
  peru: 'PE',
  perú: 'PE',
  uruguay: 'UY',
  ecuador: 'EC',
  paraguay: 'PY',
  bolivia: 'BO',
  venezuela: 'VE',
  guatemala: 'GT',
  honduras: 'HN',
  'el salvador': 'SV',
  nicaragua: 'NI',
  'costa rica': 'CR',
  panama: 'PA',
  panamá: 'PA',
  'republica dominicana': 'DO',
  'república dominicana': 'DO',
  'rep. dominicana': 'DO',
  'estados unidos': 'US',
  'united states': 'US',
  usa: 'US',
  españa: 'ES',
  espana: 'ES',
  spain: 'ES',
  // códigos directos (pasan tal cual)
  co: 'CO',
  cl: 'CL',
  mx: 'MX',
  ar: 'AR',
  br: 'BR',
  pe: 'PE',
  uy: 'UY',
  ec: 'EC',
  py: 'PY',
  bo: 'BO',
  ve: 'VE',
  gt: 'GT',
  hn: 'HN',
  sv: 'SV',
  ni: 'NI',
  cr: 'CR',
  pa: 'PA',
  do: 'DO',
  us: 'US',
  es: 'ES',
};

// ── Helpers de parsing ─────────────────────────────────────────

function resolveHeader(raw: string): { field: string | null; original: string } {
  const normalized = normalizeHeader(raw);
  const field = COLUMN_ALIASES[normalized] ?? null;
  return { field, original: raw.trim() };
}

function resolveCountryCode(countryValue: string): string | null {
  if (!countryValue) return null;
  const normalized = countryValue.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return COUNTRY_TO_CODE[normalized] ?? null;
}

/**
 * Parte una línea lógica en celdas (RFC 4180). AGENT1-AUDIT-WS5-IMPORT-CSV-1 —
 * la comilla sólo abre un campo entrecomillado al INICIO del campo; una comilla
 * suelta a mitad de un nombre («Almacenes "La 14"») es texto, no un cambio de
 * modo que se trague el resto de la línea.
 */
function splitCsvLine(line: string, sep: string): string[] {
  let processedLine = line.trim();
  if (sep === '|' && processedLine.startsWith('|') && processedLine.endsWith('|')) {
    processedLine = processedLine.slice(1, -1);
  }

  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < processedLine.length; i++) {
    const ch = processedLine[i];
    if (inQuotes) {
      if (ch === '"') {
        if (processedLine[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' && current.trim() === '') {
      inQuotes = true;
      current = '';
    } else if (ch === sep) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * Líneas LÓGICAS de un texto delimitado: un salto de línea dentro de un campo
 * entrecomillado (una descripción de varias líneas exportada por Excel) NO
 * parte la fila (AGENT1-AUDIT-WS5-IMPORT-CSV-1; antes se partía por `\n`
 * antes de mirar las comillas y la fila se rompía en dos filas basura).
 * La comilla sólo abre un campo al inicio del campo. Con una comilla sin
 * cerrar (texto mal formado) se vuelve a las líneas físicas: nunca se funden
 * todas las filas restantes en una.
 */
export function splitDelimitedLogicalLines(text: string, sep: string): string[] {
  const physical = text.split(/\r\n|\n|\r/);
  if (sep === '|' || !text.includes('"')) return physical;

  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  let atFieldStart = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '""';
          i++;
          continue;
        }
        inQuotes = false;
      }
      current += ch;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      lines.push(current);
      current = '';
      atFieldStart = true;
      continue;
    }
    current += ch;
    if (ch === sep) {
      atFieldStart = true;
    } else if (ch === '"' && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (ch !== ' ' && ch !== '\t') {
      atFieldStart = false;
    }
  }
  if (inQuotes) return physical;
  lines.push(current);
  return lines;
}

/**
 * Texto de un archivo CSV/TXT con la codificación correcta.
 * AGENT1-AUDIT-WS5-IMPORT-CSV-1 — el drawer leía todo como UTF-8: un CSV de
 * Excel en Windows (Windows-1252) salía con «Compa�ía». Orden: BOM UTF-8 /
 * UTF-16 si lo hay; si no, UTF-8 ESTRICTO; si no es UTF-8 válido, Windows-1252.
 */
export function decodeImportTextFile(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  const withoutBom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(withoutBom);
  } catch {
    return new TextDecoder('windows-1252').decode(withoutBom);
  }
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => !c.trim());
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
  return cells.every(cell => {
    const trimmed = cell.trim();
    return trimmed.length > 0 && /^[:\-\s]+$/.test(trimmed);
  });
}

function isValidUrl(value: string): boolean {
  try {
    const url = value.startsWith('http') ? value : `https://${value}`;
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ── Normalización de alias de columna ─────────────────────────

export function normalizeImportColumns(headers: string[]): {
  fieldMap: Array<{ original: string; field: string | null }>;
  recognized: string[];
  unrecognized: string[];
  duplicateFields: string[];
} {
  const fieldMap = headers.map((h) => resolveHeader(h));
  const seenFields = new Map<string, number>();
  const duplicateFields: string[] = [];

  for (const { field } of fieldMap) {
    if (field === null) continue;
    const count = (seenFields.get(field) ?? 0) + 1;
    seenFields.set(field, count);
    if (count === 2) duplicateFields.push(field);
  }

  const recognized = fieldMap.filter((f) => f.field !== null).map((f) => f.field as string);
  const unrecognized = fieldMap.filter((f) => f.field === null).map((f) => f.original);
  return { fieldMap, recognized, unrecognized, duplicateFields };
}

// ── Validación de fila con defaults ───────────────────────────

function normalizeConfidence(val?: string): string | undefined {
  if (!val) return undefined;
  const clean = val.trim().toLowerCase();
  if (['alta', 'high', 'alto', 'h'].includes(clean)) return 'alta';
  if (['media', 'medium', 'medio', 'm'].includes(clean)) return 'media';
  if (['baja', 'low', 'bajo', 'l'].includes(clean)) return 'baja';
  return clean;
}

function validateRow(raw: ParsedImportRow, index: number, defaults?: ImportDefaults): ImportRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Capture original file values before defaults are applied
  const industryOriginalValue = raw.industry?.trim() || null;
  const subindustryOriginalValue = raw.subindustry?.trim() || null;

  if (!raw.company_name || !raw.company_name.trim()) {
    errors.push('Falta nombre de empresa');
  }

  const hasCountryInRow = !!(raw.country?.trim() || raw.country_code?.trim());
  const country_from_default = !hasCountryInRow && !!(defaults?.countryCode || defaults?.country);
  const industry_from_default = !raw.industry?.trim() && !!defaults?.industry;
  const subindustry_from_default = !raw.subindustry?.trim() && !!defaults?.subindustry;

  // Effective values after applying defaults
  const effectiveCountry = raw.country?.trim() || (country_from_default ? defaults?.country : undefined);
  const effectiveCountryCode = raw.country_code?.trim().toUpperCase() ||
    (raw.country ? resolveCountryCode(raw.country) : null) ||
    (country_from_default ? defaults?.countryCode : undefined) ||
    null;
  const effectiveIndustry = raw.industry?.trim() || (industry_from_default ? defaults?.industry : undefined);
  const effectiveSubindustry = raw.subindustry?.trim() || (subindustry_from_default ? defaults?.subindustry : undefined);

  const hasCountry = hasCountryInRow || country_from_default;
  if (!hasCountry) {
    errors.push('Falta país');
  }

  const resolved_country_code = effectiveCountryCode ?? null;

  if (hasCountry && !resolved_country_code && effectiveCountry) {
    warnings.push(`País "${effectiveCountry}" no reconocido — verificar manualmente`);
  }

  if (!raw.website?.trim()) {
    warnings.push('Sin sitio web');
  } else if (!isValidUrl(raw.website)) {
    warnings.push(`Sitio web inválido: "${raw.website}"`);
  }

  if (!raw.tax_identifier?.trim()) {
    warnings.push('Sin identificador fiscal — requiere revisión');
  } else {
    // AGENT1-IMPORT-PARITY-2 — mismas reglas por país que el alta manual; avisa, no bloquea.
    const taxWarning = resolveImportTaxIdentifier(raw.tax_identifier, effectiveCountryCode).warning;
    if (taxWarning) warnings.push(taxWarning);
  }

  if (!effectiveIndustry) {
    warnings.push('Sin sector/industria');
  }

  if (raw.contact_email?.trim() && !isValidEmail(raw.contact_email)) {
    warnings.push(`Email de contacto inválido: "${raw.contact_email}"`);
  }

  const normalizedConfidence = normalizeConfidence(raw.confidence);

  const status: RowStatus = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';

  // Build raw with defaults applied for downstream use
  const resolvedRaw: ParsedImportRow = {
    ...raw,
    country: effectiveCountry || raw.country,
    country_code: effectiveCountryCode || raw.country_code,
    industry: effectiveIndustry || raw.industry,
    subindustry: effectiveSubindustry || raw.subindustry,
    confidence: normalizedConfidence,
  };

  return {
    index,
    raw: resolvedRaw,
    status,
    errors,
    warnings,
    resolved_country_code: errors.length === 0 ? resolved_country_code : null,
    country_from_default,
    industry_from_default,
    industryOriginalValue,
    subindustryOriginalValue,
  };
}

// ── Parsing de texto (paste o CSV) ────────────────────────────

export interface ParseResult {
  rows: ImportRow[];
  recognized_columns: string[];
  unrecognized_columns: string[];
  duplicate_columns: string[];
  truncated: boolean;
  truncatedAt: number;
  /** IMPORT-FREE-FORMAT-1 — cómo se leyó lo que entró. */
  detection: ImportDetectionMode;
  /** Qué dato se reconoció en cada columna (vacío en el formato oficial). */
  column_guesses: ImportColumnGuess[];
  /** Con `needs_ai`: el texto que hay que mandar a leer con IA. */
  source_text?: string;
}

// El mismo tope que valida el servidor (`import-batch-schema.ts`).
const MAX_IMPORT_ROWS = IMPORT_BATCH_MAX_ROWS;

const EMPTY_PARSE: ParseResult = {
  rows: [],
  recognized_columns: [],
  unrecognized_columns: [],
  duplicate_columns: [],
  truncated: false,
  truncatedAt: 0,
  detection: 'needs_ai',
  column_guesses: [],
};

interface TabularBlock {
  sep: string;
  lineCount: number;
  rowsOfCells: string[][];
}

/** Bloques contiguos de líneas con el mismo separador, ya partidos en celdas. */
function findTabularBlocks(text: string): TabularBlock[] {
  const found: TabularBlock[] = [];

  for (const sep of ['\t', '|', ';', ',']) {
    // Líneas lógicas para este separador (respetan saltos dentro de comillas).
    const allLines = splitDelimitedLogicalLines(text, sep);
    // Find contiguous blocks of non-blank lines containing the separator
    const blocks: string[][] = [];
    let currentBlock: string[] = [];

    for (const line of allLines) {
      const trimmed = line.trim();
      if (trimmed && line.split(sep).length - 1 >= 1) {
        currentBlock.push(line);
        continue;
      }
      if (currentBlock.length > 0) {
        blocks.push(currentBlock);
        currentBlock = [];
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }

    for (const blockLines of blocks) {
      if (blockLines.length < 2) continue;

      // For '|', check if it's a valid Markdown table block
      if (sep === '|') {
        const hasSeparator = blockLines.some(line => {
          const clean = line.trim().replace(/^\|/, '').replace(/\|$/, '');
          const cells = clean.split('|').map(c => c.trim());
          return cells.length > 0 && cells.every(cell => /^[:\-\s]+$/.test(cell) && cell.length > 0);
        });

        const allHavePipes = blockLines.every(line => {
          const trimmed = line.trim();
          const pipeCount = (trimmed.match(/\|/g) ?? []).length;
          return (trimmed.startsWith('|') || trimmed.endsWith('|') || pipeCount >= 2);
        });

        if (!hasSeparator && !allHavePipes) {
          continue; // Not a valid Markdown table block
        }
      }

      let rowsOfCells: string[][];
      if (sep === '|') {
        rowsOfCells = blockLines.map(line => {
          const clean = line.trim().replace(/^\|/, '').replace(/\|$/, '');
          return clean.split('|').map(c => c.trim());
        });
        // Filter out Markdown separator rows
        rowsOfCells = rowsOfCells.filter(cells => !isMarkdownSeparatorRow(cells));
      } else {
        rowsOfCells = blockLines.map(line => splitCsvLine(line, sep));
      }

      if (rowsOfCells.length < 2) continue;
      found.push({ sep, lineCount: blockLines.length, rowsOfCells });
    }
  }
  return found;
}

function extractAndParseTable(text: string, defaults?: ImportDefaults): ParseResult | null {
  const nonBlankLines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (nonBlankLines.length < 2) {
    return null;
  }

  let bestBlock: { headers: string[]; dataRows: string[][]; score: number } | null = null;
  for (const block of findTabularBlocks(text)) {
    const headers = block.rowsOfCells[0];
    // Calculate score based on recognized columns and line count
    const recognizedCount = normalizeImportColumns(headers).recognized.length;
    if (recognizedCount === 0) continue;
    const score = recognizedCount * 1000 + block.lineCount;
    if (!bestBlock || score > bestBlock.score) {
      bestBlock = { headers, dataRows: block.rowsOfCells.slice(1), score };
    }
  }

  if (!bestBlock) return null;
  return buildContractResult(bestBlock.headers, bestBlock.dataRows, defaults);
}

/** Filas de una tabla con los encabezados del contrato oficial. */
function buildContractResult(headers: string[], dataRows: string[][], defaults?: ImportDefaults): ParseResult {
  const { fieldMap, recognized, unrecognized, duplicateFields } = normalizeImportColumns(headers);

  const truncated = dataRows.length > MAX_IMPORT_ROWS;
  const limitedRows = truncated ? dataRows.slice(0, MAX_IMPORT_ROWS) : dataRows;

  const rows: ImportRow[] = [];
  let rowIndex = 0;

  for (const cells of limitedRows) {
    if (isBlankRow(cells)) continue;

    const rawObj: Record<string, string> = {};
    for (let i = 0; i < fieldMap.length; i++) {
      const { field } = fieldMap[i];
      if (field && cells[i] !== undefined) {
        rawObj[field] = cells[i]?.trim() ?? '';
      }
    }

    const raw = rawObj as unknown as ParsedImportRow;
    rows.push(validateRow(raw, rowIndex, defaults));
    rowIndex++;
  }

  return {
    rows,
    recognized_columns: recognized,
    unrecognized_columns: unrecognized,
    duplicate_columns: duplicateFields,
    truncated,
    truncatedAt: MAX_IMPORT_ROWS,
    detection: 'contract',
    column_guesses: [],
  };
}

/**
 * AGENT1-AUDIT-WS5-IMPORT-HEADER-HINTS-1 — fuera del formato oficial, una
 * columna se toma como identificador fiscal por la FORMA de sus valores (8-14
 * dígitos, guion de verificación…). Si el valor no es válido para el país de
 * la fila, no se persiste como identificador fiscal (alimentaría identidad y
 * reclamo global con un teléfono): se deja en las notas para que se vea.
 * El formato oficial (columna «NIT» declarada) mantiene la regla de
 * AGENT1-IMPORT-PARITY-2: inválido = aviso, no se descarta.
 */
function dropInvalidGuessedTaxIdentifier(raw: ParsedImportRow, defaults?: ImportDefaults): ParsedImportRow {
  const value = raw.tax_identifier?.trim();
  if (!value) return raw;
  const countryCode =
    raw.country_code?.trim().toUpperCase() ||
    (raw.country ? resolveCountryCode(raw.country) : null) ||
    defaults?.countryCode ||
    null;
  if (resolveImportTaxIdentifier(value, countryCode).status !== 'invalid') return raw;
  const note = `Número descartado como identificador fiscal (no válido para ${countryCode}): ${value}`;
  return {
    ...raw,
    tax_identifier: undefined,
    notes: raw.notes ? `${raw.notes}\n${note}` : note,
  };
}

/**
 * IMPORT-FREE-FORMAT-1 — filas que no vienen del formato oficial (columnas
 * reconocidas por su contenido, lista o lectura con IA) pasan por la MISMA
 * validación que el formato oficial.
 */
export function buildParseResultFromParsedRows(
  parsedRows: ParsedImportRow[],
  defaults: ImportDefaults | undefined,
  detection: ImportDetectionMode,
  columnGuesses: ImportColumnGuess[] = [],
): ParseResult {
  if (detection === 'needs_ai' || parsedRows.length === 0) {
    return { ...EMPTY_PARSE, detection, column_guesses: columnGuesses };
  }
  const truncated = parsedRows.length > MAX_IMPORT_ROWS;
  const limited = truncated ? parsedRows.slice(0, MAX_IMPORT_ROWS) : parsedRows;
  const recognized = [...new Set(columnGuesses.map((g) => g.field).filter((f): f is ImportFieldKey => f !== null))];
  // Un identificador fiscal ADIVINADO por su forma que no es válido para el
  // país no se guarda como tal (era un teléfono, un código interno…).
  const guessedByShape = detection === 'columns_by_content' || detection === 'company_list';
  return {
    rows: limited.map((raw, index) =>
      validateRow(guessedByShape ? dropInvalidGuessedTaxIdentifier(raw, defaults) : raw, index, defaults),
    ),
    recognized_columns: recognized.length > 0 ? recognized : ['company_name'],
    unrecognized_columns: columnGuesses.filter((g) => g.field === null).map((g) => g.column),
    duplicate_columns: [],
    truncated,
    truncatedAt: MAX_IMPORT_ROWS,
    detection,
    column_guesses: columnGuesses,
  };
}

/** La tabla cuyas columnas se reconocen mejor por su contenido. */
function parseBestTableByContent(text: string): FreeFormParse | null {
  let best: { parse: FreeFormParse; score: number } | null = null;
  for (const block of findTabularBlocks(text)) {
    const parse = parseMatrixByContent(block.rowsOfCells);
    if (!parse) continue;
    const typedFields = parse.columnGuesses.filter(
      (g) => g.field && g.field !== 'company_name' && g.field !== 'description',
    ).length;
    // Con comas, una lista «Acme, S.A.» parece una tabla de dos columnas: sólo
    // vale si alguna columna tiene forma clara (web, NIT, país…).
    if (block.sep === ',' && typedFields === 0) continue;
    const score = typedFields * 1000 + parse.rows.length;
    if (!best || score > best.score) best = { parse, score };
  }
  return best?.parse ?? null;
}

function parseTextToRows(text: string, defaults?: ImportDefaults): ParseResult {
  if (!text.trim()) return EMPTY_PARSE;

  const parsed = extractAndParseTable(text, defaults);
  if (parsed && parsed.recognized_columns.includes('company_name')) {
    return parsed;
  }

  // Una sola columna con su encabezado oficial («Empresa» y un nombre por línea).
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && normalizeImportColumns([lines[0]]).recognized[0] === 'company_name') {
    return buildContractResult([lines[0]], lines.slice(1).map((line) => [line]), defaults);
  }

  // IMPORT-FREE-FORMAT-1 — fuera del formato oficial: tabla por contenido, lista
  // de nombres o, si es texto corrido, lectura con IA (la pide el drawer).
  const byContent = parseBestTableByContent(text);
  if (byContent) {
    return buildParseResultFromParsedRows(byContent.rows, defaults, byContent.mode, byContent.columnGuesses);
  }
  const list = parseCompanyList(text);
  const result = buildParseResultFromParsedRows(list.rows, defaults, list.mode, list.columnGuesses);
  return result.detection === 'needs_ai' ? { ...result, source_text: text } : result;
}

// ── Parsing de XLSX (async, cliente) ──────────────────────────

export async function parseXlsxCandidates(
  file: File,
  defaults?: ImportDefaults
): Promise<ParseResult> {
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('El archivo supera 2 MB. Usa un archivo más pequeño.');
  }

  const buffer = await file.arrayBuffer();
  // Dynamic import to avoid SSR issues with the xlsx bundle
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return EMPTY_PARSE;

  const sheet = workbook.Sheets[sheetName];
  const matrix = (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][])
    .map((cells) => cells.map((c) => String(c ?? '')))
    .filter((cells) => cells.some((c) => c.trim()));

  return parseMatrixToRows(matrix, defaults);
}

/** Una hoja ya leída: formato oficial si sus encabezados lo son; si no, por contenido. */
export function parseMatrixToRows(matrix: string[][], defaults?: ImportDefaults): ParseResult {
  if (matrix.length === 0) return EMPTY_PARSE;
  if (matrix.length >= 2 && normalizeImportColumns(matrix[0]).recognized.includes('company_name')) {
    return buildContractResult(matrix[0], matrix.slice(1), defaults);
  }
  const byContent = parseMatrixByContent(matrix);
  if (byContent) {
    return buildParseResultFromParsedRows(byContent.rows, defaults, byContent.mode, byContent.columnGuesses);
  }
  // Una hoja con una sola columna de texto largo: es texto corrido.
  return parseTextToRows(matrix.map((cells) => cells.filter((c) => c.trim()).join(' · ')).join('\n'), defaults);
}

// ── API pública ────────────────────────────────────────────────

export function parsePastedCandidates(text: string, defaults?: ImportDefaults): ParseResult {
  return parseTextToRows(text, defaults);
}

export function parseCsvCandidates(csvText: string, defaults?: ImportDefaults): ParseResult {
  return parseTextToRows(csvText, defaults);
}

export function buildImportPreview(parseResult: ParseResult): ImportPreview {
  const { rows, recognized_columns, unrecognized_columns, duplicate_columns } = parseResult;
  const valid = rows.filter((r) => r.status === 'valid').length;
  const errors = rows.filter((r) => r.status === 'error').length;
  const warnings_only = rows.filter((r) => r.status === 'warning').length;

  return {
    total: rows.length,
    valid,
    errors,
    warnings_only,
    recognized_columns,
    unrecognized_columns,
    duplicateColumns: duplicate_columns,
    rows,
    detection: parseResult.detection,
    column_guesses: parseResult.column_guesses,
  };
}

export function getValidRows(preview: ImportPreview): ImportRow[] {
  return preview.rows.filter((r) => r.status !== 'error');
}
