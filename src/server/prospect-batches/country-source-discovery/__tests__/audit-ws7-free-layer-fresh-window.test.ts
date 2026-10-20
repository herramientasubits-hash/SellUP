/**
 * AUDIT-A1-WS7 (16-10) — la capa gratuita ya no lee siempre la misma ventana.
 *
 * Antes: top N por `priority_score` y el filtro «ya en SellUp/HubSpot» después ⇒
 * tras la primera corrida, 0 nuevas para siempre. Ahora la lectura pagina y salta,
 * EN LA LECTURA, lo que SellUp ya conoce por identidad fuerte (candidata viva,
 * Descartadas de la capa gratuita, cuenta en `accounts` —incluidas las
 * sincronizadas desde HubSpot— por número fiscal o web).
 *
 * Sin red: lecturas inyectadas y un cliente doble de sólo SELECT.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  FRESH_WINDOW_MAX_PAGES,
  buildReadKnownSnapshotIdentities,
  isKnownSnapshotRow,
  readFreshSnapshotWindow,
  type KnownSnapshotIdentities,
} from '../country-source-fresh-window';
import { buildGtGuatecomprasDirectoryDiscoveryReads } from '../gt-guatecompras-directory-snapshot-query';

type Row = { tax: string | null; domain: string | null };

const source = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ tax: `T${i + 1}`, domain: i % 2 === 0 ? `e${i + 1}.com` : null }));

function windowOver(rows: Row[]) {
  const ranges: Array<[number, number]> = [];
  return {
    ranges,
    readRange: async (from: number, to: number) => {
      ranges.push([from, to]);
      return rows.slice(from, to + 1);
    },
  };
}

const knownOf = (taxIds: string[], domains: string[] = [], unlessDomain: string[] = []) =>
  async (): Promise<KnownSnapshotIdentities> => ({
    taxIds: new Set(taxIds),
    domains: new Set(domains),
    taxIdsUnlessDomain: new Set(unlessDomain),
  });

describe('readFreshSnapshotWindow', () => {
  it('sin lector de conocidas = una sola página, como antes', async () => {
    const w = windowOver(source(30));
    const rows = await readFreshSnapshotWindow({
      size: 10, countryCode: 'GT', readRange: w.readRange, taxIdOf: (r) => r.tax, domainOf: (r) => r.domain, readKnown: null,
    });
    assert.equal(rows.length, 10);
    assert.deepEqual(w.ranges, [[0, 9]]);
  });

  it('salta las ya conocidas y sigue a la página siguiente hasta llenar', async () => {
    const all = source(30);
    const w = windowOver(all);
    const rows = await readFreshSnapshotWindow({
      size: 10,
      countryCode: 'GT',
      readRange: w.readRange,
      taxIdOf: (r) => r.tax,
      domainOf: (r) => r.domain,
      // Las 10 primeras ya se vieron en una corrida anterior.
      readKnown: knownOf(all.slice(0, 10).map((r) => r.tax!)),
    });
    assert.deepEqual(rows.map((r) => r.tax), all.slice(10, 20).map((r) => r.tax));
    assert.deepEqual(w.ranges, [[0, 9], [10, 19]]);
  });

  it('una web conocida (cuenta o candidata viva) también salta', async () => {
    const w = windowOver(source(4));
    const rows = await readFreshSnapshotWindow({
      size: 4, countryCode: 'GT', readRange: w.readRange, taxIdOf: (r) => r.tax, domainOf: (r) => r.domain,
      readKnown: knownOf([], ['e1.com']),
    });
    assert.deepEqual(rows.map((r) => r.tax), ['T2', 'T3', 'T4']);
  });

  it('para cuando la fuente se agota o llega al techo de páginas', async () => {
    const all = source(500);
    const w = windowOver(all);
    const rows = await readFreshSnapshotWindow({
      size: 10, countryCode: 'GT', readRange: w.readRange, taxIdOf: (r) => r.tax, domainOf: (r) => r.domain,
      readKnown: knownOf(all.map((r) => r.tax!)),
    });
    assert.equal(rows.length, 0);
    assert.equal(w.ranges.length, FRESH_WINDOW_MAX_PAGES);

    const short = windowOver(source(12));
    await readFreshSnapshotWindow({
      size: 10, countryCode: 'GT', readRange: short.readRange, taxIdOf: (r) => r.tax, domainOf: (r) => r.domain,
      readKnown: knownOf(source(12).map((r) => r.tax!)),
    });
    assert.deepEqual(short.ranges, [[0, 9], [10, 19]]);
  });

  it('fail-open: si no se puede saber qué es conocido, la primera página cuenta entera', async () => {
    const w = windowOver(source(30));
    const rows = await readFreshSnapshotWindow({
      size: 10, countryCode: 'GT', readRange: w.readRange, taxIdOf: (r) => r.tax, domainOf: (r) => r.domain,
      readKnown: async () => {
        throw new Error('db down');
      },
    });
    assert.equal(rows.length, 10);
    assert.deepEqual(w.ranges, [[0, 9]]);
  });

  it('un fallo de la primera lectura se propaga; el de una página siguiente no', async () => {
    await assert.rejects(
      readFreshSnapshotWindow({
        size: 5, countryCode: 'GT', readRange: async () => { throw new Error('boom'); },
        taxIdOf: (r: Row) => r.tax, domainOf: (r: Row) => r.domain, readKnown: knownOf([]),
      }),
    );
    let call = 0;
    const rows = await readFreshSnapshotWindow({
      size: 2,
      countryCode: 'GT',
      readRange: async () => {
        call++;
        if (call === 1) return source(2);
        throw new Error('boom');
      },
      taxIdOf: (r) => r.tax,
      domainOf: (r) => r.domain,
      readKnown: knownOf(['T1']),
    });
    assert.deepEqual(rows.map((r) => r.tax), ['T2']);
  });
});

describe('isKnownSnapshotRow', () => {
  const known: KnownSnapshotIdentities = {
    taxIds: new Set(['A']),
    taxIdsUnlessDomain: new Set(['B']),
    domains: new Set(['acme.com']),
  };
  it('número fiscal, web canónica y descartada sin web', () => {
    assert.equal(isKnownSnapshotRow({ taxId: 'A', domain: null }, known), true);
    assert.equal(isKnownSnapshotRow({ taxId: null, domain: 'www.acme.com' }, known), true);
    assert.equal(isKnownSnapshotRow({ taxId: 'B', domain: null }, known), true);
    // Descartada sólo por falta de web: vuelve si ahora trae dominio.
    assert.equal(isKnownSnapshotRow({ taxId: 'B', domain: 'nueva.com' }, known), false);
    assert.equal(isKnownSnapshotRow({ taxId: 'C', domain: 'otra.com' }, known), false);
  });
});

describe('buildReadKnownSnapshotIdentities (sólo SELECT)', () => {
  type Query = { table: string; filters: Array<[string, unknown[]]> };

  function fakeClient(tables: Record<string, Array<Record<string, unknown>>>) {
    const queries: Query[] = [];
    const client = {
      from(table: string) {
        const query: Query = { table, filters: [] };
        queries.push(query);
        const builder: Record<string, unknown> = {
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve);
          },
        };
        for (const method of ['select', 'eq', 'in', 'not']) {
          builder[method] = (...args: unknown[]) => {
            query.filters.push([method, args]);
            return builder;
          };
        }
        for (const write of ['insert', 'update', 'upsert', 'delete', 'rpc']) {
          builder[write] = () => {
            throw new Error(`escritura prohibida: ${write}`);
          };
        }
        return builder;
      },
    };
    return { client: client as unknown as SupabaseClient, queries };
  }

  it('candidatas vivas, cuentas y Descartadas; descartadas no bloquean (§ 9)', async () => {
    const { client, queries } = fakeClient({
      prospect_candidates: [{ tax_identifier: 'T1', domain: 'www.viva.com' }],
      accounts: [{ tax_identifier: 'T2', domain: 'cliente.com' }],
      prospect_discarded_dispositions: [
        { provider_identifier: 'tax:T3', status: 'discarded', reason_code: 'other', created_at: '2026-10-01T00:00:00Z', decision: 'discard' },
        { provider_identifier: 'tax:T4', status: 'discarded', reason_code: 'missing_domain_final', created_at: new Date().toISOString(), decision: null },
      ],
    });
    const known = await buildReadKnownSnapshotIdentities(client)({
      countryCode: 'gt', taxIds: ['T1', 'T2', 'T3', 'T4'], domains: ['viva.com'],
    });
    assert.deepEqual([...known.taxIds].sort(), ['T1', 'T2', 'T3']);
    assert.deepEqual([...known.taxIdsUnlessDomain], ['T4']);
    assert.ok(known.domains.has('viva.com'));
    assert.ok(known.domains.has('cliente.com'));
    const candidateQuery = queries.find((q) => q.table === 'prospect_candidates')!;
    assert.deepEqual(candidateQuery.filters.find(([m]) => m === 'not')?.[1], [
      'status', 'in', '(discarded,rejected,archived,duplicate,qa_cleanup)',
    ]);
  });
});

describe('lectura de Guatemala con la ventana nueva', () => {
  it('la primera página sigue siendo la consulta de siempre (limit), las siguientes con range', async () => {
    const pages: Array<Array<Record<string, unknown>>> = [
      [{ record_identity_key: 'tax:1', normalized_tax_id: '1', legal_name: 'A', normalized_legal_name: 'A', city: null, region: null, priority_score: 9, raw_data: {} }],
      [{ record_identity_key: 'tax:2', normalized_tax_id: '2', legal_name: 'B', normalized_legal_name: 'B', city: null, region: null, priority_score: 8, raw_data: {} }],
    ];
    const terminal: string[] = [];
    const client = {
      from(table: string) {
        const builder: Record<string, unknown> = {};
        for (const method of ['select', 'eq', 'order', 'not']) builder[method] = () => builder;
        builder.in = () => builder;
        builder.then = (resolve: (value: unknown) => unknown) =>
          // Lecturas de «conocidas»: la empresa 1 ya es candidata viva.
          Promise.resolve({
            data: table === 'prospect_candidates' ? [{ tax_identifier: '1' }] : [],
            error: null,
          }).then(resolve);
        builder.limit = () => {
          terminal.push('limit');
          return Promise.resolve({ data: pages[0], error: null });
        };
        builder.range = (from: number) => {
          terminal.push(`range:${from}`);
          return Promise.resolve({ data: pages[1], error: null });
        };
        return builder;
      },
    } as unknown as SupabaseClient;
    const rows = await buildGtGuatecomprasDirectoryDiscoveryReads(client).readCompaniesByMacro({ macroIndustryKey: 'technology', limit: 1 });
    assert.deepEqual(rows.map((r) => r.nit), ['2']);
    assert.deepEqual(terminal, ['limit', 'range:1']);
  });
});
