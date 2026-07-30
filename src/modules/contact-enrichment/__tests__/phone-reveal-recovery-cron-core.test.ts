/**
 * Agente 2A — Apollo Phone Reveal: RECOVERY L2 programado
 * (APOLLO-PHONE-RECOVERY-CRON-1)
 *
 * Suite OFFLINE del núcleo puro del cron + su composición con el batch REAL del
 * recovery core. NUNCA llama a Apollo, NUNCA toca Supabase, NUNCA lee env, NUNCA
 * consume créditos y NUNCA maneja PII: todo el I/O son fakes inyectados.
 *
 * Qué se garantiza aquí:
 *   1. Sin secreto / con secreto incorrecto / sin secreto configurado ⇒ 401 y CERO
 *      trabajo (no se selecciona, no se hace poll, no se escribe).
 *   2. Con secreto válido pero flag OFF ⇒ 200 `disabled` y CERO trabajo.
 *   3. Con secreto válido y flag ON ⇒ se ejecuta el batch con los caps
 *      normalizados; `?dryRun` solo selecciona.
 *   4. Selección: solo requested/pending viejos; nunca recientes, nunca
 *      terminales, nunca sin recovery id; tope por corrida respetado.
 *   5. Exactamente 1 GET por candidato por corrida y sin retry.
 *   6. El tombstone de supresión bloquea la persistencia del teléfono.
 *   7. Ningún log lleva PII.
 *
 * Requiere: node --import tsx --test <thisfile>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  authorizeRecoveryCronRequest,
  clampCronMaxCandidates,
  clampCronMinAgeMinutes,
  extractCronSecretFromAuthorizationHeader,
  runScheduledStalePhoneRevealRecovery,
  RECOVERY_CRON_DEFAULT_MAX_CANDIDATES,
  RECOVERY_CRON_DEFAULT_MIN_AGE_MINUTES,
  RECOVERY_CRON_MAX_CANDIDATES_CAP,
  RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR,
  type RecoveryCronRunDeps,
} from '../phone-reveal-recovery-cron-core';
import {
  recoverApolloPhoneRevealForCandidate,
  recoverStaleApolloPhoneRevealRequests,
  resolveStaleRecoveryCutoffIso,
  type RecoverApolloPhoneRevealDeps,
  type RecoveryCandidateRecord,
  type RecoveryPersistencePatch,
  type RecoveryUsageLogEntry,
  type StaleRecoveryQuery,
  type StaleRecoverySummary,
} from '../phone-reveal-recovery-core';
import type { ApolloPhoneRevealWebhookPayload } from '../phone-reveal-webhook-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

// Valores FALSOS a propósito: ningún secreto real vive en un test.
const SECRET = 'fake-cron-secret-not-real-0000';
const WRONG_SECRET = 'fake-cron-secret-not-real-9999';
const RECOVERY_ID = '-4594297923800105423';
const NOW = '2026-07-30T12:00:00.000Z';

/** Teléfono FALSO de laboratorio. Nunca se asserta que aparezca en un log. */
const FAKE_PHONE = '+573001112233';

const revealedPayload: ApolloPhoneRevealWebhookPayload = {
  request_id: RECOVERY_ID,
  phone_numbers: [
    { sanitized_number: FAKE_PHONE, type_cd: 'mobile', credits_consumed: 8 },
  ],
};

// ── Fakes del batch ────────────────────────────────────────────

interface BatchSpy {
  calls: Array<{
    maxCandidates?: number;
    minAgeMinutes?: number;
    dryRun?: boolean;
    actorUserId?: string | null;
  }>;
}

function spyDeps(
  spy: BatchSpy,
  overrides: Partial<RecoveryCronRunDeps> = {},
): RecoveryCronRunDeps {
  return {
    expectedSecret: SECRET,
    enabled: true,
    recoverStale: async (input): Promise<StaleRecoverySummary> => {
      spy.calls.push({
        maxCandidates: input.maxCandidates,
        minAgeMinutes: input.minAgeMinutes,
        dryRun: input.dryRun,
        actorUserId: input.actorUserId,
      });
      return {
        checked: 0,
        recovered: 0,
        still_pending: 0,
        no_phone_found: 0,
        failed: 0,
        skipped: 0,
        dryRun: input.dryRun !== false,
        maxCandidates: input.maxCandidates ?? RECOVERY_CRON_DEFAULT_MAX_CANDIDATES,
        minAgeMinutes: input.minAgeMinutes ?? RECOVERY_CRON_DEFAULT_MIN_AGE_MINUTES,
      };
    },
    ...overrides,
  };
}

