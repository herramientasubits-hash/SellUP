// Lector paginado de Supabase: la API REST devuelve como máximo 1.000 filas por
// petición, así que cualquier suma hecha sobre UNA sola petición se queda corta
// en silencio en cuanto la tabla crece (provider_usage_logs ya pasa de 4.700).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkValues,
  fetchAllPages,
  fetchAllPagesInChunks,
  READ_PAGE_SIZE,
  type PageFetcher,
} from '../supabase/paginated-read';

/** Simula una tabla de `total` filas servida en páginas, como PostgREST con .range(). */
function fakeTable(total: number, serverMax = READ_PAGE_SIZE) {
  const calls: Array<[number, number]> = [];
  const fetcher: PageFetcher<{ n: number }> = async (from, to) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, total, from + serverMax);
    const data = [];
    for (let i = from; i < end; i++) data.push({ n: i });
    return { data, error: null };
  };
  return { fetcher, calls };
}

describe('fetchAllPages', () => {
  it('lee 4.756 filas completas en páginas de 1.000 (no se queda en las primeras 1.000)', async () => {
    const { fetcher, calls } = fakeTable(4756);
    const result = await fetchAllPages(fetcher);
    assert.equal(result.rows.length, 4756);
    assert.equal(result.truncated, false);
    assert.equal(result.error, null);
    assert.deepEqual(calls[0], [0, 999]);
    assert.deepEqual(calls[1], [1000, 1999]);
    assert.equal(calls.length, 5);
  });

  it('una tabla vacía devuelve 0 filas sin error ni truncado', async () => {
    const { fetcher } = fakeTable(0);
    const result = await fetchAllPages(fetcher);
    assert.deepEqual(result, { rows: [], truncated: false, error: null });
  });

  it('un múltiplo exacto de la página no marca truncado', async () => {
    const { fetcher } = fakeTable(2000);
    const result = await fetchAllPages(fetcher);
    assert.equal(result.rows.length, 2000);
    assert.equal(result.truncated, false);
  });

  it('al llegar al tope de seguridad AVISA con truncated en vez de cortar en silencio', async () => {
    const { fetcher } = fakeTable(5000);
    const result = await fetchAllPages(fetcher, { maxRows: 3000 });
    assert.equal(result.rows.length, 3000);
    assert.equal(result.truncated, true);
  });

  it('justo en el tope sin más filas detrás no marca truncado', async () => {
    const { fetcher } = fakeTable(3000);
    const result = await fetchAllPages(fetcher, { maxRows: 3000 });
    assert.equal(result.rows.length, 3000);
    assert.equal(result.truncated, false);
  });

  it('un error de lectura se devuelve como error, nunca como lista vacía válida', async () => {
    let call = 0;
    const fetcher: PageFetcher<{ n: number }> = async () => {
      call++;
      if (call === 2) return { data: null, error: { message: 'boom' } };
      return { data: Array.from({ length: READ_PAGE_SIZE }, (_, n) => ({ n })), error: null };
    };
    const result = await fetchAllPages(fetcher);
    assert.equal(result.error, 'boom');
  });

  it('una excepción del cliente también se devuelve como error', async () => {
    const fetcher: PageFetcher<{ n: number }> = async () => {
      throw new Error('red caída');
    };
    const result = await fetchAllPages(fetcher);
    assert.equal(result.error, 'red caída');
    assert.deepEqual(result.rows, []);
  });

  it('keep + stopAfterKept: deja de leer cuando ya tiene las filas pedidas', async () => {
    const { fetcher, calls } = fakeTable(5000);
    const result = await fetchAllPages(fetcher, {
      keep: (row) => row.n % 2 === 0,
      stopAfterKept: 10,
    });
    assert.equal(result.rows.length, 10);
    assert.deepEqual(result.rows.map((r) => r.n), [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    assert.equal(result.truncated, false);
    assert.equal(calls.length, 1);
  });

  it('keep sigue paginando cuando las filas que valen están más atrás', async () => {
    const { fetcher } = fakeTable(2500);
    const result = await fetchAllPages(fetcher, { keep: (row) => row.n >= 2400 });
    assert.equal(result.rows.length, 100);
  });
});

describe('chunkValues / fetchAllPagesInChunks', () => {
  it('parte una lista larga en trozos del tamaño pedido', () => {
    assert.deepEqual(chunkValues([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunkValues([], 2), []);
  });

  it('pagina dentro de cada trozo y junta todo', async () => {
    const seen: string[][] = [];
    const result = await fetchAllPagesInChunks(
      ['a', 'b', 'c'],
      2,
      (chunk) => async (from, to) => {
        seen.push(chunk);
        if (from > 0) return { data: [], error: null };
        return { data: chunk.map((id) => ({ id, to })), error: null };
      },
    );
    assert.equal(result.rows.length, 3);
    assert.deepEqual(seen.map((c) => c.join('')), ['ab', 'c']);
    assert.equal(result.truncated, false);
    assert.equal(result.error, null);
  });

  it('propaga el error de cualquier trozo', async () => {
    const result = await fetchAllPagesInChunks(['a', 'b'], 1, (chunk) => async () =>
      chunk[0] === 'b'
        ? { data: null, error: { message: 'falló b' } }
        : { data: [{ id: 'a' }], error: null },
    );
    assert.equal(result.error, 'falló b');
  });

  it('marca truncado si se supera el tope total entre trozos', async () => {
    const result = await fetchAllPagesInChunks(
      ['a', 'b'],
      1,
      () => async (from) =>
        from === 0 ? { data: [{ id: 1 }, { id: 2 }], error: null } : { data: [], error: null },
      { maxRows: 3, pageSize: 2 },
    );
    assert.equal(result.truncated, true);
    assert.equal(result.rows.length, 3);
  });
});
