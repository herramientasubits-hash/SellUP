/**
 * El avance de una búsqueda de contactos con Rumbo, por ETAPAS reales (puro).
 *
 * Dueña 20-10: «falta el loader que usamos en otras búsquedas, con el progreso y el texto
 * que dice qué está haciendo Rumbo». Igual que en la búsqueda de empresas, la barra sube
 * cuando el servidor deja constancia de una etapa nueva, nunca por tiempo:
 *  - sin intentos todavía: revisa los contactos que ya existen;
 *  - intento 1 (Apollo) en curso;
 *  - intento 2 (Lusha) en curso, si Apollo no alcanzó;
 *  - todos los intentos cerrados: terminó.
 * Las etapas salen de `contact_enrichment_runs` (un intento por proveedor, con su orden).
 */

export const CONTACT_SEARCH_PROGRESS_POLL_MS = 3_000;

export type ContactSearchStage = 'checking' | 'apollo' | 'lusha' | 'done';

export interface ContactSearchAttemptRow {
  attemptOrder: number | null;
  provider: string | null;
  status: string;
}

export interface ContactSearchProgress {
  stage: ContactSearchStage;
  label: string;
  percent: number;
  /** Candidatos que la búsqueda ya dejó para revisar. */
  found: number;
  done: boolean;
}

/** Estados en los que un intento ya no sigue. */
const FINISHED_ATTEMPT = new Set(['ready_for_review', 'completed', 'failed']);

const STAGE_LABEL: Readonly<Record<ContactSearchStage, string>> = {
  checking: 'Revisando los contactos que ya existen',
  apollo: 'Buscando perfiles en Apollo',
  lusha: 'Completando la búsqueda con Lusha',
  done: 'Guardando los contactos para revisar',
};

const STAGE_PERCENT: Readonly<Record<ContactSearchStage, number>> = {
  checking: 15,
  apollo: 45,
  lusha: 75,
  done: 100,
};

export const CONTACT_SEARCH_FALLBACK_PROGRESS: ContactSearchProgress = {
  stage: 'checking',
  label: STAGE_LABEL.checking,
  percent: STAGE_PERCENT.checking,
  found: 0,
  done: false,
};

/** La etapa a partir de los intentos de la búsqueda y lo que ya dejaron para revisar. */
export function contactSearchProgress(attempts: readonly ContactSearchAttemptRow[], found: number): ContactSearchProgress {
  const ordered = [...attempts].sort((a, b) => (a.attemptOrder ?? 0) - (b.attemptOrder ?? 0));
  const open = ordered.find((a) => !FINISHED_ATTEMPT.has(a.status));
  const stage: ContactSearchStage =
    ordered.length === 0 ? 'checking' : open ? (open.provider === 'lusha' || (open.attemptOrder ?? 1) >= 2 ? 'lusha' : 'apollo') : 'done';
  return { stage, label: STAGE_LABEL[stage], percent: STAGE_PERCENT[stage], found, done: stage === 'done' };
}

/** La barra no retrocede: si una lectura llega atrasada, se queda la que ya se mostró. */
export function nextContactSearchPercent(previous: number, next: ContactSearchProgress): number {
  return Math.max(previous, next.percent);
}

export function contactSearchProgressPath(requestId: string): string {
  return `/api/contact-enrichment/requests/${encodeURIComponent(requestId)}/progress`;
}

export function contactSearchRunPath(requestId: string): string {
  return `/api/contact-enrichment/requests/${encodeURIComponent(requestId)}/search`;
}
