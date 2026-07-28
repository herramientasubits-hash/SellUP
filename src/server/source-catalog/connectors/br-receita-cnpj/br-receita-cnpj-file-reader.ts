/**
 * BR Receita CNPJ — sanitized local CSV fixture reader (BR-SOURCE-4).
 *
 * A safe layer BETWEEN small SYNTHETIC CSV files (Receita-like layout) and the
 * ALREADY-MERGED offline local/sample parser (BR-SOURCE-2). It turns a fixed,
 * internal fixture directory of synthetic CSVs into a `BrReceitaCnpjParserInput`.
 *
 * ── This reader NEVER (fail-closed by construction) ─────────────────────────
 *   - downloads or reads a REAL Receita dataset (fixtures are 100% synthetic).
 *   - accepts a caller-supplied / user path: the ONE fixture directory is fixed
 *     and resolved from this module's own location (no path parameter exists).
 *   - opens a Supabase client, reads env vars, or writes to any database.
 *   - performs network I/O, imports, production writes, or runtime enrichment.
 *   - preserves a raw CSV row: only allow-listed columns are mapped, and the
 *     personal-data / contact / fine-address columns are stripped at read time.
 *
 * Fail-closed layout validation (Task 6):
 *   - missing a required header  → BrReceitaCnpjMissingHeaderError.
 *   - SOCIOS / QSA / CPF token in any header or filename → BrReceitaCnpj*Error.
 *   - an UNKNOWN header carrying a sensitive token → BrReceitaCnpjForbiddenColumnError.
 *   - an UNKNOWN non-sensitive header, with `strict` → BrReceitaCnpjUnknownColumnError.
 *   - more establishment rows than `maxRows` (≤ 10) → BrReceitaCnpjRowLimitError.
 *
 * The parser itself (buildBrReceitaCnpjSnapshotRows) remains the authority on
 * CNPJ validity, duplicates, and root-company checks; this reader only produces
 * its sanitized input.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  BrReceitaCnpjParserInput,
  BrReceitaEmpresaRow,
  BrReceitaEstabelecimentoRow,
  BrReceitaSimplesRow,
  BrReceitaLookupRow,
} from './br-receita-cnpj-types';

// ─── Public constants ────────────────────────────────────────────────────────

/** The only synthetic-CSV fixture the reader/runner accepts. */
export const BR_RECEITA_CNPJ_SYNTHETIC_CSV_FIXTURE = 'synthetic-csv' as const;
export type BrReceitaCnpjSyntheticFileFixture = typeof BR_RECEITA_CNPJ_SYNTHETIC_CSV_FIXTURE;

/** Hard ceiling on establishment rows fed to the parser (mirrors the runner). */
export const BR_RECEITA_CNPJ_FILE_READER_MAX_ROWS = 10 as const;

/** Snapshot year/period stamped onto the synthetic-CSV parser input. */
export const BR_RECEITA_CNPJ_SYNTHETIC_CSV_SOURCE_YEAR = 2026 as const;
export const BR_RECEITA_CNPJ_SYNTHETIC_CSV_PERIOD = '2026-07' as const;

/**
 * The ONE allowed fixture directory, resolved from this module's own location —
 * never from a caller/user argument. This is the sole path the reader will ever
 * touch on disk.
 */
export const BR_RECEITA_CNPJ_SYNTHETIC_CSV_FIXTURE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'scripts',
  'source-catalog',
  'fixtures',
  'br-receita-cnpj-synthetic',
);

/** Canonical fixture file names within the fixture directory. */
export const BR_RECEITA_CNPJ_FIXTURE_FILES = {
  empresas: 'empresas.csv',
  estabelecimentos: 'estabelecimentos.csv',
  simples: 'simples.csv',
  cnaes: 'cnaes.csv',
  municipios: 'municipios.csv',
  naturezas: 'naturezas.csv',
} as const;

/**
 * Tokens that mark categorically forbidden personal-data sources. Their presence
 * in ANY header or file name is a hard, unconditional failure — SOCIOS/QSA/CPF
 * are never part of an allowed layout.
 */
export const BR_RECEITA_CNPJ_FORBIDDEN_TOKENS = [
  'socio',
  'socios',
  'qsa',
  'cpf',
  'representante',
  'faixa_etaria',
] as const;

