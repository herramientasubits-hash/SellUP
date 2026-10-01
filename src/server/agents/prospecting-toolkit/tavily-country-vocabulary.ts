/**
 * AGENT1-TAVILY-FREE-CREDITS-1 — cada país nombra distinto al Estado y a la salud
 * (puro, datos).
 *
 * El catálogo de macro industrias se escribió desde Colombia: «gobernación»,
 * «empresa industrial y comercial del Estado», «IPS» o «EPS» no existen (o
 * significan otra cosa) en Chile, México o Argentina. Prod 01-10 (CL×Salud,
 * lote e174731e): Tavily buscó «empresa ips salud Chile» y «empresa entidad
 * promotora de salud Chile». Cada búsqueda inútil es un crédito gratis perdido.
 *
 * Sólo afecta a Tavily: el catálogo compartido no se toca.
 */

import type { MacroIndustryKey } from '@/modules/macro-industry-catalog/macro-industries';

type CountryTerms = Readonly<Record<string, readonly string[]>>;

type MacroVocabulary = {
  /** Términos que sólo tienen sentido en Colombia (o en `keepIn`). */
  colombiaOnly: readonly string[];
  /** Países donde un término «colombiano» también se usa. */
  keepIn?: CountryTerms;
  /** Términos propios de cada país. */
  add: CountryTerms;
};

const VOCABULARY: Partial<Record<MacroIndustryKey, MacroVocabulary>> = {
  government: {
    colombiaOnly: ['gobernacion', 'alcaldia', 'empresa industrial y comercial del estado'],
    keepIn: {
      VE: ['gobernacion', 'alcaldia'],
      PA: ['alcaldia'],
      GT: ['gobernacion'],
      HN: ['alcaldia'],
      SV: ['alcaldia'],
      NI: ['alcaldia'],
      PY: ['gobernacion'],
      BO: ['gobernacion'],
      UY: ['alcaldia'],
    },
    add: {
      MX: ['ayuntamiento', 'gobierno del estado', 'secretaria de gobierno', 'organismo descentralizado'],
      CL: ['municipalidad', 'gobierno regional', 'servicio publico'],
      PE: ['municipalidad', 'gobierno regional', 'organismo publico'],
      AR: ['municipalidad', 'gobierno provincial', 'ente autarquico'],
      EC: ['municipio', 'gobierno provincial', 'empresa publica'],
      UY: ['intendencia', 'ente autonomo'],
      PY: ['municipalidad', 'ente autarquico'],
      BO: ['gobierno autonomo municipal', 'empresa publica'],
      GT: ['municipalidad', 'entidad descentralizada'],
      HN: ['municipalidad', 'institucion descentralizada'],
      CR: ['municipalidad', 'institucion autonoma'],
      PA: ['municipio', 'entidad autonoma'],
      DO: ['ayuntamiento', 'institucion descentralizada'],
      SV: ['institucion autonoma'],
      NI: ['ente autonomo'],
      ES: ['ayuntamiento', 'diputacion', 'comunidad autonoma'],
    },
  },
  health_pharma: {
    colombiaOnly: ['ips salud', 'entidad promotora de salud'],
    add: {
      CL: ['isapre', 'centro medico', 'mutual de seguridad'],
      MX: ['hospital privado', 'aseguradora de gastos medicos'],
      AR: ['prepaga', 'obra social', 'sanatorio'],
      PE: ['entidad prestadora de salud', 'clinica privada'],
      EC: ['centro medico'],
      UY: ['mutualista', 'sanatorio'],
      PY: ['sanatorio', 'seguro medico'],
      ES: ['hospital privado', 'mutua de salud'],
    },
  },
};

/**
 * Términos de búsqueda de una macro para un país. Colombia (o país desconocido)
 * conserva el catálogo tal cual.
 */
export function resolveTavilyCountryTerms(input: {
  macroKey: MacroIndustryKey;
  countryCode: string | null | undefined;
  terms: readonly string[];
}): string[] {
  const code = input.countryCode?.trim().toUpperCase() ?? '';
  const vocabulary = VOCABULARY[input.macroKey];
  if (!vocabulary || code === '' || code === 'CO') return [...input.terms];

  const kept = new Set(vocabulary.keepIn?.[code] ?? []);
  const removed = new Set(vocabulary.colombiaOnly.filter((term) => !kept.has(term)));
  const out = input.terms.filter((term) => !removed.has(term));
  for (const term of vocabulary.add[code] ?? []) {
    if (!out.includes(term)) out.push(term);
  }
  return out;
}
