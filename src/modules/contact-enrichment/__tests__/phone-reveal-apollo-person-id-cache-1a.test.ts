/**
 * Agente 2A — Persist Apollo person id (APOLLO-PHONE-CACHE-1a)
 *
 * Pruebas offline/DI de la captura del `apollo_person_id` en los tres caminos del
 * reveal (START / WEBHOOK / RECOVERY) y del parser de la respuesta START. Sin
 * red, sin Supabase, sin proveedores reales, sin caché.
 *
 * Contrato verificado:
 *   1. START con person.id válido → persiste apollo_person_id, status intacto,
 *      sin llamada extra a Apollo.
 *   2. START sin person.id → no falla; fallback a source_contact_id SOLO si el
 *      candidato es origen Apollo; si no, apollo_person_id = null.
 *   3. WEBHOOK revealed con people[0].id → persiste apollo_person_id + teléfono,
 *      phone_source = apollo_reveal intacto.
 *   4. WEBHOOK no_phone_found → no fuerza apollo_person_id si no existe (null);
 *      conserva no_phone_found.
 *   5. RECOVERY revealed con person.id → persiste apollo_person_id, comportamiento
 *      intacto.
 *   6. ID Lusha `v1.*` → nunca se persiste como apollo_person_id.
 *   7. Sin id válido resoluble → el patch lleva apollo_person_id null (el wrapper
 *      sólo escribe la columna cuando es truthy, nunca sobrescribe con null).
 *   8. Ningún teléfono/email/linkedin/nombre aparece en logs de tests.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runRevealCandidatePhone,
  type RevealCandidatePhoneInput,
  type RevealCandidatePhoneDeps,
  type RevealCandidateRecord,
  type ApolloPhoneRevealStartCallResult,
  type RevealStartPersistencePatch,
  type PhoneRevealUsageLogEntry,
} from '../phone-reveal-core';
import {
  runApolloPhoneRevealWebhook,
  extractWebhookPersonId,
  type ApolloPhoneRevealWebhookDeps,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
  type WebhookRevealPersistencePatch,
  type WebhookUsageLogEntry,
} from '../phone-reveal-webhook-core';
import {
  recoverApolloPhoneRevealForCandidate,
  type RecoveryCandidateRecord,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryPersistencePatch,
  type RecoveryUsageLogEntry,
} from '../phone-reveal-recovery-core';
import type { PollFetchResult } from '../phone-reveal-poll-core';
import {
  interpretApolloPhoneRevealStartResponse,
  type ApolloPhoneRevealTraceMetadata,
} from '@/server/integrations/apollo-phone-reveal-response';
import type { MatchPersonParams } from '@/server/integrations/apollo-client';

// Apollo person id = MongoDB ObjectId (24 hex).
const APOLLO_PERSON_ID = '6a6826ba804c600014ead739';
const APOLLO_PERSON_ID_2 = 'deadbeefdeadbeefdeadbeef';
const LUSHA_ID = 'v1.some-lusha-token';
const NOW = '2026-07-29T12:00:00.000Z';
const HTTP_REQUEST_ID = '-4594297923800105423';
const ASYNC_HANDLE = 'pe-async-handle-1';

// ── START ──────────────────────────────────────────────────────

const ACTOR = { internalUserId: 'user-admin-1', roleKey: 'admin' };
const WEBHOOK_URL =
  'https://app.example.com/api/integrations/apollo/phone-reveal/webhook?token=secret';

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
    apollo_top_level_request_id_present: true,
    apollo_http_request_id: HTTP_REQUEST_ID,
    apollo_transaction_id: null,
    sellup_transaction_id: '11111111-2222-4333-8444-555555555555',
    apollo_transaction_echoed: false,
    webhook_ref: '11111111-2222-4333-8444-555555555555',
    ...overrides,
  };
}

function startCandidate(
  overrides: Partial<RevealCandidateRecord> = {},
): RevealCandidateRecord {
  return {
    id: 'cand-1',
    accountId: 'acct-1',
    source: 'lusha',
    sourceContactId: LUSHA_ID,
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

interface StartCapture {
  apolloCalls: MatchPersonParams[];
  persisted: Array<{ id: string; patch: RevealStartPersistencePatch }>;
  logs: PhoneRevealUsageLogEntry[];
}

function startDeps(
  cap: StartCapture,
  apollo: ApolloPhoneRevealStartCallResult,
  candidate: RevealCandidateRecord,
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

function startInput(
  overrides: Partial<RevealCandidatePhoneInput> = {},
): RevealCandidatePhoneInput {
  return {
    candidateId: 'cand-1',
    confirmCost: true,
    phoneProcessingBasis: 'legitimate_interest_b2b',
    ...overrides,
  };
}

let sc: StartCapture;
beforeEach(() => {
  sc = { apolloCalls: [], persisted: [], logs: [] };
});

describe('CACHE-1a START — captura apollo_person_id', () => {
  it('TEST 1: START con person.id válido → persiste apollo_person_id, status requested, sin llamada extra', async () => {
    const trace = baseTrace({
      apollo_person_present: true,
      apollo_person_id_present: true,
      apollo_person_id: APOLLO_PERSON_ID,
    });
    const res = await runRevealCandidatePhone(
      startInput(),
      startDeps(
        sc,
        { ok: true, requestId: ASYNC_HANDLE, trace },
        // Identidad evaluable para la supresión (AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1):
        // origen Apollo con source_contact_id válido (APOLLO_PERSON_ID_2), DISTINTO
        // del id que trae la respuesta START (APOLLO_PERSON_ID). Prueba a la vez que
        // la supresión pre-check no bloquea con identidad evaluable Y que el id
        // PERSISTIDO viene de la traza de Apollo, no del fallback de
        // source_contact_id (prioridad ya cubierta por TEST 2a).
        startCandidate({ source: 'apollo', sourceContactId: APOLLO_PERSON_ID_2 }),
      ),
    );

    assert.equal(res.status, 'requested');
    assert.equal(res.ok, true);
    assert.equal(sc.apolloCalls.length, 1); // sólo el START, sin provider extra
    assert.equal(sc.persisted.length, 1);
    assert.equal(sc.persisted[0].patch.apollo_person_id, APOLLO_PERSON_ID);
    assert.equal(sc.persisted[0].patch.phone_reveal_status, 'requested');
  });

  it('TEST 2a: START sin person.id, candidato Apollo con source_contact_id válido → fallback', async () => {
    const res = await runRevealCandidatePhone(
      startInput(),
      startDeps(
        sc,
        { ok: true, requestId: ASYNC_HANDLE, trace: baseTrace() },
        startCandidate({ source: 'apollo', sourceContactId: APOLLO_PERSON_ID_2 }),
      ),
    );
    assert.equal(res.status, 'requested');
    assert.equal(sc.persisted[0].patch.apollo_person_id, APOLLO_PERSON_ID_2);
  });

  // TEST 2b — RE-ESPECIFICADO DOS VECES, y merece explicarse porque la historia es la del
  // hito entero:
  //
  //   * originalmente el candidato de Lusha sin id de Apollo pasaba de largo: la supresión
  //     se auditaba y el reveal CONTINUABA (fail-open). El título decía "no falla";
  //   * #289 lo pasó a BLOQUEAR con `suppression_check_unavailable`, porque "no pude
  //     confirmar que no está suprimido" no equivale a "no está suprimido";
  //   * la Fase 1 hace lo que ninguna de las dos podía: EVALUARLO. El `source_contact_id`
  //     de Lusha es su identidad nativa, así que la supresión se consulta con
  //     `provider: 'lusha'` y —sin supresión registrada— el reveal continúa por la razón
  //     correcta: porque se comprobó.
  //
  // Lo que sigue estando prohibido: usar el id de Lusha como id de APOLLO. Se comprueba
  // abajo (`apollo_person_id` persistido = null).
  it('FASE 1: candidato Lusha sin id de Apollo se EVALÚA con identidad de Lusha y continúa', async () => {
    const res = await runRevealCandidatePhone(
      startInput(),
      startDeps(
        sc,
        { ok: true, requestId: ASYNC_HANDLE, trace: baseTrace() },
        startCandidate(), // source lusha, sourceContactId v1.*, sin apollo_person_id
      ),
    );
    assert.equal(res.ok, true);
    assert.equal(res.status, 'requested');
    assert.equal(sc.apolloCalls.length, 1);
    // El id de Lusha NO se promociona a identidad de Apollo en ningún punto.
    assert.equal(sc.persisted[0].patch.apollo_person_id, null);
  });

  it('TEST 6 (RE-SPECIFY, AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1): id Lusha v1.* nunca resuelve identidad ⇒ BLOQUEADO, no "requested" con id null', async () => {
    // Candidato mal etiquetado como apollo pero con id v1.*: el validador lo
    // rechaza igual que antes (no es un id Apollo), así que la clave de
    // supresión tampoco se puede resolver. Antes de este hito eso dejaba
    // pasar el reveal con apollo_person_id null; ahora, sin clave posible,
    // BLOQUEA — el mismo desenlace que TEST 2b, con una causa distinta (id de
    // forma inválida en vez de origen no-Apollo).
    const res = await runRevealCandidatePhone(
      startInput(),
      startDeps(
        sc,
        { ok: true, requestId: ASYNC_HANDLE, trace: baseTrace() },
        startCandidate({ source: 'apollo', sourceContactId: LUSHA_ID }),
      ),
    );
    assert.equal(res.ok, false);
    assert.equal(res.status, 'suppression_check_unavailable');
    assert.equal(sc.apolloCalls.length, 0);
    assert.equal(sc.persisted.length, 0);
  });

  it('TEST 7: START error → patch lleva apollo_person_id null (el wrapper no sobrescribe)', async () => {
    const res = await runRevealCandidatePhone(
      startInput(),
      startDeps(
        sc,
        { ok: false, errorCode: 'HTTP_422', trace: baseTrace() },
        startCandidate({ source: 'apollo', sourceContactId: APOLLO_PERSON_ID }),
      ),
    );
    assert.equal(res.status, 'error');
    assert.equal(sc.persisted[0].patch.phone_reveal_status, 'error');
    // En error no se persiste id (aunque el candidato tuviese uno válido): null.
    assert.equal(sc.persisted[0].patch.apollo_person_id, null);
  });

  it('TEST 8: sin PII del candidato en el patch/log serializado', async () => {
    const trace = baseTrace({ apollo_person_id: APOLLO_PERSON_ID });
    await runRevealCandidatePhone(
      startInput(),
      startDeps(
        sc,
        { ok: true, requestId: ASYNC_HANDLE, trace },
        // Identidad evaluable (AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1): sin ella el
        // START bloquea en el gate de supresión ANTES de llamar a persist/logUsage,
        // y la aserción de "sin PII" pasaría vacía (patch/log nunca se crean) en
        // vez de ejercer de verdad la ausencia de PII sobre un patch/log reales.
        startCandidate({ source: 'apollo', sourceContactId: APOLLO_PERSON_ID_2 }),
      ),
    );
    assert.equal(sc.persisted.length, 1);
    assert.equal(sc.logs.length, 1);
    const serialized = JSON.stringify({ persisted: sc.persisted, logs: sc.logs });
    assert.equal(serialized.includes('jane.doe@acme.com'), false);
    assert.equal(serialized.includes('linkedin.com/in/jane-doe'), false);
    assert.equal(serialized.includes('Jane'), false);
  });
});

// ── WEBHOOK ────────────────────────────────────────────────────

const TOKEN = 'webhook-secret-token';

function webhookCandidate(
  overrides: Partial<WebhookCandidateRecord> = {},
): WebhookCandidateRecord {
  return {
    id: 'cand-1',
    accountId: 'acct-1',
    enrichmentMetadata: {},
    phoneRevealStatus: 'requested',
    ...overrides,
  };
}

interface WebhookCapture {
  persisted: Array<{ id: string; patch: WebhookRevealPersistencePatch }>;
  logs: WebhookUsageLogEntry[];
}

function webhookDeps(
  cap: WebhookCapture,
  candidate: WebhookCandidateRecord | null,
): ApolloPhoneRevealWebhookDeps {
  return {
    expectedToken: TOKEN,
    nowIso: NOW,
    loadCandidateByRequestId: async () => candidate,
    persist: async (id, patch) => {
      cap.persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      cap.logs.push(entry);
    },
    // FIX 3: cuando llega un teléfono la comprobación de supresión en vuelo es
    // OBLIGATORIA, así que estas pruebas de CACHE-1a la cablean como "sin
    // tombstone" para aislar lo que miden (la captura del apollo_person_id). Sin
    // la dep el core es fail-closed (`suppression_check_unavailable`) y no
    // persiste nada; ese comportamiento se prueba en el suite de FIX 3.
    lookupPhoneCacheSuppression: async () => null,
  };
}

describe('CACHE-1a WEBHOOK — captura apollo_person_id', () => {
  it('TEST 3: webhook revealed con people[0].id → persiste apollo_person_id + teléfono, phone_source apollo_reveal', async () => {
    const cap: WebhookCapture = { persisted: [], logs: [] };
    const payload: ApolloPhoneRevealWebhookPayload = {
      request_id: 'apollo-req-1',
      people: [
        {
          id: APOLLO_PERSON_ID,
          phone_numbers: [
            { sanitized_number: '+573001112233', type_cd: 'mobile', credits_consumed: 8 },
          ],
        },
      ],
    };
    const res = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload },
      webhookDeps(cap, webhookCandidate()),
    );
    assert.equal(res.outcome, 'revealed');
    const { patch } = cap.persisted[0];
    assert.equal(patch.apollo_person_id, APOLLO_PERSON_ID);
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.enrichment_metadata?.phone?.source, 'apollo_reveal');
    assert.equal(typeof patch.phone, 'string');
  });

  it('TEST 3b: webhook revealed con person.id (variante singular) → persiste apollo_person_id', async () => {
    const cap: WebhookCapture = { persisted: [], logs: [] };
    const payload: ApolloPhoneRevealWebhookPayload = {
      request_id: 'apollo-req-1',
      person: {
        id: APOLLO_PERSON_ID_2,
        phone_numbers: [{ sanitized_number: '+571234567', type_cd: 'work' }],
      },
    };
    const res = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload },
      webhookDeps(cap, webhookCandidate()),
    );
    assert.equal(res.outcome, 'revealed');
    assert.equal(cap.persisted[0].patch.apollo_person_id, APOLLO_PERSON_ID_2);
  });

  it('TEST 4: webhook no_phone_found sin person id → apollo_person_id null, conserva no_phone_found', async () => {
    const cap: WebhookCapture = { persisted: [], logs: [] };
    const payload: ApolloPhoneRevealWebhookPayload = {
      request_id: 'apollo-req-1',
      phone_numbers: [],
    };
    const res = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload },
      webhookDeps(cap, webhookCandidate()),
    );
    assert.equal(res.outcome, 'no_phone_found');
    assert.equal(cap.persisted[0].patch.phone_reveal_status, 'no_phone_found');
    assert.equal(cap.persisted[0].patch.apollo_person_id, null);
  });

  it('TEST 6 (webhook, RE-SPECIFY AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1): people[0].id Lusha v1.* y candidato sin identidad propia ⇒ BLOQUEADO, no "revealed" con id null', async () => {
    // El id del payload es Lusha-shaped (rechazado por el validador Apollo) y el
    // candidato tampoco trae apollo_person_id/source Apollo propios, así que la
    // clave de supresión no se puede resolver por NINGUNA vía. Antes de este
    // hito eso dejaba pasar el teléfono con apollo_person_id null; ahora
    // bloquea igual que `suppression_check_unavailable` — NO se persiste el
    // teléfono, el candidato sigue en vuelo (recuperable sin gastar créditos).
    const cap: WebhookCapture = { persisted: [], logs: [] };
    const payload: ApolloPhoneRevealWebhookPayload = {
      request_id: 'apollo-req-1',
      people: [
        {
          id: LUSHA_ID,
          phone_numbers: [{ sanitized_number: '+573001112233', type_cd: 'mobile' }],
        },
      ],
    };
    const res = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload },
      webhookDeps(cap, webhookCandidate()),
    );
    assert.equal(res.outcome, 'suppression_check_unavailable');
    assert.equal(cap.persisted.length, 0);
  });

  it('extractWebhookPersonId prioriza people[0].id sobre person.id', () => {
    assert.equal(
      extractWebhookPersonId({
        people: [{ id: APOLLO_PERSON_ID }],
        person: { id: APOLLO_PERSON_ID_2 },
      }),
      APOLLO_PERSON_ID,
    );
    assert.equal(extractWebhookPersonId({ person: { id: APOLLO_PERSON_ID_2 } }), APOLLO_PERSON_ID_2);
    assert.equal(extractWebhookPersonId(null), null);
    assert.equal(extractWebhookPersonId({}), null);
  });
});

// ── RECOVERY ───────────────────────────────────────────────────

const RECOVERY_ID = HTTP_REQUEST_ID;

function recoveryCandidate(
  overrides: Partial<RecoveryCandidateRecord> = {},
): RecoveryCandidateRecord {
  return {
    id: 'cand-1',
    accountId: 'acct-1',
    phoneRevealProvider: 'apollo',
    source: 'lusha',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    ...overrides,
  };
}

interface RecoveryCapture {
  patches: Array<{ id: string; patch: RecoveryPersistencePatch }>;
  logs: RecoveryUsageLogEntry[];
}

function recoveryDeps(
  cap: RecoveryCapture,
  fetch: (rid: string) => Promise<PollFetchResult>,
  candidate: RecoveryCandidateRecord = recoveryCandidate(),
): RecoverApolloPhoneRevealDeps {
  return {
    nowIso: NOW,
    loadCandidate: async () => candidate,
    resolveRecoveryRequestId: async () => RECOVERY_ID,
    fetchWebhookResult: fetch,
    persist: async (id, patch) => {
      cap.patches.push({ id, patch });
    },
    logUsage: async (entry) => {
      cap.logs.push(entry);
    },
    // FIX 3: igual que en el webhook — sin tombstone, para aislar la captura del
    // apollo_person_id del cumplimiento de la supresión.
    lookupPhoneCacheSuppression: async () => null,
  };
}

describe('CACHE-1a RECOVERY — captura apollo_person_id', () => {
  it('TEST 5: recovery revealed con person id → persiste apollo_person_id, comportamiento intacto', async () => {
    const cap: RecoveryCapture = { patches: [], logs: [] };
    const payload: ApolloPhoneRevealWebhookPayload = {
      request_id: RECOVERY_ID,
      people: [
        {
          id: APOLLO_PERSON_ID,
          phone_numbers: [
            { sanitized_number: '+573001112233', type_cd: 'mobile', credits_consumed: 8 },
          ],
        },
      ],
    };
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      recoveryDeps(cap, async () => ({ kind: 'result', payload })),
    );
    assert.equal(res.outcome, 'revealed');
    assert.equal(res.phoneRevealed, true);
    const { patch } = cap.patches[0];
    assert.equal(patch.apollo_person_id, APOLLO_PERSON_ID);
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.enrichment_metadata?.phone?.source, 'apollo_reveal');
  });

  it('TEST 5b: recovery no_phone_found sin person id → apollo_person_id null', async () => {
    const cap: RecoveryCapture = { patches: [], logs: [] };
    const payload: ApolloPhoneRevealWebhookPayload = { request_id: RECOVERY_ID, phone_numbers: [] };
    const res = await recoverApolloPhoneRevealForCandidate(
      { candidateId: 'cand-1' },
      recoveryDeps(cap, async () => ({ kind: 'result', payload })),
    );
    assert.equal(res.outcome, 'no_phone_found');
    assert.equal(cap.patches[0].patch.apollo_person_id, null);
  });
});

// ── Parser de la respuesta START ───────────────────────────────

describe('CACHE-1a parser START — trace.apollo_person_id validado', () => {
  const interpret = (body: unknown) =>
    interpretApolloPhoneRevealStartResponse({
      body: body as never,
      getHeader: () => null,
      outboundTransactionId: null,
    });

  it('person.id Apollo válido → trace.apollo_person_id poblado', () => {
    const r = interpret({ person: { id: APOLLO_PERSON_ID } });
    assert.equal(r.trace.apollo_person_id, APOLLO_PERSON_ID);
    assert.equal(r.trace.apollo_person_id_present, true);
  });

  it('person.id no-Apollo (p-1) → present true pero apollo_person_id null', () => {
    const r = interpret({ person: { id: 'p-1' } });
    assert.equal(r.trace.apollo_person_id_present, true);
    assert.equal(r.trace.apollo_person_id, null);
  });

  it('person.id Lusha v1.* → apollo_person_id null', () => {
    const r = interpret({ person: { id: LUSHA_ID } });
    assert.equal(r.trace.apollo_person_id, null);
  });

  it('sin person → apollo_person_id null', () => {
    const r = interpret({ phone_enrichment: { request_id: 'pe-1' } });
    assert.equal(r.trace.apollo_person_id, null);
  });
});
