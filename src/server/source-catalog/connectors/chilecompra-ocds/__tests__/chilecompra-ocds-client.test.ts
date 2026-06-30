/**
 * Tests — ChileCompra OCDS Client
 *
 * URL builders + extracción defensiva + manejo de errores HTTP/JSON.
 * El fetch global se stubea; no hay llamadas reales. Sin Supabase, sin writes.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildListadoUrl,
  buildTenderUrl,
  extractTenderIdFromOcid,
  fetchOcdsListado,
  fetchOcdsTender,
  extractTotal,
  extractListItems,
  extractRelease,
  OCDS_SERVER_MAX_LIMIT,
} from '../chilecompra-ocds-client';

const _origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = _origFetch;
});

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('URL builders', () => {
  it('construye URL de listado con year/month/offset/limit', () => {
    const url = buildListadoUrl(2026, 6, 0, 5);
    assert.equal(url, 'https://api.mercadopublico.cl/APISOCDS/OCDS/listaOCDSAgnoMes/2026/6/0/5');
  });

  it('construye URL de detalle con tender id (builder de bajo nivel, sin stripping)', () => {
    const url = buildTenderUrl('3955-1-LE25');
    assert.equal(url, 'https://api.mercadopublico.cl/APISOCDS/OCDS/tender/3955-1-LE25');
  });

  it('respeta limit máximo server-side (1000)', () => {
    const url = buildListadoUrl(2026, 6, 0, 999999);
    assert.ok(url.endsWith(`/0/${OCDS_SERVER_MAX_LIMIT}`));
  });

  it('clampa offset/limit negativos a valores seguros', () => {
    const url = buildListadoUrl(2026, 6, -10, 0);
    assert.ok(url.endsWith('/0/1'));
  });
});

describe('extractTenderIdFromOcid', () => {
  it('remueve el prefijo OCDS y conserva el tender id', () => {
    assert.equal(extractTenderIdFromOcid('ocds-70d2nz-4280-18-LP26'), '4280-18-LP26');
  });

  it('devuelve el tender id tal cual cuando no trae prefijo OCDS', () => {
    assert.equal(extractTenderIdFromOcid('4280-18-LP26'), '4280-18-LP26');
  });

  it('conserva guiones internos del identificador final', () => {
    assert.equal(extractTenderIdFromOcid('ocds-70d2nz-705290-49-LR26'), '705290-49-LR26');
  });

  it('mantiene string (no convierte a número)', () => {
    const out = extractTenderIdFromOcid('ocds-70d2nz-621-513-LR26');
    assert.equal(typeof out, 'string');
    assert.equal(out, '621-513-LR26');
  });

  it('trimea espacios alrededor', () => {
    assert.equal(extractTenderIdFromOcid('  ocds-70d2nz-4280-18-LP26  '), '4280-18-LP26');
  });
});

describe('extractTotal / extractListItems', () => {
  it('lee pagination.total', () => {
    assert.equal(extractTotal({ pagination: { total: 1234 } }), 1234);
  });

  it('total ausente → null', () => {
    assert.equal(extractTotal({ pagination: {} }), null);
  });

  it('extrae items con ocid + urlTender desde data[]', () => {
    const items = extractListItems({
      data: [
        { ocid: 'ocds-a', urlTender: 'https://x/a' },
        { ocid: 'ocds-b' },
        { noOcid: true },
      ],
    });
    assert.deepEqual(items, [
      { ocid: 'ocds-a', urlTender: 'https://x/a' },
      { ocid: 'ocds-b', urlTender: null },
    ]);
  });

  it('sin array reconocible → null', () => {
    assert.equal(extractListItems({ pagination: { total: 5 } }), null);
  });
});

describe('extractRelease', () => {
  it('extrae desde releases[0]', () => {
    const r = extractRelease({ releases: [{ ocid: 'x' }] });
    assert.equal(r?.ocid, 'x');
  });

  it('extrae desde records[0].compiledRelease', () => {
    const r = extractRelease({ records: [{ compiledRelease: { ocid: 'y' } }] });
    assert.equal(r?.ocid, 'y');
  });

  it('extrae objeto plano con tender', () => {
    const r = extractRelease({ ocid: 'z', tender: { id: '1' } });
    assert.equal(r?.ocid, 'z');
  });

  it('null si no hay release reconocible', () => {
    assert.equal(extractRelease({ foo: 'bar' }), null);
    assert.equal(extractRelease('string'), null);
  });
});

describe('fetchOcdsListado', () => {
  it('parsea respuesta válida (total + items)', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ pagination: { total: 42 }, data: [{ ocid: 'ocds-1', urlTender: 'u1' }] })) as typeof fetch;
    const result = await fetchOcdsListado({ year: 2026, month: 6, limit: 5 });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.total, 42);
      assert.deepEqual(result.items, [{ ocid: 'ocds-1', urlTender: 'u1' }]);
    }
  });

  it('maneja HTTP error', async () => {
    globalThis.fetch = (async () => jsonResponse({}, 500)) as typeof fetch;
    const result = await fetchOcdsListado({ year: 2026, month: 6 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorKind, 'http');
  });

  it('maneja JSON inválido', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>error</html>', { status: 200 })) as typeof fetch;
    const result = await fetchOcdsListado({ year: 2026, month: 6 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorKind, 'invalid_json');
  });

  it('maneja timeout/abort', async () => {
    globalThis.fetch = (async () => {
      throw new Error('The operation was aborted (timeout)');
    }) as typeof fetch;
    const result = await fetchOcdsListado({ year: 2026, month: 6 });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.errorKind, 'timeout');
  });
});

describe('fetchOcdsTender', () => {
  it('devuelve release en respuesta válida', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ releases: [{ ocid: 'ocds-1', tender: { id: '1' } }] })) as typeof fetch;
    const result = await fetchOcdsTender('ocds-1');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.release.ocid, 'ocds-1');
  });

  it('construye la URL de detalle con el tender id extraído, no con el OCID completo', async () => {
    let requestedUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return jsonResponse({ releases: [{ ocid: 'ocds-70d2nz-4280-18-LP26', tender: { id: '4280-18-LP26' } }] });
    }) as typeof fetch;
    const result = await fetchOcdsTender('ocds-70d2nz-4280-18-LP26');
    assert.equal(result.ok, true);
    assert.ok(
      requestedUrl.endsWith('/tender/4280-18-LP26'),
      `URL esperada con tender id; recibida: ${requestedUrl}`,
    );
    assert.ok(!requestedUrl.includes('ocds-70d2nz'), 'la URL no debe contener el OCID completo');
  });

  it('maneja HTTP error en detalle', async () => {
    globalThis.fetch = (async () => jsonResponse({}, 404)) as typeof fetch;
    const result = await fetchOcdsTender('ocds-1');
    assert.equal(result.ok, false);
  });
});
