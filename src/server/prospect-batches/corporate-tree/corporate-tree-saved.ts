/**
 * Agente 1 · Búsqueda en árbol — el árbol GUARDADO (FASE A, dueña 21-10: 30 días).
 *
 * Lo que Claude (y Apollo) encontraron de un grupo se guarda en la metadata del lote. Si
 * alguien vuelve a buscar el mismo grupo dentro de 30 días, con ramas y países que ya estaban
 * cubiertos, se reutiliza esa lista en vez de pagarla otra vez (Prod 15-10: Citigroup se pagó
 * 5 veces y Bimbo 5). Lo gratis se vuelve a leer y TODO pasa de nuevo por las compuertas de
 * siempre (HubSpot, duplicados, número fiscal, «una empresa, un vendedor»): sólo se ahorra la
 * búsqueda pagada. Una corrida que reutilizó no se vuelve a guardar: el plazo cuenta desde la
 * búsqueda real.
 *
 * Puro: la lectura de la base se inyecta. Lo leído es dato no confiable y se valida campo por
 * campo.
 */

import {
  CORPORATE_TREE_BRANCHES,
  stripCountryTag,
  type CorporateTreeBranch,
} from '@/modules/prospect-batches/corporate-tree/corporate-tree-types';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import { normalizeTreeName, type CorporateTreeNode } from './corporate-tree-search';
import type { CorporateTreeApolloSubsidiary } from './corporate-tree-plan';

/** Cuánto vale un árbol guardado antes de volver a pagar la búsqueda. */
export const CORPORATE_TREE_SAVED_DAYS = 30;
const DAY_MS = 86_400_000;
/** Lo más que se guarda por árbol (3 ramas × 8 de Claude, con holgura). */
const SAVED_NODES_MAX = 40;
const SAVED_APOLLO_MAX = 60;

/** Clave del grupo para encontrar su árbol guardado: el nombre sin forma societaria. */
export function corporateTreeRootKey(rootName: string): string {
  return normalizeTreeName(stripCountryTag(rootName));
}

export type CorporateTreeSavedRoot = { website: string | null; domain: string | null; countryCode: string | null };

export type CorporateTreeSavedTree = {
  batchId: string;
  searchedAt: string;
  branches: CorporateTreeBranch[];
  countryCodes: string[];
  root: CorporateTreeSavedRoot;
  nodes: CorporateTreeNode[];
  /** `null` = Apollo no se consultó en esa corrida (se consulta ahora). */
  apolloSubsidiaries: CorporateTreeApolloSubsidiary[] | null;
};

/** Lo que se guarda en `metadata.corporate_tree.saved`. */
export function serializeSavedTree(params: {
  root: CorporateTreeSavedRoot;
  nodes: readonly CorporateTreeNode[];
  apolloSubsidiaries: readonly CorporateTreeApolloSubsidiary[] | null;
}): Record<string, unknown> {
  return {
    v: 1,
    root: { website: params.root.website, domain: params.root.domain, country_code: params.root.countryCode },
    nodes: params.nodes.slice(0, SAVED_NODES_MAX).map((n) => ({
      branch: n.branch,
      name: n.name,
      legal_name: n.legalName,
      country_code: n.countryCode,
      website: n.website,
      domain: n.domain,
      linkedin_url: n.linkedinUrl,
      relation_detail: n.relationDetail,
      evidence_url: n.evidenceUrl,
      ...(n.websiteUnverified ? { website_unverified: true } : {}),
      ...(n.employeeCount ? { employee_count: n.employeeCount } : {}),
    })),
    apollo_subsidiaries: params.apolloSubsidiaries
      ? params.apolloSubsidiaries.slice(0, SAVED_APOLLO_MAX).map((s) => ({
          name: s.name,
          domain: s.domain,
          website: s.website,
          linkedin_url: s.linkedinUrl,
          country_code: s.countryCode,
          employee_count: s.employeeCount ?? null,
        }))
      : null,
  };
}

const text = (value: unknown, max = 300): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const countryCode = (value: unknown): string | null => {
  // Sin recortar: «ECU» no es «EC».
  const code = typeof value === 'string' ? value.trim().toUpperCase() : null;
  return code && /^[A-Z]{2}$/.test(code) ? code : null;
};
const positiveInt = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const isBranch = (value: unknown): value is CorporateTreeBranch =>
  typeof value === 'string' && (CORPORATE_TREE_BRANCHES as readonly string[]).includes(value);

