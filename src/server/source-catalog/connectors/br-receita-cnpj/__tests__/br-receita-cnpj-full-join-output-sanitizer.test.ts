/**
 * BR Receita CNPJ full join OUTPUT SANITIZER — tests (BR-SOURCE-11A / 11C).
 *
 * Proves the sanitizer blocks every forbidden output shape and leaks nothing while
 * doing so:
 *   - full CNPJ (continuous and formatted), CPF (continuous and formatted),
 *     CNPJ básico / long digit runs;
 *   - email, phone, and LinkedIn markers;
 *   - `raw_row` / `raw_data` payloads, `record_identity_key`, `normalized_tax_id`,
 *     `cnpj_basico`, `cnpj`, `cpf` values, and identifier hashes;
 *   - oversized numeric leaves (identifier-scale numbers masquerading as counts);
 *   - a `*_printed: true` assertion, which is a DECLARED leak, not an exemption;
 *   - a FILESYSTEM PATH (BR-SOURCE-11C): an absolute POSIX or Windows path or a
 *     `file:` URL, in the report tree and in the rendered string alike.
 *
 * It also proves the safe shapes pass: `YYYY-MM` periods, real periods, hito labels,
 * placeholders, small counters, `*_printed: false` safety assertions, and the Option B
 * report shape (`manifest_trust`, `option_b_carveout_authorized`, the local-manifest
 * count keys).
 *
 * 100% synthetic. Every identifier-shaped token and every path-shaped value is
 * assembled by CONCATENATION, so no 8-/11-/14-digit literal, no e-mail marker literal,
 * and no operator location literal exists in this source file.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF,
  sanitizeBrazilReceitaFullJoinRenderedOutput,
  sanitizeBrazilReceitaFullJoinReport,
} from '../br-receita-cnpj-full-join-output-sanitizer';

// ─── Synthetic identifier-shaped tokens (assembled, never literal) ─────────────

/** 14 digits — CNPJ completo length. */
const CNPJ_LIKE = '1122' + '2333' + '000199';
/** Formatted CNPJ. */
const CNPJ_FORMATTED_LIKE = '11' + '.222' + '.333' + '/0001' + '-99';
/** 11 digits — CPF length. */
const CPF_LIKE = '12345' + '678901';
/** Formatted CPF. */
const CPF_FORMATTED_LIKE = '123' + '.456' + '.789' + '-01';
/** 8 digits — CNPJ básico / raiz length. */
const CNPJ_BASICO_LIKE = '1122' + '2333';
/** An e-mail-shaped value, assembled so no marker literal lives in source. */
const EMAIL_LIKE = 'contact' + String.fromCharCode(64) + 'synthetic.invalid';
/** A phone-shaped value. */
const PHONE_LIKE = '+' + '55' + '11' + '99999' + '9999';
/** A 32-char hex digest, interleaved so it holds no long digit run of its own. */
const HEX_DIGEST_LIKE = 'a1b2c3d4'.repeat(4);

function findingKinds(result: { findings: readonly { kind: string }[] }): string[] {
  return result.findings.map((f) => f.kind);
}

describe('BR-SOURCE-11A output sanitizer — blocked value shapes', () => {
  it('blocks a 14-digit CNPJ', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ note: CNPJ_LIKE });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cnpj_completo_like'));
  });

  it('blocks a formatted CNPJ', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ note: CNPJ_FORMATTED_LIKE });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cnpj_completo_like'));
  });

  it('blocks an 11-digit CPF', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ note: CPF_LIKE });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cpf_like'));
  });

  it('blocks a formatted CPF', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ note: CPF_FORMATTED_LIKE });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cpf_like'));
  });

  it('blocks an 8-digit CNPJ básico value', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ note: CNPJ_BASICO_LIKE });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cnpj_basico_like'));
  });

  it('blocks an email', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ note: EMAIL_LIKE });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('email_like'));
  });

  it('blocks a phone', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ note: PHONE_LIKE });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).length > 0);
  });

  it('blocks a LinkedIn URL', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      note: 'https://' + 'www.linkedin' + '.com/in/synthetic',
    });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('linkedin_url_like'));
  });

  it('blocks an identifier hash digest', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ note: HEX_DIGEST_LIKE });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('identifier_hash_value'));
  });

  it('blocks an oversized numeric leaf', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      count: BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF + 1,
    });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('oversized_numeric_value'));
  });

  it('blocks a non-finite numeric leaf', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ count: Number.POSITIVE_INFINITY });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('oversized_numeric_value'));
  });

  it('blocks a forbidden value nested inside an array', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ notes: [{ deeper: CNPJ_LIKE }] });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cnpj_completo_like'));
  });
});