// ── 1. Autorización por secreto ────────────────────────────────

describe('cron L2 — autorización por secreto', () => {
  it('rechaza cuando NO se envía secreto (401, sin trabajo)', async () => {
    const spy: BatchSpy = { calls: [] };
    const res = await runScheduledStalePhoneRevealRecovery(
      { providedSecret: null },
      spyDeps(spy),
    );
    assert.equal(res.httpStatus, 401);
    assert.equal(res.status, 'unauthorized');
    assert.equal(res.ok, false);
    assert.equal(res.denialCode, 'cron_secret_missing');
    assert.equal(spy.calls.length, 0, 'no debe ejecutar el batch');
    assert.equal(res.checked, 0);
  });

  it('rechaza con secreto incorrecto (401, sin trabajo)', async () => {
    const spy: BatchSpy = { calls: [] };
    const res = await runScheduledStalePhoneRevealRecovery(
      { providedSecret: WRONG_SECRET },
      spyDeps(spy),
    );
    assert.equal(res.httpStatus, 401);
    assert.equal(res.denialCode, 'cron_secret_mismatch');
    assert.equal(spy.calls.length, 0);
  });

  it('fail-closed: sin CRON_SECRET configurado NADA autoriza (ni "")', async () => {
    for (const expected of [null, '', '   ']) {
      const spy: BatchSpy = { calls: [] };
      const res = await runScheduledStalePhoneRevealRecovery(
        { providedSecret: expected ?? '' },
        spyDeps(spy, { expectedSecret: expected }),
      );
      assert.equal(res.httpStatus, 401, `expected=${JSON.stringify(expected)}`);
      assert.equal(res.denialCode, 'cron_secret_not_configured');
      assert.equal(spy.calls.length, 0);
    }
  });

  it('acepta con el secreto correcto', async () => {
    const spy: BatchSpy = { calls: [] };
    const res = await runScheduledStalePhoneRevealRecovery(
      { providedSecret: SECRET },
      spyDeps(spy),
    );
    assert.equal(res.httpStatus, 200);
    assert.equal(res.status, 'executed');
    assert.equal(res.denialCode, null);
    assert.equal(spy.calls.length, 1);
  });

  it('authorizeRecoveryCronRequest es fail-closed en todas las combinaciones', () => {
    assert.equal(authorizeRecoveryCronRequest(SECRET, SECRET).authorized, true);
    assert.equal(authorizeRecoveryCronRequest(SECRET, WRONG_SECRET).authorized, false);
    assert.equal(authorizeRecoveryCronRequest(null, SECRET).authorized, false);
    assert.equal(authorizeRecoveryCronRequest(SECRET, null).authorized, false);
    assert.equal(authorizeRecoveryCronRequest(null, null).authorized, false);
    // Un prefijo del secreto no autoriza (comparación de longitud primero).
    assert.equal(
      authorizeRecoveryCronRequest(SECRET.slice(0, 5), SECRET).authorized,
      false,
    );
  });

  it('extrae el secreto del header Bearer que manda Vercel Cron', () => {
    assert.equal(
      extractCronSecretFromAuthorizationHeader(`Bearer ${SECRET}`),
      SECRET,
    );
    assert.equal(
      extractCronSecretFromAuthorizationHeader(`bearer ${SECRET}`),
      SECRET,
    );
    assert.equal(extractCronSecretFromAuthorizationHeader(null), null);
    assert.equal(extractCronSecretFromAuthorizationHeader(''), null);
    assert.equal(extractCronSecretFromAuthorizationHeader('Bearer'), null);
    assert.equal(extractCronSecretFromAuthorizationHeader('Bearer   '), null);
    // Otro esquema no cuela.
    assert.equal(extractCronSecretFromAuthorizationHeader(`Basic ${SECRET}`), null);
  });
});

// ── 2. Gate de flag ────────────────────────────────────────────

