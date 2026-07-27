/**
 * BR Receita CNPJ local manifest validator — tests (BR-SOURCE-6).
 *
 * Verifies the validator is a safe, sanitized, local-only manifest checker:
 *   - accepts a well-formed synthetic manifest (ok, all files accepted);
 *   - enforces source identity, period, and the required file set;
 *   - rejects forbidden file types/names, duplicates, URLs, ZIPs, bad extensions;
 *   - detects size/hash mismatches and header/layout violations;
 *   - blocks path traversal;
 *   - NEVER returns row content or a full CNPJ; safety flags are all false.
 *
 * All fixtures are synthetic and created in a temp directory. No real dataset,
 * no Supabase, no network, no runtime.
 */

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  validateBrReceitaCnpjLocalManifest,
  BR_RECEITA_CNPJ_MANIFEST_DEFAULT_MAX_HEADER_BYTES,
} from '../br-receita-cnpj-manifest-validator';
import type { BrReceitaCnpjManifest } from '../br-receita-cnpj-manifest';

// ─── Synthetic CSV headers (valid layouts per the file-reader configs) ────────

const CSV_HEADERS: Record<string, string> = {
  'empresas.csv': 'cnpj_basico,razao_social,natureza_juridica,capital_social,porte_empresa',
  'estabelecimentos.csv':
    'cnpj_basico,cnpj_ordem,cnpj_dv,identificador_matriz_filial,situacao_cadastral,uf,municipio',
  'simples.csv': 'cnpj_basico,opcao_simples,opcao_mei',
  'cnaes.csv': 'codigo,descricao',
  'municipios.csv': 'codigo,descricao,uf',
  'naturezas.csv': 'codigo,descricao',
};

// A single harmless data row per file. Deliberately free of long digit runs so
// no CNPJ/CPF-like literal ever exists, even in the source files.
const CSV_DATA_ROW: Record<string, string> = {
  'empresas.csv': 'AB,Synthetic Ltda,2062,100.00,03',
  'estabelecimentos.csv': 'AB,0001,00,1,02,SP,Sao Paulo',
  'simples.csv': 'AB,S,N',
  'cnaes.csv': 'X,Atividade Sintetica',
  'municipios.csv': 'X,Cidade Sintetica,SP',
  'naturezas.csv': 'X,Natureza Sintetica',
};

const createdDirs: string[] = [];

after(() => {
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
});

function baseManifest(): BrReceitaCnpjManifest {
  return {
    sourceKey: 'br_receita_cnpj_dados_abertos',
    countryCode: 'BR',
    sourceYear: 2026,
    sourcePeriod: '2026-07',
    mode: 'local_manifest_validation',
    files: [
      { fileType: 'empresas', path: 'empresas.csv', encoding: 'utf8', delimiter: ',' },
      { fileType: 'estabelecimentos', path: 'estabelecimentos.csv', encoding: 'utf8', delimiter: ',' },
      { fileType: 'simples', path: 'simples.csv', encoding: 'utf8', delimiter: ',' },
      { fileType: 'cnaes', path: 'cnaes.csv', encoding: 'utf8', delimiter: ',' },
      { fileType: 'municipios', path: 'municipios.csv', encoding: 'utf8', delimiter: ',' },
      { fileType: 'naturezas', path: 'naturezas.csv', encoding: 'utf8', delimiter: ',' },
    ],
  };
}

/**
 * Materializes a temp directory with the six synthetic CSVs and a manifest.json,
 * applying `mutate` to the manifest before writing. Extra files can be created
 * via `extraFiles`.
 */
