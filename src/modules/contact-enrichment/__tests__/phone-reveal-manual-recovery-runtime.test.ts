/**
 * Agente 2A — Apollo Phone Reveal RECOVERY L3: runtime de revisión manual
 * (APOLLO-PHONE-RECOVERY-L3)
 *
 * Verifica el camino completo de "Revisar resultado ahora" contra el recovery core
 * REAL (el mismo que usan la acción admin y el cron L2), con el fetch de
 * recuperación inyectado como espía. NINGUNA llamada real a Apollo, ni a Lusha, ni
 * a HubSpot, ni a Supabase: todo el I/O es DI.
 *
 * Cubre:
 *   * rechazos sin tocar Apollo (rol, terminal, sin id, no en vuelo, <2 min,
 *     teléfono ya presente, revisión demasiado reciente),
 *   * exactamente UN GET por invocación para un candidato stale,
 *   * teléfono ⇒ revealed; sin teléfono ⇒ no_phone_found,
 *   * pending + retry_after_seconds ⇒ NO terminaliza y expone los segundos,
 *   * tombstone de supresión respetado igual que en el L2,
 *   * respuesta sin PII y contratos estáticos (sin POST, sin Lusha, sin HubSpot,
 *     sin polling automático, un solo candidato).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  runManualPhoneRevealRecovery,
  type ManualRecoveryRuntimeDeps,
  type ManualRecoveryRuntimeResult,
} from '../phone-reveal-manual-recovery-runtime-core';
import type {
  ManualRecoveryActor,
  ManualRecoveryCandidateSnapshot,
} from '../phone-reveal-manual-recovery-core';
import {
  recoverApolloPhoneRevealForCandidate,
  recoverStaleApolloPhoneRevealRequests,
  RECOVERY_REVEAL_PHASE,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
  type RecoveryPersistencePatch,
  type RecoveryUsageLogEntry,
} from '../phone-reveal-recovery-core';
import type { PollFetchResult } from '../phone-reveal-poll-core';
import type { ApolloPhoneRevealWebhookPayload } from '../phone-reveal-webhook-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_DIR = join(HERE, '..');
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const NOW = '2026-07-30T18:00:00.000Z';
const RECOVERY_ID = '-4594297923800105423';
/** Apollo person id sintético válido (24 hex). Id opaco, NO PII. */
const PERSON_ID = '0123456789abcdef01234567';
/** Número sintético de prueba: nunca aparece en la respuesta ni en los logs. */
const SYNTHETIC_PHONE = '+570000000000';

const ADMIN: ManualRecoveryActor = { internalUserId: 'user-1', roleKey: 'admin' };
const MANAGER: ManualRecoveryActor = {
  internalUserId: 'user-2',
  roleKey: 'commercial_manager',
};
const SELLER: ManualRecoveryActor = { internalUserId: 'user-3', roleKey: 'seller' };

function agoIso(seconds: number): string {
  return new Date(Date.parse(NOW) - seconds * 1000).toISOString();
}

function snapshot(
  overrides: Partial<ManualRecoveryCandidateSnapshot> = {},
): ManualRecoveryCandidateSnapshot {
  return {
    phoneRevealProvider: 'apollo',
    phoneRevealStatus: 'requested',
    hasPhone: false,
    recoveryIdPresent: true,
    requestedAtIso: agoIso(600),
    lastCheckedAtIso: null,
    ...overrides,
  };
}

function recoveryCandidate(
  overrides: Partial<RecoveryCandidateRecord> = {},
): RecoveryCandidateRecord {
  return {
    id: 'cand-l3',
    accountId: 'acct-1',
    phoneRevealProvider: 'apollo',
    source: 'apollo',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    apolloPersonId: PERSON_ID,
    ...overrides,
  };
}

interface HarnessState {
  /** recovery ids consultados: su longitud = número de GET a Apollo. */
  gets: string[];
  patches: RecoveryPersistencePatch[];
  logs: RecoveryUsageLogEntry[];
  suppressionLookups: number;
  cacheWrites: number;
  snapshotReads: string[];
}