describe('cron L2 — gate de flag', () => {
  it('flag OFF ⇒ 200 disabled y CERO trabajo (aunque el secreto sea válido)', async () => {
    const spy: BatchSpy = { calls: [] };
    const res = await runScheduledStalePhoneRevealRecovery(
      { providedSecret: SECRET },
      spyDeps(spy, { enabled: false }),
    );
    assert.equal(res.httpStatus, 200, 'no-op sano: 200, no un fallo');
    assert.equal(res.status, 'disabled');
    assert.equal(res.ok, true);
    assert.equal(spy.calls.length, 0, 'no selecciona, no hace poll, no escribe');
    assert.equal(res.checked, 0);
    assert.equal(res.recovered, 0);
  });

  it('el secreto se evalúa ANTES del flag (flag OFF no abre el endpoint)', async () => {
    const spy: BatchSpy = { calls: [] };
    const res = await runScheduledStalePhoneRevealRecovery(
      { providedSecret: WRONG_SECRET },
      spyDeps(spy, { enabled: false }),
    );
    assert.equal(res.status, 'unauthorized');
    assert.equal(res.httpStatus, 401);
    assert.equal(spy.calls.length, 0);
  });
});

// ── 3. dryRun y normalización de caps ──────────────────────────

describe('cron L2 — dryRun y caps', () => {
  it('por defecto EJECUTA (dryRun false): un cron que solo simula no desatasca', async () => {
    const spy: BatchSpy = { calls: [] };
    const res = await runScheduledStalePhoneRevealRecovery(
      { providedSecret: SECRET },
      spyDeps(spy),
    );
    assert.equal(spy.calls[0].dryRun, false);
    assert.equal(res.status, 'executed');
  });

  it('dryRun=true ⇒ el batch corre en simulación', async () => {
    const spy: BatchSpy = { calls: [] };
    const res = await runScheduledStalePhoneRevealRecovery(
      { providedSecret: SECRET, dryRun: true },
      spyDeps(spy),
    );
    assert.equal(spy.calls[0].dryRun, true);
    assert.equal(res.status, 'dry_run');
    assert.equal(res.dryRun, true);
  });

  it('el cron NUNCA pasa un actor humano (actorUserId null)', async () => {
    const spy: BatchSpy = { calls: [] };
    await runScheduledStalePhoneRevealRecovery(
      { providedSecret: SECRET },
      spyDeps(spy),
    );
    assert.equal(spy.calls[0].actorUserId, null);
  });

  it('maxCandidates se normaliza al rango [1, cap]', () => {
    assert.equal(clampCronMaxCandidates(undefined), RECOVERY_CRON_DEFAULT_MAX_CANDIDATES);
    assert.equal(clampCronMaxCandidates(null), RECOVERY_CRON_DEFAULT_MAX_CANDIDATES);
    assert.equal(clampCronMaxCandidates(Number.NaN), RECOVERY_CRON_DEFAULT_MAX_CANDIDATES);
    assert.equal(clampCronMaxCandidates(0), 1);
    assert.equal(clampCronMaxCandidates(-7), 1);
    assert.equal(clampCronMaxCandidates(3), 3);
    assert.equal(clampCronMaxCandidates(3.9), 3);
    assert.equal(clampCronMaxCandidates(999), RECOVERY_CRON_MAX_CANDIDATES_CAP);
  });

  it('minAgeMinutes nunca baja del suelo: no se hace poll a reveals recientes', () => {
    assert.equal(clampCronMinAgeMinutes(undefined), RECOVERY_CRON_DEFAULT_MIN_AGE_MINUTES);
    assert.equal(clampCronMinAgeMinutes(null), RECOVERY_CRON_DEFAULT_MIN_AGE_MINUTES);
    assert.equal(clampCronMinAgeMinutes(Number.NaN), RECOVERY_CRON_DEFAULT_MIN_AGE_MINUTES);
    assert.equal(clampCronMinAgeMinutes(0), RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR);
    assert.equal(clampCronMinAgeMinutes(-100), RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR);
    assert.equal(clampCronMinAgeMinutes(1), RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR);
    assert.equal(clampCronMinAgeMinutes(30), 30);
    assert.ok(RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR >= 10, 'el suelo debe ser ≥ 10 min');
  });

  it('los caps normalizados llegan al batch y se reportan', async () => {
    const spy: BatchSpy = { calls: [] };
    const res = await runScheduledStalePhoneRevealRecovery(
      { providedSecret: SECRET, maxCandidates: 500, minAgeMinutes: 0 },
      spyDeps(spy),
    );
    assert.equal(spy.calls[0].maxCandidates, RECOVERY_CRON_MAX_CANDIDATES_CAP);
    assert.equal(spy.calls[0].minAgeMinutes, RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR);
    assert.equal(res.maxCandidates, RECOVERY_CRON_MAX_CANDIDATES_CAP);
    assert.equal(res.minAgeMinutes, RECOVERY_CRON_MIN_AGE_MINUTES_FLOOR);
  });
});

