/**
 * Agente 1 · Búsqueda en árbol — qué se escribe y por dónde (puro).
 *
 * Cada empresa del árbol entra por el MISMO camino que en una búsqueda por criterios
 * (AGENT1-CORPORATE-TREE-2):
 *  - de un registro oficial CON web ⇒ capa gratuita (`persistCountrySourceCandidates`);
 *  - CON web, de Claude o del banco ⇒ escritor del Agente 1 (`writeProspectingCandidates`);
 *  - SIN web (registro o Claude) ⇒ «Descartadas» con `missing_domain_final`, y el rescate
 *    con Claude le busca la web al terminar (decisión de la dueña 01-10: sin web no cuenta).
 *
 * WEB DEL GRUPO: las empresas de una familia suelen compartir dominio y, sin número
 * fiscal, el reclamo global es por dominio: la primera apartaría a sus hermanas. Igual
 * que el rescate de filiales (`parent_group_website`), una web compartida se guarda
 * sólo como referencia.
 */

import {
  CORPORATE_TREE_LIMITS,
  type CorporateTreeRelation,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import { normalizeTreeName, type CorporateTreeNode } from './corporate-tree-search';
import type { CorporateTreeFreeHit } from './corporate-tree-free-lookup';

export type CorporateTreeRoot = {
  name: string;
  website: string | null;
  domain: string | null;
  countryCode: string | null;
  /** Ya existe en SellUp: no se vuelve a escribir, sólo se enlaza. */
  candidateId: string | null;
  accountId: string | null;
};

export type CorporateTreeRowOrigin = 'catalog' | 'bank' | 'claude' | 'root';

export type CorporateTreePlannedRow = {
  /** `nombre normalizado|país`: así se reencuentra la fila en el lote. */
  key: string;
  origin: CorporateTreeRowOrigin;
  relation: CorporateTreeRelation;
  name: string;
  countryCode: string | null;
  domain: string | null;
  taxId: string | null;
  relationDetail: string | null;
  evidenceUrl: string | null;
  groupWebsite: string | null;
  /**
   * Por dónde entra al lote. `group_reference`: sólo se conoce la web del grupo
   * (ge.com/ar): no entra como candidata (la web ya es de otra empresa) ni pasa por
   * el rescate pagado; queda como referencia del árbol (Prod 14-10, General Electric:
   * 9 al rescate, 0 webs propias).
   */
  route: 'free_catalog' | 'agent1_writer' | 'without_website' | 'group_reference';
};

export type CorporateTreeWebItem = { key: string; node: CorporateTreeNode | null; bankCandidate: ProspectingPipelineCandidate | null };

export type CorporateTreeWritePlan = {
  rows: CorporateTreePlannedRow[];
  /** Por país: registros oficiales con web. */
  freeCatalog: Map<string, CountrySourceCompany[]>;
  /** Por país: Claude y banco con web. */
  web: Map<string, CorporateTreeWebItem[]>;
  /** Por país: sin web (a «Descartadas» para que el rescate la busque). */
  withoutWebsite: Map<string, CountrySourceCompany[]>;
  droppedByCap: number;
  sharedWebsites: number;
  /** De registros sin confirmar que Claude no confirmó: no entran. */
  unconfirmedDropped: number;
};

export function corporateTreeRowKey(name: string, countryCode: string | null): string {
  return `${normalizeTreeName(name)}|${countryCode ?? ''}`;
}

/** `https://www.ge.com/ar` ⇒ `ge.com`: la web del grupo que usa la referencia. */
function groupDomainOf(website: string | null): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

/** Una empresa sin web, con la forma que espera el registro de «Descartadas» de la capa gratuita. */
export function companyWithoutWebsite(params: {
  name: string;
  countryCode: string;
  taxId?: string | null;
  base?: CountrySourceCompany | null;
}): CountrySourceCompany {
  return (
    params.base ?? {
      recordIdentityKey: `corporate_tree:${params.countryCode}:${normalizeTreeName(params.name)}`,
      legalName: params.name,
      normalizedLegalName: normalizeTreeName(params.name),
      taxId: params.taxId ?? null,
      taxIdentifierType: null,
      countryCode: params.countryCode,
      city: null,
      region: null,
      domain: null,
      declaredIndustry: null,
      industryCode: null,
      coarseSector: null,
      officialMacroIndustry: null,
      originSourceKey: 'corporate_tree_claude',
    }
  );
}

type PlanEntry = {
  row: CorporateTreePlannedRow;
  /** Lo que se escribe según la vía. */
  freeCompany: CountrySourceCompany | null;
  webItem: CorporateTreeWebItem | null;
  withoutWebsite: CountrySourceCompany | null;
  /** Menor = entra antes cuando hay tope: la partida, luego con web, luego sin web. */
  priority: number;
};

export function planCorporateTreeWrites(params: {
  root: CorporateTreeRoot;
  freeHits: readonly CorporateTreeFreeHit[];
  nodes: readonly CorporateTreeNode[];
  maxRows?: number;
}): CorporateTreeWritePlan {
  const { root } = params;
  const maxRows = params.maxRows ?? CORPORATE_TREE_LIMITS.maxRows;
  const rootIsExisting = !!(root.candidateId || root.accountId);
  const rootKey = corporateTreeRowKey(root.name, root.countryCode);

  // Webs compartidas: la de la empresa de partida o la que usan dos o más empresas de Claude.
  const domainUse = new Map<string, number>();
  for (const node of params.nodes) if (node.domain) domainUse.set(node.domain, (domainUse.get(node.domain) ?? 0) + 1);
  const isShared = (domain: string | null) =>
    !!domain && ((!!root.domain && domain === root.domain) || (domainUse.get(domain) ?? 0) > 1);

  // Lo que Claude devolvió, por empresa: confirma las de registro y les da su web.
  const nodeByKey = new Map<string, CorporateTreeNode>();
  for (const node of params.nodes) {
    const key = corporateTreeRowKey(node.name, node.countryCode);
    if (!nodeByKey.has(key)) nodeByKey.set(key, node);
  }
  const consumed = new Set<string>();
  const seen = new Set<string>();
  const entries: PlanEntry[] = [];
  let sharedWebsites = 0;
  let unconfirmedDropped = 0;

  // 1. Lo gratis (registros oficiales y banco), unido a lo que Claude dijo de cada una.
  for (const hit of params.freeHits) {
    const key = corporateTreeRowKey(hit.name, hit.countryCode);
    // La razón social de la propia empresa no siempre se llama como la marca («Alpina
    // Productos Alimenticios S.A.S. BIC»): en su país y con su misma web, es ella.
    const sameSiteAsRoot =
      !!root.domain && !!hit.domain && hit.domain === root.domain && hit.countryCode === root.countryCode;
    // La misma razón base en OTRO país no es la empresa de partida (Prod 14-10: «GENERAL
    // ELECTRIC S R L» de Argentina quedó como raíz de General Electric, EE. UU.).
    const rootByName = hit.relation === 'root' && (!root.countryCode || hit.countryCode === root.countryCode);
    const isRoot = rootByName || key === rootKey || sameSiteAsRoot;
    const hitRelation: CorporateTreeRelation = hit.relation === 'root' && !isRoot ? 'other_country' : hit.relation;
    if (seen.has(key) || (isRoot && seen.has(rootKey))) continue;
    if (isRoot && rootIsExisting) {
      seen.add(key);
      continue;
    }
    const node = nodeByKey.get(key) ?? null;
    if (hit.confirmation === 'needs_claude' && !node && !isRoot) {
      unconfirmedDropped++;
      continue;
    }
    seen.add(key);
    if (isRoot) seen.add(rootKey);
    if (node) consumed.add(key);

    const ownDomain = hit.domain && !(!isRoot && root.domain && hit.domain === root.domain) ? hit.domain : null;
    const claudeDomain = node?.domain && !isShared(node.domain) ? node.domain : null;
    const domain = ownDomain ?? claudeDomain;
    const sharedDomain = !domain && !!(hit.domain || node?.domain);
    if (sharedDomain) sharedWebsites++;
    const groupWebsite = sharedDomain ? (node?.website ?? (hit.domain ? `https://${hit.domain}` : null)) : null;

    const bankRoute = hit.origin === 'bank' && hit.bankCandidate;
    const route: CorporateTreePlannedRow['route'] = bankRoute
      ? 'agent1_writer'
      : domain && hit.company
        ? 'free_catalog'
        : sharedDomain && !isRoot
          ? 'group_reference'
          : 'without_website';
    const row: CorporateTreePlannedRow = {
      key,
      origin: hit.origin,
      relation: isRoot ? 'root' : node ? node.branch : hitRelation,
      name: hit.name,
      countryCode: hit.countryCode,
      domain: route === 'group_reference' ? groupDomainOf(groupWebsite) : domain,
      taxId: hit.taxId,
      relationDetail:
        node?.relationDetail ?? (hit.origin === 'bank' ? 'Encontrada en el banco de empresas' : `Registro oficial: ${hit.sourceKey}`),
      evidenceUrl: node?.evidenceUrl ?? null,
      groupWebsite,
      route,
    };
    entries.push({
      row,
      freeCompany: route === 'free_catalog' && hit.company ? { ...hit.company, domain } : null,
      webItem: route === 'agent1_writer' && hit.bankCandidate ? { key, node: null, bankCandidate: hit.bankCandidate } : null,
      withoutWebsite:
        route === 'without_website'
          ? companyWithoutWebsite({
              name: hit.name,
              countryCode: hit.countryCode,
              taxId: hit.taxId,
              base: hit.company ? { ...hit.company, domain: null } : null,
            })
          : null,
      priority: isRoot ? 0 : route === 'without_website' || route === 'group_reference' ? 2 : 1,
    });
  }

  // 2. Lo que encontró Claude y no estaba en lo gratis.
  for (const node of params.nodes) {
    const key = corporateTreeRowKey(node.name, node.countryCode);
    if (seen.has(key) || consumed.has(key)) continue;
    seen.add(key);
    const shared = isShared(node.domain);
    if (shared) sharedWebsites++;
    const ownWebsite = shared ? null : node.website;
    const effective: CorporateTreeNode = shared ? { ...node, website: null, domain: null } : node;
    entries.push({
      row: {
        key,
        origin: 'claude',
        relation: node.branch,
        name: node.name,
        countryCode: node.countryCode,
        domain: shared ? node.domain : effective.domain,
        taxId: null,
        relationDetail: node.relationDetail,
        evidenceUrl: node.evidenceUrl,
        groupWebsite: shared ? node.website : null,
        route: ownWebsite ? 'agent1_writer' : shared ? 'group_reference' : 'without_website',
      },
      freeCompany: null,
      webItem: ownWebsite ? { key, node: effective, bankCandidate: null } : null,
      withoutWebsite: ownWebsite || shared ? null : companyWithoutWebsite({ name: node.name, countryCode: node.countryCode }),
      priority: ownWebsite ? 1 : 3,
    });
  }

  // 3. La empresa de partida, si no estaba en SellUp ni apareció en ninguna fuente.
  if (!rootIsExisting && !seen.has(rootKey) && root.countryCode) {
    seen.add(rootKey);
    const rootNode: CorporateTreeNode = {
      branch: 'group',
      name: root.name,
      legalName: null,
      countryCode: root.countryCode,
      website: root.website,
      domain: root.domain,
      linkedinUrl: null,
      relationDetail: null,
      evidenceUrl: '',
    };
    entries.push({
      row: {
        key: rootKey,
        origin: 'root',
        relation: 'root',
        name: root.name,
        countryCode: root.countryCode,
        domain: root.domain,
        taxId: null,
        relationDetail: null,
        evidenceUrl: null,
        groupWebsite: null,
        route: root.website ? 'agent1_writer' : 'without_website',
      },
      freeCompany: null,
      webItem: root.website ? { key: rootKey, node: rootNode, bankCandidate: null } : null,
      withoutWebsite: root.website ? null : companyWithoutWebsite({ name: root.name, countryCode: root.countryCode }),
      priority: 0,
    });
  }

  // Tope: entra antes lo que no le cuesta al rescate (con web).
  const kept = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.priority - b.entry.priority || a.index - b.index)
    .slice(0, maxRows)
    .sort((a, b) => a.index - b.index)
    .map(({ entry }) => entry);

  const plan: CorporateTreeWritePlan = {
    rows: kept.map((e) => e.row),
    freeCatalog: new Map(),
    web: new Map(),
    withoutWebsite: new Map(),
    droppedByCap: entries.length - kept.length,
    sharedWebsites,
    unconfirmedDropped,
  };
  for (const entry of kept) {
    const cc = entry.row.countryCode ?? '';
    if (entry.freeCompany) push(plan.freeCatalog, cc, entry.freeCompany);
    if (entry.webItem) push(plan.web, cc, entry.webItem);
    if (entry.withoutWebsite) push(plan.withoutWebsite, cc, entry.withoutWebsite);
  }
  return plan;
}