describe('BR-SOURCE-11A output sanitizer — blocked key shapes', () => {
  it('blocks a raw_row payload', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ raw_row: ['a', 'b'] });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('raw_row_payload'));
  });

  it('blocks a rawRows payload regardless of casing/separators', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ rawRows: ['a'] });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('raw_row_payload'));
  });

  it('blocks a raw_data payload', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ raw_data: { cell: 'x' } });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('raw_data_payload'));
  });

  it('allows an EMPTY raw_data payload (carries nothing)', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ raw_data: null, raw_row: [] });
    assert.equal(result.ok, true);
  });

  it('blocks a record_identity_key value', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ record_identity_key: 'anything' });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('record_identity_key_value'));
  });

  it('blocks a normalized_tax_id value', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ normalized_tax_id: 'anything' });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('normalized_tax_id_value'));
  });

  it('blocks a cnpj_basico value', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ cnpj_basico: 'anything' });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cnpj_basico_key_value'));
  });

  it('blocks a cnpj value', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ cnpj: 'anything' });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cnpj_key_value'));
  });

  it('blocks a cpf value', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ cpf: 'anything' });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cpf_key_value'));
  });

  it('blocks a hash / fingerprint / sha value', () => {
    for (const key of ['row_hash', 'fingerprint', 'sha256', 'digest']) {
      const result = sanitizeBrazilReceitaFullJoinReport({ [key]: 'anything' });
      assert.equal(result.ok, false, `expected refusal for key "${key}"`);
      assert.ok(findingKinds(result).includes('identifier_hash_value'));
    }
  });

  it('treats a *_printed: true safety assertion as a DECLARED leak', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ cnpj_basico_printed: true });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cnpj_basico_key_value'));
  });
});

describe('BR-SOURCE-11A output sanitizer — safe shapes pass', () => {
  it('allows the safety assertions in their held (false) form', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      raw_rows_printed: false,
      cnpj_basico_printed: false,
      cnpj_completo_printed: false,
      cpf_printed: false,
      join_keys_printed: false,
      identity_keys_constructed: false,
      identity_keys_printed: false,
      record_identity_keys_printed: false,
      normalized_tax_ids_printed: false,
      person_data_printed: false,
      hashes_of_identifiers_printed: false,
      unsafe_artifacts_detected: false,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });

  it('allows periods, placeholders, hito labels and small counters', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      source_period: 'YYYY-MM',
      real_period: '2026-07',
      hito: 'BR-SOURCE-11A',
      gate_5_output_sanitization: 'not_approved',
      run_mode: 'synthetic_fixture_only',
      source_key: 'br_receita_cnpj_dados_abertos',
      counts: { joined_with_company_context: 2, pending_full_join_context: 1 },
      cap: 5000,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });

  it('does not mistake an innocent key containing a short fragment for an identifier', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      shared_scope: 'aggregate_only',
      share_count: 3,
    });
    assert.equal(result.ok, true);
  });

  it('survives a cyclic report without hanging', () => {
    const cyclic: Record<string, unknown> = { ok: true };
    cyclic.self = cyclic;
    const result = sanitizeBrazilReceitaFullJoinReport(cyclic);
    assert.equal(result.ok, true);
  });
});

describe('BR-SOURCE-11A output sanitizer — leak safety of findings', () => {
  it('never includes the offending value in the findings', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      a: CNPJ_LIKE,
      b: CPF_LIKE,
      c: EMAIL_LIKE,
      d: HEX_DIGEST_LIKE,
    });
    assert.equal(result.ok, false);
    const serialized = JSON.stringify(result);
    for (const value of [CNPJ_LIKE, CPF_LIKE, EMAIL_LIKE, HEX_DIGEST_LIKE]) {
      assert.ok(!serialized.includes(value), 'findings must never carry the offending value');
    }
  });

  it('reports only a kind and a sanitized key path', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ outer: { inner: CNPJ_LIKE } });
    assert.equal(result.ok, false);
    assert.deepEqual(result.findings, [{ kind: 'cnpj_completo_like', path: 'outer.inner' }]);
  });
});