// ── 4. Selección: qué candidatos entran (batch REAL) ───────────

/**
 * Fila mínima de un candidato de laboratorio, con lo que la selección real mira.
 * `requestedAt` decide si es stale respecto al corte.
 */
interface FakeRow {
  id: string;
  provider: string;
  status: string;
  requestId: string | null;
  phone: string | null;
  requestedAt: string;
}

function row(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'cand-old-1',
    provider: 'apollo',
    status: 'requested',
    requestId: RECOVERY_ID,
    phone: null,
    // 45 min de antigüedad respecto a NOW ⇒ stale con cualquier ventana ≥ 10.
    requestedAt: '2026-07-30T11:15:00.000Z',
    ...overrides,
  };
}

/**
 * Reproduce EXACTAMENTE los filtros de la query real
 * (findStaleApolloPhoneRevealCandidateIds): provider apollo, status en vuelo,
 * request id presente, sin teléfono, requestedAt <= corte; FIFO y limitado.
 * El test estático de más abajo verifica que la query real siga teniendo estos
 * mismos filtros.
 */
function selectStale(rows: FakeRow[], query: StaleRecoveryQuery): string[] {
  const cutoff = resolveStaleRecoveryCutoffIso(query.nowIso, query.minAgeMinutes);
  return rows
    .filter(
      (r) =>
        r.provider === 'apollo' &&
        (r.status === 'requested' || r.status === 'pending') &&
        r.requestId !== null &&
        r.phone === null &&
        r.requestedAt <= cutoff,
    )
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
    .map((r) => r.id)
    .slice(0, query.maxCandidates);
}

async function runBatchOverRows(
  rows: FakeRow[],
  opts: { maxCandidates?: number; minAgeMinutes?: number; dryRun?: boolean } = {},
): Promise<{ summary: StaleRecoverySummary; visited: string[] }> {
  const visited: string[] = [];
  const res = await runScheduledStalePhoneRevealRecovery(
    { providedSecret: SECRET, ...opts },
    {
      expectedSecret: SECRET,
      enabled: true,
      recoverStale: (coreInput) =>
        recoverStaleApolloPhoneRevealRequests(coreInput, {
          nowIso: NOW,
          findStaleCandidateIds: async (query) => selectStale(rows, query),
          recoverOne: async (candidateId) => {
            visited.push(candidateId);
            return 'still_pending';
          },
        }),
    },
  );
  return {
    summary: {
      checked: res.checked,
      recovered: res.recovered,
      still_pending: res.stillPending,
      no_phone_found: res.noPhoneFound,
      failed: res.failed,
      skipped: res.skipped,
      dryRun: res.dryRun,
      maxCandidates: res.maxCandidates,
      minAgeMinutes: res.minAgeMinutes,
    },
    visited,
  };
}

