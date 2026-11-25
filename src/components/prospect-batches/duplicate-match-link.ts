// Enlace de cada coincidencia de «Coincidencias encontradas» (pestaña Validación):
// HubSpot → la ficha de la empresa; SellUp → la empresa de SellUp. Sin el enlace
// no había forma de saber CUÁL de las fichas con el mismo nombre era (caso Sportium
// 25-11: tres «Sportium» en HubSpot — México, España y Colombia).

import { hubspotCompanyUrl } from '@/components/contact-enrichment/hubspot-company-url';
import type { DuplicateMatch } from '@/modules/prospect-batches/types';

export interface DuplicateMatchLink {
  href: string;
  label: string;
  external: boolean;
}

/**
 * `matchedAccountId`: la empresa de SellUp con la que coincidió el candidato. Una
 * coincidencia de SellUp puede guardar el id de una cuenta O de otro candidato; sólo
 * se enlaza cuando es esa cuenta (un id de candidato no abre ninguna página).
 */
export function duplicateMatchLink(
  match: Pick<DuplicateMatch, 'source' | 'matched_id'>,
  matchedAccountId: string | null | undefined,
): DuplicateMatchLink | null {
  const id = match.matched_id?.trim();
  if (!id) return null;

  if (match.source === 'hubspot') {
    return { href: hubspotCompanyUrl(id, null), label: 'Ver en HubSpot', external: true };
  }
  if (match.source === 'sellup' && matchedAccountId && id === matchedAccountId) {
    return { href: `/accounts/${encodeURIComponent(id)}`, label: 'Ver empresa en SellUp', external: false };
  }
  return null;
}
