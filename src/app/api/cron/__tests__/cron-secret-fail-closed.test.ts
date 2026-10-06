/**
 * Tests — AGENT1-IMPORT-PARITY-7: las tareas programadas `enrich`,
 * `post-approval-nit-enrich` y `apollo-round-continuation` ya no aceptan el
 * secreto público `local_cron_secret` cuando falta `CRON_SECRET`.
 *
 * Sólo se ejercita el camino RECHAZADO: el worker nunca llega a correr, así que
 * no hay base de datos, red, IA ni créditos.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// SOURCES-EC-CLOSE-2 — la vuelta del rescate con Claude usa la misma autorización.
const ROUTES = ['enrich', 'post-approval-nit-enrich', 'apollo-round-continuation', 'claude-rescue-continuation'] as const;
const LEGACY_PUBLIC_SECRET = 'local_cron_secret';

function routeFile(name: string): string {
  return path.join(process.cwd(), 'src/app/api/cron', name, 'route.ts');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function call(name: string, authorization: string | null): Promise<number> {
  const mod = (await import(`../${name}/route`)) as { GET?: (r: Request) => Promise<Response>; POST?: (r: Request) => Promise<Response> };
  const handler = mod.GET ?? mod.POST;
  assert.ok(handler, `${name} debe exportar GET o POST`);
  const headers = new Headers();
  if (authorization !== null) headers.set('Authorization', authorization);
  const res = await handler(new Request(`https://app.test/api/cron/${name}`, { headers }) as never);
  return res.status;
}

describe('cron — secreto fail-closed', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  for (const name of ROUTES) {
    it(`${name}: sin CRON_SECRET, el secreto público viejo NO entra (401)`, async () => {
      assert.equal(await call(name, `Bearer ${LEGACY_PUBLIC_SECRET}`), 401);
    });

    it(`${name}: sin CRON_SECRET, tampoco entra sin cabecera ni con «Bearer » vacío`, async () => {
      assert.equal(await call(name, null), 401);
      assert.equal(await call(name, 'Bearer '), 401);
    });

    it(`${name}: con CRON_SECRET configurado, un secreto distinto sigue en 401`, async () => {
      process.env.CRON_SECRET = 'secreto-real-de-prueba';
      assert.equal(await call(name, 'Bearer otro-secreto'), 401);
    });

    it(`${name}: el código ya no contiene el secreto público`, () => {
      assert.equal(stripComments(readFileSync(routeFile(name), 'utf8')).includes(LEGACY_PUBLIC_SECRET), false);
    });
  }
});
