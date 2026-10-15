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
};

/** Una empresa sin web que en HubSpot tiene un nombre parecido en su mismo país. */
export type CorporateTreePossibleDuplicate = { company: CountrySourceCompany; matchedName: string | null };

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
  groupCompany?: CountrySourceCompany | null;
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

/** Una organización tal como la devuelve la búsqueda de Apollo (sólo lo que se usa). */
export type CorporateTreeApolloOrganization = {
  name: string | null;
  website_url: string | null;
  primary_domain?: string | null;
  linkedin_url: string | null;
};

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
 * ¿Cuál de lo que devolvió Apollo es ESTA empresa? Sólo con el mismo nombre (sin forma
 * societaria) o uno que lo contiene por palabras completas, y con web propia: la de la
 * empresa de partida no vale (sería la del grupo).
 */
export function pickApolloOrganization(
  organizations: readonly CorporateTreeApolloOrganization[],
  query: { name: string; rootDomain: string | null },
  toDomain: (website: string) => string | null,
): CorporateTreeApolloMatch | null {
  const wanted = normalizeTreeName(query.name);
  if (!wanted) return null;
  for (const org of organizations) {
    const core = normalizeTreeName(org.name ?? '');
    if (!core) continue;
    // Exacto; o uno contiene al otro por palabras completas Y lo común tiene una palabra propia.
    const sameName = core === wanted || namedWithin(core, wanted) || namedWithin(wanted, core);
    if (!sameName) continue;
    const domain = org.primary_domain?.trim().toLowerCase() || (org.website_url ? toDomain(org.website_url) : null);
    if (!domain || (query.rootDomain && domain === query.rootDomain)) continue;
    return { website: `https://${domain}`, domain, linkedinUrl: org.linkedin_url ?? null };
  }
  return null;
}
