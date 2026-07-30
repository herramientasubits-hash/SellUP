/**
 * Agente 2A — Apollo Phone Reveal RECOVERY L2: endpoint del cron
 * (APOLLO-PHONE-RECOVERY-CRON-1)
 *
 * Ejercita los handlers GET/POST de
 *   src/app/api/cron/phone-reveal-recovery/route.ts
 * enteramente OFFLINE. Este test NUNCA llama a Apollo, NUNCA llama a Lusha, NUNCA
 * toca Supabase (ni real ni local), NUNCA consume créditos y NUNCA escribe nada.
 *
 * Estrategia de mocks:
 *   - `phone-reveal-recovery-deps` (el ÚNICO módulo con I/O real: cliente
 *     service-role + GET a Apollo) está module-mockeado. Sus dos exports quedan
 *     como fakes que registran si se los llamó, así que cualquier ejecución
 *     indebida (401, flag apagado) se detecta como "se tocó el I/O".
 *   - El núcleo puro del cron y el recovery core corren de VERDAD: la autorización,
 *     el gate de flag y los caps que se verifican son los reales.
 *   - `globalThis.fetch` se rompe a propósito: cualquier llamada de red real
 *     revienta el test.
 *
 * Requiere: node --import tsx --experimental-test-module-mocks --test <thisfile>
 */

import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Secretos FALSOS a propósito: nunca hay un secreto real en un test.
const SECRET = 'fake-cron-secret-not-real-0000';
const WRONG_SECRET = 'fake-cron-secret-not-real-9999';
const CRON_URL = 'https://app.test/api/cron/phone-reveal-recovery';

const FLAG = 'ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON';

// ── Estado observable del I/O mockeado ─────────────────────────

interface IoSpy {
  buildDepsCalls: number;
  findStaleCalls: number;
  recoveredIds: string[];
  /** Ids que la selección "encuentra" en cada corrida. */
  staleIds: string[];
}

const io: IoSpy = {
  buildDepsCalls: 0,
  findStaleCalls: 0,
  recoveredIds: [],
  staleIds: [],
};

// El módulo de deps es el único con I/O real: se sustituye entero.
mock.module('@/modules/contact-enrichment/phone-reveal-recovery-deps', {
  namedExports: {
    buildRecoveryCoreDeps: () => {
      io.buildDepsCalls += 1;
      return {
        nowIso: '2026-07-30T12:00:00.000Z',
        loadCandidate: async () => null,
        resolveRecoveryRequestId: async () => null,
        fetchWebhookResult: async () => {
          throw new Error('el test no debe llegar a Apollo');
        },
        persist: async () => {},
        logUsage: async () => {},
      };
    },
    findStaleApolloPhoneRevealCandidateIds: async () => {
      io.findStaleCalls += 1;
      return io.staleIds;
    },
  },
});

// El recovery de UN candidato también se sustituye: aquí solo interesa el
// contrato del endpoint (autorización, flag, forma de la respuesta), no la lógica
// L1 que ya cubre phone-reveal-recovery-core.test.ts.
mock.module('@/modules/contact-enrichment/phone-reveal-recovery-core', {
  namedExports: {
    recoverApolloPhoneRevealForCandidate: async (input: { candidateId: string }) => {
      io.recoveredIds.push(input.candidateId);
      return { outcome: 'still_pending', phoneRevealed: false };
    },
    recoverStaleApolloPhoneRevealRequests: async (
      input: { maxCandidates?: number; minAgeMinutes?: number; dryRun?: boolean },
      deps: {
        findStaleCandidateIds: (q: unknown) => Promise<string[]>;
        recoverOne: (id: string) => Promise<string>;
      },
    ) => {
      const ids = await deps.findStaleCandidateIds({
        maxCandidates: input.maxCandidates,
        minAgeMinutes: input.minAgeMinutes,
        nowIso: '2026-07-30T12:00:00.000Z',
      });
      const dryRun = input.dryRun !== false;
      if (!dryRun) {
        for (const id of ids) await deps.recoverOne(id);
      }
      return {
        checked: ids.length,
        recovered: 0,
        still_pending: dryRun ? 0 : ids.length,
        no_phone_found: 0,
        failed: 0,
        skipped: dryRun ? ids.length : 0,
        dryRun,
        maxCandidates: input.maxCandidates ?? 5,
        minAgeMinutes: input.minAgeMinutes ?? 15,
      };
    },
    // El núcleo del cron importa estas constantes/helpers del recovery core.
    DEFAULT_BATCH_MAX_CANDIDATES: 5,
    MAX_BATCH_MAX_CANDIDATES: 10,
    DEFAULT_BATCH_MIN_AGE_MINUTES: 15,
    resolveStaleRecoveryCutoffIso: (nowIso: string, minAgeMinutes: number) =>
      new Date(new Date(nowIso).getTime() - minAgeMinutes * 60_000).toISOString(),
  },
});

// ── Carga del módulo bajo test ─────────────────────────────────

type Handler = (request: unknown) => Promise<Response>;
let GET: Handler;
let POST: Handler;
let NextRequestCtor: new (input: string, init?: RequestInit) => unknown;

const originalFetch = globalThis.fetch;

before(async () => {
  process.env.CRON_SECRET = SECRET;
  const route = await import('../route');
  GET = route.GET as unknown as Handler;
  POST = route.POST as unknown as Handler;
  const next = await import('next/server');
  NextRequestCtor = next.NextRequest as unknown as typeof NextRequestCtor;
});