describe('BR-SOURCE-11A output sanitizer — rendered output', () => {
  it('blocks a leak present only in the rendered string', () => {
    const result = sanitizeBrazilReceitaFullJoinRenderedOutput(`note: ${CNPJ_LIKE}`);
    assert.equal(result.ok, false);
    assert.equal(result.findings[0]?.path, '<rendered>');
  });

  it('passes a clean rendered report', () => {
    const result = sanitizeBrazilReceitaFullJoinRenderedOutput(
      'ok: true\nrun_mode: synthetic_fixture_only\njoined_with_company_context: 2',
    );
    assert.equal(result.ok, true);
  });
});

// ─── BR-SOURCE-11C: filesystem paths, and the Option B report shape ───────────

/**
 * Path-shaped values, assembled so no real operator location lives in this source file.
 * A synthetic temp workspace is the first time a real path exists in the process at all,
 * and a temp path still names the operator's machine — so none may reach a report.
 */
const TEMP_PATH_LIKE = '/' + 'var' + '/' + 'folders' + '/' + 'synthetic-workspace';
const HOME_PATH_LIKE = '/' + 'home' + '/' + 'synthetic-operator' + '/' + 'workspace';
const WINDOWS_PATH_LIKE = 'C:' + '\\' + 'synthetic' + '\\' + 'workspace';
const FILE_URL_LIKE = 'file:' + '//' + '/synthetic-workspace';

describe('BR-SOURCE-11C output sanitizer — filesystem paths are blocked', () => {
  const pathCases: ReadonlyArray<readonly [string, string]> = [
    ['an absolute temp path', TEMP_PATH_LIKE],
    ['an absolute home path', HOME_PATH_LIKE],
    ['a Windows drive path', WINDOWS_PATH_LIKE],
    ['a file: URL', FILE_URL_LIKE],
  ];

  for (const [label, value] of pathCases) {
    it(`blocks ${label}`, () => {
      const result = sanitizeBrazilReceitaFullJoinReport({ note: value });
      assert.equal(result.ok, false, `${label} must be blocked`);
      assert.ok(findingKinds(result).includes('filesystem_path_like'));
    });

    it(`blocks ${label} in a RENDERED report too`, () => {
      const result = sanitizeBrazilReceitaFullJoinRenderedOutput(`workspace: ${value}`);
      assert.equal(result.ok, false);
      assert.equal(result.findings[0]?.path, '<rendered>');
    });
  }

  it('never echoes the offending path in a finding', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ workspace: TEMP_PATH_LIKE });
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes('synthetic-workspace'));
  });

  it('does not mistake a formatted CNPJ, a period, or a version for a path', () => {
    // The formatted-CNPJ shape carries a slash but is reported as the TIGHTER kind.
    const cnpj = sanitizeBrazilReceitaFullJoinReport({ note: CNPJ_FORMATTED_LIKE });
    assert.equal(findingKinds(cnpj)[0], 'cnpj_completo_like');
    const safe = sanitizeBrazilReceitaFullJoinReport({
      source_period: '2026-07',
      layout_mode: 'official_headerless',
      version: 'v0.1',
      ratio_label: 'rows_per_family',
    });
    assert.equal(safe.ok, true);
    assert.deepEqual(safe.findings, []);
  });
});

describe('BR-SOURCE-11C output sanitizer — the Option B report shape passes', () => {
  it('allows the manifest-trust and carve-out fields', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      run_mode: 'local_manifest_dry_run',
      manifest_trust: 'synthetic_temp_manifest_only',
      option_b_carveout_authorized: true,
      source_period: null,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });

  it('allows the Option B aggregate and guardrail count keys', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      aggregate_counts: {
        local_manifest_files_scanned: 6,
        local_manifest_families_scanned: 5,
      },
      guardrail_counts: {
        local_manifest_bytes_cap_applied: 1,
        local_manifest_forbidden_family_findings: 0,
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });

  it('still blocks a raw cell or a filename smuggled onto an Option B report', () => {
    const withCell = sanitizeBrazilReceitaFullJoinReport({
      manifest_trust: 'synthetic_temp_manifest_only',
      raw_cell: 'SYN_COMP_A',
    });
    assert.equal(withCell.ok, false);
    // BR-SOURCE-11F-IMPL narrowed this from the generic `raw_data_payload` to the dedicated
    // cell kind: the required-family probe is the first code path that ever holds a real
    // cell, so a cell-shaped key is named as one. The refusal itself is unchanged.
    assert.ok(findingKinds(withCell).includes('raw_cell_payload'));

    const withPath = sanitizeBrazilReceitaFullJoinReport({
      manifest_trust: 'synthetic_temp_manifest_only',
      scanned_file: `${TEMP_PATH_LIKE}/synthetic-empresas.csv`,
    });
    assert.equal(withPath.ok, false);
    assert.ok(findingKinds(withPath).includes('filesystem_path_like'));
  });
});

