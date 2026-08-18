/**
 * Agente 2A — APOLLO-PHONE-CACHE-1b · FIX 4 — ALERTA DE "NO EVALUABLE"
 *
 * FIX 2 hizo que el START consulte el tombstone antes de llamar a Apollo y FIX 3
 * cerró el hueco en vuelo (webhook / recovery). En los tres casos la clave es
 * (apollo, provider_person_id, account_id), así que queda un límite estructural:
 * sin Apollo person id resoluble —o sin cuenta— no hay clave con la que emparejar
 * una supresión y la comprobación NO se puede hacer.
 *
 * Ese límite se conserva a propósito. Lo que FIX 4 fija es que el caso deje de ser
 * invisible:
 *
 *   1. START sin person id / sin cuenta ⇒ evento PII-free `phase = start` y
 *      `suppression_state = not_evaluable_*`, y el mismo estado en el usage-log.
 *   2. WEBHOOK con teléfono y sin clave ⇒ evento PII-free `phase = webhook`.
 *   3. RECOVERY con teléfono y sin clave ⇒ evento PII-free `phase = recovery`.
 *   4. El evento NO lleva teléfono, email, nombre, LinkedIn ni payload crudo, y
 *      tampoco el person id (ni hasheado).
 *   5. AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1: el desenlace SÍ cambió — no_evaluable
 *      ahora BLOQUEA fail-closed (mismo estado que `check_unavailable`, sin
 *      vocabulario nuevo). Lo que NO cambió es la política de identificación: no
 *      hay bloqueo por inferencia, no hay fuzzy matching, no hay backfill del id
 *      que falta, y un sumidero que lanza no rompe el reveal.
 *
 * Todo es offline y determinista: sin red, sin Supabase, sin proveedores, sin
 * flags reales. Los teléfonos son del rango sintético +1555… y los ids son
 * opacos e inventados.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildPhoneSuppressionNotEvaluableEvent,
  notEvaluableAuditState,
  reportPhoneSuppressionNotEvaluable,
  type PhoneSuppressionNotEvaluableEvent,
} from '../phone-reveal-suppression-audit';
import {
  runRevealCandidatePhone,
  type ApolloPhoneRevealStartCallResult,
  type PhoneRevealUsageLogEntry,
  type RevealCandidatePhoneDeps,
  type RevealCandidatePhoneInput,
  type RevealCandidateRecord,
  type RevealStartPersistencePatch,
} from '../phone-reveal-core';
import {
  runApolloPhoneRevealWebhook,
  type ApolloPhoneRevealWebhookDeps,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
  type WebhookUsageLogEntry,
} from '../phone-reveal-webhook-core';
import {
  recoverApolloPhoneRevealForCandidate,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
  type RecoveryUsageLogEntry,
} from '../phone-reveal-recovery-core';
import { SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE } from '../phone-reveal-suppression-guard';
import type { PhoneRevealSuppressionLookupKey } from '../provider-suppression-core';
import type { MatchPersonParams } from '@/server/integrations/apollo-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

// ── Fixtures ───────────────────────────────────────────────────

const NOW = '2026-07-29T19:00:00.000Z';
const TOKEN = 'webhook-secret-token';
const REQUEST_ID = 'apollo-req-fix4';
const RECOVERY_ID = '-4594297923800105423';
const CANDIDATE_ID = 'cand-fix4';
const ACCOUNT_ID = 'acct-fix4';
/** Id Apollo válido (24 hex), opaco e inventado. */
const PERSON_ID = 'b1c2d3e4f5061728394a5b6c';
/** Id de OTRO proveedor (Lusha): nunca puede servir de clave Apollo. */
const LUSHA_ID = 'v1.9d2f7a1c';

/**
 * FASE 1 (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4) — override que produce un candidato
 * SIN NINGUNA identidad nativa de proveedor, que es el único caso que sigue siendo
 * `not_evaluable`.
 *
 * Hasta la Fase 1 bastaba con `NO_NATIVE_IDENTITY`: la resolución
 * sólo miraba a Apollo, así que un candidato de Lusha no tenía clave por construcción.
 * Ahora un candidato de Lusha SÍ tiene identidad —su `source_contact_id`—, de modo que ese
 * override ya no describe «sin clave»: describe «con clave de Lusha».
 *
 * Este fixture usa un origen sin supresión propia (`hubspot`) y sin `source_contact_id`,
 * que es lo que de verdad no se puede evaluar. La INTENCIÓN de los tests que lo usan no
 * cambia: «cuando la privacidad no se puede evaluar, se BLOQUEA y se audita».
 */