describe('cron L2 — selección de candidatos', () => {
  it('selecciona requested y pending VIEJOS', async () => {
    const { summary, visited } = await runBatchOverRows([
      row({ id: 'a', status: 'requested' }),
      row({ id: 'b', status: 'pending' }),
    ]);
    assert.equal(summary.checked, 2);
    assert.deepEqual(visited.sort(), ['a', 'b']);
  });

  it('NO selecciona candidatos recientes (dentro de la ventana del webhook)', async () => {
    // 5 min de antigüedad: por debajo del suelo de 10 min.
    const { summary, visited } = await runBatchOverRows([
      row({ id: 'fresh', requestedAt: '2026-07-30T11:55:00.000Z' }),
    ]);
    assert.equal(summary.checked, 0);
    assert.deepEqual(visited, []);
  });

  it('NO selecciona terminales (revealed / no_phone_found / error)', async () => {
    const { summary, visited } = await runBatchOverRows([
      row({ id: 'revealed', status: 'revealed' }),
      row({ id: 'nopf', status: 'no_phone_found' }),
      row({ id: 'err', status: 'error' }),
    ]);
    assert.equal(summary.checked, 0);
    assert.deepEqual(visited, []);
  });

  it('NO selecciona sin recovery id (phone_reveal_request_id null)', async () => {
    const { summary } = await runBatchOverRows([row({ id: 'norid', requestId: null })]);
    assert.equal(summary.checked, 0);
  });

  it('NO selecciona si ya hay teléfono, ni de otro proveedor', async () => {
    const { summary } = await runBatchOverRows([
      row({ id: 'has-phone', phone: FAKE_PHONE }),
      row({ id: 'lusha', provider: 'lusha' }),
    ]);
    assert.equal(summary.checked, 0);
  });

  it('respeta el tope por corrida y deja el resto para la siguiente (FIFO)', async () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row({
        id: `c${String(i).padStart(2, '0')}`,
        requestedAt: `2026-07-30T10:${String(i).padStart(2, '0')}:00.000Z`,
      }),
    );
    const { summary, visited } = await runBatchOverRows(rows, { maxCandidates: 3 });
    assert.equal(summary.checked, 3);
    assert.deepEqual(visited, ['c00', 'c01', 'c02'], 'los más antiguos primero');
  });

  it('el tope duro se aplica aunque se pida más', async () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row({
        id: `c${String(i).padStart(2, '0')}`,
        requestedAt: `2026-07-30T10:${String(i % 60).padStart(2, '0')}:00.000Z`,
      }),
    );
    const { summary } = await runBatchOverRows(rows, { maxCandidates: 999 });
    assert.equal(summary.checked, RECOVERY_CRON_MAX_CANDIDATES_CAP);
  });

  it('dryRun selecciona pero NO recupera ninguno', async () => {
    const { summary, visited } = await runBatchOverRows(
      [row({ id: 'a' }), row({ id: 'b', requestedAt: '2026-07-30T11:20:00.000Z' })],
      { dryRun: true },
    );
    assert.equal(summary.checked, 2);
    assert.equal(summary.skipped, 2);
    assert.deepEqual(visited, [], 'dryRun no invoca recoverOne');
  });
});

// ── 5. 1 GET por candidato, sin retry, sin reveal nuevo ────────

interface Captured {
  patches: Array<{ id: string; patch: RecoveryPersistencePatch }>;
  logs: RecoveryUsageLogEntry[];
  fetchCalls: string[];
}

function candidateRecord(
  overrides: Partial<RecoveryCandidateRecord> = {},
): RecoveryCandidateRecord {
  return {
    id: 'cand-1',
    accountId: 'acct-1',
    phoneRevealProvider: 'apollo',
    source: 'apollo',
    phoneRevealStatus: 'requested',
    existingPhone: null,
    enrichmentMetadata: {},
    phoneProcessingBasis: 'legitimate_interest_b2b',
    apolloPersonId: '0123456789abcdef01234567',
    candidateCountry: 'CO',
    runCompanyCountryCode: 'CO',
    ...overrides,
  };
}

function realCoreDeps(args: {
  captured: Captured;
  candidateById: (id: string) => RecoveryCandidateRecord | null;
  suppressed?: boolean;
  suppressionThrows?: boolean;
}): RecoverApolloPhoneRevealDeps {
  return {
    nowIso: NOW,
    loadCandidate: async (id) => args.candidateById(id),
    resolveRecoveryRequestId: async () => RECOVERY_ID,
    fetchWebhookResult: async (rid) => {
      args.captured.fetchCalls.push(rid);
      return { kind: 'result', payload: revealedPayload };
    },
    persist: async (id, patch) => {
      args.captured.patches.push({ id, patch });
    },
    logUsage: async (entry) => {
      args.captured.logs.push(entry);
    },
    lookupPhoneCacheSuppression: async () => {
      if (args.suppressionThrows) throw new Error('suppression store unavailable');
      return args.suppressed ? { suppressedAt: NOW } : null;
    },
  };
}

async function runRealRecoveryBatch(
  ids: string[],
  args: {
    captured: Captured;
    suppressed?: boolean;
    suppressionThrows?: boolean;
  },
) {
  const deps = realCoreDeps({
    captured: args.captured,
    candidateById: (id) => candidateRecord({ id }),
    suppressed: args.suppressed,
    suppressionThrows: args.suppressionThrows,
  });
  return runScheduledStalePhoneRevealRecovery(
    { providedSecret: SECRET },
    {
      expectedSecret: SECRET,
      enabled: true,
      recoverStale: (coreInput) =>
        recoverStaleApolloPhoneRevealRequests(coreInput, {
          nowIso: NOW,
          findStaleCandidateIds: async () => ids,
          recoverOne: async (candidateId) => {
            const r = await recoverApolloPhoneRevealForCandidate(
              { candidateId, actorUserId: null, reason: 'test' },
              deps,
            );
            return r.outcome;
          },
        }),
    },
  );
}

