/**
 * Lectura paginada de Supabase para sumas y agregados.
 *
 * Por qué existe: la API REST de Supabase devuelve como máximo 1.000 filas por
 * petición. Una consulta sin `.range()` sobre una tabla más grande NO falla:
 * devuelve las primeras 1.000 y la suma queda corta sin que nadie se entere
 * (provider_usage_logs ya pasó de 4.700 filas en Producción).
 *
 * Reglas:
 *   - se lee página a página con `.range(from, to)`; quien llama ordena por una
 *     clave estable (p. ej. `created_at, id`) para que las páginas no se pisen;
 *   - hay un tope de seguridad; si se alcanza, el resultado lo DICE con
 *     `truncated: true` en vez de cortar en silencio;
 *   - un error de lectura vuelve como `error`, nunca como una lista vacía que
 *     parezca «no hubo consumo».
 *
 * Sólo lee: no inserta, no actualiza, no borra.
 */

/** Máximo de filas que la API REST de Supabase devuelve por petición. */
export const READ_PAGE_SIZE = 1000;

/** Tope de seguridad de filas leídas por consulta (protege memoria y tiempo). */
export const READ_SAFETY_CAP_ROWS = 200_000;

/**
 * Trozo máximo de ids en un filtro `.in(...)`: la lista viaja en la URL, y una
 * URL demasiado larga la rechaza el servidor.
 */
export const IN_FILTER_CHUNK_SIZE = 200;

export interface PaginatedReadResult<T> {
  rows: T[];
  /** true ⇒ había más filas que el tope de seguridad: las cifras pueden quedarse cortas. */
  truncated: boolean;
  /** Mensaje del error de lectura, o null si todo se leyó bien. */
  error: string | null;
}

/** Pide UNA página: las filas de `from` a `to`, ambos incluidos (como `.range`). */
export type PageFetcher<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export interface FetchAllPagesOptions<T> {
  pageSize?: number;
  /** Tope de filas LEÍDAS (no de filas conservadas). */
  maxRows?: number;
  /** Filtro en memoria: sólo se conservan las filas que lo cumplen. */
  keep?: (row: T) => boolean;
  /** Deja de leer en cuanto se conservan tantas filas (p. ej. «las últimas 25»). */
  stopAfterKept?: number;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return 'error de lectura desconocido';
}

export async function fetchAllPages<T>(
  fetchPage: PageFetcher<T>,
  options: FetchAllPagesOptions<T> = {},
): Promise<PaginatedReadResult<T>> {
  const pageSize = options.pageSize ?? READ_PAGE_SIZE;
  const maxRows = options.maxRows ?? READ_SAFETY_CAP_ROWS;
  const keep = options.keep;
  const stopAfterKept = options.stopAfterKept;

  const rows: T[] = [];
  let read = 0;

  try {
    while (read < maxRows) {
      const { data, error } = await fetchPage(read, read + pageSize - 1);
      if (error) return { rows, truncated: false, error: errorMessage(error) };
      const page = data ?? [];

      // Nunca se conservan más filas leídas que el tope.
      const allowed = page.slice(0, maxRows - read);
      read += allowed.length;
      for (const row of allowed) {
        if (keep && !keep(row)) continue;
        rows.push(row);
        if (stopAfterKept !== undefined && rows.length >= stopAfterKept) {
          return { rows, truncated: false, error: null };
        }
      }

      if (page.length > allowed.length) return { rows, truncated: true, error: null };
      if (page.length < pageSize) return { rows, truncated: false, error: null };
    }

    // Se llegó justo al tope con una página llena: una fila más decide si había
    // más datos detrás (truncado) o si la tabla terminaba exactamente ahí.
    const probe = await fetchPage(read, read);
    if (probe.error) return { rows, truncated: false, error: errorMessage(probe.error) };
    return { rows, truncated: (probe.data ?? []).length > 0, error: null };
  } catch (err) {
    return { rows, truncated: false, error: errorMessage(err) };
  }
}

export function chunkValues<V>(values: readonly V[], size: number): V[][] {
  const chunks: V[][] = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

/**
 * Igual que `fetchAllPages`, pero para un filtro `.in(columna, ids)` con muchos
 * ids: parte los ids en trozos (la lista viaja en la URL) y pagina cada trozo.
 * El tope de seguridad es del total, no de cada trozo.
 */
export async function fetchAllPagesInChunks<V, T>(
  values: readonly V[],
  chunkSize: number,
  buildFetcher: (chunk: V[]) => PageFetcher<T>,
  options: Omit<FetchAllPagesOptions<T>, 'stopAfterKept'> = {},
): Promise<PaginatedReadResult<T>> {
  const maxRows = options.maxRows ?? READ_SAFETY_CAP_ROWS;
  const rows: T[] = [];

  for (const chunk of chunkValues(values, chunkSize)) {
    const remaining = maxRows - rows.length;
    if (remaining <= 0) return { rows, truncated: true, error: null };
    const part = await fetchAllPages(buildFetcher(chunk), { ...options, maxRows: remaining });
    rows.push(...part.rows);
    if (part.error) return { rows, truncated: part.truncated, error: part.error };
    if (part.truncated) return { rows, truncated: true, error: null };
  }
  return { rows, truncated: false, error: null };
}