/**
 * Sensitive contact / fine-address tokens. Recognized establishment columns that
 * carry these are stripped at read time; the SAME token on an UNKNOWN header (a
 * column appearing where it is not part of the layout) is a fail-closed error.
 */
export const BR_RECEITA_CNPJ_SENSITIVE_STRIPPED_TOKENS = [
  'ddd',
  'telefone',
  'fax',
  'correio',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cep',
] as const;

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Base for every reader fail-closed condition. */
export class BrReceitaCnpjFileReaderError extends Error {
  constructor(message: string) {
    super(`BRSOURCE4_FILE_READER: ${message}`);
    this.name = 'BrReceitaCnpjFileReaderError';
  }
}

/** A required header is absent from a file. */
export class BrReceitaCnpjMissingHeaderError extends BrReceitaCnpjFileReaderError {
  constructor(file: string, header: string) {
    super(`missing required header "${header}" in ${file}`);
    this.name = 'BrReceitaCnpjMissingHeaderError';
  }
}

/** A forbidden personal-data column, or an unknown column carrying a sensitive token. */
export class BrReceitaCnpjForbiddenColumnError extends BrReceitaCnpjFileReaderError {
  constructor(file: string, header: string) {
    super(`forbidden/sensitive column "${header}" in ${file}`);
    this.name = 'BrReceitaCnpjForbiddenColumnError';
  }
}

/** A forbidden personal-data file (SOCIOS/QSA/CPF) appears in the fixture directory. */
export class BrReceitaCnpjForbiddenFileError extends BrReceitaCnpjFileReaderError {
  constructor(file: string) {
    super(`forbidden personal-data file "${file}" (SOCIOS/QSA/CPF are never processed)`);
    this.name = 'BrReceitaCnpjForbiddenFileError';
  }
}

/** An unknown (non-sensitive) column under `strict`. */
export class BrReceitaCnpjUnknownColumnError extends BrReceitaCnpjFileReaderError {
  constructor(file: string, header: string) {
    super(`unknown column "${header}" in ${file} (strict mode)`);
    this.name = 'BrReceitaCnpjUnknownColumnError';
  }
}

/** The establishment row count exceeds the allowed maximum. */
export class BrReceitaCnpjRowLimitError extends BrReceitaCnpjFileReaderError {
  constructor(message: string) {
    super(message);
    this.name = 'BrReceitaCnpjRowLimitError';
  }
}

/**
 * A file validated in `official_headerless` mode is empty — no first (data) line
 * could be read to count columns.
 */
export class BrReceitaCnpjEmptyFileError extends BrReceitaCnpjFileReaderError {
  constructor(file: string) {
    super(`empty file "${file}" (no line found for headerless layout validation)`);
    this.name = 'BrReceitaCnpjEmptyFileError';
  }
}

/**
 * A headerless file's first (data) line has a column count that does not match
 * the official positional layout for its file type.
 */
export class BrReceitaCnpjHeaderlessColumnCountError extends BrReceitaCnpjFileReaderError {
  readonly expectedColumns: number;
  readonly actualColumns: number;
  constructor(file: string, expectedColumns: number, actualColumns: number) {
    super(
      `headerless column count mismatch in "${file}": expected ${expectedColumns}, got ${actualColumns}`,
    );
    this.name = 'BrReceitaCnpjHeaderlessColumnCountError';
    this.expectedColumns = expectedColumns;
    this.actualColumns = actualColumns;
  }
}

// ─── Header configuration (per file) ──────────────────────────────────────────

interface FileHeaderConfig {
  /** Headers that MUST be present (fail-closed if missing). */
  readonly required: readonly string[];
  /** Every recognized header: required + mapped + ignored + sensitive-excluded. */
  readonly known: ReadonlySet<string>;
}

function cfg(required: readonly string[], known: readonly string[]): FileHeaderConfig {
  return { required, known: new Set(known) };
}

const EMPRESAS_CONFIG = cfg(
  ['cnpj_basico'],
  [
    'cnpj_basico',
    'razao_social',
    'natureza_juridica',
    'capital_social',
    'porte_empresa',
    'qualificacao_responsavel',
    'ente_federativo_responsavel',
  ],
);

