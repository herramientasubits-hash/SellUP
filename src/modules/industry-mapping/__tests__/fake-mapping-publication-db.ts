// fake-mapping-publication-db.ts — Injectable in-memory fake for
// MappingPublicationDbClient. No Supabase, no network. Mirrors only the exact
// chain shapes the publication service actually calls: select().eq()...eq()
// as a thenable list result (matching the real PostgrestFilterBuilder),
// .maybeSingle() for single-row loads, and .rpc().

import type {
  MappingPublicationDbClient,
  MappingPublicationListResult,
  MappingPublicationRowResult,
  MappingPublicationRpcResult,
} from '../mapping-publication-types';

export interface FakePublicationTableState {
  rows: Record<string, unknown>[];
}

export function makeFakePublicationTableState(
  rows: Record<string, unknown>[] = [],
): FakePublicationTableState {
  return { rows };
}

export type FakeRpcHandler = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<MappingPublicationRpcResult> | MappingPublicationRpcResult;

export function makeFakePublicationDb(
  tables: Record<string, FakePublicationTableState>,
  rpcHandler: FakeRpcHandler,
): MappingPublicationDbClient {
  return {
    from(table: string) {
      const state = tables[table];
      if (!state) {
        throw new Error(`fake-mapping-publication-db: unknown table "${table}"`);
      }

      return {
        select() {
          const filters: Array<[string, string]> = [];

          const resolve = async (): Promise<MappingPublicationListResult> => {
            const matches = state.rows.filter((row) => filters.every(([c, v]) => row[c] === v));
            return { data: matches, error: null };
          };

          const chain = {
            eq(column: string, value: string) {
              filters.push([column, value]);
              return chain;
            },
            async maybeSingle(): Promise<MappingPublicationRowResult> {
              const matches = state.rows.filter((row) => filters.every(([c, v]) => row[c] === v));
              return { data: matches[0] ?? null, error: null };
            },
            then<TResult1 = MappingPublicationListResult, TResult2 = never>(
              onfulfilled?: ((value: MappingPublicationListResult) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
            ) {
              return resolve().then(onfulfilled, onrejected);
            },
          };
          return chain;
        },
      };
    },

    async rpc(fn: string, params: Record<string, unknown>): Promise<MappingPublicationRpcResult> {
      return rpcHandler(fn, params);
    },
  };
}
