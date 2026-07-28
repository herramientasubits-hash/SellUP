/**
 * BR Receita CNPJ headerless official-file support — tests (BR-SOURCE-10C).
 *
 * The real Receita CNPJ open-data files ship WITHOUT a header row and must be
 * validated by positional column COUNT, not by header names. These tests prove:
 *   - the quote-aware column counter respects the official `;`-quoted layout;
 *   - `validateBrReceitaCnpjHeaderlessFirstLine` fails closed on empty files and
 *     column-count mismatches, and accepts a correct official layout;
 *   - the manifest validator accepts `official_headerless` files, still rejects a
 *     headerless file when no explicit `layoutMode` is set, and rejects unsupported
 *     extensions, forbidden file names, invalid layout modes, and wrong counts;
 *   - a manifest-level `layoutMode` applies as a default to every file;
 *   - the bounded local dry-run runs over an `official_headerless` manifest with
 *     `maxSampleRows = 5` and stays sanitized (no rows, no full CNPJ/CPF, no
 *     contact/address, all safety flags false, no full-dataset processing).
 *
 * 100% synthetic. No real dataset, no Supabase, no network, no runtime. Column
 * COUNTS mirror the official layout; cell VALUES are meaningless placeholders.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  countBrReceitaCnpjDelimitedColumns,
  getBrReceitaCnpjOfficialColumnCount,
  validateBrReceitaCnpjHeaderlessFirstLine,
  BrReceitaCnpjEmptyFileError,
  BrReceitaCnpjHeaderlessColumnCountError,
  BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS,
} from '../br-receita-cnpj-file-reader';
import { validateBrReceitaCnpjLocalManifest } from '../br-receita-cnpj-manifest-validator';
import { runBrReceitaCnpjLocalDryRun } from '../br-receita-cnpj-local-dry-run';
import type { BrReceitaCnpjManifest } from '../br-receita-cnpj-manifest';

// ─── Synthetic headerless content (`;`-quoted; column COUNT = official layout) ──

/** One synthetic headerless row: `cols` quoted placeholder fields joined by `;`. */
function headerlessRow(cols: number, seed: string): string {
  return Array.from({ length: cols }, (_, i) => `"${seed}f${i}"`).join(';');
}

/** A synthetic headerless file: `rows` rows, each with `cols` columns, no header. */
function headerlessFile(cols: number, rows: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) lines.push(headerlessRow(cols, `r${r}`));
  return `${lines.join('\n')}\n`;
}

const COUNTS = BR_RECEITA_CNPJ_OFFICIAL_HEADERLESS_COLUMN_COUNTS;

// Enough rows that the default sample of 5 is exercised without a full scan.
const HEADERLESS_CSVS: Record<string, string> = {
  'empresas.csv': headerlessFile(COUNTS.empresas, 8),
  'estabelecimentos.csv': headerlessFile(COUNTS.estabelecimentos, 8),
  'cnaes.csv': headerlessFile(COUNTS.cnaes, 4),
  'municipios.csv': headerlessFile(COUNTS.municipios, 4),
  'naturezas.csv': headerlessFile(COUNTS.naturezas, 4),
};

const createdDirs: string[] = [];