const ESTABELECIMENTOS_CONFIG = cfg(
  ['cnpj_basico', 'cnpj_ordem', 'cnpj_dv'],
  [
    // identity + mapped
    'cnpj_basico',
    'cnpj_ordem',
    'cnpj_dv',
    'identificador_matriz_filial',
    'situacao_cadastral',
    'data_inicio_atividade',
    'cnae_fiscal_principal',
    'cnae_fiscal_secundaria',
    'uf',
    'municipio',
    // recognized-but-ignored (non-sensitive)
    'nome_fantasia',
    'data_situacao_cadastral',
    'motivo_situacao_cadastral',
    'nome_cidade_exterior',
    'pais',
    'situacao_especial',
    'data_situacao_especial',
    // recognized-but-STRIPPED (contact + fine address, never mapped to output)
    'tipo_logradouro',
    'logradouro',
    'numero',
    'complemento',
    'bairro',
    'cep',
    'ddd_1',
    'telefone_1',
    'ddd_2',
    'telefone_2',
    'ddd_fax',
    'fax',
    'correio_eletronico',
  ],
);

const SIMPLES_CONFIG = cfg(
  ['cnpj_basico'],
  [
    'cnpj_basico',
    'opcao_simples',
    'opcao_mei',
    'data_opcao_simples',
    'data_exclusao_simples',
    'data_opcao_mei',
    'data_exclusao_mei',
  ],
);

const CNAES_CONFIG = cfg(['codigo', 'descricao'], ['codigo', 'descricao']);
const NATUREZAS_CONFIG = cfg(['codigo', 'descricao'], ['codigo', 'descricao']);
const MUNICIPIOS_CONFIG = cfg(['codigo', 'descricao'], ['codigo', 'descricao', 'uf']);

/**
 * The recognized Receita CNPJ layout file types (root/company + establishment +
 * regime + reference catalogs). SOCIOS/QSA/CPF are deliberately absent — they are
 * a categorically excluded personal-data file, never a valid layout.
 */
export type BrReceitaCnpjLayoutFileType =
  | 'empresas'
  | 'estabelecimentos'
  | 'simples'
  | 'cnaes'
  | 'municipios'
  | 'naturezas';

/** Header configuration per layout file type — the single source of layout truth. */
const FILE_HEADER_CONFIGS: Record<BrReceitaCnpjLayoutFileType, FileHeaderConfig> = {
  empresas: EMPRESAS_CONFIG,
  estabelecimentos: ESTABELECIMENTOS_CONFIG,
  simples: SIMPLES_CONFIG,
  cnaes: CNAES_CONFIG,
  municipios: MUNICIPIOS_CONFIG,
  naturezas: NATUREZAS_CONFIG,
};

/**
 * Official positional column count per layout file type — the source of truth for
 * validating the REAL Receita CNPJ open-data files, which ship WITHOUT a header
 * row and must be checked by column layout, not by header names.
 *
 * These counts come from the official Receita Federal CNPJ layout ("metadados")
 * documented as the binding layout authority in
 * `docs/source-catalog/br-receita-cnpj-data-contract.md` (§ 1–2). Each is
 * cross-checked against the recognized header set in `FILE_HEADER_CONFIGS` above:
 * for `empresas` (7), `estabelecimentos` (30), `simples` (7), `cnaes` (2) and
 * `naturezas` (2) the official count equals the recognized-header-set size. The
 * one deliberate difference is `municipios`: the official layout is 2 positional
 * columns (`codigo`, `descricao`), while the header config additionally tolerates
 * an optional `uf` column for synthetic fixtures — so the official count is fixed
 * here at 2, NOT derived from the (size-3) header set.
 *
 * SOCIOS / QSA / CPF are intentionally absent — they are never a valid layout.
 */
export const BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS: Record<
  BrReceitaCnpjLayoutFileType,
  number
> = {
  empresas: 7,
  estabelecimentos: 30,
  simples: 7,
  cnaes: 2,
  municipios: 2,
  naturezas: 2,
};

/**
 * Returns the official positional column count for a layout file type. Throws for
 * an unrecognized type so a headerless file whose layout cannot be mapped fails
 * closed instead of being silently accepted.
 */
