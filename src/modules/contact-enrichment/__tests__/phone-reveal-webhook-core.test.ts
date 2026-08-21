/**
 * Agente 2A — Apollo Phone Reveal WEBHOOK core (APOLLO-PHONE-ASYNC-1)
 *
 * Pruebas offline/DI del core puro `runApolloPhoneRevealWebhook`. Sin red, sin
 * Supabase, sin proveedores: token esperado, carga por request_id, persistencia
 * y usage-log se inyectan y se capturan en memoria.
 *
 * Contrato verificado:
 *  - token no configurado → 401 (fail-closed).
 *  - token inválido → 401.
 *  - request_id ausente → 400 seguro.
 *  - request_id desconocido → 200 no-op, sin persistir, sin PII.
 *  - pending + móvil → revealed (prioriza móvil sobre direct_dial).
 *  - pending + solo direct_dial → revealed direct_dial.
 *  - pending + sin teléfonos → no_phone_found.
 *  - credits_consumed se conserva.
 *  - ya terminal → 200 idempotente (no reprocesa).
 *  - usage-log y resultado SIN teléfono/PII.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runApolloPhoneRevealWebhook,
  extractWebhookRequestId,
  collectWebhookPhoneNumbers,
  sumWebhookCredits,
  isApolloWebhookTokenAuthorized,
  type ApolloPhoneRevealWebhookDeps,
  type ApolloPhoneRevealWebhookInput,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
  type WebhookRevealPersistencePatch,
  type WebhookUsageLogEntry,
} from '../phone-reveal-webhook-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const NOW = '2026-07-24T13:00:00.000Z';
const TOKEN = 'webhook-secret-token';
const REQUEST_ID = 'apollo-req-123';
const MOBILE = '+573001112233';
const DIRECT = '+571234567';
/** Apollo person id sintético (24 hex), opaco e inventado. Necesario para que la
 * comprobación de supresión en vuelo sea evaluable (AGENT2A-P0-PHONE-SUPPRESSION-NOKEY-1):
 * sin él el gate ahora bloquea (`not_evaluable` ⇒ fail-closed). Este archivo
 * prueba la captura del teléfono revelado y la correlación del webhook, no la
 * resolución de identidad de la supresión. */
const PERSON_ID = '3c4d5e6f7a8b9c0d1e2f3a4b';

function baseCandidate(
  overrides: Partial<WebhookCandidateRecord> = {},
): WebhookCandidateRecord {
  return {
    id: 'cand-1',
    accountId: 'acct-1',
    enrichmentMetadata: {},
    phoneRevealStatus: 'requested',
    apolloPersonId: PERSON_ID,
    ...overrides,
  };
}

interface Capture {
  persisted: Array<{ id: string; patch: WebhookRevealPersistencePatch }>;
  logs: WebhookUsageLogEntry[];
  loadedRequestIds: string[];
}

function makeDeps(
  cap: Capture,
  opts: { expectedToken?: string | null; candidate?: WebhookCandidateRecord | null } = {},
): ApolloPhoneRevealWebhookDeps {
  return {
    expectedToken: opts.expectedToken === undefined ? TOKEN : opts.expectedToken,
    nowIso: NOW,
    loadCandidateByRequestId: async (rid) => {
      cap.loadedRequestIds.push(rid);
      return opts.candidate === undefined ? baseCandidate() : opts.candidate;
    },
    persist: async (id, patch) => {
      cap.persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      cap.logs.push(entry);
    },
    lookupPhoneCacheSuppression: async () => null,
  };
}

function fresh(): Capture {
  return { persisted: [], logs: [], loadedRequestIds: [] };
}

function input(
  payload: ApolloPhoneRevealWebhookPayload | null,
  tokenProvided: string | null = TOKEN,
): ApolloPhoneRevealWebhookInput {
  return { tokenProvided, payload };
}

let cap: Capture;
beforeEach(() => {
  cap = fresh();
});

// ── Helpers puros ──────────────────────────────────────────────

