/**
 * Agente 2A — Apollo Phone Reveal START action (APOLLO-PHONE-ASYNC-1)
 *
 * Pruebas offline/DI del core puro `runRevealCandidatePhone` (ahora ASÍNCRONO) +
 * guards estáticos. Sin red, sin Supabase, sin proveedores reales: todas las
 * dependencias (flag, actor, webhookUrl, carga de candidato, do_not_contact,
 * START de Apollo, persistencia y usage-log) se inyectan y se capturan en
 * memoria.
 *
 * Contrato async verificado:
 *  - Flag OFF → disabled (no Apollo, no DB).
 *  - webhook_url ausente → provider_not_configured (sin Apollo).
 *  - Confirmación de costo obligatoria; basis obligatorio + válido; nota si other.
 *  - Rol autorizado (admin / commercial_manager); identidad suficiente.
 *  - START feliz → status requested + request_id persistido, SIN teléfono (el
 *    teléfono llega por webhook, nunca en la respuesta inmediata).
 *  - request_id ausente / error Apollo → status error seguro (sin PII).
 *  - Re-reveal (revealed) y reveal en vuelo (requested/pending) bloqueados.
 *  - do_not_contact bloquea. No bulk. Usage-log sin PII.
 *  - reveal_phone_number/webhook_url aislados al helper; sin Lusha/HubSpot/UI.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runRevealCandidatePhone,
  PHONE_REVEAL_OPERATION_KEY,
  type RevealCandidatePhoneInput,
  type RevealCandidatePhoneDeps,
  type RevealCandidateRecord,
  type ApolloPhoneRevealStartCallResult,
  type RevealStartPersistencePatch,
  type PhoneRevealUsageLogEntry,
} from '../phone-reveal-core';
import type { MatchPersonParams } from '@/server/integrations/apollo-client';
import type { ApolloPhoneRevealTraceMetadata } from '@/server/integrations/apollo-phone-reveal-response';
import { isApolloPhoneRevealEnabled, APOLLO_PHONE_REVEAL_FLAG } from '@/lib/feature-flags.server';
import {
  sanitizeApolloErrorMessage,
  APOLLO_ERROR_HINT_MAX_LENGTH,
} from '../apollo-error-hint';

const HERE = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → repo root
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

// ── Fixtures + captura ─────────────────────────────────────────

const NOW = '2026-07-24T12:00:00.000Z';
const ACTOR = { internalUserId: 'user-admin-1', roleKey: 'admin' };
const WEBHOOK_URL =
  'https://app.example.com/api/integrations/apollo/phone-reveal/webhook?token=secret';
const REQUEST_ID = 'apollo-req-123';
// START-CONTRACT-1: id recuperable (apollo_http_request_id) que Apollo devuelve
// en el START. Sin él el core marca `error` (no `requested`).
const HTTP_REQUEST_ID = '-4594297923800105423';

/**
 * Traza técnica mínima (sin PII) del START feliz: incluye el
 * apollo_http_request_id recuperable requerido por START-CONTRACT-1. Los tests
 * que ejercen otros gates reutilizan esta traza para que el camino feliz siga
 * quedando `requested`.
 */