interface Harness {
  deps: ManualRecoveryRuntimeDeps;
  /** Mutable: los contadores se leen DESPUÉS de ejecutar (no se copian por valor). */
  state: HarnessState;
}

/**
 * Cablea el runtime L3 sobre el recovery core REAL con todo el I/O inyectado.
 * `fetch` simula la respuesta de `GET /webhook_result/{id}`; si no se pasa, el poll
 * no debería llegar a ejecutarse.
 */
function harness(args: {
  actor?: ManualRecoveryActor;
  snapshot?: ManualRecoveryCandidateSnapshot | null;
  candidate?: RecoveryCandidateRecord | null;
  recoveryId?: string | null;
  fetch?: (id: string) => Promise<PollFetchResult>;
  suppressed?: boolean;
  suppressionThrows?: boolean;
} = {}): Harness {
  const state: HarnessState = {
    gets: [],
    patches: [],
    logs: [],
    suppressionLookups: 0,
    cacheWrites: 0,
    snapshotReads: [],
  };

  const coreDeps: RecoverApolloPhoneRevealDeps = {
    nowIso: NOW,
    loadCandidate: async () =>
      args.candidate === undefined ? recoveryCandidate() : args.candidate,
    resolveRecoveryRequestId: async () =>
      args.recoveryId === undefined ? RECOVERY_ID : args.recoveryId,
    fetchWebhookResult: async (id) => {
      state.gets.push(id);
      if (!args.fetch) {
        throw new Error('el poll no debería haberse ejecutado en este caso');
      }
      return args.fetch(id);
    },
    persist: async (_id, patch) => {
      state.patches.push(patch);
    },
    logUsage: async (entry) => {
      state.logs.push(entry);
    },
    cacheRevealedPhone: async () => {
      state.cacheWrites += 1;
      return null;
    },
    lookupPhoneCacheSuppression: async () => {
      state.suppressionLookups += 1;
      if (args.suppressionThrows) throw new Error('tabla no disponible');
      return { suppressedAt: args.suppressed ? NOW : null };
    },
  };

  const deps: ManualRecoveryRuntimeDeps = {
    actor: args.actor ?? ADMIN,
    nowIso: NOW,
    loadSnapshot: async (id) => {
      state.snapshotReads.push(id);
      return args.snapshot === undefined ? snapshot() : args.snapshot;
    },
    recoverCandidate: (input) =>
      recoverApolloPhoneRevealForCandidate(input, coreDeps),
  };

  return { deps, state };
}

function assertNoApolloCall(h: Harness, result: ManualRecoveryRuntimeResult) {
  assert.equal(h.state.gets.length, 0, 'no debe consultarse Apollo');
  assert.equal(h.state.patches.length, 0, 'no debe escribirse nada');
  assert.equal(h.state.logs.length, 0, 'no debe registrarse uso');
  assert.equal(result.phoneRevealed, false);
  assert.equal(result.creditsUsed, null);
}

// ═══════════════════════════════════════════════════════════════
// 1. Rechazos sin tocar Apollo
// ═══════════════════════════════════════════════════════════════