function makeFixture(
  mutate: (m: BrReceitaCnpjManifest) => void = () => {},
  extraFiles: Record<string, string> = {},
): { dir: string; manifestPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brs6-'));
  createdDirs.push(dir);
  for (const [name, header] of Object.entries(CSV_HEADERS)) {
    fs.writeFileSync(path.join(dir, name), `${header}\n${CSV_DATA_ROW[name]}\n`);
  }
  for (const [name, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  const manifest = baseManifest();
  mutate(manifest);
  const manifestPath = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir, manifestPath };
}

function validate(mutate?: (m: BrReceitaCnpjManifest) => void, extraFiles?: Record<string, string>) {
  const { manifestPath } = makeFixture(mutate, extraFiles);
  return validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: true, strict: true });
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('validateBrReceitaCnpjLocalManifest — synthetic manifest', () => {
  it('accepts a well-formed synthetic manifest', async () => {
    const result = await validate();
    assert.equal(result.ok, true);
    assert.equal(result.reasonCode, undefined);
    assert.equal(result.filesSeen, 6);
    assert.equal(result.filesAccepted, 6);
    assert.equal(result.filesRejected, 0);
    assert.equal(result.sourceKey, 'br_receita_cnpj_dados_abertos');
    assert.equal(result.countryCode, 'BR');
    assert.equal(result.sourceYear, 2026);
    assert.equal(result.sourcePeriod, '2026-07');
    for (const report of result.fileReports) {
      assert.equal(report.status, 'accepted');
      assert.equal(report.layoutValidation, 'passed');
      assert.match(report.sha256Hash12 ?? '', /^[0-9a-f]{12}$/);
      assert.ok((report.sizeBytes ?? 0) > 0);
    }
  });

  it('carries an all-false safety block', async () => {
    const result = await validate();
    for (const value of Object.values(result.safety)) {
      assert.equal(value, false);
    }
  });

  it('exposes only sanitized basenames — never a full path', async () => {
    const result = await validate();
    for (const report of result.fileReports) {
      assert.match(report.safeFileLabel, /^[\w.-]+$/);
      assert.ok(!report.safeFileLabel.includes('/'));
      assert.ok(!report.safeFileLabel.includes(path.sep));
    }
  });

  it('returns no row content and no full CNPJ', async () => {
    const result = await validate();
    const json = JSON.stringify(result);
    assert.doesNotMatch(json, /\b\d{14}\b/);
    assert.doesNotMatch(json, /\b[A-Z0-9]{14}\b/);
    // No row-content keys should ever appear.
    assert.doesNotMatch(json.toLowerCase(), /"(cpf|socios|qsa|telefone|logradouro|raw_row)"/);
  });
});

// ─── Manifest identity / structure ────────────────────────────────────────────

describe('validateBrReceitaCnpjLocalManifest — manifest identity', () => {
  it('requires the correct source_key', async () => {
    const result = await validate((m) => {
      (m as { sourceKey: string }).sourceKey = 'something_else';
    });
    assert.equal(result.ok, false);
    assert.equal(result.reasonCode, 'manifest_source_key_invalid');
  });

  it('requires countryCode BR', async () => {
    const result = await validate((m) => {
      (m as { countryCode: string }).countryCode = 'CO';
    });
    assert.equal(result.reasonCode, 'manifest_country_invalid');
  });

  it('requires mode local_manifest_validation', async () => {
    const result = await validate((m) => {
      (m as { mode: string }).mode = 'import';
    });
    assert.equal(result.reasonCode, 'manifest_mode_invalid');
  });

  it('requires a valid sourceYear', async () => {
    const result = await validate((m) => {
      (m as { sourceYear: number }).sourceYear = 1800;
    });
    assert.equal(result.reasonCode, 'source_year_invalid');
  });

  it('requires sourcePeriod in YYYY-MM', async () => {
    const result = await validate((m) => {
      (m as { sourcePeriod: string }).sourcePeriod = '2026/07';
    });
    assert.equal(result.reasonCode, 'source_period_invalid');
  });

  it('rejects an out-of-range month in sourcePeriod', async () => {
    const result = await validate((m) => {
      (m as { sourcePeriod: string }).sourcePeriod = '2026-13';
    });
    assert.equal(result.reasonCode, 'source_period_invalid');
  });
});

// ─── Required / forbidden / duplicate file types ──────────────────────────────

