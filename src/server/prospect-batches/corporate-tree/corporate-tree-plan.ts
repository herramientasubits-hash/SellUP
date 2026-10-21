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
  type CorporateTreeBranch,
  type CorporateTreeRelation,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import { ICP_SIZE_GATE_DEFAULT_THRESHOLD } from '@/server/agents/prospecting-toolkit/icp-size-gate';
import type { CountrySourceCompany } from '@/server/prospect-batches/country-source-discovery/country-source-types';
import type { ProspectingPipelineCandidate } from '@/server/agents/prospecting-toolkit/types';
import { normalizeTreeName, type CorporateTreeNode } from './corporate-tree-search';
import {
  stripBranchSuffix,
  stripCountryTag,
  stripOwnCountryMarker,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
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

export type CorporateTreeRowOrigin = 'catalog' | 'bank' | 'claude' | 'root' | 'apollo';

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
  route: 'free_catalog' | 'agent1_writer' | 'without_website' | 'group_reference' | 'already_known' | 'possible_known';
  /**
   * `already_known`: sin web, pero ya está en HubSpot o en SellUp por su nombre. No va al
   * rescate pagado (Prod 15-10, Citigroup: 7 de 14 rescates encontraron empresas ya conocidas).
   */
  knownHubspotCompanyId?: string | null;
  /** La web vino de Claude sin poder comprobarse (el sitio bloquea la descarga). */
  websiteUnverified?: boolean;
  /** La web la encontró Apollo buscando por el nombre. */
  foundInApollo?: boolean;
  knownAccountId?: string | null;
  /** `possible_known`: el nombre parecido en HubSpot (mismo país). Va a «Descartadas» sin rescate. */
  knownMatchedName?: string | null;
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
  /**
   * Por fila (`key`): la empresa con la web del grupo, lista para entrar por la capa
   * gratuita SIN web propia si se le encuentra su número fiscal oficial.
   */
  groupCompanies: Map<string, CountrySourceCompany>;
  /** Por país: sin web y con un nombre parecido en HubSpot ⇒ «Descartadas» sin rescate. */
  possibleDuplicates: Map<string, CorporateTreePossibleDuplicate[]>;
  droppedByCap: number;
  sharedWebsites: number;
  /** De registros sin confirmar que Claude no confirmó: no entran. */
  unconfirmedDropped: number;
  /** De registros de una rama que no se pidió (sólo «grupo» ⇒ sin filiales ni otros países). */
  droppedByBranch?: number;
};

/** Una empresa sin web que en HubSpot tiene un nombre parecido en su mismo país. */
export type CorporateTreePossibleDuplicate = { company: CountrySourceCompany; matchedName: string | null };

/**
 * La web y el país de la empresa de partida con todo lo que se sabe. Cada dato por separado:
 * una rama de Claude puede traer el país sin la web y otra la web (Prod 15-10, Bimbo e32d4058:
 * la primera respuesta traía sólo el país, la empresa quedó sin web y Apollo no se consultó).
 * Si Claude no dio web comprobada, vale la que trae la empresa de partida desde el banco o el
 * registro oficial de su país (bimbo.com.mx). Puro: devuelve una empresa nueva.
 */
export function mergeRootFindings(
  root: CorporateTreeRoot,
  findings: readonly ({ website: string | null; domain: string | null; countryCode: string | null } | null)[],
  freeHits: readonly Pick<CorporateTreeFreeHit, 'relation' | 'countryCode' | 'domain'>[],
): CorporateTreeRoot {
  const known = findings.filter((f): f is NonNullable<typeof f> => !!f);
  const withDomain = pickRootFinding(root.name, known);
  const countryCode =
    root.countryCode ?? withDomain?.countryCode ?? known.find((f) => !!f.countryCode)?.countryCode ?? null;
  // Sin país, la web del registro sólo vale si hay UNA sola candidata a empresa de partida:
  // con homónimos en varios países sería la web de cualquiera de ellos.
  const freeRoots = freeHits.filter((h) => h.relation === 'root' && (!countryCode || h.countryCode === countryCode));
  const freeRootDomain = (!countryCode && freeRoots.length > 1 ? null : freeRoots.find((h) => !!h.domain)?.domain) ?? null;
  const domain = root.domain ?? withDomain?.domain ?? freeRootDomain;
  const website = root.website ?? withDomain?.website ?? (domain ? `https://${domain}` : null);
  return { ...root, website, domain, countryCode };
}

