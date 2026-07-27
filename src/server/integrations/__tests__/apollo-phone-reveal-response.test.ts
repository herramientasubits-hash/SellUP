/**
 * Tests — Apollo Phone Reveal: interpretación PURA del START (Agente 2A)
 * APOLLO-PHONE-ASYNC-15.
 *
 * Lógica pura: sin red, sin DB, sin proveedores, sin env. Node.js built-in test
 * runner. Verifica el contrato confirmado por Apollo Support:
 *
 *   - El handle async correcto es `phone_enrichment.request_id`.
 *   - El `request_id` top-level NO es el handle async (es traza HTTP).
 *   - Se capturan headers de traza (x-http-request-id, x-transaction-id).
 *   - HTTP 200 sin phone_enrichment ⇒ no_async_job_created (no pending, no id falso).
 *   - phone_enrichment.status=skipped: con id conserva handle; sin id no lo inventa.
 *   - La metadata de traza NO contiene PII.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  interpretApolloPhoneRevealStartResponse,
  OUTBOUND_TRANSACTION_HEADER,
  APOLLO_HTTP_REQUEST_ID_HEADER,
  APOLLO_TRANSACTION_ID_HEADER,
  type ApolloPhoneRevealStartBody,
} from '../apollo-phone-reveal-response';

// ── Helpers ────────────────────────────────────────────────────

/** Construye un getHeader case-insensitive desde un mapa simple. */
function headersFrom(map: Record<string, string>): (name: string) => string | null {
  const lower = new Map<string, string>();
  for (const [k, v] of Object.entries(map)) lower.set(k.toLowerCase(), v);
  return (name) => lower.get(name.toLowerCase()) ?? null;
}

const NO_HEADERS = headersFrom({});
const OUTBOUND_UUID = '11111111-2222-4333-8444-555555555555';

function interpret(
  body: ApolloPhoneRevealStartBody | null,
  headers: Record<string, string> = {},
  outbound: string | null = OUTBOUND_UUID,
) {
  return interpretApolloPhoneRevealStartResponse({
    body,
    getHeader: headersFrom(headers),
    outboundTransactionId: outbound,
  });
}

// ── 1. Handle async = phone_enrichment.request_id ──────────────

describe('ASYNC-15 — handle async desde phone_enrichment.request_id', () => {
  it('extrae phone_enrichment.request_id como handle async', () => {
    const r = interpret({
      phone_enrichment: { request_id: 'pe-req-123', status: 'pending' },
    });
    assert.equal(r.asyncRequestId, 'pe-req-123');
    assert.equal(r.outcome, 'pending');
    assert.equal(r.noAsyncJobCode, null);
    assert.equal(r.trace.apollo_async_request_id_present, true);
    assert.equal(r.trace.apollo_phone_enrichment_present, true);
    assert.equal(r.trace.apollo_phone_enrichment_status, 'pending');
  });

  it('recorta espacios del handle async', () => {
    const r = interpret({ phone_enrichment: { request_id: '  pe-req-9  ' } });
    assert.equal(r.asyncRequestId, 'pe-req-9');
    assert.equal(r.outcome, 'pending');
  });
});

// ── 2. top-level request_id NO es el handle async ──────────────

describe('ASYNC-15 — top-level request_id NO es handle async', () => {
  it('request_id top-level presente pero sin phone_enrichment → no_async_job_created', () => {
    const r = interpret({ request_id: 'http-trace-xyz' });
    assert.equal(r.asyncRequestId, null, 'el request_id top-level NO debe ser el handle');
    assert.equal(r.outcome, 'no_async_job_created');
    assert.equal(r.noAsyncJobCode, 'no_async_job_created');
    // Se guarda SOLO como traza HTTP.
    assert.equal(r.trace.apollo_top_level_request_id_present, true);
    assert.equal(r.trace.apollo_http_request_id, 'http-trace-xyz');
  });

  it('top-level request_id NUNCA se usa como handle aunque haya phone_enrichment sin id', () => {
    const r = interpret({
      request_id: 'http-trace-xyz',
      phone_enrichment: { status: 'pending' },
    });
    assert.equal(r.asyncRequestId, null);
    assert.notEqual(r.asyncRequestId, 'http-trace-xyz');
  });

  it('prefiere phone_enrichment.request_id sobre el request_id top-level (distintos)', () => {
    const r = interpret({
      request_id: 'http-trace-top',
      phone_enrichment: { request_id: 'pe-async-handle' },
    });
    assert.equal(r.asyncRequestId, 'pe-async-handle');
    assert.equal(r.trace.apollo_http_request_id, 'http-trace-top');
  });
});

