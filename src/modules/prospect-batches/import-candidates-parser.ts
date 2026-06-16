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
    aliases: ['nit', 'rut', 'rfc', 'identificacion fiscal', 'tax id', 'tax_identifier', 'tax identifier', 'id fiscal'],
    required: false,
    recommended: false,
    description: 'Identificador fiscal (NIT en Colombia, RUT en Chile, RFC en México).',
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

function detectSeparator(line: string): string {
  const tabCount = (line.match(/\t/g) ?? []).length;
  const pipeCount = (line.match(/\|/g) ?? []).length;
  const semicolonCount = (line.match(/;/g) ?? []).length;
  const commaCount = (line.match(/,/g) ?? []).length;
  
  if (tabCount >= commaCount && tabCount >= semicolonCount && tabCount >= pipeCount) return '\t';
  if (pipeCount > tabCount && pipeCount >= commaCount && pipeCount >= semicolonCount) return '|';
  if (semicolonCount >= commaCount) return ';';
  return ',';
}

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
    if (ch === '"') {
      if (inQuotes && processedLine[i + 1] === '"') {
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

interface ParseResult {
  rows: ImportRow[];
  recognized_columns: string[];
  unrecognized_columns: string[];
  duplicate_columns: string[];
  truncated: boolean;
  truncatedAt: number;
}

const MAX_IMPORT_ROWS = 500;

function extractAndParseTable(text: string, defaults?: ImportDefaults): ParseResult | null {
  const allLines = text.split(/\r?\n/);
  const nonBlankLines = allLines.filter(line => line.trim().length > 0);
  
  if (nonBlankLines.length < 2) {
    return null;
  }
  
  const separators = ['\t', '|', ';', ','];
  let bestBlock: { sep: string; headers: string[]; dataRows: string[][]; score: number } | null = null;
  
  for (const sep of separators) {
    // Find contiguous blocks of non-blank lines containing the separator
    const blocks: string[][] = [];
    let currentBlock: string[] = [];
    
    for (const line of allLines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
        continue;
      }
      
      const sepCount = line.split(sep).length - 1;
      if (sepCount >= 1) {
        currentBlock.push(line);
      } else {
        if (currentBlock.length > 0) {
          blocks.push(currentBlock);
          currentBlock = [];
        }
      }
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock);
    }
    
    // For each block, parse and score
    for (const blockLines of blocks) {
      if (blockLines.length < 2) continue;
      
      // For '|', check if it's a valid Markdown table block
      if (sep === '|') {
        const hasSeparator = blockLines.some(line => {
          const trimmed = line.trim();
          const clean = trimmed.replace(/^\|/, '').replace(/\|$/, '');
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
      
      // Parse rows of cells
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
      
      const headers = rowsOfCells[0];
      const dataRows = rowsOfCells.slice(1);
      
      // Calculate score based on recognized columns and line count
      const { recognized } = normalizeImportColumns(headers);
      const recognizedCount = recognized.length;
      
      if (recognizedCount > 0) {
        const score = recognizedCount * 1000 + blockLines.length;
        if (!bestBlock || score > bestBlock.score) {
          bestBlock = {
            sep,
            headers,
            dataRows,
            score
          };
        }
      }
    }
  }
  
  if (bestBlock) {
    const { headers, dataRows } = bestBlock;
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
      truncatedAt: MAX_IMPORT_ROWS
    };
  }
  
  return null;
}

function parseTextToRows(text: string, defaults?: ImportDefaults): ParseResult {
  const parsed = extractAndParseTable(text, defaults);
  if (parsed) {
    return parsed;
  }

  // Fallback to previous behavior
  const allLines = text.split(/\r?\n/).filter((l) => l.trim());
  if (allLines.length < 2) {
    return { rows: [], recognized_columns: [], unrecognized_columns: [], duplicate_columns: [], truncated: false, truncatedAt: 0 };
  }

  const sep = detectSeparator(allLines[0]);
  const headers = splitCsvLine(allLines[0], sep);
  const { fieldMap, recognized, unrecognized, duplicateFields } = normalizeImportColumns(headers);

  const dataLines = allLines.slice(1);
  const truncated = dataLines.length > MAX_IMPORT_ROWS;
  const limitedLines = truncated ? dataLines.slice(0, MAX_IMPORT_ROWS) : dataLines;

  const rows: ImportRow[] = [];
  let rowIndex = 0;

  for (const line of limitedLines) {
    const cells = splitCsvLine(line, sep);
    if (isBlankRow(cells)) continue;
    if (isMarkdownSeparatorRow(cells)) continue;

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

  return { rows, recognized_columns: recognized, unrecognized_columns: unrecognized, duplicate_columns: duplicateFields, truncated, truncatedAt: MAX_IMPORT_ROWS };
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
    return { rows: [], recognized_columns: [], unrecognized_columns: [], duplicate_columns: [], truncated: false, truncatedAt: 0 };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  if (matrix.length < 2) {
    return { rows: [], recognized_columns: [], unrecognized_columns: [], duplicate_columns: [], truncated: false, truncatedAt: 0 };
  }

  const headers = (matrix[0] as unknown[]).map((h) => String(h ?? ''));
  const { fieldMap, recognized, unrecognized, duplicateFields } = normalizeImportColumns(headers);

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
    duplicate_columns: duplicateFields,
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
  };
}

export function getValidRows(preview: ImportPreview): ImportRow[] {
  return preview.rows.filter((r) => r.status !== 'error');
}