describe('validateBrReceitaCnpjLocalManifest — file set', () => {
  it('requires empresas + estabelecimentos', async () => {
    const result = await validate((m) => {
      m.files = m.files.filter((f) => f.fileType !== 'estabelecimentos');
    });
    assert.equal(result.reasonCode, 'required_file_missing');
  });

  it('rejects a forbidden fileType (socios)', async () => {
    const result = await validate((m) => {
      m.files.push({ fileType: 'socios' as never, path: 'extra.csv' });
    });
    assert.equal(result.reasonCode, 'forbidden_file_type');
  });

  it('rejects a forbidden fileType (cpf)', async () => {
    const result = await validate((m) => {
      m.files.push({ fileType: 'cpf' as never, path: 'extra.csv' });
    });
    assert.equal(result.reasonCode, 'forbidden_file_type');
  });

  it('rejects a forbidden file NAME (cpf token) even with an allowed fileType', async () => {
    const result = await validate((m) => {
      m.files.push({ fileType: 'cnaes' as never, path: 'cpf_dump.csv' });
    });
    assert.equal(result.reasonCode, 'forbidden_file_name');
  });

  it('rejects a duplicate fileType', async () => {
    const result = await validate((m) => {
      m.files.push({ fileType: 'empresas', path: 'empresas.csv' });
    });
    assert.equal(result.reasonCode, 'duplicate_file_type');
  });
});

// ─── Path / extension / URL ───────────────────────────────────────────────────

describe('validateBrReceitaCnpjLocalManifest — path & extension safety', () => {
  it('rejects a URL manifest path', async () => {
    const result = await validateBrReceitaCnpjLocalManifest({
      manifestPath: 'https://example.com/manifest.json',
      allowRealLocalFiles: true,
    });
    assert.equal(result.reasonCode, 'manifest_url_not_allowed');
  });

  it('rejects a non-json manifest path', async () => {
    const result = await validateBrReceitaCnpjLocalManifest({
      manifestPath: '/tmp/manifest.csv',
      allowRealLocalFiles: true,
    });
    assert.equal(result.reasonCode, 'manifest_not_json');
  });

  it('blocks path traversal in a file entry', async () => {
    const result = await validate((m) => {
      const estab = m.files.find((f) => f.fileType === 'estabelecimentos')!;
      estab.path = '../escape.csv';
    });
    assert.equal(result.ok, false);
    const rejected = result.fileReports.find((r) => r.status === 'rejected');
    assert.equal(rejected?.reasonCode, 'path_traversal_blocked');
  });

  it('blocks an absolute file path', async () => {
    const result = await validate((m) => {
      const estab = m.files.find((f) => f.fileType === 'estabelecimentos')!;
      estab.path = '/etc/passwd.csv';
    });
    const rejected = result.fileReports.find((r) => r.status === 'rejected');
    assert.equal(rejected?.reasonCode, 'path_traversal_blocked');
  });

  it('rejects a ZIP file entry', async () => {
    const result = await validate(
      (m) => {
        const estab = m.files.find((f) => f.fileType === 'estabelecimentos')!;
        estab.path = 'estabelecimentos.zip';
      },
      { 'estabelecimentos.zip': 'not-a-real-zip' },
    );
    const rejected = result.fileReports.find((r) => r.status === 'rejected');
    assert.equal(rejected?.reasonCode, 'zip_not_allowed');
  });

  it('rejects an unsupported extension', async () => {
    const result = await validate(
      (m) => {
        const estab = m.files.find((f) => f.fileType === 'estabelecimentos')!;
        estab.path = 'estabelecimentos.dat';
      },
      { 'estabelecimentos.dat': 'x' },
    );
    const rejected = result.fileReports.find((r) => r.status === 'rejected');
    assert.equal(rejected?.reasonCode, 'unsupported_extension');
  });
});

// ─── Integrity: size / hash ────────────────────────────────────────────────────

