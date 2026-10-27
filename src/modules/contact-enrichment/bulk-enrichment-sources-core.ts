// De qué empresas busca contactos la búsqueda masiva cuando se lanza desde una
// búsqueda de prospectos: las que esa búsqueda ya convirtió en empresa. Puro: se
// prueba solo y se importa desde el servidor.

/** De dónde salió una búsqueda masiva de contactos (se guarda en su `metadata`). */
export type BulkEnrichmentOrigin = { kind: 'prospect_batch'; batchId: string };

/**
 * Las empresas que salieron de la búsqueda: sólo candidatas convertidas con su
 * empresa enlazada, sin repetir y en el orden en que llegaron. Una candidata
 * revertida conserva el id pero vuelve a `approved`: por eso se mira el estado.
 */
export function collectConvertedAccountIds(
  rows: ReadonlyArray<{ status: string | null; converted_account_id: string | null }>,
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.status === 'converted_to_account' && row.converted_account_id) ids.add(row.converted_account_id);
  }
  return [...ids];
}

/** El `origin` que llega del cliente, validado. Cualquier otra cosa se ignora. */
export function parseBulkEnrichmentOrigin(value: unknown): BulkEnrichmentOrigin | null {
  if (!value || typeof value !== 'object') return null;
  const { kind, batchId } = value as { kind?: unknown; batchId?: unknown };
  return kind === 'prospect_batch' && typeof batchId === 'string' && batchId.trim()
    ? { kind, batchId: batchId.trim() }
    : null;
}