describe('cron L2 — 1 GET por candidato, sin retry, sin reveal nuevo', () => {
  it('hace EXACTAMENTE un GET de recuperación por candidato', async () => {
    const captured: Captured = { patches: [], logs: [], fetchCalls: [] };
    const res = await runRealRecoveryBatch(['a', 'b', 'c'], { captured });
    assert.equal(res.status, 'executed');
    assert.equal(captured.fetchCalls.length, 3, 'un GET por candidato, ni uno más');
    assert.ok(
      captured.fetchCalls.every((rid) => rid === RECOVERY_ID),
      'siempre el recovery id persistido, nunca uno inventado',
    );
  });

  it('reutiliza el recovery id ya persistido: no inicia ningún reveal nuevo', async () => {
    const captured: Captured = { patches: [], logs: [], fetchCalls: [] };
    await runRealRecoveryBatch(['a'], { captured });
    // El único I/O de proveedor fue el GET de recuperación. Ningún patch reabre el
    // ciclo pidiendo un reveal: los status escritos son terminales o de espera.
    assert.equal(captured.fetchCalls.length, 1);
    for (const { patch } of captured.patches) {
      assert.notEqual(patch.phone_reveal_status, 'requested');
      assert.notEqual(patch.phone_reveal_status, 'pending');
    }
  });

  it('cada poll deja constancia de la comprobación (last_checked_at)', async () => {
    const captured: Captured = { patches: [], logs: [], fetchCalls: [] };
    await runRealRecoveryBatch(['a'], { captured });
    assert.ok(captured.patches.length > 0, 'debe persistir algo');
    for (const { patch } of captured.patches) {
      assert.equal(patch.phone_reveal_last_checked_at, NOW);
    }
  });
});

// ── 6. Supresión (tombstone) ───────────────────────────────────

describe('cron L2 — supresión', () => {
  it('un tombstone vigente BLOQUEA la persistencia del teléfono', async () => {
    const captured: Captured = { patches: [], logs: [], fetchCalls: [] };
    const res = await runRealRecoveryBatch(['a'], { captured, suppressed: true });
    assert.equal(res.status, 'executed');
    for (const { patch } of captured.patches) {
      assert.ok(
        patch.phone === undefined || patch.phone === null,
        'nunca se escribe teléfono con supresión vigente',
      );
    }
    assert.equal(res.recovered, 0, 'una supresión no cuenta como recuperación');
  });

  it('si la supresión no se puede comprobar, tampoco se persiste teléfono', async () => {
    const captured: Captured = { patches: [], logs: [], fetchCalls: [] };
    const res = await runRealRecoveryBatch(['a'], {
      captured,
      suppressionThrows: true,
    });
    for (const { patch } of captured.patches) {
      assert.ok(patch.phone === undefined || patch.phone === null);
    }
    assert.equal(res.recovered, 0);
    assert.equal(res.failed, 1, 'condición técnica sin resolver: visible como failed');
  });
});

// ── 7. Logs sin PII ────────────────────────────────────────────

describe('cron L2 — logs sin PII', () => {
  it('ningún usage-log del recovery programado lleva el teléfono ni datos personales', async () => {
    const captured: Captured = { patches: [], logs: [], fetchCalls: [] };
    await runRealRecoveryBatch(['a', 'b'], { captured });
    assert.ok(captured.logs.length > 0, 'debe haber logs');
    const serialized = JSON.stringify(captured.logs);
    for (const forbidden of [
      FAKE_PHONE,
      '3001112233',
      'sanitized_number',
      'raw_number',
      '@',
      'linkedin',
    ]) {
      assert.ok(
        !serialized.includes(forbidden),
        `el log no debe contener "${forbidden}"`,
      );
    }
  });

  it('el resultado del cron solo expone conteos (nunca ids de candidato)', async () => {
    const captured: Captured = { patches: [], logs: [], fetchCalls: [] };
    const res = await runRealRecoveryBatch(['cand-secreto'], { captured });
    const serialized = JSON.stringify(res);
    assert.ok(!serialized.includes('cand-secreto'));
    assert.ok(!serialized.includes(FAKE_PHONE));
    assert.ok(!serialized.includes(RECOVERY_ID));
  });
});