export function getBrReceitaCnpjOfficialColumnCount(fileType: BrReceitaCnpjLayoutFileType): number {
  const expected = BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS[fileType];
  if (expected === undefined) {
    throw new BrReceitaCnpjFileReaderError(
      `no official headerless column count is defined for file type "${fileType}"`,
    );
  }
  return expected;
}

// ─── CSV parsing (minimal, dependency-free, no streaming) ─────────────────────

/**
 * Parses a small CSV string into rows of string cells. Supports double-quoted
 * fields (with `""` escapes and embedded commas/newlines). Intentionally minimal
 * — for tiny, controlled synthetic fixtures only, not GB-scale ingestion.
 */
export function parseCsvContent(content: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let sawAnyChar = false;

  const normalized = content.replace(/\r\n?/g, '\n');
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      sawAnyChar = true;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      sawAnyChar = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
      sawAnyChar = true;
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      sawAnyChar = false;
    } else {
      field += c;
      sawAnyChar = true;
    }
  }
  if (sawAnyChar || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty trailing rows.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase();
}

function hasToken(value: string, tokens: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

// ─── Layout validation ─────────────────────────────────────────────────────────

interface ValidatedTable {
  /** Normalized header → column index (first occurrence wins). */
  readonly index: ReadonlyMap<string, number>;
  readonly dataRows: readonly string[][];
}

/**
 * Fail-closed header validation shared by the table reader and the public
 * header-only API. Normalizes the header cells and applies, in order:
 *   1) forbidden personal-data tokens anywhere → hard failure;
 *   2) required headers present;
 *   3) unknown-header handling (sensitive token → forbidden; else strict-only).
 */
function validateHeaderCells(
  file: string,
  headerCells: readonly string[],
  config: FileHeaderConfig,
  strict: boolean,
): string[] {
  const headers = headerCells.map(normalizeHeader);

  // 1) Forbidden personal-data tokens anywhere → hard failure.
  for (const header of headers) {
    if (hasToken(header, BR_RECEITA_CNPJ_FORBIDDEN_TOKENS)) {
      throw new BrReceitaCnpjForbiddenColumnError(file, header);
    }
  }

  // 2) Required headers present.
  for (const req of config.required) {
    if (!headers.includes(req)) {
      throw new BrReceitaCnpjMissingHeaderError(file, req);
    }
  }

  // 3) Unknown-header handling.
  for (const header of headers) {
    if (config.known.has(header)) continue;
    if (hasToken(header, BR_RECEITA_CNPJ_SENSITIVE_STRIPPED_TOKENS)) {
      // Sensitive token on a column that is NOT part of this file's layout.
      throw new BrReceitaCnpjForbiddenColumnError(file, header);
    }
    if (strict) {
      throw new BrReceitaCnpjUnknownColumnError(file, header);
    }
    // Non-strict: silently ignore unknown, non-sensitive columns.
  }

  return headers;
}

/**
 * Validates ONLY a header row (the first CSV line) for a given Receita CNPJ
 * layout file type, without touching data rows. Fail-closed and behaviorally
 * identical to the reader's table validation. Exposed so the BR-SOURCE-6 manifest
 * validator can layout-check a real file's header with a minimal, controlled read
 * instead of duplicating the sanitization rules.
 *
 * @throws {BrReceitaCnpjMissingHeaderError} when a required header is absent.
 * @throws {BrReceitaCnpjForbiddenColumnError} on a forbidden/sensitive column.
 * @throws {BrReceitaCnpjUnknownColumnError} on an unknown column under `strict`.
 * @throws {BrReceitaCnpjFileReaderError} for an unrecognized layout file type.
 */
export function validateBrReceitaCnpjHeaderCells(
  fileType: BrReceitaCnpjLayoutFileType,
  headerCells: readonly string[],
  options: { strict?: boolean; fileLabel?: string } = {},
): void {
  const config = FILE_HEADER_CONFIGS[fileType];
  if (config === undefined) {
    throw new BrReceitaCnpjFileReaderError(`unrecognized layout file type "${fileType}"`);
  }
  validateHeaderCells(options.fileLabel ?? fileType, headerCells, config, options.strict ?? false);
}

/**
 * Counts the columns in a single delimited line, respecting double-quoted fields
 * (with `""` escapes) so an embedded delimiter inside a quoted value is NOT
 * counted as a separator. The official Receita files quote every field and use
 * `;`, so a naive `split(delimiter)` would over-count any value that contains the
 * delimiter — this counter does not. Returns 0 for an empty line.
 */
export function countBrReceitaCnpjDelimitedColumns(line: string, delimiter: string): number {
  if (delimiter.length !== 1) {
    throw new BrReceitaCnpjFileReaderError(`delimiter must be a single character, got "${delimiter}"`);
  }
  const trimmed = line.replace(/\r$/, '');
  if (trimmed.length === 0) return 0;

  let columns = 1;
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (c === '"') {
      if (inQuotes && trimmed[i + 1] === '"') {
        i += 1; // skip an escaped quote
        continue;
      }
      inQuotes = !inQuotes;
    } else if (c === delimiter && !inQuotes) {
      columns += 1;
    }
  }
  return columns;
}

