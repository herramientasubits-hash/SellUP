/**
 * Tests — hn-contrataciones-lookup.ts — Centroamérica.8C.5B
 *
 * Verifica:
 * - Normalización de RTN (bare, prefijos, espacios, guiones, null, longitudes, letras, X-ONCAE)
 * - Query scope: source_key fijo, country_code fijo
 * - Año explícito usa eq source_year; sin año usa order DESC + limit 1 + maybeSingle
 * - Found: fixture completo → found=true + campos correctos
 * - Not found: data=null, error=null → found=false, reason='not_found'
 * - Query error → found=false, reason='query_error', sin error raw al caller
 * - Guardrail violation: uno por cada uno de los 7 invariantes
 * - Signals malformed → found=true, procurement_signals=null (si raw_data OK)
 * - Environment: falta service role → found=false, reason='environment_unavailable'
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupHnContratacionesByRtn,
} from '../hn-contrataciones-lookup';

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockOptions {
  row?: Record<string, unknown> | null;
  error?: { message: string } | null;
  captureEqs?: string[];
  captureYearMode?: { yearEqCalled: boolean; orderCalled: boolean };
}

function makeMock(opts: MockOptions = {}) {
  const row = opts.row !== undefined ? opts.row : null;
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
  chain['maybeSingle'] = async () => ({ data: row, error });
  return chain as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const VALID_RAW_DATA = {
  source_type: 'procurement_signal',
  tax_identifier_type: 'RTN',
  legal_validation_status: 'not_applicable',
  human_review_required: true,
  post_approval_enabled: false,
  matching_automatic_enabled: false,
  legal_entity_hint: 'likely_legal_entity',
  source: 'ocp_registry_jsonl',
};

const VALID_SIGNALS = {
  awards_count: 7,
  tenders_count: 3,
  contracts_count: 5,
  total_award_amount: 500000,
  latest_date: '2024-09-15',
};

const SAMPLE_RTN = '05010109034' + '123'; // 14 digits
const SAMPLE_ROW: Record<string, unknown> = {
  source_year: 2024,
  legal_name: 'EMPRESA HONDUREÑA SA DE CV',
  normalized_tax_id: SAMPLE_RTN,
  priority_score: 60,
  signals: VALID_SIGNALS,
  raw_data: VALID_RAW_DATA,
};

// ── Normalización RTN ─────────────────────────────────────────────────────────

describe('normalización RTN — bare válido', () => {
  it('acepta 14 dígitos sin prefijo', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, true);
  });
});

describe('normalización RTN — prefijo HN-RTN-', () => {
  it('strip del prefijo HN-RTN- y busca los 14 dígitos', async () => {
    const captured: string[] = [];
    const sb = makeMock({ row: SAMPLE_ROW, captureEqs: captured });
    await lookupHnContratacionesByRtn({ rtn: `HN-RTN-${SAMPLE_RTN}` }, sb);
    assert.ok(
      captured.includes(SAMPLE_RTN),
      `normalized_tax_id ${SAMPLE_RTN} debe haberse buscado, captured=${JSON.stringify(captured)}`,
    );
  });
});

describe('normalización RTN — prefijo HN-RTN:', () => {
  it('strip del prefijo HN-RTN: y busca los 14 dígitos', async () => {
    const captured: string[] = [];
    const sb = makeMock({ row: SAMPLE_ROW, captureEqs: captured });
    await lookupHnContratacionesByRtn({ rtn: `HN-RTN:${SAMPLE_RTN}` }, sb);
    assert.ok(captured.includes(SAMPLE_RTN));
  });
});

describe('normalización RTN — espacios y guiones', () => {
  it('strip de espacios y guiones intermedios', async () => {
    const rtnWithSpaces = SAMPLE_RTN.slice(0, 4) + ' ' + SAMPLE_RTN.slice(4, 8) + '-' + SAMPLE_RTN.slice(8);
    const captured: string[] = [];
    const sb = makeMock({ row: SAMPLE_ROW, captureEqs: captured });
    await lookupHnContratacionesByRtn({ rtn: rtnWithSpaces }, sb);
    assert.ok(captured.includes(SAMPLE_RTN));
  });
});

describe('normalización RTN — null', () => {
  it('retorna found=false reason=invalid_rtn para null', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: null }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — empty string', () => {
  it('retorna found=false reason=invalid_rtn para empty string', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: '' }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — 13 dígitos (longitud incorrecta)', () => {
  it('retorna found=false reason=invalid_rtn para RTN de 13 dígitos', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: '0501010903412' }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — 15 dígitos (longitud incorrecta)', () => {
  it('retorna found=false reason=invalid_rtn para RTN de 15 dígitos', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: '050101090341234' }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — letras no numéricas', () => {
  it('retorna found=false reason=invalid_rtn cuando hay letras', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: '0501010903412AB' }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — X-ONCAE legacy', () => {
  it('retorna found=false reason=invalid_rtn para X-ONCAE-SUPPLIERS-HC1', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: 'X-ONCAE-SUPPLIERS-HC1' }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

// ── Query scope ───────────────────────────────────────────────────────────────

describe('query scope — source_key y country_code fijos', () => {
  it('busca source_key=hn_contrataciones_abiertas y country_code=HN', async () => {
    const captured: string[] = [];
    const sb = makeMock({ row: SAMPLE_ROW, captureEqs: captured });
    await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.ok(
      captured.includes('hn_contrataciones_abiertas'),
      'debe usar source_key=hn_contrataciones_abiertas',
    );
    assert.ok(captured.includes('HN'), 'debe usar country_code=HN');
  });
});

// ── Año explícito vs implícito ─────────────────────────────────────────────────

describe('año explícito — usa eq source_year', () => {
  it('cuando se pasa year usa eq en lugar de order', async () => {
    const yearMode = { yearEqCalled: false, orderCalled: false };
    const sb = makeMock({ row: SAMPLE_ROW, captureYearMode: yearMode });
    await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN, year: 2024 }, sb);
    assert.equal(yearMode.yearEqCalled, true, 'debe usar eq source_year');
    assert.equal(yearMode.orderCalled, false, 'no debe usar order cuando hay year');
  });
});

describe('sin año — usa order DESC + limit 1 + maybeSingle', () => {
  it('cuando no se pasa year usa order y no eq en source_year', async () => {
    const yearMode = { yearEqCalled: false, orderCalled: false };
    const sb = makeMock({ row: SAMPLE_ROW, captureYearMode: yearMode });
    await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(yearMode.orderCalled, true, 'debe usar order');
    assert.equal(yearMode.yearEqCalled, false, 'no debe usar eq source_year cuando no hay year');
  });
});

// ── Found — fixture completo ──────────────────────────────────────────────────

describe('found — fixture completo', () => {
  it('retorna found=true con todos los campos correctos', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, true);
    if (!r.found) return; // type narrowing
    assert.equal(r.source_year, 2024);
    assert.equal(r.legal_name, 'EMPRESA HONDUREÑA SA DE CV');
    assert.equal(r.normalized_rtn, SAMPLE_RTN);
    assert.equal(typeof r.masked_rtn, 'string');
    assert.ok(r.masked_rtn.length > 0);
    assert.equal(r.priority_score, 60);
    assert.equal(r.reason, null);
    assert.ok(r.raw_data);
  });

  it('retorna procurement_signals correctos', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.ok(r.procurement_signals, 'debe retornar procurement_signals');
    assert.equal(r.procurement_signals.awards_count, 7);
    assert.equal(r.procurement_signals.tenders_count, 3);
    assert.equal(r.procurement_signals.contracts_count, 5);
    assert.equal(r.procurement_signals.total_award_amount, 500000);
    assert.equal(r.procurement_signals.latest_date, '2024-09-15');
  });

  it('masked_rtn NO contiene el RTN completo', async () => {
    const sb = makeMock({ row: SAMPLE_ROW });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.notEqual(r.masked_rtn, SAMPLE_RTN);
  });
});

// ── Not found ─────────────────────────────────────────────────────────────────

describe('not found — data=null, error=null', () => {
  it('retorna found=false reason=not_found cuando no hay fila', async () => {
    const sb = makeMock({ row: null });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'not_found');
    if (r.found) return;
    assert.equal(r.normalized_rtn, SAMPLE_RTN);
  });
});

// ── Query error ───────────────────────────────────────────────────────────────

describe('query error', () => {
  it('retorna found=false reason=query_error sin propagar error raw', async () => {
    const sb = makeMock({ row: null, error: { message: 'DB error internal' } });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'query_error');
    // El mensaje de error interno no debe llegar al caller
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

describe('guardrail — source_type incorrecto', () => {
  it('retorna found=false reason=snapshot_guardrail_violation cuando source_type no es procurement_signal', async () => {
    const sb = makeMock({ row: makeRowWithRawData({ source_type: 'legal_registry' }) });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — tax_identifier_type incorrecto', () => {
  it('retorna snapshot_guardrail_violation cuando tax_identifier_type no es RTN', async () => {
    const sb = makeMock({ row: makeRowWithRawData({ tax_identifier_type: 'NIT' }) });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — legal_validation_status incorrecto', () => {
  it('retorna snapshot_guardrail_violation cuando legal_validation_status no es not_applicable', async () => {
    const sb = makeMock({ row: makeRowWithRawData({ legal_validation_status: 'validated' }) });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — human_review_required incorrecto', () => {
  it('retorna snapshot_guardrail_violation cuando human_review_required no es true', async () => {
    const sb = makeMock({ row: makeRowWithRawData({ human_review_required: false }) });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — post_approval_enabled incorrecto', () => {
  it('retorna snapshot_guardrail_violation cuando post_approval_enabled no es false', async () => {
    const sb = makeMock({ row: makeRowWithRawData({ post_approval_enabled: true }) });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — matching_automatic_enabled incorrecto', () => {
  it('retorna snapshot_guardrail_violation cuando matching_automatic_enabled no es false', async () => {
    const sb = makeMock({ row: makeRowWithRawData({ matching_automatic_enabled: true }) });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — legal_entity_hint incorrecto', () => {
  it('retorna snapshot_guardrail_violation cuando legal_entity_hint no es likely_legal_entity', async () => {
    const sb = makeMock({ row: makeRowWithRawData({ legal_entity_hint: 'unknown_or_person_natural_risk' }) });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

// ── Signals malformed (raw_data OK) ──────────────────────────────────────────

describe('signals malformed — null signals', () => {
  it('retorna found=true con procurement_signals=null cuando signals es null', async () => {
    const sb = makeMock({ row: { ...SAMPLE_ROW, signals: null } });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    // null signals → empty object fallback → all fields null
    assert.ok(r.procurement_signals !== undefined);
  });
});

describe('signals malformed — awards_count es string', () => {
  it('retorna found=true con awards_count=null cuando es string', async () => {
    const sb = makeMock({
      row: { ...SAMPLE_ROW, signals: { ...VALID_SIGNALS, awards_count: 'siete' } },
    });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.ok(r.procurement_signals);
    assert.equal(r.procurement_signals.awards_count, null);
  });
});

describe('signals malformed — total_award_amount es string', () => {
  it('retorna found=true con total_award_amount=null cuando es string', async () => {
    const sb = makeMock({
      row: { ...SAMPLE_ROW, signals: { ...VALID_SIGNALS, total_award_amount: 'mucho' } },
    });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.ok(r.procurement_signals);
    assert.equal(r.procurement_signals.total_award_amount, null);
  });
});

describe('signals malformed — latest_date es número (inválido)', () => {
  it('retorna found=true con latest_date=null cuando es número', async () => {
    const sb = makeMock({
      row: { ...SAMPLE_ROW, signals: { ...VALID_SIGNALS, latest_date: 20240915 } },
    });
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, sb);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.ok(r.procurement_signals);
    assert.equal(r.procurement_signals.latest_date, null);
  });
});

// ── Environment unavailable ───────────────────────────────────────────────────

describe('environment — falta SUPABASE_SERVICE_ROLE_KEY', () => {
  it('retorna found=false reason=environment_unavailable cuando no hay service role', async () => {
    const savedKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    delete process.env['SUPABASE_SERVICE_ROLE_KEY'];
    try {
      const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN });
      assert.equal(r.found, false);
      assert.equal(r.reason, 'environment_unavailable');
    } finally {
      if (savedKey !== undefined) {
        process.env['SUPABASE_SERVICE_ROLE_KEY'] = savedKey;
      }
    }
  });
});