function baseTrace(
  overrides: Partial<ApolloPhoneRevealTraceMetadata> = {},
): ApolloPhoneRevealTraceMetadata {
  return {
    apollo_async_request_id_present: true,
    apollo_phone_enrichment_request_id: REQUEST_ID,
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
  doNotContactChecked: number;
  candidateLoaded: number;
}

function makeDeps(
  cap: Capture,
  opts: {
    flagEnabled?: boolean;
    actor?: { internalUserId: string; roleKey: string | null };
    webhookUrl?: string | null;
    candidate?: RevealCandidateRecord | null;
    isDoNotContact?: boolean;
    apollo?: ApolloPhoneRevealStartCallResult;
  } = {},
): RevealCandidatePhoneDeps {
  return {
    flagEnabled: opts.flagEnabled ?? true,
    actor: opts.actor ?? ACTOR,
    nowIso: NOW,
    webhookUrl: opts.webhookUrl === undefined ? WEBHOOK_URL : opts.webhookUrl,
    loadCandidate: async () => {
      cap.candidateLoaded += 1;
      return opts.candidate === undefined ? baseCandidate() : opts.candidate;
    },
    isDoNotContact: async () => {
      cap.doNotContactChecked += 1;
      return opts.isDoNotContact ?? false;
    },
    startRevealViaApollo: async (params) => {
      cap.apolloCalls.push(params);
      return (
        opts.apollo ?? { ok: true, requestId: REQUEST_ID, trace: baseTrace() }
      );
    },
    persist: async (id, patch) => {
      cap.persisted.push({ id, patch });
    },
    logUsage: async (entry) => {
      cap.logs.push(entry);
    },
  };
}

function freshCapture(): Capture {
  return { apolloCalls: [], persisted: [], logs: [], doNotContactChecked: 0, candidateLoaded: 0 };
}

function validInput(
  overrides: Partial<RevealCandidatePhoneInput> = {},
): RevealCandidatePhoneInput {
  return {
    candidateId: 'cand-1',
    confirmCost: true,
    phoneProcessingBasis: 'legitimate_interest_b2b',
    ...overrides,
  };
}

let cap: Capture;
beforeEach(() => {
  cap = freshCapture();
});

// ── 1. Flag OFF ────────────────────────────────────────────────

describe('ASYNC-1 — flag OFF', () => {
  it('retorna disabled sin llamar Apollo ni escribir DB', async () => {
    const res = await runRevealCandidatePhone(validInput(), makeDeps(cap, { flagEnabled: false }));
    assert.equal(res.status, 'disabled');
    assert.equal(res.ok, false);
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
    assert.equal(cap.logs.length, 0);
    assert.equal(cap.candidateLoaded, 0);
  });
});

// ── 2. webhook_url ausente → provider_not_configured ───────────

describe('ASYNC-1 — webhook_url no configurado', () => {
  it('webhookUrl null → provider_not_configured, sin Apollo/DB', async () => {
    const res = await runRevealCandidatePhone(validInput(), makeDeps(cap, { webhookUrl: null }));
    assert.equal(res.status, 'provider_not_configured');
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
  });

  it('webhookUrl en blanco → provider_not_configured', async () => {
    const res = await runRevealCandidatePhone(validInput(), makeDeps(cap, { webhookUrl: '   ' }));
    assert.equal(res.status, 'provider_not_configured');
    assert.equal(cap.apolloCalls.length, 0);
  });
});

// ── 3. Confirmación de costo ───────────────────────────────────

describe('ASYNC-1 — confirmación de costo', () => {
  it('confirmCost !== true → cost_confirmation_required, sin Apollo/DB', async () => {
    const res = await runRevealCandidatePhone(validInput({ confirmCost: false }), makeDeps(cap));
    assert.equal(res.status, 'cost_confirmation_required');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('expectedMaxCredits por debajo del costo (8) → cost_confirmation_required', async () => {
    const res = await runRevealCandidatePhone(validInput({ expectedMaxCredits: 4 }), makeDeps(cap));
    assert.equal(res.status, 'cost_confirmation_required');
    assert.equal(cap.apolloCalls.length, 0);
  });
});

// ── 4. Processing basis ────────────────────────────────────────

describe('ASYNC-1 — processing basis', () => {
  it('basis ausente → processing_basis_required', async () => {
    const res = await runRevealCandidatePhone(
      validInput({ phoneProcessingBasis: null }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'processing_basis_required');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('basis inválido → invalid_processing_basis', async () => {
    const res = await runRevealCandidatePhone(
      validInput({ phoneProcessingBasis: 'because_i_can' }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'invalid_processing_basis');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('other_approved_basis sin nota → processing_basis_note_required', async () => {
    const res = await runRevealCandidatePhone(
      validInput({ phoneProcessingBasis: 'other_approved_basis' }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'processing_basis_note_required');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('other_approved_basis con nota → procede (requested)', async () => {
    const res = await runRevealCandidatePhone(
      validInput({
        phoneProcessingBasis: 'other_approved_basis',
        phoneProcessingBasisNote: 'Cliente solicitó ser contactado por este medio.',
      }),
      makeDeps(cap),
    );
    assert.equal(res.status, 'requested');
    assert.equal(cap.persisted[0].patch.phone_processing_basis, 'other_approved_basis');
    assert.equal(
      cap.persisted[0].patch.phone_processing_basis_note,
      'Cliente solicitó ser contactado por este medio.',
    );
  });
});

// ── Rol ────────────────────────────────────────────────────────

describe('ASYNC-1 — gate de rol', () => {
  it('rol no autorizado → unauthorized_role, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { actor: { internalUserId: 'u2', roleKey: 'seller_bd' } }),
    );
    assert.equal(res.status, 'unauthorized_role');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('commercial_manager sí puede', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { actor: { internalUserId: 'u3', roleKey: 'commercial_manager' } }),
    );
    assert.equal(res.status, 'requested');
  });

  it('sin rol → unauthorized_role', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { actor: { internalUserId: 'u4', roleKey: null } }),
    );
    assert.equal(res.status, 'unauthorized_role');
  });
});

// ── Identidad insuficiente / candidato inválido ────────────────

describe('ASYNC-1 — identidad insuficiente', () => {
  it('sin id/email/linkedin → insufficient_identity, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({ sourceContactId: null, email: null, linkedinUrl: null }),
      }),
    );
    assert.equal(res.status, 'insufficient_identity');
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
  });
});

describe('ASYNC-1 — candidato inválido / inexistente', () => {
  it('candidateId vacío → invalid_candidate', async () => {
    const res = await runRevealCandidatePhone(validInput({ candidateId: '   ' }), makeDeps(cap));
    assert.equal(res.status, 'invalid_candidate');
    assert.equal(cap.candidateLoaded, 0);
  });

  it('candidato inexistente → candidate_not_found', async () => {
    const res = await runRevealCandidatePhone(validInput(), makeDeps(cap, { candidate: null }));
    assert.equal(res.status, 'candidate_not_found');
    assert.equal(cap.apolloCalls.length, 0);
  });
});

// ── 5. START feliz: request_id, sin teléfono ───────────────────

describe('ASYNC-1 — START aceptado', () => {
  it('llama a Apollo con reveal_phone_number + webhook_url y persiste requested', async () => {
    const res = await runRevealCandidatePhone(validInput(), makeDeps(cap));
    assert.equal(res.status, 'requested');
    assert.equal(res.ok, true);
    assert.equal(res.requestAccepted, true);

    // Una sola llamada, con reveal_phone_number: true y webhook_url (vía helper).
    assert.equal(cap.apolloCalls.length, 1);
    assert.equal(cap.apolloCalls[0].reveal_phone_number, true);
    assert.equal(cap.apolloCalls[0].webhook_url, WEBHOOK_URL);

    const { patch } = cap.persisted[0];
    assert.equal(patch.phone_reveal_status, 'requested');
    assert.equal(patch.phone_reveal_request_id, REQUEST_ID);
    assert.equal(patch.phone_reveal_requested_at, NOW);
    assert.equal(patch.phone_reveal_completed_at, null);
    assert.equal(patch.phone_revealed_by, ACTOR.internalUserId);
    assert.equal(patch.phone_reveal_provider, 'apollo');
    assert.equal(patch.phone_reveal_attempt_count, 1);
    // Sin créditos al iniciar (llegan con el webhook) y sin error.
    assert.equal(patch.phone_reveal_cost_credits, null);
    assert.equal(patch.phone_reveal_error_code, null);
  });

  it('NO persiste teléfono en el START (no lee phone_numbers de la respuesta)', async () => {
    await runRevealCandidatePhone(validInput(), makeDeps(cap));
    const patch = cap.persisted[0].patch as unknown as Record<string, unknown>;
    assert.equal('phone' in patch, false);
    assert.equal('enrichment_metadata' in patch, false);
  });

  it('incrementa attempt_count desde el valor previo', async () => {
    await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: baseCandidate({ phoneRevealAttemptCount: 2 }) }),
    );
    assert.equal(cap.persisted[0].patch.phone_reveal_attempt_count, 3);
  });
});