// ─── BR-SOURCE-11D-META-IMPL: the metadata-only report shape ──────────────────

describe('BR-SOURCE-11D-META output sanitizer — raw manifest output is blocked', () => {
  const rawManifestKeys = [
    'raw_manifest',
    'rawManifest',
    'RAW-MANIFEST',
    'manifest_json',
    'manifestDocument',
    'manifest_body',
  ];

  for (const key of rawManifestKeys) {
    it(`blocks a "${key}" key carrying a payload`, () => {
      const result = sanitizeBrazilReceitaFullJoinReport({
        [key]: { sourceKey: 'br_receita_cnpj_dados_abertos', files: [{ fileType: 'empresas' }] },
      });
      assert.equal(result.ok, false, `${key} must be blocked`);
      assert.ok(findingKinds(result).includes('raw_manifest_payload'));
    });
  }

  it('blocks a raw manifest carried as a STRING as well as an object', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      raw_manifest: '{"sourceKey":"br_receita_cnpj_dados_abertos"}',
    });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('raw_manifest_payload'));
  });

  it('never echoes the manifest document in a finding', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      raw_manifest: { sourcePeriod: '2026-07', files: ['synthetic-empresas.csv'] },
    });
    assert.equal(result.ok, false);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes('sourcePeriod'));
    assert.ok(!serialized.includes('synthetic-empresas.csv'));
  });

  it('allows the held-absence assertion raw_manifest_printed: false', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ raw_manifest_printed: false });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });

  it('blocks raw_manifest_printed: true — a declared leak is not an exemption', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ raw_manifest_printed: true });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('raw_manifest_payload'));
  });
});

describe('BR-SOURCE-11D-META output sanitizer — declared filenames are blocked', () => {
  const filenameKeys = [
    'file_name',
    'fileName',
    'declared_file_names',
    'manifest_path',
    'declared_path',
    'basename',
    'absolute_path',
    'file_path',
  ];

  for (const key of filenameKeys) {
    it(`blocks a "${key}" key carrying a value`, () => {
      // A RELATIVE filename holds no absolute-path shape, so only the KEY rule catches it.
      const result = sanitizeBrazilReceitaFullJoinReport({ [key]: 'synthetic-empresas.csv' });
      assert.equal(result.ok, false, `${key} must be blocked`);
      assert.ok(findingKinds(result).includes('declared_filename_payload'));
    });
  }

  it('allows the held-absence assertion absolute_paths_printed: false', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ absolute_paths_printed: false });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });

  it('does not mistake a family label or a count key for a filename', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      declared_file_count: 5,
      declared_family_counts: { empresas: 1, estabelecimentos: 1, other: 0 },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });
});