const NO_NATIVE_IDENTITY = {
  apolloPersonId: null,
  source: 'hubspot' as const,
  sourceContactId: null,
};
/** Teléfono sintético (rango reservado +1555). No es de nadie. */
const PHONE = '+15550100042';
/** Datos de contacto ficticios: se usan para comprobar que NO se publican. */
const CONTACT_MAIL = 'contacto@empresa-ejemplo.test';
const CONTACT_LINKEDIN = 'https://www.linkedin.com/in/persona-ejemplo';
const FIRST_NAME = 'Nombre';
const LAST_NAME = 'Apellido';
const WEBHOOK_URL = 'https://app.example.com/api/hook?token=secret';
const HTTP_REQUEST_ID = '-1111222233334444';

// ── Captura común ──────────────────────────────────────────────

interface Capture {
  events: PhoneSuppressionNotEvaluableEvent[];
  apolloStarts: MatchPersonParams[];
  webhookFetches: string[];
  startPatches: RevealStartPersistencePatch[];
  persisted: Array<Record<string, unknown>>;
  startLogs: PhoneRevealUsageLogEntry[];
  webhookLogs: WebhookUsageLogEntry[];
  recoveryLogs: RecoveryUsageLogEntry[];
  suppressionLookups: PhoneRevealSuppressionLookupKey[];
}

let cap: Capture;
beforeEach(() => {
  cap = {
    events: [],
    apolloStarts: [],
    webhookFetches: [],
    startPatches: [],
    persisted: [],
    startLogs: [],
    webhookLogs: [],
    recoveryLogs: [],
    suppressionLookups: [],
  };
});

/** Serializa TODO lo observable para auditar ausencia de PII. */
function observable(): string {
  return JSON.stringify(cap);
}

function assertEventsHaveNoPii(): void {
  const dump = JSON.stringify(cap.events);
  for (const secret of [
    PHONE,
    '5550100042',
    CONTACT_MAIL,
    CONTACT_LINKEDIN,
    FIRST_NAME,
    LAST_NAME,
    PERSON_ID,
    LUSHA_ID,
  ]) {
    assert.equal(
      dump.includes(secret),
      false,
      `el evento de auditoría no puede publicar ${secret}`,
    );
  }
}

/** La forma del evento está cerrada: exactamente estas cinco claves. */
function assertEventShape(event: PhoneSuppressionNotEvaluableEvent): void {
  assert.deepEqual(Object.keys(event).sort(), [
    'account_id',
    'candidate_id',
    'phase',
    'provider',
    'suppression_state',
  ]);
  assert.equal(event.provider, 'apollo');
}

// ── Fábricas START ─────────────────────────────────────────────

const VALID_INPUT: RevealCandidatePhoneInput = {
  candidateId: CANDIDATE_ID,
  confirmCost: true,
  phoneProcessingBasis: 'legitimate_interest_b2b',
};

function startCandidate(
  overrides: Partial<RevealCandidateRecord> = {},
): RevealCandidateRecord {
  return {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_ID,
    source: 'apollo',
    sourceContactId: PERSON_ID,
    email: CONTACT_MAIL,
    linkedinUrl: CONTACT_LINKEDIN,
    firstName: FIRST_NAME,
    lastName: LAST_NAME,
    organizationName: 'Empresa Ejemplo',
    existingPhone: null,
    enrichmentMetadata: {} as never,
    phoneRevealStatus: null,
    phoneRevealAttemptCount: 0,
    apolloPersonId: PERSON_ID,
    candidateCountry: 'CO',
    runCompanyCountryCode: 'CO',
    ...overrides,
  };
}

function startDeps(
  record: RevealCandidateRecord = startCandidate(),
  overrides: Partial<RevealCandidatePhoneDeps> = {},
): RevealCandidatePhoneDeps {
  return {
    flagEnabled: true,
    actor: { internalUserId: 'user-admin-1', roleKey: 'admin' },
    nowIso: NOW,
    webhookUrl: WEBHOOK_URL,
    loadCandidate: async () => record,
    isDoNotContact: async () => false,
    startRevealViaApollo: async (
      params,
    ): Promise<ApolloPhoneRevealStartCallResult> => {
      cap.apolloStarts.push(params);
      return {
        ok: true,
        requestId: REQUEST_ID,
        trace: { apollo_http_request_id: HTTP_REQUEST_ID } as never,
      };
    },
    persist: async (_id, patch) => {
      cap.startPatches.push(patch);
    },
    logUsage: async (entry) => {
      cap.startLogs.push(entry);
    },
    // Cableada SIEMPRE, como en el wrapper de producción (no depende del flag).
    lookupPhoneCacheSuppression: async (key) => {
      cap.suppressionLookups.push(key);
      return null;
    },
    onSuppressionNotEvaluable: (event) => {
      cap.events.push(event);
    },
    // Flag de caché APAGADO: es el default de producción y deja claro que la
    // auditoría de la supresión no depende de `ENABLE_APOLLO_PHONE_CACHE`.
    cacheEnabled: false,
    ...overrides,
  };
}

