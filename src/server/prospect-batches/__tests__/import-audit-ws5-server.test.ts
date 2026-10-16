/**
 * Tests — AGENT1-AUDIT-WS5 (importación, servidor): inserción en bloque y aviso
 * previo de duplicados con consultas dirigidas. Clientes Supabase FALSOS
 * inyectados; cero red.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { insertImportCandidateRows } from '../import-candidate-bulk-insert';
import { precheckImportDuplicates, taxIdentifierVariants } from '../import-duplicate-precheck';

type Row = Record<string, unknown>;

// ── Inserción en bloque ──────────────────────────────────────────────────────

function insertClient(behaviour: { rejectChunksWith?: (rows: Row[]) => boolean; rejectRow?: (row: Row) => boolean; throwOnChunk?: boolean }) {
  const calls: Array<{ kind: 'chunk' | 'one'; size: number }> = [];
  let seq = 0;
  const client = {
    from(table: string) {
      assert.equal(table, 'prospect_candidates');
      return {
        insert(payload: Row | Row[]) {
          const isChunk = Array.isArray(payload);
          const rows = isChunk ? payload : [payload];
          calls.push({ kind: isChunk ? 'chunk' : 'one', size: rows.length });
          const respond = () => {
            if (isChunk && behaviour.throwOnChunk) throw new Error('socket hang up');
            if (isChunk && behaviour.rejectChunksWith?.(rows)) return { data: null, error: { message: 'violates check' } };
            if (!isChunk && behaviour.rejectRow?.(rows[0])) return { data: null, error: { message: 'violates check' } };
            // RETURNING en orden inverso: la asociación no depende del orden.
            const created = rows.map((r) => ({ id: `id-${++seq}`, status: r.status, metadata: r.metadata })).reverse();
            return { data: isChunk ? created : created[0], error: null };
          };
          return {
            select: () => ({
              single: async () => respond(),
              then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
                try {
                  return Promise.resolve(respond()).then(ok, ko);
                } catch (err) {
                  return Promise.reject(err).then(ok, ko);
                }
              },
            }),
          };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const rowsOf = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ rowNumber: i + 1, insertData: { name: `E${i + 1}`, status: 'needs_review', metadata: { a: 1 } } }));

describe('insertImportCandidateRows', () => {
  it('inserta por bloques y asocia cada id a su fila por import_row_number', async () => {
    const { client, calls } = insertClient({});
    const outcome = await insertImportCandidateRows(client, rowsOf(5), 2);
    assert.deepEqual(calls.map((c) => c.kind), ['chunk', 'chunk', 'chunk']);
    assert.deepEqual(outcome.inserted.map((r) => r.rowNumber), [1, 2, 3, 4, 5]);
    assert.equal(new Set(outcome.inserted.map((r) => r.id)).size, 5);
    assert.deepEqual(outcome.failedRowNumbers, []);
  });

  it('un bloque rechazado se reintenta fila por fila: una fila mala no tumba a sus vecinas', async () => {
    const { client, calls } = insertClient({
      rejectChunksWith: (rows) => rows.some((r) => r.name === 'E2'),
      rejectRow: (r) => r.name === 'E2',
    });
    const outcome = await insertImportCandidateRows(client, rowsOf(3), 10);
    assert.deepEqual(calls.map((c) => c.kind), ['chunk', 'one', 'one', 'one']);
    assert.deepEqual(outcome.inserted.map((r) => r.rowNumber), [1, 3]);
    assert.deepEqual(outcome.failedRowNumbers, [2]);
  });

  it('un bloque con resultado incierto NO se reintenta (duplicaría filas)', async () => {
    const { client, calls } = insertClient({ throwOnChunk: true });
    const outcome = await insertImportCandidateRows(client, rowsOf(2), 10);
    assert.deepEqual(calls.map((c) => c.kind), ['chunk']);
    assert.deepEqual(outcome.failedRowNumbers, [1, 2]);
  });
});

// ── Aviso previo de duplicados ───────────────────────────────────────────────

function precheckClient(tables: Record<string, Row[]>, options: { failOn?: string } = {}) {
  const queries: Array<{ table: string; column: string; values: string[]; filters: string[] }> = [];
  const client = {
    from(table: string) {
      const q = { table, column: '', values: [] as string[], filters: [] as string[] };
      const chain: Record<string, unknown> = {
        select: () => chain,
        in: (column: string, values: string[]) => {
          q.column = column;
          q.values = values;
          return chain;
        },
        is: (col: string) => {
          q.filters.push(`is:${col}`);
          return chain;
        },
        neq: (col: string, v: string) => {
          q.filters.push(`neq:${col}:${v}`);
          return chain;
        },
        then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => {
          queries.push(q);
          if (options.failOn === `${table}.${q.column}`) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok, ko);
          const data = (tables[table] ?? []).filter((r) => q.values.includes(String(r[q.column])));
          return Promise.resolve({ data, error: null }).then(ok, ko);
        },
      };
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

describe('precheckImportDuplicates — consultas dirigidas, NIT normalizado', () => {
  it('un NIT con puntos y sin DV coincide con el guardado normalizado', async () => {
    const { client, queries } = precheckClient({
      prospect_candidates: [{ normalized_name: 'otra', country_code: 'CO', domain: null, tax_identifier: '900123456-8' }],
    });
    const [result] = await precheckImportDuplicates(client, [
      { index: 0, company_name: 'Acme', country_code: 'CO', tax_identifier: '900.123.456' },
    ]);
    assert.equal(result.duplicate_status, 'exact_duplicate');
    assert.equal(result.reason, 'Mismo identificador fiscal');
    // Nunca se lee la tabla completa: toda consulta va filtrada por valores.
    assert.ok(queries.every((q) => q.column && q.values.length > 0));
    // Candidatos descartados y cuentas borradas no cuentan.
    assert.ok(queries.filter((q) => q.table === 'accounts').every((q) => q.filters.includes('is:deleted_at')));
    assert.ok(queries.filter((q) => q.table === 'prospect_candidates').every((q) => q.filters.includes('neq:status:discarded')));
  });

  it('dominio con www y nombre en el mismo país', async () => {
    const { client } = precheckClient({
      accounts: [{ normalized_name: 'beta', country_code: 'CO', domain: 'www.acme.co', tax_identifier: null }],
    });
    const results = await precheckImportDuplicates(client, [
      { index: 0, company_name: 'Acme', country_code: 'CO', website: 'https://acme.co/contacto' },
      { index: 1, company_name: 'Beta', country_code: 'CO' },
      { index: 2, company_name: 'Beta', country_code: 'MX' },
      { index: 3, company_name: '' },
    ]);
    assert.deepEqual(results.map((r) => r.duplicate_status), ['exact_duplicate', 'possible_duplicate', 'no_match', 'insufficient_data']);
  });

  it('las consultas van en bloques acotados', async () => {
    const { client, queries } = precheckClient({});
    const items = Array.from({ length: 250 }, (_, i) => ({ index: i, company_name: `Empresa número ${i}`, country_code: 'CO' }));
    await precheckImportDuplicates(client, items);
    assert.ok(queries.every((q) => q.values.length <= 100));
  });

  it('un fallo de lectura se propaga (nunca «sin coincidencias» falso)', async () => {
    const { client } = precheckClient({}, { failOn: 'accounts.normalized_name' });
    await assert.rejects(precheckImportDuplicates(client, [{ index: 0, company_name: 'Acme SAS' }]));
  });

  it('variantes de NIT: crudo, normalizado por país y sólo dígitos', () => {
    assert.deepEqual(taxIdentifierVariants('900.123.456', 'CO').sort(), ['900.123.456', '900123456', '900123456-8', '9001234568'].sort());
    assert.deepEqual(taxIdentifierVariants('  ', 'CO'), []);
  });
});