/** Palabras del nombre que sirven para reconocerlo en una web (4+ letras, sin forma societaria). */
function rootNameTokens(name: string): string[] {
  return normalizeTreeName(name)
    .split(' ')
    .filter((token) => token.length >= 4 && !['grupo', 'group', 'holding', 'holdings', 'corporacion', 'corporation'].includes(token));
}

/**
 * Qué respuesta de Claude describe a la empresa de partida. Cada rama la cuenta por su
 * lado y la del grupo puede dar la de su MATRIZ (Prod 15-10, Monsanto 2d25d55a: la rama
 * «grupo» dijo bayer.com/DE y las otras dos monsanto.com/US; ganó la primera y Apollo
 * enriqueció a Bayer). Gana la web que lleva el nombre de la empresa; si ninguna lo
 * lleva, la que más ramas repiten; si empatan, la primera.
 */
function pickRootFinding<T extends { domain: string | null }>(rootName: string, known: readonly T[]): T | null {
  const withDomain = known.filter((f) => !!f.domain);
  if (withDomain.length === 0) return null;
  const tokens = rootNameTokens(rootName);
  const label = (domain: string) => domain.toLowerCase().replace(/[^a-z0-9]/g, '');
  const named = withDomain.find((f) => tokens.some((token) => label(f.domain!).includes(token)));
  if (named) return named;
  const votes = new Map<string, number>();
  for (const f of withDomain) votes.set(f.domain!, (votes.get(f.domain!) ?? 0) + 1);
  return withDomain.reduce((best, f) => ((votes.get(f.domain!) ?? 0) > (votes.get(best.domain!) ?? 0) ? f : best));
}

export function corporateTreeRowKey(name: string, countryCode: string | null): string {
  return `${stripOwnCountryMarker(normalizeTreeName(stripCountryTag(stripBranchSuffix(name))), countryCode)}|${countryCode ?? ''}`;
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
  groupCompany?: CountrySourceCompany | null;
  /** Menor = entra antes cuando hay tope: la partida, luego con web, luego sin web. */
  priority: number;
};

