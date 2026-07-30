/**
 * BR Receita CNPJ full join OUTPUT SANITIZER — tests (BR-SOURCE-11A).
 *
 * Proves the sanitizer blocks every forbidden output shape and leaks nothing while
 * doing so:
 *   - full CNPJ (continuous and formatted), CPF (continuous and formatted),
 *     CNPJ básico / long digit runs;
 *   - email, phone, and LinkedIn markers;
 *   - `raw_row` / `raw_data` payloads, `record_identity_key`, `normalized_tax_id`,
 *     `cnpj_basico`, `cnpj`, `cpf` values, and identifier hashes;
 *   - oversized numeric leaves (identifier-scale numbers masquerading as counts);
 *   - a `*_printed: true` assertion, which is a DECLARED leak, not an exemption.
 *
 * It also proves the safe shapes pass: `YYYY-MM` periods, real periods, hito labels,
 * placeholders, small counters, and `*_printed: false` safety assertions.
 *
 * 100% synthetic. Every identifier-shaped token is assembled by CONCATENATION, so no
 * 8-/11-/14-digit literal and no e-mail marker literal exists in this source file.
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
