/**
 * Tests — source-company-signals-writer
 *
 * Valida:
 * 1. dry-run no llama métodos write de Supabase.
 * 2. Cuenta señales válidas e inválidas.
 * 3. Rechaza señales sv_comprasal con human_review_required=false.
 * 4. Rechaza señales sv_comprasal con matching_mode distinto.
 * 5. Rechaza señales sv_comprasal con signal_strength distinto.
 * 6. Rechaza señales con campos fiscales prohibidos en top-level.
 * 7. dry-run retorna insertedOrUpdated=0.
 *
 * Hito: Centroamérica.7E.2A
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { upsertSourceCompanySignals } from '../source-company-signals-writer';
import type { SourceCompanySignal } from '../source-company-signals';

// -------------------------------------------------------
// Supabase mock — verifica que no se llamen writes en dry-run
// -------------------------------------------------------

function makeMockSupabase() {
  const calls: string[] = [];

  const supabase = {
    from: (_table: string) => ({
      upsert: (..._args: unknown[]) => {
        calls.push('upsert');
        return Promise.resolve({ error: null });
      },
      insert: (..._args: unknown[]) => {
        calls.push('insert');
        return Promise.resolve({ error: null });
      },
      update: (..._args: unknown[]) => {
        calls.push('update');
        return Promise.resolve({ error: null });
      },
      delete: (..._args: unknown[]) => {
        calls.push('delete');
        return Promise.resolve({ error: null });
      },
    }),
    _getCalls: () => calls,
  };

  return supabase as unknown as Parameters<typeof upsertSourceCompanySignals>[0]['supabase'] & {
    _getCalls: () => string[];
  };
}

// -------------------------------------------------------
// Fixture válida
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
    supplier_platform_id: '42',
    source_record_id: null,
    source_url: null,
    signals: { total_awarded_amount: 10000, awards_count: 2 },
    raw_data: {},
    metadata: {},
    first_seen_at: null,
    last_seen_at: null,
    ...overrides,
  };
}

// -------------------------------------------------------
// Tests dry-run
// -------------------------------------------------------

describe('upsertSourceCompanySignals — dry-run no escribe', () => {
  it('no llama upsert/insert/update/delete en dry-run', async () => {
    const supabase = makeMockSupabase();
    await upsertSourceCompanySignals({
      supabase,
      signals: [makeValidSignal()],
      dryRun: true,
    });
    assert.deepEqual(supabase._getCalls(), []);
  });

  it('retorna insertedOrUpdated=0 en dry-run', async () => {
    const supabase = makeMockSupabase();
    const result = await upsertSourceCompanySignals({
      supabase,
      signals: [makeValidSignal()],
      dryRun: true,
    });
    assert.equal(result.insertedOrUpdated, 0);
  });

  it('retorna dryRun=true', async () => {
    const supabase = makeMockSupabase();
    const result = await upsertSourceCompanySignals({
      supabase,
      signals: [makeValidSignal()],
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
  });

  it('cuenta señales válidas correctamente', async () => {
    const supabase = makeMockSupabase();
    const result = await upsertSourceCompanySignals({
      supabase,
      signals: [makeValidSignal(), makeValidSignal({ normalized_supplier_name: 'empresa beta' })],
      dryRun: true,
    });
    assert.equal(result.valid, 2);
    assert.equal(result.invalid, 0);
  });

  it('lista vacía retorna 0 en todo', async () => {
    const supabase = makeMockSupabase();
    const result = await upsertSourceCompanySignals({
      supabase,
      signals: [],
      dryRun: true,
    });
    assert.equal(result.attempted, 0);
    assert.equal(result.valid, 0);
    assert.equal(result.invalid, 0);
    assert.equal(result.insertedOrUpdated, 0);
  });
});

// -------------------------------------------------------
// Tests guardrails sv_comprasal
// -------------------------------------------------------

describe('upsertSourceCompanySignals — guardrails sv_comprasal', () => {
  it('rechaza señal sv_comprasal con human_review_required=false', async () => {
    const supabase = makeMockSupabase();
    const result = await upsertSourceCompanySignals({
      supabase,
      signals: [makeValidSignal({ human_review_required: false })],
      dryRun: true,
    });
    assert.equal(result.invalid, 1);
    assert.equal(result.valid, 0);
    assert.ok(result.errors[0]!.reason.includes('human_review_required'));
  });

  it('rechaza señal sv_comprasal con matching_mode distinto', async () => {
    const supabase = makeMockSupabase();
    const result = await upsertSourceCompanySignals({
      supabase,
      signals: [makeValidSignal({ matching_mode: 'identifier_match_allowed' })],
      dryRun: true,
    });
    assert.equal(result.invalid, 1);
    assert.ok(result.errors[0]!.reason.includes('matching_mode'));
  });

  it('rechaza señal sv_comprasal con signal_strength distinto', async () => {
    const supabase = makeMockSupabase();
    const result = await upsertSourceCompanySignals({
      supabase,
      signals: [makeValidSignal({ signal_strength: 'strong_identifier' })],
      dryRun: true,
    });
    assert.equal(result.invalid, 1);
    assert.ok(result.errors[0]!.reason.includes('signal_strength'));
  });
});

// -------------------------------------------------------
// Tests campos fiscales prohibidos
// -------------------------------------------------------

describe('upsertSourceCompanySignals — campos fiscales prohibidos en top-level', () => {
  const PROHIBITED = ['tax_id', 'normalized_tax_id', 'taxIdentifier', 'nit', 'nrc', 'ruc', 'rut', 'rnc'];

  for (const field of PROHIBITED) {
    it(`rechaza señal con campo fiscal ${field} en top-level`, async () => {
      const supabase = makeMockSupabase();
      const signal = { ...makeValidSignal(), [field]: 'some-value' } as SourceCompanySignal;
      const result = await upsertSourceCompanySignals({
        supabase,
        signals: [signal],
        dryRun: true,
      });
      assert.equal(result.invalid, 1);
      assert.ok(
        result.errors[0]!.reason.includes(field),
        `error debería mencionar el campo ${field}, got: ${result.errors[0]!.reason}`,
      );
    });
  }
});

// -------------------------------------------------------
// Tests mezcla válidas e inválidas
// -------------------------------------------------------

describe('upsertSourceCompanySignals — mezcla válidas e inválidas', () => {
  it('cuenta correctamente con mezcla de señales', async () => {
    const supabase = makeMockSupabase();
    const result = await upsertSourceCompanySignals({
      supabase,
      signals: [
        makeValidSignal(),
        makeValidSignal({ human_review_required: false }),
        makeValidSignal({ normalized_supplier_name: 'empresa gamma' }),
      ],
      dryRun: true,
    });
    assert.equal(result.attempted, 3);
    assert.equal(result.valid, 2);
    assert.equal(result.invalid, 1);
    assert.equal(result.insertedOrUpdated, 0);
  });
});
