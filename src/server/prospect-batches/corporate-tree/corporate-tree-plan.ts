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
  /** Por dónde entra al lote. */
  route: 'free_catalog' | 'agent1_writer' | 'without_website';
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
};

export function corporateTreeRowKey(name: string, countryCode: string | null): string {
  return `${normalizeTreeName(name)}|${countryCode ?? ''}`;
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

  const plan: CorporateTreeWritePlan = {
    rows: [],
    freeCatalog: new Map(),
    web: new Map(),
    withoutWebsite: new Map(),
    droppedByCap: 0,
    sharedWebsites: 0,
  };
  const seen = new Set<string>();
  const room = () => plan.rows.length < maxRows;

  // Webs compartidas: la de la empresa de partida o la que usan dos o más empresas de Claude.
  const domainUse = new Map<string, number>();
  for (const node of params.nodes) if (node.domain) domainUse.set(node.domain, (domainUse.get(node.domain) ?? 0) + 1);
  const isShared = (domain: string | null) =>
    !!domain && ((!!root.domain && domain === root.domain) || (domainUse.get(domain) ?? 0) > 1);

  // 1. Lo gratis primero (registros oficiales y banco).
  for (const hit of params.freeHits) {
    const key = corporateTreeRowKey(hit.name, hit.countryCode);
    const isRoot = hit.relation === 'root' || key === rootKey;
    if (isRoot && rootIsExisting) {
      seen.add(key);
      continue;
    }
    if (seen.has(key)) continue;
    if (!room()) {
      plan.droppedByCap++;
      continue;
    }
    seen.add(key);
    // La web del grupo (la de la empresa de partida) tampoco es propia en un registro.
    const sharedDomain = !isRoot && !!hit.domain && !!root.domain && hit.domain === root.domain;
    const route: CorporateTreePlannedRow['route'] =
      hit.origin === 'bank' && hit.bankCandidate
        ? 'agent1_writer'
        : hit.domain && hit.company && !sharedDomain
          ? 'free_catalog'
          : 'without_website';
    if (sharedDomain) plan.sharedWebsites++;
    plan.rows.push({
      key,
      origin: hit.origin,
      relation: isRoot ? 'root' : hit.relation,
      name: hit.name,
      countryCode: hit.countryCode,
      domain: sharedDomain ? null : hit.domain,
      taxId: hit.taxId,
      relationDetail: hit.origin === 'bank' ? 'Encontrada en el banco de empresas' : `Registro oficial: ${hit.sourceKey}`,
      evidenceUrl: null,
      groupWebsite: sharedDomain && root.website ? root.website : null,
      route,
    });
    if (route === 'agent1_writer' && hit.bankCandidate) push(plan.web, hit.countryCode, { key, node: null, bankCandidate: hit.bankCandidate });
    else if (route === 'free_catalog' && hit.company) push(plan.freeCatalog, hit.countryCode, hit.company);
    else
      push(
        plan.withoutWebsite,
        hit.countryCode,
        companyWithoutWebsite({
          name: hit.name,
          countryCode: hit.countryCode,
          taxId: hit.taxId,
          base: hit.company ? { ...hit.company, domain: null } : null,
        }),
      );
  }

  // 2. Lo que encontró Claude (lo que lo gratis no tenía).
  for (const node of params.nodes) {
    const key = corporateTreeRowKey(node.name, node.countryCode);
    if (seen.has(key)) continue;
    if (!room()) {
      plan.droppedByCap++;
      continue;
    }
    seen.add(key);
    const shared = isShared(node.domain);
    if (shared) plan.sharedWebsites++;
    const ownWebsite = shared ? null : node.website;
    const effective: CorporateTreeNode = shared ? { ...node, website: null, domain: null } : node;
    plan.rows.push({
      key,
      origin: 'claude',
      relation: node.branch,
      name: node.name,
      countryCode: node.countryCode,
      domain: effective.domain,
      taxId: null,
      relationDetail: node.relationDetail,
      evidenceUrl: node.evidenceUrl,
      groupWebsite: shared ? node.website : null,
      route: ownWebsite ? 'agent1_writer' : 'without_website',
    });
    if (ownWebsite) push(plan.web, node.countryCode, { key, node: effective, bankCandidate: null });
    else push(plan.withoutWebsite, node.countryCode, companyWithoutWebsite({ name: node.name, countryCode: node.countryCode }));
  }

  // 3. La empresa de partida, si no estaba en SellUp ni apareció en ninguna fuente.
  if (!rootIsExisting && !seen.has(rootKey) && root.countryCode && room()) {
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
    plan.rows.push({
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
    });
    if (root.website) push(plan.web, root.countryCode, { key: rootKey, node: rootNode, bankCandidate: null });
    else push(plan.withoutWebsite, root.countryCode, companyWithoutWebsite({ name: root.name, countryCode: root.countryCode }));
  }

  return plan;
}
