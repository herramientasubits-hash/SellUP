// ── Importar candidatos — cómo se reparte la validación post-importación ─────
//
// AGENT1-AUDIT-WS5-IMPORT-DEADLINE-1 — la validación recorría las filas UNA
// por UNA (búsqueda de NIT + HubSpot por fila): 500 filas superaban los 300 s
// de la función y Vercel la cortaba a la mitad, dejando filas sin validar ni
// marcar. Ahora:
//   · se trabaja con concurrencia ACOTADA (3-4 a la vez, para no saturar
//     HubSpot ni Socrata);
//   · cerca del plazo NO se empiezan filas nuevas: las que están en curso
//     terminan y las que no empezaron se devuelven para marcarlas «pendiente
//     de revalidar» (nunca quedan a medias).
// Este módulo vive aparte porque `actions.ts` es `use server` (sólo exporta
// funciones async invocables) y porque así se prueba sin red.

/** Filas que se validan a la vez. */
export const IMPORT_VALIDATION_CONCURRENCY = 4;

export interface BoundedRunOutcome<R> {
  /** Resultado por índice de entrada, sólo de las filas que se procesaron. */
  results: Map<number, R>;
  /** Índices que no se empezaron porque se alcanzó el plazo. */
  skippedIndexes: number[];
}

/**
 * Corre `worker` sobre `items` con a lo sumo `concurrency` a la vez. Con
 * `deadlineAtMs`, ningún trabajo EMPIEZA después del plazo; los ya empezados
 * terminan. `worker` no debe lanzar (si lanza, la promesa se rechaza: es un
 * error de programación, no de una fila).
 */
export async function runBoundedWithDeadline<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  options: { concurrency: number; deadlineAtMs?: number | null; now?: () => number },
): Promise<BoundedRunOutcome<R>> {
  const now = options.now ?? Date.now;
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const results = new Map<number, R>();
  const skippedIndexes: number[] = [];
  let next = 0;

  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      if (options.deadlineAtMs != null && now() >= options.deadlineAtMs) {
        skippedIndexes.push(index);
        continue;
      }
      results.set(index, await worker(items[index], index));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => lane()));
  skippedIndexes.sort((a, b) => a - b);
  return { results, skippedIndexes };
}

/** Memoriza una consulta async por petición (p. ej. «¿está configurado Socrata?»). */
export function memoizeAsync<R>(fn: () => Promise<R>): () => Promise<R> {
  let pending: Promise<R> | null = null;
  return () => {
    if (!pending) {
      pending = fn().catch((err: unknown) => {
        // Un fallo no se memoriza: la siguiente fila vuelve a intentar.
        pending = null;
        throw err;
      });
    }
    return pending;
  };
}

/**
 * Ordena las filas según los ids dados (el orden del archivo); las que no
 * aparecen van al final en su orden original. No muta la entrada.
 */
export function orderByIds<T extends { id: string }>(rows: readonly T[], orderedIds?: readonly string[] | null): T[] {
  if (!orderedIds || orderedIds.length === 0) return [...rows];
  const position = new Map(orderedIds.map((id, i) => [id, i]));
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const pa = position.get(a.row.id) ?? Number.MAX_SAFE_INTEGER;
      const pb = position.get(b.row.id) ?? Number.MAX_SAFE_INTEGER;
      return pa !== pb ? pa - pb : a.i - b.i;
    })
    .map(({ row }) => row);
}
