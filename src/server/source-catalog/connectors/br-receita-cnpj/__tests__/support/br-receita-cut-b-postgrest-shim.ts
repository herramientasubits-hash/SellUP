// BR-SOURCE FUNCTIONAL CUT B — el puente mínimo entre el lector PostgREST-shaped y un PostgreSQL real.
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// El lector de la corrida publicada habla la MISMA superficie mínima que todos los demás
// lectores de snapshot del catálogo (`SnapshotReadClient`: `from().select().eq().limit()`),
// porque en producción lo alimenta el cliente de Supabase y una lectura de dos pasos no
// necesita transacción. El ESCRITOR, en cambio, habla SQL, porque el relevo tiene que
// commitear con el último lote y PostgREST no tiene transacciones multi-sentencia.
//
// Sin este puente, el E2E tendría que elegir: o probar el lector contra un doble en memoria
// (y entonces el índice único parcial, el CHECK de Brasil y la unicidad de «una publicada por
// periodo» no arbitran nada), o no probar el lector real en absoluto. Este shim traduce esa
// superficie mínima a SQL parametrizado contra el MISMO PostgreSQL efímero donde corrió la
// cadena real de migraciones, así que las diez casuísticas del corte se ejercitan sobre las
// constraints reales.
//
// NO es código de producción: vive bajo `__tests__/support`, nadie lo importa desde `src`, no
// lee un flag, no crea un cliente de Supabase, no toca Producción ni ninguna base remota.
//
// 🔴 Es deliberadamente TONTO. No implementa `or`, `in`, `not`, ni `select('*')` con expansión:
// sólo igualdades, `order` y `limit`, que es exactamente lo que el contrato de lectura usa. Un
// shim más capaz permitiría escribir en la prueba una consulta que el lector real no puede
// expresar, y entonces la prueba dejaría de medir al lector.

import type {
  SnapshotIdentityRow,
  SnapshotReadClient,
  SnapshotReadFilterableQuery,
  SnapshotReadListResponse,
  SnapshotReadPostgrestError,
  SnapshotReadSingleResponse,
} from '../../../../snapshot-read/snapshot-read-contract';

export interface ShimSqlClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Identificadores admisibles. Un shim de pruebas también parametriza y también valida. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function assertSafeIdentifier(value: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(`postgrest shim: identificador no admisible "${value}"`);
  }
  return value;
}

function parseSelectColumns(columns: string | undefined): string {
  if (columns === undefined || columns.trim() === '' || columns.trim() === '*') {
    return '*';
  }
  return columns
    .split(',')
    .map((column) => assertSafeIdentifier(column.trim()))
    .join(', ');
}

interface QueryState {
  readonly table: string;
  readonly columns: string;
  readonly filters: { column: string; value: unknown }[];
  order: { column: string; ascending: boolean } | null;
  limit: number | null;
}

function buildSql(state: QueryState): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const where = state.filters.map((filter) => {
    values.push(filter.value);
    return `${filter.column} = $${values.length}`;
  });

  const parts = [`SELECT ${state.columns} FROM public.${state.table}`];
  if (where.length > 0) {
    parts.push(`WHERE ${where.join(' AND ')}`);
  }
  if (state.order !== null) {
    parts.push(`ORDER BY ${state.order.column} ${state.order.ascending ? 'ASC' : 'DESC'}`);
  }
  if (state.limit !== null) {
    parts.push(`LIMIT ${Math.max(0, Math.floor(state.limit))}`);
  }
  return { sql: parts.join(' '), values };
}

/** Traduce un fallo del driver a la forma de error que el contrato de lectura espera. */
function toPostgrestError(error: unknown): SnapshotReadPostgrestError {
  const code =
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  return { code, message: 'query failed' };
}

function createQuery<TRow extends SnapshotIdentityRow>(
  sql: ShimSqlClient,
  state: QueryState,
): SnapshotReadFilterableQuery<TRow> {
  const run = async (): Promise<SnapshotReadListResponse<TRow>> => {
    const { sql: statement, values } = buildSql(state);
    try {
      const result = await sql.query(statement, values);
      return { data: result.rows as TRow[], error: null };
    } catch (error) {
      return { data: null, error: toPostgrestError(error) };
    }
  };

  const query: SnapshotReadFilterableQuery<TRow> = {
    eq(column: string, value: unknown) {
      state.filters.push({ column: assertSafeIdentifier(column), value });
      return query;
    },
    order(column: string, options?: { ascending?: boolean }) {
      state.order = {
        column: assertSafeIdentifier(column),
        ascending: options?.ascending !== false,
      };
      return query;
    },
    limit(count: number) {
      state.limit = count;
      return query;
    },
    async maybeSingle(): Promise<SnapshotReadSingleResponse<TRow>> {
      const previousLimit = state.limit;
      state.limit = 2;
      const response = await run();
      state.limit = previousLimit;
      if (response.error) {
        return { data: null, error: response.error };
      }
      const rows = response.data ?? [];
      if (rows.length > 1) {
        // PostgREST devuelve PGRST116 cuando `maybeSingle` ve más de una fila. Se reproduce en
        // vez de elegir una: elegir en silencio es justo el defecto que el contrato evita.
        return { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } };
      }
      return { data: rows[0] ?? null, error: null };
    },
    then(onfulfilled, onrejected) {
      return run().then(onfulfilled, onrejected);
    },
  };

  return query;
}

/**
 * Cliente de lectura PostgREST-shaped respaldado por un PostgreSQL real.
 *
 * Sólo lee: no expone `insert`, `upsert`, `update` ni `delete`, así que una prueba no puede
 * escribir «por el atajo» del lector y saltarse el ejecutor y sus invariantes.
 */
export function createPostgrestShimClient(
  sql: ShimSqlClient,
): SnapshotReadClient<SnapshotIdentityRow> {
  return {
    from(table: string) {
      const safeTable = assertSafeIdentifier(table);
      return {
        select(columns?: string) {
          return createQuery<SnapshotIdentityRow>(sql, {
            table: safeTable,
            columns: parseSelectColumns(columns),
            filters: [],
            order: null,
            limit: null,
          });
        },
      };
    },
  };
}