// ── 3. Headers de traza ────────────────────────────────────────

describe('ASYNC-15 — captura de headers de traza', () => {
  it('captura x-http-request-id (header preferido sobre body top-level)', () => {
    const r = interpret(
      { request_id: 'body-top-level', phone_enrichment: { request_id: 'pe-1' } },
      { [APOLLO_HTTP_REQUEST_ID_HEADER]: 'header-http-req-id' },
    );
    assert.equal(r.trace.apollo_http_request_id, 'header-http-req-id');
  });

  it('cae al request_id top-level del body cuando no hay header x-http-request-id', () => {
    const r = interpret({ request_id: 'body-top-level', phone_enrichment: { request_id: 'pe-1' } });
    assert.equal(r.trace.apollo_http_request_id, 'body-top-level');
  });

  it('captura x-transaction-id como traza técnica', () => {
    const r = interpret(
      { phone_enrichment: { request_id: 'pe-1' } },
      { [APOLLO_TRANSACTION_ID_HEADER]: 'apollo-txn-777' },
    );
    assert.equal(r.trace.apollo_transaction_id, 'apollo-txn-777');
  });
});

// ── 4. X-Transaction-Id saliente (UUID) + echo ─────────────────

describe('ASYNC-15 — X-Transaction-Id saliente', () => {
  it('el header saliente es X-Transaction-Id', () => {
    assert.equal(OUTBOUND_TRANSACTION_HEADER, 'X-Transaction-Id');
  });

  it('guarda el UUID saliente como sellup_transaction_id', () => {
    const r = interpret({ phone_enrichment: { request_id: 'pe-1' } }, {}, OUTBOUND_UUID);
    assert.equal(r.trace.sellup_transaction_id, OUTBOUND_UUID);
  });

  it('apollo_transaction_echoed=true cuando Apollo refleja el mismo UUID', () => {
    const r = interpret(
      { phone_enrichment: { request_id: 'pe-1' } },
      { [APOLLO_TRANSACTION_ID_HEADER]: OUTBOUND_UUID },
      OUTBOUND_UUID,
    );
    assert.equal(r.trace.apollo_transaction_echoed, true);
  });

  it('apollo_transaction_echoed=false cuando Apollo devuelve otro transaction id', () => {
    const r = interpret(
      { phone_enrichment: { request_id: 'pe-1' } },
      { [APOLLO_TRANSACTION_ID_HEADER]: 'otro-valor' },
      OUTBOUND_UUID,
    );
    assert.equal(r.trace.apollo_transaction_echoed, false);
  });

  it('apollo_transaction_echoed=false cuando no hay outbound id', () => {
    const r = interpret(
      { phone_enrichment: { request_id: 'pe-1' } },
      { [APOLLO_TRANSACTION_ID_HEADER]: 'algo' },
      null,
    );
    assert.equal(r.trace.apollo_transaction_echoed, false);
    assert.equal(r.trace.sellup_transaction_id, null);
  });
});

// ── 5. HTTP 200 sin phone_enrichment → no_async_job_created ─────