// ── account_id null soportado ──────────────────────────────────

describe('ASYNC-1 — candidato sin account_id (identidad suficiente)', () => {
  function lushaNoAccountCandidate(): RevealCandidateRecord {
    return baseCandidate({ accountId: null, sourceContactId: null, firstName: null, lastName: null });
  }

  it('START procede sin account_id (una sola llamada)', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: lushaNoAccountCandidate() }),
    );
    assert.equal(res.status, 'requested');
    assert.equal(cap.apolloCalls.length, 1);
    assert.equal(cap.persisted[0].patch.phone_reveal_status, 'requested');
  });

  it('nunca emite candidate_account_invalid con identidad suficiente', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: lushaNoAccountCandidate() }),
    );
    assert.notEqual(res.status, 'candidate_account_invalid');
  });

  it('usage-log sin PII y con account_id null', async () => {
    await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: lushaNoAccountCandidate() }),
    );
    assert.equal(cap.logs.length, 1);
    const serialized = JSON.stringify(cap.logs[0]);
    assert.equal(serialized.includes('jane.doe@acme.com'), false);
    assert.equal(serialized.includes('linkedin.com/in/jane-doe'), false);
    assert.equal(cap.logs[0].metadata.account_id, null);
  });
});

// ── 6. request_id ausente / error Apollo ───────────────────────