beforeEach(() => {
  io.buildDepsCalls = 0;
  io.findStaleCalls = 0;
  io.recoveredIds = [];
  io.staleIds = [];
  process.env.CRON_SECRET = SECRET;
  // Ninguna llamada de red real: si alguien intenta fetch, el test falla.
  globalThis.fetch = (async () => {
    throw new Error('llamada de red real prohibida en este test');
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env[FLAG];
});

function request(opts: { secret?: string | null; query?: string } = {}) {
  const headers = new Headers();
  if (opts.secret !== null && opts.secret !== undefined) {
    headers.set('Authorization', `Bearer ${opts.secret}`);
  }
  return new NextRequestCtor(`${CRON_URL}${opts.query ?? ''}`, { headers });
}

/** Ningún I/O se tocó: ni cliente de Supabase, ni selección, ni recovery. */
function assertNoIo() {
  assert.equal(io.buildDepsCalls, 0, 'no debe construir deps (Supabase/Apollo)');
  assert.equal(io.findStaleCalls, 0, 'no debe seleccionar candidatos');
  assert.equal(io.recoveredIds.length, 0, 'no debe recuperar nada');
}

// ── 1. Rechazo sin secreto ─────────────────────────────────────

describe('endpoint cron L2 — rechazo sin secreto', () => {
  it('sin header Authorization ⇒ 401 y cero I/O', async () => {
    const res = await GET(request({ secret: null }));
    assert.equal(res.status, 401);
    const body = (await res.json()) as { ok: boolean; status: string };
    assert.equal(body.ok, false);
    assert.equal(body.status, 'unauthorized');
    assertNoIo();
  });

  it('con secreto incorrecto ⇒ 401 y cero I/O', async () => {
    process.env[FLAG] = 'true';
    const res = await GET(request({ secret: WRONG_SECRET }));
    assert.equal(res.status, 401);
    assertNoIo();
  });

  it('sin CRON_SECRET configurado NADIE entra (ni mandando vacío)', async () => {
    delete process.env.CRON_SECRET;
    process.env[FLAG] = 'true';
    const res = await GET(request({ secret: '' }));
    assert.equal(res.status, 401);
    assertNoIo();
  });

  it('POST se comporta igual que GET (mismo gate)', async () => {
    const res = await POST(request({ secret: null }));
    assert.equal(res.status, 401);
    assertNoIo();
  });

  it('la respuesta 401 no filtra por qué falló ni si el endpoint está configurado', async () => {
    const res = await GET(request({ secret: WRONG_SECRET }));
    const raw = await res.text();
    for (const forbidden of [
      SECRET,
      'not_configured',
      'mismatch',
      'CRON_SECRET',
      'cron_secret',
    ]) {
      assert.ok(!raw.includes(forbidden), `la respuesta no debe incluir "${forbidden}"`);
    }
  });
});

// ── 2. Aceptación con secreto ──────────────────────────────────

describe('endpoint cron L2 — aceptación con secreto', () => {
  it('con secreto válido y flag OFF ⇒ 200 disabled, cero I/O', async () => {
    delete process.env[FLAG];
    const res = await GET(request({ secret: SECRET }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; checked: number };
    assert.equal(body.status, 'disabled');
    assert.equal(body.checked, 0);
    assertNoIo();
  });

  it('el flag solo cuenta con el valor exacto "true"', async () => {
    for (const value of ['1', 'yes', 'TRUE ', 'false', '']) {
      process.env[FLAG] = value;
      const res = await GET(request({ secret: SECRET }));
      const body = (await res.json()) as { status: string };
      const expected = value.trim().toLowerCase() === 'true' ? 'executed' : 'disabled';
      assert.equal(body.status, expected, `valor de flag: ${JSON.stringify(value)}`);
    }
  });

  it('con secreto válido y flag ON ⇒ 200 executed y sí trabaja', async () => {
    process.env[FLAG] = 'true';
    io.staleIds = ['cand-1', 'cand-2'];
    const res = await GET(request({ secret: SECRET }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      status: string;
      checked: number;
      dry_run: boolean;
      max_candidates: number;
      min_age_minutes: number;
    };
    assert.equal(body.status, 'executed');
    assert.equal(body.checked, 2);
    assert.equal(body.dry_run, false);
    assert.equal(body.max_candidates, 5);
    assert.equal(body.min_age_minutes, 15);
    assert.equal(io.findStaleCalls, 1);
    assert.deepEqual(io.recoveredIds, ['cand-1', 'cand-2']);
  });

  it('?dryRun=1 selecciona pero no recupera', async () => {
    process.env[FLAG] = 'true';
    io.staleIds = ['cand-1'];
    const res = await GET(request({ secret: SECRET, query: '?dryRun=1' }));
    const body = (await res.json()) as { status: string; checked: number; dry_run: boolean };
    assert.equal(body.status, 'dry_run');
    assert.equal(body.dry_run, true);
    assert.equal(body.checked, 1);
    assert.deepEqual(io.recoveredIds, [], 'dryRun no recupera');
  });

  it('la respuesta solo lleva conteos: ni ids de candidato ni secretos', async () => {
    process.env[FLAG] = 'true';
    io.staleIds = ['cand-super-secreto'];
    const res = await GET(request({ secret: SECRET }));
    const raw = await res.text();
    assert.ok(!raw.includes('cand-super-secreto'));
    assert.ok(!raw.includes(SECRET));
  });
});
