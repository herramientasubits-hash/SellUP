/**
 * ¿La pantalla final del asistente es la ruta Lusha («Buscar con IA»)?
 *
 * Puro: sin React ni acciones de servidor, para poder probarlo sin montar la
 * pantalla. `wizard-conversation-summary.tsx` lo usa tal cual y le pasa el
 * predicado de siempre (`isLushaRouteHonored(lushaCriteria.provider)`) ya
 * evaluado, para que la pregunta por Lusha siga viviendo en la pantalla.
 *
 * AGENT1-SEARCH-AUDIT-1 — «Competidores de una empresa» nunca usa Lusha (decisión
 * de la dueña 15-10). Sin el término del modo, con el modo automático apagado y
 * la vista previa de Lusha encendida, una búsqueda de competidores con país ×
 * macro aptos para Lusha montaba el panel de Lusha, ocultaba «Generar prospectos»
 * y su CTA corría una búsqueda por INDUSTRIA, gastando créditos de Lusha.
 * «Proveedores» y «Árbol» no pasan por esta pantalla (panel y flujo propios).
 */

import type { ProspectSearchMode } from '@/modules/prospect-batches/chat-wizard/wizard-types';

export type WizardLushaFinalRouteInput = {
  searchMode: ProspectSearchMode | null | undefined;
  /** AGENT1-AUTO-PROVIDER-CASCADE-1 — en automático Lusha corre como respaldo, no como ruta aparte. */
  autoProviderCascade: boolean;
  lushaPreviewEnabled: boolean;
  /** `isLushaRouteHonored(lushaCriteria.provider)`. */
  lushaRouteHonored: boolean;
  hasLushaInput: boolean;
};

export function isWizardLushaFinalRouteInEffect(input: WizardLushaFinalRouteInput): boolean {
  if (input.searchMode === 'competitors') return false;
  return !input.autoProviderCascade && input.lushaPreviewEnabled && input.lushaRouteHonored && input.hasLushaInput;
}
