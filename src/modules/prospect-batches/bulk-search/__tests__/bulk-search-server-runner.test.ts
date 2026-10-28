/**
 * La búsqueda masiva corre sola en el servidor (dueña 28-10).
 *
 * Puro: cuándo se encadena la ronda siguiente, qué acepta la ruta interna y a
 * nombre de quién se puede conducir. Estático: el cableado de seguridad (secreto,
 * bandera, identidad, cierre de la sesión). Sin red, sin base de datos, sin créditos.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  SERVER_CHAIN_MAX_CONSECUTIVE_WAITS,
  SERVER_CHAIN_MAX_DELAY_MS,
  SERVER_CHAIN_MIN_DELAY_MS,
  canRunOnBehalfOf,
  decideServerChain,
  parseServerChainRequest,
  resolveOwnOrigin,
} from '../bulk-search-server-chain';
import type { BulkRoundResponse } from '../bulk-search-engine';
import { createMemoryCookieJar, currentSessionCookieJar, runWithSessionCookies } from '@/lib/supabase/session-override';

const ID = '7d0f4e2a-1b2c-4d3e-8f90-123456789abc';
const search = {} as never;
const round = (next: 'continue' | 'wait' | 'done', retryAfterMs = 0): BulkRoundResponse => ({
  ok: true,
  next,
  retryAfterMs,
  search,
});

describe('decideServerChain', () => {
  it('con trabajo, pide la siguiente ronda ya y reinicia las esperas', () => {
    assert.deepEqual(decideServerChain(round('continue'), 7), { kind: 'chain', delayMs: 0, consecutiveWaits: 0 });
  });

  it('terminada o inexistente, se detiene', () => {
    assert.deepEqual(decideServerChain(round('done'), 0), { kind: 'stop', reason: 'done' });
    assert.deepEqual(decideServerChain({ ok: false, code: 'NOT_FOUND' }, 0), { kind: 'stop', reason: 'not_found' });
  });

  it('una espera se respeta, entre 1 y 30 segundos', () => {
    assert.deepEqual(decideServerChain(round('wait', 15_000), 0), { kind: 'chain', delayMs: 15_000, consecutiveWaits: 1 });
    assert.equal((decideServerChain(round('wait', 10), 0) as { delayMs: number }).delayMs, SERVER_CHAIN_MIN_DELAY_MS);
    assert.equal((decideServerChain(round('wait', 600_000), 0) as { delayMs: number }).delayMs, SERVER_CHAIN_MAX_DELAY_MS);
    assert.equal((decideServerChain(round('wait', Number.NaN), 0) as { delayMs: number }).delayMs, SERVER_CHAIN_MIN_DELAY_MS);
  });

  it('demasiadas esperas seguidas sueltan la búsqueda al navegador', () => {
    assert.equal(decideServerChain(round('wait', 30_000), SERVER_CHAIN_MAX_CONSECUTIVE_WAITS - 1).kind, 'chain');
    assert.deepEqual(decideServerChain(round('wait', 30_000), SERVER_CHAIN_MAX_CONSECUTIVE_WAITS), {
      kind: 'stop',
      reason: 'too_many_waits',
    });
  });
});

describe('parseServerChainRequest', () => {
  it('acepta sólo un id válido, un contador y una espera dentro de rango', () => {
    assert.deepEqual(parseServerChainRequest({ bulkSearchId: ID }), { bulkSearchId: ID, consecutiveWaits: 0, delayMs: 0 });
    assert.deepEqual(parseServerChainRequest({ bulkSearchId: ID, consecutiveWaits: 3, delayMs: 15_000 }), {
      bulkSearchId: ID,
      consecutiveWaits: 3,
      delayMs: 15_000,
    });
  });

  it('rechaza todo lo demás', () => {
    for (const body of [
      null,
      'x',
      {},
      { bulkSearchId: 'no-es-uuid' },
      { bulkSearchId: ID, consecutiveWaits: -1 },
      { bulkSearchId: ID, consecutiveWaits: SERVER_CHAIN_MAX_CONSECUTIVE_WAITS + 1 },
      { bulkSearchId: ID, consecutiveWaits: 1.5 },
      { bulkSearchId: ID, delayMs: SERVER_CHAIN_MAX_DELAY_MS + 1 },
      { bulkSearchId: ID, delayMs: '1000' },
    ]) {
      assert.equal(parseServerChainRequest(body), null, JSON.stringify(body));
    }
  });
});

describe('canRunOnBehalfOf', () => {
  it('sólo una persona activa, de Growth o admin', () => {
    assert.equal(canRunOnBehalfOf({ accessStatus: 'active', roleKey: 'growth', isAdmin: false }), true);
    assert.equal(canRunOnBehalfOf({ accessStatus: 'active', roleKey: 'admin', isAdmin: true }), true);
    assert.equal(canRunOnBehalfOf({ accessStatus: 'active', roleKey: 'seller_bd', isAdmin: false }), false);
    assert.equal(canRunOnBehalfOf({ accessStatus: 'active', roleKey: 'commercial_lead', isAdmin: false }), false);
    assert.equal(canRunOnBehalfOf({ accessStatus: 'suspended', roleKey: 'growth', isAdmin: false }), false);
    assert.equal(canRunOnBehalfOf({ accessStatus: null, roleKey: null, isAdmin: true }), false);
  });
});

describe('resolveOwnOrigin', () => {
  it('sólo la dirección configurada, en https (o localhost), sin ruta', () => {
    assert.equal(resolveOwnOrigin('https://sellup.ubits.co/algo'), 'https://sellup.ubits.co');
    assert.equal(resolveOwnOrigin('http://localhost:3000'), 'http://localhost:3000');
    assert.equal(resolveOwnOrigin('http://sellup.ubits.co'), null);
    assert.equal(resolveOwnOrigin(''), null);
    assert.equal(resolveOwnOrigin(undefined), null);
    assert.equal(resolveOwnOrigin('no es una url'), null);
  });
});

describe('sesión prestada', () => {
  it('sólo existe dentro del bloque y guarda lo que escribe Supabase', async () => {
    assert.equal(currentSessionCookieJar(), null);
    const jar = createMemoryCookieJar();
    await runWithSessionCookies(jar, async () => {
      await Promise.resolve();
      assert.equal(currentSessionCookieJar(), jar);
      jar.setAll([{ name: 'sb-token', value: 'abc' }]);
    });
    assert.equal(currentSessionCookieJar(), null);
    assert.deepEqual(jar.getAll(), [{ name: 'sb-token', value: 'abc' }]);
    jar.setAll([{ name: 'sb-token', value: '' }]);
    assert.deepEqual(jar.getAll(), []);
  });
});

const read = (file: string) => readFileSync(path.join(process.cwd(), file), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('cableado', () => {
  it('createClient usa la sesión prestada antes que las cookies de la petición', () => {
    const src = strip(read('src/lib/supabase/server.ts'));
    assert.ok(src.indexOf('currentSessionCookieJar()') < src.indexOf('await cookies()'));
  });

  it('la ruta interna exige CRON_SECRET y la bandera antes de leer nada', () => {
    const src = strip(read('src/app/api/cron/bulk-search-rounds/route.ts'));
    const auth = src.indexOf('authorizeRecoveryCronRequest(');
    const flag = src.indexOf('isBulkSearchServerRunnerEnabled()');
    const body = src.indexOf('request.json()');
    assert.ok(auth > 0 && auth < flag && flag < body);
    assert.match(src, /status: 401/);
  });

  it('el conductor comprueba la persona, usa la misma puerta que el navegador y cierra sólo su sesión', () => {
    const src = strip(read('src/modules/prospect-batches/bulk-search/bulk-search-server-runner.server.ts'));
    assert.match(src, /row\.status !== 'running'/);
    assert.match(src, /canRunOnBehalfOf\(/);
    assert.match(src, /verified\.user\?\.id !== authUserId/);
    assert.match(src, /resolveBulkSearchAccess\(\)/);
    assert.match(src, /access\.userId !== owner\.internalUserId/);
    assert.match(src, /signOut\(\{ scope: 'local' \}\)/);
  });

  it('el secreto nunca viaja a una dirección sacada del pedido, ni sigue redirecciones', () => {
    const kick = strip(read('src/modules/prospect-batches/bulk-search/bulk-search-server-kick.server.ts'));
    assert.match(kick, /resolveOwnOrigin\(\)/);
    assert.match(kick, /redirect: 'error'/);
    for (const file of ['src/app/api/cron/bulk-search-rounds/route.ts', 'src/app/api/prospect-batches/bulk-searches/route.ts']) {
      assert.equal(/request\.url/.test(strip(read(file))), false, file);
    }
  });

  it('la bandera nueva está apagada salvo el token exacto y exige la de la búsqueda masiva', () => {
    const src = strip(read('src/modules/prospect-batches/bulk-search/bulk-search-flag.server.ts'));
    assert.match(src, /isGrowthBulkSearchEnabled\(\) && isEnvFlagEnabled\(process\.env\[GROWTH_BULK_SEARCH_SERVER_RUNNER_FLAG\]\)/);
  });
});
