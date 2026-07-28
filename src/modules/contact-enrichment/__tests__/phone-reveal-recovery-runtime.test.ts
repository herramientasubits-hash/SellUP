/**
 * Agente 2A — Apollo Phone Reveal RECOVERY runtime (ADMIN-only)
 * (APOLLO-PHONE-RECOVERY-RUNTIME-1)
 *
 * Runtime interno admin-gated que ejecuta el recovery core mergeado (PR #139).
 * Cubre: auth ADMIN-only, dryRun (default true, sin Apollo), ejecución real vía
 * dep mockeada, caps del batch, respuestas sin PII, y el contrato estático
 * (usa el recovery core, GET /webhook_result/{apollo_http_request_id}, nunca
 * POST /people/match ni phone_enrichment.request_id para polling).
 *
 * Puro/DI: sin red real, sin Supabase, sin env. Ninguna llamada real a Apollo:
 * el fetch de recuperación se inyecta como spy y NUNCA se cablea al cliente real.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runAdminSingleCandidateRecovery,
  runAdminStaleBatchRecovery,
  isRecoveryRuntimeAuthorized,
  RECOVERY_RUNTIME_AUTHORIZED_ROLE_KEYS,
  RECOVERY_RUNTIME_DEFAULT_MAX_CANDIDATES,
  RECOVERY_RUNTIME_MAX_CANDIDATES_CAP,
  RECOVERY_RUNTIME_DEFAULT_MIN_AGE_MINUTES,
  type RecoveryRuntimeActor,
} from '../phone-reveal-recovery-runtime-core';
import {
  recoverApolloPhoneRevealForCandidate,
  recoverStaleApolloPhoneRevealRequests,
  type RecoverApolloPhoneRevealDeps,
  type RecoverApolloPhoneRevealInput,
  type RecoverApolloPhoneRevealResult,
  type RecoveryCandidateRecord,
  type StaleRecoveryQuery,
} from '../phone-reveal-recovery-core';
import type { PollFetchResult } from '../phone-reveal-poll-core';
import type { ApolloPhoneRevealWebhookPayload } from '../phone-reveal-webhook-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const RECOVERY_ID = '-4594297923800105423';

const ADMIN: RecoveryRuntimeActor = { internalUserId: 'user-admin', roleKey: 'admin' };
const SELLER: RecoveryRuntimeActor = { internalUserId: 'user-seller', roleKey: 'seller' };
const MANAGER: RecoveryRuntimeActor = {
  internalUserId: 'user-mgr',
  roleKey: 'commercial_manager',
};
const LEAD: RecoveryRuntimeActor = { internalUserId: 'user-lead', roleKey: 'lead' };
const ANON: RecoveryRuntimeActor = { internalUserId: null, roleKey: null };

const mobilePayload: ApolloPhoneRevealWebhookPayload = {
  request_id: RECOVERY_ID,
  phone_numbers: [
    { sanitized_number: '+573001112233', type_cd: 'mobile', credits_consumed: 8 },
  ],
};

function eligibleCandidate(
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

/** Deps reales del recovery core con fetch espiado (nunca toca Apollo real). */
function coreDepsWithFetchSpy(args: {
  candidate?: RecoveryCandidateRecord | null;
  recoveryId?: string | null;
  fetch?: (rid: string) => Promise<PollFetchResult>;
}): { deps: RecoverApolloPhoneRevealDeps; fetchCalls: string[]; writes: number } {
  const state = { fetchCalls: [] as string[], writes: 0 };
  const deps: RecoverApolloPhoneRevealDeps = {
    nowIso: '2026-07-28T12:00:00.000Z',
    loadCandidate: async () =>
      args.candidate === undefined ? eligibleCandidate() : args.candidate,
    resolveRecoveryRequestId: async () =>
      args.recoveryId === undefined ? RECOVERY_ID : args.recoveryId,
    fetchWebhookResult: async (rid) => {
      state.fetchCalls.push(rid);
      return args.fetch ? args.fetch(rid) : { kind: 'no_result_yet' };
    },
    persist: async () => {
      state.writes += 1;
    },
    logUsage: async () => {},
  };
  return { deps, fetchCalls: state.fetchCalls, writes: state.writes };
}

// ═══════════════════════════════════════════════════════════════
// 1. Auth — ADMIN-only
// ═══════════════════════════════════════════════════════════════