export interface BrReceitaCnpjHeaderlessLineValidation {
  readonly columnCount: number;
  readonly expectedColumnCount: number;
}

/**
 * Validates the FIRST (data) line of a headerless official Receita CNPJ file by
 * its positional column count — the real files ship with NO header row, so the
 * first line must NOT be treated as headers. Fail-closed and never surfaces the
 * line's content: it only counts columns (quote-aware) and compares against the
 * official layout for the file type. Exposed so the manifest validator can
 * layout-check a real headerless file with a minimal, controlled read.
 *
 * @throws {BrReceitaCnpjEmptyFileError} when the file/line is empty (0 columns).
 * @throws {BrReceitaCnpjHeaderlessColumnCountError} on a column-count mismatch.
 * @throws {BrReceitaCnpjFileReaderError} for an unrecognized layout file type.
 */
export function validateBrReceitaCnpjHeaderlessFirstLine(
  fileType: BrReceitaCnpjLayoutFileType,
  rawFirstLine: string,
  delimiter: string,
  options: { fileLabel?: string } = {},
): BrReceitaCnpjHeaderlessLineValidation {
  const label = options.fileLabel ?? fileType;
  const expectedColumnCount = getBrReceitaCnpjOfficialColumnCount(fileType);
  const columnCount = countBrReceitaCnpjDelimitedColumns(rawFirstLine, delimiter);
  if (columnCount === 0) {
    throw new BrReceitaCnpjEmptyFileError(label);
  }
  if (columnCount !== expectedColumnCount) {
    throw new BrReceitaCnpjHeaderlessColumnCountError(label, expectedColumnCount, columnCount);
  }
  return { columnCount, expectedColumnCount };
}

/**
 * Validates a parsed CSV table against a file config and returns a header index
 * plus data rows. Fail-closed on missing required headers, forbidden personal
 * columns, unknown sensitive columns, and (under `strict`) unknown columns.
 */
function validateTable(
  file: string,
  parsed: string[][],
  config: FileHeaderConfig,
  strict: boolean,
): ValidatedTable {
  const headers = validateHeaderCells(file, parsed[0] ?? [], config, strict);

  const index = new Map<string, number>();
  headers.forEach((header, i) => {
    if (!index.has(header)) index.set(header, i);
  });

  return { index, dataRows: parsed.slice(1) };
}

function cell(row: readonly string[], index: ReadonlyMap<string, number>, name: string): string | undefined {
  const i = index.get(name);
  if (i === undefined) return undefined;
  return row[i];
}

// ─── Row mappers (only allow-listed columns; sensitive columns never copied) ──

function mapEmpresas(table: ValidatedTable): BrReceitaEmpresaRow[] {
  return table.dataRows.map((row) => ({
    cnpj_basico: cell(row, table.index, 'cnpj_basico') ?? '',
    razao_social: cell(row, table.index, 'razao_social') ?? null,
    natureza_juridica: cell(row, table.index, 'natureza_juridica') ?? null,
    porte_empresa: cell(row, table.index, 'porte_empresa') ?? null,
    capital_social: cell(row, table.index, 'capital_social') ?? null,
  }));
}

