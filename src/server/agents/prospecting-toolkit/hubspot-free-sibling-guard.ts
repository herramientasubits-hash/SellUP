/**
 * hubspot-free-sibling-guard.ts — una ficha LIBRE de HubSpot no basta: la misma
 * empresa puede tener OTRA ficha que ya es cliente.
 *
 * FEEDBACK 17-11 («SellUp está trayendo de HubSpot empresas que ya son clientes»).
 * En el portal de UBITS una misma empresa suele tener varias fichas: la del cliente, a
 * nombre de un KAM, y una copia vieja reciclada o en la bolsa del país. La regla de
 * «libre» (`classifyHubSpotCompanyAvailability`) juzgaba cada ficha SOLA, y el
 * verificador de duplicados dejaba de buscar por nombre en cuanto el dominio
 * coincidía; así se ofrecía la copia vieja de un cliente.
 *
 * Antes de marcar libre una ficha se miran sus «hermanas»:
 *   · la MISMA empresa (nombre normalizado exacto o mismo dominio) en otra ficha:
 *     bloquea si esa ficha no está libre (cliente, negocio abierto, actividad
 *     reciente, dueño activo o dueño desconocido);
 *   · la empresa MADRE (`hs_parent_company_id`): bloquea si es cliente o tiene un
 *     negocio abierto.
 * Si no se pudo verificar alguna hermana, la ficha NO se marca libre (queda como
 * «ya existe en HubSpot»): ante la duda, no se ofrece.
 *
 * Puro: sin red, sin env.
 */

import type { HubSpotAvailability, HubSpotTakenReason } from '@/server/integrations/hubspot-free-company-policy';
import { normalizeCompanyName } from './normalization';
import type { DuplicateMatch } from './types';

export type HubSpotSiblingRelation = 'same_company' | 'parent';

export type HubSpotSiblingVerdict = {
  id: string;
  name: string | null;
  relation: HubSpotSiblingRelation;
  /** `null` = no se pudo leer o evaluar la ficha. */
  availability: HubSpotAvailability | null;
};

export type HubSpotSiblingBlock =
  | { kind: 'taken'; id: string; name: string | null; relation: HubSpotSiblingRelation; reason: HubSpotTakenReason }
  | { kind: 'unverified'; id: string | null; name: string | null; relation: HubSpotSiblingRelation | null };

/** Lo que bloquea a una empresa madre: que sea cliente o tenga un negocio abierto. */
const PARENT_BLOCKING_REASONS: ReadonlySet<HubSpotTakenReason> = new Set(['customer', 'open_deal']);

export function cleanHubSpotHost(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
  return host.length > 0 ? host : null;
}

/**
 * ¿Esta ficha es la MISMA empresa? Nombre normalizado exacto o mismo dominio (o el
 * sitio web apunta al mismo dominio). Un nombre sólo parecido NO cuenta: «Corona» no
 * es «Cervecería Corona».
 */
export function isSameCompanyHubSpotRecord(
  record: { name: string | null; domain: string | null; website: string | null },
  target: { names: readonly (string | null | undefined)[]; domain: string | null },
): boolean {
  const targetDomain = cleanHubSpotHost(target.domain);
  if (targetDomain) {
    if (cleanHubSpotHost(record.domain) === targetDomain) return true;
    if (cleanHubSpotHost(record.website) === targetDomain) return true;
  }
  if (!record.name) return false;
  const recordName = normalizeCompanyName(record.name);
  if (recordName.length < 3) return false;
  return target.names.some(
    (name) => typeof name === 'string' && name.trim() !== '' && normalizeCompanyName(name) === recordName,
  );
}

/** La primera hermana que impide ofrecer la ficha libre, o `null` si ninguna lo impide. */
export function findBlockingHubSpotSibling(siblings: readonly HubSpotSiblingVerdict[]): HubSpotSiblingBlock | null {
  // Primero lo que se SABE que bloquea (la razón es más útil que «no verificada»).
  for (const sibling of siblings) {
    const availability = sibling.availability;
    if (!availability || availability.free) continue;
    if (sibling.relation === 'parent' && !PARENT_BLOCKING_REASONS.has(availability.reason)) continue;
    return { kind: 'taken', id: sibling.id, name: sibling.name, relation: sibling.relation, reason: availability.reason };
  }
  const unverified = siblings.find((sibling) => sibling.availability === null);
  if (unverified) {
    return { kind: 'unverified', id: unverified.id, name: unverified.name, relation: unverified.relation };
  }
  return null;
}

const TAKEN_REASON_LABEL: Readonly<Record<HubSpotTakenReason, string>> = {
  customer: 'es cliente',
  open_deal: 'tiene un negocio abierto',
  recent_sales_activity: 'tuvo actividad de ventas en los últimos 30 días',
  active_owner: 'está a nombre de un vendedor activo',
  unknown_owner: 'tiene un dueño que no se pudo identificar',
};

/** Texto del motivo: «Otra ficha de la misma empresa en HubSpot es cliente». */
export function describeHubSpotSiblingBlock(block: HubSpotSiblingBlock): string {
  const who =
    block.relation === 'parent'
      ? 'La empresa madre en HubSpot'
      : block.relation === 'same_company'
        ? 'Otra ficha de la misma empresa en HubSpot'
        : 'Una ficha relacionada en HubSpot';
  const named = block.name ? ` («${block.name}»)` : '';
  if (block.kind === 'unverified') {
    return `${who}${named} no se pudo verificar: no se ofrece como libre`;
  }
  return `${who}${named} ${TAKEN_REASON_LABEL[block.reason]}`;
}

/**
 * La coincidencia que deja constancia del bloqueo. Va como `existing_in_hubspot`
 * para que el resultado lea «ya existe en HubSpot» y nadie lo ofrezca.
 */
export function buildHubSpotSiblingBlockMatch(block: HubSpotSiblingBlock, freeCompanyId: string): DuplicateMatch {
  return {
    source: 'hubspot',
    status: 'existing_in_hubspot',
    confidence: 82,
    matchedId: block.id ?? freeCompanyId,
    matchedName: block.name,
    reason: describeHubSpotSiblingBlock(block),
    raw: {
      id: block.id ?? freeCompanyId,
      blocks_free_company_id: freeCompanyId,
      sibling_relation: block.relation,
      sibling_block: block.kind === 'taken' ? block.reason : 'unverified',
    },
  };
}
