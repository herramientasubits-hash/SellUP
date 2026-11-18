/**
 * «Traer» un contacto de HubSpot — el aviso (AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE).
 * Puro: lo usan todas las pantallas que traen un contacto.
 */
import type { ImportHubSpotContactResult } from './types';

export const OPEN_IMPORTED_CONTACT_LABEL = 'Abrir contacto';

/** Segunda línea del aviso: si salió de «Por revisar» y lo que le falta (para revelarlo en su ficha). */
export function importedContactToastDescription(
  res: Extract<ImportHubSpotContactResult, { success: true }>,
): string | undefined {
  const lines: string[] = [];
  if (res.approvedFromReview) lines.push('Estaba en «Por revisar»: quedó aprobado.');
  if (res.missing) lines.push(`Le faltan: ${res.missing}. Ábrelo para revelarlos.`);
  return lines.length > 0 ? lines.join(' ') : undefined;
}