function mapEstabelecimentos(table: ValidatedTable): BrReceitaEstabelecimentoRow[] {
  // Only identity + coarse, non-sensitive fields are copied. Contact and
  // fine-address columns are deliberately NOT read into the row object.
  return table.dataRows.map((row) => ({
    cnpj_basico: cell(row, table.index, 'cnpj_basico') ?? '',
    cnpj_ordem: cell(row, table.index, 'cnpj_ordem') ?? '',
    cnpj_dv: cell(row, table.index, 'cnpj_dv') ?? '',
    identificador_matriz_filial: cell(row, table.index, 'identificador_matriz_filial') ?? null,
    situacao_cadastral: cell(row, table.index, 'situacao_cadastral') ?? null,
    cnae_fiscal_principal: cell(row, table.index, 'cnae_fiscal_principal') ?? null,
    cnae_fiscal_secundaria: cell(row, table.index, 'cnae_fiscal_secundaria') ?? null,
    data_inicio_atividade: cell(row, table.index, 'data_inicio_atividade') ?? null,
    municipio: cell(row, table.index, 'municipio') ?? null,
    uf: cell(row, table.index, 'uf') ?? null,
  }));
}

function mapSimples(table: ValidatedTable): BrReceitaSimplesRow[] {
  return table.dataRows.map((row) => ({
    cnpj_basico: cell(row, table.index, 'cnpj_basico') ?? '',
    opcao_simples: cell(row, table.index, 'opcao_simples') ?? null,
    opcao_mei: cell(row, table.index, 'opcao_mei') ?? null,
  }));
}

function mapLookup(table: ValidatedTable): BrReceitaLookupRow[] {
  return table.dataRows.map((row) => ({
    codigo: cell(row, table.index, 'codigo') ?? '',
    descricao: cell(row, table.index, 'descricao') ?? '',
  }));
}

// ─── Row limit ─────────────────────────────────────────────────────────────────

function resolveMaxRows(maxRows: number | undefined): number {
  const value = maxRows ?? BR_RECEITA_CNPJ_FILE_READER_MAX_ROWS;
  if (!Number.isInteger(value) || value < 1) {
    throw new BrReceitaCnpjRowLimitError(`maxRows must be a positive integer, got "${value}"`);
  }
  if (value > BR_RECEITA_CNPJ_FILE_READER_MAX_ROWS) {
    throw new BrReceitaCnpjRowLimitError(
      `maxRows (${value}) exceeds the hard limit of ${BR_RECEITA_CNPJ_FILE_READER_MAX_ROWS}`,
    );
  }
  return value;
}

// ─── Pure contents → parser input (testable without disk) ─────────────────────

export interface BrReceitaCnpjCsvFixtureContents {
  sourceYear: number;
  sourcePeriod?: string;
  empresasCsv: string;
  estabelecimentosCsv: string;
  simplesCsv?: string;
  cnaesCsv?: string;
  municipiosCsv?: string;
  naturezasCsv?: string;
  maxRows?: number;
  strict?: boolean;
  sourceFileName?: string;
}

/**
 * Pure transform: parses synthetic CSV strings into a sanitized
 * `BrReceitaCnpjParserInput`. No disk, no network, no env. Fail-closed on any
 * layout violation. NEVER retains a raw CSV row.
 */
export function parseBrReceitaCnpjCsvFixtureContents(
  input: BrReceitaCnpjCsvFixtureContents,
): BrReceitaCnpjParserInput {
  const strict = input.strict ?? false;
  const maxRows = resolveMaxRows(input.maxRows);

  const F = BR_RECEITA_CNPJ_FIXTURE_FILES;
  const empresasTable = validateTable(F.empresas, parseCsvContent(input.empresasCsv), EMPRESAS_CONFIG, strict);
  const estabTable = validateTable(
    F.estabelecimentos,
    parseCsvContent(input.estabelecimentosCsv),
    ESTABELECIMENTOS_CONFIG,
    strict,
  );

  const estabelecimentosRows = mapEstabelecimentos(estabTable);
  if (estabelecimentosRows.length > maxRows) {
    throw new BrReceitaCnpjRowLimitError(
      `estabelecimentos has ${estabelecimentosRows.length} rows, exceeds maxRows (${maxRows})`,
    );
  }

  const empresasRows = mapEmpresas(empresasTable);

  const result: BrReceitaCnpjParserInput = {
    sourceYear: input.sourceYear,
    empresasRows,
    estabelecimentosRows,
  };
  if (input.sourcePeriod !== undefined) result.sourcePeriod = input.sourcePeriod;
  if (input.sourceFileName !== undefined) result.sourceFileName = input.sourceFileName;

  if (input.simplesCsv !== undefined) {
    result.simplesRows = mapSimples(
      validateTable(F.simples, parseCsvContent(input.simplesCsv), SIMPLES_CONFIG, strict),
    );
  }
  if (input.cnaesCsv !== undefined) {
    result.cnaesRows = mapLookup(
      validateTable(F.cnaes, parseCsvContent(input.cnaesCsv), CNAES_CONFIG, strict),
    );
  }
  if (input.municipiosCsv !== undefined) {
    result.municipiosRows = mapLookup(
      validateTable(F.municipios, parseCsvContent(input.municipiosCsv), MUNICIPIOS_CONFIG, strict),
    );
  }
  if (input.naturezasCsv !== undefined) {
    result.naturezasRows = mapLookup(
      validateTable(F.naturezas, parseCsvContent(input.naturezasCsv), NATUREZAS_CONFIG, strict),
    );
  }

  return result;
}

