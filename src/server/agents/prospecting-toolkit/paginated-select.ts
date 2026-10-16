/**
 * AGENT1-SELECT-NO-SILENT-CAP-1 — lecturas de Supabase que no se cortan en
 * silencio.
 *
 * PostgREST devuelve como mucho `max-rows` filas por petición (1.000 en
 * Supabase) y NO avisa: una lectura de «todos los candidatos de los últimos 30
 * días» o «todas las filas de estos dominios» que pasara de 1.000 perdía el
 * resto sin error, y la memoria de novedad/negativa quedaba incompleta.
 *
 *   · `selectAllRows` — hace la consulta tal cual; si vuelve una página LLENA
 *     (posible corte), la repite ordenada por `id` y paginada con `range` hasta
 *     agotarla. Las consultas pequeñas (casi todas) siguen costando una petición.
 *   · `chunk` — trocea listas para `.in(...)`: cientos de ids en una URL pueden
 *     pasar el largo máximo y fallar.
 *
 * Un `error` de cualquier página se devuelve tal cual: el llamador decide cómo
 * degradar, pero nunca recibe una lista parcial como si fuera completa.
 */

/** Filas por página: el `max-rows` por defecto de Supabase. */
export const SUPABASE_PAGE_SIZE = 1000;

/** Tamaño de trozo para filtros `.in(...)` con ids o dominios. */
export const IN_FILTER_CHUNK_SIZE = 100;

type QueryResult<T> = { data: T[] | null; error: unknown };

/** Lo mínimo de un filtro de PostgREST que se puede ordenar y paginar. */
export type PageableQuery<T> = PromiseLike<QueryResult<T>> & {
  order?: (column: string, options?: { ascending?: boolean }) => PageableQuery<T>;
  range?: (from: number, to: number) => PromiseLike<QueryResult<T>>;
};

export type SelectAllResult<T> = { rows: T[]; error: unknown };

/**
 * Lee TODAS las filas de una consulta. `build` debe devolver un filtro NUEVO en
 * cada llamada (los filtros de PostgREST no se reutilizan después de esperarlos).
 */
export async function selectAllRows<T>(
  build: () => PageableQuery<T>,
  pageSize: number = SUPABASE_PAGE_SIZE,
): Promise<SelectAllResult<T>> {
  const first = await build();
  if (first.error) return { rows: [], error: first.error };
  const firstRows = Array.isArray(first.data) ? first.data : [];
  if (firstRows.length < pageSize) return { rows: firstRows, error: null };

  // Página llena: puede haber más. Se rehace ordenada y paginada.
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const query = build();
    if (typeof query.order !== 'function') {
      // Sin forma de ordenar no se puede paginar con garantía: es un corte.
      return { rows: [], error: new Error('selectAllRows: la consulta no admite order/range') };
    }
    const ordered = query.order('id', { ascending: true });
    if (typeof ordered.range !== 'function') {
      return { rows: [], error: new Error('selectAllRows: la consulta no admite order/range') };
    }
    const page = await ordered.range(from, from + pageSize - 1);
    if (page.error) return { rows: [], error: page.error };
    const pageRows = Array.isArray(page.data) ? page.data : [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { rows, error: null };
  }
}

/** Trocea una lista en bloques de `size`. */
export function chunk<T>(values: readonly T[], size: number = IN_FILTER_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}