// ── Fábricas WEBHOOK ───────────────────────────────────────────

function webhookCandidate(
  overrides: Partial<WebhookCandidateRecord> = {},
): WebhookCandidateRecord {
  return {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_ID,
    enrichmentMetadata: {},
    phoneRevealStatus: 'requested',
    candidateCountry: 'Colombia',
    runCompanyCountryCode: 'CO',
    apolloPersonId: PERSON_ID,
    source: 'apollo',
    ...overrides,
  };
}

function webhookPayload(
  overrides: Partial<ApolloPhoneRevealWebhookPayload> = {},
): ApolloPhoneRevealWebhookPayload {
  return {
    request_id: REQUEST_ID,
    person: {
      id: PERSON_ID,
      phone_numbers: [{ sanitized_number: PHONE, type_cd: 'mobile' }],
    },
    ...overrides,
  };
}

/** Payload cuyo person id NO es Apollo: no puede servir de clave. */
function payloadWithoutApolloPersonId(): ApolloPhoneRevealWebhookPayload {
  return {
    request_id: REQUEST_ID,
    person: {
      id: LUSHA_ID,
      // El payload trae datos de contacto: si algo los filtrara al evento, la
      // aserción PII-free lo detectaría.
      email: CONTACT_MAIL,
      linkedin_url: CONTACT_LINKEDIN,
      first_name: FIRST_NAME,
      last_name: LAST_NAME,
      phone_numbers: [{ sanitized_number: PHONE, type_cd: 'mobile' }],
    },
  } as ApolloPhoneRevealWebhookPayload;
}

function webhookDeps(
  record: WebhookCandidateRecord = webhookCandidate(),
  overrides: Partial<ApolloPhoneRevealWebhookDeps> = {},
): ApolloPhoneRevealWebhookDeps {
  return {
    expectedToken: TOKEN,
    nowIso: NOW,
    loadCandidateByRequestId: async () => record,
    persist: async (_id, patch) => {
      cap.persisted.push(patch as unknown as Record<string, unknown>);
    },
    logUsage: async (entry) => {
      cap.webhookLogs.push(entry);
    },
    lookupPhoneCacheSuppression: async (key) => {
      cap.suppressionLookups.push(key);
      return null;
    },
    onSuppressionNotEvaluable: (event) => {
      cap.events.push(event);
    },
    ...overrides,
  };
}

// ── Fábricas RECOVERY ──────────────────────────────────────────

function recoveryCandidate(
  overrides: Partial<RecoveryCandidateRecord> = {},
): RecoveryCandidateRecord {
  return {
    id: CANDIDATE_ID,
    accountId: ACCOUNT_ID,
    phoneRevealProvider: 'apollo',
    source: 'apollo',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    apolloPersonId: PERSON_ID,
    candidateCountry: 'Colombia',
    runCompanyCountryCode: 'CO',
    ...overrides,
  };
}

function recoveryDeps(
  record: RecoveryCandidateRecord = recoveryCandidate(),
  payload: ApolloPhoneRevealWebhookPayload = webhookPayload(),
  overrides: Partial<RecoverApolloPhoneRevealDeps> = {},
): RecoverApolloPhoneRevealDeps {
  return {
    nowIso: NOW,
    loadCandidate: async () => record,
    resolveRecoveryRequestId: async () => RECOVERY_ID,
    fetchWebhookResult: async (id) => {
      cap.webhookFetches.push(id);
      return { kind: 'result', payload };
    },
    persist: async (_id, patch) => {
      cap.persisted.push(patch as unknown as Record<string, unknown>);
    },
    logUsage: async (entry) => {
      cap.recoveryLogs.push(entry);
    },
    lookupPhoneCacheSuppression: async (key) => {
      cap.suppressionLookups.push(key);
      return null;
    },
    onSuppressionNotEvaluable: (event) => {
      cap.events.push(event);
    },
    ...overrides,
  };
}

// ── 1. Módulo puro de auditoría ────────────────────────────────