describe('BR-SOURCE-11D-META output sanitizer — the metadata-only report shape passes', () => {
  /** The exact block the runner emits for an authorized metadata-only run. */
  const METADATA_BLOCK = {
    schema_version_present: true,
    source_period_present: true,
    layout_mode: 'official_headerless',
    declared_file_count: 5,
    required_family_count: 2,
    missing_required_family_count: 0,
    forbidden_family_count: 0,
    declared_family_counts: {
      empresas: 1,
      estabelecimentos: 1,
      simples: 0,
      cnaes: 1,
      municipios: 1,
      naturezas: 1,
      other: 0,
    },
    required_families_present: true,
    forbidden_families_present: false,
    manifest_bytes_read_bucket: 'lte_1mb',
    referenced_data_files_opened: false,
    referenced_data_files_statted: false,
    raw_manifest_printed: false,
    absolute_paths_printed: false,
  };

  it('passes the full metadata-only report shape', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      run_mode: 'local_manifest_dry_run',
      manifest_trust: 'real_manifest_metadata_only',
      option_b_carveout_authorized: false,
      real_manifest_metadata_only_option_b_authorized: true,
      source_period: null,
      manifest_metadata: METADATA_BLOCK,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });

  it('passes the over-limit bucket and the metadata-only error codes', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      manifest_metadata: { ...METADATA_BLOCK, manifest_bytes_read_bucket: 'over_limit_blocked' },
      errors: [
        { error_code: 'real_manifest_metadata_cap_exceeded', stage: 'real_manifest_metadata_read' },
        {
          error_code: 'real_manifest_metadata_forbidden_family_detected',
          stage: 'real_manifest_metadata_read',
        },
      ],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });

  it('still blocks a manifest path smuggled onto a metadata-only report', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      manifest_trust: 'real_manifest_metadata_only',
      manifest_metadata: { ...METADATA_BLOCK, manifest_path: `${TEMP_PATH_LIKE}/manifest.json` },
    });
    assert.equal(result.ok, false);
    const kinds = findingKinds(result);
    assert.ok(kinds.includes('declared_filename_payload') || kinds.includes('filesystem_path_like'));
  });

  it('still blocks an oversized declared count masquerading as metadata', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      manifest_metadata: {
        ...METADATA_BLOCK,
        declared_file_count: BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF + 1,
      },
    });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('oversized_numeric_value'));
  });

  it('still blocks an identifier smuggled into a family label', () => {
    for (const [label, value] of [
      ['a CNPJ básico', CNPJ_BASICO_LIKE],
      ['a full CNPJ', CNPJ_LIKE],
      ['a CPF', CPF_LIKE],
      ['an email', EMAIL_LIKE],
      ['a phone', PHONE_LIKE],
      ['a hex digest', HEX_DIGEST_LIKE],
    ] as const) {
      const result = sanitizeBrazilReceitaFullJoinReport({
        manifest_metadata: { ...METADATA_BLOCK, layout_mode: value },
      });
      assert.equal(result.ok, false, `${label} must be blocked`);
    }
  });
});

// ─── BR-SOURCE-11F-IMPL: the required-family probe report shape ────────────────

/**
 * The aggregate probe block a green Option C run produces. Every value is a count, a bucket,
 * a class label, a histogram, or a held-absence `false` — the shape the sanitizer must accept
 * unchanged, so a failing assertion here means the probe contract drifted.
 */
const PROBE_BLOCK = {
  families_attempted: ['empresas', 'estabelecimentos'],
  files_opened_count: 2,
  files_opened_by_family: { empresas: 1, estabelecimentos: 1 },
  bytes_read_bucket: { empresas: 'lte_64kb', estabelecimentos: 'lte_64kb' },
  rows_read_bucket: { empresas: 'lte_20', estabelecimentos: 'lte_20' },
  row_shape: {
    empresas: {
      expected_min_columns: 7,
      observed_column_count_distribution: { '7': 20 },
      row_shape_valid_count: 20,
      row_shape_invalid_count: 0,
    },
    estabelecimentos: {
      expected_min_columns: 30,
      observed_column_count_distribution: { '30': 20 },
      row_shape_valid_count: 20,
      row_shape_invalid_count: 0,
    },
  },
  encoding_status: { empresas: 'ok', estabelecimentos: 'ok' },
  delimiter_status: { empresas: 'semicolon_detected', estabelecimentos: 'semicolon_detected' },
  headerless_status: { empresas: 'assumed_headerless', estabelecimentos: 'assumed_headerless' },
  forbidden_family_attempted: false,
  forbidden_family_declared_count: 0,
  never_opened_family_declared_count: 3,
  raw_rows_printed: false,
  raw_cells_printed: false,
  identifiers_printed: false,
  filenames_printed: false,
  absolute_paths_printed: false,
  hashes_printed: false,
  joins_executed: false,
  join_coverage_computed: false,
  full_dataset_processed: false,
} as const;