export function planCorporateTreeWrites(params: {
  root: CorporateTreeRoot;
  freeHits: readonly CorporateTreeFreeHit[];
  nodes: readonly CorporateTreeNode[];
  maxRows?: number;
  /**
   * Las ramas pedidas. Lo gratis también las respeta (antes sólo Claude: con «grupo» solo,
   * entraban igual las filiales y los otros países de los registros). Ausente = todas.
   */
  branches?: readonly CorporateTreeBranch[];
}): CorporateTreeWritePlan {
  const { root } = params;
  const wantsBranch = (relation: CorporateTreeRelation) =>
    relation === 'root' || !params.branches || (params.branches as readonly string[]).includes(relation);
  const maxRows = params.maxRows ?? CORPORATE_TREE_LIMITS.maxRows;
  const rootIsExisting = !!(root.candidateId || root.accountId);
  const rootKey = corporateTreeRowKey(root.name, root.countryCode);

  // Webs compartidas: la de la empresa de partida o la que usan dos o más EMPRESAS de Claude.
  // Se cuentan empresas (nombre × país), no respuestas: la misma «Nestlé Chile» que traen dos
  // ramas no vuelve compartida su propia web.
  const domainKeys = new Map<string, Set<string>>();
  for (const node of params.nodes) {
    if (!node.domain) continue;
    domainKeys.set(node.domain, new Set([...(domainKeys.get(node.domain) ?? []), corporateTreeRowKey(node.name, node.countryCode)]));
  }
  const isShared = (domain: string | null) =>
    !!domain && ((!!root.domain && domain === root.domain) || (domainKeys.get(domain)?.size ?? 0) > 1);
  // Sin país de partida, el nombre exacto en varios países no dice cuál es la propia empresa:
  // ninguna entra como tal sin que Claude la confirme (fail-closed).
  const ambiguousRootByName = !root.countryCode && params.freeHits.filter((h) => h.relation === 'root').length > 1;

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
  let droppedByBranch = 0;

  // 1. Lo gratis (registros oficiales y banco), unido a lo que Claude dijo de cada una.
  for (const hit of params.freeHits) {
    const key = corporateTreeRowKey(hit.name, hit.countryCode);
    // La razón social de la propia empresa no siempre se llama como la marca («Alpina
    // Productos Alimenticios S.A.S. BIC»): en su país y con su misma web, es ella.
    const sameSiteAsRoot =
      !!root.domain && !!hit.domain && hit.domain === root.domain && hit.countryCode === root.countryCode;
    // La misma razón base en OTRO país no es la empresa de partida (Prod 14-10: «GENERAL
    // ELECTRIC S R L» de Argentina quedó como raíz de General Electric, EE. UU.).
    const rootByName =
      hit.relation === 'root' && (root.countryCode ? hit.countryCode === root.countryCode : !ambiguousRootByName);
    const isRoot = rootByName || key === rootKey || sameSiteAsRoot;
    const hitRelation: CorporateTreeRelation = hit.relation === 'root' && !isRoot ? 'other_country' : hit.relation;
    if (seen.has(key) || (isRoot && seen.has(rootKey))) continue;
    if (isRoot && rootIsExisting) {
      seen.add(key);
      continue;
    }
    const node = nodeByKey.get(key) ?? null;
    const unconfirmed = hit.confirmation === 'needs_claude' || (ambiguousRootByName && hit.relation === 'root');
    if (unconfirmed && !node && !isRoot) {
      unconfirmedDropped++;
      continue;
    }
    if (!isRoot && !wantsBranch(node ? node.branch : hitRelation)) {
      droppedByBranch++;
      continue;
    }
    seen.add(key);
    if (isRoot) seen.add(rootKey);
    if (node) consumed.add(key);

    // La empresa de partida usa la web que ya conocemos aunque el registro no la traiga
    // (Prod 15-10, Citigroup: «CITIGROUP INC» del directorio de EE. UU. fue a «Descartadas»
    // teniendo citigroup.com).
    const ownDomain =
      hit.domain && !(!isRoot && root.domain && hit.domain === root.domain)
        ? hit.domain
        : isRoot && root.domain
          ? root.domain
          : null;
    const claudeDomain = node?.domain && !isShared(node.domain) ? node.domain : null;
    const domain = ownDomain ?? claudeDomain;
    const websiteUnverified = !ownDomain && !!claudeDomain && !!node?.websiteUnverified;
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
      ...(websiteUnverified ? { websiteUnverified } : {}),
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
      groupCompany:
        route === 'group_reference'
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
        ...(ownWebsite && node.websiteUnverified ? { websiteUnverified: true } : {}),
      },
      freeCompany: null,
      webItem: ownWebsite ? { key, node: effective, bankCandidate: null } : null,
      withoutWebsite: ownWebsite || shared ? null : companyWithoutWebsite({ name: node.name, countryCode: node.countryCode }),
      groupCompany: !ownWebsite && shared ? companyWithoutWebsite({ name: node.name, countryCode: node.countryCode }) : null,
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
    groupCompanies: new Map(),
    possibleDuplicates: new Map(),
    droppedByCap: entries.length - kept.length,
    sharedWebsites,
    unconfirmedDropped,
    droppedByBranch,
  };
  for (const entry of kept) {
    const cc = entry.row.countryCode ?? '';
    if (entry.freeCompany) push(plan.freeCatalog, cc, entry.freeCompany);
    if (entry.webItem) push(plan.web, cc, entry.webItem);
    if (entry.withoutWebsite) push(plan.withoutWebsite, cc, entry.withoutWebsite);
    if (entry.groupCompany) plan.groupCompanies.set(entry.row.key, entry.groupCompany);
  }
  return plan;
}

/** Una empresa sin web que ya existe en HubSpot o en SellUp (por su nombre y país). */
export type CorporateTreeKnownCompany = {
  hubspotCompanyId: string | null;
  accountId: string | null;
  /**
   * `exact`: el mismo nombre (o la cuenta de SellUp). `possible`: HubSpot tiene un nombre
   * que contiene al buscado, o al revés, en el MISMO país (Prod 15-10, Citigroup:
   * «Citibank-Colombia S.A.» frente a «Citibank Colombia»). Ausente = `exact`.
   */
  kind?: 'exact' | 'possible';
  /** El nombre con que está en HubSpot (para decirlo en «Descartadas»). */
  matchedName?: string | null;
};