describe('validateBrReceitaCnpjLocalManifest — integrity', () => {
  it('rejects a size mismatch', async () => {
    const result = await validate((m) => {
      const empresas = m.files.find((f) => f.fileType === 'empresas')!;
      empresas.expectedSizeBytes = 999999;
    });
    const rejected = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.equal(rejected?.status, 'rejected');
    assert.equal(rejected?.reasonCode, 'file_size_mismatch');
  });

  it('rejects a hash mismatch', async () => {
    const result = await validate((m) => {
      const empresas = m.files.find((f) => f.fileType === 'empresas')!;
      empresas.expectedSha256 = 'deadbeef'.repeat(8); // 64 hex, wrong on purpose
    });
    const rejected = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.equal(rejected?.reasonCode, 'file_hash_mismatch');
  });

  it('accepts a matching hash', async () => {
    // Compute the true hash of the empresas file, then assert it validates.
    const { dir, manifestPath } = makeFixture();
    const trueHash = createHash('sha256')
      .update(fs.readFileSync(path.join(dir, 'empresas.csv')))
      .digest('hex');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BrReceitaCnpjManifest;
    manifest.files.find((f) => f.fileType === 'empresas')!.expectedSha256 = trueHash;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const result = await validateBrReceitaCnpjLocalManifest({
      manifestPath,
      allowRealLocalFiles: true,
      strict: true,
    });
    assert.equal(result.ok, true);
  });

  it('reports file_not_found for a missing local file', async () => {
    const result = await validate((m) => {
      const empresas = m.files.find((f) => f.fileType === 'empresas')!;
      empresas.path = 'does-not-exist.csv';
    });
    const rejected = result.fileReports.find((r) => r.safeFileLabel === 'does-not-exist.csv');
    assert.equal(rejected?.reasonCode, 'file_not_found');
  });
});

// ─── Header / layout ────────────────────────────────────────────────────────────

describe('validateBrReceitaCnpjLocalManifest — header/layout', () => {
  it('rejects a missing required header', async () => {
    const { dir, manifestPath } = makeFixture();
    // Overwrite empresas.csv with a header missing the required cnpj_basico.
    fs.writeFileSync(path.join(dir, 'empresas.csv'), 'razao_social,capital_social\nSynthetic,100\n');
    const result = await validateBrReceitaCnpjLocalManifest({
      manifestPath,
      allowRealLocalFiles: true,
      strict: true,
    });
    const rejected = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.equal(rejected?.status, 'rejected');
    assert.equal(rejected?.layoutValidation, 'failed');
    assert.equal(rejected?.reasonCode, 'header_validation_failed');
  });

  it('rejects a forbidden header token (cpf)', async () => {
    const { dir, manifestPath } = makeFixture();
    fs.writeFileSync(path.join(dir, 'empresas.csv'), 'cnpj_basico,cpf\nAB,x\n');
    const result = await validateBrReceitaCnpjLocalManifest({
      manifestPath,
      allowRealLocalFiles: true,
      strict: true,
    });
    const rejected = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.equal(rejected?.reasonCode, 'forbidden_header');
  });

  it('rejects a dangerous unknown header under strict', async () => {
    const { dir, manifestPath } = makeFixture();
    fs.writeFileSync(path.join(dir, 'empresas.csv'), 'cnpj_basico,mystery_column\nAB,x\n');
    const result = await validateBrReceitaCnpjLocalManifest({
      manifestPath,
      allowRealLocalFiles: true,
      strict: true,
    });
    const rejected = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.equal(rejected?.reasonCode, 'dangerous_unknown_header');
  });

  it('reports header_read_limit_exceeded when the header exceeds the byte cap', async () => {
    const { dir, manifestPath } = makeFixture();
    // A single very long header line with no newline within the tiny cap.
    const longHeader = `cnpj_basico,${'x'.repeat(200)}`;
    fs.writeFileSync(path.join(dir, 'empresas.csv'), longHeader);
    const result = await validateBrReceitaCnpjLocalManifest({
      manifestPath,
      allowRealLocalFiles: true,
      strict: true,
      maxHeaderBytes: 16,
    });
    const rejected = result.fileReports.find((r) => r.fileType === 'empresas');
    assert.equal(rejected?.reasonCode, 'header_read_limit_exceeded');
  });

  it('exposes a sane default header byte cap', () => {
    assert.ok(BR_RECEITA_CNPJ_MANIFEST_DEFAULT_MAX_HEADER_BYTES >= 1024);
  });
});

// ─── Structure-only mode (no filesystem touch on data files) ──────────────────

describe('validateBrReceitaCnpjLocalManifest — structure-only mode', () => {
  it('skips layout when allowRealLocalFiles is false', async () => {
    const { manifestPath } = makeFixture();
    const result = await validateBrReceitaCnpjLocalManifest({ manifestPath, allowRealLocalFiles: false });
    assert.equal(result.ok, true);
    for (const report of result.fileReports) {
      assert.equal(report.layoutValidation, 'skipped');
      assert.equal(report.status, 'accepted');
      assert.equal(report.sha256Hash12, undefined);
    }
  });
});