describe('ASYNC-1 webhook — helpers puros', () => {
  it('extractWebhookRequestId acepta request_id / async_task_id / id', () => {
    assert.equal(extractWebhookRequestId({ request_id: 'a' }), 'a');
    assert.equal(extractWebhookRequestId({ async_task_id: 'b' }), 'b');
    assert.equal(extractWebhookRequestId({ id: 'c' }), 'c');
    assert.equal(extractWebhookRequestId({}), null);
    assert.equal(extractWebhookRequestId(null), null);
  });

  it('collectWebhookPhoneNumbers reúne teléfonos anidados', () => {
    const payload: ApolloPhoneRevealWebhookPayload = {
      phone_numbers: [{ sanitized_number: '+1' }],
      person: { phone_numbers: [{ sanitized_number: '+2' }] },
      people: [{ phone_numbers: [{ sanitized_number: '+3' }] }],
    };
    assert.equal(collectWebhookPhoneNumbers(payload).length, 3);
  });

  it('sumWebhookCredits suma credits_consumed (null si no hay dato)', () => {
    assert.equal(sumWebhookCredits([{ credits_consumed: 5 }, { credits_consumed: 3 }]), 8);
    assert.equal(sumWebhookCredits([{ sanitized_number: '+1' }]), null);
  });
});

// ── ASYNC-9: verificación pura del token (validation handshake) ─

describe('ASYNC-9 webhook — isApolloWebhookTokenAuthorized', () => {
  it('token correcto → true', () => {
    assert.equal(isApolloWebhookTokenAuthorized(TOKEN, TOKEN), true);
  });

  it('token incorrecto → false', () => {
    assert.equal(isApolloWebhookTokenAuthorized('wrong', TOKEN), false);
  });

  it('token provisto ausente/vacío → false', () => {
    assert.equal(isApolloWebhookTokenAuthorized(null, TOKEN), false);
    assert.equal(isApolloWebhookTokenAuthorized('   ', TOKEN), false);
  });

  it('token esperado ausente/vacío (no configurado) → false (fail-closed)', () => {
    assert.equal(isApolloWebhookTokenAuthorized(TOKEN, null), false);
    assert.equal(isApolloWebhookTokenAuthorized(TOKEN, '   '), false);
  });
});

// ── Token ──────────────────────────────────────────────────────

describe('ASYNC-1 webhook — token', () => {
  it('token no configurado → 401, sin cargar candidato', async () => {
    const res = await runApolloPhoneRevealWebhook(
      input({ request_id: REQUEST_ID }),
      makeDeps(cap, { expectedToken: null }),
    );
    assert.equal(res.httpStatus, 401);
    assert.equal(res.outcome, 'not_configured');
    assert.equal(cap.loadedRequestIds.length, 0);
  });

  it('token inválido → 401, sin cargar candidato', async () => {
    const res = await runApolloPhoneRevealWebhook(
      input({ request_id: REQUEST_ID }, 'wrong-token'),
      makeDeps(cap),
    );
    assert.equal(res.httpStatus, 401);
    assert.equal(res.outcome, 'unauthorized');
    assert.equal(cap.loadedRequestIds.length, 0);
  });

  it('token ausente → 401', async () => {
    const res = await runApolloPhoneRevealWebhook(
      input({ request_id: REQUEST_ID }, null),
      makeDeps(cap),
    );
    assert.equal(res.httpStatus, 401);
    assert.equal(res.outcome, 'unauthorized');
  });
});

// ── request_id ─────────────────────────────────────────────────

describe('ASYNC-1 webhook — request_id', () => {
  it('request_id ausente → 200 validation_ack, sin persistir (validation-safe)', async () => {
    const res = await runApolloPhoneRevealWebhook(input({}), makeDeps(cap));
    assert.equal(res.httpStatus, 200);
    assert.equal(res.outcome, 'validation_ack');
    assert.equal(cap.persisted.length, 0);
    assert.equal(cap.logs.length, 0);
    assert.equal(cap.loadedRequestIds.length, 0);
  });

  it('body null (token válido) → 200 validation_ack, sin escrituras', async () => {
    const res = await runApolloPhoneRevealWebhook(input(null), makeDeps(cap));
    assert.equal(res.httpStatus, 200);
    assert.equal(res.outcome, 'validation_ack');
    assert.equal(cap.persisted.length, 0);
    assert.equal(cap.logs.length, 0);
  });

  it('request_id desconocido → 200 no-op, sin persistir ni PII', async () => {
    const res = await runApolloPhoneRevealWebhook(
      input({ request_id: 'nope', phone_numbers: [{ sanitized_number: MOBILE }] }),
      makeDeps(cap, { candidate: null }),
    );
    assert.equal(res.httpStatus, 200);
    assert.equal(res.outcome, 'unknown_request_id');
    assert.equal(cap.persisted.length, 0);
    assert.equal(cap.logs.length, 0);
    assert.equal(JSON.stringify(res).includes(MOBILE), false);
  });
});

