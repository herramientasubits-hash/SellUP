/**
 * Agente 1 · «Competidores de una empresa» — lo que el vendedor debe saber de una
 * corrida que el juez no revisó completa (puro).
 *
 * Auditoría 21-10: si el juez de Claude no respondía, o la lista pasaba de 240
 * filas, lo gratuito aportaba menos sin ningún aviso; sólo quedaba en la telemetría
 * del lote (`competitor_free_sources.competitor_judge_by_source` y
 * `competitor_apollo`).
 */

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export type CompetitorJudgeNotice = {
  /** Llamadas al juez sin respuesta (una fuente entera quedó sin revisar). */
  unanswered: number;
  /** Filas que el juez no alcanzó a mirar por su tope. */
  dropped: number;
  /** Lotes del juez que fallaron mientras otros respondieron. */
  failedChunks: number;
};

/** `null` ⇒ el juez revisó todo lo que se le ofreció (o el lote no es de competidores). */
export function readCompetitorJudgeNotice(batchMetadata: unknown): CompetitorJudgeNotice | null {
  const metadata = asRecord(batchMetadata);
  const bySource = asRecord(asRecord(metadata?.competitor_free_sources)?.competitor_judge_by_source) ?? {};
  const notice: CompetitorJudgeNotice = { unanswered: 0, dropped: 0, failedChunks: 0 };
  for (const entry of Object.values(bySource)) {
    const tally = asRecord(entry);
    notice.unanswered += count(tally?.unanswered);
    notice.dropped += count(tally?.dropped);
    notice.failedChunks += count(tally?.failedChunks);
  }
  const apollo = asRecord(metadata?.competitor_apollo);
  if (apollo?.reason === 'judge_unavailable') notice.unanswered += 1;
  notice.failedChunks += count(apollo?.judge_chunks_failed);
  return notice.unanswered + notice.dropped + notice.failedChunks > 0 ? notice : null;
}

/** El aviso en dos líneas como mucho (decisión de la dueña 21-10 sobre avisos cortos). */
export function describeCompetitorJudgeNotice(notice: CompetitorJudgeNotice): string {
  const parts: string[] = [];
  if (notice.unanswered > 0 || notice.failedChunks > 0) parts.push('Claude no pudo revisar parte de las fuentes gratuitas');
  if (notice.dropped > 0) parts.push(`${notice.dropped} empresas quedaron sin revisar por el tope`);
  return `${parts.join(' y ')}. Puede haber más competidoras: vuelve a buscar más tarde.`;
}

export type CompetitorWithoutWebsite = { name: string; evidence: string | null; sourceUrl: string | null };

/** Las propuestas de Claude sin sitio web que guardó el sellado (`competitor_without_website`). */
export function readCompetitorWithoutWebsite(batchMetadata: unknown): CompetitorWithoutWebsite[] {
  const raw = asRecord(batchMetadata)?.competitor_without_website;
  if (!Array.isArray(raw)) return [];
  const text = (value: unknown, max: number): string | null =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
  const out: CompetitorWithoutWebsite[] = [];
  for (const entry of raw) {
    const item = asRecord(entry);
    const name = text(item?.name, 120);
    if (!name) continue;
    const url = text(item?.sourceUrl, 500);
    out.push({ name, evidence: text(item?.evidence, 240), sourceUrl: url && /^https?:\/\//i.test(url) ? url : null });
  }
  return out;
}
