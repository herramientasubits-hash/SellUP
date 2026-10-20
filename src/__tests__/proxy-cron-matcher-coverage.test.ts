/**
 * AGENT1-AUDIT-WS1 — todo cron programado o publicado queda FUERA de la
 * protección de sesión del proxy, y cada uno se autentica con `CRON_SECRET`.
 *
 * Causa raíz que cubre: `/api/cron/apollo-round-continuation` estaba en
 * `vercel.json` pero no en las exclusiones del matcher de `src/proxy.ts`.
 * Vercel Cron no manda cookie de sesión, así que cada disparo diario recibía
 * 307 → /login y el handler nunca corrió en Producción. Lo mismo para
 * `post-approval-nit-enrich`.
 *
 * Además fija la bandera del cron de continuaciones: abrir el proxy NO puede
 * encender gasto. Con la bandera apagada el cron responde sin tocar la base.
 *
 * Puro y offline: lee ficheros del repo y llama al handler sólo por caminos que
 * no llegan a la base (sin `SUPABASE_*` configurado, llegar a la base daría 500).
 *
 * Correr: node --import tsx --test src/__tests__/proxy-cron-matcher-coverage.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { config } from '../proxy';
import {
  AGENT1_APOLLO_CRON_CONTINUATION_FLAG,
  isAgent1ApolloCronContinuationEnabled,
  pickNextClaimableContinuationBatchId,
  type ContinuationPickClient,
} from '@/modules/prospect-batches/apollo-continuation-cron';

const ROOT = process.cwd();
const CRON_DIR = path.join(ROOT, 'src/app/api/cron');

/** Igual que en `proxy-machine-callback-allowlist.test.ts`: si coincide, el proxy corre. */
function proxyRunsFor(pathname: string): boolean {
  return new RegExp(`^${config.matcher[0]}$`).test(pathname);
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function vercelCronPaths(): string[] {
  const parsed = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')) as {
    crons?: Array<{ path?: unknown }>;
  };
  return (parsed.crons ?? [])
    .map((cron) => cron.path)
    .filter((p): p is string => typeof p === 'string')
    .map((p) => p.split('?')[0]);
}

function cronRouteDirs(): string[] {
  return readdirSync(CRON_DIR).filter(
    (name) => name !== '__tests__' && statSync(path.join(CRON_DIR, name)).isDirectory(),
  );
}

describe('proxy — cobertura de los crons', () => {
  it('hay crons programados y carpetas de cron que revisar (la prueba no es vacía)', () => {
    assert.ok(vercelCronPaths().length > 0);
    assert.ok(cronRouteDirs().length > 0);
  });

  it('todo cron de vercel.json queda fuera del proxy (Vercel Cron no trae sesión)', () => {
    for (const cronPath of vercelCronPaths()) {
      assert.equal(proxyRunsFor(cronPath), false, `${cronPath} recibiría 307 → /login`);
    }
  });

  it('toda carpeta de src/app/api/cron/ queda fuera del proxy', () => {
    for (const name of cronRouteDirs()) {
      assert.equal(proxyRunsFor(`/api/cron/${name}`), false, `/api/cron/${name} recibiría 307 → /login`);
    }
  });

  it('las exclusiones nuevas son exactas: no abren vecinos por prefijo', () => {
    assert.equal(proxyRunsFor('/api/cron/apollo-round-continuation-otro'), true);
    assert.equal(proxyRunsFor('/api/cron/post-approval-nit-enrich-otro'), true);
    assert.equal(proxyRunsFor('/api/cron/otro-job'), true);
  });

  it('cada ruta de cron se autoriza con CRON_SECRET (fail-closed)', () => {
    for (const name of cronRouteDirs()) {
      const code = stripComments(readFileSync(path.join(CRON_DIR, name, 'route.ts'), 'utf8'));
      // `process.env.CRON_SECRET` directo, o por la constante del módulo de
      // recuperación (`RECOVERY_CRON_SECRET_ENV = 'CRON_SECRET'`).
      assert.match(
        code,
        /process\.env\.CRON_SECRET|process\.env\[RECOVERY_CRON_SECRET_ENV\]/,
        `${name} debe leer CRON_SECRET`,
      );
      assert.match(code, /status:\s*401/, `${name} debe responder 401 sin secreto válido`);
    }
  });

  it('los crons largos declaran maxDuration 300', () => {
    for (const name of ['apollo-round-continuation', 'post-approval-nit-enrich']) {
      const code = stripComments(readFileSync(path.join(CRON_DIR, name, 'route.ts'), 'utf8'));
      assert.match(code, /export const maxDuration = 300;/, name);
    }
  });
});

