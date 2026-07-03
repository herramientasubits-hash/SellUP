/**
 * Tests de helpers y tipos de source-company-signals.ts
 *
 * Valida:
 * 1. buildSourceCompanySignalDedupeKey — concatenación correcta y guardrails.
 * 2. validateSourceCompanySignal — guardrails de revisión humana y valores.
 * 3. Constantes exportadas — integridad de valores permitidos.
 *
 * Hito: Centroamérica.7E.1
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSourceCompanySignalDedupeKey,
  validateSourceCompanySignal,
  SOURCE_COMPANY_SIGNAL_KINDS,
  SOURCE_COMPANY_SIGNAL_STRENGTHS,
  SOURCE_COMPANY_SIGNAL_MATCHING_MODES,
  type SourceCompanySignal,
} from '../source-company-signals';

// -------------------------------------------------------
// Fixture base válida
// -------------------------------------------------------

function makeValidSignal(overrides: Partial<SourceCompanySignal> = {}): SourceCompanySignal {
  return {
    source_key: 'sv_comprasal',
    country_code: 'SV',
    source_year: 2026,
    signal_kind: 'procurement',
    signal_strength: 'weak_name_only',
    matching_mode: 'name_only_review_required',
    human_review_required: true,
    supplier_name: 'Empresa Ejemplo S.A. de C.V.',
    normalized_supplier_name: 'empresa ejemplo sa de cv',
    supplier_commercial_name: null,
    normalized_supplier_commercial_name: null,
    supplier_platform_id: 'proveedor-42',
    source_record_id: null,
    source_url: null,
    signals: {},
    raw_data: {},
    metadata: {},
    first_seen_at: null,
    last_seen_at: null,
    ...overrides,
  };
}

// -------------------------------------------------------
// Tests de buildSourceCompanySignalDedupeKey
// -------------------------------------------------------

describe('buildSourceCompanySignalDedupeKey', () => {
  it('genera la clave correcta con todos los campos', () => {
    const key = buildSourceCompanySignalDedupeKey({
      sourceKey: 'sv_comprasal',
      countryCode: 'SV',
      sourceYear: 2026,
      normalizedSupplierName: 'empresa ejemplo sa de cv',
    });
    assert.equal(key, 'sv_comprasal::SV::2026::empresa ejemplo sa de cv');
  });

  it('trim del nombre normalizado', () => {
    const key = buildSourceCompanySignalDedupeKey({
      sourceKey: 'sv_comprasal',
      countryCode: 'SV',
      sourceYear: 2026,
      normalizedSupplierName: '  empresa ejemplo  ',
    });
    assert.equal(key, 'sv_comprasal::SV::2026::empresa ejemplo');
  });

  it('lanza error cuando normalizedSupplierName está vacío', () => {
    assert.throws(
      () =>
        buildSourceCompanySignalDedupeKey({
          sourceKey: 'sv_comprasal',
          countryCode: 'SV',
          sourceYear: 2026,
          normalizedSupplierName: '',
        }),
      /normalizedSupplierName must not be empty/,
    );
  });

  it('lanza error cuando normalizedSupplierName es solo espacios', () => {
    assert.throws(
      () =>
        buildSourceCompanySignalDedupeKey({
          sourceKey: 'sv_comprasal',
          countryCode: 'SV',
          sourceYear: 2026,
          normalizedSupplierName: '   ',
        }),
      /normalizedSupplierName must not be empty/,
    );
  });

  it('lanza error cuando sourceKey está vacío', () => {
    assert.throws(
      () =>
        buildSourceCompanySignalDedupeKey({
          sourceKey: '',
          countryCode: 'SV',
          sourceYear: 2026,
          normalizedSupplierName: 'nombre',
        }),
      /sourceKey and countryCode must not be empty/,
    );
  });

  it('no usa tax_id en la clave (no hay campo fiscal en la firma)', () => {
    // Verificar que la función solo recibe los 4 campos sin tax_id
    const key = buildSourceCompanySignalDedupeKey({
      sourceKey: 'sv_comprasal',
      countryCode: 'SV',
      sourceYear: 2026,
      normalizedSupplierName: 'empresa',
    });
    assert.ok(!key.includes('tax_id'), 'La clave de dedupe no debe contener tax_id');
    assert.ok(!key.includes('nit'), 'La clave de dedupe no debe contener nit');
    assert.ok(!key.includes('nrc'), 'La clave de dedupe no debe contener nrc');
  });
});

// -------------------------------------------------------
// Tests de validateSourceCompanySignal
// -------------------------------------------------------

describe('validateSourceCompanySignal', () => {
  it('señal válida no produce errores', () => {
    const errors = validateSourceCompanySignal(makeValidSignal());
    assert.deepEqual(errors, []);
  });

  it('falla si normalized_supplier_name está vacío', () => {
    const errors = validateSourceCompanySignal(
      makeValidSignal({ normalized_supplier_name: '' }),
    );
    assert.ok(errors.some((e) => e.includes('normalized_supplier_name')));
  });

  it('falla si matching_mode es name_only_review_required con human_review_required = false', () => {
    const errors = validateSourceCompanySignal(
      makeValidSignal({
        matching_mode: 'name_only_review_required',
        human_review_required: false,
      }),
    );
    assert.ok(errors.some((e) => e.includes('human_review_required')));
  });

  it('falla si signal_strength es weak_name_only con human_review_required = false', () => {
    const errors = validateSourceCompanySignal(
      makeValidSignal({
        signal_strength: 'weak_name_only',
        matching_mode: 'identifier_match_allowed',
        human_review_required: false,
      }),
    );
    assert.ok(errors.some((e) => e.includes('human_review_required')));
  });

  it('acepta identifier_match_allowed con human_review_required = false cuando strength no es weak', () => {
    const errors = validateSourceCompanySignal(
      makeValidSignal({
        signal_strength: 'strong_identifier',
        matching_mode: 'identifier_match_allowed',
        human_review_required: false,
      }),
    );
    assert.deepEqual(errors, []);
  });

  it('falla con signal_kind inválido', () => {
    const errors = validateSourceCompanySignal(
      makeValidSignal({ signal_kind: 'tax_registry' as never }),
    );
    assert.ok(errors.some((e) => e.includes('signal_kind')));
  });

  it('falla con signal_strength inválido', () => {
    const errors = validateSourceCompanySignal(
      makeValidSignal({ signal_strength: 'fiscal_verified' as never }),
    );
    assert.ok(errors.some((e) => e.includes('signal_strength')));
  });

  it('falla con matching_mode inválido', () => {
    const errors = validateSourceCompanySignal(
      makeValidSignal({ matching_mode: 'auto_match' as never }),
    );
    assert.ok(errors.some((e) => e.includes('matching_mode')));
  });
});

// -------------------------------------------------------
// Tests de constantes
// -------------------------------------------------------

describe('Constantes exportadas', () => {
  it('SOURCE_COMPANY_SIGNAL_KINDS incluye procurement', () => {
    assert.ok(SOURCE_COMPANY_SIGNAL_KINDS.includes('procurement'));
  });

  it('SOURCE_COMPANY_SIGNAL_KINDS no incluye valores fiscales', () => {
    const fiscalTerms = ['tax_registry', 'fiscal', 'legal_entity', 'rut', 'nit'];
    for (const term of fiscalTerms) {
      assert.ok(
        !SOURCE_COMPANY_SIGNAL_KINDS.includes(term as never),
        `signal_kinds no debe incluir término fiscal: ${term}`,
      );
    }
  });

  it('SOURCE_COMPANY_SIGNAL_STRENGTHS incluye weak_name_only', () => {
    assert.ok(SOURCE_COMPANY_SIGNAL_STRENGTHS.includes('weak_name_only'));
  });

  it('SOURCE_COMPANY_SIGNAL_STRENGTHS incluye strong_identifier', () => {
    assert.ok(SOURCE_COMPANY_SIGNAL_STRENGTHS.includes('strong_identifier'));
  });

  it('SOURCE_COMPANY_SIGNAL_MATCHING_MODES incluye name_only_review_required', () => {
    assert.ok(SOURCE_COMPANY_SIGNAL_MATCHING_MODES.includes('name_only_review_required'));
  });

  it('SOURCE_COMPANY_SIGNAL_MATCHING_MODES no incluye auto_match ni post_approval', () => {
    assert.ok(!SOURCE_COMPANY_SIGNAL_MATCHING_MODES.includes('auto_match' as never));
    assert.ok(!SOURCE_COMPANY_SIGNAL_MATCHING_MODES.includes('post_approval' as never));
  });
});
