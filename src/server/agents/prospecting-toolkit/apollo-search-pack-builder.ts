/**
 * Apollo Search Pack Builder (v1.L2.10)
 *
 * Construye search packs estructurados derivados del contexto del wizard:
 * sector, subindustria, tokens de criterio adicional e intención comercial.
 *
 * Un search pack es un conjunto coherente de keywords para una sola llamada Apollo.
 * En lugar de una query amplia única, el builder genera N packs ordenados por
 * especificidad — P0 (más específico) → P1 → P2 (más amplio).
 *
 * Reglas:
 *   - Puro: sin side effects, sin I/O, sin llamadas externas.
 *   - No modifica apollo-client, Tavily ni Lusha.
 *   - País nunca entra en qKeywords — va en organization_locations.
 *   - MAX_KEYWORDS = 5 se respeta al slice en el caller.
 *   - additionalCriteriaTokens influyen en keywords de P0.
 *   - No mezcla LMS con generic "education" en el mismo pack.
 *
 * L2.10:
 *   - ApolloSearchPack: tipo exportado.
 *   - buildApolloSearchPacks: función principal.
 *   - selectPacksUpToMaxQueries: selector con cap.
 *   - Packs definidos para: Educación (LMS, corporate training, EdTech B2B).
 */

// ─── Versión ──────────────────────────────────────────────────────────────────

export const APOLLO_SEARCH_PACK_BUILDER_VERSION = 'v1.L2.10';

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export type ApolloSearchPackPriority = 'P0' | 'P1' | 'P2';

export type ApolloSearchPack = {
  /** Clave estable del pack — usada en metadata y logs. */
  packKey: string;
  /** Etiqueta legible para humanos. */
  packLabel: string;
  /** Intención comercial del pack — describe el tipo de empresa buscada. */
  intent: string;
  /** Prioridad de ejecución: P0 = más específico, P2 = más amplio. */
  priority: ApolloSearchPackPriority;
  /**
   * Keywords a enviar como q_keywords en Apollo.
   * Máx 5 elementos — el caller aplica slice(0, MAX_KEYWORDS) antes de mandar.
   * No incluir país ni términos genéricos como "education".
   */
  qKeywords: string[];
  /** Términos que NO deben aparecer en este pack para evitar ruido genérico. */
  excludedGenericTerms?: string[];
  /** Señales esperadas en resultados Apollo para considerar el pack exitoso. */
  expectedSectorSignals: string[];
  notes?: string;
};

export type ApolloSearchPackBuilderInput = {
  sector: string | null | undefined;
  subindustries: string[];
  additionalCriteriaTokens: string[];
  country?: string | null;
  countryCode?: string | null;
};

export type ApolloSearchPackBuildResult = {
  packs: ApolloSearchPack[];
  availablePackCount: number;
  builderVersion: string;
  /** Estrategia aplicada para construir los packs. */
  buildStrategy: 'subindustry_specific_packs' | 'sector_fallback_packs' | 'generic_fallback';
  /** Key de la subindustria dominante que triggereó la selección de packs. */
  dominantSubindustryKey: string | null;
  /** Tokens de criterio adicional que inyectaron keywords nuevas en P0. */
  criteriaTokensInfluencingP0: string[];
  /** Tokens de criterio adicional cuyos injectKeywords ya estaban cubiertos en P0. */
  criteriaTokensMergedDuplicateP0: string[];
  /** Pack key que fue boosteado a P0 por criteria signals (null si no hubo boost). */
  boostedPackKey: string | null;
};

/** Resultado de selección de packs con cap de max queries. */
export type ApolloSearchPackSelection = {
  selectedPacks: ApolloSearchPack[];
  allAvailablePacks: ApolloSearchPack[];
  availablePackCount: number;
  selectedPackCount: number;
  /** True si el cap de max queries truncó los packs disponibles. */
  qaCapApplied: boolean;
  /** True si se seleccionó exactamente el primer pack (cap = 1 o solo 1 disponible). */
  qaCapSelectedFirstPack: boolean;
};

// ─── Normalize helper ─────────────────────────────────────────────────────────

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim();
}

