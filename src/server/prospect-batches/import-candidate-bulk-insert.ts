// ── Importar candidatos — inserción en bloque ────────────────────────────────
//
// AGENT1-AUDIT-WS5-IMPORT-DEADLINE-1 — la ruta insertaba fila por fila (500
// viajes a la base antes de empezar a validar). Ahora se inserta por bloques;
// si un bloque falla (una fila rompe una restricción y PostgREST rechaza el
// bloque entero), ese bloque se reintenta fila por fila para que una fila
// mala no tumbe a sus vecinas — el mismo comportamiento tolerante de antes.
//
// Cada fila lleva `metadata.import_row_number` (número de fila del archivo,
// base 1): así el resultado se asocia a su fila sin depender del orden de
// RETURNING, y la validación puede recorrer las filas en el orden del archivo.

import type { SupabaseClient } from '@supabase/supabase-js';

export const IMPORT_INSERT_CHUNK_SIZE = 100;
export const IMPORT_ROW_NUMBER_METADATA_KEY = 'import_row_number';

export interface ImportCandidateInsertRow {
  rowNumber: number;
  insertData: Record<string, unknown>;
}

export interface InsertedImportCandidate {
  rowNumber: number;
  id: string;
  status: string | null;
}

export interface ImportCandidateInsertOutcome {
  /** En el orden del archivo. */
  inserted: InsertedImportCandidate[];
  failedRowNumbers: number[];
}

function withRowNumber(row: ImportCandidateInsertRow): Record<string, unknown> {
  const metadata = (row.insertData.metadata as Record<string, unknown> | undefined) ?? {};
  return { ...row.insertData, metadata: { ...metadata, [IMPORT_ROW_NUMBER_METADATA_KEY]: row.rowNumber } };
}

function readRowNumber(record: { metadata?: unknown }): number | null {
  const meta = record.metadata as Record<string, unknown> | null | undefined;
  const value = meta?.[IMPORT_ROW_NUMBER_METADATA_KEY];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

async function insertOne(
  client: SupabaseClient,
  row: ImportCandidateInsertRow,
): Promise<InsertedImportCandidate | null> {
  try {
    const { data, error } = await client
      .from('prospect_candidates')
      .insert(withRowNumber(row))
      .select('id, status')
      .single();
    if (error || !data?.id) {
      console.error(`[import-candidate-bulk-insert] fila ${row.rowNumber} no insertada:`, error?.message ?? 'sin id');
      return null;
    }
    return { rowNumber: row.rowNumber, id: String(data.id), status: (data.status as string | null) ?? null };
  } catch (err) {
    console.error(`[import-candidate-bulk-insert] fila ${row.rowNumber} no insertada:`, err);
    return null;
  }
}

type ChunkInsertResult =
  | { kind: 'ok'; rows: InsertedImportCandidate[] }
  /** PostgREST rechazó el bloque: la sentencia es atómica, no se escribió nada. */
  | { kind: 'rejected' }
  /** Se cayó la conexión: no se sabe si se escribió. NO se reintenta (duplicaría filas). */
  | { kind: 'indeterminate' };

async function insertChunk(
  client: SupabaseClient,
  chunk: readonly ImportCandidateInsertRow[],
): Promise<ChunkInsertResult> {
  try {
    const { data, error } = await client
      .from('prospect_candidates')
      .insert(chunk.map(withRowNumber))
      .select('id, status, metadata');
    if (error) return { kind: 'rejected' };
    if (!Array.isArray(data)) return { kind: 'indeterminate' };
    const byRowNumber = new Map<number, InsertedImportCandidate>();
    for (const record of data as Array<{ id?: unknown; status?: unknown; metadata?: unknown }>) {
      const rowNumber = readRowNumber(record);
      if (rowNumber === null || !record.id) continue;
      byRowNumber.set(rowNumber, {
        rowNumber,
        id: String(record.id),
        status: typeof record.status === 'string' ? record.status : null,
      });
    }
    // Si la respuesta no permite asociar TODAS las filas, no se adivina: se
    // devuelve lo asociado y el resto cuenta como no insertado por el
    // llamador (que nunca reintenta un bloque ya escrito: duplicaría filas).
    return {
      kind: 'ok',
      rows: chunk.map((row) => byRowNumber.get(row.rowNumber)).filter((r): r is InsertedImportCandidate => !!r),
    };
  } catch (err) {
    console.error('[import-candidate-bulk-insert] bloque con resultado incierto:', err);
    return { kind: 'indeterminate' };
  }
}

/**
 * Inserta las filas por bloques; un bloque RECHAZADO se reintenta fila por
 * fila. Un bloque incierto (conexión caída) cuenta como no insertado.
 */
export async function insertImportCandidateRows(
  client: SupabaseClient,
  rows: readonly ImportCandidateInsertRow[],
  chunkSize: number = IMPORT_INSERT_CHUNK_SIZE,
): Promise<ImportCandidateInsertOutcome> {
  const inserted: InsertedImportCandidate[] = [];
  const size = Math.max(1, Math.floor(chunkSize));
  for (let start = 0; start < rows.length; start += size) {
    const chunk = rows.slice(start, start + size);
    const chunkResult = await insertChunk(client, chunk);
    if (chunkResult.kind === 'ok') {
      inserted.push(...chunkResult.rows);
      continue;
    }
    if (chunkResult.kind === 'indeterminate') continue;
    for (const row of chunk) {
      const one = await insertOne(client, row);
      if (one) inserted.push(one);
    }
  }
  const insertedRowNumbers = new Set(inserted.map((r) => r.rowNumber));
  return {
    inserted: inserted.sort((a, b) => a.rowNumber - b.rowNumber),
    failedRowNumbers: rows.map((r) => r.rowNumber).filter((n) => !insertedRowNumbers.has(n)),
  };
}