/**
 * Las filas sin web que ya se conocen dejan de ir a «Descartadas» (y al rescate) y quedan
 * como referencia con su ficha de HubSpot. Puro: devuelve un plan nuevo.
 */
export function markKnownCompanies(
  plan: CorporateTreeWritePlan,
  known: ReadonlyMap<string, CorporateTreeKnownCompany>,
): CorporateTreeWritePlan {
  if (known.size === 0) return plan;
  const rows = plan.rows.map((row) => {
    const match = row.route === 'without_website' ? known.get(row.key) : undefined;
    if (!match) return row;
    return {
      ...row,
      route: match.kind === 'possible' ? ('possible_known' as const) : ('already_known' as const),
      knownHubspotCompanyId: match.hubspotCompanyId,
      knownAccountId: match.accountId,
      knownMatchedName: match.matchedName ?? null,
    };
  });
  const withoutWebsite = new Map<string, CountrySourceCompany[]>();
  const possibleDuplicates = new Map<string, CorporateTreePossibleDuplicate[]>(
    [...plan.possibleDuplicates].map(([cc, list]) => [cc, [...list]]),
  );
  for (const [code, companies] of plan.withoutWebsite) {
    const kept: CountrySourceCompany[] = [];
    for (const company of companies) {
      const match = known.get(corporateTreeRowKey(company.legalName ?? '', company.countryCode));
      if (!match) kept.push(company);
      else if (match.kind === 'possible') push(possibleDuplicates, code, { company, matchedName: match.matchedName ?? null });
    }
    if (kept.length > 0) withoutWebsite.set(code, kept);
  }
  return { ...plan, rows, withoutWebsite, possibleDuplicates };
}

type KnownMatch = {
  source: 'sellup' | 'hubspot';
  status: string;
  confidence: number;
  matchedId?: string | null;
  matchedName?: string | null;
  raw?: unknown;
};

const foldText = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/**
 * ¿Lo que devolvieron los revisores de duplicados prueba que la empresa ya existe? Sólo
 * coincidencias EXACTAS (nombre normalizado igual, dominio o número fiscal), nunca un
 * «parecido». En HubSpot, si la ficha dice otro país, no es la misma empresa
 * («Citibank N.A.» de EE. UU. no es la sucursal de Uruguay).
 */
export function pickKnownCompany(params: {
  hubspot: readonly KnownMatch[];
  sellup: readonly KnownMatch[];
  countryCode: string | null;
  countryName: string | null;
  /** Otros nombres del país (en inglés, como suele estar en HubSpot: «United States»). */
  countryAliases?: readonly string[];
  /** HubSpot de la cuenta de SellUp encontrada, si lo tiene. */
  accountHubspotId?: (accountId: string) => string | null;
}): CorporateTreeKnownCompany | null {
  const wanted = [params.countryCode, params.countryName, ...(params.countryAliases ?? [])]
    .filter((v): v is string => !!v)
    .map(foldText);
  const countryOf = (raw: unknown) => {
    const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['country'] : null;
    return typeof value === 'string' ? foldText(value) : '';
  };
  const sameCountry = (raw: unknown) => {
    const country = countryOf(raw);
    return !country || wanted.length === 0 || wanted.includes(country);
  };
  // Un nombre sólo parecido exige que HubSpot DIGA el mismo país (sin país no se adivina).
  const surelySameCountry = (raw: unknown) => {
    const country = countryOf(raw);
    return !!country && wanted.includes(country);
  };
  const hub = params.hubspot.find(
    (m) => m.status === 'existing_in_hubspot' && m.confidence >= 80 && !!m.matchedId && sameCountry(m.raw),
  );
  const account = params.sellup.find((m) => m.status === 'existing_in_sellup' && !!m.matchedId);
  if (!hub && !account) {
    const possible = params.hubspot.find(
      (m) => m.status === 'possible_duplicate' && m.confidence >= 65 && !!m.matchedId && surelySameCountry(m.raw),
    );
    return possible
      ? { hubspotCompanyId: possible.matchedId ?? null, accountId: null, kind: 'possible', matchedName: possible.matchedName ?? null }
      : null;
  }
  const accountId = account?.matchedId ?? null;
  return {
    hubspotCompanyId: hub?.matchedId ?? (accountId ? params.accountHubspotId?.(accountId) ?? null : null),
    accountId,
    kind: 'exact',
    matchedName: hub?.matchedName ?? account?.matchedName ?? null,
  };
}