describe('ASYNC-1 — START fallido', () => {
  it('Apollo error (HTTP_422) → status error, código seguro, sin teléfono', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { apollo: { ok: false, errorCode: 'HTTP_422' } }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, 'HTTP_422');
    assert.equal(cap.apolloCalls.length, 1);
    const { patch } = cap.persisted[0];
    assert.equal(patch.phone_reveal_status, 'error');
    assert.equal(patch.phone_reveal_error_code, 'HTTP_422');
    assert.equal(patch.phone_reveal_request_id, null);
    assert.equal(patch.phone_reveal_cost_credits, null);
  });

  it('respuesta sin request_id → status error (missing_request_id)', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { apollo: { ok: true, requestId: null } }),
    );
    assert.equal(res.status, 'error');
    assert.equal(res.errorCode, 'missing_request_id');
    assert.equal(cap.persisted[0].patch.phone_reveal_status, 'error');
  });

  // ── ASYNC-9: hint sanitizado del 422 en la metadata (NO en el candidato) ──

  it('errorHint del START fluye SOLO a usage-log.metadata (has_request_id false)', async () => {
    await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        apollo: {
          ok: false,
          errorCode: 'HTTP_422',
          errorHint: "Please add a valid 'webhook_url' parameter",
        },
      }),
    );
    // El candidato solo guarda el código mecánico (sin body/hint en el schema).
    assert.equal(cap.persisted[0].patch.phone_reveal_error_code, 'HTTP_422');
    const patch = cap.persisted[0].patch as unknown as Record<string, unknown>;
    assert.equal('apollo_error_hint' in patch, false);
    // La metadata sí lleva el hint sanitizado + has_request_id.
    assert.equal(
      cap.logs[0].metadata.apollo_error_hint,
      "Please add a valid 'webhook_url' parameter",
    );
    assert.equal(cap.logs[0].metadata.has_request_id, false);
    assert.equal(cap.logs[0].metadata.error_code, 'HTTP_422');
    assert.equal(cap.logs[0].metadata.reveal_phase, 'start');
  });

  it('camino feliz → metadata con apollo_error_hint null y has_request_id true', async () => {
    await runRevealCandidatePhone(validInput(), makeDeps(cap));
    assert.equal(cap.logs[0].metadata.apollo_error_hint, null);
    assert.equal(cap.logs[0].metadata.has_request_id, true);
  });
});