describe('FIX 4 — evento de auditoría (módulo puro)', () => {
  it('traduce cada motivo a su estado de auditoría', () => {
    assert.equal(
      notEvaluableAuditState('missing_provider_person_id'),
      'not_evaluable_missing_provider_person_id',
    );
    assert.equal(
      notEvaluableAuditState('missing_account_id'),
      'not_evaluable_missing_account_id',
    );
  });

  it('construye un evento con la allowlist de campos y nada más', () => {
    const event = buildPhoneSuppressionNotEvaluableEvent({
      phase: 'start',
      reason: 'missing_provider_person_id',
      candidateId: CANDIDATE_ID,
      accountId: ACCOUNT_ID,
    });
    assertEventShape(event);
    assert.deepEqual(event, {
      provider: 'apollo',
      phase: 'start',
      suppression_state: 'not_evaluable_missing_provider_person_id',
      candidate_id: CANDIDATE_ID,
      account_id: ACCOUNT_ID,
    });
  });

  it('normaliza una cuenta vacía a null (no publica cadenas basura)', () => {
    const event = buildPhoneSuppressionNotEvaluableEvent({
      phase: 'webhook',
      reason: 'missing_account_id',
      candidateId: CANDIDATE_ID,
      accountId: '   ',
    });
    assert.equal(event.account_id, null);
  });

  it('emite al sumidero y devuelve el mismo evento', () => {
    const event = reportPhoneSuppressionNotEvaluable({
      phase: 'recovery',
      reason: 'missing_provider_person_id',
      candidateId: CANDIDATE_ID,
      accountId: ACCOUNT_ID,
      sink: (e) => cap.events.push(e),
    });
    assert.deepEqual(cap.events, [event]);
    assert.equal(event.phase, 'recovery');
  });

  it('sin sumidero no lanza (la auditoría es opcional, no un gate)', () => {
    assert.doesNotThrow(() =>
      reportPhoneSuppressionNotEvaluable({
        phase: 'start',
        reason: 'missing_account_id',
        candidateId: CANDIDATE_ID,
        accountId: null,
      }),
    );
  });

  it('un sumidero que LANZA no propaga: la observación no decide nada', () => {
    assert.doesNotThrow(() =>
      reportPhoneSuppressionNotEvaluable({
        phase: 'webhook',
        reason: 'missing_provider_person_id',
        candidateId: CANDIDATE_ID,
        accountId: ACCOUNT_ID,
        sink: () => {
          throw new Error('sumidero caído');
        },
      }),
    );
  });
});

// ── 2. START ───────────────────────────────────────────────────

