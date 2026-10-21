/**
 * Agente 1 · Búsqueda en árbol — el lote agrupado por rama (puro).
 */

import {
  corporateTreeGroupSentence,
  type CorporateTreeGroupSignal,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-group-signal';
import { describeCorporateTreeItemStatus } from './corporate-tree-associations';
import {
  CORPORATE_TREE_METADATA_KEY,
  CORPORATE_TREE_RELATION_LABELS,
  CORPORATE_TREE_RELATION_ORDER,
  isCorporateTreeRelation,
  normalizeTreeName,
  readCorporateTreeRelation,
  type CorporateTreeRelation,
} from './corporate-tree-types';

/** Una asociación guardada del lote (`agent1_company_relationships`). */
export type CorporateTreeBatchRelationship = {
  related_candidate_id: string | null;
  related_name: string;
  related_country_code: string | null;
  /** Sin empresa en el lote: la web del grupo que usa (ge.com), si sólo se conoce esa. */
  related_domain?: string | null;
  /** Ya estaba en HubSpot (por su nombre): no fue al rescate. */
  matched_hubspot_company_id?: string | null;
  /** Motivo con que quedó en «Descartadas», si quedó ahí. */
  discard_reason_code?: string | null;
  /** Lo que decidió el rescate con ella (p. ej. `duplicate`: le encontró la web y ya existía). */
  rescue_decision?: string | null;
  /** El rescate NO buscó su web, y por qué (`known_tax_id`: otra candidata ya tiene su número fiscal). */
  rescue_skipped?: string | null;
  /** La web de la empresa de partida (para distinguir la web del grupo de una propia). */
  root_domain?: string | null;
  /** Tiene web propia (no la del grupo) y aun así no entró al lote. */
  own_website?: boolean;
  /** Su web propia ya está en otra búsqueda o en una cuenta de SellUp. */
  known_in_sellup?: boolean;
  /** Por qué el escritor no la escribió (motivo crudo, de `corporate_tree.not_written`). */
  not_written_reason?: string | null;
  relation_type: string;
  relation_detail: string | null;
  evidence_url: string | null;
};

/** Lo que todavía espera su web en «Descartadas» (el rescate la busca). */
export const CORPORATE_TREE_WAITING_WEBSITE_LABEL = 'En Descartadas: sin web';
/** Sólo se conoce la web del grupo: queda como referencia, sin rescate. */
export const CORPORATE_TREE_GROUP_WEBSITE_LABEL = 'Referencia: usa la web del grupo';
/** En «Descartadas» porque HubSpot tiene un nombre parecido en su país (sin rescate). */
export const CORPORATE_TREE_POSSIBLE_HUBSPOT_LABEL = 'En Descartadas: posible duplicado en HubSpot';
export const CORPORATE_TREE_POSSIBLE_HUBSPOT_REASON = 'corporate_tree_possible_hubspot_duplicate';
/**
 * El control de «¿esta web es de esta empresa?» la rechazó: queda en «Descartadas» con su
 * web para enviarla a revisión a mano (Prod 15-10: «Walmart de México y Centroamérica»,
 * walmex.mx). No va al rescate: no se paga nada.
 */
export const CORPORATE_TREE_OWNERSHIP_REJECTED_REASON = 'corporate_tree_ownership_rejected';
export const CORPORATE_TREE_OWNERSHIP_REJECTED_LABEL = 'En Descartadas: revisa si la web es suya';
export const CORPORATE_TREE_KNOWN_IN_SELLUP_LABEL = 'Ya en SellUp (otra búsqueda o cuenta)';
/** El rescate le encontró su web y ya existía en SellUp o HubSpot. */
export const CORPORATE_TREE_RESCUE_DUPLICATE_LABEL = 'Ya existía (el rescate encontró su web)';
/** Otra candidata viva ya tiene su número fiscal: el rescate no pagó la búsqueda de su web. */
export const CORPORATE_TREE_KNOWN_TAX_ID_LABEL = 'Ya en SellUp (mismo número fiscal)';
/** Una empresa que el escritor común no escribió, con su motivo (metadata del lote). */
export type CorporateTreeNotWritten = { name: string; countryCode: string; domain: string | null; reason: string };

/**
 * El motivo del escritor en palabras de la dueña. Prod 15-10: Purina (Nestlé) o HSBC Bank
 * USA salían como «ya existía o no pasó las revisiones» sin saber cuál de las dos.
 */
export function corporateTreeNotWrittenLabel(reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim();
  if (!r) return null;
  if (/duplicate|identity|seen_identity_key/.test(r)) return 'No entró: ya está en otra búsqueda o cuenta (misma web o número fiscal)';
  if (/country/.test(r)) return 'No entró: su país no coincide';
  if (/non_official_source_domain|ownership|source_url|content_page|non_company_phrase|generic_service_title|external_platform/.test(r)) {
    return 'No entró: la web no parece ser de esa empresa';
  }
  if (/icp|size|employee/.test(r)) return 'No entró: por su tamaño';
  if (/evidence_policy|qualityLabel|business_fit/.test(r)) return 'No entró: no pasó la revisión de calidad';
  if (/persistence_failed/.test(r)) return 'No entró: error al guardar';
  return `No entró: ${r}`;
}

/** Con web propia, no entró y no está en SellUp: HubSpot ya la tenía o no pasó las revisiones. */
export const CORPORATE_TREE_NOT_WRITTEN_LABEL = 'No entró: ya existía o no pasó las revisiones';

/**
 * Webs PROPIAS de las empresas que no entraron al lote: ni la de la empresa de partida
 * (salvo para ella misma) ni una que comparten dos o más filas (ésas son del grupo).
 */
export function isOwnWebsiteRow(
  rel: CorporateTreeBatchRelationship,
  all: readonly CorporateTreeBatchRelationship[],
): boolean {
  if (rel.related_candidate_id || !rel.related_domain || rel.discard_reason_code || rel.matched_hubspot_company_id) return false;
  if (rel.relation_type === 'root') return true;
  const uses = all.filter((other) => other.related_domain === rel.related_domain).length;
  return rel.related_domain !== rel.root_domain && uses === 1;
}

export function ownDomainsWithoutCandidate(relationships: readonly CorporateTreeBatchRelationship[]): string[] {
  return [
    ...new Set(relationships.filter((rel) => isOwnWebsiteRow(rel, relationships)).map((rel) => rel.related_domain as string)),
  ];
}

export type CorporateTreeBatchCandidateInput = {
  id: string;
  name: string;
  country_code: string | null;
  status: string;
  matched_hubspot_company_id: string | null;
  metadata: Record<string, unknown> | null;
};

export type CorporateTreeBatchItem = {
  id: string;
  name: string;
  countryCode: string | null;
  statusLabel: string;
  statusTone: 'brand' | 'neutral' | 'warning' | 'positive' | 'info';
  /** `null` = no entró al lote (sigue en «Descartadas» esperando su web). */
  candidateId: string | null;
  relationDetail: string | null;
  evidenceUrl: string | null;
  groupWebsite: string | null;
  /** Web no comprobada (el sitio bloquea la descarga). */
  websiteUnverified?: boolean;
  /** Filial y web según Apollo (filiales de la empresa de partida). */
  foundInApollo?: boolean;
};

export type CorporateTreeBatchGroup = {
  relation: CorporateTreeRelation;
  label: string;
  items: CorporateTreeBatchItem[];
};

export type CorporateTreeBatchSummary = {
  rootName: string;
  branches: string[];
  countryCodes: string[];
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** El resumen del árbol en `prospect_batches.metadata.corporate_tree`; `null` si el lote no es de árbol. */
export function readCorporateTreeBatchSummary(metadata: unknown): CorporateTreeBatchSummary | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const tree = (metadata as Record<string, unknown>)[CORPORATE_TREE_METADATA_KEY];
  if (!tree || typeof tree !== 'object') return null;
  const record = tree as Record<string, unknown>;
  const rootName = str(record.root_name);
  if (!rootName) return null;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
  return { rootName, branches: list(record.branches), countryCodes: list(record.country_codes) };
}

function toneFor(label: string): CorporateTreeBatchItem['statusTone'] {
  switch (label) {
    case 'Por revisar':
      return 'brand';
    case 'Aprobada':
      return 'positive';
    case 'Ya en HubSpot':
    case 'Ya en SellUp':
      return 'info';
    case 'Descartada':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function groupBatchCandidatesByTreeRelation(
  candidates: readonly CorporateTreeBatchCandidateInput[],
  relationships: readonly CorporateTreeBatchRelationship[] = [],
): CorporateTreeBatchGroup[] {
  const keyOf = (name: string, countryCode: string | null) => `${normalizeTreeName(name)}|${countryCode ?? ''}`;
  // Las asociaciones dicen la rama aunque la empresa haya entrado después (el rescate
  // la trajo desde «Descartadas» con otra fila) o todavía no haya entrado.
  const relationById = new Map<string, CorporateTreeBatchRelationship>();
  const relationByKey = new Map<string, CorporateTreeBatchRelationship>();
  for (const rel of relationships) {
    if (!isCorporateTreeRelation(rel.relation_type)) continue;
    if (rel.related_candidate_id) relationById.set(rel.related_candidate_id, rel);
    relationByKey.set(keyOf(rel.related_name, rel.related_country_code), rel);
  }

  const byRelation = new Map<CorporateTreeRelation, CorporateTreeBatchItem[]>();
  const add = (relation: CorporateTreeRelation, item: CorporateTreeBatchItem) =>
    byRelation.set(relation, [...(byRelation.get(relation) ?? []), item]);
  const usedRelationships = new Set<CorporateTreeBatchRelationship>();

  for (const candidate of candidates) {
    const rel = relationById.get(candidate.id) ?? relationByKey.get(keyOf(candidate.name, candidate.country_code)) ?? null;
    const relation = readCorporateTreeRelation(candidate.metadata) ?? (rel ? (rel.relation_type as CorporateTreeRelation) : null);
    if (!relation) continue;
    if (rel) usedRelationships.add(rel);
    const tree = (candidate.metadata?.[CORPORATE_TREE_METADATA_KEY] ?? {}) as Record<string, unknown>;
    const statusLabel = describeCorporateTreeItemStatus({
      status: candidate.status,
      hubspotCompanyId: candidate.matched_hubspot_company_id,
    });
    add(relation, {
      id: candidate.id,
      candidateId: candidate.id,
      name: candidate.name,
      countryCode: candidate.country_code,
      statusLabel,
      statusTone: toneFor(statusLabel),
      relationDetail: str(tree.relation_detail) ?? rel?.relation_detail ?? null,
      evidenceUrl: str(tree.evidence_url) ?? rel?.evidence_url ?? null,
      // La del árbol, o la que dejó el rescate al admitir una filial sin web propia.
      groupWebsite:
        str(tree.group_website) ??
        str(((candidate.metadata?.['parent_group_website'] ?? {}) as Record<string, unknown>).website),
      ...(tree.website_unverified === true ? { websiteUnverified: true } : {}),
      ...(tree.found_in_apollo === true ? { foundInApollo: true } : {}),
    });
  }

  for (const rel of relationships) {
    if (usedRelationships.has(rel) || !isCorporateTreeRelation(rel.relation_type)) continue;
    if (rel.related_candidate_id && candidates.some((c) => c.id === rel.related_candidate_id)) continue;
    add(rel.relation_type, {
      id: `rel:${keyOf(rel.related_name, rel.related_country_code)}`,
      candidateId: null,
      name: rel.related_name,
      countryCode: rel.related_country_code,
      statusLabel: rel.matched_hubspot_company_id
        ? 'Ya en HubSpot'
        : rel.known_in_sellup
          ? CORPORATE_TREE_KNOWN_IN_SELLUP_LABEL
          : rel.own_website
            ? (corporateTreeNotWrittenLabel(rel.not_written_reason) ?? CORPORATE_TREE_NOT_WRITTEN_LABEL)
            : rel.rescue_decision === 'duplicate' && rel.rescue_skipped === 'known_tax_id'
              ? CORPORATE_TREE_KNOWN_TAX_ID_LABEL
              : rel.rescue_decision === 'duplicate'
              ? CORPORATE_TREE_RESCUE_DUPLICATE_LABEL
              : rel.discard_reason_code === CORPORATE_TREE_OWNERSHIP_REJECTED_REASON
              ? CORPORATE_TREE_OWNERSHIP_REJECTED_LABEL
              : rel.discard_reason_code === CORPORATE_TREE_POSSIBLE_HUBSPOT_REASON
          ? CORPORATE_TREE_POSSIBLE_HUBSPOT_LABEL
          : rel.related_domain
            ? CORPORATE_TREE_GROUP_WEBSITE_LABEL
            : CORPORATE_TREE_WAITING_WEBSITE_LABEL,
      statusTone: rel.discard_reason_code === CORPORATE_TREE_POSSIBLE_HUBSPOT_REASON
        ? 'warning'
        : rel.matched_hubspot_company_id || rel.related_domain
          ? 'info'
          : 'neutral',
      relationDetail: rel.relation_detail,
      evidenceUrl: rel.evidence_url,
      groupWebsite: rel.related_domain && !rel.own_website ? `https://${rel.related_domain}` : null,
    });
  }

  return CORPORATE_TREE_RELATION_ORDER.filter((relation) => byRelation.has(relation)).map((relation) => ({
    relation,
    label: CORPORATE_TREE_RELATION_LABELS[relation],
    items: [...(byRelation.get(relation) ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }));
}

/** Lo que no entró a «Por revisar» al terminar la corrida. */
export type CorporateTreePending = {
  waitingWebsite: number;
  groupReferences: number;
  alreadyKnown?: number;
  possibleKnown?: number;
  /** Se reutilizó el árbol guardado del grupo (menos de 30 días): la búsqueda no se pagó. */
  reusedSavedTree?: boolean;
  /** FASE D: si el grupo ya es cliente de UBITS o lo trabaja alguien. */
  groupSignal?: CorporateTreeGroupSignal | null;
};

/**
 * Qué pasó con lo que no entró a «Por revisar», sin inventar causas (Prod 14-10,
 * General Electric: el aviso decía «ya estaban en HubSpot» y 9 esperaban su web).
 */
export function corporateTreePendingSummary(pending: CorporateTreePending | null): string {
  if (!pending) return 'Abre el lote para ver cada rama y en qué quedó cada empresa.';
  const parts: string[] = [];
  if (pending.waitingWebsite > 0) {
    parts.push(
      `${pending.waitingWebsite} ${pending.waitingWebsite === 1 ? 'espera' : 'esperan'} su web en «Descartadas»`,
    );
  }
  if (pending.groupReferences > 0) {
    parts.push(
      `${pending.groupReferences} ${pending.groupReferences === 1 ? 'queda' : 'quedan'} como referencia (web del grupo)`,
    );
  }
  if ((pending.alreadyKnown ?? 0) > 0) {
    parts.push(`${pending.alreadyKnown} ya ${pending.alreadyKnown === 1 ? 'estaba' : 'estaban'} en HubSpot`);
  }
  if ((pending.possibleKnown ?? 0) > 0) {
    parts.push(
      `${pending.possibleKnown} ${pending.possibleKnown === 1 ? 'parece' : 'parecen'} ya estar en HubSpot (en «Descartadas», sin rescate)`,
    );
  }
  const notes = [
    corporateTreeGroupSentence(pending.groupSignal ?? null),
    pending.reusedSavedTree ? 'Usé el árbol guardado de este grupo: no se volvió a pagar la búsqueda del grupo.' : '',
    rescueCostNote(pending.waitingWebsite),
  ]
    .filter(Boolean)
    .map((note) => ` ${note}`)
    .join('');
  if (parts.length === 0) return `Las demás ya estaban en HubSpot o en SellUp.${notes}`;
  const sentence = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0];
  return `${sentence}.`.replace(/^./, (c) => c.toUpperCase()) + notes;
}

/**
 * Lo que cuesta, en promedio, que el rescate le busque la web a una empresa (Prod 14/15-10:
 * 229 búsquedas, US$8,74 ⇒ ~US$0,04). El aviso sale ANTES del rescate, así que se dice el tope
 * estimado, no el gasto real (ése queda en «Uso de IA» con el lote).
 */
export const CORPORATE_TREE_RESCUE_SEARCH_ESTIMATE_USD = 0.04;

/** «Buscarles la web cuesta hasta ~US$0,16…»: el costo del rescate, que el aviso no puede saber todavía. */
export function rescueCostNote(waitingWebsite: number): string {
  if (waitingWebsite <= 0) return '';
  const usd = (waitingWebsite * CORPORATE_TREE_RESCUE_SEARCH_ESTIMATE_USD).toFixed(2).replace('.', ',');
  return `Buscar su web cuesta hasta ~US$${usd}; no se vuelve a pagar la de una empresa ya buscada sin éxito en los últimos 30 días.`;
}