// ── ASYNC-9: sanitizador puro del error de Apollo (observabilidad segura) ──

describe('ASYNC-9 — sanitizeApolloErrorMessage', () => {
  it('extrae el mensaje del 422 real (JSON con campo error allowlisted)', () => {
    const body = JSON.stringify({
      error:
        "Please add a valid 'webhook_url' parameter when using 'reveal_phone_number'",
    });
    const hint = sanitizeApolloErrorMessage(body);
    assert.equal(
      hint,
      "Please add a valid 'webhook_url' parameter when using 'reveal_phone_number'",
    );
  });

  it('acepta objeto ya parseado y concatena campos allowlisted (orden fijo)', () => {
    // Orden de allowlist: error, message, error_message, code, status.
    const hint = sanitizeApolloErrorMessage({ code: 422, message: 'unprocessable' });
    assert.equal(hint, 'unprocessable | 422');
  });

  it('trunca a APOLLO_ERROR_HINT_MAX_LENGTH', () => {
    // Palabras separadas por espacios (no un token largo, que se redactaría).
    const long = 'unprocessable entity error '.repeat(20);
    const hint = sanitizeApolloErrorMessage({ message: long });
    assert.equal(hint?.length, APOLLO_ERROR_HINT_MAX_LENGTH);
  });

  it('redacta email / URL-con-query / token / teléfono / linkedin', () => {
    const body = JSON.stringify({
      message:
        'failed for jane.doe@acme.com via https://app.example.com/webhook?token=supersecretvalue ' +
        'phone +573001112233 profile https://www.linkedin.com/in/jane-doe key deadbeefdeadbeefdeadbeefdeadbeef00',
    });
    const hint = sanitizeApolloErrorMessage(body) ?? '';
    // Nada de PII ni secretos en claro.
    assert.equal(/jane\.doe@acme\.com/.test(hint), false);
    assert.equal(/supersecretvalue/.test(hint), false);
    assert.equal(/573001112233/.test(hint), false);
    assert.equal(/linkedin\.com\/in\/jane-doe/.test(hint), false);
    assert.equal(/deadbeefdeadbeef/.test(hint), false);
    // Placeholders presentes.
    assert.equal(hint.includes('[redacted_email]'), true);
    assert.equal(hint.includes('[redacted_linkedin]'), true);
  });

  it('no filtra el body crudo cuando el JSON no trae campos allowlisted', () => {
    const body = JSON.stringify({
      webhook_url: 'https://app.example.com/webhook?token=supersecretvalue',
      payload: { first_name: 'Jane', last_name: 'Doe' },
    });
    const hint = sanitizeApolloErrorMessage(body);
    assert.equal(hint, null);
  });

  it('entradas vacías/no aptas → null', () => {
    assert.equal(sanitizeApolloErrorMessage(null), null);
    assert.equal(sanitizeApolloErrorMessage(undefined), null);
    assert.equal(sanitizeApolloErrorMessage(''), null);
    assert.equal(sanitizeApolloErrorMessage('   '), null);
    assert.equal(sanitizeApolloErrorMessage({}), null);
  });

  it('string plano no-JSON se usa como mensaje y se redacta', () => {
    const hint = sanitizeApolloErrorMessage('Unprocessable Entity for jane@acme.com');
    assert.equal(hint, 'Unprocessable Entity for [redacted_email]');
  });
});

// ── 7. Re-reveal + reveal en vuelo bloqueados ──────────────────