describe('BR-SOURCE-11F-IMPL required-family probe — sanitizer contract', () => {
  it('accepts the aggregate probe block unchanged', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      manifest_trust: 'real_manifest_required_family_probe',
      required_family_probe: PROBE_BLOCK,
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
  });

  it('blocks a raw CELL payload with its own kind', () => {
    for (const key of ['raw_cell', 'rawCells', 'cell_value', 'column_value', 'raw_field']) {
      const result = sanitizeBrazilReceitaFullJoinReport({ [key]: 'SYN-EMPRESAS-R0-C0' });
      assert.equal(result.ok, false, `${key} must be blocked`);
      assert.ok(findingKinds(result).includes('raw_cell_payload'), key);
    }
  });

  it('blocks a row SAMPLE payload with its own kind', () => {
    for (const key of ['row_sample', 'sampled_rows', 'rowSamples', 'line_sample']) {
      const result = sanitizeBrazilReceitaFullJoinReport({ [key]: ['SYN-A;SYN-B'] });
      assert.equal(result.ok, false, `${key} must be blocked`);
      assert.ok(findingKinds(result).includes('row_sample_payload'), key);
    }
  });

  it('allows an EMPTY cell or sample key (carries nothing)', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      raw_cell: null,
      cell_value: '',
      row_sample: [],
    });
    assert.equal(result.ok, true);
  });

  it('blocks a raw row, a filename, a path or a hash smuggled onto a probe report', () => {
    const smuggled: ReadonlyArray<readonly [string, unknown]> = [
      ['raw_rows', ['SYN-A;SYN-B']],
      ['file_name', 'synthetic-empresas.csv'],
      ['manifest_path', `${TEMP_PATH_LIKE}/manifest.json`],
      ['row_hash', HEX_DIGEST_LIKE],
    ];
    for (const [key, value] of smuggled) {
      const result = sanitizeBrazilReceitaFullJoinReport({
        manifest_trust: 'real_manifest_required_family_probe',
        required_family_probe: { ...PROBE_BLOCK, [key]: value },
      });
      assert.equal(result.ok, false, `${key} must be blocked`);
    }
  });

  it('blocks an identifier smuggled into a probe status label or distribution key', () => {
    for (const value of [CNPJ_BASICO_LIKE, CNPJ_LIKE, CPF_LIKE, EMAIL_LIKE, PHONE_LIKE]) {
      const result = sanitizeBrazilReceitaFullJoinReport({
        required_family_probe: {
          ...PROBE_BLOCK,
          encoding_status: { empresas: value, estabelecimentos: 'ok' },
        },
      });
      assert.equal(result.ok, false);
    }
  });

  it('blocks a dataset-scale count masquerading as a probe row count', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      required_family_probe: {
        ...PROBE_BLOCK,
        row_shape: {
          empresas: {
            expected_min_columns: 7,
            observed_column_count_distribution: {
              '7': BRAZIL_RECEITA_FULL_JOIN_MAX_NUMERIC_LEAF + 1,
            },
            row_shape_valid_count: 20,
            row_shape_invalid_count: 0,
          },
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('oversized_numeric_value'));
  });
});

// ─── BR-SOURCE-11G-IMPL: the required-family JOIN probe report shape ───────────

/**
 * The aggregate JOIN block a green 11G Option C run produces. Buckets, zeros, class labels and
 * held-absence `false`s only — the shape the sanitizer must accept unchanged, so a failing
 * assertion here means the join-probe contract drifted.
 */
const JOIN_PROBE_BLOCK = {
  ...PROBE_BLOCK,
  // The ONE assertion that flips relative to 11F (11G decision record § 10.1).
  joins_executed: true,
  join_probe: {
    join_executed: true,
    join_mode: 'ultra_bounded_required_family_in_memory',
    join_key_values_printed: false,
    join_key_values_retained: false,
    join_key_hashes_printed: false,
    join_key_error_leak: false,
    joined_rows_printed: false,
    joined_samples_printed: false,
    joined_pairs_emitted: 0,
    coverage_percentage_printed: false,
    coverage_claimed: false,
    match_result_bucket: 'one_or_more',
    matched_rows_bucket: 'lte_20',
    unmatched_rows_bucket: 'zero',
  },
} as const;

/** An opaque synthetic join key. Resembles no real root value and holds no digit run. */
const JOIN_KEY_LIKE = 'SYN-JOIN-ROOT-A';

