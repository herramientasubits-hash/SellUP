/**
 * SOURCES-CO-RUES-LIVE-NIT-1 — consulta en vivo al registro de las cámaras de
 * comercio (datos.gov.co c82u-588k). Fetch doble: nunca sale a la red.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRuesNameLiveQuery,
  buildRuesPrefixUrl,
  CO_RUES_MAX_CONSECUTIVE_FAILURES,
  CO_RUES_MAX_LOOKUPS_PER_RUN,
  CO_RUES_REQUEST_TIMEOUT_MS,
  CO_RUES_ROW_LIMIT,
  toRuesNameRow,
} from '../rues-name-live-query';

type Reply = { ok: boolean; json: () => Promise<unknown> };
const ok = (body: unknown): Reply => ({ ok: true, json: async () => body });

function counting(reply: () => Promise<Reply>) {
  const urls: string[] = [];
  return {
    urls,
    fetchImpl: async (url: string) => {
      urls.push(url);
      return reply();
    },
  };
}

describe('buildRuesPrefixUrl', () => {
  it('prefijo de la razón social, sólo sociedades con NIT no canceladas, tope de filas', () => {
    const url = new URL(buildRuesPrefixUrl('CLINICA COLSANITAS'));
    assert.equal(url.origin + url.pathname, 'https://www.datos.gov.co/resource/c82u-588k.json');
    assert.equal(
      url.searchParams.get('$where'),
      "starts_with(razon_social,'CLINICA COLSANITAS') AND clase_identificacion='NIT' AND estado_matricula!='CANCELADA'",
    );
    assert.equal(url.searchParams.get('$limit'), String(CO_RUES_ROW_LIMIT));
    assert.equal(url.searchParams.get('$select'), 'razon_social,numero_identificacion,estado_matricula');
  });

  it('una comilla nunca rompe la consulta', () => {
    const where = new URL(buildRuesPrefixUrl("O'NEIL")).searchParams.get('$where') ?? '';
    assert.match(where, /starts_with\(razon_social,'O''NEIL'\)/);
  });
});

describe('toRuesNameRow', () => {
  it('recalcula el núcleo y deja el NIT sólo en dígitos', () => {
    assert.deepEqual(
      toRuesNameRow({ razon_social: 'KONECTA GROUP S.A.S', numero_identificacion: '901.415.070' }),
      { taxId: '901415070', legalName: 'KONECTA GROUP S.A.S', normalizedLegalName: 'KONECTA GROUP' },
    );
    assert.deepEqual(toRuesNameRow({}), { taxId: null, legalName: null, normalizedLegalName: null });
  });
});

describe('buildRuesNameLiveQuery', () => {
  it('devuelve las filas del registro', async () => {
    const f = counting(async () => ok([{ razon_social: 'ALPINA PRODUCTOS ALIMENTICIOS S.A.', numero_identificacion: '860025900' }]));
    const rows = await buildRuesNameLiveQuery({ fetchImpl: f.fetchImpl })('ALPINA PRODUCTOS ALIMENTICIOS');
    assert.deepEqual(rows, [
      { taxId: '860025900', legalName: 'ALPINA PRODUCTOS ALIMENTICIOS S.A.', normalizedLegalName: 'ALPINA PRODUCTOS ALIMENTICIOS' },
    ]);
    assert.equal(f.urls.length, 1);
  });

  it('sin núcleo no consulta', async () => {
    const f = counting(async () => ok([]));
    assert.deepEqual(await buildRuesNameLiveQuery({ fetchImpl: f.fetchImpl })('  '), []);
    assert.equal(f.urls.length, 0);
  });

  it('HTTP con error, respuesta que no es lista o excepción → vacío', async () => {
    assert.deepEqual(await buildRuesNameLiveQuery({ fetchImpl: async () => ({ ok: false, json: async () => [] }) })('A B'), []);
    assert.deepEqual(await buildRuesNameLiveQuery({ fetchImpl: async () => ok({ error: true }) })('A B'), []);
    assert.deepEqual(
      await buildRuesNameLiveQuery({
        fetchImpl: async () => {
          throw new Error('red caída');
        },
      })('A B'),
      [],
    );
  });

  it(`tras ${CO_RUES_MAX_CONSECUTIVE_FAILURES} fallos seguidos la fuente se apaga el resto de la corrida`, async () => {
    const f = counting(async () => {
      throw new Error('caída');
    });
    const query = buildRuesNameLiveQuery({ fetchImpl: f.fetchImpl });
    for (let i = 0; i < CO_RUES_MAX_CONSECUTIVE_FAILURES + 3; i++) await query('A B');
    assert.equal(f.urls.length, CO_RUES_MAX_CONSECUTIVE_FAILURES);
  });

  it('un acierto reinicia la cuenta de fallos', async () => {
    let n = 0;
    const f = counting(async () => {
      n += 1;
      if (n % CO_RUES_MAX_CONSECUTIVE_FAILURES === 0) return ok([]);
      throw new Error('intermitente');
    });
    const query = buildRuesNameLiveQuery({ fetchImpl: f.fetchImpl });
    for (let i = 0; i < 9; i++) await query('A B');
    assert.equal(f.urls.length, 9);
  });

  it(`como mucho ${CO_RUES_MAX_LOOKUPS_PER_RUN} consultas por corrida`, async () => {
    const f = counting(async () => ok([]));
    const query = buildRuesNameLiveQuery({ fetchImpl: f.fetchImpl });
    for (let i = 0; i < CO_RUES_MAX_LOOKUPS_PER_RUN + 5; i++) await query('A B');
    assert.equal(f.urls.length, CO_RUES_MAX_LOOKUPS_PER_RUN);
  });

  it(`una consulta lenta se corta a los ${CO_RUES_REQUEST_TIMEOUT_MS} ms y cuenta como fallo`, async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const fetchImpl = (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Reply>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('abortada')));
        });
      const query = buildRuesNameLiveQuery({ fetchImpl });
      const pending = query('A B');
      mock.timers.tick(CO_RUES_REQUEST_TIMEOUT_MS - 1);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      assert.equal(settled, false);
      mock.timers.tick(1);
      assert.deepEqual(await pending, []);
    } finally {
      mock.timers.reset();
    }
  });
});