// ── Teléfono revelado ──────────────────────────────────────────

describe('ASYNC-1 webhook — teléfono revelado', () => {
  it('móvil + direct_dial → revela el móvil (prioridad), source apollo_reveal', async () => {
    const res = await runApolloPhoneRevealWebhook(
      input({
        request_id: REQUEST_ID,
        phone_numbers: [
          { sanitized_number: DIRECT, type_cd: 'direct_dial', credits_consumed: 4 },
          { sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 4 },
        ],
      }),
      makeDeps(cap),
    );
    assert.equal(res.httpStatus, 200);
    assert.equal(res.outcome, 'revealed');
    const { patch } = cap.persisted[0];
    assert.equal(patch.phone, MOBILE);
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.phone_reveal_webhook_received_at, NOW);
    assert.equal(patch.phone_reveal_completed_at, NOW);
    assert.equal(patch.phone_reveal_cost_credits, 8); // 4 + 4
    assert.equal(patch.enrichment_metadata?.phone?.source, 'apollo_reveal');
    assert.equal(patch.enrichment_metadata?.phone?.type, 'mobile');
  });

  it('solo direct_dial → revela direct_dial', async () => {
    await runApolloPhoneRevealWebhook(
      input({
        request_id: REQUEST_ID,
        phone_numbers: [{ sanitized_number: DIRECT, type_cd: 'direct', credits_consumed: 5 }],
      }),
      makeDeps(cap),
    );
    const { patch } = cap.persisted[0];
    assert.equal(patch.phone, DIRECT);
    assert.equal(patch.phone_reveal_status, 'revealed');
    assert.equal(patch.enrichment_metadata?.phone?.type, 'direct_dial');
    assert.equal(patch.phone_reveal_cost_credits, 5);
  });

  it('usa raw_number si falta sanitized_number', async () => {
    await runApolloPhoneRevealWebhook(
      input({
        request_id: REQUEST_ID,
        phone_numbers: [{ raw_number: MOBILE, type_cd: 'mobile' }],
      }),
      makeDeps(cap),
    );
    assert.equal(cap.persisted[0].patch.phone, MOBILE);
  });

  it('usage-log revealed sin teléfono en la metadata (solo tipo + créditos)', async () => {
    await runApolloPhoneRevealWebhook(
      input({
        request_id: REQUEST_ID,
        phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 8 }],
      }),
      makeDeps(cap),
    );
    assert.equal(cap.logs.length, 1);
    const serialized = JSON.stringify(cap.logs[0]);
    assert.equal(serialized.includes(MOBILE), false);
    assert.equal(cap.logs[0].metadata.phone_revealed, true);
    assert.equal(cap.logs[0].metadata.phone_type, 'mobile');
    assert.equal(cap.logs[0].metadata.reveal_phase, 'webhook');
    assert.equal(cap.logs[0].metadata.credits_used, 8);
    assert.equal(cap.logs[0].metadata.request_id, REQUEST_ID);
  });
});

// ── Sin teléfono ───────────────────────────────────────────────

describe('ASYNC-1 webhook — no_phone_found', () => {
  it('phone_numbers vacío → no_phone_found, no inventa dato', async () => {
    const res = await runApolloPhoneRevealWebhook(
      input({ request_id: REQUEST_ID, phone_numbers: [] }),
      makeDeps(cap),
    );
    assert.equal(res.outcome, 'no_phone_found');
    const patch = cap.persisted[0].patch as unknown as Record<string, unknown>;
    assert.equal(cap.persisted[0].patch.phone_reveal_status, 'no_phone_found');
    assert.equal('phone' in patch, false);
  });
});

// ── Idempotencia ───────────────────────────────────────────────