// ─── Fixed-directory reader (the only entry point that reads from files) ──────

export interface BrReceitaCnpjFileReaderOptions {
  /** Only `"synthetic-csv"` is accepted (kept for an explicit, self-documenting call site). */
  fixture?: BrReceitaCnpjSyntheticFileFixture;
  maxRows?: number;
  strict?: boolean;
}

/**
 * Guards the fixture directory: it must exist and must NOT contain any forbidden
 * personal-data file (SOCIOS/QSA/CPF). No file outside this fixed directory is
 * ever read.
 */
function assertSafeFixtureDirectory(dir: string): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new BrReceitaCnpjFileReaderError(`fixture directory not found: ${dir}`);
  }
  for (const entry of fs.readdirSync(dir)) {
    if (hasToken(entry, BR_RECEITA_CNPJ_FORBIDDEN_TOKENS)) {
      throw new BrReceitaCnpjForbiddenFileError(entry);
    }
  }
}

function readFixtureFile(dir: string, name: string, required: boolean): string | undefined {
  const filePath = path.join(dir, name);
  if (!fs.existsSync(filePath)) {
    if (required) {
      throw new BrReceitaCnpjFileReaderError(`required fixture file missing: ${name}`);
    }
    return undefined;
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Reads the FIXED internal synthetic-CSV fixture directory and returns a
 * sanitized `BrReceitaCnpjParserInput`. Synchronous and deterministic; there is
 * NO path parameter — the directory is resolved from this module's location.
 *
 * @throws {BrReceitaCnpjFileReaderError} on any layout/limit/forbidden violation.
 */
export function readBrReceitaCnpjSyntheticCsvFixture(
  options: BrReceitaCnpjFileReaderOptions = {},
): BrReceitaCnpjParserInput {
  if (options.fixture !== undefined && options.fixture !== BR_RECEITA_CNPJ_SYNTHETIC_CSV_FIXTURE) {
    throw new BrReceitaCnpjFileReaderError(
      `only fixture "${BR_RECEITA_CNPJ_SYNTHETIC_CSV_FIXTURE}" is supported; got "${options.fixture}"`,
    );
  }

  const dir = BR_RECEITA_CNPJ_SYNTHETIC_CSV_FIXTURE_DIR;
  assertSafeFixtureDirectory(dir);

  const F = BR_RECEITA_CNPJ_FIXTURE_FILES;
  const contents: BrReceitaCnpjCsvFixtureContents = {
    sourceYear: BR_RECEITA_CNPJ_SYNTHETIC_CSV_SOURCE_YEAR,
    sourcePeriod: BR_RECEITA_CNPJ_SYNTHETIC_CSV_PERIOD,
    empresasCsv: readFixtureFile(dir, F.empresas, true)!,
    estabelecimentosCsv: readFixtureFile(dir, F.estabelecimentos, true)!,
    simplesCsv: readFixtureFile(dir, F.simples, false),
    cnaesCsv: readFixtureFile(dir, F.cnaes, false),
    municipiosCsv: readFixtureFile(dir, F.municipios, false),
    naturezasCsv: readFixtureFile(dir, F.naturezas, false),
    maxRows: options.maxRows,
    strict: options.strict ?? false,
    sourceFileName: F.estabelecimentos,
  };

  return parseBrReceitaCnpjCsvFixtureContents(contents);
}
