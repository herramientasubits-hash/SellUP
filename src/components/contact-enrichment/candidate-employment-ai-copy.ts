/**
 * Textos de «Verificar con IA» (CONTACT-CURRENT-EMPLOYMENT-AI-1). Puro: lo comparten el botón de
 * la ficha y la acción masiva de la tabla.
 */

import type { VerifyEmploymentWithAiStatus } from '@/modules/contact-enrichment/current-employment-ai-runner';

/** La web no aportó nada nuevo y queda lo que ya había dicho Apollo (caso Marisel 17-11). */
export const EMPLOYMENT_AI_KEPT_PREVIOUS_MESSAGE = {
  tone: 'info' as const,
  text: 'La web no aportó nada nuevo: se mantiene lo que dijo Apollo.',
};

/** Máximo de contactos por tanda desde la barra de la tabla. */
export const EMPLOYMENT_AI_MAX_CONTACTS = 25;

export type EmploymentAiMessageTone = 'success' | 'warning' | 'info' | 'error';

export function employmentAiResultMessage(status: VerifyEmploymentWithAiStatus): { tone: EmploymentAiMessageTone; text: string } {
  switch (status) {
    case 'confirmed':
      return { tone: 'success', text: 'La web confirma que sigue en la empresa con ese cargo.' };
    case 'title_changed':
      return { tone: 'success', text: 'Sigue en la empresa con otro cargo: se actualizó.' };
    case 'other_company':
    case 'no_current_role':
      return { tone: 'warning', text: 'Según la web, ya no está en la empresa. Revisa el aviso antes de contactar.' };
    case 'unknown':
      return { tone: 'info', text: 'No se pudo confirmar con la web: confírmalo en LinkedIn.' };
    case 'missing_name_or_company':
      return { tone: 'error', text: 'Falta el nombre o la empresa del contacto para buscarlo.' };
    case 'claude_not_configured':
      return { tone: 'error', text: 'La IA no está configurada (Configuración → IA).' };
    case 'claude_quota_exhausted':
      return { tone: 'error', text: 'Se agotó el presupuesto de Claude de este mes.' };
    case 'candidate_not_found':
      return { tone: 'error', text: 'No se encontró el contacto.' };
    default:
      return { tone: 'error', text: 'No se pudo verificar ahora. Inténtalo de nuevo en unos minutos.' };
  }
}

export interface EmploymentAiBulkTally {
  confirmed: number;
  updated: number;
  left: number;
  unverified: number;
  failed: number;
}

export const EMPTY_EMPLOYMENT_AI_TALLY: EmploymentAiBulkTally = { confirmed: 0, updated: 0, left: 0, unverified: 0, failed: 0 };

export function addToEmploymentAiTally(tally: EmploymentAiBulkTally, status: VerifyEmploymentWithAiStatus): EmploymentAiBulkTally {
  switch (status) {
    case 'confirmed':
      return { ...tally, confirmed: tally.confirmed + 1 };
    case 'title_changed':
      return { ...tally, updated: tally.updated + 1 };
    case 'other_company':
    case 'no_current_role':
      return { ...tally, left: tally.left + 1 };
    case 'unknown':
      return { ...tally, unverified: tally.unverified + 1 };
    default:
      return { ...tally, failed: tally.failed + 1 };
  }
}

/** «12 verificados: 7 confirmados, 2 con otro cargo, 1 ya no está, 2 sin información». */
export function employmentAiBulkSummary(tally: EmploymentAiBulkTally): string {
  const parts = [
    tally.confirmed ? `${tally.confirmed} confirmado${tally.confirmed === 1 ? '' : 's'}` : null,
    tally.updated ? `${tally.updated} con otro cargo` : null,
    tally.left ? `${tally.left} ya no está${tally.left === 1 ? '' : 'n'}` : null,
    tally.unverified ? `${tally.unverified} sin información` : null,
    tally.failed ? `${tally.failed} con error` : null,
  ].filter(Boolean);
  const total = tally.confirmed + tally.updated + tally.left + tally.unverified + tally.failed;
  return `${total} verificado${total === 1 ? '' : 's'} con IA: ${parts.join(', ') || 'sin resultados'}.`;
}

/** Un fallo que no se arregla reintentando con el siguiente contacto: se detiene la tanda. */
export function employmentAiStopsBulk(status: VerifyEmploymentWithAiStatus): boolean {
  return status === 'claude_not_configured' || status === 'claude_quota_exhausted';
}