/**
 * Filiales con la web del grupo (ge.com/mx) a las que el registro oficial les encontró su
 * número fiscal: entran a «Por revisar» por la capa gratuita, SIN web propia (como las de
 * los registros que no publican web). «Una empresa, un vendedor» las reclama por su número
 * fiscal, no por la web, así que no chocan con la casa matriz. Las que no tienen número
 * siguen como referencia. Puro: devuelve un plan nuevo.
 */
export function promoteGroupCompaniesWithTaxIds(
  plan: CorporateTreeWritePlan,
  withTaxIds: ReadonlyMap<string, CountrySourceCompany>,
): CorporateTreeWritePlan {
  const promoted = new Map([...withTaxIds].filter(([key, company]) => !!company.taxId && plan.groupCompanies.has(key)));
  if (promoted.size === 0) return plan;
  const freeCatalog = new Map([...plan.freeCatalog].map(([cc, list]) => [cc, [...list]]));
  const rows = plan.rows.map((row) => {
    const company = row.route === 'group_reference' ? promoted.get(row.key) : undefined;
    if (!company) return row;
    push(freeCatalog, row.countryCode ?? '', { ...company, domain: null });
    return { ...row, route: 'free_catalog' as const, taxId: company.taxId, domain: null };
  });
  return { ...plan, rows, freeCatalog };
}

/**
 * Trabajadores oficiales desde los que una empresa del grupo sin web propia entra a «Por
 * revisar» (el mismo mínimo del ICP: 200+).
 */
export const CORPORATE_TREE_NO_WEBSITE_MIN_WORKERS = ICP_SIZE_GATE_DEFAULT_THRESHOLD;

/**
 * FASE B (dueña 21-10): las empresas del grupo SIN web propia pero CON número fiscal y
 * tamaño oficial (200+ trabajadores) entran a «Por revisar» por la capa gratuita, sin web y
 * con la web del grupo como referencia, en vez de ir a «Descartadas» a esperar el rescate
 * pagado (Prod 14/15-10: 241 de 475 terminaron «sin web»; Bimbo Ecuador, 1.154 trabajadores).
 * «Una empresa, un vendedor» las reclama por su número fiscal, así que no chocan con la casa
 * matriz. `officialRecords` (por fila) trae el número y el tamaño que el registro oficial
 * tiene para las que Claude encontró sin ellos. Sin número o sin tamaño suficiente siguen su
 * camino. Puro: devuelve un plan nuevo.
 */