describe('ASYNC-1 webhook — idempotencia', () => {
  for (const status of ['revealed', 'no_phone_found', 'error']) {
    it(`candidato ya ${status} → 200 already_terminal, no reprocesa`, async () => {
      const res = await runApolloPhoneRevealWebhook(
        input({ request_id: REQUEST_ID, phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] }),
        makeDeps(cap, { candidate: baseCandidate({ phoneRevealStatus: status }) }),
      );
      assert.equal(res.httpStatus, 200);
      assert.equal(res.outcome, 'already_terminal');
      assert.equal(cap.persisted.length, 0);
      assert.equal(cap.logs.length, 0);
    });
  }
});

// ── ASYNC-21: correlación por ref opaco ────────────────────────

describe('ASYNC-21 webhook — correlación por ref (fallback robusto)', () => {
  const REF = '11111111-2222-4333-8444-555555555555';

  function depsWithRef(
    cap: Capture,
    opts: {
      byRequestId?: WebhookCandidateRecord | null;
      byRef?: WebhookCandidateRecord | null;
    },
  ): ApolloPhoneRevealWebhookDeps {
    return {
      expectedToken: TOKEN,
      nowIso: NOW,
      loadCandidateByRequestId: async (rid) => {
        cap.loadedRequestIds.push(rid);
        return opts.byRequestId === undefined ? null : opts.byRequestId;
      },
      loadCandidateByWebhookRef: async (ref) => {
        assert.equal(ref, REF);
        return opts.byRef === undefined ? null : opts.byRef;
      },
      persist: async (id, patch) => {
        cap.persisted.push({ id, patch });
      },
      logUsage: async (entry) => {
        cap.logs.push(entry);
      },
      lookupPhoneCacheSuppression: async () => null,
    };
  }

  it('sin request_id en payload pero con ref → correlaciona por ref y revela', async () => {
    const c = fresh();
    const res = await runApolloPhoneRevealWebhook(
      {
        tokenProvided: TOKEN,
        payload: { phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile', credits_consumed: 8 }] },
        ref: REF,
      },
      depsWithRef(c, { byRef: baseCandidate() }),
    );
    assert.equal(res.outcome, 'revealed');
    assert.equal(c.persisted[0].patch.phone, MOBILE);
    assert.equal(c.logs[0].metadata.correlation_source, 'webhook_ref');
    assert.equal(c.logs[0].metadata.webhook_ref, REF);
    assert.equal(c.logs[0].metadata.request_id, null);
    // Sin PII en el log serializado.
    assert.equal(JSON.stringify(c.logs[0]).includes(MOBILE), false);
  });

  it('request_id presente y matchea → fallback actual (no usa ref)', async () => {
    const c = fresh();
    const res = await runApolloPhoneRevealWebhook(
      {
        tokenProvided: TOKEN,
        payload: { request_id: REQUEST_ID, phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
        ref: REF,
      },
      depsWithRef(c, { byRequestId: baseCandidate() }),
    );
    assert.equal(res.outcome, 'revealed');
    assert.equal(c.loadedRequestIds[0], REQUEST_ID);
    assert.equal(c.logs[0].metadata.correlation_source, 'request_id');
    assert.equal(c.logs[0].metadata.request_id, REQUEST_ID);
  });

  it('request_id no matchea pero ref sí → cae a ref', async () => {
    const c = fresh();
    const res = await runApolloPhoneRevealWebhook(
      {
        tokenProvided: TOKEN,
        payload: { request_id: 'stale', phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
        ref: REF,
      },
      depsWithRef(c, { byRequestId: null, byRef: baseCandidate() }),
    );
    assert.equal(res.outcome, 'revealed');
    assert.equal(c.logs[0].metadata.correlation_source, 'webhook_ref');
  });

  it('ni request_id ni ref correlacionan → unknown, NO persiste teléfono', async () => {
    const c = fresh();
    const res = await runApolloPhoneRevealWebhook(
      {
        tokenProvided: TOKEN,
        payload: { request_id: 'stale', phone_numbers: [{ sanitized_number: MOBILE, type_cd: 'mobile' }] },
        ref: REF,
      },
      depsWithRef(c, { byRequestId: null, byRef: null }),
    );
    assert.equal(res.outcome, 'unknown_request_id');
    assert.equal(c.persisted.length, 0);
    assert.equal(c.logs.length, 0);
  });

  it('sin request_id NI ref → validation_ack (ping), sin escrituras', async () => {
    const c = fresh();
    const res = await runApolloPhoneRevealWebhook(
      { tokenProvided: TOKEN, payload: {}, ref: null },
      depsWithRef(c, {}),
    );
    assert.equal(res.outcome, 'validation_ack');
    assert.equal(c.persisted.length, 0);
    assert.equal(c.loadedRequestIds.length, 0);
  });
});

// ── Guards estáticos de la ruta ────────────────────────────────

describe('ASYNC-1 webhook — guards de la ruta', () => {
  const ROUTE_REL =
    'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts';
  const raw = readFileSync(join(REPO_ROOT, ROUTE_REL), 'utf8');
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const code = stripComments(raw);

  it('la ruta NO loguea el body crudo (sin console.*(rawBody))', () => {
    assert.equal(/console\.\w+\s*\([^)]*body/i.test(code), false);
  });

  it('la ruta no crea contacto oficial ni aprueba candidato', () => {
    assert.equal(/approveContactCandidate|from\(['"]contacts['"]\)/.test(code), false);
  });

  it('la ruta no toca Lusha ni HubSpot', () => {
    assert.equal(/lusha/i.test(code), false);
    assert.equal(/hubspot/i.test(code), false);
  });

  it('la ruta lee el token del env (el token/URL del reveal no son NEXT_PUBLIC)', () => {
    assert.equal(/APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN/.test(code), true);
    // El token/URL del reveal NUNCA se exponen como NEXT_PUBLIC. (El
    // NEXT_PUBLIC_SUPABASE_URL del cliente admin sí es legítimo, igual que en
    // el resto de rutas.)
    assert.equal(/NEXT_PUBLIC_APOLLO_PHONE_REVEAL/.test(code), false);
    assert.equal(/NEXT_PUBLIC[A-Z_]*PHONE_REVEAL/.test(code), false);
    assert.equal(/NEXT_PUBLIC[A-Z_]*WEBHOOK/.test(code), false);
  });

  it('reveal_phone_number: true NO aparece en la ruta', () => {
    assert.equal(/reveal_phone_number\s*:\s*true/.test(code), false);
  });

  // ── ASYNC-9: handlers del handshake de validación ──────────────

  it('expone GET / HEAD / OPTIONS además de POST', () => {
    assert.equal(/export\s+async\s+function\s+GET\s*\(/.test(code), true);
    assert.equal(/export\s+async\s+function\s+HEAD\s*\(/.test(code), true);
    assert.equal(/export\s+async\s+function\s+OPTIONS\s*\(/.test(code), true);
    assert.equal(/export\s+async\s+function\s+POST\s*\(/.test(code), true);
  });

  it('los handlers de validación están gateados por token (isApolloWebhookTokenAuthorized)', () => {
    assert.equal(/isApolloWebhookTokenAuthorized/.test(code), true);
    // Gate reutilizado; sin token válido no hay 2xx (401 por defecto).
    assert.equal(/401/.test(code), true);
  });

  it('el GET de validación responde un JSON seguro sin secretos', () => {
    assert.equal(/apollo_phone_reveal_webhook_validation/.test(code), true);
  });

  it('los handlers de validación no consultan candidato ni proveedor', () => {
    // Ninguna de las funciones de validación referencia Apollo/reveal reales.
    assert.equal(/startApolloPhoneReveal/.test(code), false);
    assert.equal(/loadCandidateByRequestId[\s\S]*export\s+async\s+function\s+GET/.test(code), false);
  });

  // ── ASYNC-21: correlación por ref + endpoint correcto ──────────

  it('la ruta lee el query param ref para correlación robusta', () => {
    assert.equal(/searchParams\.get\(['"]ref['"]\)/.test(code), true);
    assert.equal(/loadCandidateByWebhookRef/.test(code), true);
  });

  it('la correlación por ref usa la metadata segura del start log (apollo_trace.webhook_ref)', () => {
    assert.equal(/apollo_trace->>webhook_ref/.test(code), true);
    assert.equal(/PHONE_REVEAL_OPERATION_KEY/.test(code), true);
  });

  it('la ruta NO usa el endpoint incorrecto people/match/result para recovery', () => {
    assert.equal(/people\/match\/result/.test(code), false);
  });
});
