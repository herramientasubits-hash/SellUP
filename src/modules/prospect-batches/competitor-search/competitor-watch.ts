/**
 * Agente 1 · «Competidores de una empresa» — «Seguir esta referencia» y el resumen
 * semanal (Fase D de la auditoría del 21-10; puro). Migración 156.
 *
 * El resumen NUNCA busca ni gasta (decisión de la dueña 21-10: el gasto sólo a
 * demanda): cuenta las competidoras nuevas que el equipo trajo para la referencia y
 * avisa en la campana con «Buscar de nuevo» a un clic.
 */

/** Día del resumen (UTC): lunes. */
export const COMPETITOR_WATCH_DIGEST_WEEKDAY = 1;
/** No se avisa dos veces en menos de esto (el cron es diario y puede repetirse). */
export const COMPETITOR_WATCH_MIN_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;
/** Referencias revisadas por corrida del cron (se reparten en semanas si hay más). */
export const COMPETITOR_WATCH_MAX_PER_RUN = 200;

export const COMPETITOR_WATCH_NOTIFICATION_TYPE = 'competitor_watch_digest';

/** La misma clave para «Vecol» con o sin dominio: el dominio manda. */
export function buildCompetitorWatchKey(reference: { name: string; domain: string | null }): string {
  const domain = reference.domain?.trim().toLowerCase().replace(/^www\./, '');
  if (domain) return `domain:${domain}`;
  return `name:${reference.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

/** ¿Toca resumen hoy para este seguimiento? */
export function isCompetitorWatchDue(lastNotifiedAt: string | null, now: Date): boolean {
  if (now.getUTCDay() !== COMPETITOR_WATCH_DIGEST_WEEKDAY) return false;
  if (!lastNotifiedAt) return true;
  const last = Date.parse(lastNotifiedAt);
  return !Number.isFinite(last) || now.getTime() - last >= COMPETITOR_WATCH_MIN_INTERVAL_MS;
}

/** La notificación de la campana (títulos cortos: dos líneas como mucho). */
export function buildCompetitorWatchNotification(input: {
  referenceName: string;
  newCompetitors: number;
  sourceBatchId: string | null;
}): { title: string; message: string; actionLabel: string | null; actionUrl: string | null } {
  const title = `Competidores de ${input.referenceName}`;
  const message =
    input.newCompetitors > 0
      ? input.newCompetitors === 1
        ? 'El equipo encontró 1 competidora nueva esta semana.'
        : `El equipo encontró ${input.newCompetitors} competidoras nuevas esta semana.`
      : 'Sin competidoras nuevas esta semana. Puedes buscar de nuevo.';
  return {
    title,
    message,
    actionLabel: input.sourceBatchId ? 'Ver búsqueda' : null,
    actionUrl: input.sourceBatchId ? `/prospect-batches/${input.sourceBatchId}` : null,
  };
}

/** Estados que cuentan como competidora nueva (no duplicada ni descartada). */
export const COMPETITOR_WATCH_COUNTED_STATUSES = ['needs_review', 'approved', 'converted'] as const;
