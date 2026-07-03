/**
 * Tests — comprasal-sv-source-company-signal-adapter
 *
 * Valida:
 * 1. Mapeo correcto de campos fijos (source_key, country_code, signal_kind, etc.)
 * 2. Normalización de nombre comercial.
 * 3. supplier_platform_id como ID externo, no fiscal.
 * 4. Ausencia de campos fiscales prohibidos en el output.
 * 5. Descarte si falta supplier_name o normalized_supplier_name.
 * 6. Señales procurement incluidas en signals.
 *
 * Hito: Centroamérica.7E.2A
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptComprasalSignal,
  adaptComprasalSignals,
} from '../comprasal-sv-source-company-signal-adapter';
import type { ComprasalProcurementSignal } from '../comprasal-sv-signal-builder';

const SOURCE_YEAR = 2026;

const PROHIBITED_FISCAL_FIELDS = [
  'tax_id',
  'normalized_tax_id',
  'taxIdentifier',
  'tax_identifier',
  'nit',
  'nrc',
  'ruc',
  'rut',
  'rnc',
];

function makeSignal(overrides: Partial<ComprasalProcurementSignal> = {}): ComprasalProcurementSignal {
  return {
    source_key: 'sv_comprasal',
    country_code: 'SV',
    source_type: 'procurement_signal',
    signal_strength: 'weak_name_only',
    matching_mode: 'name_only_review_required',
    supplier_name: 'Ingeniería Eléctrica y Civil, S.A. de C.V.',
    supplier_commercial_name: 'INELCI S.A. DE C.V.',
    supplier_platform_id: '186',
    normalized_supplier_name: 'ingenieria electrica y civil sa de cv',
    tax_id: null,
    normalized_tax_id: null,
    awards_count: 3,
    total_awarded_amount: 50000,
    latest_award_date: '2026-06-15',
    sample_awards: [
      {
        award_id: '455089',
        process_code: '2400-2026-P0327',
        process_name: 'Adquisición de materiales eléctricos',
        institution_name: 'Ministerio de Obras Públicas',
        amount: 10960,
        award_date: '2026-06-15',
      },
    ],
    limitations: [
      'No fiscal identifier exposed publicly',
      'Name-only signal requires human review',
      'No NIT/NRC available in COMPRASAL public endpoints',
    ],
    ...overrides,
  };
}

describe('adaptComprasalSignal — campos fijos de guardrail', () => {
  it('source_key = sv_comprasal', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.source_key, 'sv_comprasal');
  });

  it('country_code = SV', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.country_code, 'SV');
  });

  it('signal_kind = procurement', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.signal_kind, 'procurement');
  });

  it('signal_strength = weak_name_only', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.signal_strength, 'weak_name_only');
  });

  it('matching_mode = name_only_review_required', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.matching_mode, 'name_only_review_required');
  });

  it('human_review_required = true', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.human_review_required, true);
  });

  it('source_year toma el valor pasado', () => {
    const result = adaptComprasalSignal(makeSignal(), 2025);
    assert.ok(result.ok);
    assert.equal(result.signal.source_year, 2025);
  });
});

describe('adaptComprasalSignal — mapeo de nombres', () => {
  it('preserva supplier_name sin modificar', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.supplier_name, 'Ingeniería Eléctrica y Civil, S.A. de C.V.');
  });

  it('preserva normalized_supplier_name sin modificar', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.normalized_supplier_name, 'ingenieria electrica y civil sa de cv');
  });

  it('preserva supplier_commercial_name cuando existe', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.supplier_commercial_name, 'INELCI S.A. DE C.V.');
  });

  it('supplier_commercial_name = null cuando no existe', () => {
    const result = adaptComprasalSignal(makeSignal({ supplier_commercial_name: null }), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.supplier_commercial_name, null);
  });
});

describe('adaptComprasalSignal — supplier_platform_id como ID externo no fiscal', () => {
  it('preserva supplier_platform_id como string', () => {
    const result = adaptComprasalSignal(makeSignal({ supplier_platform_id: '186' }), SOURCE_YEAR);
    assert.ok(result.ok);
    assert.equal(result.signal.supplier_platform_id, '186');
  });

  it('supplier_platform_id no genera campos fiscales', () => {
    const result = adaptComprasalSignal(makeSignal({ supplier_platform_id: '999' }), SOURCE_YEAR);
    assert.ok(result.ok);
    const signalAsRecord = result.signal as Record<string, unknown>;
    for (const field of PROHIBITED_FISCAL_FIELDS) {
      assert.ok(
        !(field in signalAsRecord) || signalAsRecord[field] === undefined,
        `campo fiscal prohibido encontrado: ${field}`,
      );
    }
  });
});

describe('adaptComprasalSignal — ausencia de campos fiscales prohibidos', () => {
  for (const field of PROHIBITED_FISCAL_FIELDS) {
    it(`no produce campo ${field}`, () => {
      const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
      assert.ok(result.ok);
      const signalAsRecord = result.signal as Record<string, unknown>;
      assert.ok(
        !(field in signalAsRecord) || signalAsRecord[field] === undefined,
        `campo fiscal prohibido encontrado: ${field}`,
      );
    });
  }
});

describe('adaptComprasalSignal — descarte por campos requeridos faltantes', () => {
  it('descarta si supplier_name está vacío', () => {
    const result = adaptComprasalSignal(makeSignal({ supplier_name: '' }), SOURCE_YEAR);
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason.includes('supplier_name'));
  });

  it('descarta si normalized_supplier_name está vacío', () => {
    const result = adaptComprasalSignal(
      makeSignal({ normalized_supplier_name: '' }),
      SOURCE_YEAR,
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason.includes('normalized_supplier_name'));
  });

  it('retorna la señal de entrada en caso de error', () => {
    const input = makeSignal({ supplier_name: '' });
    const result = adaptComprasalSignal(input, SOURCE_YEAR);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.input, input);
    }
  });
});

describe('adaptComprasalSignal — señales procurement en signals', () => {
  it('incluye total_awarded_amount en signals', () => {
    const result = adaptComprasalSignal(makeSignal({ total_awarded_amount: 99999 }), SOURCE_YEAR);
    assert.ok(result.ok);
    const s = result.signal.signals as Record<string, unknown>;
    assert.equal(s['total_awarded_amount'], 99999);
  });

  it('incluye awards_count en signals', () => {
    const result = adaptComprasalSignal(makeSignal({ awards_count: 7 }), SOURCE_YEAR);
    assert.ok(result.ok);
    const s = result.signal.signals as Record<string, unknown>;
    assert.equal(s['awards_count'], 7);
  });

  it('incluye latest_award_date en signals', () => {
    const result = adaptComprasalSignal(makeSignal({ latest_award_date: '2026-03-01' }), SOURCE_YEAR);
    assert.ok(result.ok);
    const s = result.signal.signals as Record<string, unknown>;
    assert.equal(s['latest_award_date'], '2026-03-01');
  });

  it('incluye sample_awards en signals', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    const s = result.signal.signals as Record<string, unknown>;
    assert.ok(Array.isArray(s['sample_awards']));
  });

  it('incluye limitations en signals', () => {
    const result = adaptComprasalSignal(makeSignal(), SOURCE_YEAR);
    assert.ok(result.ok);
    const s = result.signal.signals as Record<string, unknown>;
    assert.ok(Array.isArray(s['limitations']));
  });
});

describe('adaptComprasalSignals — batch', () => {
  it('adapta múltiples señales válidas', () => {
    const signals = [makeSignal(), makeSignal({ supplier_name: 'Empresa Beta S.A.', normalized_supplier_name: 'empresa beta sa' })];
    const { adapted, skipped } = adaptComprasalSignals(signals, SOURCE_YEAR);
    assert.equal(adapted.length, 2);
    assert.equal(skipped.length, 0);
  });

  it('descarta señales inválidas y reporta razón', () => {
    const signals = [
      makeSignal(),
      makeSignal({ supplier_name: '' }),
    ];
    const { adapted, skipped } = adaptComprasalSignals(signals, SOURCE_YEAR);
    assert.equal(adapted.length, 1);
    assert.equal(skipped.length, 1);
    assert.ok(skipped[0]!.reason.includes('supplier_name'));
  });
});
