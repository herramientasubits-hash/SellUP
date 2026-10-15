/**
 * Agente 1 · Búsqueda en árbol (AGENT1-CORPORATE-TREE-1, fase 1) — contratos
 * compartidos entre el chat, la ruta y la ficha. Sin imports de servidor.
 *
 * Desde UNA empresa (escrita o elegida en una fila) el agente busca su familia:
 * grupo y matriz, filiales y la misma empresa en otros países. Lo encontrado
 * entra por el mismo camino que una importación (HubSpot, duplicados, número
 * fiscal por país, tamaño, «una empresa, un vendedor») y queda en «Por revisar»,
 * agrupado por rama en el lote y como asociación en la ficha.
 */

export const CORPORATE_TREE_BRANCHES = ['group', 'subsidiary', 'other_country'] as const;

export type CorporateTreeBranch = (typeof CORPORATE_TREE_BRANCHES)[number];

/** Una fila del árbol: la empresa de partida o una de sus ramas. */
export type CorporateTreeRelation = 'root' | CorporateTreeBranch;

export const CORPORATE_TREE_RELATION_LABELS: Readonly<Record<CorporateTreeRelation, string>> = {
  root: 'Empresa de partida',
  group: 'Grupo y matriz',
  subsidiary: 'Filiales y subsidiarias',
  other_country: 'En otros países',
};

export const CORPORATE_TREE_BRANCH_DESCRIPTIONS: Readonly<Record<CorporateTreeBranch, string>> = {
  group: 'La matriz o el holding al que pertenece y sus empresas hermanas.',
  subsidiary: 'Las empresas que controla: filiales, subsidiarias y marcas con razón social propia.',
  other_country: 'La misma empresa operando en otros países, con su razón social local.',
};

/** Orden en el que se pintan las ramas (lote y ficha). */
export const CORPORATE_TREE_RELATION_ORDER: readonly CorporateTreeRelation[] = [
  'root',
  'group',
  'subsidiary',
  'other_country',
];

/** Nombre del lote de una búsqueda en árbol. */
export function corporateTreeBatchName(rootName: string): string {
  return `Árbol · ${rootName}`;
}

/** Industria del lote: una etiqueta propia (la adopción del escritor no la pisa). */
export const CORPORATE_TREE_BATCH_INDUSTRY = 'Árbol de empresa';

/** Clave de la metadata del lote y de cada candidato. */
export const CORPORATE_TREE_METADATA_KEY = 'corporate_tree';

export const CORPORATE_TREE_LIMITS = {
  rootNameMinChars: 2,
  rootNameMaxChars: 120,
  /** Empresas por rama que se le piden a Claude. */
  companiesPerBranch: 8,
  /** Filas que entran al lote como máximo (raíz incluida). */
  maxRows: 30,
} as const;

/** La empresa de partida cuando se elige desde una fila (prospecto o empresa). */
export type CorporateTreeRootRef = {
  name: string;
  website?: string | null;
  countryCode?: string | null;
  candidateId?: string | null;
  accountId?: string | null;
};

/** Lo que el navegador manda para lanzar una búsqueda en árbol. */
export type CorporateTreeRunPayload = {
  searchMode: 'corporate_tree';
  clientRequestId: string;
  rootName: string;
  rootWebsite?: string | null;
  rootCountryCode?: string | null;
  rootCandidateId?: string | null;
  rootAccountId?: string | null;
  branches: CorporateTreeBranch[];
  /** Países donde se buscan las ramas. */
  countryCodes: string[];
};

/** `metadata.corporate_tree` de cada candidato que entró por el árbol. */
export type CorporateTreeCandidateMetadata = {
  run_id: string;
  relation: CorporateTreeRelation;
  root_name: string;
  relation_detail: string | null;
  evidence_url: string | null;
  /** Web compartida del grupo (no se usa como web propia: varias empresas la comparten). */
  group_website: string | null;
  /** La web no se pudo comprobar (el sitio bloquea la descarga): revisarla a mano. */
  website_unverified?: boolean;
  /** La web la encontró Apollo buscando por el nombre. */
  found_in_apollo?: boolean;
};

export function isCorporateTreeBranch(value: unknown): value is CorporateTreeBranch {
  return typeof value === 'string' && (CORPORATE_TREE_BRANCHES as readonly string[]).includes(value);
}

export function isCorporateTreeRelation(value: unknown): value is CorporateTreeRelation {
  return value === 'root' || isCorporateTreeBranch(value);
}

/** Lee la rama de la metadata de un candidato; `null` si no entró por el árbol. */
export function readCorporateTreeRelation(metadata: unknown): CorporateTreeRelation | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const tree = (metadata as Record<string, unknown>)[CORPORATE_TREE_METADATA_KEY];
  if (!tree || typeof tree !== 'object') return null;
  const relation = (tree as Record<string, unknown>).relation;
  return isCorporateTreeRelation(relation) ? relation : null;
}

/**
 * Formas societarias al final del nombre: «Alpina Perú S.A.C.» y «Alpina Perú» son la
 * misma. Con espacios entre letras («CENCOSUD S A», como lo escribe el SII) y en palabras
 * («SOCIEDAD ANONIMA», «S.A.S BIC», «SpA»): medido con filas reales el 14-10.
 */
const LEGAL_SUFFIX = new RegExp(
  '(?:\\s+(?:' +
    [
      'sociedad anonima(?: cerrada| abierta)?',
      'sociedad de responsabilidad limitada',
      'sociedad por acciones(?: simplificada)?',
      'empresa individual de responsabilidad limitada',
      's ?a ?s(?: bic)?',
      's ?a ?c(?: i)?',
      's ?a ?a',
      's ?a ?i ?c',
      's ?a',
      's ?r ?l',
      's ?de ?r ?l(?: de c ?v)?',
      'de c ?v',
      'c ?v',
      's ?p ?a',
      'e ?i ?r ?l',
      'ltda',
      'limitada',
      'cia',
      'bic',
      'inc',
      'llc',
      'corp',
      'ltd',
      'plc',
      'gmbh',
      // Prod 15-10 (Citigroup): «AG» alemana, «N.A.» de los bancos de EE. UU. y las españolas.
      'ag',
      'n ?a',
      's ?a ?u',
      's ?l ?u',
      's ?l',
    ].join('|') +
    '))+$',
);

/** Nombre para comparar: minúsculas, sin acentos, sin signos ni forma societaria. */
export function normalizeTreeName(text: string): string {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stripped = base.replace(LEGAL_SUFFIX, '').trim();
  return stripped || base;
}