export function promoteSizedCompaniesWithoutWebsite(
  plan: CorporateTreeWritePlan,
  params: {
    groupWebsite: string | null;
    officialRecords?: ReadonlyMap<string, CountrySourceCompany>;
    minWorkers?: number;
  },
): { plan: CorporateTreeWritePlan; promoted: number } {
  const minWorkers = params.minWorkers ?? CORPORATE_TREE_NO_WEBSITE_MIN_WORKERS;
  const companyByKey = new Map<string, CountrySourceCompany>();
  for (const companies of plan.withoutWebsite.values()) {
    for (const company of companies) companyByKey.set(corporateTreeRowKey(company.legalName ?? '', company.countryCode), company);
  }
  const ready = new Map<string, CountrySourceCompany>();
  const byOfficialName = new Set<string>();
  for (const row of plan.rows) {
    if (row.route !== 'without_website') continue;
    const own = companyByKey.get(row.key);
    if (!own) continue;
    const official = params.officialRecords?.get(row.key) ?? null;
    const company: CountrySourceCompany = own.taxId
      ? { ...own, officialWorkforce: own.officialWorkforce ?? official?.officialWorkforce ?? null }
      : official?.taxId
        ? { ...own, ...official, legalName: own.legalName, countryCode: own.countryCode }
        : own;
    if (company.taxId && (company.officialWorkforce?.workers ?? 0) >= minWorkers) {
      ready.set(row.key, { ...company, domain: null });
      if (!own.taxId) byOfficialName.add(row.key);
    }
  }
  if (ready.size === 0) return { plan, promoted: 0 };

  const freeCatalog = new Map([...plan.freeCatalog].map(([cc, list]) => [cc, [...list]]));
  const rows = plan.rows.map((row) => {
    const company = ready.get(row.key);
    if (!company) return row;
    push(freeCatalog, row.countryCode ?? '', company);
    return {
      ...row,
      route: 'free_catalog' as const,
      taxId: company.taxId,
      domain: null,
      // La empresa de partida no se refiere a sí misma.
      groupWebsite: row.relation === 'root' ? null : (row.groupWebsite ?? params.groupWebsite),
      // Quien revisa debe saber que el número salió del registro por el nombre, no de la fuente.
      ...(byOfficialName.has(row.key)
        ? { relationDetail: `${row.relationDetail ?? 'Del grupo'} · número fiscal del registro oficial por nombre exacto` }
        : {}),
    };
  });
  const withoutWebsite = new Map<string, CountrySourceCompany[]>();
  for (const [code, companies] of plan.withoutWebsite) {
    const kept = companies.filter((c) => !ready.has(corporateTreeRowKey(c.legalName ?? '', c.countryCode)));
    if (kept.length > 0) withoutWebsite.set(code, kept);
  }
  return { plan: { ...plan, rows, freeCatalog, withoutWebsite }, promoted: ready.size };
}

/** Lo que Apollo devolvió de una empresa buscada por su nombre. */
export type CorporateTreeApolloMatch = { website: string; domain: string; linkedinUrl: string | null };

/**
 * Las filas sin web que Apollo encontró por su nombre pasan al escritor del Agente 1 con
 * esa web, en vez de esperar al rescate. Nunca la empresa de partida. Puro.
 */
export function promoteRowsFoundInApollo(
  plan: CorporateTreeWritePlan,
  found: ReadonlyMap<string, CorporateTreeApolloMatch>,
): CorporateTreeWritePlan {
  if (found.size === 0) return plan;
  const web = new Map([...plan.web].map(([cc, list]) => [cc, [...list]]));
  const promotedKeys = new Set<string>();
  const rows = plan.rows.map((row) => {
    const match = row.route === 'without_website' && row.relation !== 'root' ? found.get(row.key) : undefined;
    if (!match || row.relation === 'root' || !row.countryCode) return row;
    promotedKeys.add(row.key);
    const node: CorporateTreeNode = {
      branch: row.relation,
      name: row.name,
      legalName: null,
      countryCode: row.countryCode,
      website: match.website,
      domain: match.domain,
      linkedinUrl: match.linkedinUrl,
      relationDetail: row.relationDetail,
      evidenceUrl: row.evidenceUrl ?? '',
    };
    push(web, row.countryCode, { key: row.key, node, bankCandidate: null });
    return { ...row, route: 'agent1_writer' as const, domain: match.domain, foundInApollo: true };
  });
  const withoutWebsite = new Map<string, CountrySourceCompany[]>();
  for (const [code, companies] of plan.withoutWebsite) {
    const kept = companies.filter((c) => !promotedKeys.has(corporateTreeRowKey(c.legalName ?? '', c.countryCode)));
    if (kept.length > 0) withoutWebsite.set(code, kept);
  }
  return { ...plan, rows, web, withoutWebsite };
}

/** Palabras que no identifican a una empresa (no bastan para decir que dos nombres son la misma). */
const APOLLO_GENERIC_WORDS = new Set([
  'grupo', 'group', 'financiero', 'financial', 'banco', 'bank', 'compania', 'company', 'corporacion', 'corporation',
  'holding', 'holdings', 'servicios', 'services', 'international', 'internacional', 'global', 'de', 'del', 'la', 'el',
  'los', 'las', 'y', 'and', 'the', 'of', 'sucursal', 'branch', 'mexico', 'chile', 'peru', 'colombia', 'argentina',
]);