describe('FIX 4 / P0 — START registra el caso no evaluable Y AHORA BLOQUEA', () => {
  it('P0: sin Apollo person id resoluble ⇒ BLOQUEA fail-closed (antes: requested)', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      startDeps(
        startCandidate({
          ...NO_NATIVE_IDENTITY,
        }),
      ),
    );

    assert.equal(result.ok, false);
    assert.equal(result.status, 'suppression_check_unavailable');
    assert.equal(result.errorCode, 'suppression_check_unavailable');
    assert.equal(result.requestAccepted, false);
    assert.equal(cap.events.length, 1);
    assertEventShape(cap.events[0]);
    assert.deepEqual(cap.events[0], {
      provider: 'apollo',
      phase: 'start',
      suppression_state: 'not_evaluable_missing_provider_person_id',
      candidate_id: CANDIDATE_ID,
      account_id: ACCOUNT_ID,
    });
    // Sin clave no se consulta el tombstone (no hay nada que emparejar)…
    assert.deepEqual(cap.suppressionLookups, []);
    // …ni se llama a Apollo, ni se persiste nada, ni se escribe usage-log del
    // START: el bloqueo comparte EXACTAMENTE el camino de `check_unavailable`
    // (que tampoco escribe usage-log en el START).
    assert.equal(cap.apolloStarts.length, 0, 'Apollo NUNCA se llama');
    assert.equal(cap.startPatches.length, 0);
    assert.equal(cap.startLogs.length, 0);
    assertEventsHaveNoPii();
  });

  // FASE 1 — RE-ESPECIFICADO. Este test afirmaba que la falta de cuenta era un fallo de
  // privacidad: bloqueaba y emitía `not_evaluable_missing_account_id`. Eso era una
  // consecuencia de haber heredado la clave de la CACHÉ, no una decisión de privacidad, y
  // es exactamente lo que la Fase 1 corrige. Ahora la identidad de Apollo se consulta con
  // normalidad, la cuenta viaja nula en la clave y NO produce ningún evento.
  //
  // La garantía sigue intacta: el reveal continúa sólo porque la supresión SE CONSULTÓ y
  // volvió vacía, nunca porque no se pudiera consultar.
  it('FASE 1: sin account_id la supresión SÍ se evalúa — ni bloqueo ni evento', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      startDeps(startCandidate({ accountId: null })),
    );

    assert.equal(result.status, 'requested');
    assert.deepEqual(cap.events, [], 'sin cuenta ya NO es "no evaluable"');
    assert.equal(cap.suppressionLookups.length, 1, 'la consulta SÍ ocurre');
    assert.equal(cap.suppressionLookups[0].provider, 'apollo');
    assert.equal(cap.suppressionLookups[0].accountId, null);
    assert.equal(cap.apolloStarts.length, 1, 'el reveal llega a Apollo');
    assert.equal(
      cap.startLogs[0].metadata.suppression_state,
      'checked_not_suppressed',
    );
    assertEventsHaveNoPii();
  });


  it('con clave completa NO se emite evento: la comprobación sí se hizo', async () => {
    const result = await runRevealCandidatePhone(VALID_INPUT, startDeps());

    assert.equal(result.status, 'requested');
    assert.deepEqual(cap.events, []);
    assert.equal(cap.suppressionLookups.length, 1);
    assert.equal(
      cap.startLogs[0].metadata.suppression_state,
      'checked_not_suppressed',
    );
  });

  it('P0: el bloqueo corre ANTES de Apollo — un START que fallaría igual nunca se invoca', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      startDeps(startCandidate(NO_NATIVE_IDENTITY), {
        startRevealViaApollo: async (params) => {
          cap.apolloStarts.push(params);
          return { ok: false, errorCode: 'apollo_reveal_start_failed' } as never;
        },
      }),
    );

    assert.equal(result.status, 'suppression_check_unavailable');
    assert.equal(cap.events.length, 1);
    // La prueba de que el gate corre ANTES de Apollo: el mock de arriba SIEMPRE
    // fallaría si se llamase, y sin embargo nunca se invoca.
    assert.equal(cap.apolloStarts.length, 0);
    assert.equal(cap.startLogs.length, 0);
  });

  it('P0: no evaluable BLOQUEA — 0 llamadas a Apollo, 0 escrituras, sin inventar el person id', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      startDeps(
        startCandidate({
          ...NO_NATIVE_IDENTITY,
        }),
      ),
    );

    assert.equal(result.status, 'suppression_check_unavailable');
    // 0 llamadas a Apollo: ni siquiera la de la auditoría.
    assert.equal(cap.apolloStarts.length, 0);
    // 0 escrituras: ni patch de candidato ni backfill del id ausente.
    assert.equal(cap.startPatches.length, 0);
  });

  it('un sumidero que LANZA no rompe el START (sigue bloqueando)', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      startDeps(startCandidate(NO_NATIVE_IDENTITY), {
        onSuppressionNotEvaluable: () => {
          throw new Error('sumidero caído');
        },
      }),
    );
    assert.equal(result.status, 'suppression_check_unavailable');
  });

  it('sin sumidero cableado el START sigue bloqueando (la auditoría es opcional, el gate no)', async () => {
    const result = await runRevealCandidatePhone(
      VALID_INPUT,
      startDeps(startCandidate(NO_NATIVE_IDENTITY), {
        onSuppressionNotEvaluable: undefined,
      }),
    );
    assert.equal(result.status, 'suppression_check_unavailable');
    assert.deepEqual(cap.events, []);
    assert.equal(cap.apolloStarts.length, 0);
  });
});

// ── 3. WEBHOOK ─────────────────────────────────────────────────