after(() => {
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function headerlessManifest(overrides: Partial<BrReceitaCnpjManifest> = {}): BrReceitaCnpjManifest {
  return {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    files: [
      { fileType: 'empresas', path: 'empresas.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' },
      { fileType: 'estabelecimentos', path: 'estabelecimentos.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' },
      { fileType: 'cnaes', path: 'cnaes.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' },
      { fileType: 'municipios', path: 'municipios.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' },
      { fileType: 'naturezas', path: 'naturezas.csv', encoding: 'latin1', delimiter: ';', layoutMode: 'official_headerless' },
    ],
    ...overrides,
  };
}

/** Materializes a temp dir with the synthetic headerless CSVs + a manifest. */
function makeHeaderlessFixture(
  mutate: (m: BrReceitaCnpjManifest) => void = () => {},
  extraFiles: Record<string, string> = {},
): { dir: string; manifestPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brs10c-'));
  createdDirs.push(dir);
  for (const [name, content] of Object.entries(HEADERLESS_CSVS)) {
    fs.writeFileSync(path.join(dir, name), content, 'latin1');
  }
  for (const [name, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(dir, name), content, 'latin1');
  }
  const manifest = headerlessManifest();
  mutate(manifest);
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir, manifestPath };
}

// ─── File-reader units: column counting + headerless first-line validation ─────

describe('countBrReceitaCnpjDelimitedColumns', () => {
  it('counts quoted `;`-delimited columns (the official layout)', () => {
    assert.equal(countBrReceitaCnpjDelimitedColumns('"a";"b";"c"', ';'), 3);
  });

  it('does not count a delimiter inside a quoted field', () => {
    // A description like "Cultivo de arroz; feijao" is ONE field, not two.
    assert.equal(countBrReceitaCnpjDelimitedColumns('"0111301";"arroz; feijao"', ';'), 2);
  });

  it('handles escaped quotes within a field', () => {
    assert.equal(countBrReceitaCnpjDelimitedColumns('"a ""x"" b";"c"', ';'), 2);
  });

  it('returns 0 for an empty line', () => {
    assert.equal(countBrReceitaCnpjDelimitedColumns('', ';'), 0);
    assert.equal(countBrReceitaCnpjDelimitedColumns('\r', ';'), 0);
  });
});

describe('validateBrReceitaCnpjHeaderlessFirstLine', () => {
  it('accepts a first data line with the official column count', () => {
    const line = headerlessRow(COUNTS.empresas, 'x');
    assert.doesNotThrow(() => validateBrReceitaCnpjHeaderlessFirstLine('empresas', line, ';'));
  });

  it('fails closed on an empty file', () => {
    assert.throws(
      () => validateBrReceitaCnpjHeaderlessFirstLine('cnaes', '', ';'),
      BrReceitaCnpjEmptyFileError,
    );
  });

  it('fails closed on a column-count mismatch', () => {
    const tooFew = headerlessRow(COUNTS.estabelecimentos - 1, 'x');
    assert.throws(
      () => validateBrReceitaCnpjHeaderlessFirstLine('estabelecimentos', tooFew, ';'),
      BrReceitaCnpjHeaderlessColumnCountError,
    );
  });

  it('exposes the official counts (empresas 7, estabelecimentos 30, lookups 2)', () => {
    assert.equal(getBrReceitaCnpjOfficialColumnCount('empresas'), 7);
    assert.equal(getBrReceitaCnpjOfficialColumnCount('estabelecimentos'), 30);
    assert.equal(getBrReceitaCnpjOfficialColumnCount('cnaes'), 2);
    assert.equal(getBrReceitaCnpjOfficialColumnCount('municipios'), 2);
    assert.equal(getBrReceitaCnpjOfficialColumnCount('naturezas'), 2);
  });
});

// ─── Manifest validator: official_headerless acceptance & rejections ───────────

describe('validateBrReceitaCnpjLocalManifest — official_headerless', () => {
  it('accepts headerless files validated by positional column count', async () => {
    const { manifestPath } = makeHeaderlessFixture();
    const result = await validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true });
    assert.equal(result.ok, true);
    assert.equal(result.filesRejected, 0);
    for (const report of result.fileReports) {
      assert.equal(report.status, 'accepted');
      assert.equal(report.layoutValidation, 'passed_headerless');
      assert.equal(report.layoutMode, 'official_headerless');
      assert.match(report.sha256Hash12 ?? '', /^[0-9a-f]{12}$/);
    }
  });

  it('applies a manifest-level layoutMode as the per-file default', async () => {
    const { manifestPath } = makeHeaderlessFixture((m) => {
      m.layoutMode = 'official_headerless';
      for (const f of m.files) delete f.layoutMode; // rely on the manifest-level default
    });
    const result = await validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true });
    assert.equal(result.ok, true);
    for (const report of result.fileReports) {
      assert.equal(report.layoutValidation, 'passed_headerless');
      assert.equal(report.layoutMode, 'official_headerless');
    }
  });

  it('STILL rejects a headerless file when no explicit layoutMode is set (defaults to header)', async () => {
    const { manifestPath } = makeHeaderlessFixture((m) => {
      for (const f of m.files) delete f.layoutMode; // no manifest- or file-level mode
    });
    const result = await validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true });
    assert.equal(result.ok, false);
    const empresas = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.equal(empresas?.status, 'rejected');
    assert.equal(empresas?.layoutValidation, 'failed');
    assert.equal(empresas?.reasonCode, 'header_validation_failed');
    assert.equal(empresas?.layoutMode, 'header');
  });

  it('rejects a wrong headerless column count', async () => {
    const { dir, manifestPath } = makeHeaderlessFixture();
    // Overwrite empresas with the WRONG column count (one column short).
    fs.writeFileSync(
      path.join(dir, 'empresas.csv'),
      headerlessFile(COUNTS.empresas - 1, 3),
      'latin1',
    );
    const result = await validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true });
    const empresas = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.equal(empresas?.status, 'rejected');
    assert.equal(empresas?.reasonCode, 'headerless_column_count_mismatch');
  });

  it('rejects an empty headerless file', async () => {
    const { dir, manifestPath } = makeHeaderlessFixture();
    fs.writeFileSync(path.join(dir, 'naturezas.csv'), '', 'latin1');
    const result = await validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true });
    const naturezas = result.fileReports.find((r) => r.fileType === 'naturezas');
    assert.equal(naturezas?.status, 'rejected');
    assert.equal(naturezas?.reasonCode, 'headerless_empty_file');
  });

  it('rejects an unsupported extension even in headerless mode', async () => {
    const { manifestPath } = makeHeaderlessFixture(
      (m) => {
        const cnaes = m.files.find((f) => f.fileType === 'cnaes')!;
        cnaes.path = 'cnaes.dat';
      },
      { 'cnaes.dat': headerlessFile(COUNTS.cnaes, 2) },
    );
    const result = await validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true });
    const cnaes = result.fileReports.find((r) => r.safeFileLabel === 'cnaes.dat');
    assert.equal(cnaes?.reasonCode, 'unsupported_extension');
  });

  it('rejects a forbidden file name (cpf token) even in headerless mode', async () => {
    const { manifestPath } = makeHeaderlessFixture((m) => {
      m.files.push({
        fileType: 'cnaes',
        path: 'cpf_dump.csv',
        layoutMode: 'official_headerless',
      });
    });
    const result = await validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true });
    assert.equal(result.reasonCode, 'forbidden_file_name');
  });

  it('rejects an invalid layoutMode value (fail-closed, never coerced)', async () => {
    const { manifestPath } = makeHeaderlessFixture((m) => {
      (m.files[0] as { layoutMode: string }).layoutMode = 'no_such_mode';
    });
    const result = await validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true });
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'layout_mode_invalid');
  });
});