/**
 * ¿El nombre de Apollo está DENTRO del buscado, por palabras completas y con al menos una
 * palabra propia de 5+ letras? «Banamex» dentro de «Grupo Financiero Banamex» sí (Prod 15-10,
 * Citigroup: Apollo devolvió 1 y no se aceptó); «Banco» dentro de «Banco de Chile» no.
 */
function namedWithin(core: string, wanted: string): boolean {
  const wantedWords = new Set(wanted.split(' '));
  const words = core.split(' ').filter(Boolean);
  if (words.length === 0 || !words.every((w) => wantedWords.has(w))) return false;
  return words.some((w) => w.length >= 5 && !APOLLO_GENERIC_WORDS.has(w));
}

/**
 * Una filial de la empresa de partida según Apollo (`suborganizations` de su ficha, que se
 * pide UNA vez por corrida: Apollo Support 15-10 — la búsqueda por nombre no sirve para esto).
 */
export type CorporateTreeApolloSubsidiary = {
  name: string;
  domain: string | null;
  website: string | null;
  linkedinUrl: string | null;
  /** País de su sede si Apollo lo trae. */
  countryCode: string | null;
  /** Empleados según Apollo (`estimated_num_employees`), si lo trae. */
  employeeCount?: number | null;
};

/**
 * Por debajo de esto no es cliente de UBITS (el mismo mínimo del rescate): Apollo lista
 * concesionarios y franquicias pequeñas como filiales (Prod 15-10: «Porsche Santa
 * Clarita» en Volkswagen, «Jiffy Lube Southeast» en Shell).
 */
export const CORPORATE_TREE_APOLLO_MIN_EMPLOYEES = 200;

const GENERIC_TLD = /\.(com|net|org|biz|info)$/i;

/**
 * Filial de un país que trae la web GLOBAL del grupo («Porsche Colombia SAS» con
 * porsche.com, «Volkswagen do Brasil» con volkswagen.com): esa web no es suya y
 * reclamarla le quitaría la web a la empresa del grupo. Se reconoce porque su nombre
 * termina en su país y la web no es de ese país.
 */
export function apolloSubsidiaryUsesGlobalDomain(sub: { name: string; domain: string }, countryCode: string): boolean {
  if (!GENERIC_TLD.test(sub.domain) || countryCode === 'US') return false;
  const core = normalizeTreeName(stripBranchSuffix(sub.name));
  return stripOwnCountryMarker(core, countryCode) !== core;
}

/** Las más grandes primero; las de tamaño desconocido al final, en el orden de Apollo. */
function bySizeDesc(a: { employeeCount?: number | null }, b: { employeeCount?: number | null }): number {
  return (b.employeeCount ?? -1) - (a.employeeCount ?? -1);
}

/** Dominio de país (.co, .com.mx…) ⇒ código del asistente. Un .com no dice el país. */
const COUNTRY_BY_TLD: Readonly<Record<string, string>> = {
  co: 'CO', mx: 'MX', cl: 'CL', ar: 'AR', br: 'BR', pe: 'PE', uy: 'UY', ec: 'EC', py: 'PY', bo: 'BO', ve: 'VE',
  gt: 'GT', hn: 'HN', sv: 'SV', ni: 'NI', cr: 'CR', pa: 'PA', do: 'DO', es: 'ES',
};

export function countryFromDomain(domain: string): string | null {
  const tld = domain.toLowerCase().split('.').pop() ?? '';
  return COUNTRY_BY_TLD[tld] ?? null;
}

/** Como mucho, filiales NUEVAS que Apollo agrega al árbol por corrida. */
export const CORPORATE_TREE_APOLLO_FAMILY_MAX_NEW = 8;

/**
 * Las filiales que dio Apollo:
 *   1. completan la web de una fila del árbol que no la tenía (mismo nombre o el de Apollo
 *      contenido en el de la fila, y el país no contradice);
 *   2. si no estaban en el árbol, entran como filiales nuevas sólo si su país se sabe (lo dice
 *      Apollo o el dominio de país) y está entre los pedidos.
 * Nunca la web del grupo ni una que ya tenga otra fila. Puro.
 */