describe('bandera del cron de continuaciones de Apollo', () => {
  it('apagada por defecto; sólo el token exacto `true` la enciende', () => {
    assert.equal(isAgent1ApolloCronContinuationEnabled({}), false);
    for (const value of ['', '1', 'yes', 'on', 'false', 'TRUE!']) {
      assert.equal(isAgent1ApolloCronContinuationEnabled({ [AGENT1_APOLLO_CRON_CONTINUATION_FLAG]: value }), false, value);
    }
    assert.equal(isAgent1ApolloCronContinuationEnabled({ [AGENT1_APOLLO_CRON_CONTINUATION_FLAG]: 'true' }), true);
    assert.equal(isAgent1ApolloCronContinuationEnabled({ [AGENT1_APOLLO_CRON_CONTINUATION_FLAG]: ' TRUE ' }), true);
  });

  describe('la ruta, con secreto válido y bandera apagada', () => {
    const saved: Record<string, string | undefined> = {};
    const KEYS = ['CRON_SECRET', AGENT1_APOLLO_CRON_CONTINUATION_FLAG, 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    beforeEach(() => {
      for (const key of KEYS) saved[key] = process.env[key];
      process.env.CRON_SECRET = 'secreto-de-prueba';
      delete process.env[AGENT1_APOLLO_CRON_CONTINUATION_FLAG];
      // Sin credenciales: si la ruta tocara la base, fallaría con 500.
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    });
    afterEach(() => {
      for (const key of KEYS) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });

    it('responde 200 `skipped: flag_off` sin tocar la base', async () => {
      const mod = (await import('../app/api/cron/apollo-round-continuation/route')) as unknown as {
        GET: (r: Request) => Promise<Response>;
      };
      const res = await mod.GET(
        new Request('https://app.test/api/cron/apollo-round-continuation', {
          headers: { Authorization: 'Bearer secreto-de-prueba' },
        }) as never,
      );
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { success: true, skipped: 'flag_off' });
    });
  });
});

describe('selección de UN trabajo por invocación', () => {
  function fakeClient(rows: unknown[], calls: Record<string, unknown>): ContinuationPickClient {
    return {
      from: (table) => {
        calls.table = table;
        return {
          select: (columns) => {
            calls.columns = columns;
            return {
              or: (filter) => {
                calls.filter = filter;
                return {
                  order: (column, options) => {
                    calls.order = [column, options.ascending];
                    return {
                      limit: (count) => {
                        calls.limit = count;
                        return Promise.resolve({ data: rows, error: null });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
  }

  it('pide UN lote, con la elegibilidad y el orden del reclamo (migración 139)', async () => {
    const calls: Record<string, unknown> = {};
    const now = '2026-10-16T13:15:00.000Z';
    const batchId = await pickNextClaimableContinuationBatchId(fakeClient([{ batch_id: 'b-1' }], calls), now);
    assert.equal(batchId, 'b-1');
    assert.equal(calls.table, 'apollo_round_continuation_jobs');
    assert.equal(calls.limit, 1);
    assert.deepEqual(calls.order, ['created_at', true]);
    assert.equal(
      calls.filter,
      `and(status.eq.pending,next_retry_at.lte.${now}),and(status.eq.processing,lease_expires_at.lt.${now})`,
    );
  });

  it('sin trabajo devuelve null', async () => {
    assert.equal(await pickNextClaimableContinuationBatchId(fakeClient([], {})), null);
  });

  it('la ruta pasa ese lote al conductor con limit 1 y barre en `finally`', () => {
    const code = stripComments(readFileSync(path.join(CRON_DIR, 'apollo-round-continuation', 'route.ts'), 'utf8'));
    assert.match(code, /runApolloRoundContinuationWorkerFromEnv\(\{ batchId, limit: 1, client \}\)/);
    assert.match(code, /finally \{[\s\S]*closeStuckAgentRuns\(client\)/);
    assert.doesNotMatch(code, /runApolloRoundContinuationWorkerFromEnv\(\)/, 'sin lote, el conductor tomaba 3');
  });
});