// ─── Dry-run over an official_headerless manifest (bounded + sanitized) ─────────

describe('runBrReceitaCnpjLocalDryRun — official_headerless', () => {
  it('runs bounded (maxSampleRows 5) and stays ok without a full scan', async () => {
    const { manifestPath } = makeHeaderlessFixture();
    const result = await runBrReceitaCnpjLocalDryRun({
      manifestPath,
      allowLocalManifest: true,
      dryRunOnly: true,
      maxSampleRowsPerFile: 5,
    });
    assert.equal(result.ok, true);
    assert.equal(result.manifestValidation, 'passed');
    assert.equal(result.fullDatasetProcessed, false);
    assert.equal(result.importExecuted, false);
    assert.equal(result.supabaseWrite, false);
    assert.equal(result.sampleRowsRejectedForStructure, 0);
    assert.ok(result.sampleRowsRead > 0);
    // Never more than filesAccepted * maxSampleRows — no full-dataset scan.
    assert.ok(result.sampleRowsRead <= result.filesAccepted * 5);
  });

  it('produces a fully sanitized result (no rows, no CNPJ/CPF, no contact/address)', async () => {
    const { manifestPath } = makeHeaderlessFixture();
    const result = await runBrReceitaCnpjLocalDryRun({
      manifestPath,
      allowLocalManifest: true,
      dryRunOnly: true,
      maxSampleRowsPerFile: 5,
    });
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /\b\d{11}\b/); // no CPF-like literal
    assert.doesNotMatch(json, /\b\d{14}\b/); // no full-CNPJ literal
    assert.doesNotMatch(json, /\b[A-Z0-9]{14}\b/);
    assert.doesNotMatch(json.toLowerCase(), /"(cpf|socios|qsa|telefone|logradouro|bairro|cep|raw_row)"/);
    for (const value of Object.values(result.safety)) {
      assert.equal(value, false);
    }
  });
});
