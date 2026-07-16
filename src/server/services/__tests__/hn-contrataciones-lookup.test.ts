/**
 * Tests — hn-contrataciones-lookup.ts — Centroamérica.8C.5B + EC4D5.APP-C4A
 *
 * Verifica:
 * - Normalización de RTN (bare, prefijos, espacios, guiones, null, longitudes, letras, X-ONCAE)
 * - Query scope: source_key fijo, country_code fijo (fila correcta seleccionada)
 * - Found: fixture completo → found=true + campos correctos
 * - Found: contrato explícito 8C.5B.1 (guardrails + provenance + sin raw_data)
 * - Not found: 0 filas → found=false, reason='not_found'
 * - Query error → found=false, reason='query_error', sin error raw al caller
 * - Guardrail violation: uno por cada uno de los 8 invariantes (incl. source)
 * - Signals malformed → found=true, procurement_signals endurecidos
 * - Environment: falta service role → found=false, reason='environment_unavailable'
 * - Migración APP-C4A al contrato cardinality-aware:
 *   · 2 filas mismo tax/source/year → cardinality_violation (no pick arbitrario)
 *   · latest-year con 2 años distintos → escoge el más reciente
 *   · latest-year con 2 filas mismo año → cardinality_violation
 *   · el reader ya NO usa .limit(1).maybeSingle
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lookupHnContratacionesByRtn } from '../hn-contrataciones-lookup';
import {
  createFakeSnapshotSupabaseClient,
  type FakeSnapshotRow,
} from '../../source-catalog/snapshot-read/__tests__/snapshot-read-fake-supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

const SOURCE_KEY = 'hn_contrataciones_abiertas';
const COUNTRY_CODE = 'HN';
const SAMPLE_RTN = '05010109034' + '123'; // 14 digits

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

function row(overrides: Partial<FakeSnapshotRow> = {}): FakeSnapshotRow {
  return {
    source_key: SOURCE_KEY,
    country_code: COUNTRY_CODE,
    source_year: 2024,
    normalized_tax_id: SAMPLE_RTN,
    legal_name: 'EMPRESA HONDUREÑA SA DE CV',
    priority_score: 60,
    signals: VALID_SIGNALS,
    raw_data: VALID_RAW_DATA,
    record_identity_key: null,
    ...overrides,
  };
}

function rowWithRawData(rawDataOverride: Record<string, unknown>): FakeSnapshotRow {
  return row({ raw_data: { ...VALID_RAW_DATA, ...rawDataOverride } });
}

function fakeClient(rows: readonly FakeSnapshotRow[]): SupabaseClient {
  return createFakeSnapshotSupabaseClient(rows) as unknown as SupabaseClient;
}

// ── Normalización RTN ─────────────────────────────────────────────────────────

describe('normalización RTN — bare válido', () => {
  it('acepta 14 dígitos sin prefijo', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row()]));
    assert.equal(r.found, true);
  });
});

describe('normalización RTN — prefijo HN-RTN-', () => {
  it('strip del prefijo HN-RTN- y busca los 14 dígitos', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: `HN-RTN-${SAMPLE_RTN}` }, fakeClient([row()]));
    assert.equal(r.found, true);
  });
});

describe('normalización RTN — prefijo HN-RTN:', () => {
  it('strip del prefijo HN-RTN: y busca los 14 dígitos', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: `HN-RTN:${SAMPLE_RTN}` }, fakeClient([row()]));
    assert.equal(r.found, true);
  });
});

describe('normalización RTN — espacios y guiones', () => {
  it('strip de espacios y guiones intermedios', async () => {
    const rtnWithSpaces = SAMPLE_RTN.slice(0, 4) + ' ' + SAMPLE_RTN.slice(4, 8) + '-' + SAMPLE_RTN.slice(8);
    const r = await lookupHnContratacionesByRtn({ rtn: rtnWithSpaces }, fakeClient([row()]));
    assert.equal(r.found, true);
  });
});

describe('normalización RTN — null', () => {
  it('retorna found=false reason=invalid_rtn para null', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: null }, fakeClient([row()]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — empty string', () => {
  it('retorna found=false reason=invalid_rtn para empty string', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: '' }, fakeClient([row()]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — 13 dígitos (longitud incorrecta)', () => {
  it('retorna found=false reason=invalid_rtn para RTN de 13 dígitos', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: '0501010903412' }, fakeClient([row()]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — 15 dígitos (longitud incorrecta)', () => {
  it('retorna found=false reason=invalid_rtn para RTN de 15 dígitos', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: '050101090341234' }, fakeClient([row()]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — letras no numéricas', () => {
  it('retorna found=false reason=invalid_rtn cuando hay letras', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: '0501010903412AB' }, fakeClient([row()]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

describe('normalización RTN — X-ONCAE legacy', () => {
  it('retorna found=false reason=invalid_rtn para X-ONCAE-SUPPLIERS-HC1', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: 'X-ONCAE-SUPPLIERS-HC1' }, fakeClient([row()]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'invalid_rtn');
  });
});

// ── Query scope ───────────────────────────────────────────────────────────────

describe('query scope — source_key y country_code fijos', () => {
  it('selecciona solo la fila HN/hn_contrataciones_abiertas del RTN', async () => {
    const client = fakeClient([
      row(),
      // Decoys under other source_key / country / tax must not be selected.
      row({ source_key: 'cr_sicop', country_code: 'CR', legal_name: 'DECOY CR' }),
      row({ normalized_tax_id: '99999999999999', legal_name: 'DECOY RTN' }),
    ]);
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, client);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.legal_name, 'EMPRESA HONDUREÑA SA DE CV');
    assert.equal(r.source_key, SOURCE_KEY);
    assert.equal(r.country_code, COUNTRY_CODE);
  });
});

// ── Found — fixture completo ──────────────────────────────────────────────────

describe('found — fixture completo', () => {
  it('retorna found=true con todos los campos correctos', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row()]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.source_year, 2024);
    assert.equal(r.legal_name, 'EMPRESA HONDUREÑA SA DE CV');
    assert.equal(r.normalized_rtn, SAMPLE_RTN);
    assert.equal(typeof r.masked_rtn, 'string');
    assert.ok(r.masked_rtn.length > 0);
    assert.equal(r.priority_score, 60);
    assert.equal(r.reason, null);
  });

  it('expone los guardrails semánticos explícitamente (8C.5B.1)', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row()]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.source_key, 'hn_contrataciones_abiertas');
    assert.equal(r.country_code, 'HN');
    assert.equal(r.source_year, 2024);
    assert.equal(r.source_type, 'procurement_signal');
    assert.equal(r.legal_validation_status, 'not_applicable');
    assert.equal(r.human_review_required, true);
    assert.equal(r.post_approval_enabled, false);
    assert.equal(r.matching_automatic_enabled, false);
  });

  it('expone provenance explícita construida desde literales validados', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row()]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.provenance.snapshot_source, 'ocp_registry_jsonl');
    assert.equal(r.provenance.legal_entity_hint, 'likely_legal_entity');
    assert.equal(r.provenance.source_year, 2024);
  });

  it('NO expone raw_data en el resultado público found=true', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row()]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal('raw_data' in r, false, 'raw_data no debe ser parte del contrato público');
  });

  it('retorna procurement_signals correctos', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row()]));
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
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row()]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.notEqual(r.masked_rtn, SAMPLE_RTN);
  });
});

// ── Not found ─────────────────────────────────────────────────────────────────

describe('not found — 0 filas', () => {
  it('retorna found=false reason=not_found cuando no hay fila', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'not_found');
    if (r.found) return;
    assert.equal(r.normalized_rtn, SAMPLE_RTN);
  });
});

// ── Query error ───────────────────────────────────────────────────────────────

describe('query error', () => {
  it('retorna found=false reason=query_error sin propagar error raw', async () => {
    const erroringClient = {
      from: () => ({
        select: () => {
          const q: Record<string, unknown> = {};
          q.eq = () => q;
          q.order = () => q;
          q.limit = () => q;
          q.maybeSingle = async () => ({ data: null, error: { code: 'XX000', message: 'DB error internal' } });
          q.then = (onf: (v: { data: null; error: { code: string; message: string } }) => unknown) =>
            Promise.resolve({ data: null, error: { code: 'XX000', message: 'DB error internal' } }).then(onf);
          return q;
        },
      }),
    } as unknown as SupabaseClient;

    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, erroringClient);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'query_error');
    const resultStr = JSON.stringify(r);
    assert.ok(!resultStr.includes('DB error internal'), 'error raw no debe propagarse al caller');
  });
});

// ── Guardrail violations ──────────────────────────────────────────────────────

describe('guardrail — source_type incorrecto', () => {
  it('found=false reason=snapshot_guardrail_violation cuando source_type no es procurement_signal', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([rowWithRawData({ source_type: 'legal_registry' })]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — tax_identifier_type incorrecto', () => {
  it('snapshot_guardrail_violation cuando tax_identifier_type no es RTN', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([rowWithRawData({ tax_identifier_type: 'NIT' })]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — legal_validation_status incorrecto', () => {
  it('snapshot_guardrail_violation cuando legal_validation_status no es not_applicable', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([rowWithRawData({ legal_validation_status: 'validated' })]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — human_review_required incorrecto', () => {
  it('snapshot_guardrail_violation cuando human_review_required no es true', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([rowWithRawData({ human_review_required: false })]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — post_approval_enabled incorrecto', () => {
  it('snapshot_guardrail_violation cuando post_approval_enabled no es false', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([rowWithRawData({ post_approval_enabled: true })]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — matching_automatic_enabled incorrecto', () => {
  it('snapshot_guardrail_violation cuando matching_automatic_enabled no es false', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([rowWithRawData({ matching_automatic_enabled: true })]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — legal_entity_hint incorrecto', () => {
  it('snapshot_guardrail_violation cuando legal_entity_hint no es likely_legal_entity', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([rowWithRawData({ legal_entity_hint: 'unknown_or_person_natural_risk' })]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
  });
});

describe('guardrail — source incorrecto (8C.5B.1)', () => {
  it('snapshot_guardrail_violation cuando source no es ocp_registry_jsonl', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([rowWithRawData({ source: 'some_other_source' })]));
    assert.equal(r.found, false);
    assert.equal(r.reason, 'snapshot_guardrail_violation');
    if (r.found) return;
    assert.equal(r.guardrail_field, 'source');
  });
});

// ── Signals malformed (raw_data OK) ──────────────────────────────────────────

describe('signals malformed — null signals', () => {
  it('found=true con procurement_signals presente cuando signals es null', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row({ signals: null })]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.ok(r.procurement_signals !== undefined);
  });
});

describe('signals malformed — awards_count es string', () => {
  it('found=true con awards_count=null cuando es string', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row({ signals: { ...VALID_SIGNALS, awards_count: 'siete' } })]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.ok(r.procurement_signals);
    assert.equal(r.procurement_signals.awards_count, null);
  });
});

describe('signals malformed — total_award_amount es string', () => {
  it('found=true con total_award_amount=null cuando es string', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row({ signals: { ...VALID_SIGNALS, total_award_amount: 'mucho' } })]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.ok(r.procurement_signals);
    assert.equal(r.procurement_signals.total_award_amount, null);
  });
});

describe('signals malformed — count negativo (8C.5B.1)', () => {
  it('found=true con awards_count=null cuando el count es negativo', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row({ signals: { ...VALID_SIGNALS, awards_count: -3 } })]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.ok(r.procurement_signals);
    assert.equal(r.procurement_signals.awards_count, null);
    assert.equal(r.procurement_signals.tenders_count, 3);
  });
});

describe('signals malformed — latest_date es número (inválido)', () => {
  it('found=true con latest_date=null cuando es número', async () => {
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, fakeClient([row({ signals: { ...VALID_SIGNALS, latest_date: 20240915 } })]));
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.ok(r.procurement_signals);
    assert.equal(r.procurement_signals.latest_date, null);
  });
});

// ── Cardinality violation + latest year (APP-C4A) ────────────────────────────

describe('cardinality violation', () => {
  it('exact year: 2 filas mismo tax/source/year → cardinality_violation (sin pick)', async () => {
    const client = fakeClient([
      row({ source_year: 2024, record_identity_key: 'a', legal_name: 'A' }),
      row({ source_year: 2024, record_identity_key: 'b', legal_name: 'B' }),
    ]);
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN, year: 2024 }, client);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'cardinality_violation');
  });

  it('latest-year: 2 filas del año más reciente → cardinality_violation', async () => {
    const client = fakeClient([
      row({ source_year: 2024, record_identity_key: 'a' }),
      row({ source_year: 2024, record_identity_key: 'b' }),
    ]);
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, client);
    assert.equal(r.found, false);
    assert.equal(r.reason, 'cardinality_violation');
  });
});

describe('latest year selection', () => {
  it('escoge el source_year más reciente cuando no se pasa year', async () => {
    const client = fakeClient([
      row({ source_year: 2022, legal_name: 'VIEJO' }),
      row({ source_year: 2024, legal_name: 'NUEVO' }),
    ]);
    const r = await lookupHnContratacionesByRtn({ rtn: SAMPLE_RTN }, client);
    assert.equal(r.found, true);
    if (!r.found) return;
    assert.equal(r.source_year, 2024);
    assert.equal(r.legal_name, 'NUEVO');
  });
});

// ── Environment unavailable ───────────────────────────────────────────────────

describe('environment — falta SUPABASE_SERVICE_ROLE_KEY', () => {
  it('found=false reason=environment_unavailable cuando no hay service role', async () => {
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

// ── static: reader no longer uses .limit(1).maybeSingle ──────────────────────

describe('hn-contrataciones-lookup — migrated off .limit(1).maybeSingle', () => {
  it('reader code (comments stripped) contains neither maybeSingle nor .limit(1)', () => {
    const raw = readFileSync(new URL('../hn-contrataciones-lookup.ts', import.meta.url), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.ok(!code.includes('maybeSingle'), 'reader must not call maybeSingle directly');
    assert.ok(!code.includes('.limit(1)'), 'reader must not call .limit(1) directly');
  });
});
