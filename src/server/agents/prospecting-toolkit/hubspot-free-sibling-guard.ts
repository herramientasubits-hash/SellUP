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
 *     negocio abierto;
 *   · el mismo GRUPO en otro país (FEEDBACK 17-11, decisión de la dueña): si un
 *     cliente de HubSpot tiene la misma marca (p. ej. «Falabella México» para
 *     «Falabella Argentina»), la filial no se ofrece. La marca se compara EXACTA
 *     tras quitar país, forma jurídica y palabras genéricas (`hubSpotBrandCore`).
 * Si no se pudo verificar alguna hermana, la ficha NO se marca libre (queda como
 * «ya existe en HubSpot»): ante la duda, no se ofrece.
 *
 * Puro: sin red, sin env.
 */

import type { HubSpotAvailability, HubSpotTakenReason } from '@/server/integrations/hubspot-free-company-policy';
import { normalizeCompanyName } from './normalization';
import type { DuplicateMatch } from './types';

export type HubSpotSiblingRelation = 'same_company' | 'parent' | 'group_client';

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
/** Del mismo grupo en otro país sólo bloquea que sea cliente. */
const GROUP_BLOCKING_REASONS: ReadonlySet<HubSpotTakenReason> = new Set(['customer']);

// ─── Marca del grupo ─────────────────────────────────────────────────────────

/** Países y regiones de dos o más palabras: se quitan como frase antes que palabra a palabra. */
const COUNTRY_PHRASES = ['costa rica', 'el salvador', 'republica dominicana', 'estados unidos', 'puerto rico', 'centro america', 'america latina'];
/** Países, regiones, formas jurídicas y palabras genéricas de razón social. */
const BRAND_NOISE_WORDS: ReadonlySet<string> = new Set([
  // países y regiones
  'argentina', 'bolivia', 'brasil', 'brazil', 'chile', 'colombia', 'ecuador', 'espana', 'guatemala', 'honduras',
  'mexico', 'nicaragua', 'panama', 'paraguay', 'peru', 'uruguay', 'venezuela', 'dominicana', 'usa', 'latam',
  'latinoamerica', 'centroamerica', 'mexicana', 'mexicanas', 'chilena', 'colombiana', 'peruana',
  // formas jurídicas
  'sa', 'sas', 'sac', 'saa', 'spa', 'srl', 'ltda', 'ltd', 'limitada', 'cv', 'rl', 'inc', 'llc', 'plc', 'gmbh',
  'corp', 'corporation', 'corporacion', 'company', 'co', 'cia', 'compania', 'sociedad', 'anonima',
  // genéricas
  'grupo', 'group', 'holding', 'holdings', 'retail', 'global', 'business', 'services', 'servicios',
  'international', 'internacional', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'the', 'and',
]);

/**
 * La marca de una razón social: minúsculas, sin acentos ni signos, sin país, forma
 * jurídica ni palabras genéricas. «Falabella Retail Colombia» y «Falabella Argentina»
 * ⇒ «falabella». `null` si no queda una marca de al menos 3 letras.
 */
export function hubSpotBrandCore(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  let text = ` ${name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')} `;
  for (const phrase of COUNTRY_PHRASES) text = text.split(` ${phrase} `).join(' ');
  const core = text
    .split(' ')
    // Las letras sueltas son restos de «S.A. de C.V.» una vez quitados los puntos.
    .filter((word) => word.length > 1 && !BRAND_NOISE_WORDS.has(word))
    .join(' ');
  return core.replace(/\s/g, '').length >= 3 ? core : null;
}

/** Sufijos de dominio que no son la marca (genéricos y de país). */
const DOMAIN_SUFFIX_LABELS: ReadonlySet<string> = new Set([
  'com', 'net', 'org', 'gob', 'gov', 'edu', 'co', 'io', 'biz', 'info',
  'ar', 'bo', 'br', 'cl', 'cr', 'do', 'ec', 'es', 'gt', 'hn', 'mx', 'ni', 'pa', 'pe', 'py', 'sv', 'us', 'uy', 've',
]);

/** La raíz de un dominio: «falabella.com.co» ⇒ «falabella». */
export function hubSpotDomainRoot(domain: string | null | undefined): string | null {
  const host = cleanHubSpotHost(domain);
  if (!host) return null;
  const labels = host.split('.').filter(Boolean);
  while (labels.length > 1 && DOMAIN_SUFFIX_LABELS.has(labels[labels.length - 1])) labels.pop();
  const root = labels[labels.length - 1];
  return root && root.length >= 3 ? root : null;
}

/**
 * ¿Las dos razones sociales son la misma marca? La marca se compara EXACTA. Una marca
 * de UNA sola palabra («Alfa», «Medical») es demasiado común: además exige la misma
 * raíz de dominio (falabella.com.ar ↔ falabella.com.co). Con dos o más palabras
 * («Zurich Santander») basta la marca.
 */
export function isSameHubSpotBrand(
  a: { name: string | null | undefined; domain?: string | null },
  b: { name: string | null | undefined; domain?: string | null },
): boolean {
  const coreA = hubSpotBrandCore(a.name);
  if (coreA === null || coreA !== hubSpotBrandCore(b.name)) return false;
  if (coreA.includes(' ')) return true;
  const rootA = hubSpotDomainRoot(a.domain);
  return rootA !== null && rootA === hubSpotDomainRoot(b.domain);
}

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
    if (sibling.relation === 'group_client' && !GROUP_BLOCKING_REASONS.has(availability.reason)) continue;
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
  scheduled_activity: 'tiene una actividad de ventas agendada',
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
        : block.relation === 'group_client'
          ? 'El mismo grupo en HubSpot'
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