// ── 8. Candados estáticos ──────────────────────────────────────

function readRepoFile(relative: string): string {
  return readFileSync(join(REPO_ROOT, relative), 'utf8');
}

/**
 * Igual que readRepoFile pero sin comentarios, para candados que hablan del CÓDIGO
 * EJECUTABLE: los encabezados de estos módulos documentan justo lo que NO hacen
 * ("no llama /people/match", "no toca Lusha"), y un grep crudo confundiría la
 * documentación con una llamada real.
 */
function readRepoCode(relative: string): string {
  return readRepoFile(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .map((line) => line.replace(/\s+\/\/.*$/, ''))
    .join('\n');
}

describe('cron L2 — candados estáticos', () => {
  const CORE = 'src/modules/contact-enrichment/phone-reveal-recovery-cron-core.ts';
  const ROUTE = 'src/app/api/cron/phone-reveal-recovery/route.ts';
  const DEPS = 'src/modules/contact-enrichment/phone-reveal-recovery-deps.ts';

  it('el core del cron es PURO: sin fetch, sin Supabase, sin env, sin console', () => {
    const src = readRepoCode(CORE);
    for (const forbidden of [
      'fetch(',
      'createClient',
      'process.env',
      'console.',
      'setInterval',
      'setTimeout',
    ]) {
      assert.ok(!src.includes(forbidden), `el core no debe usar ${forbidden}`);
    }
  });

  it('la ruta NO acepta el secreto por query string (no acabaría en logs de acceso)', () => {
    const src = readRepoFile(ROUTE);
    assert.ok(
      src.includes("request.headers.get('Authorization')"),
      'el secreto se lee del header Authorization',
    );
    assert.ok(
      !/searchParams\.get\(\s*['"](token|secret|cron_secret)['"]\s*\)/.test(src),
      'ningún secreto por query param',
    );
  });

  it('la ruta NO llama al START de Apollo ni a Lusha ni a HubSpot', () => {
    const src = readRepoCode(ROUTE);
    for (const forbidden of [
      'people/match',
      'reveal_phone_number',
      'startApolloPhoneReveal',
      'lusha',
      'Lusha',
      'hubspot',
      'HubSpot',
    ]) {
      assert.ok(!src.includes(forbidden), `la ruta no debe referenciar ${forbidden}`);
    }
  });

  it('la ruta pasa por el core: nada de autorización ad-hoc', () => {
    const src = readRepoFile(ROUTE);
    assert.ok(src.includes('runScheduledStalePhoneRevealRecovery'));
    assert.ok(src.includes('isApolloPhoneRevealRecoveryCronEnabled'));
    // El secreto nunca se compara a mano en la ruta.
    assert.ok(!/authHeader\s*!==/.test(src));
  });

  it('la selección real conserva TODOS los filtros de elegibilidad', () => {
    const src = readRepoFile(DEPS);
    for (const filter of [
      "eq('phone_reveal_provider', 'apollo')",
      "in('phone_reveal_status', ['requested', 'pending'])",
      "not('phone_reveal_request_id', 'is', null)",
      "is('phone', null)",
      "lte('phone_reveal_requested_at', cutoffIso)",
      'limit(query.maxCandidates)',
    ]) {
      assert.ok(src.includes(filter), `falta el filtro: ${filter}`);
    }
  });

  it('vercel.json agenda el endpoint del recovery y NADA que gaste IA/créditos', () => {
    const vercelConfig = JSON.parse(readRepoFile('vercel.json')) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const crons = vercelConfig.crons ?? [];
    assert.equal(crons.length, 1, 'un solo cron declarado en este hito');
    assert.equal(crons[0].path, '/api/cron/phone-reveal-recovery');
    assert.match(crons[0].schedule, /^\S+ \S+ \S+ \S+ \S+$/, 'cron de 5 campos');
    // El worker de enriquecimiento gasta IA: no se agenda aquí.
    const paths = crons.map((c) => c.path);
    assert.ok(!paths.includes('/api/cron/enrich'));
    assert.ok(!paths.includes('/api/cron/post-approval-nit-enrich'));
  });
});