function hasSignal(tokens: string[], signals: string[]): boolean {
  const normalizedTokens = tokens.map(normalizeKey);
  const normalizedSignals = signals.map(normalizeKey);
  return normalizedTokens.some(t =>
    normalizedSignals.some(s => t.includes(s) || s.includes(t)),
  );
}

// ─── Pack templates base ──────────────────────────────────────────────────────
//
// Cada grupo define los packs canónicos para un dominio de subindustria.
// El builder los reordena y enriquece según los additionalCriteriaTokens.

// P0 por default: corporate_training_providers (keywords L2.7-compatibles: "corporate training", "formacion").
// lms_vendors es P1 por default pero se bootsea a P0 cuando criteria contiene señales LMS
// (ver lógica de boost en buildApolloSearchPacks).
const EDUCATION_PACKS_BASE: ApolloSearchPack[] = [
  {
    packKey: 'corporate_training_providers',
    packLabel: 'Corporate Training Providers',
    intent: 'B2B corporate and workforce training companies',
    priority: 'P0',
    qKeywords: [
      'corporate training',
      'workforce training',
      'sales training',
      'leadership training',
      'formacion corporativa',
    ],
    excludedGenericTerms: ['education', 'university', 'school'],
    expectedSectorSignals: ['corporate training', 'workforce training', 'sales enablement'],
    notes: 'Pack base para subindustria Formación Corporativa — L2.7 compatible.',
  },
  {
    packKey: 'lms_vendors',
    packLabel: 'LMS Vendors',
    intent: 'LMS and training platform providers',
    priority: 'P1',
    qKeywords: [
      'learning management system',
      'lms',
      'training platform',
      'corporate learning',
      'sales training',
    ],
    excludedGenericTerms: ['education', 'higher education', 'university', 'school'],
    expectedSectorSignals: ['lms', 'learning management', 'training platform', 'corporate learning'],
    notes: 'Pack LMS — promovido a P0 cuando criteria incluye señales LMS (plataformas, lms, etc.).',
  },
  {
    packKey: 'edtech_b2b',
    packLabel: 'EdTech B2B',
    intent: 'B2B digital learning and e-learning platforms',
    priority: 'P2',
    qKeywords: [
      'edtech',
      'online learning',
      'e-learning',
      'corporate education',
      'digital learning',
    ],
    excludedGenericTerms: ['higher education', 'university', 'school'],
    expectedSectorSignals: ['edtech', 'online learning', 'digital learning', 'e-learning'],
    notes: 'Plataformas EdTech B2B con enfoque en aprendizaje digital corporativo.',
  },
];

// ─── Señales de boost — reordenan qué pack llega a P0 ────────────────────────
//
// Cuando los additionalCriteriaTokens contienen estas señales, el pack indicado
// se bootsea dinámicamente a P0 (por encima del P0 base del dominio).
// Solo el primer boost con match gana. Orden importa.

const PACK_BOOST_SIGNALS: Array<{
  signals: string[];
  boostPackKey: string;
}> = [
  {
    signals: ['lms', 'plataforma', 'plataformas', 'learning management', 'sistema de gestion'],
    boostPackKey: 'lms_vendors',
  },
];

// ─── Señales de enriquecimiento — inyectan keywords adicionales en el P0 ─────
//
// Una vez decidido cuál es el P0, estas reglas enriquecen sus keywords.

const CRITERIA_SIGNALS: Array<{
  signals: string[];
  boostPackKey: string;
  injectKeywords: string[];
}> = [
  {
    signals: ['lms', 'plataforma', 'plataformas', 'learning management', 'sistema de gestion'],
    boostPackKey: 'lms_vendors',
    injectKeywords: ['lms', 'learning management system', 'training platform'],
  },
  {
    signals: ['ventas', 'comercial', 'sales', 'capacitacion comercial', 'sales training'],
    boostPackKey: 'lms_vendors',
    injectKeywords: ['sales training', 'capacitación comercial'],
  },
  {
    signals: ['corporate training', 'capacitacion empresarial', 'formacion empresarial', 'workforce'],
    boostPackKey: 'corporate_training_providers',
    injectKeywords: ['corporate training', 'workforce training'],
  },
  {
    signals: ['edtech', 'e-learning', 'elearning', 'digital', 'virtual'],
    boostPackKey: 'edtech_b2b',
    injectKeywords: ['edtech', 'e-learning', 'digital learning'],
  },
];

