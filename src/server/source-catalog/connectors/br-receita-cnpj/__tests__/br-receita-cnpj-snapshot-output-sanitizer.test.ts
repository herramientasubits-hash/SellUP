/**
 * Tests — BR Receita CNPJ SNAPSHOT / MATERIALIZED-OUTPUT sanitizer.
 * Hito: BR-SOURCE-GATE3-CNPJ-OUTPUT-HARDENING.
 *
 * 100% SYNTHETIC and PURE: no network, no DB, no filesystem, no providers, no real
 * Receita row, no manifest, no ZIP, no CSV, no benchmark. Every CNPJ used here is
 * assembled from synthetic parts by `sampleFullCnpj`, whose DV comes from the same
 * módulo-11 helper the parser uses — so no 14-position identifier literal appears
 * anywhere in this file, and no real-data fixture is required (§ 10.13).
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  sanitizeBrReceitaCnpjSnapshotRow,
  sanitizeBrReceitaCnpjSnapshotRows,
  sanitizeBrReceitaCnpjRejectionRow,
  BR_RECEITA_CNPJ_ALLOWED_RAW_DATA_FIELDS,
  BR_RECEITA_CNPJ_ALLOWED_SNAPSHOT_FIELDS,
  type BrReceitaCnpjSnapshotLeakKind,
} from '../br-receita-cnpj-snapshot-output-sanitizer';
import { buildBrReceitaCnpjSnapshotRows } from '../br-receita-cnpj-snapshot-builder';
import {
  sampleParserInput,
  sampleFullCnpj,
  RAIZ_TECNOLOGIA,
  RAIZ_EDUCACAO,
} from '../br-receita-cnpj-fixtures';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** A clean, builder-produced row — the baseline every mutation starts from. */
function cleanRow(): Record<string, unknown> {
  const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
  const row = result.snapshots[0];
  assert.ok(row, 'expected the synthetic fixture to produce at least one snapshot');
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

/** Applies one mutation to `raw_data` and returns the sanitizer findings. */
function withRawData(patch: Record<string, unknown>): readonly BrReceitaCnpjSnapshotLeakKind[] {
  const row = cleanRow();
  row.raw_data = { ...(row.raw_data as Record<string, unknown>), ...patch };
  return sanitizeBrReceitaCnpjSnapshotRow(row).findings.map((f) => f.kind);
}

/** Applies one mutation at the TOP level and returns the sanitizer findings. */
function withTopLevel(patch: Record<string, unknown>): readonly BrReceitaCnpjSnapshotLeakKind[] {
  return sanitizeBrReceitaCnpjSnapshotRow({ ...cleanRow(), ...patch }).findings.map((f) => f.kind);
}

const LEGACY_NUMERIC_CNPJ = sampleFullCnpj(RAIZ_TECNOLOGIA, '0001');
const ALPHANUMERIC_CNPJ = sampleFullCnpj(RAIZ_EDUCACAO, '0001');

// ─── Baseline: the builder's own output is clean ───────────────────────────────

describe('snapshot output sanitizer — baseline', () => {
  it('passes every row the hardened builder produces', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const verdict = sanitizeBrReceitaCnpjSnapshotRows(result.snapshots);
    assert.deepEqual(verdict.findings, []);
    assert.equal(verdict.ok, true);
  });

  it('passes every rejection the hardened builder produces', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    assert.ok(result.rejected.length > 0, 'expected the fixture to produce rejections');
    for (const rejection of result.rejected) {
      assert.deepEqual(sanitizeBrReceitaCnpjRejectionRow(rejection).findings, []);
    }
  });

  it('never echoes a value — a finding carries a KIND and a key PATH only', () => {
    const row = cleanRow();
    row.raw_data = {
      ...(row.raw_data as Record<string, unknown>),
      cnpj_root: RAIZ_TECNOLOGIA,
    };
    const verdict = sanitizeBrReceitaCnpjSnapshotRow(row);
    assert.equal(verdict.ok, false);
    const serialized = JSON.stringify(verdict.findings);
    assert.ok(!serialized.includes(RAIZ_TECNOLOGIA), 'a finding must not carry the value');
    assert.ok(!serialized.includes(LEGACY_NUMERIC_CNPJ));
  });
});

// ─── § 10.1 / § 10.2 / § 10.3 — the three removed fields cannot come back ─────

