// ── Tipos ─────────────────────────────────────────────────────

export type ImportMethod = 'paste' | 'csv' | 'xlsx';

export interface ImportDefaults {
  country?: string;
  countryCode?: string;
  industry?: string;
}

export interface ParsedImportRow {
  company_name: string;
  country?: string;
  country_code?: string;
  website?: string;
  industry?: string;
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
}

export interface ImportPreview {
  total: number;
  valid: number;
  errors: number;
  warnings_only: number;
  recognized_columns: string[];
  unrecognized_columns: string[];
  rows: ImportRow[];
}

const COLUMN_ALIASES: Record<string, string> = {
  // company_name
  empresa: 'company_name',
  'nombre empresa': 'company_name',
  'nombre de empresa': 'company_name',
  'razon social': 'company_name',
  company: 'company_name',
  'company name': 'company_name',
  organization: 'company_name',
  'organization name': 'company_name',
  nombre: 'company_name',
  // country
  pais: 'country',
  country: 'country',
  // country_code
  country_code: 'country_code',
  'codigo pais': 'country_code',
  'iso country': 'country_code',
  // website
  'sitio web': 'website',
  web: 'website',
  website: 'website',
  url: 'website',
  dominio: 'website',
  domain: 'website',
  // industry
  sector: 'industry',
  industria: 'industry',
  industry: 'industry',
  vertical: 'industry',
  rubro: 'industry',
  giro: 'industry',
  // tax_identifier
  nit: 'tax_identifier',
  rut: 'tax_identifier',
  rfc: 'tax_identifier',
  'identificacion fiscal': 'tax_identifier',
  'tax id': 'tax_identifier',
  tax_identifier: 'tax_identifier',
  'tax identifier': 'tax_identifier',
  'id fiscal': 'tax_identifier',
  // linkedin_url
  linkedin: 'linkedin_url',
  'linkedin url': 'linkedin_url',
  'linkedin company': 'linkedin_url',
  'perfil linkedin': 'linkedin_url',
  linkedin_url: 'linkedin_url',
  // city
  ciudad: 'city',
  city: 'city',
  // region
  region: 'region',
  departamento: 'region',
  estado: 'region',
  provincia: 'region',
  // company_size
  tamano: 'company_size',
  'tamano empresa': 'company_size',
  company_size: 'company_size',
  empleados: 'company_size',
  'tamano estimado': 'company_size',
  employees: 'company_size',
  'estimated size': 'company_size',
  'company size': 'company_size',
  // description
  descripcion: 'description',
  description: 'description',
  'que hace': 'description',
  // notes
  notas: 'notes',
  notes: 'notes',
  observaciones: 'notes',
  // source_url
  'url evidencia principal': 'source_url',
  'evidencia principal': 'source_url',
  'evidence url': 'source_url',
  'source url': 'source_url',
  'fuente url': 'source_url',
  source_url: 'source_url',
  evidence_url: 'source_url',
  // source_evidence
  'fuente / evidencia': 'source_evidence',
  'fuente evidencia': 'source_evidence',
  fuente: 'source_evidence',
  evidencia: 'source_evidence',
  'source evidence': 'source_evidence',
  source_evidence: 'source_evidence',
  // confidence
  confianza: 'confidence',
  confidence: 'confidence',
  'nivel de confianza': 'confidence',
  // contact fields
  contacto: 'contact_name',
  contact_name: 'contact_name',
  'nombre contacto': 'contact_name',
  'contact name': 'contact_name',
  cargo: 'contact_role',
  contact_role: 'contact_role',
  rol: 'contact_role',
  'email contacto': 'contact_email',
  contact_email: 'contact_email',
  'correo contacto': 'contact_email',
  // owner
  owner_email: 'owner_email',
  responsable: 'owner_email',
  asignado: 'owner_email',
};

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

function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-]/g, ' ')
    .replace(/\s+/g, ' ');
}

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

function detectSeparator(line: string): string {
  const tabCount = (line.match(/\t/g) ?? []).length;
  const commaCount = (line.match(/,/g) ?? []).length;
  const semicolonCount = (line.match(/;/g) ?? []).length;
  if (tabCount >= commaCount && tabCount >= semicolonCount) return '\t';
  if (semicolonCount >= commaCount) return ';';
  return ',';
}

function splitCsvLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isBlankRow(cells: string[]): boolean {
  return cells.every((c) => !c.trim());
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
} {
  const fieldMap = headers.map((h) => resolveHeader(h));
  const recognized = fieldMap.filter((f) => f.field !== null).map((f) => f.field as string);
  const unrecognized = fieldMap.filter((f) => f.field === null).map((f) => f.original);
  return { fieldMap, recognized, unrecognized };
}

// ── Validación de fila con defaults ───────────────────────────