// ─── Variante LMS-first para subindustrias cuyo nombre ya es "LMS" ────────────
//
// Cuando la subindustria misma es 'LMS', el pack LMS ya es P0 por definición
// sin necesidad de boost. Se reutilizan los mismos packs pero con prioridades distintas.

const EDUCATION_PACKS_LMS_FIRST: ApolloSearchPack[] = [
  {
    packKey: 'lms_vendors',
    packLabel: 'LMS Vendors',
    intent: 'LMS and training platform providers',
    priority: 'P0',
    qKeywords: [
      'learning management system',
      'lms',
      'training platform',
      'corporate learning',
      'sales training',
    ],
    excludedGenericTerms: ['education', 'higher education', 'university', 'school'],
    expectedSectorSignals: ['lms', 'learning management', 'training platform', 'corporate learning'],
    notes: 'Pack LMS-first para subindustria "LMS" explícita.',
  },
  {
    packKey: 'corporate_training_providers',
    packLabel: 'Corporate Training Providers',
    intent: 'B2B corporate and workforce training companies',
    priority: 'P1',
    qKeywords: [
      'corporate training',
      'workforce training',
      'sales training',
      'leadership training',
      'formacion corporativa',
    ],
    excludedGenericTerms: ['education', 'university', 'school'],
    expectedSectorSignals: ['corporate training', 'workforce training', 'sales enablement'],
    notes: 'Pack secundario en dominio LMS-first.',
  },
  {
    packKey: 'edtech_b2b',
    packLabel: 'EdTech B2B',
    intent: 'B2B digital learning and e-learning platforms',
    priority: 'P2',
    qKeywords: [
      'edtech',
      'online learning',
      'e-learning',
      'corporate education',
      'digital learning',
    ],
    excludedGenericTerms: ['higher education', 'university', 'school'],
    expectedSectorSignals: ['edtech', 'online learning', 'digital learning', 'e-learning'],
    notes: 'Pack EdTech B2B en dominio LMS-first.',
  },
];

// ─── Dominio → base de packs ──────────────────────────────────────────────────

const SUBINDUSTRY_DOMAIN_MAP: Array<{
  keys: string[];
  domainKey: string;
  basePacks: ApolloSearchPack[];
}> = [
  {
    // Subindustrias donde la intención primaria ya ES LMS → lms_vendors = P0 base
    keys: ['lms', 'e-learning', 'educacion virtual'],
    domainKey: 'lms_platform',
    basePacks: EDUCATION_PACKS_LMS_FIRST,
  },
  {
    // Subindustrias de formación corporativa general → corporate_training = P0 base
    // lms_vendors se bootsea a P0 si criteria contiene señales LMS
    keys: [
      'formacion corporativa',
      'educacion corporativa',
      'capacitacion comercial',
    ],
    domainKey: 'education_corporate',
    basePacks: EDUCATION_PACKS_BASE,
  },
];

function matchSubindustryDomain(subindustries: string[]): {
  domainKey: string;
  basePacks: ApolloSearchPack[];
} | null {
  const normalized = subindustries.map(normalizeKey);
  for (const entry of SUBINDUSTRY_DOMAIN_MAP) {
    const match = normalized.some(sub =>
      entry.keys.some(k => sub.includes(k) || k.includes(sub)),
    );
    if (match) return { domainKey: entry.domainKey, basePacks: entry.basePacks };
  }
  return null;
}

// ─── Sector fallback packs ────────────────────────────────────────────────────

function buildSectorFallbackPacks(sector: string | null | undefined): ApolloSearchPack[] {
  if (!sector) return [];
  const normalizedSector = normalizeKey(sector);
  if (normalizedSector.includes('educacion') || normalizedSector.includes('educación')) {
    return EDUCATION_PACKS_BASE;
  }
  return [];
}