describe('recovery runtime — auth (ADMIN-only)', () => {
  it('la allowlist de roles es exactamente [admin] (no incluye commercial_manager)', () => {
    assert.deepEqual([...RECOVERY_RUNTIME_AUTHORIZED_ROLE_KEYS], ['admin']);
  });

  it('isRecoveryRuntimeAuthorized: admin sí; seller/manager/lead/anónimo no', () => {
    assert.equal(isRecoveryRuntimeAuthorized(ADMIN), true);
    assert.equal(isRecoveryRuntimeAuthorized(SELLER), false);
    assert.equal(isRecoveryRuntimeAuthorized(MANAGER), false);
    assert.equal(isRecoveryRuntimeAuthorized(LEAD), false);
    assert.equal(isRecoveryRuntimeAuthorized(ANON), false);
    // admin sin id de usuario resuelto tampoco pasa (fail-closed).
    assert.equal(
      isRecoveryRuntimeAuthorized({ internalUserId: null, roleKey: 'admin' }),
      false,
    );
  });

  for (const [name, actor] of [
    ['anónimo', ANON],
    ['seller', SELLER],
    ['manager (commercial_manager)', MANAGER],
    ['lead', LEAD],
  ] as const) {
    it(`single: ${name} NO puede ejecutar (no toca deps)`, async () => {
      let called = 0;
      const res = await runAdminSingleCandidateRecovery(
        { candidateId: 'cand-1' },
        {
          actor,
          recoverCandidate: async () => {
            called += 1;
            return {
              outcome: 'revealed',
              phoneRevealed: true,
              creditsUsed: 8,
              recoveryRequestIdPresent: true,
              phoneType: 'mobile',
            };
          },
        },
      );
      assert.equal(called, 0);
      assert.equal(res.ok, false);
      assert.equal(res.status, 'error');
      assert.equal(res.message, 'unauthorized');
      assert.equal(res.phonePersisted, false);
    });

    it(`batch: ${name} NO puede ejecutar (no toca deps)`, async () => {
      let called = 0;
      const res = await runAdminStaleBatchRecovery(
        { dryRun: true },
        {
          actor,
          recoverStale: async () => {
            called += 1;
            return {
              checked: 0,
              recovered: 0,
              still_pending: 0,
              no_phone_found: 0,
              failed: 0,
              skipped: 0,
              dryRun: true,
              maxCandidates: 5,
              minAgeMinutes: 15,
            };
          },
        },
      );
      assert.equal(called, 0);
      assert.equal(res.ok, false);
      assert.equal(res.message, 'unauthorized');
      assert.equal(res.checked, 0);
    });
  }

  it('single: admin SÍ puede ejecutar (llama la dep)', async () => {
    let called = 0;
    const res = await runAdminSingleCandidateRecovery(
      { candidateId: 'cand-1', dryRun: false },
      {
        actor: ADMIN,
        recoverCandidate: async () => {
          called += 1;
          return {
            outcome: 'still_pending',
            phoneRevealed: false,
            creditsUsed: null,
            recoveryRequestIdPresent: true,
            phoneType: null,
          };
        },
      },
    );
    assert.equal(called, 1);
    assert.equal(res.ok, true);
    assert.equal(res.status, 'still_pending');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Single recovery runtime
// ═══════════════════════════════════════════════════════════════

describe('recovery runtime — single', () => {
  it('candidateId requerido: vacío ⇒ error sin tocar deps', async () => {
    let called = 0;
    const res = await runAdminSingleCandidateRecovery(
      { candidateId: '   ' },
      {
        actor: ADMIN,
        recoverCandidate: async () => {
          called += 1;
          return {
            outcome: 'revealed',
            phoneRevealed: true,
            creditsUsed: 8,
            recoveryRequestIdPresent: true,
            phoneType: 'mobile',
          };
        },
      },
    );
    assert.equal(called, 0);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'error');
    assert.equal(res.message, 'invalid_candidate');
  });

  it('dryRun default true: la dep recibe dryRun=true si no se pasa', async () => {
    let seen: RecoverApolloPhoneRevealInput | null = null;
    const res = await runAdminSingleCandidateRecovery(
      { candidateId: 'cand-1' },
      {
        actor: ADMIN,
        recoverCandidate: async (input) => {
          seen = input;
          return {
            outcome: 'dry_run_eligible',
            phoneRevealed: false,
            creditsUsed: null,
            recoveryRequestIdPresent: true,
            phoneType: null,
          };
        },
      },
    );
    assert.equal(seen!.dryRun, true);
    assert.equal(res.dryRun, true);
    assert.equal(res.status, 'skipped');
  });

  it('dryRun true NO llama a Apollo (fetch spy no se invoca) end-to-end', async () => {
    const { deps, fetchCalls } = coreDepsWithFetchSpy({
      fetch: async () => ({ kind: 'result', payload: mobilePayload }),
    });
    const res = await runAdminSingleCandidateRecovery(
      { candidateId: 'cand-1' /* dryRun omitido ⇒ true */ },
      {
        actor: ADMIN,
        recoverCandidate: (input) => recoverApolloPhoneRevealForCandidate(input, deps),
      },
    );
    assert.equal(fetchCalls.length, 0); // Apollo nunca se consulta en dryRun
    assert.equal(res.status, 'skipped');
    assert.equal(res.phonePersisted, false);
    assert.equal(res.recoveryRequestIdPresent, true);
  });

  it('dryRun false SÍ llama al recovery core (fetch spy invocado 1 vez)', async () => {
    const { deps, fetchCalls } = coreDepsWithFetchSpy({
      fetch: async () => ({ kind: 'result', payload: mobilePayload }),
    });
    const res = await runAdminSingleCandidateRecovery(
      { candidateId: 'cand-1', dryRun: false },
      {
        actor: ADMIN,
        recoverCandidate: (input) => recoverApolloPhoneRevealForCandidate(input, deps),
      },
    );
    assert.equal(fetchCalls.length, 1);
    assert.equal(res.status, 'revealed');
    assert.equal(res.phonePersisted, true);
    assert.equal(res.phoneType, 'mobile');
    assert.equal(res.creditsUsed, 8);
  });

  it('dryRun false con dep mockeada: se propaga el outcome (no_phone_found)', async () => {
    const res = await runAdminSingleCandidateRecovery(
      { candidateId: 'cand-1', dryRun: false },
      {
        actor: ADMIN,
        recoverCandidate: async () => ({
          outcome: 'no_phone_found',
          phoneRevealed: false,
          creditsUsed: 0,
          recoveryRequestIdPresent: true,
          phoneType: null,
        }),
      },
    );
    assert.equal(res.status, 'no_phone_found');
    assert.equal(res.phonePersisted, false);
  });

  it('la respuesta NO incluye teléfono ni PII (solo estados/booleanos/tipo)', async () => {
    const { deps } = coreDepsWithFetchSpy({
      fetch: async () => ({ kind: 'result', payload: mobilePayload }),
    });
    const res = await runAdminSingleCandidateRecovery(
      { candidateId: 'cand-1', dryRun: false, reason: 'manual_admin_recovery' },
      {
        actor: ADMIN,
        recoverCandidate: (input) => recoverApolloPhoneRevealForCandidate(input, deps),
      },
    );
    const json = JSON.stringify(res);
    // Nunca el número ni fragmentos PII.
    assert.equal(json.includes('+573001112233'), false);
    assert.equal(json.includes('573001112233'), false);
    assert.equal(/raw_number|sanitized_number/.test(json), false);
    assert.equal(/@/.test(json), false); // sin emails
    assert.equal(/linkedin/i.test(json), false);
    // Claves permitidas: solo el shape seguro.
    assert.deepEqual(Object.keys(res).sort(), [
      'creditsUsed',
      'dryRun',
      'message',
      'mode',
      'ok',
      'phonePersisted',
      'phoneType',
      'recoveryRequestIdPresent',
      'status',
    ]);
    // phoneType permitido (etiqueta de tipo, no el número).
    assert.equal(res.phoneType, 'mobile');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Batch recovery runtime
// ═══════════════════════════════════════════════════════════════

describe('recovery runtime — batch', () => {
  it('dryRun default true: la dep recibe dryRun=true si no se pasa', async () => {
    let seenDryRun: boolean | undefined;
    await runAdminStaleBatchRecovery(
      {},
      {
        actor: ADMIN,
        recoverStale: async (input) => {
          seenDryRun = input.dryRun;
          return {
            checked: 0,
            recovered: 0,
            still_pending: 0,
            no_phone_found: 0,
            failed: 0,
            skipped: 0,
            dryRun: true,
            maxCandidates: 5,
            minAgeMinutes: 15,
          };
        },
      },
    );
    assert.equal(seenDryRun, true);
  });

  it('maxCandidates default 5 y minAgeMinutes default 15 (vía recovery core real)', async () => {
    let seen: StaleRecoveryQuery | null = null;
    const res = await runAdminStaleBatchRecovery(
      { dryRun: true },
      {
        actor: ADMIN,
        recoverStale: (coreInput) =>
          recoverStaleApolloPhoneRevealRequests(coreInput, {
            nowIso: '2026-07-28T12:00:00.000Z',
            findStaleCandidateIds: async (q) => {
              seen = q;
              return [];
            },
            recoverOne: async () => 'revealed',
          }),
      },
    );
    assert.equal(seen!.maxCandidates, RECOVERY_RUNTIME_DEFAULT_MAX_CANDIDATES);
    assert.equal(seen!.maxCandidates, 5);
    assert.equal(seen!.minAgeMinutes, RECOVERY_RUNTIME_DEFAULT_MIN_AGE_MINUTES);
    assert.equal(seen!.minAgeMinutes, 15);
    assert.equal(res.maxCandidates, 5);
    assert.equal(res.minAgeMinutes, 15);
  });

  it('maxCandidates hard cap 10 (21 ⇒ 10) vía recovery core real', async () => {
    let seen: StaleRecoveryQuery | null = null;
    const res = await runAdminStaleBatchRecovery(
      { dryRun: true, maxCandidates: 21 },
      {
        actor: ADMIN,
        recoverStale: (coreInput) =>
          recoverStaleApolloPhoneRevealRequests(coreInput, {
            nowIso: '2026-07-28T12:00:00.000Z',
            findStaleCandidateIds: async (q) => {
              seen = q;
              return [];
            },
            recoverOne: async () => 'revealed',
          }),
      },
    );
    assert.equal(RECOVERY_RUNTIME_MAX_CANDIDATES_CAP, 10);
    assert.equal(seen!.maxCandidates, 10);
    assert.equal(res.maxCandidates, 10);
  });

  it('dryRun true NO ejecuta poll (recoverOne nunca se llama; todo skipped)', async () => {
    let recoverOneCalls = 0;
    const res = await runAdminStaleBatchRecovery(
      { dryRun: true },
      {
        actor: ADMIN,
        recoverStale: (coreInput) =>
          recoverStaleApolloPhoneRevealRequests(coreInput, {
            nowIso: '2026-07-28T12:00:00.000Z',
            findStaleCandidateIds: async () => ['a', 'b', 'c'],
            recoverOne: async () => {
              recoverOneCalls += 1;
              return 'revealed';
            },
          }),
      },
    );
    assert.equal(recoverOneCalls, 0);
    assert.equal(res.checked, 3);
    assert.equal(res.skipped, 3);
    assert.equal(res.recovered, 0);
    assert.equal(res.dryRun, true);
    assert.equal(res.message, 'dry_run');
  });

  it('summary solo conteos (sin PII): claves exactas', async () => {
    const res = await runAdminStaleBatchRecovery(
      { dryRun: false, maxCandidates: 3 },
      {
        actor: ADMIN,
        recoverStale: async () => ({
          checked: 3,
          recovered: 1,
          still_pending: 1,
          no_phone_found: 0,
          failed: 1,
          skipped: 0,
          dryRun: false,
          maxCandidates: 3,
          minAgeMinutes: 15,
        }),
      },
    );
    assert.deepEqual(Object.keys(res).sort(), [
      'checked',
      'dryRun',
      'failed',
      'maxCandidates',
      'message',
      'minAgeMinutes',
      'mode',
      'noPhoneFound',
      'ok',
      'recovered',
      'skipped',
      'stillPending',
    ]);
    const json = JSON.stringify(res);
    // (Nota: la clave de conteo `noPhoneFound` contiene "phone" legítimamente; se
    // busca PII real, no ese nombre de campo.)
    assert.equal(/@|linkedin|raw_number|sanitized_number/i.test(json), false);
    assert.equal(res.recovered, 1);
    assert.equal(res.failed, 1);
    assert.equal(res.message, 'executed');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Contrato estático — usa el recovery core y el endpoint correcto
// ═══════════════════════════════════════════════════════════════

describe('recovery runtime — contrato estático', () => {
  const actionsSrc = readFileSync(
    join(REPO_ROOT, 'src/modules/contact-enrichment/phone-reveal-recovery-actions.ts'),
    'utf8',
  );
  const runtimeSrc = readFileSync(
    join(REPO_ROOT, 'src/modules/contact-enrichment/phone-reveal-recovery-runtime-core.ts'),
    'utf8',
  );
  const apolloSrc = readFileSync(
    join(REPO_ROOT, 'src/server/integrations/apollo-client.ts'),
    'utf8',
  );
  // Los checks de "código NO contiene X" deben ignorar comentarios: los docstrings
  // mencionan legítimamente people/match, phone_enrichment.request_id y el flag
  // para explicar QUÉ NO se hace. Se quitan comentarios antes de grep, igual que
  // el test de pureza del recovery core.
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const actionsCode = stripComments(actionsSrc);
  const runtimeCode = stripComments(runtimeSrc);
  const apolloCode = stripComments(apolloSrc);

  it('el action usa el recovery core existente (single + batch)', () => {
    assert.equal(actionsSrc.includes('recoverApolloPhoneRevealForCandidate'), true);
    assert.equal(actionsSrc.includes('recoverStaleApolloPhoneRevealRequests'), true);
  });

  it('el recovery GET de Apollo apunta a /webhook_result/{id}', () => {
    assert.equal(apolloSrc.includes('/api/v1/webhook_result/'), true);
    assert.equal(actionsSrc.includes('fetchApolloPhoneRevealWebhookResult'), true);
  });

  it('NO usa POST /people/match ni /people/match/result (en código)', () => {
    assert.equal(/people\/match/.test(actionsCode), false);
    assert.equal(/people\/match/.test(runtimeCode), false);
    // En apollo-client el recovery GET (webhook_result) no debe tocar people/match
    // en su vecindad de código.
    assert.equal(/webhook_result[\s\S]{0,200}people\/match/.test(apolloCode), false);
  });

  it('NO usa phone_enrichment.request_id para el polling (en código)', () => {
    assert.equal(/phone_enrichment\.request_id/.test(actionsCode), false);
    assert.equal(/phone_enrichment\.request_id/.test(runtimeCode), false);
  });

  it('NO depende de ENABLE_APOLLO_PHONE_REVEAL (en código)', () => {
    assert.equal(/ENABLE_APOLLO_PHONE_REVEAL/.test(actionsCode), false);
    assert.equal(/ENABLE_APOLLO_PHONE_REVEAL/.test(runtimeCode), false);
    assert.equal(/isApolloPhoneRevealEnabled/.test(actionsCode), false);
  });

  it('el runtime core es puro: sin fetch/red, sin cron/scheduler, sin flag', () => {
    assert.equal(/\bfetch\s*\(/.test(runtimeCode), false);
    assert.equal(/setInterval|setTimeout|cron/i.test(runtimeCode), false);
    assert.equal(/process\.env/.test(runtimeCode), false);
  });

  it('el action resuelve el id de recovery del start log (apollo_trace)', () => {
    assert.equal(actionsSrc.includes('apollo_http_request_id'), true);
    assert.equal(actionsSrc.includes('apollo_trace'), true);
    assert.equal(actionsSrc.includes("reveal_phase"), true);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Regresión — flag/webhook/id guards intactos
// ═══════════════════════════════════════════════════════════════

describe('recovery runtime — regresión de contratos existentes', () => {
  const startCoreSrc = readFileSync(
    join(REPO_ROOT, 'src/modules/contact-enrichment/phone-reveal-core.ts'),
    'utf8',
  );
  const webhookRouteSrc = readFileSync(
    join(REPO_ROOT, 'src/app/api/integrations/apollo/phone-reveal/webhook/route.ts'),
    'utf8',
  );

  it('el START sigue gateado por el flag; el runtime de recovery NO', () => {
    // El START core sí lee el flag (crea reveals nuevos).
    assert.equal(startCoreSrc.includes('flagEnabled'), true);
    // El webhook route NO gatea funcionalmente la entrega por el flag: no llama a
    // isApolloPhoneRevealEnabled ni importa feature-flags (por eso sigue
    // funcionando con el flag OFF). La única aparición del nombre del flag es un
    // comentario de cabecera, no una lectura.
    assert.equal(/isApolloPhoneRevealEnabled/.test(webhookRouteSrc), false);
    assert.equal(/from '@\/lib\/feature-flags/.test(webhookRouteSrc), false);
  });

  it('el guard del id Lusha v1. sigue intacto en el START core', () => {
    // El START nunca reenvía un source_contact_id no-Apollo como Apollo person id.
    assert.equal(startCoreSrc.includes('source'), true);
    assert.equal(
      startCoreSrc.includes('buildApolloPhoneRevealMatchParams') ||
        startCoreSrc.includes('id_forwarded_to_apollo'),
      true,
    );
  });

  it('el id de origen Apollo sigue permitido en el START (source apollo)', () => {
    assert.equal(startCoreSrc.includes("'apollo'"), true);
  });
});
