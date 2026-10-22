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
  /** FASE C — se busca desde una fila de otro árbol: el árbol nuevo queda un nivel abajo. */
  parentRelationshipId?: string | null;
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
  /** `true` = no reutilizar el árbol guardado del grupo: buscar (y pagar) de nuevo. */
  refresh?: boolean;
  /** FASE C — la fila del árbol de arriba cuando se busca el árbol de una filial desde un lote. */
  parentRelationshipId?: string | null;
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
  /** FASE D: el grupo ya es cliente de UBITS o lo trabaja alguien (oportunidad tibia). */
  group_opportunity?: 'customer_group' | 'worked_group';
  /** FASE C: de qué empresa del grupo depende directamente (NULL/ausente = de la partida). */
  parent_name?: string | null;
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
      // Mexicanas que cotizan en bolsa: «Grupo Bimbo, S.A.B. de C.V.» (Prod 22-10, FASE C).
      's ?a ?b(?: de c ?v)?',
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

/**
 * «Citigroup Global Markets Europe AG, Sucursal en España» ⇒ «Citigroup Global Markets Europe AG»:
 * la sucursal en un país es, para el árbol, la misma empresa en ese país (Prod 15-10, Citigroup:
 * salía dos veces en España y fue dos veces al rescate).
 */
export function stripBranchSuffix(name: string): string {
  // Sólo «…, Sucursal …», «… - Sucursal …», «… (Branch …)» o «… Sucursal en/de …»: nunca una
  // palabra suelta dentro del nombre («Banco Agencia de Viajes»).
  const stripped = name
    .replace(/\s*[,(–-]\s*(sucursal|branch)\b[\s\S]*$/i, '')
    .replace(/\s+(sucursal|branch)\s+(en|de|del|in|of)\b[\s\S]*$/i, '')
    .trim();
  return stripped || name.trim();
}

/**
 * «BIMBO SA (AR)» ⇒ «BIMBO SA»: la etiqueta de país entre paréntesis al final no es parte del
 * nombre (Prod 15-10, Bimbo: «BIMBO SA (AR)» repetía a «BIMBO DE ARGENTINA S.A.» y se pagó su
 * clasificación).
 */
export function stripCountryTag(name: string): string {
  const stripped = name.replace(/\s*\(\s*[A-Za-z]{2}\s*\)\s*$/, '').trim();
  return stripped || name.trim();
}

/** Cómo se nombra cada país al final de una razón social (ya normalizado: sin tildes). */
const OWN_COUNTRY_NAMES: Readonly<Record<string, readonly string[]>> = {
  AR: ['argentina'],
  BO: ['bolivia'],
  BR: ['brasil', 'brazil'],
  CL: ['chile'],
  CO: ['colombia'],
  CR: ['costa rica'],
  DO: ['republica dominicana', 'dominicana'],
  EC: ['ecuador'],
  ES: ['espana', 'spain'],
  GT: ['guatemala'],
  HN: ['honduras'],
  MX: ['mexico'],
  NI: ['nicaragua'],
  PA: ['panama'],
  PE: ['peru'],
  PY: ['paraguay'],
  SV: ['el salvador', 'salvador'],
  US: ['estados unidos', 'usa', 'us'],
  UY: ['uruguay'],
  VE: ['venezuela'],
};

/** Lo que queda tiene que seguir siendo un nombre («de Chile» solo no lo es). */
const MIN_CORE_AFTER_COUNTRY = 3;

/**
 * Sobre un nombre YA normalizado: «bimbo de argentina» en Argentina ⇒ «bimbo». El país PROPIO
 * al final no distingue a la empresa dentro de ese país (la clave ya lleva el país). Nunca
 * quita otro país («bimbo de argentina» en Chile sigue igual).
 */
export function stripOwnCountryMarker(normalizedName: string, countryCode: string | null): string {
  const names = countryCode ? OWN_COUNTRY_NAMES[countryCode.toUpperCase()] : undefined;
  if (!names) return normalizedName;
  for (const country of names) {
    const match = normalizedName.match(new RegExp(`^(.+?)(?:\\s+(?:de|del|do|da|of))?\\s+${country}$`));
    if (match && match[1].trim().length >= MIN_CORE_AFTER_COUNTRY) return match[1].trim();
  }
  return normalizedName;
}

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
