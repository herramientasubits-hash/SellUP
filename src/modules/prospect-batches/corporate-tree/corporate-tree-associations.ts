/**
 * Agente 1 · Búsqueda en árbol — cómo se ve el árbol de una empresa en la ficha
 * (puro; compartido entre la ruta y la pestaña «Asociaciones»).
 */

import {
  CORPORATE_TREE_RELATION_LABELS,
  CORPORATE_TREE_RELATION_ORDER,
  isCorporateTreeRelation,
  type CorporateTreeRelation,
} from './corporate-tree-types';

export type CorporateTreeRelationshipRecord = {
  batch_id: string;
  root_name: string;
  root_candidate_id: string | null;
  related_candidate_id: string | null;
  related_name: string;
  related_country_code: string | null;
  relation_type: string;
  relation_detail: string | null;
  evidence_url: string | null;
  matched_hubspot_company_id: string | null;
  created_at: string;
};

export type CorporateTreeAssociationItem = {
  name: string;
  countryCode: string | null;
  candidateId: string | null;
  /** Estado del candidato en SellUp; `null` si no entró al lote. */
  status: string | null;
  hubspotCompanyId: string | null;
  relationDetail: string | null;
  evidenceUrl: string | null;
  /** Es la empresa cuya ficha se está mirando. */
  isSelf: boolean;
};

export type CorporateTreeAssociationGroup = {
  relation: CorporateTreeRelation;
  label: string;
  items: CorporateTreeAssociationItem[];
};

export type CorporateTreeView = {
  batchId: string;
  rootName: string;
  /** Qué es esta empresa dentro del árbol. */
  selfRelation: CorporateTreeRelation | null;
  groups: CorporateTreeAssociationGroup[];
  createdAt: string;
};

export type CorporateTreeAssociationsResponse =
  | { available: true; trees: CorporateTreeView[] }
  /** La tabla no está (migración 148 sin aplicar) o no se pudo leer. */
  | { available: false; trees: [] };

/** Agrupa las filas por árbol (lote) y por rama, en el orden de siempre. */
export function buildCorporateTreeViews(
  records: readonly CorporateTreeRelationshipRecord[],
  candidateId: string,
  statusById: ReadonlyMap<string, string>,
): CorporateTreeView[] {
  const byBatch = new Map<string, CorporateTreeRelationshipRecord[]>();
  for (const record of records) {
    if (!isCorporateTreeRelation(record.relation_type)) continue;
    byBatch.set(record.batch_id, [...(byBatch.get(record.batch_id) ?? []), record]);
  }

  const views: CorporateTreeView[] = [];
  for (const [batchId, rows] of byBatch) {
    const first = rows[0];
    const isRootSelf = first.root_candidate_id === candidateId;
    const self = rows.find((r) => r.related_candidate_id === candidateId);
    const groups = CORPORATE_TREE_RELATION_ORDER.map((relation) => ({
      relation,
      label: CORPORATE_TREE_RELATION_LABELS[relation],
      items: rows
        .filter((r) => r.relation_type === relation)
        .map((r) => ({
          name: r.related_name,
          countryCode: r.related_country_code,
          candidateId: r.related_candidate_id,
          status: r.related_candidate_id ? statusById.get(r.related_candidate_id) ?? null : null,
          hubspotCompanyId: r.matched_hubspot_company_id,
          relationDetail: r.relation_detail,
          evidenceUrl: r.evidence_url,
          isSelf: r.related_candidate_id === candidateId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    })).filter((g) => g.items.length > 0);
    views.push({
      batchId,
      rootName: first.root_name,
      selfRelation: isRootSelf ? 'root' : self && isCorporateTreeRelation(self.relation_type) ? self.relation_type : null,
      groups,
      createdAt: rows.reduce((latest, r) => (r.created_at > latest ? r.created_at : latest), first.created_at),
    });
  }
  return views.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Texto corto del estado de una empresa del árbol. */
export function describeCorporateTreeItemStatus(item: Pick<CorporateTreeAssociationItem, 'status' | 'hubspotCompanyId'>): string {
  if (item.hubspotCompanyId) return 'Ya en HubSpot';
  switch (item.status) {
    case 'needs_review':
      return 'Por revisar';
    case 'approved':
    case 'converted_to_account':
      return 'Aprobada';
    case 'discarded':
      return 'Descartada';
    case 'duplicate':
      return 'Ya en SellUp';
    case null:
      return 'No entró al lote';
    default:
      return 'En revisión';
  }
}