describe('FIX 4 / P0 — WEBHOOK registra el caso no evaluable Y AHORA BLOQUEA', () => {
  it('P0: sin person id resoluble ⇒ BLOQUEA (antes: el teléfono se persistía igual)', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithoutApolloPersonId() },
      webhookDeps(
        webhookCandidate({
          ...NO_NATIVE_IDENTITY,
        }),
      ),
    );

    assert.equal(result.outcome, 'suppression_check_unavailable');
    assert.equal(cap.events.length, 1);
    assertEventShape(cap.events[0]);
    assert.deepEqual(cap.events[0], {
      provider: 'apollo',
      phase: 'webhook',
      suppression_state: 'not_evaluable_missing_provider_person_id',
      candidate_id: CANDIDATE_ID,
      account_id: ACCOUNT_ID,
    });
    assert.deepEqual(cap.suppressionLookups, [], 'no hay clave que consultar');
    // Fail-closed: 0 persistencia, 0 caché, el candidato sigue en vuelo.
    assert.deepEqual(cap.persisted, []);
    assert.equal(cap.webhookLogs[0].status, 'error');
    assert.equal(
      cap.webhookLogs[0].errorCode,
      SUPPRESSION_CHECK_UNAVAILABLE_ERROR_CODE,
    );
    assert.equal(
      cap.webhookLogs[0].metadata.suppression_state,
      'not_evaluable_missing_provider_person_id',
    );
    assertEventsHaveNoPii();
  });

  // FASE 1 — RE-ESPECIFICADO por el mismo motivo que en el START.
  it('FASE 1: sin account_id el webhook SÍ evalúa — ni bloqueo ni evento', async () => {
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(webhookCandidate({ accountId: null })),
    );

    assert.deepEqual(cap.events, []);
    assert.equal(cap.suppressionLookups.length, 1);
    assert.equal(cap.suppressionLookups[0].provider, 'apollo');
    assert.equal(cap.suppressionLookups[0].accountId, null);
    assertEventsHaveNoPii();
  });

  it('con clave completa NO se emite evento', async () => {
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: webhookPayload() },
      webhookDeps(),
    );
    assert.deepEqual(cap.events, []);
    assert.equal(cap.suppressionLookups.length, 1);
    assert.equal(
      cap.webhookLogs[0].metadata.suppression_state,
      'checked_not_suppressed',
    );
  });

  it('sin teléfono no hay comprobación y por tanto no hay evento', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: { request_id: REQUEST_ID, phone_numbers: [] } },
      webhookDeps(webhookCandidate(NO_NATIVE_IDENTITY)),
    );
    assert.equal(result.outcome, 'no_phone_found');
    assert.deepEqual(cap.events, []);
  });

  it('P0: no evaluable BLOQUEA — 0 persistencia, 0 caché, sin fabricar el person id ausente', async () => {
    let cacheWrites = 0;
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithoutApolloPersonId() },
      webhookDeps(
        webhookCandidate({
          ...NO_NATIVE_IDENTITY,
        }),
        // El flag de caché ON se modela con la dep presente: aun así, el bloqueo
        // ni siquiera llega a evaluar si hay entrada cacheable.
        {
          cacheRevealedPhone: async () => {
            cacheWrites += 1;
            return { written: true };
          },
        },
      ),
    );

    assert.deepEqual(cap.persisted, []);
    assert.equal(cacheWrites, 0);
  });

  it('un sumidero que LANZA no rompe el webhook (sigue bloqueando)', async () => {
    const result = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithoutApolloPersonId() },
      webhookDeps(webhookCandidate(NO_NATIVE_IDENTITY), {
        onSuppressionNotEvaluable: () => {
          throw new Error('sumidero caído');
        },
      }),
    );
    assert.equal(result.outcome, 'suppression_check_unavailable');
    assert.deepEqual(cap.persisted, []);
  });
});

// ── 4. RECOVERY ────────────────────────────────────────────────

describe('FIX 4 / P0 — RECOVERY registra el caso no evaluable Y AHORA BLOQUEA', () => {
  it('P0: sin person id resoluble ⇒ BLOQUEA (antes: revealed), un solo GET a Apollo', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(
        recoveryCandidate({
          ...NO_NATIVE_IDENTITY,
        }),
        payloadWithoutApolloPersonId(),
      ),
    );

    assert.equal(result.outcome, 'suppression_check_unavailable');
    assert.equal(result.phoneRevealed, false);
    assert.equal(cap.events.length, 1);
    assertEventShape(cap.events[0]);
    assert.deepEqual(cap.events[0], {
      provider: 'apollo',
      phase: 'recovery',
      suppression_state: 'not_evaluable_missing_provider_person_id',
      candidate_id: CANDIDATE_ID,
      account_id: ACCOUNT_ID,
    });
    assert.deepEqual(cap.suppressionLookups, []);
    // No terminal: solo se sella la última verificación, el candidato sigue en
    // vuelo y es recuperable sin gastar créditos.
    assert.deepEqual(cap.persisted, [{ phone_reveal_last_checked_at: NOW }]);
    assert.equal(
      cap.recoveryLogs[0].metadata.suppression_state,
      'not_evaluable_missing_provider_person_id',
    );
    // La auditoría no añade tráfico: sigue siendo UN solo GET webhook_result.
    assert.deepEqual(cap.webhookFetches, [RECOVERY_ID]);
    assertEventsHaveNoPii();
  });

  // FASE 1 — RE-ESPECIFICADO por el mismo motivo que en el START y el webhook.
  it('FASE 1: sin account_id la recuperación SÍ evalúa — ni bloqueo ni evento', async () => {
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(recoveryCandidate({ accountId: null })),
    );

    assert.deepEqual(cap.events, []);
    assert.equal(cap.suppressionLookups.length, 1);
    assert.equal(cap.suppressionLookups[0].provider, 'apollo');
    assert.equal(cap.suppressionLookups[0].accountId, null);
    assertEventsHaveNoPii();
  });

  it('con clave completa NO se emite evento', async () => {
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(),
    );
    assert.deepEqual(cap.events, []);
    assert.equal(cap.suppressionLookups.length, 1);
    assert.equal(
      cap.recoveryLogs[0].metadata.suppression_state,
      'checked_not_suppressed',
    );
  });

  it('un sumidero que LANZA no rompe la recuperación (sigue bloqueando)', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(
        recoveryCandidate(NO_NATIVE_IDENTITY),
        payloadWithoutApolloPersonId(),
        {
          onSuppressionNotEvaluable: () => {
            throw new Error('sumidero caído');
          },
        },
      ),
    );
    assert.equal(result.outcome, 'suppression_check_unavailable');
  });

  it('un dryRun no consulta Apollo y por tanto no emite evento', async () => {
    const result = await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID, dryRun: true },
      recoveryDeps(recoveryCandidate(NO_NATIVE_IDENTITY)),
    );
    assert.equal(result.outcome, 'dry_run_eligible');
    assert.equal(result.phoneRevealed, false);
    assert.deepEqual(cap.webhookFetches, []);
    assert.deepEqual(cap.events, []);
  });
});