/** Un enlace guardado sólo vale si es http(s) (se pinta como `href`: nunca `javascript:`). */
function httpUrl(value: unknown): string | null {
  const url = text(value, 500);
  return url && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

/** Una web guardada sólo vale si es http(s); el dominio SIEMPRE se recalcula desde la web. */
function websiteAndDomain(website: unknown): { website: string | null; domain: string | null } {
  const url = httpUrl(website);
  const domain = url ? normalizeDomain(url) : null;
  return url && domain ? { website: url, domain } : { website: null, domain: null };
}

function readNode(raw: unknown): CorporateTreeNode | null {
  const node = asRecord(raw);
  const name = text(node?.['name'], 200);
  const cc = countryCode(node?.['country_code']);
  if (!node || !name || !cc || !isBranch(node['branch'])) return null;
  const web = websiteAndDomain(node['website']);
  const employees = positiveInt(node['employee_count']);
  return {
    branch: node['branch'],
    name,
    legalName: text(node['legal_name'], 200),
    countryCode: cc,
    website: web.website,
    domain: web.domain,
    linkedinUrl: httpUrl(node['linkedin_url']),
    relationDetail: text(node['relation_detail'], 500),
    evidenceUrl: httpUrl(node['evidence_url']) ?? '',
    ...(web.website && node['website_unverified'] === true ? { websiteUnverified: true } : {}),
    ...(employees ? { employeeCount: employees } : {}),
  };
}

function readApollo(raw: unknown): CorporateTreeApolloSubsidiary | null {
  const sub = asRecord(raw);
  const name = text(sub?.['name'], 200);
  if (!sub || !name) return null;
  const web = websiteAndDomain(sub['website']);
  // Apollo a veces trae el dominio sin web: se acepta sólo si es un dominio normalizable.
  const domain = web.domain ?? normalizeDomain(`https://${text(sub['domain'], 253) ?? ''}`) ?? null;
  return {
    name,
    domain,
    website: web.website,
    linkedinUrl: httpUrl(sub['linkedin_url']),
    countryCode: countryCode(sub['country_code']),
    employeeCount: positiveInt(sub['employee_count']),
  };
}

/**
 * El árbol guardado de un lote, o `null` si no sirve: sin lista guardada, con errores de
 * Claude, o de una corrida que a su vez reutilizó otra.
 */
export function readSavedTree(row: { batchId: string; createdAt: string; metadata: unknown }): CorporateTreeSavedTree | null {
  const tree = asRecord(asRecord(row.metadata)?.['corporate_tree']);
  const saved = asRecord(tree?.['saved']);
  if (!tree || !saved || saved['v'] !== 1) return null;
  const claude = asRecord(tree['claude']);
  if (Array.isArray(claude?.['errors']) && (claude!['errors'] as unknown[]).length > 0) return null;
  if (claude?.['reused_from']) return null;
  const nodes = (Array.isArray(saved['nodes']) ? (saved['nodes'] as unknown[]) : [])
    .map(readNode)
    .filter((n): n is CorporateTreeNode => !!n);
  const apollo = Array.isArray(saved['apollo_subsidiaries'])
    ? (saved['apollo_subsidiaries'] as unknown[]).map(readApollo).filter((s): s is CorporateTreeApolloSubsidiary => !!s)
    : null;
  const rootRaw = asRecord(saved['root']);
  const rootWeb = websiteAndDomain(rootRaw?.['website']);
  const branches = (Array.isArray(tree['branches']) ? (tree['branches'] as unknown[]) : []).filter(isBranch);
  const countryCodes = (Array.isArray(tree['country_codes']) ? (tree['country_codes'] as unknown[]) : [])
    .map(countryCode)
    .filter((c): c is string => !!c);
  const searchedAt = text(tree['searched_at'], 40) ?? row.createdAt;
  if (branches.length === 0 || countryCodes.length === 0) return null;
  return {
    batchId: row.batchId,
    searchedAt,
    branches,
    countryCodes,
    root: { ...rootWeb, countryCode: countryCode(rootRaw?.['country_code']) },
    nodes,
    apolloSubsidiaries: apollo,
  };
}

/**
 * ¿Es la MISMA empresa de partida? La clave es sólo el nombre, y dos grupos pueden llamarse
 * igual: con las dos webs, deben coincidir; si no, los dos países deben saberse y coincidir.
 * Sin con qué comparar, no se reutiliza (fail-closed: se paga la búsqueda).
 */
function sameRootCompany(
  saved: CorporateTreeSavedRoot,
  wanted: { rootCountryCode: string | null; rootDomain?: string | null },
): boolean {
  if (saved.domain && wanted.rootDomain) return saved.domain === wanted.rootDomain.toLowerCase();
  return !!saved.countryCode && !!wanted.rootCountryCode && saved.countryCode === wanted.rootCountryCode;
}

/**
 * El árbol guardado más reciente que cubre lo pedido: de menos de 30 días, con TODAS las ramas
 * y países pedidos, y de la misma empresa de partida (`sameRootCompany`).
 * Devuelve sus empresas recortadas a lo pedido.
 */
export function pickSavedTree(
  rows: readonly { batchId: string; createdAt: string; metadata: unknown }[],
  wanted: {
    branches: readonly CorporateTreeBranch[];
    countryCodes: readonly string[];
    rootCountryCode: string | null;
    /** La web de la empresa de partida, si se sabe. */
    rootDomain?: string | null;
    nowMs: number;
  },
): CorporateTreeSavedTree | null {
  const fresh = rows
    .map(readSavedTree)
    .filter((t): t is CorporateTreeSavedTree => !!t)
    .filter((t) => {
      const at = Date.parse(t.searchedAt);
      return Number.isFinite(at) && wanted.nowMs - at <= CORPORATE_TREE_SAVED_DAYS * DAY_MS && at <= wanted.nowMs + DAY_MS;
    })
    .filter((t) => wanted.branches.every((b) => t.branches.includes(b)))
    .filter((t) => wanted.countryCodes.every((c) => t.countryCodes.includes(c)))
    .filter((t) => sameRootCompany(t.root, wanted))
    .sort((a, b) => Date.parse(b.searchedAt) - Date.parse(a.searchedAt));
  const best = fresh[0];
  if (!best) return null;
  return {
    ...best,
    nodes: best.nodes.filter((n) => wanted.branches.includes(n.branch) && wanted.countryCodes.includes(n.countryCode)),
  };
}
