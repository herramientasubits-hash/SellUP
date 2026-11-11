// ============================================================
// «Tu trabajo terminó» (dueña 11-11) — el aviso cuando termina un trabajo
// largo en segundo plano: una búsqueda de empresas o de contactos (puro).
// ============================================================

/** Menos que esto: la persona seguía mirando la pantalla, no hace falta avisar. */
export const RUN_FINISHED_MIN_SECONDS = 45;

export type FinishedRunKind = 'company_search' | 'contact_search' | 'other';

export function runKindFor(agentKey: string | null | undefined): FinishedRunKind {
  const key = (agentKey ?? '').toLowerCase();
  if (key.includes('contact_enrichment') || key === 'agent2a') return 'contact_search';
  if (key === 'prospect_generation' || key === 'agent1' || key === 'candidate_enrichment') return 'company_search';
  return 'other';
}

export interface RunFinishedInput {
  kind: FinishedRunKind;
  status: 'completed' | 'failed';
  batchName: string | null;
  batchId: string | null;
  pendingReview: number | null;
  resultsGenerated: number | null;
  errorMessage: string | null;
}

export interface RunFinishedNotification {
  title: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
}

/** `null` = no se avisa (un tipo de trabajo que no tiene aviso). */
export function buildRunFinishedNotification(input: RunFinishedInput): RunFinishedNotification | null {
  if (input.kind === 'other') return null;
  const failed = input.status === 'failed';
  const error = input.errorMessage?.replace(/\s+/g, ' ').trim().slice(0, 200) || null;

  if (input.kind === 'company_search') {
    const name = input.batchName ? `«${input.batchName}»` : 'de empresas';
    const actionUrl = input.batchId ? `/accounts?tab=busquedas&focus=${encodeURIComponent(input.batchId)}` : '/accounts?tab=busquedas';
    if (failed) {
      return { title: `Tu búsqueda ${name} falló`, message: error ? `Motivo: ${error}` : 'Revísala en Búsquedas.', actionLabel: 'Ver búsqueda', actionUrl };
    }
    const n = input.pendingReview ?? input.resultsGenerated ?? 0;
    return {
      title: `Tu búsqueda ${name} terminó`,
      message: n > 0 ? `Dejó ${n} ${n === 1 ? 'empresa' : 'empresas'} por revisar.` : 'No dejó empresas nuevas por revisar.',
      actionLabel: n > 0 ? 'Ver por revisar' : 'Ver búsqueda',
      actionUrl: n > 0 ? '/accounts?tab=prospectos' : actionUrl,
    };
  }

  const actionUrl = '/contacts?tab=candidates';
  if (failed) {
    return { title: 'Tu búsqueda de contactos falló', message: error ? `Motivo: ${error}` : 'Revísala en Contactos › Por revisar.', actionLabel: 'Ver contactos', actionUrl };
  }
  const n = input.resultsGenerated ?? 0;
  return {
    title: 'Tu búsqueda de contactos terminó',
    message: n > 0 ? `Encontró ${n} ${n === 1 ? 'contacto' : 'contactos'} para revisar.` : 'No encontró contactos nuevos.',
    actionLabel: 'Ver por revisar',
    actionUrl,
  };
}

/** ¿Duró lo suficiente como para que valga un aviso? */
export function ranLongEnough(startedAt: string | null, finishedAt: string | null): boolean {
  if (!startedAt || !finishedAt) return true;
  const seconds = (Date.parse(finishedAt) - Date.parse(startedAt)) / 1000;
  return !Number.isFinite(seconds) || seconds >= RUN_FINISHED_MIN_SECONDS;
}