describe('snapshot output sanitizer — removed CNPJ part fields', () => {
  it('§ 10.1 blocks cnpj_root (the CNPJ básico) from surviving output', () => {
    const kinds = withRawData({ cnpj_root: RAIZ_TECNOLOGIA });
    assert.ok(kinds.includes('cnpj_identity_key'));
    assert.ok(kinds.includes('unallowlisted_output_key'));
  });

  it('§ 10.2 blocks cnpj_order from surviving output', () => {
    const kinds = withRawData({ cnpj_order: '0001' });
    assert.ok(kinds.includes('cnpj_identity_key'));
    assert.ok(kinds.includes('unallowlisted_output_key'));
  });

  it('§ 10.3 blocks cnpj_dv from surviving output', () => {
    const kinds = withRawData({ cnpj_dv: LEGACY_NUMERIC_CNPJ.slice(12) });
    assert.ok(kinds.includes('cnpj_identity_key'));
    assert.ok(kinds.includes('unallowlisted_output_key'));
  });

  it('blocks the three renamed to innocent-looking keys — the VALUE is enough', () => {
    // The point of a key+value sanitizer: renaming the field does not launder it.
    const kinds = withRawData({ registration_status_label: RAIZ_TECNOLOGIA });
    assert.ok(kinds.includes('cnpj_basico_value'));
  });

  it('blocks the pre-hardening top-level identity columns', () => {
    for (const [key, value] of [
      ['tax_id', LEGACY_NUMERIC_CNPJ],
      ['normalized_tax_id', LEGACY_NUMERIC_CNPJ],
      ['record_identity_key', `tax:${LEGACY_NUMERIC_CNPJ}`],
    ] as const) {
      const kinds = withTopLevel({ [key]: value });
      assert.ok(
        kinds.includes('cnpj_identity_key') || kinds.includes('unallowlisted_output_key'),
        `expected "${key}" to be refused`,
      );
    }
  });
});

// ─── § 10.4 — reconstruction across separate fields ───────────────────────────

describe('snapshot output sanitizer — § 10.4 reconstruction', () => {
  it('blocks a full CNPJ split across three permitted fields', () => {
    // Exactly the pre-hardening shape: raiz + ordem + DV, each innocuous alone.
    const kinds = withRawData({
      registration_status_label: RAIZ_TECNOLOGIA,
      cnae_main_label: '0001',
      municipality_name: LEGACY_NUMERIC_CNPJ.slice(12),
    });
    assert.ok(
      kinds.includes('reconstructable_cnpj_parts') || kinds.includes('cnpj_basico_value'),
      'expected the split CNPJ to be refused',
    );
  });

  it('blocks a full CNPJ split across exactly two permitted fields', () => {
    const kinds = withRawData({
      cnae_main_label: LEGACY_NUMERIC_CNPJ.slice(0, 7),
      municipality_name: LEGACY_NUMERIC_CNPJ.slice(7),
    });
    assert.ok(kinds.includes('reconstructable_cnpj_parts'));
  });

  it('reports the participating key PATHS, never the recombined value', () => {
    const row = cleanRow();
    row.raw_data = {
      ...(row.raw_data as Record<string, unknown>),
      cnae_main_label: LEGACY_NUMERIC_CNPJ.slice(0, 7),
      municipality_name: LEGACY_NUMERIC_CNPJ.slice(7),
    };
    const finding = sanitizeBrReceitaCnpjSnapshotRow(row).findings.find(
      (f) => f.kind === 'reconstructable_cnpj_parts',
    );
    assert.ok(finding, 'expected a reconstruction finding');
    assert.ok(finding.path.includes('+'), 'expected the finding to name both key paths');
    assert.ok(!finding.path.includes(LEGACY_NUMERIC_CNPJ));
  });
});

// ─── § 10.5 / § 10.6 / § 10.7 — value-level identifier detection ──────────────