// ── 5. Ningún dato de contacto sale por ningún canal ───────────

describe('FIX 4 — nada de PII en los tres canales observables', () => {
  it('el dump completo de las tres fases no contiene datos de contacto', async () => {
    await runRevealCandidatePhone(
      VALID_INPUT,
      startDeps(startCandidate(NO_NATIVE_IDENTITY)),
    );
    await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: payloadWithoutApolloPersonId() },
      webhookDeps(webhookCandidate(NO_NATIVE_IDENTITY)),
    );
    await recoverApolloPhoneRevealForCandidate(
      { candidateId: CANDIDATE_ID },
      recoveryDeps(
        recoveryCandidate(NO_NATIVE_IDENTITY),
        payloadWithoutApolloPersonId(),
      ),
    );

    assert.equal(cap.events.length, 3);
    assert.deepEqual(
      cap.events.map((e) => e.phase),
      ['start', 'webhook', 'recovery'],
    );
    for (const event of cap.events) assertEventShape(event);
    assertEventsHaveNoPii();

    // Los usage-logs de las tres fases tampoco publican contacto ni person id.
    const logs = JSON.stringify({
      startLogs: cap.startLogs,
      webhookLogs: cap.webhookLogs,
      recoveryLogs: cap.recoveryLogs,
    });
    for (const secret of [
      CONTACT_MAIL,
      CONTACT_LINKEDIN,
      FIRST_NAME,
      LAST_NAME,
      PERSON_ID,
      LUSHA_ID,
    ]) {
      assert.equal(logs.includes(secret), false, `usage-log publica ${secret}`);
    }
    // El teléfono solo puede vivir en el patch de persistencia, nunca en un log.
    assert.equal(logs.includes(PHONE), false);
    assert.ok(observable().length > 0);
  });
});

// ── 6. Guardas estáticas ───────────────────────────────────────

