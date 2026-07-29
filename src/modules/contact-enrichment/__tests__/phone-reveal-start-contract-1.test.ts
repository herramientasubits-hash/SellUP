/**
 * Agente 2A — Apollo Phone Reveal START: invariante de recuperabilidad
 * (APOLLO-PHONE-REVEAL-START-CONTRACT-1)
 *
 * Pruebas offline/DI del core puro `runRevealCandidatePhone`. Sin red, sin
 * Supabase, sin proveedores reales.
 *
 * Contrato bajo prueba:
 *   Un candidato SOLO puede quedar en vuelo (`requested`/`pending`) si el START
 *   de Apollo devolvió un identificador ACTIVAMENTE recuperable
 *   (`trace.apollo_http_request_id`, el top-level request_id / x-http-request-id
 *   con el que el recovery hace GET /webhook_result/{id} — contrato ASYNC-21C).
 *
 *   * Con async handle (phone_enrichment.request_id) PERO sin
 *     apollo_http_request_id ⇒ el core marca `error`
 *     (error_code = 'missing_recovery_request_id'), NO `requested`, sin créditos,
 *     sin request_id persistido, y NUNCA toca el teléfono previo.
 *   * Con async handle Y apollo_http_request_id presente ⇒ `requested` normal.
 *   * trace ausente/null ⇒ tratado como sin id recuperable ⇒ `error`.
 *
 * Este es el fix del bug donde un reveal manual real quedaba en
 * "Revelación en proceso" para siempre sin un id recuperable válido.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runRevealCandidatePhone,
  MISSING_RECOVERY_REQUEST_ID_ERROR_CODE,
  type RevealCandidatePhoneInput,
  type RevealCandidatePhoneDeps,
  type RevealCandidateRecord,
  type ApolloPhoneRevealStartCallResult,
  type RevealStartPersistencePatch,
  type PhoneRevealUsageLogEntry,
} from '../phone-reveal-core';
import type { MatchPersonParams } from '@/server/integrations/apollo-client';
import type { ApolloPhoneRevealTraceMetadata } from '@/server/integrations/apollo-phone-reveal-response';

const NOW = '2026-07-28T20:27:22.000Z';
const ACTOR = { internalUserId: 'user-admin-1', roleKey: 'admin' };
const WEBHOOK_URL =
  'https://app.example.com/api/integrations/apollo/phone-reveal/webhook?token=secret';
const ASYNC_HANDLE = 'pe-async-handle-1';
const HTTP_REQUEST_ID = '-4594297923800105423';

function baseTrace(
  overrides: Partial<ApolloPhoneRevealTraceMetadata> = {},
): ApolloPhoneRevealTraceMetadata {
  return {
    apollo_async_request_id_present: true,
    apollo_phone_enrichment_request_id: ASYNC_HANDLE,
    apollo_phone_enrichment_present: true,
    apollo_phone_enrichment_status: 'pending',
    apollo_person_present: false,
    apollo_person_id_present: false,
    apollo_top_level_request_id_present: false,
    apollo_http_request_id: null,
    apollo_transaction_id: null,
    sellup_transaction_id: '11111111-2222-4333-8444-555555555555',
    apollo_transaction_echoed: false,
    webhook_ref: '11111111-2222-4333-8444-555555555555',
    ...overrides,
  };
}

function baseCandidate(
  overrides: Partial<RevealCandidateRecord> = {},
): RevealCandidateRecord {
  return {
    id: 'cand-46f7218e',
    accountId: 'acct-1',
    // El candidato del incidente era origen Lusha; el id no se reenvía a Apollo.
    source: 'lusha',
    sourceContactId: 'v1.some-lusha-token',
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

function validInput(
  overrides: Partial<RevealCandidatePhoneInput> = {},
): RevealCandidatePhoneInput {
  return {
    candidateId: 'cand-46f7218e',
    confirmCost: true,
    phoneProcessingBasis: 'legitimate_interest_b2b',
    ...overrides,
  };
}

let cap: Capture;
beforeEach(() => {
  cap = { apolloCalls: [], persisted: [], logs: [] };
});

// ── Camino roto: async handle SIN id recuperable → error ───────

describe('START-CONTRACT-1 — async handle sin apollo_http_request_id', () => {
  it('no deja `requested`: marca `error` con missing_recovery_request_id', async () => {
    const trace = baseTrace({ apollo_http_request_id: null });
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: ASYNC_HANDLE, trace }),
    );

    assert.equal(res.ok, false);
    assert.equal(res.status, 'error');
    assert.equal(res.requestAccepted, false);
    assert.equal(res.errorCode, MISSING_RECOVERY_REQUEST_ID_ERROR_CODE);
    assert.equal(MISSING_RECOVERY_REQUEST_ID_ERROR_CODE, 'missing_recovery_request_id');
  });

  it('persiste patch de error: sin request_id, sin créditos, sin teléfono', async () => {
    const trace = baseTrace({ apollo_http_request_id: null });
    await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: ASYNC_HANDLE, trace }),
    );

    assert.equal(cap.persisted.length, 1);
    const { patch } = cap.persisted[0];
    assert.equal(patch.phone_reveal_status, 'error');
    // El async handle NO se persiste como request_id (no es recuperable).
    assert.equal(patch.phone_reveal_request_id, null);
    assert.equal(patch.phone_reveal_error_code, MISSING_RECOVERY_REQUEST_ID_ERROR_CODE);
    assert.equal(patch.phone_reveal_cost_credits, null);
    assert.equal(patch.phone_reveal_cost_usd, null);
    // Estado terminal: completed_at fijado (no queda en vuelo).
    assert.equal(patch.phone_reveal_completed_at, NOW);
    assert.equal(patch.phone_reveal_attempt_count, 1);
    // El patch de start NO incluye la columna de teléfono (nunca la toca).
    assert.equal('phone' in patch, false);
  });

  it('usage-log de error: status error, has_request_id false, traza con apollo_http_request_id null, sin PII', async () => {
    const trace = baseTrace({ apollo_http_request_id: null });
    await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: ASYNC_HANDLE, trace }),
    );

    assert.equal(cap.logs.length, 1);
    const log = cap.logs[0];
    assert.equal(log.status, 'error');
    assert.equal(log.errorCode, MISSING_RECOVERY_REQUEST_ID_ERROR_CODE);
    assert.equal(log.creditsUsed, null);
    assert.equal(log.metadata.reveal_status, 'error');
    assert.equal(log.metadata.request_id, null);
    assert.equal(log.metadata.has_request_id, false);
    // La traza técnica se preserva para diagnóstico (apollo_http_request_id null).
    assert.equal(log.metadata.apollo_trace?.apollo_http_request_id, null);
    assert.equal(
      log.metadata.apollo_trace?.apollo_phone_enrichment_request_id,
      ASYNC_HANDLE,
    );
    // Sin PII del candidato en la metadata serializada.
    const serialized = JSON.stringify(log);
    assert.equal(serialized.includes('jane.doe@acme.com'), false);
    assert.equal(serialized.includes('linkedin.com/in/jane-doe'), false);
    assert.equal(serialized.includes('Jane'), false);
  });

  it('trace ausente (undefined) también bloquea `requested`', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: ASYNC_HANDLE }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, MISSING_RECOVERY_REQUEST_ID_ERROR_CODE);
    assert.equal(cap.persisted[0].patch.phone_reveal_status, 'error');
    assert.equal(cap.logs[0].metadata.apollo_trace, null);
  });

  it('apollo_http_request_id en blanco (solo espacios) se trata como ausente', async () => {
    const trace = baseTrace({ apollo_http_request_id: '   ' });
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: ASYNC_HANDLE, trace }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, MISSING_RECOVERY_REQUEST_ID_ERROR_CODE);
  });
});

// ── Camino feliz: async handle + id recuperable → requested ────

describe('START-CONTRACT-1 — async handle con apollo_http_request_id', () => {
  it('queda `requested` cuando el id recuperable está presente', async () => {
    const trace = baseTrace({
      apollo_top_level_request_id_present: true,
      apollo_http_request_id: HTTP_REQUEST_ID,
    });
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { ok: true, requestId: ASYNC_HANDLE, trace }),
    );

    assert.equal(res.ok, true);
    assert.equal(res.status, 'requested');
    assert.equal(res.requestAccepted, true);
    assert.equal(res.errorCode, null);

    const { patch } = cap.persisted[0];
    assert.equal(patch.phone_reveal_status, 'requested');
    assert.equal(patch.phone_reveal_request_id, ASYNC_HANDLE);
    assert.equal(patch.phone_reveal_completed_at, null);
    assert.equal(patch.phone_reveal_error_code, null);

    const log = cap.logs[0];
    assert.equal(log.metadata.reveal_status, 'requested');
    assert.equal(log.metadata.has_request_id, true);
    assert.equal(log.metadata.apollo_trace?.apollo_http_request_id, HTTP_REQUEST_ID);
  });
});

// ── No re-abre caminos de error previos (regresión) ────────────

describe('START-CONTRACT-1 — no altera los errores de START previos', () => {
  it('error real de Apollo conserva su código (no lo pisa el nuevo guard)', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        ok: false,
        errorCode: 'HTTP_422',
        trace: baseTrace({ apollo_http_request_id: null }),
      }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, 'HTTP_422');
  });

  it('200 sin job async conserva no_async_job_created (no lo pisa el nuevo guard)', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        ok: true,
        requestId: null,
        noAsyncJobCode: 'no_async_job_created',
        trace: baseTrace({
          apollo_async_request_id_present: false,
          apollo_phone_enrichment_request_id: null,
          apollo_http_request_id: null,
        }),
      }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, 'no_async_job_created');
  });
});
