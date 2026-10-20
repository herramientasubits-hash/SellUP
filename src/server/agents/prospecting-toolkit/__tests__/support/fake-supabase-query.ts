/**
 * Doble mínimo de cliente Supabase para las pruebas de WS3 (reclamos, novedad,
 * duplicados): cada `from(tabla)` devuelve un filtro encadenable que registra
 * los filtros y, al esperarlo, responde lo que diga `respond`.
 *
 * No imita PostgREST: sólo deja ver QUÉ se pidió (tabla, filtros, rango) y
 * controlar QUÉ vuelve (filas o error) para probar la degradación.
 */

export type RecordedFilter = { op: string; column?: string; value?: unknown };

export type RecordedQuery = {
  table: string;
  select: string | null;
  filters: RecordedFilter[];
  order: string | null;
  range: [number, number] | null;
};

export type FakeResponse = { data: unknown[] | null; error: unknown };

export type FakeResponder = (query: RecordedQuery) => FakeResponse;

export function createFakeSupabase(respond: FakeResponder): {
  client: { from: (table: string) => unknown; rpc?: unknown };
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];

  function builder(table: string) {
    const query: RecordedQuery = { table, select: null, filters: [], order: null, range: null };
    const self: Record<string, unknown> = {};
    const chain =
      (op: string) =>
      (column?: string, value?: unknown) => {
        query.filters.push({ op, column, value });
        return self;
      };
    for (const op of ['eq', 'neq', 'in', 'is', 'gte', 'lte', 'not', 'ilike', 'or', 'limit']) {
      self[op] = chain(op);
    }
    self.select = (columns: string) => {
      query.select = columns;
      return self;
    };
    self.order = (column: string) => {
      query.order = column;
      return self;
    };
    self.range = (from: number, to: number) => {
      query.range = [from, to];
      return self;
    };
    self.then = (resolve: (value: FakeResponse) => unknown, reject?: (err: unknown) => unknown) => {
      queries.push(query);
      try {
        return Promise.resolve(respond(query)).then(resolve, reject);
      } catch (err) {
        return Promise.reject(err).then(resolve, reject);
      }
    };
    return self;
  }

  return { client: { from: (table: string) => builder(table) }, queries };
}

/** Valor de un filtro registrado (el primero con esa operación y columna). */
export function filterValue(query: RecordedQuery, op: string, column: string): unknown {
  return query.filters.find((f) => f.op === op && f.column === column)?.value;
}
