// Q3F-5BB.11K-FIX — Discard reason contract (pure) exhaustive tests.
//
// `composeDiscardReason` / `validateDiscardReason` are the single shared contract
// between the Prospectos inline panel (client) and the hardened server wrapper.
// They are pure, so every branch is asserted directly:
//   - composition parity with Route B (the legacy batch-detail dialog)
//   - length bounds (3 min, 500 max — 500 valid, 501 rejected)
//   - unknown/untrusted input never throws (null / undefined / number / object / array)
//   - the value returned on success is the NORMALIZED value callers must persist

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeDiscardReason,
  validateDiscardReason,
  DISCARD_REASONS,
  DISCARD_REASON_MIN_LENGTH,
  DISCARD_REASON_MAX_LENGTH,
} from '../discard-reason';

const OUT_OF_SEGMENT_LABEL = 'Fuera del segmento objetivo';

describe('discard reason — canonical bounds + catalog', () => {
  it('bounds a traceable reason to 3..500 characters', () => {
    assert.equal(DISCARD_REASON_MIN_LENGTH, 3);
    assert.equal(DISCARD_REASON_MAX_LENGTH, 500);
  });

  it('re-exports the shared reason catalog (never a second copy)', () => {
    assert.ok(Array.isArray(DISCARD_REASONS));
    assert.ok(DISCARD_REASONS.length > 0);
    assert.ok(DISCARD_REASONS.some((r) => r.value === 'other'));
    assert.equal(
      DISCARD_REASONS.find((r) => r.value === 'out_of_segment')?.label,
      OUT_OF_SEGMENT_LABEL,
    );
  });
});

describe('composeDiscardReason — Route B parity', () => {
  it('predefined reason without text → the label alone', () => {
    assert.equal(composeDiscardReason('out_of_segment', ''), OUT_OF_SEGMENT_LABEL);
  });

  it('predefined reason with text → "<label>: <text>"', () => {
    assert.equal(
      composeDiscardReason('out_of_segment', 'Sector no priorizado 2026'),
      `${OUT_OF_SEGMENT_LABEL}: Sector no priorizado 2026`,
    );
  });

  it('"other" with text → the free text alone (no label prefix)', () => {
    assert.equal(composeDiscardReason('other', 'Entidad pública sin presupuesto'), 'Entidad pública sin presupuesto');
  });

  it('"other" without text → empty string', () => {
    assert.equal(composeDiscardReason('other', ''), '');
  });

  it('no reason and no text → empty string', () => {
    assert.equal(composeDiscardReason('', ''), '');
  });

  it('trims the free text on both sides of the composition', () => {
    assert.equal(composeDiscardReason('other', '   Datos duplicados   '), 'Datos duplicados');
    assert.equal(
      composeDiscardReason('bad_data', '  falta NIT  '),
      'Datos incorrectos o incompletos: falta NIT',
    );
  });

  it('whitespace-only text behaves as no text for a predefined reason', () => {
    assert.equal(composeDiscardReason('out_of_segment', '   \n  '), OUT_OF_SEGMENT_LABEL);
  });

  it('composes exactly what the Route B dialog would compose (representative cases)', () => {
    // Mirror of candidate-row-actions.tsx handleDiscard():
    //   key && key !== 'other' → text ? `${label}: ${text}` : label
    //   else                   → text
    const cases: { key: 'out_of_segment' | 'other'; text: string }[] = [
      { key: 'out_of_segment', text: '' },
      { key: 'out_of_segment', text: 'nota' },
      { key: 'other', text: 'motivo libre' },
    ];
    for (const c of cases) {
      const label = DISCARD_REASONS.find((r) => r.value === c.key)!.label;
      const routeB =
        c.key !== 'other' ? (c.text.trim() ? `${label}: ${c.text.trim()}` : label) : c.text.trim();
      assert.equal(composeDiscardReason(c.key, c.text), routeB, `parity for ${c.key}/"${c.text}"`);
    }
  });
});

describe('validateDiscardReason — accepted values', () => {
  it('accepts a predefined label', () => {
    const r = validateDiscardReason(OUT_OF_SEGMENT_LABEL);
    assert.deepEqual(r, { ok: true, reason: OUT_OF_SEGMENT_LABEL });
  });

  it('accepts exactly the minimum length (3 characters)', () => {
    assert.deepEqual(validateDiscardReason('abc'), { ok: true, reason: 'abc' });
  });

  it('accepts exactly the maximum length (500 characters)', () => {
    const reason = 'a'.repeat(DISCARD_REASON_MAX_LENGTH);
    const r = validateDiscardReason(reason);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.reason.length, 500);
  });

  it('returns the TRIMMED value as the value to persist', () => {
    assert.deepEqual(validateDiscardReason('   Empresa disuelta   '), {
      ok: true,
      reason: 'Empresa disuelta',
    });
  });

  it('collapses runs of blank lines without rewriting the wording', () => {
    const r = validateDiscardReason('Motivo\n\n\n\ndetalle adicional');
    assert.deepEqual(r, { ok: true, reason: 'Motivo\n\ndetalle adicional' });
  });

  it('normalizes CRLF to LF', () => {
    assert.deepEqual(validateDiscardReason('Motivo\r\ndetalle'), {
      ok: true,
      reason: 'Motivo\ndetalle',
    });
  });
});

describe('validateDiscardReason — rejected values', () => {
  it('rejects an empty string as empty', () => {
    assert.deepEqual(validateDiscardReason(''), { ok: false, code: 'empty' });
  });

  it('rejects whitespace-only input as empty', () => {
    assert.deepEqual(validateDiscardReason('   \n\t  '), { ok: false, code: 'empty' });
  });

  it('rejects a two-character reason as too_short', () => {
    assert.deepEqual(validateDiscardReason('ab'), { ok: false, code: 'too_short' });
  });

  it('rejects 501 characters as too_long', () => {
    assert.deepEqual(validateDiscardReason('a'.repeat(DISCARD_REASON_MAX_LENGTH + 1)), {
      ok: false,
      code: 'too_long',
    });
  });
});

describe('validateDiscardReason — untrusted input never throws', () => {
  const NON_STRINGS: unknown[] = [
    null,
    undefined,
    0,
    42,
    Number.NaN,
    true,
    {},
    { reason: 'x' },
    [],
    ['motivo'],
    Symbol('motivo'),
    () => 'motivo',
  ];

  for (const raw of NON_STRINGS) {
    it(`rejects ${typeof raw} (${String(typeof raw === 'symbol' ? 'symbol' : raw)}) as empty without throwing`, () => {
      assert.doesNotThrow(() => validateDiscardReason(raw));
      assert.deepEqual(validateDiscardReason(raw), { ok: false, code: 'empty' });
    });
  }
});

describe('compose + validate — end-to-end gating used by the UI and the server', () => {
  it('a predefined selection alone is enough to pass validation', () => {
    const composed = composeDiscardReason('inactive_or_dissolved', '');
    assert.equal(validateDiscardReason(composed).ok, true);
  });

  it('"other" without free text can never pass validation', () => {
    const composed = composeDiscardReason('other', '');
    assert.deepEqual(validateDiscardReason(composed), { ok: false, code: 'empty' });
  });

  it('"other" with a too-short free text can never pass validation', () => {
    assert.deepEqual(validateDiscardReason(composeDiscardReason('other', 'no')), {
      ok: false,
      code: 'too_short',
    });
  });

  it('nothing selected and nothing typed can never pass validation', () => {
    assert.deepEqual(validateDiscardReason(composeDiscardReason('', '')), {
      ok: false,
      code: 'empty',
    });
  });
});