function read(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/** Quita comentarios: las guardas hablan del CÓDIGO, no de la documentación. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('FIX 4 — contrato estático', () => {
  const AUDIT_REL = 'src/modules/contact-enrichment/phone-reveal-suppression-audit.ts';
  const audit = read(AUDIT_REL);
  const auditCode = code(audit);
  const revealCore = read('src/modules/contact-enrichment/phone-reveal-core.ts');
  const webhookCore = read(
    'src/modules/contact-enrichment/phone-reveal-webhook-core.ts',
  );
  const recoveryCore = read(
    'src/modules/contact-enrichment/phone-reveal-recovery-core.ts',
  );

  // FASE 1 (AGENT2A-P0-PREAPPROVAL-PHONE-IDENTITY-4). El vocabulario histórico NO se
  // reescribe: `missing_account_id` sigue en la allowlist del módulo de auditoría, porque
  // los eventos ya emitidos lo llevan y borrarlo los volvería ilegibles. Lo que este
  // ratchet fija es que NINGUNA rama viva pueda emitirlo: la falta de cuenta dejó de ser
  // un motivo de "no evaluable" en las tres fases.
  it('FASE 1: ninguna fase resuelve ya un motivo de cuenta ausente', () => {
    for (const core of [revealCore, webhookCore, recoveryCore]) {
      assert.equal(
        /missing_account_id/.test(code(core)),
        false,
        'ninguna fase puede emitir ya not_evaluable_missing_account_id',
      );
    }
  });

  it('el módulo de auditoría es puro: sin red, sin Supabase, sin env, sin console', () => {
    assert.equal(/\bfetch\s*\(/.test(auditCode), false);
    assert.equal(/supabase/i.test(auditCode), false);
    assert.equal(/process\.env/.test(auditCode), false);
    assert.equal(/console\./.test(auditCode), false);
  });

  it('no lee el flag de caché: la auditoría no depende de la reutilización', () => {
    assert.equal(auditCode.includes('ENABLE_APOLLO_PHONE_CACHE'), false);
    assert.equal(auditCode.includes('isApolloPhoneCacheEnabled'), false);
    assert.equal(/\bcacheEnabled\b/.test(auditCode), false);
  });

  it('no hay fuzzy matching: el evento no conoce teléfono/email/nombre/linkedin', () => {
    for (const forbidden of [
      'normalizedPhone',
      'normalized_phone',
      'email',
      'linkedin',
      'fullName',
      'full_name',
      'firstName',
      'lastName',
    ]) {
      assert.equal(
        auditCode.includes(forbidden),
        false,
        `el evento no puede llevar ${forbidden}`,
      );
    }
  });

  it('el evento no publica el person id (ni en claro ni hasheado)', () => {
    const block = audit.match(
      /export interface PhoneSuppressionNotEvaluableEvent \{([\s\S]*?)\n\}/,
    );
    assert.ok(block, 'no se encontró el tipo del evento');
    assert.equal(/person_id/.test(block[1]), false);
    assert.equal(/hash/i.test(block[1]), false);
    // Y la forma es cerrada: exactamente cinco campos.
    const fields = block[1]
      .split('\n')
      .filter((line) => /^\s*readonly\s/.test(line));
    assert.equal(fields.length, 5);
  });

  it('no hay backfill ni escritura alguna en el módulo de auditoría', () => {
    for (const forbidden of ['update(', 'insert(', 'upsert(', 'backfill']) {
      assert.equal(auditCode.includes(forbidden), false);
    }
  });

  it('no toca Lusha por ninguna vía', () => {
    assert.equal(/lusha/i.test(audit), false);
  });

  it('las tres fases emiten el evento por el mismo helper', () => {
    for (const [name, source] of [
      ['start', revealCore],
      ['webhook', webhookCore],
      ['recovery', recoveryCore],
    ] as const) {
      assert.match(
        source,
        /reportPhoneSuppressionNotEvaluable\(\{/,
        `${name} debe emitir el evento`,
      );
      assert.match(
        source,
        new RegExp(`phase:\\s*'${name}'`),
        `${name} debe etiquetar su fase`,
      );
    }
  });

  it('los tres wrappers cablean el sumidero', () => {
    for (const rel of [
      'src/modules/contact-enrichment/phone-reveal-actions.ts',
      // RECOVERY-CRON-1: el cableado de deps del recovery vive en
      // `phone-reveal-recovery-deps.ts`, compartido por el action ADMIN y el cron.
      'src/modules/contact-enrichment/phone-reveal-recovery-deps.ts',
      'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts',
    ]) {
      assert.match(read(rel), /onSuppressionNotEvaluable/, `${rel} sin sumidero`);
    }
  });

  it('el sumidero del wrapper solo publica el evento, nada del candidato', () => {
    for (const rel of [
      'src/modules/contact-enrichment/phone-reveal-actions.ts',
      // RECOVERY-CRON-1: el cableado de deps del recovery vive en
      // `phone-reveal-recovery-deps.ts`, compartido por el action ADMIN y el cron.
      'src/modules/contact-enrichment/phone-reveal-recovery-deps.ts',
      'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts',
    ]) {
      const wrapper = read(rel);
      // Cuerpo del sumidero: desde el nombre de la dep hasta el cierre del
      // callback. El prefijo del log (p. ej. `[phone-cache]`) queda dentro, así
      // que las prohibiciones apuntan a CAMPOS, no a la palabra "phone".
      const sink = wrapper.split('onSuppressionNotEvaluable')[1]?.split('},')[0] ?? '';
      assert.notEqual(sink, '', `${rel}: no se encontró el sumidero`);
      assert.match(sink, /\bevent\b/, `${rel}: debe publicar el evento`);
      for (const forbidden of [
        'candidate.',
        'payload',
        'email',
        'linkedin',
        'first',
        'last',
        'number',
        'normalized',
        'personId',
        'person_id',
      ]) {
        assert.equal(
          sink.includes(forbidden),
          false,
          `${rel}: el sumidero no puede imprimir ${forbidden}`,
        );
      }
    }
  });

  it('el módulo de auditoría no importa del core (sin ciclo)', () => {
    assert.equal(auditCode.includes("from './phone-reveal-core'"), false);
    assert.equal(
      auditCode.includes("from './phone-reveal-suppression-guard'"),
      false,
    );
  });
});