function validateRow(raw: ParsedImportRow, index: number, defaults?: ImportDefaults): ImportRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!raw.company_name || !raw.company_name.trim()) {
    errors.push('Falta nombre de empresa');
  }

  const hasCountryInRow = !!(raw.country?.trim() || raw.country_code?.trim());
  const country_from_default = !hasCountryInRow && !!(defaults?.countryCode || defaults?.country);
  const industry_from_default = !raw.industry?.trim() && !!defaults?.industry;

  // Effective values after applying defaults
  const effectiveCountry = raw.country?.trim() || (country_from_default ? defaults?.country : undefined);
  const effectiveCountryCode = raw.country_code?.trim().toUpperCase() ||
    (raw.country ? resolveCountryCode(raw.country) : null) ||
    (country_from_default ? defaults?.countryCode : undefined) ||
    null;
  const effectiveIndustry = raw.industry?.trim() || (industry_from_default ? defaults?.industry : undefined);

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
  }

  if (!effectiveIndustry) {
    warnings.push('Sin sector/industria');
  }

  if (raw.contact_email?.trim() && !isValidEmail(raw.contact_email)) {
    warnings.push(`Email de contacto inválido: "${raw.contact_email}"`);
  }

  const status: RowStatus = errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';

  // Build raw with defaults applied for downstream use
  const resolvedRaw: ParsedImportRow = {
    ...raw,
    country: effectiveCountry || raw.country,
    country_code: effectiveCountryCode || raw.country_code,
    industry: effectiveIndustry || raw.industry,
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
  };
}

// ── Parsing de texto (paste o CSV) ────────────────────────────

interface ParseResult {
  rows: ImportRow[];
  recognized_columns: string[];
  unrecognized_columns: string[];
  truncated: boolean;
  truncatedAt: number;
}

const MAX_IMPORT_ROWS = 500;

function parseTextToRows(text: string, defaults?: ImportDefaults): ParseResult {
  const allLines = text.split(/\r?\n/).filter((l) => l.trim());
  if (allLines.length < 2) {
    return { rows: [], recognized_columns: [], unrecognized_columns: [], truncated: false, truncatedAt: 0 };
  }

  const sep = detectSeparator(allLines[0]);
  const headers = splitCsvLine(allLines[0], sep);
  const { fieldMap, recognized, unrecognized } = normalizeImportColumns(headers);

  const dataLines = allLines.slice(1);
  const truncated = dataLines.length > MAX_IMPORT_ROWS;
  const limitedLines = truncated ? dataLines.slice(0, MAX_IMPORT_ROWS) : dataLines;

  const rows: ImportRow[] = [];
  let rowIndex = 0;

  for (const line of limitedLines) {
    const cells = splitCsvLine(line, sep);
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

  return { rows, recognized_columns: recognized, unrecognized_columns: unrecognized, truncated, truncatedAt: MAX_IMPORT_ROWS };
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
  if (!sheetName) {
    return { rows: [], recognized_columns: [], unrecognized_columns: [], truncated: false, truncatedAt: 0 };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  if (matrix.length < 2) {
    return { rows: [], recognized_columns: [], unrecognized_columns: [], truncated: false, truncatedAt: 0 };
  }

  const headers = (matrix[0] as unknown[]).map((h) => String(h ?? ''));
  const { fieldMap, recognized, unrecognized } = normalizeImportColumns(headers);

  const dataRows = matrix.slice(1) as unknown[][];
  const truncated = dataRows.length > MAX_IMPORT_ROWS;
  const limitedRows = truncated ? dataRows.slice(0, MAX_IMPORT_ROWS) : dataRows;

  const rows: ImportRow[] = [];
  let rowIndex = 0;

  for (const cells of limitedRows) {
    const cellsArr = cells as unknown[];
    if (cellsArr.every((c) => !String(c ?? '').trim())) continue;

    const rawObj: Record<string, string> = {};
    for (let i = 0; i < fieldMap.length; i++) {
      const { field } = fieldMap[i];
      if (field && cellsArr[i] !== undefined) {
        rawObj[field] = String(cellsArr[i] ?? '').trim();
      }
    }

    rows.push(validateRow(rawObj as unknown as ParsedImportRow, rowIndex, defaults));
    rowIndex++;
  }

  return {
    rows,
    recognized_columns: recognized,
    unrecognized_columns: unrecognized,
    truncated,
    truncatedAt: MAX_IMPORT_ROWS,
  };
}

// ── API pública ────────────────────────────────────────────────

export function parsePastedCandidates(text: string, defaults?: ImportDefaults): ParseResult {
  return parseTextToRows(text, defaults);
}

export function parseCsvCandidates(csvText: string, defaults?: ImportDefaults): ParseResult {
  return parseTextToRows(csvText, defaults);
}

export function buildImportPreview(parseResult: ParseResult): ImportPreview {
  const { rows, recognized_columns, unrecognized_columns } = parseResult;
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
    rows,
  };
}

export function getValidRows(preview: ImportPreview): ImportRow[] {
  return preview.rows.filter((r) => r.status !== 'error');
}