// ─── Enriquecimiento de P0 con criterios adicionales ─────────────────────────

/**
 * Dado el pack P0 base y los tokens de criterio adicional, inyecta keywords
 * relevantes respetando MAX_KEYWORDS.
 *
 * No duplica keywords ya presentes.
 * Distingue tokens cuyo inject ya estaba cubierto (mergedDuplicates) de
 * tokens que realmente inyectaron keywords nuevas (actuallyInjected).
 */
function enrichP0WithCriteriaTokens(
  pack: ApolloSearchPack,
  additionalCriteriaTokens: string[],
  maxKeywords: number,
): {
  enrichedPack: ApolloSearchPack;
  criteriaTokensInfluencing: string[];
  criteriaTokensMergedDuplicate: string[];
} {
  if (additionalCriteriaTokens.length === 0) {
    return { enrichedPack: pack, criteriaTokensInfluencing: [], criteriaTokensMergedDuplicate: [] };
  }

  const influencing: string[] = [];
  const mergedDuplicates: string[] = [];
  let keywords = [...pack.qKeywords];

  for (const rule of CRITERIA_SIGNALS) {
    if (rule.boostPackKey !== pack.packKey) continue;
    if (!hasSignal(additionalCriteriaTokens, rule.signals)) continue;

    const matchedTokens = additionalCriteriaTokens.filter(t =>
      rule.signals.some(s => normalizeKey(t).includes(normalizeKey(s)) || normalizeKey(s).includes(normalizeKey(t))),
    );

    // Determinar si los injectKeywords ya están cubiertos o se agregan nuevos
    let anyActuallyInjected = false;
    for (const inject of rule.injectKeywords) {
      const alreadyCovered = keywords.some(
        k => normalizeKey(k).includes(normalizeKey(inject)) || normalizeKey(inject).includes(normalizeKey(k)),
      );
      if (alreadyCovered) continue;
      if (keywords.length < maxKeywords) {
        keywords.push(inject);
        anyActuallyInjected = true;
      }
    }

    // Clasificar tokens: merged si todo ya estaba cubierto, influencing si algo se inyectó
    if (anyActuallyInjected) {
      influencing.push(...matchedTokens);
    } else {
      mergedDuplicates.push(...matchedTokens);
    }
  }

  keywords = keywords.slice(0, maxKeywords);

  return {
    enrichedPack: { ...pack, qKeywords: keywords },
    criteriaTokensInfluencing: [...new Set(influencing)],
    criteriaTokensMergedDuplicate: [...new Set(mergedDuplicates)],
  };
}

// ─── Función principal ────────────────────────────────────────────────────────

const MAX_KEYWORDS = 5;

/**
 * Construye la lista ordenada de search packs Apollo para el contexto del wizard.
 *
 * Prioridad de selección de base de packs:
 *   1. Subindustria → domain map → packs específicos.
 *   2. Sector padre → sector fallback packs.
 *   3. Sin match → genérico vacío (availablePackCount = 0).
 *
 * Enriquecimiento de P0:
 *   - additionalCriteriaTokens injectan keywords relevantes en P0 (máx MAX_KEYWORDS).
 *
 * País nunca entra en qKeywords.
 */