describe('BR-SOURCE-11G-IMPL join probe — sanitizer contract', () => {
  it('accepts the aggregate join-probe block unchanged', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      manifest_trust: 'real_manifest_required_family_join_probe',
      required_family_join_probe: JOIN_PROBE_BLOCK,
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
  });

  it('blocks a JOIN KEY payload with its own kind', () => {
    for (const key of [
      'join_key',
      'joinKeys',
      'join_key_values',
      'join_root_key',
      'cnpj_root',
      'root_key_value',
    ]) {
      const result = sanitizeBrazilReceitaFullJoinReport({ [key]: JOIN_KEY_LIKE });
      assert.equal(result.ok, false, `${key} must be blocked`);
      assert.ok(findingKinds(result).includes('join_key_payload'), key);
    }
  });

  it('blocks a declared join-key leak assertion — *_printed: true is not an exemption', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({ join_keys_printed: true });
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('join_key_payload'));
  });

  it('blocks a joined ROW, a joined SAMPLE and a join PAIR with their own kinds', () => {
    const cases: ReadonlyArray<readonly [string, unknown, string]> = [
      ['joined_row', [`${JOIN_KEY_LIKE};SYN-B`], 'joined_row_payload'],
      ['joinedRecords', [`${JOIN_KEY_LIKE};SYN-B`], 'joined_row_payload'],
      ['joined_sample', [`${JOIN_KEY_LIKE};SYN-B`], 'joined_sample_payload'],
      ['join_pairs', [[JOIN_KEY_LIKE, JOIN_KEY_LIKE]], 'join_pair_payload'],
      ['joined_pairs_emitted', 1, 'join_pair_payload'],
    ];
    for (const [key, value, kind] of cases) {
      const result = sanitizeBrazilReceitaFullJoinReport({ [key]: value });
      assert.equal(result.ok, false, `${key} must be blocked`);
      assert.ok(findingKinds(result).includes(kind), `${key} → ${kind}`);
    }
  });

  it('blocks a COVERAGE percentage, ratio, rate or claim', () => {
    for (const key of [
      'coverage_percentage',
      'coverage_ratio',
      'coverage_rate',
      'join_rate',
      'match_rate',
      'coverage_claimed',
    ]) {
      const result = sanitizeBrazilReceitaFullJoinReport({ [key]: 42 });
      assert.equal(result.ok, false, `${key} must be blocked`);
      assert.ok(findingKinds(result).includes('coverage_payload'), key);
    }
  });

  it('blocks a CNPJ básico WINDOW and a CNPJ completo payload with their own kinds', () => {
    const basico = sanitizeBrazilReceitaFullJoinReport({ cnpj_basico_values: [JOIN_KEY_LIKE] });
    assert.equal(basico.ok, false);
    assert.ok(findingKinds(basico).includes('cnpj_basico_payload'));

    const completo = sanitizeBrazilReceitaFullJoinReport({ cnpj_completo_payload: JOIN_KEY_LIKE });
    assert.equal(completo.ok, false);
    assert.ok(findingKinds(completo).includes('cnpj_completo_payload'));
  });

  it('leaves the established single-field CNPJ kinds untouched', () => {
    // The new collection kinds are narrower on purpose: a single field keeps its own kind.
    const basico = sanitizeBrazilReceitaFullJoinReport({ cnpj_basico: 'anything' });
    assert.ok(findingKinds(basico).includes('cnpj_basico_key_value'));
    const printed = sanitizeBrazilReceitaFullJoinReport({ cnpj_basico_printed: true });
    assert.ok(findingKinds(printed).includes('cnpj_basico_key_value'));
  });

  it('allows the legitimate bounded-scan and held-absence coverage fields', () => {
    const result = sanitizeBrazilReceitaFullJoinReport({
      guardrail_counts: { coverage_scan_limit_reached: 1 },
      join_coverage_computed: false,
      coverage_claimed: false,
      coverage_percentage_printed: false,
      join_keys_printed: false,
      joined_pairs_emitted: 0,
    });
    assert.equal(result.ok, true, JSON.stringify(result.findings));
  });

  it('blocks a join key that reached a RENDERED error message', () => {
    // Error paths are an output surface (11G § 5.1): a message carrying an identifier-shaped
    // value is blocked by the rendered-output check even though the report tree was clean.
    const rendered = `required_family_join_probe_read_failed: ${CNPJ_BASICO_LIKE}`;
    const result = sanitizeBrazilReceitaFullJoinRenderedOutput(rendered);
    assert.equal(result.ok, false);
    assert.ok(findingKinds(result).includes('cnpj_basico_like'));
  });
});