describe('L3 runtime — rechazos fail-closed (0 llamadas a Apollo)', () => {
  it('rechaza un rol no autorizado SIN leer el candidato', async () => {
    const h = harness({ actor: SELLER });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'unauthorized_role');
    assert.equal(h.state.snapshotReads.length, 0, 'no debe leerse el candidato');
    assertNoApolloCall(h, result);
  });

  it('rechaza un candidateId vacío sin tocar ninguna dep', async () => {
    const h = harness();
    for (const candidateId of ['', '   ']) {
      const result = await runManualPhoneRevealRecovery({ candidateId }, h.deps);
      assert.equal(result.status, 'error');
      assert.equal(result.message, 'invalid_candidate');
    }
    assert.equal(h.state.snapshotReads.length, 0);
    assert.equal(h.state.gets.length, 0);
  });

  it('rechaza un candidato inexistente', async () => {
    const h = harness({ snapshot: null });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'not_eligible');
    assert.equal(result.message, 'candidate_not_found');
    assertNoApolloCall(h, result);
  });

  it('rechaza candidatos TERMINALES (revealed / no_phone_found / error)', async () => {
    for (const status of ['revealed', 'no_phone_found', 'error']) {
      const h = harness({ snapshot: snapshot({ phoneRevealStatus: status }) });
      const result = await runManualPhoneRevealRecovery(
        { candidateId: 'cand-l3' },
        h.deps,
      );
      assert.equal(result.status, 'not_eligible', `status ${status}`);
      assert.equal(result.message, 'not_in_flight');
      assertNoApolloCall(h, result);
    }
  });

  it('rechaza si el estado no es requested/pending', async () => {
    const h = harness({ snapshot: snapshot({ phoneRevealStatus: 'disabled' }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.message, 'not_in_flight');
    assertNoApolloCall(h, result);
  });

  it('rechaza si no hay id de correlación', async () => {
    const h = harness({ snapshot: snapshot({ recoveryIdPresent: false }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'not_eligible');
    assert.equal(result.message, 'missing_recovery_request_id');
    assertNoApolloCall(h, result);
  });

  it('rechaza si el candidato ya tiene teléfono', async () => {
    const h = harness({ snapshot: snapshot({ hasPhone: true }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.message, 'already_has_phone');
    assertNoApolloCall(h, result);
  });

  it('rechaza si se solicitó hace menos de 2 min, indicando la espera', async () => {
    const h = harness({ snapshot: snapshot({ requestedAtIso: agoIso(45) }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'not_eligible');
    assert.equal(result.message, 'requested_too_recently');
    assert.equal(result.retryAfterSeconds, 75);
    assertNoApolloCall(h, result);
  });

  it('rechaza un segundo clic dentro de la ventana anti-abuso de 60 s', async () => {
    const h = harness({ snapshot: snapshot({ lastCheckedAtIso: agoIso(5) }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'not_eligible');
    assert.equal(result.message, 'checked_too_recently');
    assert.equal(result.retryAfterSeconds, 55);
    assertNoApolloCall(h, result);
  });

  it('el proveedor no-Apollo queda fuera (sin fallback Lusha)', async () => {
    const h = harness({ snapshot: snapshot({ phoneRevealProvider: 'lusha' }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.message, 'not_apollo_provider');
    assertNoApolloCall(h, result);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Ejecución: exactamente 1 GET
// ═══════════════════════════════════════════════════════════════

describe('L3 runtime — ejecución para un candidato stale', () => {
  it('hace EXACTAMENTE un GET al webhook_result y ninguno más', async () => {
    const h = harness({ fetch: async () => ({ kind: 'no_result_yet' }) });
    await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(h.state.gets.length, 1);
    assert.deepEqual(h.state.gets, [RECOVERY_ID]);
  });

  it('procesa UN solo candidato (nunca un lote)', async () => {
    const h = harness({ fetch: async () => ({ kind: 'no_result_yet' }) });
    await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(h.state.snapshotReads.length, 1);
    assert.deepEqual(h.state.snapshotReads, ['cand-l3']);
  });

  it('registra el usage-log con reveal_phase = recovery_poll', async () => {
    const h = harness({ fetch: async () => ({ kind: 'no_result_yet' }) });
    await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(h.state.logs.length, 1);
    assert.equal(h.state.logs[0].metadata.reveal_phase, RECOVERY_REVEAL_PHASE);
    assert.equal(h.state.logs[0].provider, 'apollo');
    assert.equal(h.state.logs[0].triggeredBy, ADMIN.internalUserId);
    assert.equal(h.state.logs[0].metadata.has_reason, true);
  });

  it('el manager comercial también puede revisar (mismo criterio que el reveal)', async () => {
    const h = harness({
      actor: MANAGER,
      fetch: async () => ({ kind: 'no_result_yet' }),
    });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'still_pending');
    assert.equal(h.state.gets.length, 1);
  });

  it('nunca pasa dryRun al core: la revisión manual consulta de verdad', async () => {
    const calls: unknown[] = [];
    const h = harness({ fetch: async () => ({ kind: 'no_result_yet' }) });
    const spied: ManualRecoveryRuntimeDeps = {
      ...h.deps,
      recoverCandidate: async (input) => {
        calls.push(input);
        return h.deps.recoverCandidate(input);
      },
    };
    await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, spied);
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { dryRun?: boolean }).dryRun, false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Disposiciones de Apollo
// ═══════════════════════════════════════════════════════════════

describe('L3 runtime — resultado con teléfono', () => {
  const payload: ApolloPhoneRevealWebhookPayload = {
    request_id: RECOVERY_ID,
    people: [
      {
        id: PERSON_ID,
        phone_numbers: [
          {
            sanitized_number: SYNTHETIC_PHONE,
            type_cd: 'mobile',
            credits_consumed: 8,
          },
        ],
      },
    ],
  };

  it('persiste revealed y devuelve solo la etiqueta de tipo', async () => {
    const h = harness({ fetch: async () => ({ kind: 'result', payload }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.ok, true);
    assert.equal(result.status, 'revealed');
    assert.equal(result.phoneRevealStatus, 'revealed');
    assert.equal(result.phoneRevealed, true);
    assert.equal(result.phoneType, 'mobile');
    assert.equal(result.creditsUsed, 8);
    assert.equal(h.state.patches[0].phone_reveal_status, 'revealed');
    // El recovery NUNCA sella webhook_received_at: el teléfono no llegó por webhook.
    assert.ok(!('phone_reveal_webhook_received_at' in h.state.patches[0]));
    assert.ok(h.state.patches[0].phone_reveal_last_checked_at);
  });

  it('la respuesta NO contiene el número, ni el payload, ni el request id', async () => {
    const h = harness({ fetch: async () => ({ kind: 'result', payload }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes(SYNTHETIC_PHONE), 'no debe viajar el teléfono');
    assert.ok(!serialized.includes(RECOVERY_ID), 'no debe viajar el recovery id');
    assert.ok(!serialized.includes(PERSON_ID), 'no debe viajar el person id');
  });

  it('el usage-log tampoco lleva el número (solo tipo y presencia)', async () => {
    const h = harness({ fetch: async () => ({ kind: 'result', payload }) });
    await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    const serialized = JSON.stringify(h.state.logs);
    assert.ok(!serialized.includes(SYNTHETIC_PHONE));
    assert.equal(h.state.logs[0].metadata.phone_present, true);
    assert.equal(h.state.logs[0].metadata.phone_type, 'mobile');
  });
});

describe('L3 runtime — resultado sin teléfono', () => {
  it('termina en no_phone_found', async () => {
    const h = harness({
      fetch: async () => ({ kind: 'result', payload: { request_id: RECOVERY_ID } }),
    });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'no_phone_found');
    assert.equal(result.phoneRevealStatus, 'no_phone_found');
    assert.equal(result.noPhoneFound, true);
    assert.equal(result.stillPending, false);
    assert.equal(h.state.patches[0].phone_reveal_status, 'no_phone_found');
  });
});

describe('L3 runtime — Apollo sigue procesando', () => {
  it('pending + retry_after_seconds NO terminaliza y expone los segundos', async () => {
    const h = harness({
      fetch: async () => ({
        kind: 'result',
        payload: { request_id: RECOVERY_ID, status: 'pending', retry_after_seconds: 10 },
      }),
    });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'still_pending');
    assert.equal(result.stillPending, true);
    assert.equal(result.noPhoneFound, false);
    assert.equal(result.retryAfterSeconds, 10);
    // El candidato sigue en vuelo: solo se sella la última comprobación.
    assert.equal(h.state.patches.length, 1);
    assert.equal(h.state.patches[0].phone_reveal_status, undefined);
    assert.ok(h.state.patches[0].phone_reveal_last_checked_at);
    assert.equal(result.phoneRevealStatus, 'requested');
  });

  it('200 sin cuerpo también es still_pending (sin retry sugerido)', async () => {
    const h = harness({ fetch: async () => ({ kind: 'no_result_yet' }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'still_pending');
    assert.equal(result.retryAfterSeconds, null);
    assert.equal(h.state.patches[0].phone_reveal_status, undefined);
  });

  it('404 ambiguo NUNCA se lee como no_phone_found', async () => {
    const h = harness({ fetch: async () => ({ kind: 'not_found' }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'still_pending');
    assert.equal(result.noPhoneFound, false);
    assert.equal(h.state.patches[0].phone_reveal_status, undefined);
  });

  it('401/403 es un problema técnico, no un terminal de negocio', async () => {
    const h = harness({ fetch: async () => ({ kind: 'unauthorized' }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'possible_missing_webhook_result_read_scope');
    assert.equal(h.state.patches[0].phone_reveal_status, undefined);
  });

  it('un 5xx deja el candidato recuperable', async () => {
    const h = harness({ fetch: async () => ({ kind: 'error', code: 'http_500' }) });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'provider_error_transient');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Supresión (mismo cumplimiento que el L2)
// ═══════════════════════════════════════════════════════════════

describe('L3 runtime — supresión', () => {
  const payloadWithPhone: ApolloPhoneRevealWebhookPayload = {
    request_id: RECOVERY_ID,
    people: [
      { id: PERSON_ID, phone_numbers: [{ sanitized_number: SYNTHETIC_PHONE }] },
    ],
  };

  it('un tombstone bloquea la persistencia del teléfono recuperado', async () => {
    const h = harness({
      suppressed: true,
      fetch: async () => ({ kind: 'result', payload: payloadWithPhone }),
    });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.status, 'blocked_suppressed');
    assert.equal(result.phoneRevealed, false);
    assert.equal(h.state.suppressionLookups, 1, 'la supresión SIEMPRE se comprueba');
    assert.equal(h.state.patches[0].phone, undefined, 'no se persiste teléfono');
    assert.equal(h.state.patches[0].phone_reveal_error_code, 'blocked_suppressed');
    assert.equal(h.state.cacheWrites, 0, 'no se cachea una persona suprimida');
    assert.ok(!JSON.stringify(result).includes(SYNTHETIC_PHONE));
  });

  it('si la supresión no se puede verificar, no se persiste teléfono (fail-closed)', async () => {
    const h = harness({
      suppressionThrows: true,
      fetch: async () => ({ kind: 'result', payload: payloadWithPhone }),
    });
    const result = await runManualPhoneRevealRecovery({ candidateId: 'cand-l3' }, h.deps);
    assert.equal(result.ok, false);
    assert.equal(result.status, 'error');
    assert.equal(result.message, 'suppression_check_unavailable');
    assert.equal(h.state.patches[0].phone, undefined);
    assert.equal(h.state.patches[0].phone_reveal_status, undefined);
    assert.equal(h.state.cacheWrites, 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Regresión del batch L2 (el cron no cambia de comportamiento)
// ═══════════════════════════════════════════════════════════════

describe('L2 — el batch programado sigue contando igual', () => {
  async function runBatch(outcomeFetch: () => Promise<PollFetchResult>) {
    const gets: string[] = [];
    const coreDeps: RecoverApolloPhoneRevealDeps = {
      nowIso: NOW,
      loadCandidate: async () => recoveryCandidate(),
      resolveRecoveryRequestId: async () => RECOVERY_ID,
      fetchWebhookResult: async (id) => {
        gets.push(id);
        return outcomeFetch();
      },
      persist: async () => {},
      logUsage: async () => {},
      // Sin esta dep el core es fail-closed (`suppression_check_unavailable`), que
      // es exactamente lo que ocurre si falta la tabla de supresión. Aquí se
      // inyecta "sin tombstone" para medir el conteo del batch, no la supresión.
      lookupPhoneCacheSuppression: async () => ({ suppressedAt: null }),
    };
    const summary = await recoverStaleApolloPhoneRevealRequests(
      { dryRun: false, maxCandidates: 1, minAgeMinutes: 15 },
      {
        nowIso: NOW,
        findStaleCandidateIds: async () => ['cand-l3'],
        recoverOne: async (id) => {
          const r = await recoverApolloPhoneRevealForCandidate(
            { candidateId: id },
            coreDeps,
          );
          return r.outcome;
        },
      },
    );
    return { summary, gets };
  }

  it('un resultado con teléfono sigue contando como recovered', async () => {
    const { summary, gets } = await runBatch(async () => ({
      kind: 'result',
      payload: {
        people: [{ id: PERSON_ID, phone_numbers: [{ sanitized_number: SYNTHETIC_PHONE }] }],
      },
    }));
    assert.equal(summary.checked, 1);
    assert.equal(summary.recovered, 1);
    assert.equal(gets.length, 1);
  });

  it('un resultado sin teléfono ni señal de pendiente sigue siendo no_phone_found', async () => {
    const { summary } = await runBatch(async () => ({ kind: 'result', payload: {} }));
    assert.equal(summary.no_phone_found, 1);
    assert.equal(summary.still_pending, 0);
  });

  it('un payload PENDIENTE ya no se cierra en falso: cuenta como still_pending', async () => {
    const { summary } = await runBatch(async () => ({
      kind: 'result',
      payload: { status: 'pending', retry_after_seconds: 10 },
    }));
    assert.equal(summary.no_phone_found, 0, 'no debe terminalizarse');
    assert.equal(summary.still_pending, 1);
  });

  it('200 sin cuerpo y 404 siguen contando como still_pending', async () => {
    const empty = await runBatch(async () => ({ kind: 'no_result_yet' }));
    assert.equal(empty.summary.still_pending, 1);
    const notFound = await runBatch(async () => ({ kind: 'not_found' }));
    assert.equal(notFound.summary.still_pending, 1);
  });

  it('401 sigue contando como failed', async () => {
    const { summary } = await runBatch(async () => ({ kind: 'unauthorized' }));
    assert.equal(summary.failed, 1);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Contratos estáticos
// ═══════════════════════════════════════════════════════════════

describe('L3 — contrato estático de la acción y la UI', () => {
  const action = readFileSync(
    join(MODULE_DIR, 'phone-reveal-manual-recovery-actions.ts'),
    'utf8',
  );
  const runtime = readFileSync(
    join(MODULE_DIR, 'phone-reveal-manual-recovery-runtime-core.ts'),
    'utf8',
  );
  const sheet = readFileSync(
    join(
      REPO_ROOT,
      'src/components/contact-enrichment/contact-candidate-detail-sheet.tsx',
    ),
    'utf8',
  );

  /** Quita comentarios: las cabeceras nombran a propósito lo que NO se hace. */
  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  it('la acción reutiliza el recovery core mergeado (no duplica el poll)', () => {
    assert.ok(action.includes('recoverApolloPhoneRevealForCandidate'));
    assert.ok(action.includes('buildRecoveryCoreDeps'));
    assert.ok(!action.includes('fetchApolloPhoneRevealWebhookResult'));
  });

  it('la acción NO puede iniciar un reveal ni llamar a otros proveedores', () => {
    const code = stripComments(action).toLowerCase();
    for (const forbidden of [
      'startapollophonereveal',
      'people/match',
      'reveal_phone_number',
      'lusha',
      'hubspot',
    ]) {
      assert.ok(!code.includes(forbidden), `la acción no debe usar ${forbidden}`);
    }
  });

  it('la acción es un solo candidato: sin batch ni stale', () => {
    const code = stripComments(action);
    assert.ok(!code.includes('recoverStaleApolloPhoneRevealRequests'));
    assert.ok(!code.includes('findStaleApolloPhoneRevealCandidateIds'));
  });

  it('la acción tiene candado anti-doble-clic en el servidor', () => {
    assert.ok(action.includes('inFlightCandidateIds'));
    assert.ok(action.includes('recovery_already_in_progress'));
  });

  it('el runtime L3 no hace I/O propio (todo inyectado)', () => {
    const code = stripComments(runtime).toLowerCase();
    for (const forbidden of ['fetch(', 'supabase', 'process.env', 'console.']) {
      assert.ok(!code.includes(forbidden), `el runtime no debe usar ${forbidden}`);
    }
  });

  it('la UI no introduce polling automático (sin setInterval ni setTimeout)', () => {
    const code = stripComments(sheet);
    assert.ok(!code.includes('setInterval'));
    assert.ok(!code.includes('setTimeout'));
  });

  it('la UI llama a la acción L3 y sigue sin exponer el request id', () => {
    assert.ok(sheet.includes('recoverCandidatePhoneRevealNowAction'));
    assert.ok(!sheet.includes('phone_reveal_request_id'));
  });
});
