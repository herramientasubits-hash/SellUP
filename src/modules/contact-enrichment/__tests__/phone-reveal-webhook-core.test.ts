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

function baseCandidate(
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
  it('request_id ausente → 400 seguro, sin persistir', async () => {
    const res = await runApolloPhoneRevealWebhook(input({}), makeDeps(cap));
    assert.equal(res.httpStatus, 400);
    assert.equal(res.outcome, 'missing_request_id');
    assert.equal(cap.persisted.length, 0);
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
});