export function buildApolloSearchPacks(input: ApolloSearchPackBuilderInput): ApolloSearchPackBuildResult {
  const { sector, subindustries, additionalCriteriaTokens } = input;

  // Paso 1: resolver base de packs
  let basePacks: ApolloSearchPack[] = [];
  let buildStrategy: ApolloSearchPackBuildResult['buildStrategy'] = 'generic_fallback';
  let dominantSubindustryKey: string | null = null;

  const subindustryMatch = matchSubindustryDomain(subindustries);
  if (subindustryMatch) {
    basePacks = subindustryMatch.basePacks;
    buildStrategy = 'subindustry_specific_packs';
    dominantSubindustryKey = subindustryMatch.domainKey;
  } else {
    const sectorFallback = buildSectorFallbackPacks(sector);
    if (sectorFallback.length > 0) {
      basePacks = sectorFallback;
      buildStrategy = 'sector_fallback_packs';
    }
  }

  if (basePacks.length === 0) {
    return {
      packs: [],
      availablePackCount: 0,
      builderVersion: APOLLO_SEARCH_PACK_BUILDER_VERSION,
      buildStrategy: 'generic_fallback',
      dominantSubindustryKey: null,
      criteriaTokensInfluencingP0: [],
      criteriaTokensMergedDuplicateP0: [],
      boostedPackKey: null,
    };
  }

  // Paso 2: ordenar packs por prioridad base (P0 < P1 < P2)
  const priorityOrder: Record<ApolloSearchPackPriority, number> = { P0: 0, P1: 1, P2: 2 };
  let sortedPacks = [...basePacks].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Paso 3: aplicar boost — si criteria contiene señales LMS u otras boost signals,
  // mover el pack boosteado a la posición 0 (P0 dinámico).
  let boostedPackKey: string | null = null;
  if (additionalCriteriaTokens.length > 0) {
    for (const boost of PACK_BOOST_SIGNALS) {
      if (hasSignal(additionalCriteriaTokens, boost.signals)) {
        const boostIdx = sortedPacks.findIndex(p => p.packKey === boost.boostPackKey);
        if (boostIdx > 0) {
          const [boosted] = sortedPacks.splice(boostIdx, 1);
          sortedPacks = [boosted, ...sortedPacks];
          boostedPackKey = boost.boostPackKey;
        }
        break; // solo un boost activo a la vez
      }
    }
  }

  // Paso 4: enriquecer el P0 efectivo con additionalCriteriaTokens
  const [p0Base, ...restPacks] = sortedPacks;
  let criteriaTokensInfluencingP0: string[] = [];
  let criteriaTokensMergedDuplicateP0: string[] = [];
  let finalP0 = p0Base;

  if (p0Base && additionalCriteriaTokens.length > 0) {
    const { enrichedPack, criteriaTokensInfluencing, criteriaTokensMergedDuplicate } =
      enrichP0WithCriteriaTokens(p0Base, additionalCriteriaTokens, MAX_KEYWORDS);
    finalP0 = enrichedPack;
    criteriaTokensInfluencingP0 = criteriaTokensInfluencing;
    criteriaTokensMergedDuplicateP0 = criteriaTokensMergedDuplicate;
  }

  // Paso 5: asegurar MAX_KEYWORDS en todos los packs
  const finalPacks = [finalP0, ...restPacks].map(pack => ({
    ...pack,
    qKeywords: pack.qKeywords.slice(0, MAX_KEYWORDS),
  }));

  return {
    packs: finalPacks,
    availablePackCount: finalPacks.length,
    builderVersion: APOLLO_SEARCH_PACK_BUILDER_VERSION,
    buildStrategy,
    dominantSubindustryKey,
    criteriaTokensInfluencingP0,
    criteriaTokensMergedDuplicateP0,
    boostedPackKey,
  };
}

// ─── Selector con cap de max queries ─────────────────────────────────────────

/**
 * Selecciona los packs a ejecutar respetando el cap de max queries.
 *
 * Si maxQueries = 1 → solo el primer pack (P0).
 * Si maxQueries = 3 → máximo 3 packs en orden de prioridad.
 *
 * qaCapSelectedFirstPack = true cuando el resultado tiene exactamente 1 pack
 * (sea porque maxQueries=1 o porque solo hay 1 disponible).
 */
export function selectPacksUpToMaxQueries(
  buildResult: ApolloSearchPackBuildResult,
  maxQueries: number,
): ApolloSearchPackSelection {
  const cap = Math.max(1, maxQueries);
  const selectedPacks = buildResult.packs.slice(0, cap);

  return {
    selectedPacks,
    allAvailablePacks: buildResult.packs,
    availablePackCount: buildResult.availablePackCount,
    selectedPackCount: selectedPacks.length,
    qaCapApplied: cap < buildResult.availablePackCount,
    qaCapSelectedFirstPack: selectedPacks.length === 1,
  };
}