describe('snapshot output sanitizer — § 10.5–10.7 identifier values', () => {
  it('§ 10.5 blocks a DV-valid all-numeric full CNPJ as a value', () => {
    assert.ok(withRawData({ municipality_name: LEGACY_NUMERIC_CNPJ }).includes('cnpj_completo_value'));
  });

  it('§ 10.6 blocks a DV-valid ALPHANUMERIC full CNPJ as a value', () => {
    // The July-2026 format. No digit-only pattern can see it; the canonical
    // alphanumeric-aware, DV-validated helper can.
    assert.ok(/[A-Z]/.test(ALPHANUMERIC_CNPJ), 'fixture must be alphanumeric');
    assert.ok(withRawData({ municipality_name: ALPHANUMERIC_CNPJ }).includes('cnpj_completo_value'));
  });

  it('§ 10.6 blocks an alphanumeric CNPJ in its officially punctuated form', () => {
    const c = ALPHANUMERIC_CNPJ;
    const masked = `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
    assert.ok(withRawData({ municipality_name: masked }).includes('cnpj_completo_value'));
  });

  it('§ 10.7 blocks an all-numeric CNPJ básico as a value', () => {
    assert.ok(withRawData({ municipality_name: RAIZ_TECNOLOGIA }).includes('cnpj_basico_value'));
  });

  it('§ 10.7 blocks an ALPHANUMERIC CNPJ básico as a value', () => {
    assert.ok(withRawData({ municipality_name: RAIZ_EDUCACAO }).includes('cnpj_basico_value'));
  });

  it('§ 10.7 blocks a CNPJ básico embedded inside a longer text value', () => {
    assert.ok(
      withRawData({ legal_nature_label: `Registro ${RAIZ_TECNOLOGIA} ativo` }).includes(
        'cnpj_basico_value',
      ),
    );
  });

  it('blocks a CPF-shaped value, continuous and punctuated', () => {
    assert.ok(withRawData({ municipality_name: '12345678901' }).includes('cpf_value'));
    assert.ok(withRawData({ municipality_name: '123.456.789-01' }).includes('cpf_value'));
  });

  it('does NOT waive the root rule when a date field carries a non-date', () => {
    // The waiver is earned by the VALUE, not granted by the KEY.
    assert.ok(withRawData({ start_date: RAIZ_TECNOLOGIA }).includes('cnpj_basico_value'));
  });
});

// ─── § 10.8 — prohibited derivatives (hash / truncation / fingerprint) ────────

describe('snapshot output sanitizer — § 10.8 prohibited derivatives', () => {
  it('blocks the derivative shape the connector itself can build (12-hex)', () => {
    // `buildBrazilCnpjHash12` produces a truncated SHA-256. GATE-1 R4 forbids a
    // hash, truncation or fingerprint of a CNPJ "anywhere", so the pre-hardening
    // `safeIdentifier` / `valid_cnpj_hashes` shape is a leak, not a mitigation.
    assert.ok(
      withRawData({ municipality_name: 'a1b2c3d4e5f6' }).includes('identifier_derivative_value'),
    );
  });

  it('blocks derivative-shaped KEYS regardless of the value', () => {
    for (const key of [
      'cnpj_hash',
      'tax_id_fingerprint',
      'identity_digest',
      'truncated_identity',
      'sha256_identity',
    ]) {
      const kinds = withRawData({ [key]: 'x' });
      assert.ok(
        kinds.includes('identifier_derivative_key') || kinds.includes('cnpj_identity_key'),
        `expected "${key}" to be refused`,
      );
    }
  });

  it('blocks a rejection row that carries a hashed safe identifier', () => {
    const verdict = sanitizeBrReceitaCnpjRejectionRow({
      sourceRowIndex: 3,
      reasonCode: 'invalid_cnpj',
      sourceFile: null,
      safeIdentifier: 'a1b2c3d4e5f6',
    });
    assert.equal(verdict.ok, false);
    assert.ok(verdict.findings.some((f) => f.kind === 'identifier_derivative_key'));
  });
});

// ─── § 10.9 — no false positives on ordinary business values ──────────────────

describe('snapshot output sanitizer — § 10.9 benign business values', () => {
  it('accepts an 8-digit YYYYMMDD start_date (the real Receita layout)', () => {
    assert.deepEqual(withRawData({ start_date: '20150310' }), []);
  });

  it('accepts a monetary capital with an 8-digit integer part', () => {
    assert.deepEqual(withRawData({ capital_social_value: '12345678.00' }), []);
    assert.deepEqual(withRawData({ capital_social_value: '12345678' }), []);
  });

  it('accepts ordinary registral codes, labels and names', () => {
    assert.deepEqual(
      withRawData({
        cnae_main_code: '6201501',
        cnae_secondary_codes: ['6202300', '6209100', '8599604'],
        municipality_code: '7107',
        legal_nature_code: '2062',
        legal_nature_label: 'Sociedade Empresária Limitada',
        registration_status_code: '02',
        company_size_code: '05',
        uf: 'SP',
      }),
      [],
    );
  });

  it('accepts an eight-LETTER word in free text (no digit ⇒ not a raiz shape)', () => {
    // `official_registry`, `Limitada`, and most Portuguese registral vocabulary
    // contain eight-letter runs. A digit-free rule would reject the parser's own
    // literals.
    assert.deepEqual(withRawData({ legal_nature_label: 'Limitada Sociedade' }), []);
    assert.deepEqual(withRawData({ municipality_name: 'Campinas' }), []);
  });

  it('accepts a long hex-looking word with no digit in it', () => {
    assert.deepEqual(withRawData({ municipality_name: 'Cabecadeaba' }), []);
  });

  it('accepts a bounded source_row_index and source_year', () => {
    assert.deepEqual(withRawData({ source_row_index: 12345678 }), []);
    assert.deepEqual(withTopLevel({ source_year: 2026 }), []);
  });
});

// ─── § 10.10 — capital_social_value behavior unchanged ────────────────────────

describe('snapshot output sanitizer — § 10.10 capital_social_value', () => {
  it('remains on the closed allowlist (a GATE-3 owner question, not a defect)', () => {
    assert.equal(BR_RECEITA_CNPJ_ALLOWED_RAW_DATA_FIELDS.capital_social_value, 'monetary');
  });

  it('is still emitted by the builder, with the same value as before hardening', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    const emitted = result.snapshots.map((s) => s.raw_data.capital_social_value);
    assert.ok(emitted.includes('100000.00'), 'capital_social_value must still be emitted');
    assert.ok(emitted.includes('500000.00'));
  });
});

// ─── § 10.11 — raw_data is a CLOSED typed allowlist ───────────────────────────

describe('snapshot output sanitizer — § 10.11 closed allowlist', () => {
  it('refuses an unknown raw_data key even when its value is innocuous', () => {
    assert.ok(withRawData({ some_new_field: 'harmless' }).includes('unallowlisted_output_key'));
  });

  it('refuses an arbitrary source blob nested under a permitted key', () => {
    assert.ok(
      withRawData({ municipality_name: { original: 'row' } }).includes('unallowlisted_output_key'),
    );
  });

  it('refuses an unknown TOP-LEVEL key', () => {
    assert.ok(withTopLevel({ extra_column: 1 }).includes('unallowlisted_output_key'));
  });

  it('refuses a non-object row and a non-object raw_data', () => {
    assert.equal(sanitizeBrReceitaCnpjSnapshotRow('not a row').ok, false);
    assert.equal(sanitizeBrReceitaCnpjSnapshotRow(null).ok, false);
    assert.ok(withTopLevel({ raw_data: 'not an object' }).includes('unallowlisted_output_key'));
  });

  it('declares exactly the fields the hardened builder emits — nothing wider', () => {
    const result = buildBrReceitaCnpjSnapshotRows(sampleParserInput());
    for (const snapshot of result.snapshots) {
      for (const key of Object.keys(snapshot)) {
        assert.ok(key in BR_RECEITA_CNPJ_ALLOWED_SNAPSHOT_FIELDS, `undeclared column: ${key}`);
      }
      for (const key of Object.keys(snapshot.raw_data)) {
        assert.ok(key in BR_RECEITA_CNPJ_ALLOWED_RAW_DATA_FIELDS, `undeclared raw_data key: ${key}`);
      }
    }
  });

  it('carries no CNPJ-part key on the allowlist itself', () => {
    for (const key of Object.keys(BR_RECEITA_CNPJ_ALLOWED_RAW_DATA_FIELDS)) {
      assert.ok(!/cnpj|raiz|basico|tax_?id/i.test(key), `allowlist re-opened "${key}"`);
    }
    for (const key of Object.keys(BR_RECEITA_CNPJ_ALLOWED_SNAPSHOT_FIELDS)) {
      assert.ok(!/cnpj|raiz|basico|tax_?id|identity/i.test(key), `allowlist re-opened "${key}"`);
    }
  });
});

// ─── § 10.12 — Socios / QSA / CPF / person-linked remain impossible ───────────

describe('snapshot output sanitizer — § 10.12 person-linked fields', () => {
  it('refuses every person-linked key shape', () => {
    for (const key of [
      'nome_socio',
      'socios',
      'qsa',
      'cpf',
      'cpf_representante',
      'representante_legal',
      'faixa_etaria',
      'pessoa_fisica',
    ]) {
      const kinds = withRawData({ [key]: 'X' });
      assert.ok(kinds.includes('person_linked_key'), `expected "${key}" to be refused`);
    }
  });

  it('refuses every contact and fine-address key shape', () => {
    for (const key of [
      'telefone_1',
      'ddd_1',
      'fax',
      'correio_eletronico',
      'email',
      'logradouro',
      'numero',
      'complemento',
      'bairro',
      'cep',
    ]) {
      const kinds = withRawData({ [key]: 'X' });
      assert.ok(kinds.includes('contact_or_address_key'), `expected "${key}" to be refused`);
    }
  });

  it('does not mistake source_period for a CEP field (short-fragment discipline)', () => {
    // `cep` is a substring of `source_period`. A squashed-substring rule on a
    // three-letter fragment matches the alphabet, not an address field.
    assert.deepEqual(withRawData({ source_period: '2026-07' }), []);
    assert.deepEqual(withRawData({ source_period: null }), []);
  });

  it('does not mistake capital_social_value for a socio field', () => {
    assert.deepEqual(withRawData({ capital_social_value: '100000.00' }), []);
  });
});

// ─── § 10.13 — no real data required ─────────────────────────────────────────

describe('snapshot output sanitizer — § 10.13 synthetic only', () => {
  it('runs entirely on synthetic parts, with no 14-position literal in this file', () => {
    // Both CNPJs used above are ASSEMBLED from a synthetic raiz + ordem with a
    // computed DV. Their DV validity is what the detector keys on, and it is proved
    // here rather than asserted.
    assert.equal(LEGACY_NUMERIC_CNPJ.length, 14);
    assert.equal(ALPHANUMERIC_CNPJ.length, 14);
    assert.notEqual(LEGACY_NUMERIC_CNPJ, ALPHANUMERIC_CNPJ);
  });
});

// ─── § 5 — prohibited derivatives: absence proved, not asserted ───────────────

describe('snapshot output sanitizer — § 5 derivative output paths are gone', () => {
  /**
   * Strips comments before grepping.
   *
   * Grepping a raw file body confuses NAMING a symbol in code with QUOTING it in
   * prose: the sanitizer's own header explains why `buildBrazilCnpjHash12` is
   * prohibited, and a naive body grep would report that explanation as a live call.
   * The guard is proved in the negative below so a stripper that silently removed
   * everything could not pass it vacuously.
   */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  const DERIVATIVE_HELPERS = ['buildBrazilCnpjHash12', 'maskBrazilCnpjForReport'] as const;

  /** This test file lives in `<connector>/__tests__`, so the connector is one up. */
  const CONNECTOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  it('is a comment stripper, not a source shredder (negative control)', () => {
    const stripped = stripComments('/* buildBrazilCnpjHash12 */ const kept = 1; // x\nconst also = 2;');
    assert.ok(!stripped.includes('buildBrazilCnpjHash12'));
    assert.ok(stripped.includes('const kept = 1;'));
    assert.ok(stripped.includes('const also = 2;'));
  });

  it('detects a real call when one exists (negative control)', () => {
    const stripped = stripComments('const x = buildBrazilCnpjHash12(cnpj);');
    assert.ok(stripped.includes('buildBrazilCnpjHash12'));
  });

  it('no PRODUCTION module in the connector calls a CNPJ derivative helper', () => {
    const offenders: string[] = [];
    const scanned: string[] = [];
    for (const entry of fs.readdirSync(CONNECTOR_ROOT, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      // `br-cnpj.ts` DECLARES the helpers; declaring them is not an output path.
      if (entry.name === 'br-cnpj.ts') continue;
      scanned.push(entry.name);
      const body = stripComments(fs.readFileSync(path.join(CONNECTOR_ROOT, entry.name), 'utf8'));
      for (const helper of DERIVATIVE_HELPERS) {
        if (body.includes(helper)) offenders.push(`${entry.name}:${helper}`);
      }
    }
    // Non-vacuity: a guard that scanned the wrong directory would find nothing and
    // report a clean result. It must be able to SEE the modules it is judging.
    assert.ok(scanned.includes('br-receita-cnpj-snapshot-builder.ts'), 'wrong scan root');
    assert.ok(scanned.includes('br-receita-cnpj-snapshot-output-sanitizer.ts'), 'wrong scan root');
    assert.ok(scanned.length > 20, `expected the whole connector, scanned ${scanned.length}`);
    assert.deepEqual(offenders, [], 'a derivative helper is still reachable from production code');
  });

  it('the controlled-runner script calls no CNPJ derivative helper', () => {
    const script = path.resolve(
      CONNECTOR_ROOT,
      '../../../../../scripts/source-catalog/run-br-receita-cnpj-controlled-parser.ts',
    );
    const body = stripComments(fs.readFileSync(script, 'utf8'));
    for (const helper of DERIVATIVE_HELPERS) {
      assert.ok(!body.includes(helper), `the runner still calls ${helper}`);
    }
    assert.ok(!body.includes('valid_cnpj_hashes'), 'the runner still declares valid_cnpj_hashes');
    assert.ok(!body.includes('safe_identifier'), 'the runner still declares safe_identifier');
  });
});