describe('ASYNC-15 — HTTP 200 sin phone_enrichment', () => {
  it('body sin phone_enrichment → no_async_job_created, sin handle', () => {
    const r = interpret({ person: { id: 'apollo-person-1' } });
    assert.equal(r.asyncRequestId, null);
    assert.equal(r.outcome, 'no_async_job_created');
    assert.equal(r.noAsyncJobCode, 'no_async_job_created');
    assert.equal(r.trace.apollo_phone_enrichment_present, false);
    assert.equal(r.trace.apollo_phone_enrichment_status, null);
  });

  it('body vacío/null → no_async_job_created, sin id inventado', () => {
    for (const body of [null, {} as ApolloPhoneRevealStartBody]) {
      const r = interpret(body);
      assert.equal(r.asyncRequestId, null);
      assert.equal(r.outcome, 'no_async_job_created');
      assert.equal(r.noAsyncJobCode, 'no_async_job_created');
    }
  });

  it('observa presencia de person / person.id (booleanos, nunca el valor)', () => {
    const withPerson = interpret({ person: { id: 'p-1' } });
    assert.equal(withPerson.trace.apollo_person_present, true);
    assert.equal(withPerson.trace.apollo_person_id_present, true);

    const withoutId = interpret({ person: {} });
    assert.equal(withoutId.trace.apollo_person_present, true);
    assert.equal(withoutId.trace.apollo_person_id_present, false);

    const noPerson = interpret({ phone_enrichment: { request_id: 'pe-1' } });
    assert.equal(noPerson.trace.apollo_person_present, false);
    assert.equal(noPerson.trace.apollo_person_id_present, false);
  });
});

// ── 6. phone_enrichment.status = pending + request_id ──────────

describe('ASYNC-15 — pending con request_id', () => {
  it('status pending + request_id → pending (handle conservado)', () => {
    const r = interpret({ phone_enrichment: { request_id: 'pe-42', status: 'pending' } });
    assert.equal(r.asyncRequestId, 'pe-42');
    assert.equal(r.outcome, 'pending');
    assert.equal(r.noAsyncJobCode, null);
  });
});

// ── 7. phone_enrichment.status = skipped ───────────────────────

describe('ASYNC-15 — status skipped', () => {
  it('skipped CON request_id → conserva handle (pending)', () => {
    const r = interpret({ phone_enrichment: { request_id: 'pe-prev-77', status: 'skipped' } });
    assert.equal(r.asyncRequestId, 'pe-prev-77');
    assert.equal(r.outcome, 'pending');
    assert.equal(r.noAsyncJobCode, null);
    assert.equal(r.trace.apollo_phone_enrichment_status, 'skipped');
  });

  it('skipped SIN request_id → skipped_without_request_id, sin id inventado', () => {
    const r = interpret({ phone_enrichment: { status: 'skipped' } });
    assert.equal(r.asyncRequestId, null);
    assert.equal(r.outcome, 'skipped_without_request_id');
    assert.equal(r.noAsyncJobCode, 'skipped_without_request_id');
  });
});

// ── 8. Metadata de traza SIN PII ───────────────────────────────

describe('ASYNC-15 — metadata de traza sin PII', () => {
  it('la traza NO contiene teléfono/email/linkedin/nombre ni el person id crudo', () => {
    // Aunque el body trajera datos, el interpreter sólo observa presencia.
    const r = interpret(
      {
        request_id: 'http-trace',
        phone_enrichment: { request_id: 'pe-1', status: 'pending' },
        person: { id: 'apollo-person-secret-id' },
      },
      { [APOLLO_TRANSACTION_ID_HEADER]: 'txn-1' },
    );
    const serialized = JSON.stringify(r.trace);
    assert.equal(serialized.includes('apollo-person-secret-id'), false);
    // Sólo claves técnicas esperadas.
    const KEYS = new Set([
      'apollo_async_request_id_present',
      'apollo_phone_enrichment_present',
      'apollo_phone_enrichment_status',
      'apollo_person_present',
      'apollo_person_id_present',
      'apollo_top_level_request_id_present',
      'apollo_http_request_id',
      'apollo_transaction_id',
      'sellup_transaction_id',
      'apollo_transaction_echoed',
    ]);
    for (const key of Object.keys(r.trace)) {
      assert.equal(KEYS.has(key), true, `clave inesperada en trace: ${key}`);
    }
  });
});

// ── 9. Pureza ──────────────────────────────────────────────────

describe('ASYNC-15 — pureza', () => {
  it('no muta el body de entrada', () => {
    const body: ApolloPhoneRevealStartBody = {
      request_id: 'top',
      phone_enrichment: { request_id: 'pe-1', status: 'pending' },
    };
    const snapshot = JSON.stringify(body);
    interpretApolloPhoneRevealStartResponse({
      body,
      getHeader: NO_HEADERS,
      outboundTransactionId: OUTBOUND_UUID,
    });
    assert.equal(JSON.stringify(body), snapshot);
  });
});
