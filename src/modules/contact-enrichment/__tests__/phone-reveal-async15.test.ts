/**
 * Agente 2A — Apollo Phone Reveal START: contrato ASYNC-15 (handle correcto)
 *
 * Pruebas offline/DI del core puro `runRevealCandidatePhone` sobre el fix del
 * handle async confirmado por Apollo Support + guards estáticos del cliente.
 * Sin red, sin Supabase, sin proveedores reales.
 *
 * Cubre:
 *   - HTTP 200 sin phone_enrichment (client → { ok:true, requestId:null,
 *     noAsyncJobCode:'no_async_job_created' }) ⇒ status error, error_code
 *     'no_async_job_created', SIN request_id falso, SIN créditos.
 *   - skipped sin request_id ⇒ error_code 'skipped_without_request_id'.
 *   - camino feliz ⇒ la traza técnica (sin PII) fluye a usage-log.metadata.apollo_trace.
 *   - regresión: sin noAsyncJobCode el fallback sigue siendo 'missing_request_id'.
 *   - guard estático: el cliente lee phone_enrichment vía interpreter, envía
 *     X-Transaction-Id y NO usa el request_id top-level como handle async.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runRevealCandidatePhone,
  type RevealCandidatePhoneInput,
  type RevealCandidatePhoneDeps,
  type RevealCandidateRecord,
  type ApolloPhoneRevealStartCallResult,
  type RevealStartPersistencePatch,
  type PhoneRevealUsageLogEntry,
} from '../phone-reveal-core';
import type { MatchPersonParams } from '@/server/integrations/apollo-client';
import type { ApolloPhoneRevealTraceMetadata } from '@/server/integrations/apollo-phone-reveal-response';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

const NOW = '2026-07-27T12:00:00.000Z';
const ACTOR = { internalUserId: 'user-admin-1', roleKey: 'admin' };
const WEBHOOK_URL =
  'https://app.example.com/api/integrations/apollo/phone-reveal/webhook?token=secret';

function baseTrace(
  overrides: Partial<ApolloPhoneRevealTraceMetadata> = {},
): ApolloPhoneRevealTraceMetadata {
  return {
    apollo_async_request_id_present: false,
    apollo_phone_enrichment_request_id: null,
    apollo_phone_enrichment_present: false,
    apollo_phone_enrichment_status: null,
    apollo_person_present: false,
    apollo_person_id_present: false,
    apollo_top_level_request_id_present: false,
    apollo_http_request_id: null,
    apollo_transaction_id: null,
    sellup_transaction_id: '11111111-2222-4333-8444-555555555555',
    apollo_transaction_echoed: false,
    webhook_ref: null,
    ...overrides,
  };
}

function baseCandidate(
  overrides: Partial<RevealCandidateRecord> = {},
): RevealCandidateRecord {
  return {
    id: 'cand-1',
    accountId: 'acct-1',
    source: 'apollo',
    sourceContactId: 'apollo-person-1',
    email: 'jane.doe@acme.com',
    linkedinUrl: 'https://linkedin.com/in/jane-doe',
    firstName: 'Jane',
    lastName: 'Doe',
    organizationName: 'Acme SA',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneRevealStatus: null,
    phoneRevealAttemptCount: 0,
    ...overrides,
  };
}

interface Capture {
  apolloCalls: MatchPersonParams[];
  persisted: Array<{ id: string; patch: RevealStartPersistencePatch }>;
  logs: PhoneRevealUsageLogEntry[];
}

function makeDeps(
  cap: Capture,
  apollo: ApolloPhoneRevealStartCallResult,
  candidate: RevealCandidateRecord = baseCandidate(),
): RevealCandidatePhoneDeps {
  return {
    flagEnabled: true,
    actor: ACTOR,
    nowIso: NOW,
    webhookUrl: WEBHOOK_URL,
    loadCandidate: async () => candidate,
    isDoNotContact: async () => false,
    startRevealViaApollo: async (params) => {
      cap.apolloCalls.push(params);
      return apollo;
    },
    persist: async (id, patch) => {
      cap.persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      cap.logs.push(entry);
    },
    // APOLLO-PHONE-CACHE-1b (FIX 2): el reveal comprueba SIEMPRE si hay una
    // supresión registrada, con el flag de caché encendido o apagado. Sin esta
    // dep el core es fail-closed y no llamaría a Apollo. `null` = tabla
    // consultable y sin tombstone para esta persona/cuenta.
    lookupPhoneCacheSuppression: async () => null,
  };
}

function validInput(): RevealCandidatePhoneInput {
  return {
    candidateId: 'cand-1',
    confirmCost: true,
    phoneProcessingBasis: 'legitimate_interest_b2b',
  };
}

let cap: Capture;
beforeEach(() => {
  cap = { apolloCalls: [], persisted: [], logs: [] };
});

// ── HTTP 200 sin phone_enrichment ──────────────────────────────

describe('ASYNC-15 — HTTP 200 sin phone_enrichment (no_async_job_created)', () => {
  it('status error con error_code no_async_job_created, sin request_id ni créditos', async () => {
    const trace = baseTrace({ apollo_phone_enrichment_present: false });
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: null, noAsyncJobCode: 'no_async_job_created', trace }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, 'no_async_job_created');
    assert.equal(res.requestAccepted, false);

    const { patch } = cap.persisted[0];
    assert.equal(patch.phone_reveal_status, 'error');
    assert.equal(patch.phone_reveal_error_code, 'no_async_job_created');
    // NO se inventa request_id.
    assert.equal(patch.phone_reveal_request_id, null);
    // NO se consumen créditos.
    assert.equal(patch.phone_reveal_cost_credits, null);
  });

  it('el usage-log lleva la traza técnica y has_request_id=false', async () => {
    const trace = baseTrace({ apollo_phone_enrichment_present: false, apollo_person_present: true });
    await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: null, noAsyncJobCode: 'no_async_job_created', trace }),
    );
    assert.equal(cap.logs.length, 1);
    assert.equal(cap.logs[0].metadata.error_code, 'no_async_job_created');
    assert.equal(cap.logs[0].metadata.has_request_id, false);
    assert.equal(cap.logs[0].metadata.request_id, null);
    assert.deepEqual(cap.logs[0].metadata.apollo_trace, trace);
  });
});

// ── skipped sin request_id ─────────────────────────────────────

describe('ASYNC-15 — skipped sin request_id', () => {
  it('error_code skipped_without_request_id, sin request_id', async () => {
    const trace = baseTrace({
      apollo_phone_enrichment_present: true,
      apollo_phone_enrichment_status: 'skipped',
    });
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        ok: true,
        requestId: null,
        noAsyncJobCode: 'skipped_without_request_id',
        trace,
      }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, 'skipped_without_request_id');
    assert.equal(cap.persisted[0].patch.phone_reveal_request_id, null);
    assert.equal(cap.persisted[0].patch.phone_reveal_cost_credits, null);
  });
});

// ── skipped CON request_id → pending normal ────────────────────

describe('ASYNC-15 — skipped con request_id (handle conservado)', () => {
  it('requested con request_id conservado', async () => {
    const trace = baseTrace({
      apollo_async_request_id_present: true,
      apollo_phone_enrichment_present: true,
      apollo_phone_enrichment_status: 'skipped',
      // START-CONTRACT-1: para quedar `requested` el START debe traer un id
      // recuperable (apollo_http_request_id); sin él el core marca `error`.
      apollo_http_request_id: 'http-trace-prev-77',
    });
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: 'pe-prev-77', trace }),
    );
    assert.equal(res.status, 'requested');
    assert.equal(cap.persisted[0].patch.phone_reveal_request_id, 'pe-prev-77');
    assert.deepEqual(cap.logs[0].metadata.apollo_trace, trace);
  });
});

// ── camino feliz: traza fluye a metadata ───────────────────────

describe('ASYNC-15 — camino feliz propaga apollo_trace', () => {
  it('requested → apollo_trace en usage-log.metadata (sin PII)', async () => {
    const trace = baseTrace({
      apollo_async_request_id_present: true,
      apollo_phone_enrichment_present: true,
      apollo_phone_enrichment_status: 'pending',
      apollo_http_request_id: 'http-trace-1',
      apollo_transaction_id: 'txn-1',
    });
    await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: 'pe-1', trace }),
    );
    assert.deepEqual(cap.logs[0].metadata.apollo_trace, trace);
    // Sin PII del candidato en la metadata serializada.
    const serialized = JSON.stringify(cap.logs[0]);
    assert.equal(serialized.includes('jane.doe@acme.com'), false);
    assert.equal(serialized.includes('linkedin.com/in/jane-doe'), false);
  });
});

// ── regresión: sin noAsyncJobCode fallback missing_request_id ──

describe('ASYNC-15 — fallback missing_request_id (compat)', () => {
  it('ok:true, requestId null, sin noAsyncJobCode → missing_request_id', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: null }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, 'missing_request_id');
    // Sin trace → apollo_trace null.
    assert.equal(cap.logs[0].metadata.apollo_trace, null);
  });

  it('error real de Apollo (HTTP_422) preserva su código y adjunta trace si viene', async () => {
    const trace = baseTrace();
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: false, errorCode: 'HTTP_422', trace }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, 'HTTP_422');
    assert.deepEqual(cap.logs[0].metadata.apollo_trace, trace);
  });
});

// ── guard estático del cliente Apollo ──────────────────────────

describe('ASYNC-15 — guard estático apollo-client', () => {
  const CLIENT_REL = 'src/server/integrations/apollo-client.ts';
  const rawClient = readRepo(CLIENT_REL);
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const client = stripComments(rawClient);

  it('usa el interpreter puro para leer phone_enrichment', () => {
    assert.equal(/interpretApolloPhoneRevealStartResponse/.test(client), true);
  });

  it('envía el header X-Transaction-Id con un UUID (randomUUID)', () => {
    assert.equal(/randomUUID/.test(client), true);
    assert.equal(/OUTBOUND_TRANSACTION_HEADER/.test(client), true);
  });

  it('NO usa el request_id top-level de la respuesta como handle async', () => {
    // El fix ASYNC-15 eliminó `result.data?.request_id ?? async_task_id ?? id`.
    assert.equal(/data\?\.\s*request_id\s*\?\?/.test(client), false);
    assert.equal(/data\?\.\s*async_task_id/.test(client), false);
  });

  it('startApolloPhoneReveal existe y devuelve el handle del interpreter', () => {
    assert.equal(/export async function startApolloPhoneReveal/.test(client), true);
    assert.equal(/interpretation\.asyncRequestId/.test(client), true);
  });
});
