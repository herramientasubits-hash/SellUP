/**
 * Agente 1 · Búsqueda en árbol — el lote agrupado por rama (puro).
 */

import { describeCorporateTreeItemStatus } from './corporate-tree-associations';
import {
  CORPORATE_TREE_METADATA_KEY,
  CORPORATE_TREE_RELATION_LABELS,
  CORPORATE_TREE_RELATION_ORDER,
  readCorporateTreeRelation,
  type CorporateTreeRelation,
} from './corporate-tree-types';

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
  relationDetail: string | null;
  evidenceUrl: string | null;
  groupWebsite: string | null;
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
): CorporateTreeBatchGroup[] {
  const byRelation = new Map<CorporateTreeRelation, CorporateTreeBatchItem[]>();
  for (const candidate of candidates) {
    const relation = readCorporateTreeRelation(candidate.metadata);
    if (!relation) continue;
    const tree = (candidate.metadata?.[CORPORATE_TREE_METADATA_KEY] ?? {}) as Record<string, unknown>;
    const statusLabel = describeCorporateTreeItemStatus({
      status: candidate.status,
      hubspotCompanyId: candidate.matched_hubspot_company_id,
    });
    byRelation.set(relation, [
      ...(byRelation.get(relation) ?? []),
      {
        id: candidate.id,
        name: candidate.name,
        countryCode: candidate.country_code,
        statusLabel,
        statusTone: toneFor(statusLabel),
        relationDetail: str(tree.relation_detail),
        evidenceUrl: str(tree.evidence_url),
        groupWebsite: str(tree.group_website),
      },
    ]);
  }
  return CORPORATE_TREE_RELATION_ORDER.filter((relation) => byRelation.has(relation)).map((relation) => ({
    relation,
    label: CORPORATE_TREE_RELATION_LABELS[relation],
    items: [...(byRelation.get(relation) ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'es')),
  }));
}