export function applyApolloFamily(params: {
  plan: CorporateTreeWritePlan;
  root: CorporateTreeRoot;
  subsidiaries: readonly CorporateTreeApolloSubsidiary[];
  countryCodes: readonly string[];
  maxRows?: number;
  /** `false` = sólo completa webs, no agrega filiales (no se pidió la rama «filiales»). */
  addNew?: boolean;
}): { plan: CorporateTreeWritePlan; matched: number; added: number } {
  const { root, countryCodes } = params;
  const maxRows = params.maxRows ?? CORPORATE_TREE_LIMITS.maxRows;
  const used = new Set(
    [root.domain, ...params.plan.rows.map((r) => r.domain)].filter((d): d is string => !!d).map((d) => d.toLowerCase()),
  );
  const usable = params.subsidiaries
    .map((sub) => ({ ...sub, domain: sub.domain?.toLowerCase() ?? null }))
    .filter((sub): sub is CorporateTreeApolloSubsidiary & { domain: string } => !!sub.domain && !used.has(sub.domain))
    .filter((sub) => sub.employeeCount == null || sub.employeeCount >= CORPORATE_TREE_APOLLO_MIN_EMPLOYEES)
    .sort(bySizeDesc);
  const countryOf = (sub: { domain: string; countryCode: string | null }) => sub.countryCode ?? countryFromDomain(sub.domain);

  // 1. Completar la web de las filas sin web.
  const found = new Map<string, CorporateTreeApolloMatch>();
  const taken = new Set<string>();
  for (const row of params.plan.rows) {
    if (row.route !== 'without_website' || row.relation === 'root' || !row.countryCode) continue;
    const rowCore = normalizeTreeName(stripBranchSuffix(row.name));
    const match = usable.find((sub) => {
      if (taken.has(sub.domain)) return false;
      const subCountry = countryOf(sub);
      if (subCountry && subCountry !== row.countryCode) return false;
      if (apolloSubsidiaryUsesGlobalDomain(sub, row.countryCode!)) return false;
      const subCore = normalizeTreeName(sub.name);
      return !!subCore && (subCore === rowCore || namedWithin(subCore, rowCore));
    });
    if (!match) continue;
    taken.add(match.domain);
    found.set(row.key, { website: match.website ?? `https://${match.domain}`, domain: match.domain, linkedinUrl: match.linkedinUrl });
  }
  let plan = promoteRowsFoundInApollo(params.plan, found);

  // 2. Filiales nuevas con país conocido y pedido.
  const existingKeys = new Set(plan.rows.map((r) => r.key));
  const room =
    params.addNew === false ? 0 : Math.max(0, Math.min(CORPORATE_TREE_APOLLO_FAMILY_MAX_NEW, maxRows - plan.rows.length));
  const web = new Map([...plan.web].map(([cc, list]) => [cc, [...list]]));
  const newRows: CorporateTreePlannedRow[] = [];
  for (const sub of usable) {
    if (newRows.length >= room || taken.has(sub.domain)) continue;
    const countryCode = countryOf(sub);
    if (!countryCode || !countryCodes.includes(countryCode)) continue;
    if (apolloSubsidiaryUsesGlobalDomain(sub, countryCode)) continue;
    const key = corporateTreeRowKey(sub.name, countryCode);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    taken.add(sub.domain);
    const website = sub.website ?? `https://${sub.domain}`;
    const node: CorporateTreeNode = {
      branch: 'subsidiary',
      name: sub.name,
      legalName: null,
      countryCode,
      website,
      domain: sub.domain,
      linkedinUrl: sub.linkedinUrl,
      relationDetail: `Filial de ${root.name} según Apollo`,
      evidenceUrl: website,
      ...(sub.employeeCount ? { employeeCount: sub.employeeCount } : {}),
    };
    push(web, countryCode, { key, node, bankCandidate: null });
    newRows.push({
      key,
      origin: 'apollo',
      relation: 'subsidiary',
      name: sub.name,
      countryCode,
      domain: sub.domain,
      taxId: null,
      relationDetail: node.relationDetail,
      evidenceUrl: null,
      groupWebsite: null,
      route: 'agent1_writer',
      foundInApollo: true,
    });
  }
  plan = { ...plan, rows: [...plan.rows, ...newRows], web };
  return { plan, matched: found.size, added: newRows.length };
}