describe('ASYNC-1 — re-reveal / en vuelo bloqueado', () => {
  it('phone_reveal_status = revealed → already_revealed, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: baseCandidate({ phoneRevealStatus: 'revealed' }) }),
    );
    assert.equal(res.status, 'already_revealed');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('phone existente con source apollo_reveal → already_revealed', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({
          enrichmentMetadata: {
            phone: { number: '+571', type: 'mobile', source: 'apollo_reveal', raw_type: 'mobile' },
          },
        }),
      }),
    );
    assert.equal(res.status, 'already_revealed');
    assert.equal(cap.apolloCalls.length, 0);
  });

  it('status requested (en vuelo) → already_pending, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: baseCandidate({ phoneRevealStatus: 'requested' }) }),
    );
    assert.equal(res.status, 'already_pending');
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
  });

  it('status pending (en vuelo) → already_pending', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: baseCandidate({ phoneRevealStatus: 'pending' }) }),
    );
    assert.equal(res.status, 'already_pending');
    assert.equal(cap.apolloCalls.length, 0);
  });
});

// ── 8. do_not_contact ──────────────────────────────────────────

describe('ASYNC-1 — do_not_contact', () => {
  it('do_not_contact = true → bloquea, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(validInput(), makeDeps(cap, { isDoNotContact: true }));
    assert.equal(res.status, 'do_not_contact');
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
  });
});

// ── 9. No PII en logs ──────────────────────────────────────────

describe('ASYNC-1 — usage-log sin PII', () => {
  it('metadata no contiene teléfono/email/linkedin/nombre; sí request_id + phase', async () => {
    await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({
          email: 'jane.doe@acme.com',
          linkedinUrl: 'https://linkedin.com/in/jane-doe',
          firstName: 'Jane',
          lastName: 'Doe',
        }),
      }),
    );
    assert.equal(cap.logs.length, 1);
    const serialized = JSON.stringify(cap.logs[0]);
    assert.equal(serialized.includes('jane.doe@acme.com'), false);
    assert.equal(serialized.includes('linkedin.com/in/jane-doe'), false);
    assert.equal(/jane/i.test(serialized), false);
    assert.equal(/doe/i.test(serialized), false);
    assert.equal(cap.logs[0].operationKey, PHONE_REVEAL_OPERATION_KEY);
    assert.equal(cap.logs[0].metadata.reveal_status, 'requested');
    assert.equal(cap.logs[0].metadata.reveal_phase, 'start');
    assert.equal(cap.logs[0].metadata.request_id, REQUEST_ID);
    // Al iniciar no se cobran créditos (llegan con el webhook).
    assert.equal(cap.logs[0].metadata.credits_used, null);
  });
});

// ── ASYNC-12: gate por proveedor del Apollo person id ──────────
//
// Regresión del HTTP 422: no reenviar source_contact_id de Lusha (v1.<token>)
// como Apollo `id`. El reveal sigue siendo Apollo, pero para candidatos no-Apollo
// el match va por email/linkedin/name/company.

