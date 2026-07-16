/**
 * snapshot-read-fake-supabase.ts — Test-only, in-memory fake of the exact
 * PostgREST query chain the cardinality-aware snapshot readers use against
 * `source_company_snapshots`.
 *
 * Hito: EC4D5.APP-C2 — Test infra for cardinality-aware snapshot readers.
 *
 * WHY THIS EXISTS
 * ----------------
 * The APP-C0 audit found the previous fakes did not model PostgREST
 * cardinality faithfully, so they could not demonstrate the silent-pick bug
 * in readers that do `.limit(1).maybeSingle()`. This fake reproduces the
 * *dangerous* server-side ordering PostgREST actually applies:
 *
 *     filter (eq) -> order -> limit -> cardinality check (maybeSingle/single)
 *
 * Because `.limit(1)` truncates BEFORE `.maybeSingle()` inspects cardinality,
 * a query that matches 2 rows silently returns 1 arbitrary row and NO error.
 * The safe probe `.limit(2).maybeSingle()` instead surfaces PGRST116 and lets
 * a reader classify the outcome. Readers are NOT modified in this hito; this
 * fake is the harness that will let APP-C3/C4 prove the fix.
 *
 * SCOPE: only the `source_company_snapshots` table is supported. Any other
 * table throws, on purpose — this is not a general-purpose Supabase fake.
 */

/** Minimal snapshot row. Required identity columns plus arbitrary extras. */
export interface FakeSnapshotRow {
  readonly source_key: string;
  readonly country_code: string;
  readonly source_year: number;
  readonly normalized_tax_id: string;
  /** Shadow identity column (APP-C1A); may be absent/null for legacy rows. */
  readonly record_identity_key?: string | null;
  readonly raw_data?: unknown;
  readonly imported_at?: string;
  readonly [column: string]: unknown;
}

/** PostgREST-shaped error. Only `code` is load-bearing for readers. */
export interface FakePostgrestError {
  readonly code: string;
  readonly message: string;
  readonly details: string;
  readonly hint: string | null;
}

export interface FakeSingleResult<TRow> {
  readonly data: TRow | null;
  readonly error: FakePostgrestError | null;
}

export interface FakeListResult<TRow> {
  readonly data: TRow[] | null;
  readonly error: FakePostgrestError | null;
}

export interface FakeSnapshotQueryBuilder<TRow>
  extends PromiseLike<FakeListResult<TRow>> {
  select(columns?: string): FakeSnapshotQueryBuilder<TRow>;
  eq(column: string, value: unknown): FakeSnapshotQueryBuilder<TRow>;
  order(
    column: string,
    options?: { ascending?: boolean },
  ): FakeSnapshotQueryBuilder<TRow>;
  limit(count: number): FakeSnapshotQueryBuilder<TRow>;
  maybeSingle(): Promise<FakeSingleResult<TRow>>;
  single(): Promise<FakeSingleResult<TRow>>;
}

export interface FakeSnapshotSupabaseClient {
  from(table: string): FakeSnapshotQueryBuilder<FakeSnapshotRow>;
}

export const SUPPORTED_TABLE = 'source_company_snapshots' as const;

const PGRST116 = 'PGRST116';

interface Ordering {
  readonly column: string;
  readonly ascending: boolean;
}

function pgrst116(rowCount: number): FakePostgrestError {
  return {
    code: PGRST116,
    message: 'JSON object requested, multiple (or no) rows returned',
    details: `The result contains ${rowCount} rows`,
    hint: null,
  };
}

/** Deterministic comparison usable for numbers, strings and dates. */
function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  // Absent values sort last, deterministically, regardless of direction input.
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1;
  return String(a) < String(b) ? -1 : 1;
}

function parseColumns(columns: string): string[] {
  return columns
    .split(',')
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
}

function projectRow(
  row: FakeSnapshotRow,
  selectColumns: string | null,
): FakeSnapshotRow {
  if (selectColumns === null || selectColumns.trim() === '*') {
    return { ...row };
  }
  const columns = parseColumns(selectColumns);
  if (columns.includes('*')) {
    return { ...row };
  }
  const projected: Record<string, unknown> = {};
  for (const column of columns) {
    projected[column] = row[column];
  }
  return projected as unknown as FakeSnapshotRow;
}

/**
 * Builds the immutable snapshot fake. The returned client hands out a fresh
 * builder per `from()` call, so queries never share filter/order/limit state.
 */
export function createFakeSnapshotSupabaseClient(
  rows: readonly FakeSnapshotRow[],
): FakeSnapshotSupabaseClient {
  const snapshot = rows.map((row) => ({ ...row }));

  function makeBuilder(): FakeSnapshotQueryBuilder<FakeSnapshotRow> {
    const filters: Array<[string, unknown]> = [];
    const orderings: Ordering[] = [];
    let limitCount: number | null = null;
    let selectColumns: string | null = null;

    // filter -> order -> limit -> project, exactly as PostgREST resolves it.
    const resolveRows = (): FakeSnapshotRow[] => {
      let matched = snapshot.filter((row) =>
        filters.every(([column, value]) => row[column] === value),
      );

      for (const { column, ascending } of orderings) {
        const factor = ascending ? 1 : -1;
        matched = [...matched].sort(
          (a, b) => compareValues(a[column], b[column]) * factor,
        );
      }

      if (limitCount !== null) {
        matched = matched.slice(0, limitCount);
      }

      return matched.map((row) => projectRow(row, selectColumns));
    };

    const builder: FakeSnapshotQueryBuilder<FakeSnapshotRow> = {
      select(columns?: string) {
        selectColumns = columns ?? '*';
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderings.push({ column, ascending: options?.ascending ?? true });
        return builder;
      },
      limit(count: number) {
        limitCount = count;
        return builder;
      },
      // maybeSingle: 0 rows -> null/null; 1 row -> row; >1 rows -> PGRST116.
      // NOTE: limit() has already truncated, so limit(1).maybeSingle() over
      // multiple matches yields ONE arbitrary row and NO error (the bug).
      async maybeSingle(): Promise<FakeSingleResult<FakeSnapshotRow>> {
        const matched = resolveRows();
        if (matched.length > 1) {
          return { data: null, error: pgrst116(matched.length) };
        }
        return { data: matched[0] ?? null, error: null };
      },
      // single: exactly 1 row required; 0 or >1 rows -> PGRST116.
      async single(): Promise<FakeSingleResult<FakeSnapshotRow>> {
        const matched = resolveRows();
        if (matched.length === 1) {
          return { data: matched[0], error: null };
        }
        return { data: null, error: pgrst116(matched.length) };
      },
      then<TResult1 = FakeListResult<FakeSnapshotRow>, TResult2 = never>(
        onfulfilled?:
          | ((
              value: FakeListResult<FakeSnapshotRow>,
            ) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ): PromiseLike<TResult1 | TResult2> {
        const result: FakeListResult<FakeSnapshotRow> = {
          data: resolveRows(),
          error: null,
        };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      },
    };

    return builder;
  }

  return {
    from(table: string) {
      if (table !== SUPPORTED_TABLE) {
        throw new Error(
          `snapshot-read-fake-supabase: only "${SUPPORTED_TABLE}" is supported, got "${table}"`,
        );
      }
      return makeBuilder();
    },
  };
}
