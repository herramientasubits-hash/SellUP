/**
 * Agente 1 · Búsqueda en árbol — de las ramas encontradas a las filas que entran
 * por la importación (puro).
 *
 * La importación ya hace todo lo demás (HubSpot, duplicados, número fiscal por
 * país, tamaño, «una empresa, un vendedor»). Lo único propio del árbol es la WEB
 * DEL GRUPO: las empresas de una misma familia suelen compartir dominio y, sin
 * número fiscal, el reclamo global es por dominio. Si se mandara como web propia,
 * la primera empresa apartaría a todas sus hermanas. Igual que el rescate de
 * filiales (`parent_group_website`), una web compartida se guarda sólo como
 * referencia y cada empresa se identifica por su número fiscal o su LinkedIn.
 */

import {
  CORPORATE_TREE_LIMITS,
  CORPORATE_TREE_RELATION_LABELS,
  type CorporateTreeRelation,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import { normalizeTreeName, type CorporateTreeNode, type TreeCountry } from './corporate-tree-search';

export type CorporateTreeRoot = {
  name: string;
  website: string | null;
  domain: string | null;
  countryCode: string | null;
  /** Ya existe en SellUp: no se vuelve a importar, sólo se enlaza. */
  candidateId: string | null;
  accountId: string | null;
};

/** La misma forma que acepta `POST /api/prospect-batches/create-import-batch`. */
export type CorporateTreeImportCandidate = {
  company_name: string;
  country?: string;
  country_code?: string;
  website?: string;
  linkedin_url?: string;
  source_url?: string;
  source_evidence?: string;
  notes?: string;
  confidence?: string;
};

export type CorporateTreePlannedRow = {
  /** `nombre normalizado|país`: así se reencuentra la fila en el lote. */
  key: string;
  relation: CorporateTreeRelation;
  name: string;
  countryCode: string | null;
  domain: string | null;
  relationDetail: string | null;
  evidenceUrl: string | null;
  groupWebsite: string | null;
  candidate: CorporateTreeImportCandidate;
};

export type CorporateTreePlan = {
  rows: CorporateTreePlannedRow[];
  /** Lo que quedó fuera por el tope de filas. */
  droppedByCap: number;
  /** Filas cuya web se guardó sólo como web del grupo. */
  sharedWebsites: number;
};

export function corporateTreeRowKey(name: string, countryCode: string | null): string {
  return `${normalizeTreeName(name)}|${countryCode ?? ''}`;
}

function buildNotes(rootName: string, relation: CorporateTreeRelation, detail: string | null, groupWebsite: string | null): string {
  const parts = [
    relation === 'root'
      ? `Árbol de empresa: empresa de partida.`
      : `Árbol de ${rootName}: ${CORPORATE_TREE_RELATION_LABELS[relation].toLowerCase()}.`,
  ];
  if (detail) parts.push(detail.endsWith('.') ? detail : `${detail}.`);
  if (groupWebsite) parts.push(`Web del grupo: ${groupWebsite}.`);
  return parts.join(' ');
}

export function planCorporateTreeImport(params: {
  root: CorporateTreeRoot;
  nodes: readonly CorporateTreeNode[];
  countries: readonly TreeCountry[];
  maxRows?: number;
}): CorporateTreePlan {
  const { root } = params;
  const maxRows = params.maxRows ?? CORPORATE_TREE_LIMITS.maxRows;
  const countryName = (code: string | null) => params.countries.find((c) => c.code === code)?.name ?? null;

  // Una empresa (nombre × país) una sola vez, aunque salga en dos ramas: gana la primera.
  const seen = new Set<string>();
  const rootKey = corporateTreeRowKey(root.name, root.countryCode);
  seen.add(rootKey);
  const unique: CorporateTreeNode[] = [];
  for (const node of params.nodes) {
    const key = corporateTreeRowKey(node.name, node.countryCode);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(node);
  }

  // Webs compartidas: la de la empresa de partida o la que usan dos o más ramas.
  const domainUse = new Map<string, number>();
  for (const node of unique) if (node.domain) domainUse.set(node.domain, (domainUse.get(node.domain) ?? 0) + 1);
  const isShared = (domain: string | null) => !!domain && ((!!root.domain && domain === root.domain) || (domainUse.get(domain) ?? 0) > 1);

  const rows: CorporateTreePlannedRow[] = [];
  const includeRoot = !root.candidateId && !root.accountId;
  if (includeRoot) {
    rows.push({
      key: rootKey,
      relation: 'root',
      name: root.name,
      countryCode: root.countryCode,
      domain: root.domain,
      relationDetail: null,
      evidenceUrl: null,
      groupWebsite: null,
      candidate: {
        company_name: root.name,
        ...(root.countryCode ? { country_code: root.countryCode, country: countryName(root.countryCode) ?? undefined } : {}),
        ...(root.website ? { website: root.website } : {}),
        notes: buildNotes(root.name, 'root', null, null),
        confidence: 'media',
      },
    });
  }

  const room = Math.max(0, maxRows - rows.length);
  let sharedWebsites = 0;
  for (const node of unique.slice(0, room)) {
    const shared = isShared(node.domain);
    if (shared) sharedWebsites++;
    const groupWebsite = shared ? node.website : null;
    rows.push({
      key: corporateTreeRowKey(node.name, node.countryCode),
      relation: node.branch,
      name: node.name,
      countryCode: node.countryCode,
      domain: shared ? null : node.domain,
      relationDetail: node.relationDetail,
      evidenceUrl: node.evidenceUrl,
      groupWebsite,
      candidate: {
        company_name: node.name,
        country_code: node.countryCode,
        ...(countryName(node.countryCode) ? { country: countryName(node.countryCode)! } : {}),
        ...(!shared && node.website ? { website: node.website } : {}),
        ...(node.linkedinUrl ? { linkedin_url: node.linkedinUrl } : {}),
        source_url: node.evidenceUrl,
        ...(node.relationDetail ? { source_evidence: node.relationDetail } : {}),
        notes: buildNotes(root.name, node.branch, node.relationDetail, groupWebsite),
        confidence: 'media',
      },
    });
  }

  return { rows, droppedByCap: Math.max(0, unique.length - room), sharedWebsites };
}
