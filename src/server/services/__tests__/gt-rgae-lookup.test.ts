/**
 * Tests — gt-rgae-lookup.ts — Catálogo.GT.2C
 *
 * Verifica:
 * - Normalización de NIT (válido, inválido, longitud, no numérico, null)
 * - Query scope: source_key fijo, country_code fijo
 * - Año explícito usa eq source_year; sin año usa order DESC + limit 2
 * - Found: fixture completo → found=true + campos correctos
 * - Found: guardrails + provenance + sin raw_data en el contrato público
 * - Not found: sin filas → found=false, reason='not_found'
 * - Query error → found=false, reason='query_error', sin error raw al caller
 * - Guardrail violation: uno por cada uno de los 10 invariantes
 * - Duplicate same-year anomaly → snapshot_guardrail_violation
 * - masked NIT no expone el NIT completo
 * - supplierName no se presenta como legal verified (contrato de campo)
 * - economicCapacity parsing (numeric, not_applicable, direct_purchase, unparsed, malformed)
 * - Environment: falta service role → found=false, reason='environment_unavailable'
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lookupGtRgaeByNit } from '../gt-rgae-lookup';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockOptions {
  rows?: Record<string, unknown>[] | null;
  error?: { message: string } | null;
  captureEqs?: string[];
  captureYearMode?: { yearEqCalled: boolean; orderCalled: boolean };
}

function makeMock(opts: MockOptions = {}) {
  const rows = opts.rows !== undefined ? opts.rows : [];
  const error = opts.error ?? null;

  const chain: Record<string, unknown> = {};
  chain['from'] = () => chain;
  chain['select'] = () => chain;
  chain['eq'] = (field: string, val: unknown) => {
    if (opts.captureEqs) {
      opts.captureEqs.push(String(val));
    }
    if (opts.captureYearMode && field === 'source_year') {
      opts.captureYearMode.yearEqCalled = true;
    }
    return chain;
  };
  chain['order'] = () => {
    if (opts.captureYearMode) {
      opts.captureYearMode.orderCalled = true;
    }
    return chain;
  };
  chain['limit'] = () => chain;
  // The real Supabase query builder is thenable — awaiting it directly
  // resolves { data, error } without an explicit terminal call.
  chain['then'] = (
    resolve: (value: { data: Record<string, unknown>[] | null; error: unknown }) => void,
  ) => {
    resolve({ data: rows, error });
  };
  return chain as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const VALID_RAW_DATA = {
  source_type: 'government_supplier_registry',
  tax_identifier_type: 'NIT',
  supplier_type: 'Sociedades',
  tax_validation_status: 'not_applicable',
  legal_validation_status: 'not_applicable',
  human_review_required: true,
  post_approval_enabled: false,
  matching_automatic_enabled: false,
  account_creation_enabled: false,
  canonical_name_overwrite_enabled: false,
  economic_capacity: { kind: 'numeric', amount: 150000, raw: 'Q150,000.00' },
};

const SAMPLE_NIT = '1234567';
const SAMPLE_ROW: Record<string, unknown> = {
  source_year: 2025,
  legal_name: 'EMPRESA GUATEMALTECA SOCIEDAD ANONIMA',
  normalized_tax_id: SAMPLE_NIT,
  raw_data: VALID_RAW_DATA,
};

// ── Normalización NIT ─────────────────────────────────────────────────────────

describe('normalización NIT — válido', () => {
  it('acepta NIT numérico dentro de rango', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
  });
});

describe('normalización NIT — null', () => {
  it('retorna found=false reason=invalid_nit para null', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: null }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_nit');
  });
});

describe('normalización NIT — empty string', () => {
  it('retorna found=false reason=invalid_nit para empty string', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: '' }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_nit');
  });
});

describe('normalización NIT — no numérico', () => {
  it('retorna found=false reason=invalid_nit cuando hay letras', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: '12A4567' }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_nit');
  });
});

describe('normalización NIT — demasiado corto', () => {
  it('retorna found=false reason=invalid_nit para menos de 5 dígitos', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: '123' }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_nit');
  });
});

describe('normalización NIT — demasiado largo', () => {
  it('retorna found=false reason=invalid_nit para más de 10 dígitos', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: '12345678901' }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_nit');
  });
});

describe('normalización NIT — internamente derivada, no confía en el caller', () => {
  it('busca el NIT normalizado internamente, no un valor arbitrario pasado', async () => {
    const captured: string[] = [];
    const sb = makeMock({ rows: [SAMPLE_ROW], captureEqs: captured });
    await lookupGtRgaeByNit({ nit: ' 1234567 ' }, sb);
    assert.ok(captured.includes(SAMPLE_NIT), `debe buscar ${SAMPLE_NIT} normalizado`);
  });
});

// ── Query scope ───────────────────────────────────────────────────────────────

describe('query scope — source_key y country_code fijos', () => {
  it('busca source_key=gt_rgae_proveedores y country_code=GT', async () => {
    const captured: string[] = [];
    const sb = makeMock({ rows: [SAMPLE_ROW], captureEqs: captured });
    await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.ok(captured.includes('gt_rgae_proveedores'), 'debe usar source_key=gt_rgae_proveedores');
    assert.ok(captured.includes('GT'), 'debe usar country_code=GT');
  });
});

// ── Año explícito vs implícito ─────────────────────────────────────────────────

describe('año explícito — usa eq source_year', () => {
  it('cuando se pasa sourceYear usa eq en lugar de order', async () => {
    const yearMode = { yearEqCalled: false, orderCalled: false };
    const sb = makeMock({ rows: [SAMPLE_ROW], captureYearMode: yearMode });
    await lookupGtRgaeByNit({ nit: SAMPLE_NIT, sourceYear: 2025 }, sb);
    assert.equal(yearMode.yearEqCalled, true, 'debe usar eq source_year');
    assert.equal(yearMode.orderCalled, false, 'no debe usar order cuando hay sourceYear');
  });
});

describe('sin año — usa order DESC + limit', () => {
  it('cuando no se pasa sourceYear usa order y no eq en source_year', async () => {
    const yearMode = { yearEqCalled: false, orderCalled: false };
    const sb = makeMock({ rows: [SAMPLE_ROW], captureYearMode: yearMode });
    await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(yearMode.orderCalled, true, 'debe usar order');
    assert.equal(yearMode.yearEqCalled, false, 'no debe usar eq source_year cuando no hay sourceYear');
  });
});

// ── Found — fixture completo ──────────────────────────────────────────────────

describe('found — fixture completo', () => {
  it('retorna found=true con todos los campos correctos', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.sourceYear, 2025);
    assert.equal(r.supplierName, 'EMPRESA GUATEMALTECA SOCIEDAD ANONIMA');
    assert.equal(r.normalizedNit, SAMPLE_NIT);
    assert.equal(typeof r.maskedNit, 'string');
    assert.ok(r.maskedNit.length > 0);
    assert.equal(r.reason, null);
  });

  it('expone los guardrails semánticos explícitamente', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.sourceKey, 'gt_rgae_proveedores');
    assert.equal(r.countryCode, 'GT');
    assert.equal(r.sourceType, 'government_supplier_registry');
    assert.equal(r.supplierType, 'Sociedades');
    assert.equal(r.taxValidationStatus, 'not_applicable');
    assert.equal(r.legalValidationStatus, 'not_applicable');
    assert.equal(r.humanReviewRequired, true);
    assert.equal(r.postApprovalEnabled, false);
    assert.equal(r.matchingAutomaticEnabled, false);
    assert.equal(r.accountCreationEnabled, false);
    assert.equal(r.canonicalNameOverwriteEnabled, false);
  });

  it('expone provenance explícita construida desde literales validados', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.provenance.source_key, 'gt_rgae_proveedores');
    assert.equal(r.provenance.country_code, 'GT');
    assert.equal(r.provenance.source_year, 2025);
  });

  it('NO expone raw_data en el resultado público found=true', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal('raw_data' in r, false, 'raw_data no debe ser parte del contrato público');
  });

  it('masked NIT NO contiene el NIT completo', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.notEqual(r.maskedNit, SAMPLE_NIT);
  });

  it('supplierName no se etiqueta como nombre legal verificado', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    // Field name contract: no debe existir un campo con semántica de "verified".
    assert.equal('legalNameVerified' in r, false);
    assert.equal('verifiedLegalName' in r, false);
    assert.equal('canonicalLegalName' in r, false);
    assert.equal(r.legalValidationStatus, 'not_applicable');
  });
});

// ── Not found ─────────────────────────────────────────────────────────────────

describe('not found — sin filas', () => {
  it('retorna found=false reason=not_found cuando no hay fila', async () => {
    const sb = makeMock({ rows: [] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'not_found');
    if (r.found) return;
    assert.equal(r.normalizedNit, SAMPLE_NIT);
  });
});

// ── Query error ───────────────────────────────────────────────────────────────

describe('query error', () => {
  it('retorna found=false reason=query_error sin propagar error raw', async () => {
    const sb = makeMock({ rows: null, error: { message: 'DB error internal' } });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'query_error');
    const resultStr = JSON.stringify(r);
    assert.ok(!resultStr.includes('DB error internal'), 'error raw no debe propagarse al caller');
  });
});

// ── Guardrail violations ──────────────────────────────────────────────────────

function makeRowWithRawData(rawDataOverride: Record<string, unknown>): Record<string, unknown> {
  return {
    ...SAMPLE_ROW,
    raw_data: { ...VALID_RAW_DATA, ...rawDataOverride },
  };
}

const guardrailCases: Array<[string, Record<string, unknown>]> = [
  ['source_type incorrecto', { source_type: 'procurement_signal' }],
  ['tax_identifier_type incorrecto', { tax_identifier_type: 'RTN' }],
  ['supplier_type incorrecto', { supplier_type: 'Persona Individual' }],
  ['tax_validation_status incorrecto', { tax_validation_status: 'validated' }],
  ['legal_validation_status incorrecto', { legal_validation_status: 'validated' }],
  ['human_review_required incorrecto', { human_review_required: false }],
  ['post_approval_enabled incorrecto', { post_approval_enabled: true }],
  ['matching_automatic_enabled incorrecto', { matching_automatic_enabled: true }],
  ['account_creation_enabled incorrecto', { account_creation_enabled: true }],
  ['canonical_name_overwrite_enabled incorrecto', { canonical_name_overwrite_enabled: true }],
];

for (const [label, override] of guardrailCases) {
  describe(`guardrail — ${label}`, () => {
    it('retorna found=false reason=snapshot_guardrail_violation', async () => {
      const sb = makeMock({ rows: [makeRowWithRawData(override)] });
      const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
      assert.equal(r.found, false);
      assert.equal(r.reason, 'snapshot_guardrail_violation');
    });
  });
}

// ── Duplicate same-year anomaly ──────────────────────────────────────────────

describe('cardinalidad — duplicate same-year rows', () => {
  it('retorna snapshot_guardrail_violation cuando hay 2 filas del mismo source_year', async () => {
    const rowA = { ...SAMPLE_ROW };
    const rowB = { ...SAMPLE_ROW };
    const sb = makeMock({ rows: [rowA, rowB] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
    if (r.found) return;
    assert.equal(r.guardrailField, 'duplicate_same_year_row');
  });

  it('usa la fila del source_year mayor cuando hay filas de años distintos', async () => {
    const rowOld = { ...SAMPLE_ROW, source_year: 2024 };
    const rowNew = { ...SAMPLE_ROW, source_year: 2025 };
    const sb = makeMock({ rows: [rowNew, rowOld] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.sourceYear, 2025);
  });
});

// ── Economic capacity ─────────────────────────────────────────────────────────

describe('economic capacity — numeric', () => {
  it('retorna kind=numeric con amount y raw', async () => {
    const sb = makeMock({ rows: [SAMPLE_ROW] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.deepEqual(r.economicCapacity, { kind: 'numeric', amount: 150000, raw: 'Q150,000.00' });
  });
});

describe('economic capacity — not_applicable', () => {
  it('retorna kind=not_applicable con amount=null', async () => {
    const row = makeRowWithRawData({ economic_capacity: { kind: 'not_applicable', amount: null, raw: 'N/A' } });
    const sb = makeMock({ rows: [row] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.deepEqual(r.economicCapacity, { kind: 'not_applicable', amount: null, raw: 'N/A' });
  });
});

describe('economic capacity — direct_purchase', () => {
  it('retorna kind=direct_purchase con amount=null', async () => {
    const row = makeRowWithRawData({
      economic_capacity: { kind: 'direct_purchase', amount: null, raw: 'Compra Directa' },
    });
    const sb = makeMock({ rows: [row] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.deepEqual(r.economicCapacity, { kind: 'direct_purchase', amount: null, raw: 'Compra Directa' });
  });
});

describe('economic capacity — malformed (no es objeto)', () => {
  it('retorna economicCapacity=null cuando economic_capacity no es un objeto', async () => {
    const row = makeRowWithRawData({ economic_capacity: 'not-an-object' });
    const sb = makeMock({ rows: [row] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.economicCapacity, null);
  });
});

describe('economic capacity — numeric declarado sin amount usable', () => {
  it('retorna kind=unparsed cuando kind=numeric pero amount no es un número finito', async () => {
    const row = makeRowWithRawData({
      economic_capacity: { kind: 'numeric', amount: 'mucho', raw: 'texto raro' },
    });
    const sb = makeMock({ rows: [row] });
    const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.deepEqual(r.economicCapacity, { kind: 'unparsed', amount: null, raw: 'texto raro' });
  });
});

// ── Environment unavailable ───────────────────────────────────────────────────

describe('environment — falta SUPABASE_SERVICE_ROLE_KEY', () => {
  it('retorna found=false reason=environment_unavailable cuando no hay service role', async () => {
    const savedKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    try {
      const r = await lookupGtRgaeByNit({ nit: SAMPLE_NIT });
      assert.equal(r.found, false);
      assert.equal(r.reason, 'environment_unavailable');
    } finally {
      if (savedKey !== undefined) {
        process.env['SUPABASE_SERVICE_ROLE_KEY'] = savedKey;
      }
    }
  });
});