describe('ASYNC-12 — contaminación cross-provider del Apollo id', () => {
  function lushaCandidate(
    overrides: Partial<RevealCandidateRecord> = {},
  ): RevealCandidateRecord {
    return baseCandidate({
      source: 'lusha',
      sourceContactId: 'v1.lusha-token-xyz',
      email: 'lead@empresa.com',
      linkedinUrl: 'https://linkedin.com/in/lead',
      ...overrides,
    });
  }

  it('candidato Lusha elegible → Apollo SIN id, con webhook + email/linkedin', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, { candidate: lushaCandidate() }),
    );
    assert.equal(res.status, 'requested');
    assert.equal(cap.apolloCalls.length, 1);
    const params = cap.apolloCalls[0];
    assert.equal('id' in params, false, 'NO debe enviar el id de Lusha a Apollo');
    assert.equal(params.id, undefined);
    assert.equal(params.reveal_phone_number, true);
    assert.equal(params.webhook_url, WEBHOOK_URL);
    assert.equal(params.email, 'lead@empresa.com');
    assert.equal(params.linkedin_url, 'https://linkedin.com/in/lead');
  });

  it('candidato Apollo elegible → Apollo CON id (comportamiento preservado)', async () => {
    const res = await runRevealCandidatePhone(validInput(), makeDeps(cap));
    assert.equal(res.status, 'requested');
    assert.equal(cap.apolloCalls.length, 1);
    assert.equal(cap.apolloCalls[0].id, 'apollo-person-1');
    assert.equal(cap.apolloCalls[0].reveal_phone_number, true);
    assert.equal(cap.apolloCalls[0].webhook_url, WEBHOOK_URL);
  });

  it('candidato Lusha SÓLO con id v1 (sin email/linkedin/name) → insufficient_identity, sin Apollo', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: lushaCandidate({
          email: null,
          linkedinUrl: null,
          firstName: null,
          lastName: null,
        }),
      }),
    );
    assert.equal(res.status, 'insufficient_identity');
    assert.equal(cap.apolloCalls.length, 0);
    assert.equal(cap.persisted.length, 0);
  });

  it('unknown/manual con id → Apollo SIN id, usa email', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({
          source: 'manual',
          sourceContactId: 'manual-123',
          email: 'lead@empresa.com',
          linkedinUrl: null,
        }),
      }),
    );
    assert.equal(res.status, 'requested');
    assert.equal(cap.apolloCalls.length, 1);
    assert.equal('id' in cap.apolloCalls[0], false);
    assert.equal(cap.apolloCalls[0].email, 'lead@empresa.com');
  });

  it('observabilidad: id_forwarded_to_apollo + source_provider_for_id (Lusha)', async () => {
    await runRevealCandidatePhone(validInput(), makeDeps(cap, { candidate: lushaCandidate() }));
    assert.equal(cap.logs.length, 1);
    assert.equal(cap.logs[0].metadata.id_forwarded_to_apollo, false);
    assert.equal(cap.logs[0].metadata.source_provider_for_id, 'lusha');
  });

  it('observabilidad: id_forwarded_to_apollo true para Apollo', async () => {
    await runRevealCandidatePhone(validInput(), makeDeps(cap));
    assert.equal(cap.logs[0].metadata.id_forwarded_to_apollo, true);
    assert.equal(cap.logs[0].metadata.source_provider_for_id, 'apollo');
  });

  it('metadata NO contiene el source_contact_id (ni id v1) — sin PII', async () => {
    await runRevealCandidatePhone(validInput(), makeDeps(cap, { candidate: lushaCandidate() }));
    const serialized = JSON.stringify(cap.logs[0]);
    assert.equal(serialized.includes('v1.lusha-token-xyz'), false);
    assert.equal(serialized.includes('lead@empresa.com'), false);
    assert.equal(serialized.includes('linkedin.com/in/lead'), false);
  });

  it('nunca envía a Apollo un id con prefijo v1. aunque source diga apollo (defensa)', async () => {
    const res = await runRevealCandidatePhone(
      validInput(),
      makeDeps(cap, {
        candidate: baseCandidate({
          source: 'apollo',
          sourceContactId: 'v1.leaked-lusha-token',
          email: 'lead@empresa.com',
        }),
      }),
    );
    assert.equal(res.status, 'requested');
    assert.equal(cap.apolloCalls.length, 1);
    assert.equal('id' in cap.apolloCalls[0], false);
    for (const value of Object.values(cap.apolloCalls[0])) {
      if (typeof value === 'string') {
        assert.equal(value.startsWith('v1.'), false);
      }
    }
  });
});

// ── 10. Guards estáticos ───────────────────────────────────────

