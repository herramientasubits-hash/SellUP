// fake-mapping-draft-db.ts — Injectable in-memory fake for MappingDraftDbClient.
// No Supabase, no network. Mirrors only the exact chain shapes the domain
// service actually calls (same convention as IdempotencyDbClient's fakes in
// wizard-idempotency.test.ts).

import type { MappingDraftDbClient, MappingDraftDbError } from '../mapping-draft-types';

export interface FakeTableState {
  rows: Record<string, unknown>[];
  nextIdSeq: number;
  /** Return a DbError to simulate a failed INSERT (e.g. unique_violation). */
  insertError?: (row: Record<string, unknown>) => MappingDraftDbError | null;
  /** Return a DbError to simulate a failed UPDATE. */
  updateError?: (id: string, patch: Record<string, unknown>) => MappingDraftDbError | null;
  /** Return a DbError to simulate a failed DELETE (e.g. foreign_key_violation). */
  deleteError?: (id: string) => MappingDraftDbError | null;
}

export function makeFakeTableState(rows: Record<string, unknown>[] = []): FakeTableState {
  return { rows, nextIdSeq: 1 };
}

export function makeFakeMappingDraftDb(
  tables: Record<string, FakeTableState>,
): MappingDraftDbClient {
  return {
    from(table: string) {
      const state = tables[table];
      if (!state) {
        throw new Error(`fake-mapping-draft-db: unknown table "${table}"`);
      }

      return {
        select() {
          const filters: Array<[string, string]> = [];
          const chain = {
            eq(column: string, value: string) {
              filters.push([column, value]);
              return chain;
            },
            async maybeSingle() {
              const match = state.rows.find((row) => filters.every(([c, v]) => row[c] === v)) ?? null;
              return { data: match, error: null };
            },
          };
          return chain;
        },

        insert(row: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  const error = state.insertError?.(row) ?? null;
                  if (error) return { data: null, error };
                  const id = `fake-${table}-${state.nextIdSeq++}`;
                  const newRow: Record<string, unknown> = {
                    id,
                    created_at: new Date(0).toISOString(),
                    ...row,
                  };
                  state.rows.push(newRow);
                  return { data: newRow, error: null };
                },
              };
            },
          };
        },

        update(patch: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              return {
                select() {
                  return {
                    async single() {
                      const error = state.updateError?.(value, patch) ?? null;
                      if (error) return { data: null, error };
                      const idx = state.rows.findIndex((row) => row[column] === value);
                      if (idx === -1) {
                        return { data: null, error: { message: 'fake row not found for update' } };
                      }
                      state.rows[idx] = { ...state.rows[idx], ...patch };
                      return { data: state.rows[idx], error: null };
                    },
                  };
                },
              };
            },
          };
        },

        delete() {
          return {
            async eq(column: string, value: string) {
              const error = state.deleteError?.(value) ?? null;
              if (error) return { error };
              const idx = state.rows.findIndex((row) => row[column] === value);
              if (idx !== -1) state.rows.splice(idx, 1);
              return { error: null };
            },
          };
        },
      };
    },
  };
}