describe('ASYNC-1 — guards estáticos', () => {
  const CORE_REL = 'src/modules/contact-enrichment/phone-reveal-core.ts';
  const ACTION_REL = 'src/modules/contact-enrichment/phone-reveal-actions.ts';
  const rawCore = readRepo(CORE_REL);
  const rawAction = readRepo(ACTION_REL);
  const REVEAL_TRUE = /reveal_phone_number\s*:\s*true/;

  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const core = stripComments(rawCore);
  const action = stripComments(rawAction);

  it('no bulk: la entrada es candidateId único, sin candidateIds array', () => {
    assert.equal(/candidateIds/.test(core), false);
    assert.equal(/candidateIds/.test(action), false);
    assert.equal(/candidateId\s*:\s*string/.test(core), true);
  });

  it('reveal_phone_number: true NO aparece en el core ni en el action', () => {
    assert.equal(REVEAL_TRUE.test(core), false);
    assert.equal(REVEAL_TRUE.test(action), false);
  });

  it('el core usa el helper (buildApolloPhoneRevealMatchParams)', () => {
    assert.equal(/buildApolloPhoneRevealMatchParams/.test(core), true);
  });

  it('el action es un server action ("use server") y lee el flag', () => {
    assert.equal(/^['"]use server['"];/m.test(rawAction), true);
    assert.equal(/isApolloPhoneRevealEnabled/.test(action), true);
  });

  it('el action inicia el reveal async (startApolloPhoneReveal), no sync match', () => {
    assert.equal(/startApolloPhoneReveal/.test(action), true);
  });

  it('no toca Lusha (sin imports/refs de Lusha en código)', () => {
    assert.equal(/lusha/i.test(core), false);
    assert.equal(/lusha/i.test(action), false);
  });

  it('no toca HubSpot (sin imports/refs de HubSpot en código)', () => {
    assert.equal(/hubspot/i.test(core), false);
    assert.equal(/hubspot/i.test(action), false);
  });

  it('no crea contacto oficial ni aprueba candidato', () => {
    assert.equal(/runApproveCandidate|approveContactCandidate/.test(action), false);
  });

  it('operation_key del reveal es person_phone_reveal', () => {
    assert.equal(/person_phone_reveal/.test(core), true);
  });

  it('roles autorizados: admin + commercial_manager', () => {
    assert.equal(/'admin'/.test(core), true);
    assert.equal(/'commercial_manager'/.test(core), true);
  });

  it('no crea UI de reveal (sin .tsx nuevo en el árbol de módulos)', () => {
    const modulesDir = join(REPO_ROOT, 'src', 'modules', 'contact-enrichment');
    const tsx = readdirSync(modulesDir).filter((f) => f.endsWith('.tsx'));
    assert.equal(tsx.length, 0);
  });

  it('el flag NO está activado en el entorno de test', () => {
    assert.equal(process.env[APOLLO_PHONE_REVEAL_FLAG], undefined);
    assert.equal(isApolloPhoneRevealEnabled(), false);
  });

  it('el flag del webhook token no se expone como NEXT_PUBLIC', () => {
    assert.equal(/NEXT_PUBLIC_APOLLO_PHONE_REVEAL_WEBHOOK/.test(rawAction), false);
    const route = readRepo(
      'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts',
    );
    assert.equal(/NEXT_PUBLIC_APOLLO_PHONE_REVEAL_WEBHOOK/.test(route), false);
  });

  it('completion / runner / routing / bulk siguen sin reveal_phone_number: true', () => {
    const files = [
      'src/server/agents/contact-enrichment-toolkit/contact-completion-adapter.ts',
      'src/server/agents/contact-enrichment-toolkit/apollo-enrichment-runner.ts',
      'src/server/agents/contact-enrichment-toolkit/contact-enrichment-routing-orchestrator.ts',
      'src/modules/contact-enrichment/bulk-enrichment-runner.ts',
    ];
    for (const rel of files) {
      assert.equal(REVEAL_TRUE.test(readRepo(rel)), false, `${rel} no debe revelar`);
    }
  });

  it('las migraciones 095 y 097 existen y no ejecutan reveal', () => {
    for (const mig of [
      'supabase/migrations/095_candidate_phone_reveal_audit.sql',
      'supabase/migrations/097_apollo_phone_reveal_async.sql',
    ]) {
      assert.equal(existsSync(join(REPO_ROOT, mig)), true, `${mig} debe existir`);
      assert.equal(REVEAL_TRUE.test(readRepo(mig)), false);
    }
  });
});
